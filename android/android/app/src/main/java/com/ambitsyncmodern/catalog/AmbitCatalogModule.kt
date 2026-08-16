package com.ambitsyncmodern.catalog

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.JsonReader
import android.util.JsonToken
import com.facebook.react.bridge.*
import java.io.BufferedOutputStream
import java.io.File
import java.io.InputStreamReader

/*
 * EXPERIMENTAL - App-Zone catalog import (2026-08-14). We ship NONE of Suunto's app catalog
 * (it's their proprietary content, and the App Zone / Movescount service is dead so there's no
 * live source anyway). Instead the user imports their OWN SuuntoLink 'suunto-apps/index.json'
 * (Windows/Mac; on Linux/Android they copy it over) - each user supplies the catalog they
 * already hold a licensed copy of.
 *
 * index.json is ~29 MB - a top-level JSON array of app objects, each with ruleId/name/
 * categoryId/activityId/description/compatibleVariants and a `binary` field that is a JSON
 * array of byte values (the compiled bytecode). Parsing 29 MB of JSON in JS risks OOM, so this
 * does it NATIVELY with a streaming android.util.JsonReader and writes the same compact split
 * tools/extract_apps_catalog.py produces:
 *   <filesDir>/appzone/catalog.json  metadata + binaryOffset/binaryLength per entry
 *   <filesDir>/appzone/catalog.bin   every app's bytecode, back to back
 * TS then reads catalog.json (a few MB, fine) and slices catalog.bin by offset/length.
 */
class AmbitCatalogModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    init { reactContext.addActivityEventListener(this) }
    override fun getName() = "AmbitCatalog"

    private var pendingPromise: Promise? = null
    private var pendingFilePromise: Promise? = null
    private val REQUEST_PICK = 7231
    private val REQUEST_PICK_FILE = 7232

    private fun outDir(): File = File(reactContext.filesDir, "appzone").apply { mkdirs() }

    /** True once a catalog has been imported (both files present). */
    @ReactMethod
    fun hasCatalog(promise: Promise) {
        val dir = outDir()
        promise.resolve(File(dir, "catalog.json").exists() && File(dir, "catalog.bin").exists())
    }

    @ReactMethod
    fun catalogPath(promise: Promise) {
        promise.resolve(File(outDir(), "catalog.json").absolutePath)
    }

    @ReactMethod
    fun binPath(promise: Promise) {
        promise.resolve(File(outDir(), "catalog.bin").absolutePath)
    }

    /** Launch the system file picker for the SuuntoLink index.json, then stream-extract it.
     *  Resolves { count, bytes } on success. */
    @ReactMethod
    fun importIndex(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) { promise.reject("NO_ACTIVITY", "No active activity"); return }
        if (pendingPromise != null) { promise.reject("BUSY", "An import is already in progress"); return }
        pendingPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"  // index.json's picked MIME varies; filter by name in the parser
        }
        try {
            activity.startActivityForResult(Intent.createChooser(intent, "Select SuuntoLink index.json"), REQUEST_PICK)
        } catch (e: Exception) {
            pendingPromise = null
            promise.reject("PICK_FAILED", e.message ?: "Could not open the file picker")
        }
    }

    // Pick a small file (e.g. a compiled interval app downloaded from the compiler site) and
    // return its raw contents base64 + filename. Small files only (a compiled app is a few KB).
    @ReactMethod
    fun pickFile(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) { promise.reject("NO_ACTIVITY", "No active activity"); return }
        if (pendingFilePromise != null) { promise.reject("BUSY", "A file pick is already in progress"); return }
        pendingFilePromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
        }
        try {
            activity.startActivityForResult(Intent.createChooser(intent, "Select compiled app"), REQUEST_PICK_FILE)
        } catch (e: Exception) {
            pendingFilePromise = null
            promise.reject("PICK_FAILED", e.message ?: "Could not open the file picker")
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_PICK) {
            val promise = pendingPromise ?: return
            pendingPromise = null
            if (resultCode != Activity.RESULT_OK || data?.data == null) { promise.reject("CANCELLED", "No file selected"); return }
            Thread {
                try { promise.resolve(extract(data.data!!)) }
                catch (e: Exception) { promise.reject("IMPORT_FAILED", e.message ?: "Could not read index.json") }
            }.start()
            return
        }
        if (requestCode == REQUEST_PICK_FILE) {
            val promise = pendingFilePromise ?: return
            pendingFilePromise = null
            if (resultCode != Activity.RESULT_OK || data?.data == null) { promise.reject("CANCELLED", "No file selected"); return }
            Thread {
                try {
                    val uri = data.data!!
                    val bytes = reactContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("Could not open the selected file")
                    val map = Arguments.createMap().apply {
                        putString("base64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
                        putString("name", uri.lastPathSegment ?: "app")
                    }
                    promise.resolve(map)
                } catch (e: Exception) {
                    promise.reject("PICK_FAILED", e.message ?: "Could not read the file")
                }
            }.start()
            return
        }
    }

    override fun onNewIntent(intent: Intent) {}

    private fun extract(uri: Uri): WritableMap {
        val dir = outDir()
        val jsonFile = File(dir, "catalog.json")
        val binFile = File(dir, "catalog.bin")

        val input = reactContext.contentResolver.openInputStream(uri)
            ?: throw IllegalStateException("Could not open the selected file")

        var count = 0
        var offset = 0L
        val meta = StringBuilder(1 shl 20)
        meta.append("{\"entries\":[")

        BufferedOutputStream(binFile.outputStream()).use { bin ->
            JsonReader(InputStreamReader(input, Charsets.UTF_8)).use { reader ->
                reader.beginArray()
                while (reader.hasNext()) {
                    reader.beginObject()
                    var ruleId = 0L; var name = ""; var categoryId = 0; var activityId = 0
                    var description = ""
                    val variants = ArrayList<String>()
                    var binLen = 0
                    val entryStart = offset
                    while (reader.hasNext()) {
                        when (reader.nextName()) {
                            "ruleId" -> ruleId = reader.nextLong()
                            "name" -> name = reader.nextString()
                            "categoryId" -> categoryId = reader.nextInt()
                            "activityId" -> activityId = reader.nextInt()
                            "description" -> description = if (reader.peek() == JsonToken.NULL) { reader.nextNull(); "" } else reader.nextString()
                            "compatibleVariants" -> {
                                reader.beginArray(); while (reader.hasNext()) variants.add(reader.nextString()); reader.endArray()
                            }
                            "binary" -> {
                                reader.beginArray()
                                while (reader.hasNext()) { bin.write(reader.nextInt() and 0xFF); binLen++ }
                                reader.endArray()
                            }
                            else -> reader.skipValue()
                        }
                    }
                    reader.endObject()
                    offset += binLen
                    if (count > 0) meta.append(',')
                    meta.append("{\"ruleId\":").append(ruleId)
                        .append(",\"name\":").append(jsonString(name))
                        .append(",\"categoryId\":").append(categoryId)
                        .append(",\"activityId\":").append(activityId)
                        .append(",\"description\":").append(jsonString(description))
                        .append(",\"compatibleVariants\":[")
                    for ((i, v) in variants.withIndex()) { if (i > 0) meta.append(','); meta.append(jsonString(v)) }
                    meta.append("],\"binaryOffset\":").append(entryStart)
                        .append(",\"binaryLength\":").append(binLen).append('}')
                    count++
                }
                reader.endArray()
            }
        }
        meta.append("]}")
        jsonFile.writeText(meta.toString(), Charsets.UTF_8)

        return Arguments.createMap().apply {
            putInt("count", count)
            putDouble("bytes", offset.toDouble())
        }
    }

    // Minimal JSON string escaping for the metadata we write (names/descriptions can carry
    // quotes, backslashes, control chars).
    private fun jsonString(s: String): String {
        val sb = StringBuilder(s.length + 2)
        sb.append('"')
        for (c in s) when (c) {
            '"' -> sb.append("\\\"")
            '\\' -> sb.append("\\\\")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> if (c < ' ') sb.append("\\u%04x".format(c.code)) else sb.append(c)
        }
        sb.append('"')
        return sb.toString()
    }
}
