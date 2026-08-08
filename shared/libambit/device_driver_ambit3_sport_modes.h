/*
 * Serialization of the Suunto Ambit3 CustomModes region (sport modes) - BXml tag tree.
 *
 * Clean-room: built from this project's own reverse-engineering (custom_modes_andre.md,
 * byte-verified against a real dump), not derived from openambit's sport_mode_serialize.c
 * text - see V3_CHANGELOG.md's 2026-08-07 "shared-core investigation" entry for why that
 * distinction matters here. C port of tools/custom_modes_write.py; the two are kept in sync
 * by cross-verification (test/sport_modes_reference.py), the same convention
 * device_driver_ambit3_navigation.c already uses against build_route.py.
 *
 * Scope, stated precisely, same caveat as the Python version: this builds the BXml body
 * only (confirmed ~10240 of the region's 12288 bytes). The remaining tail - presumed
 * header/checksum by analogy with Routes/Waypoints - is NOT confirmed and NOT built here.
 * Not write-ready: no real hardware write has used this encoder yet.
 */
#ifndef __DEVICE_DRIVER_AMBIT3_SPORT_MODES_H__
#define __DEVICE_DRIVER_AMBIT3_SPORT_MODES_H__

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define AMBIT3_SM_BASE            0x002000
#define AMBIT3_SM_REGION_SIZE     12288   /* confirmed live via 0x0b21, 2026-08-05 */
#define AMBIT3_SM_NAME_BYTES      64
#define AMBIT3_SM_SETTINGS_SIZE   138     /* every real mode on the reference watch */
#define AMBIT3_SM_INTERVAL_SLOTS  6       /* 1 full + 5 short, see custom_modes_andre.md */

#define AMBIT3_SM_MAX_MODES         10
#define AMBIT3_SM_MAX_DISPLAYS      16
#define AMBIT3_SM_MAX_FIELDS         4
#define AMBIT3_SM_MAX_SHORTCUTS       8
#define AMBIT3_SM_MAX_RULES           4
#define AMBIT3_SM_MAX_SPORT_MODES    10
#define AMBIT3_SM_MAX_EXERCISES       8  /* Triathlon uses 5 (swim/T1/bike/T2/run) */

typedef struct ambit3_sm_interval_slot_s {
    uint8_t  flags;
    uint8_t  type;
    uint16_t max_limit;
    uint16_t min_limit;
    uint16_t padding;   /* slot 0 only, ignored for slots 1-5 */
    uint32_t len;       /* slot 0 only, ignored for slots 1-5 */
} ambit3_sm_interval_slot_t;

typedef struct ambit3_sm_settings_s {
    char     name[AMBIT3_SM_NAME_BYTES + 1]; /* NUL-terminated, truncated to 64 bytes on write */
    uint16_t activity_id;
    uint32_t custom_mode_id;   /* split into low/high uint16 halves on write */
    uint16_t use_hw;
    uint16_t alti_baro_mode;
    uint16_t gps_power_mode;
    uint16_t recording_interval;
    uint16_t autolap;
    uint16_t hr_high;
    uint16_t hr_low;
    uint16_t hr_limits_use;
    uint16_t auto_start;
    uint16_t auto_pause;
    uint16_t auto_scrolling;
    uint16_t int_timer_flags;
    uint16_t int_timer_count;
    ambit3_sm_interval_slot_t intervals[AMBIT3_SM_INTERVAL_SLOTS];
} ambit3_sm_settings_t;

typedef struct ambit3_sm_disp_field_s {
    uint16_t index;   /* FT_* catalogue value */
    uint16_t type;
    uint16_t shortcuts[AMBIT3_SM_MAX_SHORTCUTS];
    size_t   shortcut_count;
} ambit3_sm_disp_field_t;

typedef struct ambit3_sm_display_s {
    uint16_t template_id;  /* PID_RUNNER_GPS_TEMPLATE_* value */
    uint16_t type;
    ambit3_sm_disp_field_t fields[AMBIT3_SM_MAX_FIELDS];
    size_t   field_count;
} ambit3_sm_display_t;

typedef struct ambit3_sm_rule_s {
    uint16_t rule_idx;
    uint16_t use_rule;
    uint16_t log_rule;
} ambit3_sm_rule_t;

typedef struct ambit3_sm_mode_s {
    ambit3_sm_settings_t settings;
    ambit3_sm_display_t  displays[AMBIT3_SM_MAX_DISPLAYS];
    size_t                display_count;
    ambit3_sm_rule_t      rules[AMBIT3_SM_MAX_RULES];
    size_t                rule_count;
    int                   has_app_meta;
    uint32_t              app_meta_ts1;
    uint32_t              app_meta_ts2;
} ambit3_sm_mode_t;

typedef struct ambit3_sm_sport_mode_slot_s {
    char     name[AMBIT3_SM_NAME_BYTES + 1];
    uint16_t activity_id;
    uint16_t exercises[AMBIT3_SM_MAX_EXERCISES];
    size_t   exercise_count;
    uint32_t order;          /* persistent per-slot ID, present on every real slot */
    int      has_app_meta;
    uint32_t app_meta;       /* only on slots whose mode has a Suunto App assigned */
} ambit3_sm_sport_mode_slot_t;

/*
 * Builds the full CustomModes region: BXml body (DEVICE_CUSTOM > EXERCISE_MODES +
 * SPORT_MODES), padded to AMBIT3_SM_REGION_SIZE with 0xff. `region` must have room for
 * AMBIT3_SM_REGION_SIZE bytes. Returns the body length (before padding), or -1 if a limit
 * is exceeded or the body would not fit in the region - checked explicitly, not left to
 * silently overflow.
 */
int ambit3_sport_modes_build(const ambit3_sm_mode_t *modes, size_t mode_count,
                             const ambit3_sm_sport_mode_slot_t *sport_modes,
                             size_t sport_mode_count, uint16_t format_type,
                             uint8_t region[AMBIT3_SM_REGION_SIZE]);

#ifdef __cplusplus
}
#endif

#endif /* __DEVICE_DRIVER_AMBIT3_SPORT_MODES_H__ */
