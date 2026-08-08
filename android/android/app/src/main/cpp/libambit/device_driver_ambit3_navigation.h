/*
 * Serialization of the Suunto Ambit3 navigation database (Emu, fw 2.4.17).
 *
 * Written to drop into openambit's src/libambit/ unmodified: depends only on
 * crc16.h and sha256.h, both already present. The transport layer is deliberately
 * left outside, which makes serialization testable without a watch:
 * ambit3_navigation_plan produces the list of writes to emit, and the caller passes
 * them to libambit_pmem20_data_write then ambit_command_data_tail_len.
 *
 * Format verified byte for byte against USBPcap captures of SuuntoLink.
 */

#ifndef __DEVICE_DRIVER_AMBIT3_NAVIGATION_H__
#define __DEVICE_DRIVER_AMBIT3_NAVIGATION_H__

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Regions, as the watch declares them in its 0x0b21 response. Read them from
 * get_memory_maps() rather than relying on these constants. */
#define AMBIT3_WAYPOINT_BASE        0x005000
#define AMBIT3_WAYPOINT_REGION_SIZE 16384
#define AMBIT3_ROUTE_BASE           0x14c080
#define AMBIT3_ROUTE_REGION_SIZE    130000

#define AMBIT3_WAYPOINT_DESC        0x005020
#define AMBIT3_ROUTE_DESC           0x14c0a0
#define AMBIT3_ROUTE_POINTS         0x14cac8
#define AMBIT3_ROUTE_INDEX          0x169f88
#define AMBIT3_WAYPOINT_INDEX       0x16a370

#define AMBIT3_MAX_ROUTES             50
#define AMBIT3_MAX_ROUTE_POINTS     1000
#define AMBIT3_MAX_TOTAL_POINTS    10000
#define AMBIT3_MAX_WAYPOINTS         100
#define AMBIT3_MAX_NAME_BYTES         15

#define AMBIT3_ALTITUDE_NONE       30000  /* "no data" sentinel */
#define AMBIT3_CHUNK_SIZE           1024

typedef struct ambit3_nav_point_s {
    int32_t latitude;   /* degrees x 1e7 */
    int32_t longitude;  /* degrees x 1e7 */
    int32_t altitude;   /* metres, or AMBIT3_ALTITUDE_NONE */
} ambit3_nav_point_t;

typedef struct ambit3_nav_waypoint_s {
    int32_t  latitude;
    int32_t  longitude;
    char     name[64];    /* UTF-8, truncated to 15 bytes on write */
    uint16_t point_index; /* rank of the route point it is attached to */
} ambit3_nav_waypoint_t;

typedef struct ambit3_nav_route_s {
    char                   name[64];  /* truncated to 15 bytes on write */
    ambit3_nav_point_t    *points;    /* already simplified, <= 1000 */
    uint16_t               point_count;
    uint32_t               distance;  /* metres, supplied by the caller */
    uint16_t               ascent;    /* metres, supplied by the caller */
    uint16_t               descent;
    uint32_t               timestamp; /* seconds, the index timestamp */
    uint8_t                month, day, hour, minute, second;
    ambit3_nav_waypoint_t *waypoints;
    uint16_t               waypoint_count;
} ambit3_nav_route_t;

typedef struct ambit3_nav_write_s {
    uint32_t address;
    uint16_t length;
    const uint8_t *data;
} ambit3_nav_write_t;

#define AMBIT3_NAV_MAX_WRITES 32

typedef struct ambit3_nav_plan_s {
    ambit3_nav_write_t writes[AMBIT3_NAV_MAX_WRITES];
    size_t             write_count;
    /* Closing of each group: SHA-256 hash of the whole region, unwritten bytes
     * at 0xff, rendered as uppercase hexadecimal. */
    char               waypoint_hash[65];
    char               route_hash[65];
    /* Complete regions, owned by the plan. */
    uint8_t           *waypoint_region;
    uint8_t           *route_region;
} ambit3_nav_plan_t;

/*
 * Builds the write plan. Returns 0, or -1 if a limit is exceeded or an allocation
 * fails. The routes must be sorted the way the watch expects them: most recently
 * modified first.
 */
int ambit3_navigation_plan(const ambit3_nav_route_t *routes, size_t route_count,
                           ambit3_nav_plan_t *plan);

void ambit3_navigation_plan_free(ambit3_nav_plan_t *plan);

/* Plan that empties the navigation database: both headers alone, counters at zero. */
int ambit3_navigation_plan_reset(ambit3_nav_plan_t *plan);

/* Exposed for the tests. */
void ambit3_nav_bbox_mid(const ambit3_nav_point_t *points, uint16_t count,
                         int32_t *mid_lat, int32_t *mid_lon);
void ambit3_nav_relative_xy(int32_t mid_lat, int32_t mid_lon,
                            int32_t lat, int32_t lon, int32_t *x, int32_t *y);

#ifdef __cplusplus
}
#endif

#endif /* __DEVICE_DRIVER_AMBIT3_NAVIGATION_H__ */
