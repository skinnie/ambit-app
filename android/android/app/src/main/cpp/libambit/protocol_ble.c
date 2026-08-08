/*
 * BLE-specific NSP framing for Ambit3/Traverse.
 *
 * USB and BLE do NOT share wire framing (protocol.c's ambit_msg_header_t /
 * 64-byte-report scheme is USB-only) — they only share the command-ID space.
 * This file implements the BLE envelope, reverse-engineered from a real HCI
 * snoop capture of a working Suunto-app BLE sync, 2026-08-06 (see
 * HANDOFF.md, Milestone 7). Confirmed against that capture:
 *
 *   0x7e [12-byte header][payload, dataSize bytes][CRC32(header+payload), LE]0x7e
 *
 * header = [u8 msgId][u8 subId][u8 flags][u8 errFlags][u16 connId][u16 pktNum][u32 dataSize]
 * (msgId/subId together are the same 16-bit "command" protocol.h already
 * defines for USB, just split into two bytes: command = (msgId<<8)|subId).
 *
 * The envelope is chunked into <=20-byte pieces for individual BLE GATT
 * writes by the Kotlin side (AmbitBleModule.kt) — this file hands it
 * complete pre-chunked buffers and lets Kotlin do the actual splitting,
 * since chunk size is a GATT/MTU concern, not a framing concern.
 *
 * CRC32 verified byte-for-byte against 59/59 real frames from the capture
 * (both directions) — see assets/ble 2026-08-06/decoded_suuntoapp_session.txt.
 *
 * What is NOT yet hardware-confirmed for OUR OWN outgoing commands
 * specifically (the capture was an activity-log sync, not a route/POI
 * write): the exact `flags` byte to use when initiating a fresh
 * request. We use 0x06, the one clean example of an app-initiated write
 * seen in the capture (for command 0x1201). If a real device rejects a
 * command (errFlags set in the reply, or no reply at all), that is the
 * first thing to suspect and adjust based on real hardware testing.
 */

#include "libambit_int.h"
#include "protocol.h"

#include <jni.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <android/log.h>

#define LOG_TAG "AmbitProtocolBle"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

#define BLE_HEADER_LEN   12
#define BLE_TRAILER_LEN  4   /* CRC32, little-endian */
#define BLE_CHUNK_SIZE   20
#define BLE_REPLY_TIMEOUT_SEC 20

typedef struct {
    JavaVM *jvm;
    jobject module_ref;       /* global ref to the Kotlin AmbitBleModule instance */
    jmethodID write_chunk_mid; /* void bleWriteChunk(byte[]) */

    pthread_mutex_t lock;
    pthread_cond_t cond;
    int reply_ready;
    int reply_is_error;
    uint16_t reply_command;   /* (msgId<<8)|subId echoed in the reply header */
    uint8_t *reply_payload;
    size_t reply_payload_len;

    uint8_t *rx_acc;          /* raw notification bytes accumulated between 0x7e markers */
    size_t rx_acc_len;
    size_t rx_acc_cap;
    int rx_in_frame;

    uint16_t conn_id;         /* 0 until the watch's first reply teaches us the real value,
                                * then echoed back for the rest of the session — matches
                                * the capture: connId=0 on the bootstrap DEVICE_INFO reply,
                                * connId=9 (constant) for everything after. */
    uint16_t pkt_num;
} ble_ctx_t;

static uint32_t g_crc32_table[256];
static int g_crc32_table_ready = 0;

static void crc32_init_table(void)
{
    for (uint32_t i = 0; i < 256; i++) {
        uint32_t c = i;
        for (int k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        }
        g_crc32_table[i] = c;
    }
    g_crc32_table_ready = 1;
}

/* Standard CRC-32 (IEEE 802.3 / zlib "crc32"), init=xorout=0xFFFFFFFF.
 * Confirmed byte-for-byte against a real capture — see file header comment. */
static uint32_t crc32_ieee(const uint8_t *data, size_t len)
{
    if (!g_crc32_table_ready) crc32_init_table();
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++) {
        crc = g_crc32_table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFFu;
}

/*
 * Called from jni_bridge.cpp (nativeAmbitBleInit) once the Kotlin side has
 * connected, discovered the custom service (after correctly handling the
 * Service Changed indication — see AmbitBleModule.kt), and enabled
 * notifications. Does not touch the wire itself.
 */
