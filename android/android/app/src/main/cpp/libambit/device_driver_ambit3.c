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
#include "device_driver.h"
#include "device_driver_common.h"
#include "device_support.h"
#include "libambit_int.h"
#include "protocol.h"
#include "pmem20.h"
#include "personal.h"
#include "sbem0102.h"
#include "sha256.h"
#include "utils.h"
#include "debug.h"
#include "device_driver_ambit3_navigation.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include <math.h>

/*
 * Local definitions
 */

typedef struct memory_map_entry_s {
    uint32_t start;
    uint32_t size;
    uint8_t hash[32];
} memory_map_entry_t;

enum ambit3_fw_gen {
    AMBIT3_FW_GEN1,
    AMBIT3_FW_GEN2,
    AMBIT3_FW_GEN3,
    AMBIT3_FW_GEN4,
    AMBIT3_VERT_FW_GEN1,
    AMBIT3_VERT_FW_GEN2,
    AMBIT3_VERT_FW_GEN3,
    TRAVERSE_FW_GEN1,
    TRAVERSE_FW_GEN2,
};

typedef struct ambit3_driver_params_s {
    uint8_t mm_legacy_format;
    uint8_t mm_entry_data_id;
    uint8_t log_header_request_data_id;
    uint8_t log_entries_total_data_id;
    uint8_t log_entries_notsynced_data_id;
    uint8_t log_header_data_id;
    uint8_t log_header_tail_length;
    uint8_t log_synced_data_id;
} ambit3_driver_params_t;

struct ambit_device_driver_data_s {
    libambit_pmem20_t pmem20;
    libambit_sbem0102_t sbem0102;
    struct {
        uint8_t initialized;
        memory_map_entry_t waypoints;
        memory_map_entry_t routes;
        memory_map_entry_t rules;
        memory_map_entry_t gps;
        memory_map_entry_t sport_modes;
        memory_map_entry_t training_program;
        memory_map_entry_t exercise_log;
        memory_map_entry_t event_log;
        memory_map_entry_t ble_pairing;
        memory_map_entry_t apps;
        memory_map_entry_t glonass; // Ambit3 Vertical / Traverse
        memory_map_entry_t track_log; // Traverse
    } memory_maps;
    enum ambit3_fw_gen fw_gen;
    ambit3_driver_params_t driver_params;
};

typedef struct ambit3_log_header_s {
    ambit_log_header_t header;
    uint32_t address;
    uint32_t end_address;
    uint32_t address2;
    uint32_t end_address2;
    uint8_t synced;
} ambit3_log_header_t;

/*
 * Static functions
 */
static void init(ambit_object_t *object, uint32_t driver_param);
static void deinit(ambit_object_t *object);
static int personal_settings_get(ambit_object_t *object, ambit_personal_settings_t *settings);
static int log_read(ambit_object_t *object, ambit_log_skip_cb skip_cb, ambit_log_push_cb push_cb, ambit_log_progress_cb progress_cb, void *userref);
static int gps_orbit_header_read(ambit_object_t *object, uint8_t data[8]);
static int gps_orbit_write(ambit_object_t *object, uint8_t *data, size_t datalen);

static int parse_log_header_block(ambit_object_t *object, libambit_sbem0102_data_t *reply_data_object, ambit_log_skip_cb skip_cb, ambit_log_push_cb push_cb, ambit_log_progress_cb progress_cb, void *userref, uint16_t *log_entries_walked, uint16_t log_entries_total);
static size_t parse_log_entry(ambit_object_t *object, const uint8_t *log_data, ambit3_log_header_t *log_header);
static int get_memory_maps(ambit_object_t *object);
static int log_synced(ambit_object_t *object, ambit_log_entry_t *log_entry);

/*
 * Global variables
 */
ambit_device_driver_t ambit_device_driver_ambit3 = {
    init,
    deinit,
    libambit_device_driver_lock_log,
    libambit_device_driver_date_time_set,
    libambit_device_driver_status_get,
    personal_settings_get,
    log_read,
    gps_orbit_header_read,
    gps_orbit_write,
    NULL, // navigation_read
    NULL, // navigation_write
    NULL, // sport_mode_write
    NULL, // app_data_write
    log_synced
};


/*
 * Static functions implementation
 */

/**
 * Performs a lookup of the ambit3 firmware generation for the watch product id and firmware version.
 *
 * \param device_info Device info structure of the watch.
 * \return Enumeration of the watch firmware generation.
 */
static enum ambit3_fw_gen get_ambit3_fw_gen(ambit_device_info_t *device_info)
{
    struct generation {
        uint8_t fw_version[4];
        enum ambit3_fw_gen gen;
    };

    struct generation ambit3_gen[] =  {
        {{2, 4, 1, 0}, AMBIT3_FW_GEN4},
        {{2, 2, 16, 0}, AMBIT3_FW_GEN3},
        {{2, 0, 4, 0}, AMBIT3_FW_GEN2},
        {{0, 0, 0, 0}, AMBIT3_FW_GEN1},
    };

    struct generation ambit3_vert_gen[] = {
        {{1, 1, 22, 0}, AMBIT3_VERT_FW_GEN3},
        {{1, 0, 27, 0}, AMBIT3_VERT_FW_GEN2},
        {{1, 0, 0, 0}, AMBIT3_VERT_FW_GEN1},
    };

    struct generation traverse_gen[] = {
        {{2, 0, 18, 0}, TRAVERSE_FW_GEN2},
        {{1, 0, 4, 0}, TRAVERSE_FW_GEN1},
    };

    struct generation* iter;

    switch (device_info->product_id) {
      case 0x1e:
      case 0x1c:
      case 0x1b:
        for (size_t i = 0; i < sizeof (ambit3_gen) / sizeof ((ambit3_gen)[0]) && (iter = &ambit3_gen[i]); i++) {
            if (libambit_fw_version_number(iter->fw_version) <= libambit_fw_version_number(device_info->fw_version))
                return iter->gen;
        }
        break;
      case 0x2c: // Ambit3 Vertical
        for (size_t i = 0; i < sizeof (ambit3_vert_gen) / sizeof ((ambit3_vert_gen)[0]) && (iter = &ambit3_vert_gen[i]); i++) {
            if (libambit_fw_version_number(iter->fw_version) <= libambit_fw_version_number(device_info->fw_version))
                return iter->gen;
        }
        break;
      case 0x2b: // Traverse
      case 0x2d: // Traverse Alpha
        for (size_t i = 0; i < sizeof (traverse_gen) / sizeof ((traverse_gen)[0]) && (iter = &traverse_gen[i]); i++) {
            if (libambit_fw_version_number(iter->fw_version) <= libambit_fw_version_number(device_info->fw_version))
                return iter->gen;
        }
        break;
    }

    abort();
}

/**
 * Performs a lookup of the ambit3 driver parameters for the watch firmware generation.
 *
 * \param fw_gen Firmware version of the watch.
 * \return ambit3_driver_params_t structure containing the driver parameters.
 */
static ambit3_driver_params_t get_ambit3_driver_params(enum ambit3_fw_gen fw_gen) {

    struct ambit3_driver_params_lookup {
        enum ambit3_fw_gen gen;
        ambit3_driver_params_t driver_params;
    };

    struct ambit3_driver_params_lookup dp_lookup[] =  {
            {AMBIT3_FW_GEN1,        {0x02, 0x3f, 0x81, 0x4e, 0x4f, 0x7e, 0x00, 0x00}},
            {AMBIT3_FW_GEN2,        {0x00, 0x4b, 0x8d, 0x5a, 0x5b, 0x8a, 0x1a, 0x00}},
            {AMBIT3_FW_GEN3,        {0x00, 0x4a, 0x8c, 0x59, 0x5a, 0x89, 0x1a, 0x00}},
            {AMBIT3_FW_GEN4,        {0x00, 0x4a, 0x8d, 0x59, 0x5a, 0x8a, 0x1c, 0x8b}},
            {AMBIT3_VERT_FW_GEN1,   {0x00, 0x4a, 0x8c, 0x59, 0x5a, 0x8a, 0x1c, 0x00}},
            {AMBIT3_VERT_FW_GEN2,   {0x00, 0x4a, 0x8b, 0x58, 0x59, 0x89, 0x1c, 0x00}},
            {AMBIT3_VERT_FW_GEN3,   {0x00, 0x4a, 0x8a, 0x57, 0x58, 0x88, 0x1c, 0x00}},
            {TRAVERSE_FW_GEN1,      {0x00, 0x4a, 0x8a, 0x56, 0x57, 0x87, 0x1c, 0x00}},
            {TRAVERSE_FW_GEN2,      {0x00, 0x4a, 0x88, 0x55, 0x56, 0x86, 0x1c, 0x00}},
    };

    ambit3_driver_params_t params;

    struct ambit3_driver_params_lookup* iter;

    for (size_t i = 0; i < sizeof (dp_lookup) / sizeof ((dp_lookup)[0]) && (iter = &dp_lookup[i]); i++) {
        if (iter->gen == fw_gen) {
            params = iter->driver_params;
            break;
        }
    }

    return params;
}

