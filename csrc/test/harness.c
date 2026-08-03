/*
 * Test harness for the serializer: reads a route description on standard input,
 * builds the write plan, and prints it for comparison with the Python reference.
 *
 * Input format, one directive per line:
 *   ROUTE <distance> <ascent> <descent> <timestamp> <month> <day> <h> <min> <s> <name>
 *   POINT <lat_e7> <lon_e7> <altitude>
 *   WPT   <lat_e7> <lon_e7> <point_index> <name>
 *   RESET
 *
 * Output:
 *   W <hex_address> <length> <hex_bytes>
 *   H <region> <hash>
 */

#include "../device_driver_ambit3_navigation.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_ROUTES     8
#define MAX_POINTS  4096
#define MAX_WPT       64

static ambit3_nav_route_t routes[MAX_ROUTES];
static ambit3_nav_point_t points[MAX_ROUTES][MAX_POINTS];
static ambit3_nav_waypoint_t waypoints[MAX_ROUTES][MAX_WPT];

static void trim(char *s)
{
    size_t n = strlen(s);
    while (n > 0 && (s[n - 1] == '\n' || s[n - 1] == '\r')) {
        s[--n] = '\0';
    }
}

int main(void)
{
    char line[512];
    size_t route_count = 0;
    int reset = 0;
    ambit3_nav_plan_t plan;
    size_t i;

    while (fgets(line, sizeof(line), stdin) != NULL) {
        trim(line);
        if (strncmp(line, "RESET", 5) == 0) {
            reset = 1;
        } else if (strncmp(line, "ROUTE ", 6) == 0) {
            ambit3_nav_route_t *r;
            unsigned distance, ascent, descent, stamp, mo, da, ho, mi, se;
            int consumed = 0;

            if (route_count >= MAX_ROUTES) {
                fprintf(stderr, "too many routes\n");
                return 2;
            }
            r = &routes[route_count];
            memset(r, 0, sizeof(*r));
            if (sscanf(line + 6, "%u %u %u %u %u %u %u %u %u %n", &distance,
                       &ascent, &descent, &stamp, &mo, &da, &ho, &mi, &se,
                       &consumed) < 9) {
                fprintf(stderr, "malformed ROUTE\n");
                return 2;
            }
            r->distance = distance;
            r->ascent = (uint16_t)ascent;
            r->descent = (uint16_t)descent;
            r->timestamp = stamp;
            r->month = (uint8_t)mo; r->day = (uint8_t)da;
            r->hour = (uint8_t)ho; r->minute = (uint8_t)mi;
            r->second = (uint8_t)se;
            snprintf(r->name, sizeof(r->name), "%s", line + 6 + consumed);
            r->points = points[route_count];
            r->waypoints = waypoints[route_count];
            route_count++;
        } else if (strncmp(line, "POINT ", 6) == 0) {
            ambit3_nav_route_t *r = &routes[route_count - 1];
            long lat, lon, alt;

            if (route_count == 0 || r->point_count >= MAX_POINTS) {
                return 2;
            }
            if (sscanf(line + 6, "%ld %ld %ld", &lat, &lon, &alt) != 3) {
                return 2;
            }
            r->points[r->point_count].latitude = (int32_t)lat;
            r->points[r->point_count].longitude = (int32_t)lon;
            r->points[r->point_count].altitude = (int32_t)alt;
            r->point_count++;
        } else if (strncmp(line, "WPT ", 4) == 0) {
            ambit3_nav_route_t *r = &routes[route_count - 1];
            long lat, lon;
            unsigned index;
            int consumed = 0;

            if (route_count == 0 || r->waypoint_count >= MAX_WPT) {
                return 2;
            }
            if (sscanf(line + 4, "%ld %ld %u %n", &lat, &lon, &index,
                       &consumed) < 3) {
                return 2;
            }
            r->waypoints[r->waypoint_count].latitude = (int32_t)lat;
            r->waypoints[r->waypoint_count].longitude = (int32_t)lon;
            r->waypoints[r->waypoint_count].point_index = (uint16_t)index;
            snprintf(r->waypoints[r->waypoint_count].name,
                     sizeof(r->waypoints[r->waypoint_count].name), "%s",
                     line + 4 + consumed);
            r->waypoint_count++;
        }
    }

    if (reset) {
        if (ambit3_navigation_plan_reset(&plan) != 0) {
            fprintf(stderr, "reset plan impossible\n");
            return 1;
        }
    } else if (ambit3_navigation_plan(routes, route_count, &plan) != 0) {
        fprintf(stderr, "plan impossible\n");
        return 1;
    }

    for (i = 0; i < plan.write_count; i++) {
        uint16_t j;
        printf("W %06x %u ", plan.writes[i].address, plan.writes[i].length);
        for (j = 0; j < plan.writes[i].length; j++) {
            printf("%02x", plan.writes[i].data[j]);
        }
        printf("\n");
    }
    printf("H waypoints %s\n", plan.waypoint_hash);
    printf("H routes %s\n", plan.route_hash);
    ambit3_navigation_plan_free(&plan);
    return 0;
}
