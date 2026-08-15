/*
 * (C) Copyright 2014 Emil Ljungdahl
 *
 * This file is part of libambit.
 *
 * libambit is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Contributors:
 *
 */
#include "protocol.h"
#include "libambit_int.h"
#include "crc16.h"
#include "debug.h"

#include "hidapi/hidapi.h"

#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <unistd.h>
#include <stdio.h>

/*
 * Local definitions
 */
#define READ_TIMEOUT       20000 // ms
#define READ_POLL_INTERVAL 100  // ms
#define READ_POLL_RETRY    (READ_TIMEOUT / READ_POLL_INTERVAL)

// Firmware flash only: a data chunk triggers a flash-page erase the watch acks only when it
// finishes (~50-57 s on the Emu/Kailash/Traverse), far past the 20 s normal ceiling. The
// firmware flasher raises this before streaming and restores it after; 0 means "use
// READ_TIMEOUT" so every other command is unchanged. See firmware_flash_android.c.
static int g_read_timeout_override_ms = 0;
void libambit_protocol_set_read_timeout(int ms) { g_read_timeout_override_ms = ms; }

typedef struct __attribute__((__packed__)) ambit_msg_header_s {
    uint8_t UId;
    uint8_t UL;
    uint8_t MP;
    uint8_t ML;
    uint16_t parts_seq;
    uint16_t checksum;
    uint16_t command;
    uint16_t send_recv;
    uint16_t format;
    uint16_t sequence;
    uint32_t payload_len;
} ambit_msg_header_t;

/*
 * Static functions
 */
/**
 * Write packet to bus. The data buffer should include space for headers
 * which is automatically filled in.
 * \param object Connection object
 * \param data Data buffer to write (64 byte)
 * \return 0 on success, else -1
 */
static int protocol_write_packet(ambit_object_t *object, uint8_t *data);

/**
 * Read packet from bus.
 * \param object Connection object
 * \param data Data buffer to write (64 byte)
 * \return 0 on success, else -1
 */
static int protocol_read_packet(ambit_object_t *object, uint8_t *data);

/**
 * Finalize packet. Add lengths and calculate checksums
 * \param data Data buffer
 * \param payload_len Length of payload
 */
static void finalize_packet(uint8_t *data, uint8_t payload_len);

/*
 * Static variables
 */

/*
 * Public functions
 */
/* Declared in protocol_ble.c. Handles the BLE-specific framing (12-byte
 * header + CRC32 + 0x7e envelope) — see HANDOFF.md Milestone 7,
 * 2026-08-06 entry. Not used for USB. Only legacy_format==0 ("normal") is
 * implemented: BLE is scoped to Ambit3/Traverse only, which always use 0 in
 * practice — the non-zero variants exist for older Ambit/Ambit2-era memory
 * map generations that have no BLE support in this project at all. Returns
 * -1 without touching the wire if legacy_format != 0, rather than guessing
 * at a framing variant with zero hardware evidence behind it. */
extern int libambit_protocol_command_ble(ambit_object_t *object, uint16_t command,
                                          uint8_t *data, size_t datalen,
                                          uint8_t **reply_data, size_t *replylen,
                                          uint8_t legacy_format);