/**
 * Initialises the ambit3 driver.
 *
 * \param object
 * \param PMEM20 chunk size.
 */
static void init(ambit_object_t *object, uint32_t driver_param)
{
    struct ambit_device_driver_data_s *data;

    if ((data = calloc(1, sizeof(struct ambit_device_driver_data_s))) != NULL) {
        object->driver_data = data;
        libambit_pmem20_init(&object->driver_data->pmem20, object, driver_param);
        libambit_sbem0102_init(&object->driver_data->sbem0102, object, driver_param);

        // get fw generation specific parameters
        object->driver_data->fw_gen = get_ambit3_fw_gen(&object->device_info);
        object->driver_data->driver_params = get_ambit3_driver_params(object->driver_data->fw_gen);
    }
}

/**
 * De-initialises the ambit3 driver.
 *
 * \param object
 */
static void deinit(ambit_object_t *object)
{
    if (object->driver_data != NULL) {
        libambit_pmem20_deinit(&object->driver_data->pmem20);
        libambit_sbem0102_deinit(&object->driver_data->sbem0102);
    }
}

static float ieee754_to_float(uint32_t bits)
{
    int sign = bits >> 31 ? -1 : 1;
    int exp = (int)(((bits >> 23) & 0xff) - 127);
    int frac = (int)((bits & 0x7fffff) | 0x800000);

    return sign * frac * powf(2.0f, exp - 23);
}

/**
 * Gets the personal settings from the watch.
 *
 * \param object
 * \param settings Setting structure to populate.
 * \return 0 if successful.
 */
static int personal_settings_get(ambit_object_t *object, ambit_personal_settings_t *settings)
{
    uint8_t send_data[4] = { 0x00, 0x00, 0x00, 0x00 };
    libambit_sbem0102_data_t reply_data_object;
    uint32_t alarm_num;
    uint32_t decli_num;

    LOG_INFO("Reading personal settings");

    libambit_sbem0102_data_init(&reply_data_object);
    if (libambit_sbem0102_command_request_raw(&object->driver_data->sbem0102, ambit_command_ambit3_settings, send_data, sizeof(send_data), &reply_data_object) != 0) {
        LOG_WARNING("Failed to read personal settings");
        return -1;
    }

    memset(settings, 0, sizeof(ambit_personal_settings_t));

    while (libambit_sbem0102_data_next(&reply_data_object) == 0) {
        switch (libambit_sbem0102_data_id(&reply_data_object)) {
          case 0x01:
            settings->date_format = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x02:
            settings->tones_mode = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x03:
            settings->gps_position_format = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x04:
            decli_num = read32(libambit_sbem0102_data_ptr(&reply_data_object), 0);
            settings->compass_declination_f = ieee754_to_float(decli_num);
            break;
          case 0x08:
            settings->units_mode = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x12:
            settings->language = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x13: // Map orientation
            settings->navigation_style = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x14:
            settings->time_format = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x15:
            settings->sync_time_w_gps = !libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x16: // Dual time enabled
            break;
          case 0x17:
            settings->alarm_enable = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x18:
            alarm_num = read32(libambit_sbem0102_data_ptr(&reply_data_object), 0);
            settings->alarm.hour = (alarm_num / 60 / 60);
            settings->alarm.minute = (alarm_num / 60) % 60;
            break;
          case 0x19:
            settings->is_male = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x1a:
            settings->weight = read16(libambit_sbem0102_data_ptr(&reply_data_object), 0);
            break;
          case 0x1b:
            settings->max_hr = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x1f:
            if (libambit_sbem0102_data_len(&reply_data_object) == 11) {
                sscanf((const char*)libambit_sbem0102_data_ptr(&reply_data_object), "%04hu-", &settings->birthyear);
            }
            break;
          case 0x20: // Display contrast
            settings->display_brightness = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x21:
            settings->display_is_negative = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x22:
            settings->backlight_mode = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x23:
            settings->backlight_brightness = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x26:
            settings->alti_baro_mode = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x27:
            settings->fused_alti_disabled = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          case 0x28:
            settings->storm_alarm = libambit_sbem0102_data_ptr(&reply_data_object)[0];
            break;
          default:
            /*
            printf("Got id=%02x: ", libambit_sbem0102_data_id(&reply_data_object));
            switch(libambit_sbem0102_data_len(&reply_data_object)) {
              case 1:
                printf("%d", libambit_sbem0102_data_ptr(&reply_data_object)[0]);
                break;
              case 2:
                printf("%d", read16(libambit_sbem0102_data_ptr(&reply_data_object), 0));
                break;
              case 4:
                printf("%d", read32(libambit_sbem0102_data_ptr(&reply_data_object), 0));
                break;
              default:
                {
                    int q;
                for(q=0; q<libambit_sbem0102_data_len(&reply_data_object); q++)
                    printf("%02x", libambit_sbem0102_data_ptr(&reply_data_object)[q]);
                }
                break;
            }
            printf("\n");
            */
            break;
        }
    }

    return 0;
}

/**
 * Processes the log read replies for gen1 firmware. Gen1 has a log_header_data_id byte for each log header.
 *
 * \param object
 * \param reply_data_object Data received from the watch.
 * \param skip_cb Callback function when log header received.
 * \param push_cb Callback function when log received.
 * \param progress_cb Callback function when progress received.
 * \param userref
 * \return Number of entries read or -1 if error.
 */
static int process_log_read_replies_gen1(ambit_object_t *object, libambit_sbem0102_data_t *reply_data_object,
                                         ambit_log_skip_cb skip_cb, ambit_log_push_cb push_cb, ambit_log_progress_cb progress_cb, void *userref)
{
    ambit3_log_header_t log_header;
    ambit_log_entry_t *log_entry;

    int entries_read = 0;

    uint16_t log_entries_total = 0;
    uint16_t log_entries_walked = 0;
    uint16_t log_entries_notsynced;
    ONLYDEBUGVAR(log_entries_notsynced);

    log_header.header.activity_name = NULL;

    while (libambit_sbem0102_data_next(reply_data_object) == 0) {
        if (libambit_sbem0102_data_id(reply_data_object) == object->driver_data->driver_params.log_entries_total_data_id) {
            log_entries_total = read16(libambit_sbem0102_data_ptr(reply_data_object), 0);
            LOG_INFO("Number of logs=%d", log_entries_total);
        }
        else if (libambit_sbem0102_data_id(reply_data_object) == object->driver_data->driver_params.log_entries_notsynced_data_id) {
            log_entries_notsynced = read16(libambit_sbem0102_data_ptr(reply_data_object), 0);
            LOG_INFO("Number of logs marked as not synchronized=%d", log_entries_notsynced);
        }
        else if (libambit_sbem0102_data_id(reply_data_object) == object->driver_data->driver_params.log_header_data_id) {
            const uint8_t *data = libambit_sbem0102_data_ptr(reply_data_object);

            if(parse_log_entry(object, data, &log_header) != 0) {
                LOG_INFO("Log header parsed successfully");
                if (!skip_cb || skip_cb(userref, &log_header.header) != 0) {
                    LOG_INFO("Reading data of log %d of %d", log_entries_walked + 1, log_entries_total);
                    log_entry = libambit_pmem20_log_read_entry_address(&object->driver_data->pmem20,
                                                                       log_header.address,
                                                                       log_header.end_address - log_header.address,
                                                                       0, 0,
                                                                       LIBAMBIT_PMEM20_FLAGS_NONE);
                    if (log_entry != NULL) {
                        if (push_cb != NULL) {
                            push_cb(userref, log_entry);
                        }
                        entries_read++;

                        libambit_log_entry_free(log_entry);
                    }
                }
                else {
                    LOG_INFO("Log entry already exists, skipping");
                }
            }
            else {
                LOG_INFO("Failed to parse log header");
            }
            log_entries_walked++;
            if (progress_cb != NULL && log_entries_total != 0) {
                progress_cb(userref, log_entries_total, log_entries_walked, 100*log_entries_walked/log_entries_total);
            }
        }
        else {
            LOG_INFO("Unknown data id 0x%x", libambit_sbem0102_data_id(reply_data_object));
        }
    }
    
    return entries_read;
}