int libambit_ble_transport_new(ambit_object_t *object, JavaVM *jvm, jobject module_ref_local, JNIEnv *env)
{
    ble_ctx_t *ctx = (ble_ctx_t *)calloc(1, sizeof(ble_ctx_t));
    if (!ctx) return -1;

    ctx->jvm = jvm;
    ctx->module_ref = (*env)->NewGlobalRef(env, module_ref_local);
    if (!ctx->module_ref) {
        LOGE("NewGlobalRef failed for BLE module instance");
        free(ctx);
        return -1;
    }

    jclass cls = (*env)->GetObjectClass(env, ctx->module_ref);
    ctx->write_chunk_mid = (*env)->GetMethodID(env, cls, "bleWriteChunk", "([B)V");
    (*env)->DeleteLocalRef(env, cls);
    if (!ctx->write_chunk_mid) {
        LOGE("bleWriteChunk([B)V not found on BLE module — Kotlin/native mismatch");
        (*env)->DeleteGlobalRef(env, ctx->module_ref);
        free(ctx);
        return -1;
    }

    pthread_mutex_init(&ctx->lock, NULL);
    pthread_cond_init(&ctx->cond, NULL);

    ctx->rx_acc_cap = 512;
    ctx->rx_acc = (uint8_t *)malloc(ctx->rx_acc_cap);
    if (!ctx->rx_acc) {
        (*env)->DeleteGlobalRef(env, ctx->module_ref);
        pthread_mutex_destroy(&ctx->lock);
        pthread_cond_destroy(&ctx->cond);
        free(ctx);
        return -1;
    }

    object->transport = AMBIT_TRANSPORT_BLE;
    object->transport_ctx = ctx;
    object->handle = NULL;
    return 0;
}

void libambit_ble_transport_close(ambit_object_t *object)
{
    if (!object || object->transport != AMBIT_TRANSPORT_BLE || !object->transport_ctx) return;
    ble_ctx_t *ctx = (ble_ctx_t *)object->transport_ctx;

    JNIEnv *env = NULL;
    if ((*ctx->jvm)->GetEnv(ctx->jvm, (void **)&env, JNI_VERSION_1_6) == JNI_OK && env) {
        (*env)->DeleteGlobalRef(env, ctx->module_ref);
    }
    pthread_mutex_destroy(&ctx->lock);
    pthread_cond_destroy(&ctx->cond);
    free(ctx->rx_acc);
    free(ctx->reply_payload);
    free(ctx);
    object->transport_ctx = NULL;
}

/*
 * Called from jni_bridge.cpp (nativeAmbitBleOnNotify) on whatever thread
 * Android's BLE callback delivers notifications on — NOT the same thread
 * that calls libambit_protocol_command_ble(). Appends raw bytes, and
 * whenever a complete 0x7e ... 0x7e frame is found, validates its CRC32
 * and (if a command is currently pending) wakes it up.
 */
