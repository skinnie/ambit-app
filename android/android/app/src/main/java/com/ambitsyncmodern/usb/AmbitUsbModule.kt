package com.ambitsyncmodern.usb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

private const val SUUNTO_VID = 0x1493

// PIDs Suunto connus (source : openambit/src/libambit/device_support.c)
private val SUUNTO_KNOWN_PIDS = setOf(
    0x0010, // Suunto Ambit (Ambit 1) — codename Bluebird
    0x0019, // Suunto Ambit2       — codename Duck
    0x001a, // Suunto Ambit2 S     — codename Colibri
    0x001b, // Suunto Ambit3 Peak  — codename Emu
    0x001c, // Suunto Ambit3 Sport — codename Finch
    0x001d, // Suunto Ambit2 R     — codename Greentit
    0x001e, // Suunto Ambit3 Run   — codename Ibisbill
    0x002b, // Suunto Traverse     — codename Jabiru
    0x002c, // Suunto Ambit3 Vertical — codename Kaka
    0x002d, // Suunto Traverse Alpha  — codename Loon
)

private const val ACTION_USB_PERMISSION = "com.ambitsyncmodern.USB_PERMISSION"

class AmbitUsbModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        // jni_bridge.cpp est compilé dans libappmodules.so (chargé automatiquement
        // par SoLoader pour la New Architecture). Les fonctions JNI sont toujours
        // disponibles ; nativeAmbitInit() retourne false tant que libambit n'est pas intégré.
        const val jniLoaded: Boolean = true
    }

    // ─── Fonctions JNI (implémentées dans jni_bridge.cpp) ────────────────────
    private external fun nativeAmbitInit(fd: Int, epIn: Int, epOut: Int, vid: Int, pid: Int): Boolean
    private external fun nativeAmbitGetLogCount(knownDates: Array<String>): Int
    private external fun nativeAmbitGetLogAsGpx(index: Int): String?
    private external fun nativeAmbitSendSgee(data: ByteArray): Boolean
    private external fun nativeAmbitDisconnect()

    // ─── État interne ─────────────────────────────────────────────────────────
    private var currentDevice: UsbDevice? = null
    private var pendingConnectPromise: Promise? = null
    private val executor = Executors.newSingleThreadExecutor()

    private val usbPermissionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACTION_USB_PERMISSION) return
            try { reactContext.unregisterReceiver(this) } catch (_: Exception) {}
            val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            }
            val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
            val promise = pendingConnectPromise ?: return
            pendingConnectPromise = null

            if (!granted || device == null) {
                promise.reject("USB_PERMISSION_DENIED", "Permission USB refusée par l'utilisateur")
                return
            }
            openDeviceAndInit(device, promise)
        }
    }

    override fun getName() = "AmbitUsbModule"

    // ─── connect() ────────────────────────────────────────────────────────────
    // Détecte l'Ambit, demande la permission USB, initialise la connexion JNI.
    @ReactMethod
    fun connect(promise: Promise) {
        if (!jniLoaded) {
            promise.reject("JNI_NOT_LOADED", "Bibliothèque native non disponible (libambit non intégrée)")
            return
        }
        val usbManager = reactContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val ambit = usbManager.deviceList.values.find { device ->
            device.vendorId == SUUNTO_VID && device.productId in SUUNTO_KNOWN_PIDS
        }
        if (ambit == null) {
            promise.reject("AMBIT_NOT_FOUND", "Aucune montre Suunto détectée. Vérifiez le câble USB OTG.")
            return
        }
        currentDevice = ambit

        if (usbManager.hasPermission(ambit)) {
            openDeviceAndInit(ambit, promise)
            return
        }

        // Demander la permission à l'utilisateur
        pendingConnectPromise = promise
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            PendingIntent.FLAG_MUTABLE else 0
        val permissionIntent = PendingIntent.getBroadcast(
            reactContext, 0, Intent(ACTION_USB_PERMISSION), flags
        )
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(usbPermissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            reactContext.registerReceiver(usbPermissionReceiver, filter)
        }
        usbManager.requestPermission(ambit, permissionIntent)
    }

    private fun openDeviceAndInit(device: UsbDevice, promise: Promise) {
        val usbManager = reactContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val connection = usbManager.openDevice(device)
        if (connection == null) {
            promise.reject("USB_OPEN_FAILED", "Impossible d'ouvrir la connexion USB")
            return
        }

        // Trouver l'interface HID (interface 0) et ses endpoints
        val iface = device.getInterface(0)
        connection.claimInterface(iface, true)

        var epIn  = -1
        var epOut = -1
        for (i in 0 until iface.endpointCount) {
            val ep = iface.getEndpoint(i)
            val isInterruptOrBulk = ep.type == UsbConstants.USB_ENDPOINT_XFER_INT ||
                                    ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK
            if (!isInterruptOrBulk) continue
            if (ep.direction == UsbConstants.USB_DIR_IN && epIn  == -1) epIn  = ep.address
            if (ep.direction == UsbConstants.USB_DIR_OUT && epOut == -1) epOut = ep.address
        }

        if (epIn == -1) {
            connection.close()
            promise.reject("USB_NO_ENDPOINT", "Aucun endpoint USB IN trouvé sur l'interface 0")
            return
        }

        val fd  = connection.fileDescriptor
        val vid = device.vendorId
        val pid = device.productId

        val ok = nativeAmbitInit(fd, epIn, epOut, vid, pid)
        if (!ok) {
            connection.close()
            promise.reject("AMBIT_INIT_FAILED", "Échec de l'initialisation libambit (VID=0x${vid.toString(16)} PID=0x${pid.toString(16)})")
            return
        }

        val deviceName = device.productName ?: "Suunto (0x${pid.toString(16)})"
        val info = Arguments.createMap().apply {
            putString("name", deviceName)
            putInt("vendorId", vid)
            putInt("productId", pid)
        }
        promise.resolve(info)
    }

    // ─── getLogs() ────────────────────────────────────────────────────────────
    // Retourne un tableau de strings GPX (un par log).
    // Exécuté sur un thread dédié car nativeAmbitGetLogCount() peut bloquer
    // plusieurs minutes lors de la lecture des logs depuis la montre.
    @ReactMethod
    fun getLogs(knownIds: ReadableArray, promise: Promise) {
        if (!jniLoaded) {
            promise.reject("JNI_NOT_LOADED", "Bibliothèque native non disponible")
            return
        }
        val knownDates = Array(knownIds.size()) { i -> knownIds.getString(i) ?: "" }
        executor.execute {
            val count = nativeAmbitGetLogCount(knownDates)
            if (count < 0) {
                promise.reject("NOT_CONNECTED", "Montre non connectée ou non initialisée")
                return@execute
            }
            val results = Arguments.createArray()
            for (i in 0 until count) {
                val gpx = nativeAmbitGetLogAsGpx(i)
                if (gpx != null) results.pushString(gpx)
                emitProgress(i + 1, count)
            }
            promise.resolve(results)
        }
    }

    // ─── updateSgee() ─────────────────────────────────────────────────────────
    // path : chemin absolu du fichier SGEE téléchargé sur le téléphone
    @ReactMethod
    fun updateSgee(path: String, promise: Promise) {
        if (!jniLoaded) {
            promise.reject("JNI_NOT_LOADED", "Bibliothèque native non disponible")
            return
        }
        executor.execute {
            val file = java.io.File(path)
            if (!file.exists()) {
                promise.reject("SGEE_FILE_NOT_FOUND", "Fichier SGEE introuvable : $path")
                return@execute
            }
            val data = file.readBytes()
            val ok = nativeAmbitSendSgee(data)
            if (ok) promise.resolve(true)
            else promise.reject("SGEE_SEND_FAILED", "Échec de l'envoi des données SGEE")
        }
    }

    // ─── shareFile() ──────────────────────────────────────────────────────────
    // Partage un fichier local vers d'autres apps via le share sheet Android.
    // Utilise FileProvider pour générer une URI content:// (requis Android 7+).
    @ReactMethod
    fun shareFile(filePath: String, mimeType: String, promise: Promise) {
        try {
            val file = java.io.File(filePath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "Fichier introuvable : $filePath")
                return
            }
            val uri = androidx.core.content.FileProvider.getUriForFile(
                reactApplicationContext,
                "${reactApplicationContext.packageName}.fileprovider",
                file
            )
            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = android.content.Intent.createChooser(intent, "Partager GPX")
            chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(chooser)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SHARE_ERROR", e.message ?: "Erreur inconnue")
        }
    }

    // ─── saveToDownloads() ────────────────────────────────────────────────────
    // Copie le fichier dans le dossier Téléchargements du téléphone.
    // API 29+ : MediaStore (aucune permission requise).
    // API 28  : copie directe (WRITE_EXTERNAL_STORAGE requis).
    @ReactMethod
    fun saveToDownloads(filePath: String, fileName: String, mimeType: String, promise: Promise) {
        try {
            val file = java.io.File(filePath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "Fichier introuvable : $filePath")
                return
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Downloads.DISPLAY_NAME, fileName)
                    put(android.provider.MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = reactApplicationContext.contentResolver
                val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw Exception("Impossible de créer l'entrée MediaStore")
                resolver.openOutputStream(uri)?.use { os -> file.inputStream().copyTo(os) }
                values.clear()
                values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                val downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DOWNLOADS
                )
                downloadsDir.mkdirs()
                file.copyTo(java.io.File(downloadsDir, fileName), overwrite = true)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SAVE_ERROR", e.message ?: "Erreur inconnue")
        }
    }

    // ─── disconnect() ─────────────────────────────────────────────────────────
    @ReactMethod
    fun disconnect(promise: Promise) {
        if (jniLoaded) nativeAmbitDisconnect()
        currentDevice = null
        promise.resolve(true)
    }

    // ─── Événements de progression vers React Native ──────────────────────────
    private fun emitProgress(current: Int, total: Int) {
        val params = Arguments.createMap().apply {
            putInt("current", current)
            putInt("total", total)
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("AmbitSyncProgress", params)
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        try { reactContext.unregisterReceiver(usbPermissionReceiver) } catch (_: Exception) {}
        executor.execute { if (jniLoaded) nativeAmbitDisconnect() }
        executor.shutdown()
    }
}