/**
 * Processes the log read replies for all firmware except gen1. There is a log_header_data_id byte for a blick
 * of log headers.
 *
 * \param object
 * \param reply_data_object Data received from the watch.
 * \param skip_cb Callback function when log header received.
 * \param push_cb Callback function when log received.
 * \param progress_cb Callback function when progress received.
 * \param userref
 * \return Number of entries read or -1 if error.
 */
static int process_log_read_replies(ambit_object_t *object, libambit_sbem0102_data_t *reply_data_object,
                                         ambit_log_skip_cb skip_cb, ambit_log_push_cb push_cb, ambit_log_progress_cb progress_cb, void *userref)
{
    uint16_t log_entries_total = 0;
    uint16_t log_entries_notsynced;
    uint16_t log_entries_walked = 0;
    int entries_read = 0;
    ONLYDEBUGVAR(log_entries_notsynced);

    while (libambit_sbem0102_data_next(reply_data_object) == 0) {
        if (libambit_sbem0102_data_id(reply_data_object) == object->driver_data->driver_params.log_entries_total_data_id) {
            log_entries_total = read16(libambit_sbem0102_data_ptr(reply_data_object), 0);
        }
        else if (libambit_sbem0102_data_id(reply_data_object) == object->driver_data->driver_params.log_entries_notsynced_data_id) {
            log_entries_notsynced = read16(libambit_sbem0102_data_ptr(reply_data_object), 0);
            LOG_INFO("Number of logs marked as not synchronized=%d", log_entries_notsynced);
        }
        else if (libambit_sbem0102_data_id(reply_data_object) == object->driver_data->driver_params.log_header_data_id) {
            entries_read = parse_log_header_block(object, reply_data_object, skip_cb, push_cb, progress_cb, userref, &log_entries_walked, log_entries_total);
        }
        else {
            LOG_INFO("Unknown data id 0x%x", libambit_sbem0102_data_id(reply_data_object));
        }
    }

    return entries_read;
}

/**
 * Gets the logs from the watch.
 *
 * \param skip_cb Callback function when log header received.
 * \param push_cb Callback function when log received.
 * \param progress_cb Callback function when progress received.
 * \param userref
 * \return Number of entries read or -1 if error.
 */
static int log_read(ambit_object_t *object, ambit_log_skip_cb skip_cb, ambit_log_push_cb push_cb, ambit_log_progress_cb progress_cb, void *userref)
{
    int entries_read = 0;
    libambit_sbem0102_data_t send_data_object, reply_data_object;
    LOG_INFO("Reading log headers");

    libambit_sbem0102_data_init(&reply_data_object);
    libambit_sbem0102_data_init(&send_data_object);
    libambit_sbem0102_data_add(&send_data_object, object->driver_data->driver_params.log_header_request_data_id, NULL, 0);

    if (libambit_sbem0102_command_request(&object->driver_data->sbem0102, ambit_command_ambit3_log_headers, &send_data_object, &reply_data_object) != 0) {
        LOG_WARNING("Failed to read log headers");
        return -1;
    }

    if (object->driver_data->memory_maps.initialized == 0) {
        if (get_memory_maps(object) != 0) {
            return -1;
        }
    }

    // Initialize PMEM20 log before starting to read logs
    libambit_pmem20_log_init(&object->driver_data->pmem20, object->driver_data->memory_maps.exercise_log.start, object->driver_data->memory_maps.exercise_log.size);

    if (object->driver_data->fw_gen == AMBIT3_FW_GEN1) {
        entries_read = process_log_read_replies_gen1(object, &reply_data_object, skip_cb, push_cb, progress_cb, userref);
    }
    else {
        entries_read = process_log_read_replies(object, &reply_data_object, skip_cb, push_cb, progress_cb, userref);
    }

    printf("Finished reading logs... I think...\n");

    libambit_sbem0102_data_free(&send_data_object);
    printf("Finished freeing data 1\n");
    libambit_sbem0102_data_free(&reply_data_object);

    printf("Finished freeing data 2\n");

    return entries_read;
}

/**
 * Gets the gps orbit header from the watch.
 *
 * \param object
 * \param data Buffer to populate with gps orbit data.
 * \return 0 if successful.
 */
static int gps_orbit_header_read(ambit_object_t *object, uint8_t data[8])
{
    uint8_t *reply_data = NULL;
    size_t replylen = 0;
    int ret = -1;

    if (libambit_protocol_command(object, ambit_command_gps_orbit_head, NULL, 0, &reply_data, &replylen, 0) == 0 && replylen >= 9) {
        memcpy(data, &reply_data[1], 8);
        libambit_protocol_free(reply_data);

        ret = 0;
    }
    else {
        LOG_WARNING("Failed to read GPS orbit header");
    }

    return ret;
}

/**
 * Writes the gps orbit header to the watch.
 *
 * \param object
 * \param data Buffer containing gps orbit data.
 * \param datalen Size of gps orbit data buiffer.
 * \return 0 if successful.
 */
static int gps_orbit_write(ambit_object_t *object, uint8_t *data, size_t datalen)
{
    uint8_t header[8], cmpheader[8];
    int ret = -1;

    LOG_INFO("Writing GPS orbit data");

    libambit_protocol_command(object, ambit_command_write_start, NULL, 0, NULL, NULL, 0);

    if (object->driver->gps_orbit_header_read(object, header) == 0) {
        cmpheader[0] = data[7]; // Year, swap bytes
        cmpheader[1] = data[6];
        cmpheader[2] = data[8];
        cmpheader[3] = data[9];
        cmpheader[4] = data[13]; // 4 byte swap
        cmpheader[5] = data[12];
        cmpheader[6] = data[11];
        cmpheader[7] = data[10];

        // Check if new data differs 
        if (memcmp(header, cmpheader, 8) != 0) {
            ret = libambit_pmem20_gps_orbit_write(&object->driver_data->pmem20, data, datalen, true);
        }
        else {
            LOG_INFO("Current GPS orbit data is already up to date, skipping");
            ret = 0;
        }
    }

    return ret;
}

/**
 * Processes a block of log headers (not gen1).
 *
 * \param object
 * \param reply_data_object Data received from the watch.
 * \param skip_cb Callback function when log header received.
 * \param push_cb Callback function when log received.
 * \param progress_cb Callback function when progress received.
 * \param userref
 * \param log_entries_walked Log entries walked.
 * \param log_entries_total Log entries total.
 * \return Number of entries read in this block or -1 if error.
 */
static int parse_log_header_block(ambit_object_t *object, libambit_sbem0102_data_t *reply_data_object, ambit_log_skip_cb skip_cb, ambit_log_push_cb push_cb, ambit_log_progress_cb progress_cb, void *userref,  uint16_t *log_entries_walked, uint16_t log_entries_total)
{
    ambit3_log_header_t log_header;
    ambit_log_entry_t *log_entry;
    const uint8_t *data;
    size_t length = 0;
    size_t offset = 0;
    size_t log_read_len = 0;
    int current_parse_num_log_read = 0;
    int skip;
    
    length = libambit_sbem0102_data_len(reply_data_object);
    data = libambit_sbem0102_data_ptr(reply_data_object);

    while(offset<length) {
        log_header.header.activity_name = NULL;
        log_read_len = parse_log_entry(object, &data[offset], &log_header);

        if(log_read_len == 0) {
            LOG_ERROR("Could not parse log header");
            return -1;
        }

        offset += log_read_len;

        LOG_INFO ("Next offset: %d of %d\n", offset, length);

        if (skip_cb && !skip_cb(userref, &log_header.header)) {
            skip = 1;
        }
        else {
            skip = 0;
        }
        
        if (skip && !log_header.synced) {
            LOG_INFO("Log not previously synchronized, force update");
            skip = 0;
        }
        
        if (!skip) {
            LOG_INFO("Reading data of log %d of %d", *log_entries_walked + 1, log_entries_total);
            log_entry = libambit_pmem20_log_read_entry_address(&object->driver_data->pmem20,
                                                               log_header.address,
                                                               log_header.end_address - log_header.address,
                                                               log_header.address2,
                                                               log_header.end_address2 - log_header.address2,
                                                               LIBAMBIT_PMEM20_FLAGS_UNKNOWN2_PADDING_48);
            LOG_INFO("Completed data of log %d of %d", *log_entries_walked + 1, log_entries_total);
            if (log_entry != NULL) {
                if (push_cb != NULL) {
                    push_cb(userref, log_entry);
                    LOG_INFO("Completed push_cb");
                }
            }
        }
        else {
            LOG_INFO("Log entry already exists, skipping");
        }

        (*log_entries_walked)++;
        current_parse_num_log_read++;

        if(*log_entries_walked > log_entries_total) {
            log_entries_total = *log_entries_walked; // Handle situations where ambit reports wrong number of total entries
        }

        if (progress_cb != NULL && log_entries_total != 0) {
            LOG_INFO("Do progress_cb");
            progress_cb(userref, log_entries_total, *log_entries_walked, 100*(*log_entries_walked)/log_entries_total);
        }
    }

    return current_parse_num_log_read;
}

