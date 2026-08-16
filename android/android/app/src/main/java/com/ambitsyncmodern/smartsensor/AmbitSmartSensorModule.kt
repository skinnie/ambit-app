package com.ambitsyncmodern.smartsensor

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import java.util.ArrayDeque
import java.util.UUID

/*
 * EXPERIMENTAL - Suunto Smart Sensor (the old Ambit-era HR belt). This is a SEPARATE BLE
 * peripheral, nothing to do with the watch or the USB cable - plain standard GATT, exactly
 * as tools/smart_sensor.py and the desktop smartsensorservice read it:
 *   Device Information (0x180A): manufacturer 2A29, model 2A24, serial 2A25, hw 2A27,
 *                                fw 2A26, sw 2A28
 *   Battery            (0x180F): level 2A19
 *   Heart Rate         (0x180D): measurement 2A37 (notify), enabled via the 0x2902 CCCD
 * Read-only aside from forget() (which just drops the OS bond) - it cannot brick anything.
 *
 * scan() connects, reads every readable identity/battery characteristic, subscribes to HR
 * for a few seconds to grab one live reading (belt not worn = no reading = -1, the expected
 * common case, not an error), then resolves one map and disconnects. Mirrors the desktop
 * SmartSensorService.status shape 1:1 so the TS side (SmartSensorService.ts) needs no
 * per-platform mapping.
 */
class AmbitSmartSensorModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AmbitSmartSensor"

    private val mainHandler = Handler(Looper.getMainLooper())
    private var scanCallback: ScanCallback? = null
    private var gatt: BluetoothGatt? = null
    private var pendingPromise: Promise? = null
    private var pendingPermissionPromise: Promise? = null
    private var resolved = false
    private var lastDevice: BluetoothDevice? = null

    // Collected characteristic values, keyed by the JS field name they map to.
    private val collected = HashMap<String, String>()
    private var batteryPercent = -1
    private var heartRateBpm = -1

    // The read queue: (characteristic, jsKey) pairs read one at a time (Android GATT allows
    // exactly one outstanding operation).
    private val readQueue = ArrayDeque<Pair<BluetoothGattCharacteristic, String>>()

    companion object {
        private const val TAG = "AmbitSmartSensor"
        private const val SCAN_TIMEOUT_MS = 12_000L
        private const val HR_WAIT_MS = 5_000L
        private const val PERMISSION_REQUEST_CODE = 4245

        private val DIS_SERVICE = uuid16("180A")
        private val BATTERY_SERVICE = uuid16("180F")
        private val HR_SERVICE = uuid16("180D")
        private val BATTERY_LEVEL = uuid16("2A19")
        private val HR_MEASUREMENT = uuid16("2A37")
        private val CCCD = uuid16("2902")
        // Device Information characteristic -> JS field name.
        private val DIS_FIELDS = linkedMapOf(
            uuid16("2A29") to "manufacturer",
            uuid16("2A24") to "model",
            uuid16("2A25") to "serial",
            uuid16("2A27") to "hwRevision",
            uuid16("2A26") to "fwRevision",
            uuid16("2A28") to "swRevision",
        )
        private val NAME_PREFIXES = listOf("Suunto Smart", "Smart Sensor", "BlueBelt", "Suunto")

        private fun uuid16(short: String): UUID =
            UUID.fromString("0000$short-0000-1000-8000-00805f9b34fb")
    }

    // ─── scan() ───────────────────────────────────────────────────────────────
    @ReactMethod
    fun scan(promise: Promise) {
        if (pendingPromise != null) { promise.reject("BUSY", "A scan is already in progress"); return }
        if (!hasPermissions()) { pendingPermissionPromise = promise; requestPermissions(); return }
        startScan(promise)
    }

    private fun startScan(promise: Promise) {
        val adapter = (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) { promise.reject("BLUETOOTH_OFF", "Bluetooth is off or unavailable"); return }
        val scanner = adapter.bluetoothLeScanner
            ?: run { promise.reject("BLE_UNAVAILABLE", "BLE scanning unavailable on this device"); return }

        pendingPromise = promise
        resolved = false
        collected.clear(); batteryPercent = -1; heartRateBpm = -1; readQueue.clear()

        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        val timeout = Runnable {
            try { scanner.stopScan(scanCallback) } catch (_: SecurityException) {}
            // No belt found: resolve found=false rather than reject - the UI treats that as a
            // normal "put it on and retry", not an error.
            finishNotFound()
        }
        mainHandler.postDelayed(timeout, SCAN_TIMEOUT_MS)

        try {
            // Unfiltered scan + match in the callback (same reasoning as AmbitBleModule: some
            // peripherals only surface the service UUID inconsistently). Match on the HR
            // service UUID advertised, or a known Suunto name prefix.
            scanner.startScan(null, settings, object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    val record = result.scanRecord
                    val advertisesHr = record?.serviceUuids?.any { it.uuid == HR_SERVICE } == true
                    val name = result.device.name ?: record?.deviceName
                    val nameMatches = name != null && NAME_PREFIXES.any { name.startsWith(it) }
                    if (!advertisesHr && !nameMatches) return
                    Log.d(TAG, "match: name=$name addr=${result.device.address}")
                    mainHandler.removeCallbacks(timeout)
                    try { scanner.stopScan(this) } catch (_: SecurityException) {}
                    connect(result.device)
                }
                override fun onScanFailed(errorCode: Int) {
                    mainHandler.removeCallbacks(timeout)
                    rejectOnce("SCAN_FAILED", "BLE scan failed, code=$errorCode")
                }
            }.also { scanCallback = it })
        } catch (e: SecurityException) {
            mainHandler.removeCallbacks(timeout)
            rejectOnce("PERMISSION_DENIED", e.message ?: "Bluetooth permission denied")
        }
    }

    // ─── connect + GATT read ────────────────────────────────────────────────────
    private fun connect(device: BluetoothDevice) {
        lastDevice = device
        try {
            gatt = device.connectGatt(reactContext, false, gattCallback)
        } catch (e: SecurityException) {
            rejectOnce("PERMISSION_DENIED", e.message ?: "Bluetooth connect permission denied")
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try { g.discoverServices() } catch (_: SecurityException) {}
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                // If we disconnected before resolving, report what we have (identity may still
                // be complete even if the belt dropped before an HR reading).
                if (!resolved) finishSuccess()
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            // Queue every readable identity/battery characteristic that exists on this belt.
            g.getService(DIS_SERVICE)?.let { svc ->
                for ((cuuid, key) in DIS_FIELDS) svc.getCharacteristic(cuuid)?.let { readQueue.add(it to key) }
            }
            g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let { readQueue.add(it to "battery") }
            readNext(g)
        }

        override fun onCharacteristicRead(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) storeRead(ch)
            readNext(g)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
            if (ch.uuid == HR_MEASUREMENT) {
                heartRateBpm = parseHeartRate(ch.value)
                // One good reading is enough - stop waiting and resolve.
                mainHandler.removeCallbacksAndMessages(null)
                finishSuccess()
            }
        }
    }

    private fun readNext(g: BluetoothGatt) {
        val next = readQueue.poll()
        if (next != null) {
            try { g.readCharacteristic(next.first) } catch (_: SecurityException) { readNext(g) }
            return
        }
        // Identity + battery done. Try for a live HR reading, then resolve regardless.
        val hr = g.getService(HR_SERVICE)?.getCharacteristic(HR_MEASUREMENT)
        if (hr != null) {
            try {
                g.setCharacteristicNotification(hr, true)
                hr.getDescriptor(CCCD)?.let {
                    it.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    g.writeDescriptor(it)
                }
                mainHandler.postDelayed({ if (!resolved) finishSuccess() }, HR_WAIT_MS)
            } catch (_: SecurityException) { finishSuccess() }
        } else {
            finishSuccess()
        }
    }

    private fun storeRead(ch: BluetoothGattCharacteristic) {
        if (ch.uuid == BATTERY_LEVEL) {
            batteryPercent = ch.value?.firstOrNull()?.toInt()?.and(0xFF) ?: -1
        } else {
            DIS_FIELDS[ch.uuid]?.let { key -> collected[key] = ch.value?.toString(Charsets.UTF_8)?.trim { it <= ' ' || it == ' ' } ?: "" }
        }
    }

    private fun parseHeartRate(value: ByteArray?): Int {
        if (value == null || value.isEmpty()) return -1
        val flags = value[0].toInt()
        return if (flags and 0x01 == 0) {
            if (value.size >= 2) value[1].toInt() and 0xFF else -1
        } else {
            if (value.size >= 3) (value[1].toInt() and 0xFF) or ((value[2].toInt() and 0xFF) shl 8) else -1
        }
    }

    // ─── resolve / cleanup ──────────────────────────────────────────────────────
    private fun finishSuccess() {
        if (resolved) return
        resolved = true
        closeGatt()
        val map = Arguments.createMap().apply {
            putBoolean("found", true)
            for ((k, v) in collected) putString(k, v)
            putInt("batteryPercent", batteryPercent)
            putInt("heartRateBpm", heartRateBpm)
        }
        pendingPromise?.resolve(map)
        pendingPromise = null
    }

    private fun finishNotFound() {
        if (resolved) return
        resolved = true
        val map = Arguments.createMap().apply { putBoolean("found", false) }
        pendingPromise?.resolve(map)
        pendingPromise = null
    }

    private fun rejectOnce(code: String, message: String?) {
        if (resolved) return
        resolved = true
        closeGatt()
        pendingPromise?.reject(code, message ?: "Error")
        pendingPromise = null
    }

    private fun closeGatt() {
        try { gatt?.disconnect(); gatt?.close() } catch (_: SecurityException) {}
        gatt = null
    }

    // ─── forget(): drop the OS bond so Pair can be exercised again ───────────────
    @ReactMethod
    fun forget(promise: Promise) {
        val device = lastDevice
        if (device == null) { promise.resolve(false); return }
        try {
            val ok = device.javaClass.getMethod("removeBond").invoke(device) as? Boolean ?: false
            promise.resolve(ok)
        } catch (e: Exception) {
            promise.reject("FORGET_FAILED", e.message ?: "Could not remove bond")
        }
    }

    // ─── permissions (same set/flow as AmbitBleModule) ───────────────────────────
    private fun hasPermissions(): Boolean {
        val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        return perms.all { ContextCompat.checkSelfPermission(reactContext, it) == PackageManager.PERMISSION_GRANTED }
    }

    private fun requestPermissions() {
        val activity = reactContext.currentActivity as? PermissionAwareActivity
        if (activity == null) {
            pendingPermissionPromise?.let { pendingPermissionPromise = null; it.reject("NO_ACTIVITY", "No active activity") }
            return
        }
        val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        activity.requestPermissions(perms, PERMISSION_REQUEST_CODE, object : PermissionListener {
            override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, results: IntArray): Boolean {
                if (requestCode != PERMISSION_REQUEST_CODE) return false
                val granted = results.isNotEmpty() && results.all { it == PackageManager.PERMISSION_GRANTED }
                val promise = pendingPermissionPromise
                pendingPermissionPromise = null
                if (granted && promise != null) startScan(promise)
                else promise?.reject("PERMISSION_DENIED", "Bluetooth permission was not granted")
                return true
            }
        })
    }
}