int libambit_protocol_command(ambit_object_t *object, uint16_t command, uint8_t *data, size_t datalen, uint8_t **reply_data, size_t *replylen, uint8_t legacy_format)
{
    if (object->transport == AMBIT_TRANSPORT_BLE) {
        return libambit_protocol_command_ble(object, command, data, datalen, reply_data, replylen, legacy_format);
    }

    int ret = 0;
    uint8_t buf[64];
    memset(buf, 0, 64);
    int packet_count = 1;
    ambit_msg_header_t *msg = (ambit_msg_header_t *)buf;
    uint8_t packet_payload_len;
    int i;
    uint32_t dataoffset = 0, reply_data_len;
    uint16_t msg_parts;

    // Calculate number of packets
    if (datalen > 42) {
        packet_count =
                // we send at least one packet where we can add 42 bytes of data
                1 +
                // then we send one package for every 54 bytes (minus the 42 included in the first package)
                (int)((datalen - 42)/54) +
                // finally we may need to send another package for the "remainder"
                ((datalen - 42) % 54 > 0 ? 1 : 0);
    }

    // Create first packet
    msg->MP = 0x5d;
    msg->parts_seq = htole16(packet_count);
    msg->command = htobe16(command);
    msg->send_recv = htole16(legacy_format == 1 ? 1 : legacy_format == 2 ? 0x15 : 5);
    msg->format = htole16(legacy_format == 1 ? 0 : 9);
    msg->sequence = htole16(object->sequence_no);
    msg->payload_len = htole32(datalen);
    packet_payload_len = fmin(42, datalen);
    memcpy(&buf[20], &data[dataoffset], packet_payload_len);
    finalize_packet(buf, packet_payload_len + 12);
    protocol_write_packet(object, buf);

    datalen -= packet_payload_len;
    dataoffset += packet_payload_len;

    // Send additional packets
    for(i=1; i<packet_count; i++) {
        msg->MP = 0x5e;
        msg->parts_seq = htole16(i);
        packet_payload_len = fmin(54, datalen);
        memcpy(&buf[8], &data[dataoffset], packet_payload_len);
        finalize_packet(buf, packet_payload_len);
        protocol_write_packet(object, buf);

        datalen -= packet_payload_len;
        dataoffset += packet_payload_len;
    }

    // Retrieve reply packets
    int first_read_ret = protocol_read_packet(object, buf);
    int first_reply_ok = (first_read_ret == 0 && msg->MP == 0x5d
                           && le16toh(msg->sequence) == object->sequence_no);
    if (command == ambit_command_log_read) {
        LOG_INFO("kailash-debug: 0x0b17 first reply packet: rp_ret=%d UId=0x%02x MP=0x%02x "
                 "seq=%u (want %u) payload_len=%u parts=%u",
                 first_read_ret, buf[0], msg->MP, le16toh(msg->sequence), object->sequence_no,
                 le32toh(msg->payload_len), le16toh(msg->parts_seq));
    }
    if (first_reply_ok) {
        reply_data_len = le32toh(msg->payload_len);
        dataoffset = 0;
        packet_payload_len = fmin(42, reply_data_len);
        if (reply_data != NULL && replylen != NULL) {
            *replylen = reply_data_len;
            *reply_data = malloc(reply_data_len);
            memcpy(&(*reply_data)[dataoffset], &buf[20], packet_payload_len);
        }
        dataoffset += packet_payload_len;
        reply_data_len -= packet_payload_len;

        msg_parts = le16toh(msg->parts_seq);

        for (i=2; ret == 0 && i<=msg_parts; i++) {
            if (protocol_read_packet(object, buf) == 0 && msg->MP == 0x5e && le16toh(msg->parts_seq) < msg_parts) {
                packet_payload_len = fmin(54, reply_data_len);
                if (reply_data != NULL) {
                    memcpy(&(*reply_data)[42+(le16toh(msg->parts_seq)-1)*54], &buf[8], packet_payload_len);
                }
                dataoffset += packet_payload_len;
                reply_data_len -= packet_payload_len;
            }
            else {
                /* Real, 2026-08-10: freeing here without nulling *reply_data left callers
                 * (e.g. ambit3_read_flash_region's own retry/warning path, which always
                 * frees `reply` whether this call succeeded or not) holding a dangling
                 * pointer to memory already freed right here - a double free, caught live by
                 * Scudo ("invalid chunk state when deallocating") on a real Kailash TrackLog
                 * read after ~26,000 clean packets, once one transient USB packet finally
                 * dropped mid-reply. Not Kailash-specific: any multi-packet reply (any large
                 * flash region, any device) hitting this same rare mid-transfer failure would
                 * have hit the identical crash - just never happened to get exercised hard
                 * enough before. libambit_protocol_free() already no-ops on NULL, so this is
                 * the complete fix, not a partial one. */
                libambit_protocol_free(*reply_data);
                *reply_data = NULL;

                ret = -1;
            }
        }
    }
    else {
        ret = -1;
    }

    // Increment sequence number for next run
    object->sequence_no++;

    return ret;
}

void libambit_protocol_free(uint8_t *data)
{
    if (data != NULL) {
        free(data);
    }
}

static int protocol_write_packet(ambit_object_t *object, uint8_t *data)
{
    hid_write(object->handle, data, 64);

    return 0;
}

static int protocol_read_packet(ambit_object_t *object, uint8_t *data)
{
    int i, res = -1;
    int timeout_ms = g_read_timeout_override_ms > 0 ? g_read_timeout_override_ms : READ_TIMEOUT;
    int retries = timeout_ms / READ_POLL_INTERVAL;
    for (i=0; i<retries; i++) {
        res = hid_read(object->handle, data, 64);
        if (res != 0) {
            break;
        }
        usleep(READ_POLL_INTERVAL * 1000);
    }

    return (res > 0 ? 0 : -1);
}

static void finalize_packet(uint8_t *data, uint8_t payload_len)
{
    ambit_msg_header_t *msg = (ambit_msg_header_t *)data;
    uint16_t *payload_crc, tmpcrc;

    msg->UId = 0x3f;
    msg->UL = payload_len + 8;
    msg->ML = payload_len;
    tmpcrc = crc16_ccitt_false(&data[2], 4);
    msg->checksum = htole16(tmpcrc);
    payload_crc = (uint16_t *)&data[msg->UL];
    *payload_crc = htole16(crc16_ccitt_false_init(&data[8], payload_len, tmpcrc));
}
