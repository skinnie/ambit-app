package com.ambitsyncmodern.ble

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.Executors

/*
 * EXPERIMENTAL — BLE support for AmbitApp, v0.3.0. Ambit3/Traverse series only.
 *
 * Built from a real HCI snoop capture of a working Suunto-app BLE session
 * (2026-08-06), not from official documentation — see HANDOFF.md Milestone 7
 * for the full research trail. Two things that capture directly disproved
 * about earlier assumptions in this project, both now handled here:
 *
 * 1. The custom NSP service does not appear in GATT discovery immediately on
 *    connect — the watch sends a "Service Changed" indication right after
 *    connecting, and only re-running discovery afterward reveals it. Every
 *    connection attempt this project made before finding that (nRF Connect,
 *    direct-connect, fresh pairing) only ever saw the two generic GATT
 *    services as a result.
 * 2. There is no separate NSP login step — connect, react to Service
 *    Changed, re-discover, then talk NSP directly (see protocol_ble.c for
 *    the frame codec).
 *
 * UNVERIFIED for OUR OWN writes specifically: the capture was a real
 * activity-log sync, not a route/POI write, so the frame envelope and
 * command-ID space are hardware-confirmed, but the exact outgoing `flags`
 * byte for a route/POI write is inferred (see protocol_ble.c). Treat this
 * whole feature as experimental until verified on real hardware.
 */

private val NSP_SERVICE_UUID: UUID = UUID.fromString("98ae7120-e62e-11e3-badd-0002a5d5c51b")
private val NSP_WRITE_CHAR_UUID: UUID = UUID.fromString("c6339440-e62e-11e3-a5b3-0002a5d5c51b")  // phone -> watch
private val NSP_NOTIFY_CHAR_UUID: UUID = UUID.fromString("d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b")  // watch -> phone
private val GENERIC_ATTRIBUTE_SERVICE_UUID: UUID = UUID.fromString("00001801-0000-1000-8000-00805f9b34fb")
private val SERVICE_CHANGED_CHAR_UUID: UUID = UUID.fromString("00002a05-0000-1000-8000-00805f9b34fb")
private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

private const val SCAN_TIMEOUT_MS = 15_000L
/* Belt-and-suspenders alongside the service-UUID scan filter (which already
 * only matches this device family) and the Ambit3/Traverse USB PID table
 * this project already maintains — see AmbitUsbModule.kt's SUUNTO_PID_NAMES. */
private val COMPATIBLE_NAME_PREFIXES = listOf("Ambit3", "Traverse")
private const val BLE_PERMISSION_REQUEST_CODE = 4243

class AmbitBleModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // ─── Native (implemented in jni_bridge.cpp / protocol_ble.c) ─────────────
    private external fun nativeAmbitBleInit(vid: Int, pid: Int): Boolean
    private external fun nativeAmbitBleOnNotify(chunk: ByteArray)

    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private var notifyChar: BluetoothGattCharacteristic? = null
    private var connectPromise: Promise? = null
    private var didRediscoverAfterServiceChanged = false
    private var pendingPermissionPromise: Promise? = null

    // Serializes GATT operations — Android's BluetoothGatt does not support
    // overlapping calls (one write/read/descriptor-write must complete via its
    // callback before the next is issued).
    private val chunkQueueLock = Any()
    private val pendingChunks = ArrayDeque<ByteArray>()
    private var chunkInFlight = false
    // Continuation for the one setup-time descriptor write that needs to
    // block progress (the notify CCCD) — see writeDescriptorAsync's comment
    // for why this is continuation-based rather than a blocking wait.
    private var pendingDescriptorWriteContinuation: (() -> Unit)? = null

    override fun getName() = "AmbitBleModule"

    // ─── scanAndConnect() ──────────────────────────────────────────────────────
    // Scans for an advertising Ambit3/Traverse (filtered by the NSP service
    // UUID — see file header), connects to the first match, waits for a
    // correctly-discovered custom service (i.e. after Service Changed), then
    // resolves. From here on, nativeAmbitWriteRoute()/etc. on AmbitUsbModule
    // work exactly as they do over USB — they operate on the same shared
    // native g_device regardless of transport, see jni_bridge.cpp.
    @ReactMethod
    fun scanAndConnect(promise: Promise) {
        if (!hasBlePermissions()) {
            pendingPermissionPromise = promise
            requestBlePermissions()
            return
        }
        startScan(promise)
    }

    private fun startScan(promise: Promise) {
        val adapter = (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            promise.reject("BLUETOOTH_OFF", "Bluetooth is off or unavailable")
            return
        }
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            promise.reject("BLE_UNAVAILABLE", "BLE scanning unavailable on this device")
            return
        }

        connectPromise = promise
        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(NSP_SERVICE_UUID)).build()
        )
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val timeoutRunnable = Runnable {
            try { scanner.stopScan(scanCallback) } catch (_: SecurityException) {}
            connectPromise?.let {
                connectPromise = null
                it.reject("SCAN_TIMEOUT", "No Ambit3/Traverse found in range — trigger \"Sync now\" on the watch " +
                    "right before scanning, its advertising window is short")
            }
        }
        mainHandler.postDelayed(timeoutRunnable, SCAN_TIMEOUT_MS)

        try {
            scanner.startScan(filters, settings, object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    val name = result.device.name ?: result.scanRecord?.deviceName
                    val looksCompatible = name == null || COMPATIBLE_NAME_PREFIXES.any { name.startsWith(it) }
                    if (!looksCompatible) return // matched the service UUID but not the expected name — be conservative

                    mainHandler.removeCallbacks(timeoutRunnable)
                    try { scanner.stopScan(this) } catch (_: SecurityException) {}
                    connectToDevice(result.device)
                }

                override fun onScanFailed(errorCode: Int) {
                    mainHandler.removeCallbacks(timeoutRunnable)
                    connectPromise?.let {
                        connectPromise = null
                        it.reject("SCAN_FAILED", "BLE scan failed, code=$errorCode")
                    }
                }
            }.also { scanCallback = it })
        } catch (e: SecurityException) {
            mainHandler.removeCallbacks(timeoutRunnable)
            connectPromise = null
            promise.reject("PERMISSION_DENIED", e.message)
        }
    }

    private var scanCallback: ScanCallback? = null

    // Explicit pairing, requested directly (2026-08-06): rather than relying on
    // connectGatt() to trigger bonding implicitly as a side effect of the first
    // encrypted characteristic access (which is what happened in every nRF
    // Connect test so far), this pairs from AmbitApp itself as its own visible
    // step. Matters because the watch only holds ONE paired device at a time —
    // if it's currently paired with a phone (Suunto app), pairing from here
    // will most likely evict that pairing, the same single-slot behavior
    // already documented in HANDOFF.md's unpair procedure. The phone would
    // need to re-pair afterward to use Suunto app again.
    private var bondReceiver: BroadcastReceiver? = null

    // Reverted 2026-08-06, confirmed on hardware: an explicit createBond() call
    // before connecting hangs (PIN entry fires but pairing never completes,
    // watch keeps showing the passkey). The one run that actually worked on
    // real hardware — nRF Connect's plain "Connect" against a scan result —
    // never calls createBond() at all; it just opens a GATT connection and lets
    // bonding happen automatically as a side effect if the peripheral demands
    // encryption. Matching that exactly: just connect. The pairing-request
    // receiver stays registered regardless, since implicit bonding can still
    // raise the same PIN prompt — it's the explicit createBond() call that's
    // the problem, not PIN handling itself.
    private fun connectToDevice(device: BluetoothDevice) {
        didRediscoverAfterServiceChanged = false
        registerBondAndPairingReceiver(device)
        openGatt(device)
    }

    // Only handles the pairing PIN prompt now (see connectToDevice's comment on
    // why createBond() itself was removed) — does NOT drive the connection
    // sequencing anymore, openGatt() is already called unconditionally right
    // after this registers.
    private fun registerBondAndPairingReceiver(device: BluetoothDevice) {
        unregisterBondReceiver()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val target: BluetoothDevice? =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    else
                        @Suppress("DEPRECATION") intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                if (target?.address != device.address) return

                when (intent.action) {
                    BluetoothDevice.ACTION_BOND_STATE_CHANGED ->
                        when (intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE)) {
                            BluetoothDevice.BOND_BONDED -> unregisterBondReceiver() // nothing else to do, GATT connect is already underway
                            BluetoothDevice.BOND_NONE -> unregisterBondReceiver() // let the GATT-level failure (if any) surface its own error
                            // BOND_BONDING: still in progress, keep waiting
                        }

                    // Confirmed on hardware 2026-08-06: this device's default system
                    // Bluetooth pairing UI never appeared for the watch's PIN request
                    // (BlissOS, likely missing/non-functional standard Settings
                    // pairing-dialog component) — createBond() alone left the user
                    // with a PIN shown on the watch and no way to enter it. Handling
                    // ACTION_PAIRING_REQUEST directly and supplying our own UI works
                    // regardless of whether the system one exists.
                    BluetoothDevice.ACTION_PAIRING_REQUEST -> {
                        val variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, -1)
                        // PAIRING_VARIANT_PIN_16_DIGITS (7) and PAIRING_VARIANT_CONSENT (3) are
                        // real platform values (used by the Bluetooth stack at runtime) but not
                        // exposed as public named constants in the compileSdk 36 stubs — raw
                        // ints here, not a guess, just working around the missing symbol.
                        if (variant == BluetoothDevice.PAIRING_VARIANT_PIN || variant == 7) {
                            abortBroadcast() // take over from any (apparently absent) default handler
                            promptForPin(device)
                        } else if (variant == BluetoothDevice.PAIRING_VARIANT_PASSKEY_CONFIRMATION || variant == 3) {
                            abortBroadcast()
                            try { device.setPairingConfirmation(true) } catch (_: SecurityException) {}
                        }
                        // Other variants (display-only) need no input from us — leave
                        // the broadcast alone so the default handling can still show it.
                    }
                }
            }
        }
        bondReceiver = receiver
        val filter = IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED).apply {
            addAction(BluetoothDevice.ACTION_PAIRING_REQUEST)
            priority = IntentFilter.SYSTEM_HIGH_PRIORITY
        }
        // EXPORTED, confirmed necessary on real hardware 2026-08-06: NOT_EXPORTED
        // was the first attempt (reasoned as "more secure, system-only broadcasts
        // don't need it"), but that was wrong — Android auto-generates a synthetic
        // per-app permission for NOT_EXPORTED dynamic receivers that the SENDER must
        // hold, and com.android.bluetooth (the system Bluetooth process) doesn't
        // have it for an arbitrary third-party app. Real logcat showed every
        // BOND_STATE_CHANGED/PAIRING_REQUEST broadcast rejected with "Permission
        // Denial" as a result — this receiver never ran at all until this changed.
        ContextCompat.registerReceiver(reactContext, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
    }

    /** Native PIN-entry dialog — the watch displays a numeric PIN, the user
     * types the same digits here. See ACTION_PAIRING_REQUEST handling above
     * for why this exists instead of relying on the OS's own dialog. */
    private fun promptForPin(device: BluetoothDevice) {
        val activity = reactContext.currentActivity ?: return // no cancel-bond equivalent in the
        // public API — not supplying a PIN just lets the request time out / get rejected naturally
        mainHandler.post {
            val input = android.widget.EditText(activity).apply {
                inputType = android.text.InputType.TYPE_CLASS_NUMBER
                hint = "PIN"
            }
            android.app.AlertDialog.Builder(activity)
                .setTitle("Pair with watch")
                .setMessage("Enter the PIN shown on the watch's screen")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("OK") { _, _ ->
                    val pin = input.text.toString()
                    // BluetoothDevice.convertPinToBytes() (what Android's own default
                    // pairing dialog calls) turned out to be a hidden/system-only API, not
                    // usable here — but its real AOSP implementation is just UTF-8 encoding
                    // plus a 1-16 byte length check, so this is equivalent, not a downgrade.
                    val pinBytes = pin.toByteArray(Charsets.UTF_8)
                    if (pinBytes.isNotEmpty() && pinBytes.size <= 16) {
                        try { device.setPin(pinBytes) } catch (_: SecurityException) {}
                    }
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
    }

    private fun unregisterBondReceiver() {
        bondReceiver?.let {
            try { reactContext.unregisterReceiver(it) } catch (_: IllegalArgumentException) {} // already unregistered
        }
        bondReceiver = null
    }

    private fun openGatt(device: BluetoothDevice) {
        try {
            gatt = device.connectGatt(reactContext, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        } catch (e: SecurityException) {
            connectPromise?.let { connectPromise = null; it.reject("PERMISSION_DENIED", e.message) }
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try { g.discoverServices() } catch (e: SecurityException) {
                    failConnect("PERMISSION_DENIED", e.message)
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                writeChar = null
                notifyChar = null
                connectPromise?.let { connectPromise = null; it.reject("DISCONNECTED", "GATT disconnected, status=$status") }
            }
        }

        // API 31+ only — the platform tells us directly. Pre-31 relies on the
        // manual Service Changed characteristic subscription below instead.
        override fun onServiceChanged(g: BluetoothGatt) {
            didRediscoverAfterServiceChanged = false
            try { g.discoverServices() } catch (_: SecurityException) {}
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failConnect("DISCOVERY_FAILED", "onServicesDiscovered status=$status")
                return
            }

            val nspService = g.getService(NSP_SERVICE_UUID)
            if (nspService != null) {
                finishDiscovery(g, nspService)
                return
            }

            if (didRediscoverAfterServiceChanged) {
                // Already gave it a second, deliberate pass and still nothing —
                // genuinely not there this time, don't loop forever.
                failConnect("SERVICE_NOT_FOUND",
                    "Custom NSP service not found even after re-discovery — not an Ambit3/Traverse, or " +
                    "\"Sync now\"'s advertising window closed before discovery finished")
                return
            }

            // First pass came back without the custom service. Subscribe to the
            // standard Service Changed characteristic (belt-and-suspenders for
            // API < 31, and harmless if the CCCD was already enabled from a
            // prior bond) — see file header comment. Either that indication or
            // the plain timeout fallback below will trigger the re-discovery.
            subscribeToServiceChanged(g)
            mainHandler.postDelayed({
                if (!didRediscoverAfterServiceChanged) {
                    didRediscoverAfterServiceChanged = true
                    try { g.discoverServices() } catch (_: SecurityException) {}
                }
            }, 1200L)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            if (characteristic.uuid == SERVICE_CHANGED_CHAR_UUID) {
                if (!didRediscoverAfterServiceChanged) {
                    didRediscoverAfterServiceChanged = true
                    try { g.discoverServices() } catch (_: SecurityException) {}
                }
                return
            }
            if (characteristic.uuid == NSP_NOTIFY_CHAR_UUID) {
                nativeAmbitBleOnNotify(value)
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            // Not a blocking wait — GATT callbacks are all delivered on the same
            // internal thread, so a descriptor write that block-waited for this
            // callback here would deadlock against itself. See writeDescriptorAsync.
            val cont = pendingDescriptorWriteContinuation
            pendingDescriptorWriteContinuation = null
            cont?.invoke()
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            synchronized(chunkQueueLock) { chunkInFlight = false }
            drainPendingChunks()
        }
    }

    private fun subscribeToServiceChanged(g: BluetoothGatt) {
        val attrService = g.getService(GENERIC_ATTRIBUTE_SERVICE_UUID) ?: return
        val changedChar = attrService.getCharacteristic(SERVICE_CHANGED_CHAR_UUID) ?: return
        try {
            g.setCharacteristicNotification(changedChar, true)
            val cccd = changedChar.getDescriptor(CCCD_UUID) ?: return
            // Fire-and-forget: no continuation needed here, the postDelayed
            // fallback in onServicesDiscovered re-discovers regardless of
            // whether this particular write (or the indication it enables)
            // ever completes in time.
            writeDescriptorAsync(g, cccd, BluetoothGattDescriptor.ENABLE_INDICATION_VALUE, null)
        } catch (_: SecurityException) {
            // Not fatal — the timeout-based re-discovery fallback still covers this.
        }
    }

    private fun finishDiscovery(g: BluetoothGatt, nspService: android.bluetooth.BluetoothGattService) {
        val write = nspService.getCharacteristic(NSP_WRITE_CHAR_UUID)
        val notify = nspService.getCharacteristic(NSP_NOTIFY_CHAR_UUID)
        if (write == null || notify == null) {
            failConnect("CHARACTERISTIC_NOT_FOUND", "NSP service found but write/notify characteristic missing")
            return
        }
        writeChar = write
        notifyChar = notify

        try {
            g.setCharacteristicNotification(notify, true)
            val cccd = notify.getDescriptor(CCCD_UUID)
            if (cccd != null) {
                // Continuation-based, not blocking — proceeds to native init only
                // once onDescriptorWrite actually confirms the CCCD write, since
                // (unlike the Service Changed subscription above) this one really
                // does need to have taken effect before we start issuing commands.
                writeDescriptorAsync(g, cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) {
                    proceedToNativeInit(g)
                }
            } else {
                proceedToNativeInit(g)
            }
        } catch (e: SecurityException) {
            failConnect("PERMISSION_DENIED", e.message)
        }
    }

    private fun proceedToNativeInit(g: BluetoothGatt) {
        val device = g.device
        executor.execute {
            val ok = nativeAmbitBleInit(SUUNTO_VID, guessProductId(device.name))
            mainHandler.post {
                connectPromise?.let {
                    connectPromise = null
                    if (ok) it.resolve(true)
                    else it.reject("BLE_INIT_FAILED",
                        "Connected and found the watch's BLE service, but device-info readback failed — " +
                        "see logcat tag AmbitProtocolBle. Refusing to proceed without a confirmed firmware generation.")
                }
            }
        }
    }

    /** VID is always Suunto's; PID only matters for driver_support lookup, and
     * that table keys off the *name* string match already done by the scan
     * filter for anything BLE-relevant (Ambit3/Traverse) — a fixed representative
     * PID is enough here, unlike over USB where the real enumerated PID matters. */
    private fun guessProductId(name: String?): Int = when {
        name?.startsWith("Traverse Alpha") == true -> 0x002d
        name?.startsWith("Traverse") == true -> 0x002b
        else -> 0x001c // Ambit3 Sport — any Ambit3 variant shares device_driver_ambit3.c
    }

    private fun failConnect(code: String, message: String?) {
        mainHandler.post {
            connectPromise?.let { connectPromise = null; it.reject(code, message) }
        }
        try { gatt?.disconnect() } catch (_: SecurityException) {}
    }

    /**
     * Issues a descriptor write and returns immediately — does NOT block.
     * GATT callbacks (including onDescriptorWrite) are all delivered on the
     * same internal thread, so blocking here while waiting for that same
     * callback would deadlock against itself (this project hit exactly that
     * design trap once already while drafting this file — worth the comment).
     * If `onWritten` is non-null, it runs from onDescriptorWrite once this
     * specific write completes; pass null for genuine fire-and-forget.
     */
    private fun writeDescriptorAsync(g: BluetoothGatt, descriptor: BluetoothGattDescriptor,
                                      value: ByteArray, onWritten: (() -> Unit)?) {
        pendingDescriptorWriteContinuation = onWritten
        val written =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeDescriptor(descriptor, value) == BluetoothStatusCodesSuccess
            } else {
                @Suppress("DEPRECATION")
                descriptor.value = value
                @Suppress("DEPRECATION")
                g.writeDescriptor(descriptor)
            }
        if (!written) {
            pendingDescriptorWriteContinuation = null
            onWritten?.invoke() // best effort — proceed anyway rather than hang the connect flow
        }
    }

    // ─── bleWriteChunk() ─────────────────────────────────────────────────────
    // Called from native code (protocol_ble.c, via JNI) with one already-
    // framed <=20-byte piece of an outgoing NSP message. Queued and drained
    // one at a time — see chunkQueueLock comment above for why.
    @Suppress("unused") // called from protocol_ble.c via JNI, not from Kotlin
    fun bleWriteChunk(chunk: ByteArray) {
        synchronized(chunkQueueLock) {
            pendingChunks.addLast(chunk)
        }
        drainPendingChunks()
    }

    private fun drainPendingChunks() {
        val g = gatt ?: return
        val ch = writeChar ?: return
        val chunk: ByteArray
        synchronized(chunkQueueLock) {
            if (chunkInFlight || pendingChunks.isEmpty()) return
            chunk = pendingChunks.removeFirst()
            chunkInFlight = true
        }
        try {
            // WRITE_TYPE_NO_RESPONSE matches what the real capture showed the
            // Suunto app using for this traffic (ATT opcode 0x52, Write Command).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeCharacteristic(ch, chunk, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE)
            } else {
                @Suppress("DEPRECATION")
                ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                @Suppress("DEPRECATION")
                ch.value = chunk
                @Suppress("DEPRECATION")
                g.writeCharacteristic(ch)
            }
        } catch (e: SecurityException) {
            synchronized(chunkQueueLock) { chunkInFlight = false }
        }
    }

    @ReactMethod
    fun disconnectBle(promise: Promise) {
        unregisterBondReceiver()
        try { gatt?.disconnect(); gatt?.close() } catch (_: SecurityException) {}
        gatt = null
        writeChar = null
        notifyChar = null
        promise.resolve(true)
    }

    // ─── Permissions ─────────────────────────────────────────────────────────

    private fun hasBlePermissions(): Boolean {
        val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        return perms.all { ContextCompat.checkSelfPermission(reactContext, it) == PackageManager.PERMISSION_GRANTED }
    }

    private fun requestBlePermissions() {
        val activity = reactContext.currentActivity as? PermissionAwareActivity
        if (activity == null) {
            pendingPermissionPromise?.let { pendingPermissionPromise = null; it.reject("NO_ACTIVITY", "No active activity") }
            return
        }
        val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        activity.requestPermissions(perms, BLE_PERMISSION_REQUEST_CODE, object : PermissionListener {
            override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, results: IntArray): Boolean {
                if (requestCode != BLE_PERMISSION_REQUEST_CODE) return false
                val granted = results.isNotEmpty() && results.all { it == PackageManager.PERMISSION_GRANTED }
                val promise = pendingPermissionPromise
                pendingPermissionPromise = null
                if (granted && promise != null) {
                    startScan(promise)
                } else {
                    promise?.reject("PERMISSION_DENIED", "Bluetooth permission was not granted")
                }
                return true
            }
        })
    }

    companion object {
        private const val SUUNTO_VID = 0x1493
        // BluetoothStatusCodes.SUCCESS is API 33+; writeDescriptor's 3-arg overload
        // (API 33+) returns an Int status code where 0 == success, matching this.
        private const val BluetoothStatusCodesSuccess = 0
    }
}
