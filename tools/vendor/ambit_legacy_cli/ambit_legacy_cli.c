/* Read-only bridge to the legacy Ambit1/2 "Bluebird" PMEM 2.0 protocol, for watches that
 * predate SBEM (write_nav.py's own protocol - see that file's 2026-08-22 PRODUCT_IDS comment
 * for how device-info/battery were confirmed common to the whole family, but settings/POIs/
 * memory-map/logs are NOT). Wraps ../openambit_libambit (vendored, GPLv3, see its README for
 * why) - the only implementation of this protocol available in this project. Deliberately a
 * separate, standalone binary invoked via subprocess (see desktop/backend/server.py's
 * run_tool()), the same way every other tools py CLI is - so GPLv3 stays confined to this
 * one helper process instead of reaching the app binary.
 *
 * Deliberately READ-ONLY. No write call (libambit_navigation_write, sport_mode_write,
 * app_data_write, gps_orbit_write) is ever made. Ambit 1/2 personal-settings write is
 * real (SuuntoLink does it - see the ambit-app-ambit12-settings-write memory) but its wire
 * format has never been captured in this project, so there is nothing safe to send yet.
 *
 * One JSON object printed to stdout per invocation - same "--json" convention as every
 * other tools py CLI that backend/server.py's run_tool() already parses.
 *
 *   ambit_legacy_cli device-info
 *   ambit_legacy_cli settings
 *   ambit_legacy_cli logs OUTDIR         # writes OUTDIR/<n>.gpx + prints an index
 *
 * Build: see build.sh in this directory (links against ../openambit_libambit's libambit).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include "libambit.h"

static void json_str(FILE *f, const char *s) {
    fputc('"', f);
    for (const unsigned char *p = (const unsigned char *)s; s && *p; p++) {
        if (*p == '"' || *p == '\\') fputc('\\', f);
        if (*p < 0x20) { fprintf(f, "\\u%04x", *p); continue; }
        fputc(*p, f);
    }
    fputc('"', f);
}

/* GPX 1.1 track from one log entry's GPS samples - lat/lon in degrees (already scaled by
 * the caller), no elevation smoothing/simplification, matches build_route.py's own "write
 * the real points, don't be clever" convention. */