/**
 * Parses the log header data for one log entry..
 *
 * \param data Raw log header data buffer.
 * \param log_header Structure to populate with header field values.
 * \return Buffer offset at the end of the log header.
 */
static size_t parse_log_entry(ambit_object_t *object, const uint8_t *data, ambit3_log_header_t *log_header)
{
    struct tm tm;
    char *ptr;
    size_t offset = 0;

    // Start with parsing the time
    if ((ptr = libambit_strptime((const char *)data, "%Y-%m-%dT%H:%M:%S", &tm)) == NULL) {
        return 0;
    }

    log_header->header.date_time.year = 1900 + tm.tm_year;
    log_header->header.date_time.month = tm.tm_mon + 1;
    log_header->header.date_time.day = tm.tm_mday;
    log_header->header.date_time.hour = tm.tm_hour;
    log_header->header.date_time.minute = tm.tm_min;
    log_header->header.date_time.msec = tm.tm_sec*1000;
    offset += (size_t)ptr - (size_t)data + 1;

    log_header->synced = read8inc(data, &offset);

    log_header->address = read32inc(data, &offset);
    log_header->end_address = read32inc(data, &offset);
    log_header->address2 = read32inc(data, &offset);
    log_header->end_address2 = read32inc(data, &offset);
    log_header->header.heartrate_min = read8inc(data, &offset);
    log_header->header.heartrate_avg = read8inc(data, &offset);
    log_header->header.heartrate_max = read8inc(data, &offset);

    if (object->driver_data->fw_gen == AMBIT3_FW_GEN1 || object->driver_data->fw_gen == AMBIT3_FW_GEN2) {
        log_header->header.heartrate_max_time = read32inc(data, &offset);
        log_header->header.heartrate_min_time = read32inc(data, &offset);
    }
    else {
        log_header->header.heartrate_min_time = read32inc(data, &offset);
        log_header->header.heartrate_max_time = read32inc(data, &offset);
    }

    // temperature format is messed up, 1 byte is missing, just skip for now
    log_header->header.temperature_min = 0;
    log_header->header.temperature_max = 0;
    offset += 2;
    log_header->header.temperature_min_time = read32inc(data, &offset);
    log_header->header.temperature_max_time = read32inc(data, &offset);
    log_header->header.altitude_min = read16inc(data, &offset);
    log_header->header.altitude_max = read16inc(data, &offset);
    log_header->header.altitude_min_time = read32inc(data, &offset);
    log_header->header.altitude_max_time = read32inc(data, &offset);
    log_header->header.cadence_avg = read8inc(data, &offset);
    log_header->header.cadence_max = read8inc(data, &offset);
    log_header->header.cadence_max_time = read32inc(data, &offset);
    log_header->header.speed_avg = read16inc(data, &offset); // 10 m/h
    log_header->header.speed_max = read16inc(data, &offset); // 10 m/h
    log_header->header.speed_max_time = read32inc(data, &offset);
    offset += 4; // Unknown bytes
    log_header->header.duration = read32inc(data, &offset)*100; // seconds 0.1
    log_header->header.ascent = read16inc(data, &offset);
    log_header->header.descent = read16inc(data, &offset);
    log_header->header.ascent_time = read32inc(data, &offset)*1000;
    log_header->header.descent_time = read32inc(data, &offset)*1000;
    log_header->header.recovery_time = read16inc(data, &offset)*60*1000;
    log_header->header.peak_training_effect = read8inc(data, &offset);

    if (log_header->header.activity_name) {
        free(log_header->header.activity_name);
    }
    log_header->header.activity_name = utf8memconv((const char*)(data + offset), 16, "UTF-8");

    offset += (strnlen((const char*)(data + offset), 20)+1);

    log_header->header.distance = read32inc(data, &offset);
    log_header->header.energy_consumption = read16inc(data, &offset);

    offset += object->driver_data->driver_params.log_header_tail_length;

    return offset;
}

/**
 * Gets the memory maps from the watch.
 *
 * \param object
 * \return 0 if successful.
 */
static int get_memory_maps(ambit_object_t *object)
{
    uint8_t legacy_format = 0;
    uint8_t *reply_data = NULL;
    size_t replylen = 0;
    uint8_t send_data[4] = { 0x00, 0x00, 0x00, 0x00 };
    libambit_sbem0102_data_t reply_data_object;
    uint8_t mm_entry_data_id = 0;
    memory_map_entry_t *mm_entry;
    const uint8_t *ptr;

    legacy_format = object->driver_data->driver_params.mm_legacy_format;

    if (libambit_protocol_command(object, ambit_command_waypoint_count, NULL, 0, &reply_data, &replylen, legacy_format) != 0 || replylen < 4) {
        libambit_protocol_free(reply_data);
        LOG_WARNING("Failed to read memory map key");
        return -1;
    }
    libambit_protocol_free(reply_data);

    libambit_sbem0102_data_init(&reply_data_object);
    if (libambit_sbem0102_command_request_raw(&object->driver_data->sbem0102, ambit_command_ambit3_memory_map, send_data, sizeof(send_data), &reply_data_object) != 0) {
        LOG_WARNING("Failed to read memory map");
        return -1;
    }

    mm_entry_data_id = object->driver_data->driver_params.mm_entry_data_id;

    while (libambit_sbem0102_data_next(&reply_data_object) == 0) {
        if (libambit_sbem0102_data_id(&reply_data_object) == mm_entry_data_id) {
            ptr = libambit_sbem0102_data_ptr(&reply_data_object);
            LOG_INFO("Memory map entry \"%s\"", ptr);
            mm_entry = NULL;
            if (strcmp((char*)ptr, "Waypoints") == 0) {
                mm_entry = &object->driver_data->memory_maps.waypoints;
            }
            else if (strcmp((char*)ptr, "Routes") == 0) {
                mm_entry = &object->driver_data->memory_maps.routes;
            }
            else if (strcmp((char*)ptr, "Rules") == 0) {
                mm_entry = &object->driver_data->memory_maps.rules;
            }
            else if (strcmp((char*)ptr, "GpsSGEE") == 0) {
                mm_entry = &object->driver_data->memory_maps.gps;
            }
            else if (strcmp((char*)ptr, "CustomModes") == 0) {
                mm_entry = &object->driver_data->memory_maps.sport_modes;
            }
            else if (strcmp((char*)ptr, "TrainingProgram") == 0) {
                mm_entry = &object->driver_data->memory_maps.training_program;
            }
            else if (strcmp((char*)ptr, "ExerciseLog") == 0) {
                mm_entry = &object->driver_data->memory_maps.exercise_log;
            }
            else if (strcmp((char*)ptr, "EventLog") == 0) {
                mm_entry = &object->driver_data->memory_maps.event_log;
            }
            else if (strcmp((char*)ptr, "BlePairingInfo") == 0) {
                mm_entry = &object->driver_data->memory_maps.ble_pairing;
            }
            else if (strcmp((char*)ptr, "Apps") == 0) {
                mm_entry = &object->driver_data->memory_maps.apps;
            }
            else {
                LOG_WARNING("Unknown memory map type \"%s\"", (char*)ptr);
            }

            if (mm_entry != NULL) {
                // We have dealed with the name, advance to hash
                ptr += strlen((char*)ptr) + 1;

                if (libambit_htob((const char*)ptr, mm_entry->hash, sizeof(mm_entry->hash)) < 0) {
                    LOG_ERROR("Failed to read memory map hash");
                }
                ptr += strlen((char*)ptr) + 1;

                mm_entry->start = read32(ptr, 0);
                ptr += 4;
                mm_entry->size = read32(ptr, 0);
            }
        }
    }

    object->driver_data->memory_maps.initialized = 1;
    libambit_sbem0102_data_free(&reply_data_object);

    LOG_INFO("Memory map successfully parsed");

    return 0;
}

