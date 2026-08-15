/*
 * Android firmware flasher for the Ambit3 / Traverse / Kailash family.
 *
 * THE ONE WRITE THAT CAN BRICK. This is a faithful port of the desktop's proven
 * tools/firmware_write.py + tools/firmware_flash.py (byte-exact sequence, verified against
 * 5 real SuuntoLink captures incl. the Traverse's traverseoldfirmwaretonew). The opcode
 * sequence and its timing are the reverse-engineered originals; only the transport is
 * Android's (libambit over the USB-OTG fd).
 *
 * IMPORTANT ARCHITECTURE NOTE: entering the bootloader (0x0202) and the final reboot (0x0200)
 * make the watch RE-ENUMERATE on USB - it drops off the bus and returns with a new address.
 * A native fd cannot survive that; only the Kotlin/UsbManager layer can re-acquire the device.
 * So the flash is orchestrated in Kotlin (AmbitUsbModule.firmwareFlash), which calls these in
 * order across re-enumerations:
 *      ambit3_fw_enter_bsl()   -> 0x0202, then Kotlin reopens the re-enumerated BSL device
 *      ambit3_fw_stream(...)   -> 0x0102 + 0x0e00 header + 0x0e01 chunks (+ optional commit)
 *      ambit3_fw_reboot()      -> 0x0200, then Kotlin reopens the re-enumerated app device
 *
 * The desktop's safety ladder is preserved: stream WITHOUT commit leaves the watch in BSL,
 * fully recoverable (re-run with commit, or power-cycle if nothing was committed).
 */

#include "libambit_int.h"
#include "protocol.h"
#include "debug.h"

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <time.h>

#define FW_CMD_BOOTLOADER 0x0202  // enter bootloader: app model -> "BSL" (re-enumerates)
#define FW_CMD_MODE       0x0102  // enter firmware-transfer mode; sequence counter resets here
#define FW_CMD_HEADER     0x0e00  // announce: pack("<II", X, 32) + file[:32]
#define FW_CMD_DATA       0x0e01  // file[32:], 512-byte chunks
#define FW_CMD_COMMIT     0x0e03  // commit / flash
#define FW_CMD_REBOOT     0x0200  // reboot back to the application (re-enumerates)

#define FW_HEADER_LEN     32
#define FW_CHUNK          512
// A chunk that triggers a flash-page erase acks only when the erase finishes (~50-57 s seen
// on Emu/Kailash/Traverse). 120 s covers the worst with margin.
#define FW_ERASE_ACK_MS   120000

extern void libambit_protocol_set_read_timeout(int ms);

/* Sends one firmware opcode and treats a successful (empty) reply as the ack. Frees any reply.
 * Returns 0 on ack, -1 on failure. */
static int fw_cmd(ambit_object_t *object, uint16_t command, const uint8_t *data, size_t len)
{
    uint8_t *reply = NULL;
    size_t reply_len = 0;
    int ret = libambit_protocol_command(object, command, (uint8_t *)data, len, &reply, &reply_len, 0);
    if (reply) libambit_protocol_free(reply);
    if (ret != 0) {
        LOG_ERROR("fw_cmd 0x%04x failed: %d", command, ret);
        return -1;
    }
    return 0;
}

/* 0x0202 - enter the bootloader. The watch re-enumerates after this; the caller (Kotlin) must
 * reopen the device and re-init libambit before calling ambit3_fw_stream(). Returns 0/-1. */
int ambit3_fw_enter_bsl(ambit_object_t *object)
{
    if (object == NULL) return -1;
    LOG_INFO("firmware: 0x0202 enter bootloader");
    return fw_cmd(object, FW_CMD_BOOTLOADER, NULL, 0);
}

/* 0x0200 - reboot back to the application. The watch re-enumerates; the caller reopens it to
 * confirm the new firmware. Best-effort: the reboot itself may drop the link before acking. */
int ambit3_fw_reboot(ambit_object_t *object)
{
    if (object == NULL) return -1;
    LOG_INFO("firmware: 0x0200 reboot to application");
    fw_cmd(object, FW_CMD_REBOOT, NULL, 0);  // ack not guaranteed once the device reboots
    return 0;
}

