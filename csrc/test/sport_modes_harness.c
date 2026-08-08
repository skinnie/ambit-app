/*
 * Test harness for device_driver_ambit3_sport_modes.c: builds the exact same synthetic
 * mode/sport-mode data as tools/custom_modes_write.py's _selftest(), and prints the
 * resulting region bytes as one hex string - compared byte for byte by
 * tools/sport_modes_c_reference.py, the same cross-check convention harness.c already
 * uses for routes (see tools/c_reference.py).
 */

#include "../../shared/libambit/device_driver_ambit3_sport_modes.h"

#include <stdio.h>
#include <string.h>

int main(void)
{
    ambit3_sm_mode_t mode;
    ambit3_sm_sport_mode_slot_t sport_modes[2];
    uint8_t region[AMBIT3_SM_REGION_SIZE];
    int body_len;
    int i;

    memset(&mode, 0, sizeof(mode));
    snprintf(mode.settings.name, sizeof(mode.settings.name), "Openwater swim");
    mode.settings.activity_id = 0x53;
    mode.settings.custom_mode_id = 60596;
    mode.settings.use_hw = 0x0003;
    mode.settings.alti_baro_mode = 1;
    /* every other settings field left 0, same as the Python selftest */

    mode.display_count = 1;
    mode.displays[0].template_id = 0x0107;
    mode.displays[0].type = 0;
    mode.displays[0].field_count = 2;
    mode.displays[0].fields[0].index = 0x18;
    mode.displays[0].fields[0].type = 8;
    mode.displays[0].fields[0].shortcut_count = 2;
    mode.displays[0].fields[0].shortcuts[0] = 0;
    mode.displays[0].fields[0].shortcuts[1] = 8;
    mode.displays[0].fields[1].index = 0x19;
    mode.displays[0].fields[1].type = 4;
    mode.displays[0].fields[1].shortcut_count = 0;

    mode.rule_count = 1;
    mode.rules[0].rule_idx = 0;
    mode.rules[0].use_rule = 1;
    mode.rules[0].log_rule = 0;

    mode.has_app_meta = 1;
    mode.app_meta_ts1 = 1785000000;
    mode.app_meta_ts2 = 1785000002;

    memset(sport_modes, 0, sizeof(sport_modes));
    snprintf(sport_modes[0].name, sizeof(sport_modes[0].name), "Cycling");
    sport_modes[0].activity_id = 4;
    sport_modes[0].exercise_count = 1;
    sport_modes[0].exercises[0] = 2;
    sport_modes[0].order = 2;
    sport_modes[0].has_app_meta = 1;
    sport_modes[0].app_meta = 1786034231u;

    snprintf(sport_modes[1].name, sizeof(sport_modes[1].name), "Triathlon");
    sport_modes[1].activity_id = 0x13;
    sport_modes[1].exercise_count = 5;
    sport_modes[1].exercises[0] = 0;
    sport_modes[1].exercises[1] = 1;
    sport_modes[1].exercises[2] = 2;
    sport_modes[1].exercises[3] = 1;
    sport_modes[1].exercises[4] = 3;
    sport_modes[1].order = 10;
    sport_modes[1].has_app_meta = 0;

    body_len = ambit3_sport_modes_build(&mode, 1, sport_modes, 2, 2, region);
    if (body_len < 0) {
        fprintf(stderr, "ambit3_sport_modes_build failed\n");
        return 1;
    }

    printf("BODY_LEN %d\n", body_len);
    printf("REGION ");
    for (i = 0; i < AMBIT3_SM_REGION_SIZE; i++) {
        printf("%02x", region[i]);
    }
    printf("\n");
    return 0;
}