/**
 * Set log as synchronized
 *
 * \param object
 * \param log_entry Log to set as synchronized
 * \return 0 if successful.
 */
static int log_synced(ambit_object_t *object, ambit_log_entry_t *log_entry)
{
    libambit_sbem0102_data_t send_data_object, reply_data_object;

    LOG_INFO("Sync log");

    struct {
        uint8_t timestamp[0x14];
        uint8_t synced;
    } sbem0102_synced;

    ambit_date_time_t dt;
    memcpy(&dt, &log_entry->header.date_time, sizeof(dt));
    snprintf((char*)sbem0102_synced.timestamp, sizeof(sbem0102_synced.timestamp), "%04d-%02d-%02dT%02d:%02d:%02d",
            dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.msec);

    sbem0102_synced.synced = 1;
    
    libambit_sbem0102_data_init(&reply_data_object);
    libambit_sbem0102_data_init(&send_data_object);
    libambit_sbem0102_data_add(&send_data_object, object->driver_data->driver_params.log_synced_data_id, (uint8_t*)&sbem0102_synced, sizeof(sbem0102_synced));

    if (libambit_sbem0102_command_request(&object->driver_data->sbem0102, ambit_command_ambit3_log_synced, &send_data_object, &reply_data_object) != 0) {
        LOG_WARNING("Failed to sync log");
        return -1;
    }

    return 0;
}

/*
 * ─── Route write (GPX-to-watch navigation) ────────────────────────────────
 *
 * Not part of upstream openambit: this is the transport layer for
 * ambit3_navigation_plan() (device_driver_ambit3_navigation.c/.h, ported
 * unmodified from a separate reverse-engineering project, verified byte for
 * byte against real USBPcap captures and against real hardware writes).
 * That function only builds the payloads; everything below reproduces the
 * exact command sequence SuuntoLink itself uses, confirmed on hardware:
 *
 *   0x0b24 (read the POI list) -> waypoint region writes + tail hash ->
 *   route region writes + tail hash -> 0x0b04 (commit) ->
 *   0x0b25 (restore the POI list)
 *
 * A navigation write erases the whole POI store; the read-before/restore-
 * after pair is what makes that invisible to the user. This is not
 * optional. protocol.h's own enum mislabels 0x0b25 as "unknown4" and is
 * missing 0x0b24 entirely -- both are defined locally below rather than
 * trusted from there.
 *
 * IMPORTANT, and reflected below: routes written this way are not durable.
 * SuuntoLink's own sync (and, per field testing, even the Suunto phone app
 * merely coming into BLE range) wholesale-replaces whatever is in the Routes
 * region on its own next sync, with no merge. POIs persist; routes don't.
 * This is a "load right before you go" feature, not permanent storage --
 * make sure any caller surfaces that to the user rather than implying the
 * route is saved for good.
 */

#define AMBIT3_CMD_POI_READ   0x0b24
#define AMBIT3_CMD_POI_WRITE  0x0b25
#define AMBIT3_CMD_NAV_COMMIT 0x0b04 /* == ambit_command_nav_memory_delete in protocol.h; that name is wrong, the value isn't */

#define AMBIT3_POI_ENTRY_ID   0x55

/* [u32 0][u8 0x01][u8 0x01]["SBEM0102"] -- the fixed 14-byte prefix every
 * SBEM0102-framed write (not just POIs) uses. Confirmed byte for byte
 * against a real 0x0b25 capture; not derivable from the protocol.h enum. */
static const uint8_t AMBIT3_SBEM_WRITE_PREFIX[14] = {
    0x00, 0x00, 0x00, 0x00, 0x01, 0x01,
    'S', 'B', 'E', 'M', '0', '1', '0', '2',
};

/* Builds the [u32 address][u32 0][64 ASCII hex chars] tail payload and sends
 * it via 0x0b18. `hash_hex` must be a NUL-terminated 64-character uppercase
 * hex string, as ambit3_navigation_plan() already produces. */
static int ambit3_send_region_tail(ambit_object_t *object, uint32_t address, const char *hash_hex)
{
    uint8_t tail[4 + 4 + 64];
    uint32_t addr_le = htole32(address);
    memcpy(tail, &addr_le, 4);
    memset(tail + 4, 0, 4); /* the second u32 is opaque, supplied-by-the-application in every real
                                capture examined; zeroed here, same as this project's own reference
                                tooling -- the watch has never rejected a write over this field */
    memcpy(tail + 8, hash_hex, 64);

    if (libambit_protocol_command(object, ambit_command_data_tail_len, tail, sizeof(tail), NULL, NULL, 0) != 0) {
        LOG_WARNING("Failed to write region tail for address 0x%06x", address);
        return -1;
    }
    return 0;
}

/* Sends every write in `plan` whose address falls in [base, base+size), via
 * the existing generic pmem20 chunker, then that group's closing tail. */
static int ambit3_send_region(ambit_object_t *object, const ambit3_nav_plan_t *plan,
                               uint32_t base, uint32_t size, const char *hash_hex)
{
    for (size_t i = 0; i < plan->write_count; i++) {
        const ambit3_nav_write_t *w = &plan->writes[i];
        if (w->address < base || w->address >= base + size) continue;
        if (libambit_pmem20_data_write(&object->driver_data->pmem20, w->address, w->data, w->length) != 0) {
            LOG_WARNING("Failed to write region chunk at 0x%06x (%u bytes)", w->address, w->length);
            return -1;
        }
    }
    return ambit3_send_region_tail(object, base, hash_hex);
}

/*
 * Reads the watch's POI list (0x0b24) and collects a pointer/length pair
 * per entry (id AMBIT3_POI_ENTRY_ID) into caller-provided arrays. `bodies[i]`
 * points inside `*poi_reply_out`, which the caller must free with
 * libambit_protocol_free() once done reading them -- NOT before.
 * Returns the entry count (0 for a genuinely empty POI store, a real,
 * reachable state confirmed on hardware), or -1 if the read itself failed.
 */
static int ambit3_read_poi_entries(ambit_object_t *object,
                                    const uint8_t **bodies, uint32_t *body_lens, size_t max_entries,
                                    uint8_t **poi_reply_out, size_t *poi_reply_len_out)
{
    uint8_t zero4[4] = { 0, 0, 0, 0 };
    *poi_reply_out = NULL;
    *poi_reply_len_out = 0;

    if (libambit_protocol_command(object, AMBIT3_CMD_POI_READ, zero4, sizeof(zero4), poi_reply_out, poi_reply_len_out, 0) != 0) {
        return -1;
    }

    size_t entry_count = 0;
    uint8_t *poi_reply = *poi_reply_out;
    size_t poi_reply_len = *poi_reply_len_out;
    if (poi_reply != NULL && poi_reply_len > 14 && memcmp(poi_reply + 6, "SBEM0102", 8) == 0) {
        libambit_sbem0102_data_t poi_entries;
        poi_entries.data = poi_reply + 14;
        poi_entries.size = poi_reply_len - 14;
        libambit_sbem0102_data_reset(&poi_entries);

        while (libambit_sbem0102_data_next(&poi_entries) == 0 && entry_count < max_entries) {
            if (libambit_sbem0102_data_id(&poi_entries) == AMBIT3_POI_ENTRY_ID) {
                bodies[entry_count] = libambit_sbem0102_data_ptr(&poi_entries);
                body_lens[entry_count] = libambit_sbem0102_data_len(&poi_entries);
                entry_count++;
            }
        }
    }
    return (int)entry_count;
}

/*
 * Builds the full 0x0b25 SBEM0102 write payload from a list of existing POI
 * entry bodies, plus an optional new record placed first (poiimport's own
 * behaviour: new POI first, the rest following in whatever order the
 * caller already put `bodies` in -- reversed for a plain preserve, as-read
 * for an add; see the two callers). Returns NULL (and *out_len = 0) if
 * there is nothing to write at all. Caller frees the returned buffer.
 */