void ambit_ble_on_notify(ambit_object_t *object, const uint8_t *data, size_t len)
{
    if (!object || object->transport != AMBIT_TRANSPORT_BLE || !object->transport_ctx) return;
    ble_ctx_t *ctx = (ble_ctx_t *)object->transport_ctx;

    pthread_mutex_lock(&ctx->lock);

    for (size_t i = 0; i < len; i++) {
        uint8_t b = data[i];
        if (b == 0x7e) {
            if (ctx->rx_in_frame && ctx->rx_acc_len > 0) {
                /* complete frame in rx_acc[0..rx_acc_len) */
                if (ctx->rx_acc_len >= BLE_HEADER_LEN + BLE_TRAILER_LEN) {
                    size_t content_len = ctx->rx_acc_len - BLE_TRAILER_LEN;
                    const uint8_t *trailer = ctx->rx_acc + content_len;
                    uint32_t got = crc32_ieee(ctx->rx_acc, content_len);
                    uint32_t want = (uint32_t)trailer[0] | ((uint32_t)trailer[1] << 8) |
                                    ((uint32_t)trailer[2] << 16) | ((uint32_t)trailer[3] << 24);
                    if (got == want) {
                        uint8_t msgId    = ctx->rx_acc[0];
                        uint8_t subId    = ctx->rx_acc[1];
                        uint8_t errFlags = ctx->rx_acc[3];
                        uint16_t connId;
                        uint32_t dataSize;
                        memcpy(&connId, ctx->rx_acc + 4, 2);
                        memcpy(&dataSize, ctx->rx_acc + 8, 4);
                        size_t payload_avail = content_len - BLE_HEADER_LEN;
                        size_t payload_len = (dataSize <= payload_avail) ? dataSize : payload_avail;

                        if (ctx->conn_id == 0 && connId != 0) {
                            ctx->conn_id = connId; /* learn it from the first real reply */
                        }

                        free(ctx->reply_payload);
                        ctx->reply_payload = payload_len ? (uint8_t *)malloc(payload_len) : NULL;
                        if (payload_len) memcpy(ctx->reply_payload, ctx->rx_acc + BLE_HEADER_LEN, payload_len);
                        ctx->reply_payload_len = payload_len;
                        ctx->reply_command = ((uint16_t)msgId << 8) | subId;
                        ctx->reply_is_error = (errFlags != 0);
                        ctx->reply_ready = 1;
                        pthread_cond_signal(&ctx->cond);
                    } else {
                        LOGE("BLE frame CRC mismatch: got=%08x want=%08x len=%zu — dropped",
                             got, want, content_len);
                    }
                } else {
                    LOGE("BLE frame too short (%zu bytes) — dropped", ctx->rx_acc_len);
                }
            }
            /* 0x7e both closes the previous frame and opens the next one */
            ctx->rx_acc_len = 0;
            ctx->rx_in_frame = 1;
            continue;
        }
        if (!ctx->rx_in_frame) continue; /* junk before the first 0x7e this session */
        if (ctx->rx_acc_len >= ctx->rx_acc_cap) {
            size_t new_cap = ctx->rx_acc_cap * 2;
            uint8_t *grown = (uint8_t *)realloc(ctx->rx_acc, new_cap);
            if (!grown) { LOGE("BLE rx buffer growth failed"); ctx->rx_in_frame = 0; ctx->rx_acc_len = 0; continue; }
            ctx->rx_acc = grown;
            ctx->rx_acc_cap = new_cap;
        }
        ctx->rx_acc[ctx->rx_acc_len++] = b;
    }

    pthread_mutex_unlock(&ctx->lock);
}

/*
 * Builds one 0x7e-wrapped frame for `command`/`data`/`datalen`, chunks it
 * into <=20-byte pieces, and hands each chunk to Kotlin's bleWriteChunk()
 * via JNI, in order. Kotlin performs the actual GATT write (WRITE_TYPE_NO_RESPONSE,
 * matching what the real capture showed the Suunto app using for this traffic).
 */