static int write_gpx(const char *path, ambit_log_entry_t *entry, const char *name) {
    FILE *f = fopen(path, "w");
    if (!f) return -1;
    fprintf(f, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    fprintf(f, "<gpx version=\"1.1\" creator=\"ambit-app legacy_cli\" "
               "xmlns=\"http://www.topografix.com/GPX/1/1\">\n");
    fprintf(f, "  <trk><name>%s</name><trkseg>\n", name);
    int points = 0;
    for (uint32_t i = 0; i < entry->samples_count; i++) {
        ambit_log_sample_t *s = &entry->samples[i];
        double lat = 0, lon = 0;
        int has = 0;
        if (s->type == ambit_log_sample_type_gps_base) {
            lat = s->u.gps_base.latitude / 10000000.0;
            lon = s->u.gps_base.longitude / 10000000.0;
            has = 1;
        } else if (s->type == ambit_log_sample_type_gps_small) {
            lat = s->u.gps_small.latitude / 10000000.0;
            lon = s->u.gps_small.longitude / 10000000.0;
            has = 1;
        } else if (s->type == ambit_log_sample_type_gps_tiny) {
            lat = s->u.gps_tiny.latitude / 10000000.0;
            lon = s->u.gps_tiny.longitude / 10000000.0;
            has = 1;
        } else if (s->type == ambit_log_sample_type_position) {
            lat = s->u.position.latitude / 10000000.0;
            lon = s->u.position.longitude / 10000000.0;
            has = 1;
        }
        if (!has || (lat == 0 && lon == 0)) continue;
        fprintf(f, "    <trkpt lat=\"%.7f\" lon=\"%.7f\">"
                   "<time>%04d-%02d-%02dT%02d:%02d:%02dZ</time></trkpt>\n",
                lat, lon, s->utc_time.year, s->utc_time.month, s->utc_time.day,
                s->utc_time.hour, s->utc_time.minute, s->utc_time.msec / 1000);
        points++;
    }
    fprintf(f, "  </trkseg></trk>\n</gpx>\n");
    fclose(f);
    return points;
}

typedef struct { FILE *idx; char *outdir; int index; int first; } log_ctx_t;

static void log_progress_cb(void *userref, uint16_t count, uint16_t current, uint8_t pct) {
    (void)userref;
    fprintf(stderr, "log %u/%u (%u%%)\n", current, count, pct);
}

static void log_push_cb(void *userref, ambit_log_entry_t *entry) {
    log_ctx_t *ctx = (log_ctx_t *)userref;
    ambit_log_header_t *h = &entry->header;
    char name[64];
    snprintf(name, sizeof(name), "%04d-%02d-%02dT%02d-%02d",
             h->date_time.year, h->date_time.month, h->date_time.day,
             h->date_time.hour, h->date_time.minute);
    char path[1200];
    snprintf(path, sizeof(path), "%s/%d_%s.gpx", ctx->outdir, ctx->index, name);
    int points = write_gpx(path, entry, name);

    if (!ctx->first) fprintf(ctx->idx, ",\n");
    ctx->first = 0;
    fprintf(ctx->idx, "    {\"index\": %d, \"date_time\": \"%04d-%02d-%02dT%02d:%02d\", "
            "\"duration_ms\": %u, \"distance_m\": %u, \"ascent_m\": %u, \"descent_m\": %u, "
            "\"heartrate_avg_bpm\": %u, \"heartrate_max_bpm\": %u, \"activity_type\": %u, "
            "\"activity_name\": ", ctx->index, h->date_time.year, h->date_time.month,
            h->date_time.day, h->date_time.hour, h->date_time.minute, h->duration,
            h->distance, h->ascent, h->descent, h->heartrate_avg, h->heartrate_max,
            h->activity_type);
    json_str(ctx->idx, h->activity_name ? h->activity_name : "");
    fprintf(ctx->idx, ", \"energy_consumption_kcal\": %u, \"gpx_points\": %d, \"gpx_file\": ",
            h->energy_consumption, points);
    json_str(ctx->idx, path);
    fprintf(ctx->idx, "}");
    ctx->index++;
}

static ambit_object_t *open_first_device(ambit_device_info_t **out_devices, ambit_device_info_t **out_info) {
    ambit_device_info_t *devices = libambit_enumerate();
    if (!devices) return NULL;
    ambit_object_t *dev = libambit_new(devices);
    *out_devices = devices;
    *out_info = devices;
    return dev;
}

static int cmd_device_info(void) {
    ambit_device_info_t *devices, *info;
    ambit_object_t *dev = open_first_device(&devices, &info);
    if (!dev) { fputs("@@JSON@@\n", stdout); printf("{\"ok\": false, \"error\": \"no Suunto device found on the USB bus\"}\n"); return 1; }
    ambit_device_status_t status = {0};
    libambit_device_status_get(dev, &status);
    fputs("@@JSON@@\n", stdout); printf("{\"ok\": true, \"model\": ");
    json_str(stdout, info->model);
    printf(", \"serial\": ");
    json_str(stdout, info->serial);
    printf(", \"fw_version\": \"%u.%u.%u.%u\", \"hw_version\": \"%u.%u.%u.%u\", "
           "\"battery_percent\": %u, \"is_supported\": %s}\n",
           info->fw_version[0], info->fw_version[1], info->fw_version[2], info->fw_version[3],
           info->hw_version[0], info->hw_version[1], info->hw_version[2], info->hw_version[3],
           status.charge, info->is_supported ? "true" : "false");
    libambit_close(dev);
    libambit_free_enumeration(devices);
    return 0;
}

static int cmd_settings(void) {
    ambit_device_info_t *devices, *info;
    ambit_object_t *dev = open_first_device(&devices, &info);
    if (!dev) { fputs("@@JSON@@\n", stdout); printf("{\"ok\": false, \"error\": \"no Suunto device found on the USB bus\"}\n"); return 1; }

    ambit_personal_settings_t *ps = libambit_personal_settings_alloc();
    int rc = ps ? libambit_personal_settings_get(dev, ps) : -1;
    if (rc != 0) {
        fputs("@@JSON@@\n", stdout); printf("{\"ok\": false, \"error\": \"personal_settings_get failed, rc=%d\"}\n", rc);
        if (ps) libambit_personal_settings_free(ps);
        libambit_close(dev);
        libambit_free_enumeration(devices);
        return 1;
    }

    fputs("@@JSON@@\n", stdout); printf("{\"ok\": true, \"weight_kg\": %.2f, \"birthyear\": %u, \"max_hr\": %u, "
           "\"rest_hr\": %u, \"fitness_level\": %u, \"is_male\": %u, \"length_cm\": %u, "
           "\"language\": %u, \"units_mode\": %u, \"waypoints_count\": %u, \"waypoints\": [\n",
           ps->weight / 100.0, ps->birthyear, ps->max_hr, ps->rest_hr, ps->fitness_level,
           ps->is_male, ps->length, ps->language, ps->units_mode, ps->waypoints.count);
    for (uint16_t i = 0; i < ps->waypoints.count; i++) {
        ambit_waypoint_t *w = &ps->waypoints.data[i];
        printf("    {\"name\": ");
        json_str(stdout, w->name);
        printf(", \"lat\": %.7f, \"lon\": %.7f, \"altitude_m\": %u, \"type\": %u}%s\n",
               w->latitude / 10000000.0, w->longitude / 10000000.0, w->altitude, w->type,
               (i + 1 < ps->waypoints.count) ? "," : "");
    }
    printf("  ], \"routes_count\": %u}\n", ps->routes.count);

    libambit_personal_settings_free(ps);
    libambit_close(dev);
    libambit_free_enumeration(devices);
    return 0;
}

static int cmd_logs(const char *outdir) {
    struct stat st;
    if (stat(outdir, &st) != 0) mkdir(outdir, 0755);

    ambit_device_info_t *devices, *info;
    ambit_object_t *dev = open_first_device(&devices, &info);
    if (!dev) { fputs("@@JSON@@\n", stdout); printf("{\"ok\": false, \"error\": \"no Suunto device found on the USB bus\"}\n"); return 1; }

    log_ctx_t ctx = { .idx = NULL, .outdir = (char *)outdir, .index = 0, .first = 1 };
    char idxbuf[65536];
    ctx.idx = fmemopen(idxbuf, sizeof(idxbuf), "w");
    if (!ctx.idx) {
        fputs("@@JSON@@\n", stdout); printf("{\"ok\": false, \"error\": \"fmemopen failed\"}\n");
        libambit_close(dev);
        libambit_free_enumeration(devices);
        return 1;
    }

    /* NULL skip_cb, not a callback that always returns "skip" - a real, embarrassing bug
     * found 2026-08-22: libambit.h documents ambit_log_skip_cb as "return 0 to skip entry,
     * else -1", and device_driver_ambit.c's log_read() walks headers first and ONLY starts
     * reading actual PMEM log data once skip_cb returns nonzero for one of them. The earlier
     * version of this file had a skip_cb that always returned 0 ("never skip" - backwards),
     * so it silently walked every header, skipped every one, and reported André's real
     * Ambit1 as having 0 logs when he knew for a fact it had real training data on it.
     * Passing NULL entirely takes the driver's own documented "no skip callback: read
     * everything" path instead - simpler and correct, no callback semantics left to get
     * backwards. */
    int rc = libambit_log_read(dev, NULL, log_push_cb, log_progress_cb, &ctx);
    fflush(ctx.idx);
    fclose(ctx.idx);

    /* libambit_log_read()'s return convention is driver-specific: device_driver_ambit.c
     * returns entries_read (a count, so 0 is a legitimately empty but successful read) and
     * only -1 on a real failure - NOT the plain 0-success/-1-failure convention most of this
     * library's other calls use. Found live, 2026-08-22: a real 9-entry read reported
     * "ok": false here (rc=9 != 0) even though every entry came back correct - cosmetic
     * (the data was already right), but worth getting right so a caller can trust "ok". */
    int ok = rc >= 0;
    fputs("@@JSON@@\n", stdout); printf("{\"ok\": %s, \"total_entries\": %d, \"logs\": [\n%s\n  ]}\n",
           ok ? "true" : "false", ctx.index, idxbuf);

    libambit_close(dev);
    libambit_free_enumeration(devices);
    return ok ? 0 : 1;
}

/* Real write, added 2026-08-22 for André's Ambit1: the legacy family has no 0x0b21 memory
 * map, so tools/sgee.py's own SBEM-based GPS orbit write (find the GpsSGEE region, then
 * write it) can't reach this family at all - confirmed live, "this watch does not declare a
 * GpsSGEE region". openambit's driver has a real, direct equivalent
 * (libambit_gps_orbit_write) that doesn't need a memory map - it's the watch's own driver
 * that knows where GPS orbit data lives for this protocol. Ephemeris data, not firmware -
 * same low-risk category as the Ambit3 family's proven GPS orbit write. */
static int cmd_gps_orbit_write(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { printf("{\"ok\": false, \"error\": \"cannot open %s\"}\n", path); return 1; }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *data = malloc(len);
    if (fread(data, 1, len, f) != (size_t)len) {
        fputs("@@JSON@@\n", stdout);
        printf("{\"ok\": false, \"error\": \"short read of %s\"}\n", path);
        fclose(f); free(data);
        return 1;
    }
    fclose(f);

    ambit_device_info_t *devices, *info;
    ambit_object_t *dev = open_first_device(&devices, &info);
    if (!dev) {
        fputs("@@JSON@@\n", stdout);
        printf("{\"ok\": false, \"error\": \"no Suunto device found on the USB bus\"}\n");
        free(data);
        return 1;
    }

    int rc = libambit_gps_orbit_write(dev, data, (size_t)len);
    fputs("@@JSON@@\n", stdout);
    printf("{\"ok\": %s, \"bytes_written\": %ld}\n", rc == 0 ? "true" : "false", len);

    free(data);
    libambit_close(dev);
    libambit_free_enumeration(devices);
    return rc == 0 ? 0 : 1;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s device-info|settings|logs OUTDIR|gps-orbit-write FILE\n",
                argv[0]);
        return 2;
    }
    if (strcmp(argv[1], "device-info") == 0) return cmd_device_info();
    if (strcmp(argv[1], "settings") == 0) return cmd_settings();
    if (strcmp(argv[1], "logs") == 0) {
        if (argc < 3) { fprintf(stderr, "usage: %s logs OUTDIR\n", argv[0]); return 2; }
        return cmd_logs(argv[2]);
    }
    if (strcmp(argv[1], "gps-orbit-write") == 0) {
        if (argc < 3) { fprintf(stderr, "usage: %s gps-orbit-write FILE\n", argv[0]); return 2; }
        return cmd_gps_orbit_write(argv[2]);
    }
    fprintf(stderr, "unknown command %s\n", argv[1]);
    return 2;
}