static uint8_t *ambit3_build_poi_write_payload(
    const uint8_t *const *bodies, const uint32_t *body_lens, size_t entry_count,
    const uint8_t *new_record, size_t new_record_len,
    size_t *out_len)
{
    size_t total_body_len = new_record_len;
    for (size_t i = 0; i < entry_count; i++) total_body_len += body_lens[i];
    *out_len = 0;
    if (total_body_len == 0) return NULL;

    size_t header_len = (total_body_len < 0xff) ? 2 : 6;
    size_t payload_len = sizeof(AMBIT3_SBEM_WRITE_PREFIX) + header_len + total_body_len;
    uint8_t *payload = (uint8_t*)malloc(payload_len);
    if (payload == NULL) return NULL;

    uint8_t *p = payload;
    memcpy(p, AMBIT3_SBEM_WRITE_PREFIX, sizeof(AMBIT3_SBEM_WRITE_PREFIX));
    p += sizeof(AMBIT3_SBEM_WRITE_PREFIX);
    *p++ = AMBIT3_POI_ENTRY_ID;
    if (header_len == 2) {
        *p++ = (uint8_t)total_body_len;
    } else {
        *p++ = 0xff;
        uint32_t len_le = htole32((uint32_t)total_body_len);
        memcpy(p, &len_le, 4);
        p += 4;
    }
    if (new_record != NULL) {
        memcpy(p, new_record, new_record_len);
        p += new_record_len;
    }
    for (size_t i = 0; i < entry_count; i++) {
        memcpy(p, bodies[i], body_lens[i]);
        p += body_lens[i];
    }

    *out_len = payload_len;
    return payload;
}

#define AMBIT3_POI_MAX_EXISTING 64

/*
 * Adds one POI to the watch, preserving every POI already there. Unlike a
 * route write, this never touches the Waypoints/Routes flash regions and
 * needs no commit -- it only reads and rewrites the POI SBEM list via
 * 0x0b24/0x0b25. Byte layout ported from ambit-app/tools/ambit_format.py's
 * build_poi_record(), itself documented as "the exact inverse of
 * parse_sbem_poi_list" (which IS hardware-verified against real POI reads).
 * The add path itself (as opposed to reading unmodified) has not been
 * round-trip tested on real hardware as of this writing -- worth treating
 * the first real use as a test, same spirit as the route write.
 * `name` must be non-empty. Returns 0 on success, -1 on failure.
 */
int ambit3_add_poi_to_watch(ambit_object_t *object, const char *name, double lat, double lon)
{
    if (object == NULL || object->driver_data == NULL || name == NULL || name[0] == '\0') {
        LOG_ERROR("ambit3_add_poi_to_watch: invalid arguments");
        return -1;
    }

    uint8_t *poi_reply = NULL;
    size_t poi_reply_len = 0;
    const uint8_t *bodies[AMBIT3_POI_MAX_EXISTING];
    uint32_t body_lens[AMBIT3_POI_MAX_EXISTING];
    int entry_count = ambit3_read_poi_entries(object, bodies, body_lens, AMBIT3_POI_MAX_EXISTING, &poi_reply, &poi_reply_len);
    if (entry_count < 0) {
        LOG_ERROR("ambit3_add_poi_to_watch: failed to read the existing POI list, aborting before any write");
        libambit_protocol_free(poi_reply);
        return -1;
    }

    /* Timestamp: ISO 8601, no offset suffix. tools/README.md documented this
     * field as UTC from a single reference watch's own self-created POI, but
     * a direct test on real hardware here (2026-08-06, watch and phone
     * clocks agreed, watch's own POI screen showed the write's UTC value
     * literally rather than converting it) shows the watch does NOT convert
     * this field for display -- it echoes back whatever was stored. Storing
     * local time instead is what makes the watch's own UI show the real
     * creation time; the original finding was very likely a reference watch
     * that happened to be configured for UTC+0, making the two
     * indistinguishable in that single test. Uses the phone's local
     * timezone, which is what the user actually wants reflected. */
    char stamp[32];
    time_t now = time(NULL);
    struct tm tmv;
    localtime_r(&now, &tmv);
    strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%S", &tmv);

    /* name\0 + route_name\0 (empty: standalone, not tied to a route) + stamp\0 +
     * [route_index=0][type=17][sub_type=0][type_index=0][flags=1] +
     * [i32 LE lat*1e7][i32 LE lon*1e7]. type=17/flags=1 match what the watch
     * itself writes for a POI it creates (SuuntoLink instead leaves those at
     * 0 for an imported one) -- picked so this looks the same as a
     * watch-made POI rather than an imported one. */
    size_t name_len = strlen(name);
    size_t stamp_len = strlen(stamp);
    size_t record_len = name_len + 1 + 1 /* empty route_name + its NUL */ + stamp_len + 1 + 5 + 8;
    uint8_t *record = (uint8_t*)malloc(record_len);
    int ret = -1;
    if (record == NULL) {
        LOG_ERROR("ambit3_add_poi_to_watch: out of memory building the POI record");
        libambit_protocol_free(poi_reply);
        return -1;
    }
    uint8_t *p = record;
    memcpy(p, name, name_len); p += name_len; *p++ = 0;
    *p++ = 0; /* empty route_name */
    memcpy(p, stamp, stamp_len); p += stamp_len; *p++ = 0;
    *p++ = 0;  /* route_index */
    *p++ = 17; /* type = WAYPOINT_TYPE_DEFAULT */
    *p++ = 0;  /* sub_type */
    *p++ = 0;  /* type_index */
    *p++ = 1;  /* flags */
    int32_t lat_i = (int32_t)llround(lat * 1e7);
    int32_t lon_i = (int32_t)llround(lon * 1e7);
    uint32_t lat_le = htole32((uint32_t)lat_i);
    uint32_t lon_le = htole32((uint32_t)lon_i);
    memcpy(p, &lat_le, 4); p += 4;
    memcpy(p, &lon_le, 4); p += 4;

    size_t payload_len = 0;
    uint8_t *payload = ambit3_build_poi_write_payload(bodies, body_lens, (size_t)entry_count,
                                                        record, record_len, &payload_len);
    if (payload == NULL) {
        LOG_ERROR("ambit3_add_poi_to_watch: failed to build the POI write payload");
    } else if (libambit_protocol_command(object, AMBIT3_CMD_POI_WRITE, payload, payload_len, NULL, NULL, 0) != 0) {
        LOG_ERROR("ambit3_add_poi_to_watch: write failed");
    } else {
        LOG_INFO("ambit3_add_poi_to_watch: added '%s' (%d existing POI(s) preserved)", name, entry_count);
        ret = 0;
    }

    free(payload);
    free(record);
    libambit_protocol_free(poi_reply);
    return ret;
}

/*
 * Writes one or more routes to the watch, replacing the whole navigation
 * database (that is how the format works -- SuuntoLink itself has no
 * incremental/append mode either). Preserves the POI store across the
 * write. Returns 0 on success, -1 on failure; on failure the watch's own
 * state is whatever the last completed step left it in -- see the ordering
 * note above for what that implies.
 */