/*
 * Streams a firmware image to a watch ALREADY in BSL (the caller enters BSL + reopens first).
 *   header       : the file's 32-byte SFI2ST header
 *   payload/len  : the file after the 32-byte header
 *   do_commit    : 0 = stop after the last chunk (recoverable, watch stays in BSL);
 *                  1 = also send 0x0e03 commit (irreversible flash). The caller then reboots.
 * Mirrors firmware_flash.build_sequence: 0x0102 (resets the sequence counter to 0, so 0x0e00
 * goes out as seq 1 and chunks as 2,3,...) + 0x0e00 header + 0x0e01 chunks + optional commit.
 * Returns 0 on success, -1 on any chunk failure (the watch is left in BSL, restartable).
 */
int ambit3_fw_stream(ambit_object_t *object,
                     const uint8_t *header, size_t header_len,
                     const uint8_t *payload, size_t payload_len,
                     int do_commit)
{
    if (object == NULL || header == NULL || header_len != FW_HEADER_LEN) return -1;

    // 0x0102: enter transfer mode. The sequence counter resets to 0 here so the header goes
    // out as seq 1 and the first chunk as seq 2 - the exact numbering in the real captures.
    object->sequence_no = 0;
    if (fw_cmd(object, FW_CMD_MODE, NULL, 0) != 0) { LOG_ERROR("firmware: 0x0102 failed"); return -1; }

    // 0x0e00 header: pack("<II", X, 32) + the file's own 32-byte header. X is a free host tick
    // the watch ignores (proven across captures); synthesize one like the desktop's session_tick.
    uint32_t x = (uint32_t)(((uint64_t)clock() * 1000ULL / CLOCKS_PER_SEC) & 0xffffffffULL);
    uint8_t hdrmsg[8 + FW_HEADER_LEN];
    uint32_t hlen = (uint32_t)FW_HEADER_LEN;
    memcpy(&hdrmsg[0], &x, 4);
    memcpy(&hdrmsg[4], &hlen, 4);
    memcpy(&hdrmsg[8], header, FW_HEADER_LEN);
    if (fw_cmd(object, FW_CMD_HEADER, hdrmsg, sizeof(hdrmsg)) != 0) {
        LOG_ERROR("firmware: 0x0e00 header failed");
        return -1;
    }

    // 0x0e01 data chunks. Any one chunk can trigger the ~57 s flash erase, so raise the ack
    // window for the whole stream, then restore it no matter how we exit.
    size_t n_chunks = (payload_len + FW_CHUNK - 1) / FW_CHUNK;
    LOG_INFO("firmware: streaming %zu bytes in %zu chunks", payload_len, n_chunks);
    libambit_protocol_set_read_timeout(FW_ERASE_ACK_MS);

    int ok = 0;
    size_t idx = 0;
    for (size_t off = 0; off < payload_len; off += FW_CHUNK, idx++) {
        size_t clen = payload_len - off;
        if (clen > FW_CHUNK) clen = FW_CHUNK;
        if (fw_cmd(object, FW_CMD_DATA, payload + off, clen) != 0) {
            LOG_ERROR("firmware: chunk %zu/%zu failed - watch left in BSL (restartable)", idx + 1, n_chunks);
            ok = -1;
            break;
        }
        if ((idx % 200) == 0 || idx + 1 == n_chunks) {
            LOG_INFO("firmware: chunk %zu/%zu (%zu B)", idx + 1, n_chunks, off + clen);
        }
    }

    libambit_protocol_set_read_timeout(0);  // restore the normal 20 s ceiling
    if (ok != 0) return -1;

    if (do_commit) {
        LOG_INFO("firmware: 0x0e03 commit (flashing)");
        libambit_protocol_set_read_timeout(FW_ERASE_ACK_MS);
        int cret = fw_cmd(object, FW_CMD_COMMIT, NULL, 0);
        libambit_protocol_set_read_timeout(0);
        if (cret != 0) { LOG_ERROR("firmware: commit failed"); return -1; }
    } else {
        LOG_INFO("firmware: stream complete, NOT committed (watch stays in BSL, recoverable)");
    }
    return 0;
}