static int ble_send_command(ble_ctx_t *ctx, uint16_t command,
                             const uint8_t *data, size_t datalen)
{
    uint8_t header[BLE_HEADER_LEN];
    header[0] = (uint8_t)(command >> 8);   /* msgId */
    header[1] = (uint8_t)(command & 0xFF); /* subId */
    header[2] = 0x06; /* flags — see file header comment: best real-world reference we have */
    header[3] = 0x00; /* errFlags — always 0 outgoing */
    memcpy(header + 4, &ctx->conn_id, 2);
    memcpy(header + 6, &ctx->pkt_num, 2);
    uint32_t dataSize = (uint32_t)datalen;
    memcpy(header + 8, &dataSize, 4);
    ctx->pkt_num++;

    size_t content_len = BLE_HEADER_LEN + datalen;
    size_t frame_len = 1 /*0x7e*/ + content_len + BLE_TRAILER_LEN + 1 /*0x7e*/;
    uint8_t *frame = (uint8_t *)malloc(frame_len);
    if (!frame) return -1;

    size_t off = 0;
    frame[off++] = 0x7e;
    memcpy(frame + off, header, BLE_HEADER_LEN); off += BLE_HEADER_LEN;
    if (datalen) { memcpy(frame + off, data, datalen); off += datalen; }
    uint32_t crc = crc32_ieee(frame + 1, content_len);
    frame[off++] = (uint8_t)(crc & 0xFF);
    frame[off++] = (uint8_t)((crc >> 8) & 0xFF);
    frame[off++] = (uint8_t)((crc >> 16) & 0xFF);
    frame[off++] = (uint8_t)((crc >> 24) & 0xFF);
    frame[off++] = 0x7e;

    JNIEnv *env = NULL;
    int attached = 0;
    if ((*ctx->jvm)->GetEnv(ctx->jvm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
        if ((*ctx->jvm)->AttachCurrentThread(ctx->jvm, &env, NULL) != 0) {
            LOGE("AttachCurrentThread failed");
            free(frame);
            return -1;
        }
        attached = 1;
    }

    int ret = 0;
    for (size_t pos = 0; pos < frame_len; pos += BLE_CHUNK_SIZE) {
        size_t chunk_len = frame_len - pos;
        if (chunk_len > BLE_CHUNK_SIZE) chunk_len = BLE_CHUNK_SIZE;
        jbyteArray chunk = (*env)->NewByteArray(env, (jsize)chunk_len);
        if (!chunk) { ret = -1; break; }
        (*env)->SetByteArrayRegion(env, chunk, 0, (jsize)chunk_len, (const jbyte *)(frame + pos));
        (*env)->CallVoidMethod(env, ctx->module_ref, ctx->write_chunk_mid, chunk);
        (*env)->DeleteLocalRef(env, chunk);
        if ((*env)->ExceptionCheck(env)) {
            LOGE("bleWriteChunk threw an exception");
            (*env)->ExceptionDescribe(env);
            (*env)->ExceptionClear(env);
            ret = -1;
            break;
        }
    }

    if (attached) (*ctx->jvm)->DetachCurrentThread(ctx->jvm);
    free(frame);
    return ret;
}

int libambit_protocol_command_ble(ambit_object_t *object, uint16_t command,
                                   uint8_t *data, size_t datalen,
                                   uint8_t **reply_data, size_t *replylen,
                                   uint8_t legacy_format)
{
    if (legacy_format != 0) {
        LOGE("libambit_protocol_command_ble: legacy_format=%d not supported over BLE "
             "(no hardware reference for it — see protocol_ble.c header comment)", legacy_format);
        return -1;
    }
    if (!object || object->transport != AMBIT_TRANSPORT_BLE || !object->transport_ctx) {
        LOGE("libambit_protocol_command_ble: not a BLE object");
        return -1;
    }
    ble_ctx_t *ctx = (ble_ctx_t *)object->transport_ctx;

    pthread_mutex_lock(&ctx->lock);
    ctx->reply_ready = 0;
    free(ctx->reply_payload);
    ctx->reply_payload = NULL;
    ctx->reply_payload_len = 0;
    pthread_mutex_unlock(&ctx->lock);

    if (ble_send_command(ctx, command, data, datalen) != 0) {
        LOGE("libambit_protocol_command_ble: send failed for command 0x%04x", command);
        return -1;
    }

    struct timespec deadline;
    clock_gettime(CLOCK_REALTIME, &deadline);
    deadline.tv_sec += BLE_REPLY_TIMEOUT_SEC;

    pthread_mutex_lock(&ctx->lock);
    int wait_ret = 0;
    while (!ctx->reply_ready && wait_ret == 0) {
        wait_ret = pthread_cond_timedwait(&ctx->cond, &ctx->lock, &deadline);
    }
    if (!ctx->reply_ready) {
        pthread_mutex_unlock(&ctx->lock);
        LOGE("libambit_protocol_command_ble: timeout waiting for reply to 0x%04x", command);
        return -1;
    }
    if (ctx->reply_is_error) {
        pthread_mutex_unlock(&ctx->lock);
        LOGE("libambit_protocol_command_ble: watch returned errFlags for command 0x%04x", command);
        return -1;
    }
    if (reply_data != NULL && replylen != NULL) {
        *replylen = ctx->reply_payload_len;
        if (ctx->reply_payload_len > 0) {
            *reply_data = (uint8_t *)malloc(ctx->reply_payload_len);
            memcpy(*reply_data, ctx->reply_payload, ctx->reply_payload_len);
        } else {
            *reply_data = NULL;
        }
    }
    pthread_mutex_unlock(&ctx->lock);

    return 0;
}