int ambit3_write_route_to_watch(ambit_object_t *object, const ambit3_nav_route_t *routes, size_t route_count)
{
    ambit3_nav_plan_t plan;
    uint8_t *poi_reply = NULL;
    size_t poi_reply_len = 0;
    uint8_t *poi_write_payload = NULL;
    size_t poi_write_len = 0;
    int ret = -1;

    if (object == NULL || object->driver_data == NULL || routes == NULL || route_count == 0) {
        LOG_ERROR("ambit3_write_route_to_watch: invalid arguments");
        return -1;
    }

    /* Safety gate: refuse rather than write to the wrong place if this
     * watch's live memory map doesn't match the addresses/sizes the plan
     * assumes. Those constants were only ever verified against one
     * model/firmware combination -- see device_driver_ambit3_navigation.h. */
    if (object->driver_data->memory_maps.initialized == 0) {
        if (get_memory_maps(object) != 0) {
            LOG_ERROR("ambit3_write_route_to_watch: failed to read memory map");
            return -1;
        }
    }
    if (object->driver_data->memory_maps.waypoints.start != AMBIT3_WAYPOINT_BASE ||
        object->driver_data->memory_maps.waypoints.size  != AMBIT3_WAYPOINT_REGION_SIZE ||
        object->driver_data->memory_maps.routes.start    != AMBIT3_ROUTE_BASE ||
        object->driver_data->memory_maps.routes.size     != AMBIT3_ROUTE_REGION_SIZE) {
        LOG_ERROR("ambit3_write_route_to_watch: watch's memory map does not match the "
                  "verified addresses (Waypoints 0x%06x/%u, Routes 0x%06x/%u expected; "
                  "got Waypoints 0x%06x/%u, Routes 0x%06x/%u) -- refusing to write",
                  AMBIT3_WAYPOINT_BASE, AMBIT3_WAYPOINT_REGION_SIZE,
                  AMBIT3_ROUTE_BASE, AMBIT3_ROUTE_REGION_SIZE,
                  object->driver_data->memory_maps.waypoints.start, object->driver_data->memory_maps.waypoints.size,
                  object->driver_data->memory_maps.routes.start, object->driver_data->memory_maps.routes.size);
        return -1;
    }

    if (ambit3_navigation_plan(routes, route_count, &plan) != 0) {
        LOG_ERROR("ambit3_write_route_to_watch: failed to build the navigation plan "
                   "(a limit was likely exceeded -- see AMBIT3_MAX_* in the header)");
        return -1;
    }

    /* 1. Read the POI list before touching anything, then rebuild the write
     * payload with the same entries in REVERSE order -- matching exactly
     * what a real capture shows SuuntoLink doing when it preserves (as
     * opposed to adding) a list. This needs no understanding of a POI's own
     * fields, so it cannot corrupt one it doesn't recognise. */
    {
        const uint8_t *bodies[AMBIT3_POI_MAX_EXISTING];
        uint32_t body_lens[AMBIT3_POI_MAX_EXISTING];
        int entry_count = ambit3_read_poi_entries(object, bodies, body_lens, AMBIT3_POI_MAX_EXISTING, &poi_reply, &poi_reply_len);
        if (entry_count < 0) {
            LOG_ERROR("ambit3_write_route_to_watch: failed to read the POI list, aborting before any write");
            goto cleanup;
        }
        for (int i = 0; i < entry_count / 2; i++) {
            const uint8_t *tb = bodies[i]; bodies[i] = bodies[entry_count - 1 - i]; bodies[entry_count - 1 - i] = tb;
            uint32_t tl = body_lens[i]; body_lens[i] = body_lens[entry_count - 1 - i]; body_lens[entry_count - 1 - i] = tl;
        }
        poi_write_payload = ambit3_build_poi_write_payload(bodies, body_lens, (size_t)entry_count, NULL, 0, &poi_write_len);
        /* entry_count == 0 means a genuinely empty POI store (confirmed a
         * real, reachable state on hardware) -- nothing to restore, and
         * poi_write_payload stays NULL, which step 4 below treats as
         * "nothing to send" rather than an error. */
    }

    /* 2. Waypoint region, then Route region: writes, then each group's tail. */
    if (ambit3_send_region(object, &plan, AMBIT3_WAYPOINT_BASE, AMBIT3_WAYPOINT_REGION_SIZE, plan.waypoint_hash) != 0) {
        goto cleanup;
    }
    if (ambit3_send_region(object, &plan, AMBIT3_ROUTE_BASE, AMBIT3_ROUTE_REGION_SIZE, plan.route_hash) != 0) {
        goto cleanup;
    }

    /* 3. Commit -- after the writes for Ambit3, unlike openambit's Ambit2 path. */
    if (libambit_protocol_command(object, AMBIT3_CMD_NAV_COMMIT, NULL, 0, NULL, NULL, 0) != 0) {
        LOG_ERROR("ambit3_write_route_to_watch: commit failed -- the watch's navigation "
                   "database may be left in a partially-written state. A backup taken "
                   "before this write is the only way back.");
        goto cleanup;
    }

    /* 4. Restore the POI list. This is what makes step 1 invisible to the user. */
    if (poi_write_payload != NULL) {
        if (libambit_protocol_command(object, AMBIT3_CMD_POI_WRITE, poi_write_payload, poi_write_len, NULL, NULL, 0) != 0) {
            LOG_ERROR("ambit3_write_route_to_watch: route write succeeded but restoring "
                      "the POI list failed -- the watch's POIs may now be empty");
            goto cleanup;
        }
    }

    LOG_INFO("ambit3_write_route_to_watch: wrote %zu route(s), %u waypoint bytes, %u route bytes",
              route_count, AMBIT3_WAYPOINT_REGION_SIZE, AMBIT3_ROUTE_REGION_SIZE);
    ret = 0;

cleanup:
    libambit_protocol_free(poi_reply);
    free(poi_write_payload);
    ambit3_navigation_plan_free(&plan);
    return ret;
}

/*
 * ─── Reading back (routes, waypoints, POIs) ───────────────────────────────
 *
 * All read-only. Byte-level decoding of what these return is deliberately
 * NOT done here -- it happens in TypeScript (RouteReader.ts), same
 * reasoning as RouteSimplify.ts on the write side: the parsing is pure
 * logic with no protocol/hardware dependency once the raw bytes are in
 * hand, so it's easier to get right and iterate on in JS than to add more
 * native surface for something that can't affect the watch either way.
 */

#define AMBIT3_FLASH_READ_CHUNK 1024

/*
 * Reads `length` bytes starting at `address` into a caller-allocated
 * `out_buffer`, via 0x0b17 ([u32 address][u32 length] out, the same eight
 * bytes then the data back) -- ambit-app's tools/write_nav.py read_flash(),
 * ported directly; this is what makes reading the Waypoints/Routes regions
 * (and nothing else, this project's own log-reading code has its own
 * chunker with unrelated bounds tied to the log region) possible.
 * Returns 0 on success, -1 on failure (including a short/mismatched reply).
 */
int ambit3_read_flash_region(ambit_object_t *object, uint32_t address, uint32_t length, uint8_t *out_buffer)
{
    if (object == NULL || out_buffer == NULL) return -1;

    uint32_t offset = 0;
    while (offset < length) {
        uint32_t want = (length - offset > AMBIT3_FLASH_READ_CHUNK) ? AMBIT3_FLASH_READ_CHUNK : (length - offset);

        uint8_t send[8];
        uint32_t addr_le = htole32(address + offset);
        uint32_t want_le = htole32(want);
        memcpy(send, &addr_le, 4);
        memcpy(send + 4, &want_le, 4);

        uint8_t *reply = NULL;
        size_t replylen = 0;
        int ret = libambit_protocol_command(object, ambit_command_log_read, send, sizeof(send), &reply, &replylen, 0);
        if (ret != 0 || replylen != (size_t)want + 8) {
            LOG_WARNING("ambit3_read_flash_region: 0x0b17 at 0x%06x wanted %u, got %zu bytes (ret=%d)",
                        address + offset, want, replylen, ret);
            libambit_protocol_free(reply);
            return -1;
        }
        /* First 8 bytes of the reply echo [address][length] -- not re-checked
         * byte for byte here since a short/mismatched replylen (above) is
         * already the practical signal something went wrong. */
        memcpy(out_buffer + offset, reply + 8, want);
        libambit_protocol_free(reply);
        offset += want;
    }
    return 0;
}

/*
 * Reads the watch's raw POI list (0x0b24) as-is, including the 14-byte
 * SBEM0102 prefix -- decoding the individual entries happens in TS, which
 * already needs its own small SBEM0102 reader for this (see RouteReader.ts).
 * *out is allocated by libambit_protocol_command(); caller frees with
 * libambit_protocol_free(). Returns 0 on success, -1 on failure.
 */
int ambit3_read_poi_list_raw(ambit_object_t *object, uint8_t **out, size_t *out_len)
{
    if (object == NULL || out == NULL || out_len == NULL) return -1;
    uint8_t zero4[4] = { 0, 0, 0, 0 };
    *out = NULL;
    *out_len = 0;
    return libambit_protocol_command(object, AMBIT3_CMD_POI_READ, zero4, sizeof(zero4), out, out_len, 0);
}

#define AMBIT3_CMD_LOG_HEADERS 0x1200

/*
 * Reads a real, live "object by identifier" reply for the given SBEM entry ID via 0x1200 -
 * the same command the companion research project's tools/write_nav.py already uses for
 * sml.DeviceLogBook (entry 0x8d, its own CMD_LOG_HEADERS/LOGBOOK_REQUEST). Confirmed live
 * against a real Suunto Kailash, 2026-08-08 (tools/kailash_history.py): entry 0x67 answers
 * with sml.DeviceHistory (visited cities/countries, travel stats, plus a real "activity
 * mode" logbook bundled in the same reply) - not Kailash-specific at the protocol level,
 * just an entry ID this project happened to find via Kailash first. The request payload
 * shape (4 zero bytes, u16 LE "1", u16 LE "10" = len("SBEM0102") + 2, the magic itself, then
 * the 2-byte entry ID) is fixed across every use of this command seen so far - only the
 * final entry_id byte varies.
 *
 * *out is allocated by libambit_protocol_command(); caller frees with plain free() (same as
 * ambit3_read_poi_list_raw's own caller, jni_bridge.cpp - see its own comment on why plain
 * free() is equivalent to libambit_protocol_free() here). Returns 0 on success, -1 on
 * failure.
 */
int ambit3_read_object_by_id_raw(ambit_object_t *object, uint8_t entry_id, uint8_t **out, size_t *out_len)
{
    if (object == NULL || out == NULL || out_len == NULL) return -1;
    uint8_t request[] = {
        0x00, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x0a, 0x00,
        'S', 'B', 'E', 'M', '0', '1', '0', '2',
        entry_id, 0x00,
    };
    *out = NULL;
    *out_len = 0;
    return libambit_protocol_command(object, AMBIT3_CMD_LOG_HEADERS, request, sizeof(request), out, out_len, 0);
}

#define AMBIT3_CMD_SETTINGS_READ  0x1100
#define AMBIT3_CMD_SETTINGS_WRITE 0x1101

/*
 * Reads the watch's real sml.DeviceSettings tree (0x1100, four zero bytes) - the same
 * command the companion research project's tools/write_nav.py/settings_write.py already
 * use. *out is allocated by libambit_protocol_command(); caller frees with plain free()
 * (same equivalence as ambit3_read_poi_list_raw's own caller - see its comment). Returns 0
 * on success, -1 on failure.
 */
int ambit3_read_settings_raw(ambit_object_t *object, uint8_t **out, size_t *out_len)
{
    if (object == NULL || out == NULL || out_len == NULL) return -1;
    uint8_t zero4[4] = { 0, 0, 0, 0 };
    *out = NULL;
    *out_len = 0;
    return libambit_protocol_command(object, AMBIT3_CMD_SETTINGS_READ, zero4, sizeof(zero4), out, out_len, 0);
}

/*
 * Writes a real sml.DeviceSettings blob back via 0x1101 - real, hardware-confirmed
 * 2026-08-08 (tools/settings_write.py's own docstring): André confirmed on a real
 * connected Ambit3 Peak's own screen that flipping the Display.Invert byte in a blob
 * obtained from ambit3_read_settings_raw() and writing it back here visibly switched the
 * display Light -> Dark. `data`/`datalen` should be the *entire* settings blob (a single
 * changed byte's worth of edits, not a partial tree) - the caller is responsible for
 * reading first, patching the one field it wants to change, and passing the whole thing
 * back, matching how the reference SuuntoLink client itself works
 * (EmuDevice::saveSettings, see custom_modes_andre.md). The watch replies with an empty
 * body on success (confirmed live) - *out/*out_len will be 0/NULL in that case, which is
 * not itself a failure; callers should re-read via ambit3_read_settings_raw() to confirm
 * a write actually took effect, the same "prove it, don't just trust the ACK" rule
 * settings_write.py's own write_one() already applies. Returns 0 on success, -1 on
 * failure.
 */
int ambit3_write_settings_raw(ambit_object_t *object, const uint8_t *data, size_t datalen, uint8_t **out, size_t *out_len)
{
    if (object == NULL || data == NULL || out == NULL || out_len == NULL) return -1;
    *out = NULL;
    *out_len = 0;
    return libambit_protocol_command(object, AMBIT3_CMD_SETTINGS_WRITE, (uint8_t *)data, datalen, out, out_len, 0);
}

#define AMBIT3_CUSTOM_MODES_BASE 0x002000
#define AMBIT3_CUSTOM_MODES_SIZE 12288

/*
 * Reads the watch's real CustomModes flash region (sport modes) - the same 12288-byte
 * region the companion research project's tools/custom_modes.py already reads via 0x0b17.
 * Thin wrapper over the existing generic ambit3_read_flash_region(). Returns 0 on success,
 * -1 on failure (including a short/failed read - out_buffer is only valid on success).
 */
int ambit3_read_custom_modes_raw(ambit_object_t *object, uint8_t *out_buffer)
{
    if (object == NULL || out_buffer == NULL) return -1;
    return ambit3_read_flash_region(object, AMBIT3_CUSTOM_MODES_BASE, AMBIT3_CUSTOM_MODES_SIZE, out_buffer);
}

/*
 * Writes a full CustomModes region back - real, hardware-confirmed mechanism, 2026-08-08
 * (custom_modes_andre.md's "first real, hardware-confirmed CustomModes content edit" and
 * follow-up sections): chunked CMD_DATA_WRITE (reusing the existing generic
 * libambit_pmem20_data_write(), the same chunker Routes/Waypoints already use) + a
 * CMD_DATA_TAIL closing hash (SHA256 of the *entire* `datalen`-byte buffer, uppercase hex -
 * confirmed exactly matching the companion Python project's own `region_hash()`
 * HASH_PADDED mode, see tools/ambit_format.py) + CMD_NAV_COMMIT (0x0b04) - the identical
 * three-step sequence Routes/Waypoints already use via ambit3_write_route_to_watch(), not
 * a new mechanism invented for this.
 *
 * `datalen` MUST be the full real region size (AMBIT3_CUSTOM_MODES_SIZE) - the caller is
 * responsible for reading the current region first (ambit3_read_custom_modes_raw()),
 * patching only the specific bytes it wants to change, and passing the *whole* buffer
 * back, exactly the same discipline every one of this session's Python write tools already
 * follows (never a partial-region write).
 *
 * **Real, honest caveat, unlike this session's other native additions**: the desktop side
 * of this exact mechanism (write_nav.py's send_plan()) was live-tested repeatedly against
 * real hardware this session (custom_modes_rename_test.py and friends) and is fully
 * confirmed working. This native Android port has NOT been - it reuses already-proven
 * building blocks (the pmem20 chunker Routes/Waypoints already use in production, the same
 * sha256.c already linked into this binary, the same CMD_NAV_COMMIT Routes/Waypoints
 * already send) but the composition itself, on this platform, is new and untested. Treat
 * this as needing real hardware verification before trusting it with anything other than a
 * deliberate, backed-up test write - the same caution this project's own "bounds-check
 * before write" lesson calls for.
 *
 * Returns 0 on success, -1 on failure (a failed intermediate write or tail send aborts
 * immediately - the watch's own commit is the only thing that makes a partial write
 * visible, so an aborted sequence before commit should leave the watch's live state
 * unchanged, matching how the Routes/Waypoints path already behaves on a mid-sequence
 * failure).
 */
int ambit3_write_custom_modes_raw(ambit_object_t *object, const uint8_t *data, size_t datalen)
{
    if (object == NULL || data == NULL || datalen != AMBIT3_CUSTOM_MODES_SIZE) return -1;

    if (libambit_pmem20_data_write(&object->driver_data->pmem20, AMBIT3_CUSTOM_MODES_BASE, data, datalen) != 0) {
        LOG_ERROR("ambit3_write_custom_modes_raw: region write failed");
        return -1;
    }

    uint8_t hash[32];
    sha256(data, datalen, hash);
    char hash_hex[65];
    for (int i = 0; i < 32; i++) {
        sprintf(hash_hex + i * 2, "%02X", hash[i]);
    }
    hash_hex[64] = '\0';

    uint8_t tail[4 + 4 + 64];
    uint32_t addr_le = htole32((uint32_t)AMBIT3_CUSTOM_MODES_BASE);
    memcpy(tail, &addr_le, 4);
    memset(tail + 4, 0, 4);
    memcpy(tail + 8, hash_hex, 64);
    if (libambit_protocol_command(object, ambit_command_data_tail_len, tail, sizeof(tail), NULL, NULL, 0) != 0) {
        LOG_ERROR("ambit3_write_custom_modes_raw: tail send failed");
        return -1;
    }

    if (libambit_protocol_command(object, AMBIT3_CMD_NAV_COMMIT, NULL, 0, NULL, NULL, 0) != 0) {
        LOG_ERROR("ambit3_write_custom_modes_raw: commit failed - the watch's CustomModes "
                   "region may be left in a partially-written state. A backup taken before "
                   "this write is the only way back.");
        return -1;
    }
    return 0;
}
