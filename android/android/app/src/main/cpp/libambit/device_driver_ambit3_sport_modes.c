/*
 * Serialization of the Suunto Ambit3 CustomModes region (sport modes).
 * See the header for scope and verification references.
 */

#include "device_driver_ambit3_sport_modes.h"

#include <string.h>

/* Every BXml tag is [u16 LE tag_id][u16 LE length] then that many content bytes -
 * Communist::Bluebird::BXmlConverter::parseBinaryTag's write-side inverse, confirmed byte
 * for byte against a real dump in custom_modes_andre.md. Tag IDs below are copied from
 * that project document (BXmlTagMapping/BXmlIdMapping), not from any GPL source file. */
#define TAG_EXERCISE_MODES               0x0100
#define TAG_EXERCISE_MODES_MODE          0x0101
#define TAG_EXERCISE_MODES_SETTING_NAME  0x0103
#define TAG_EXERCISE_MODES_DISPLAYS      0x0105
#define TAG_EXERCISE_MODES_DISPLAY       0x0106
#define TAG_EXERCISE_MODES_DISP_SETTING  0x0107
#define TAG_EXERCISE_MODES_DISP_FIELD    0x0108
#define TAG_EXERCISE_MODES_DISP_FIELD_SETTING   0x0109
#define TAG_EXERCISE_MODES_DISP_FIELD_SHORTCUT  0x010A
#define TAG_EXERCISE_MODES_TYPE          0x010B
#define TAG_EXERCISE_MODES_RULES         0x010C
#define TAG_EXERCISE_MODES_RULE          0x010D
#define TAG_EXERCISE_MODES_APP_META      0x01FF
#define TAG_DEVICE_CUSTOM                0x0003
#define TAG_SPORT_MODES                  0x0200
#define TAG_SPORT_MODE                   0x0210
#define TAG_SPORT_MODE_ACTIVITY_ID       0x0213
#define TAG_SPORT_MODE_EXERCISE          0x0214
#define TAG_SPORT_MODE_SETTING_NAME      0x0215
/* Found 2026-08-07 by round-tripping a live dump through the Python encoder and comparing
 * byte for byte - not in any GPL source, see custom_modes.py's SPORT_MODE_ORDER/
 * SPORT_MODE_APP_META docstrings for the derivation. */
#define TAG_SPORT_MODE_ORDER             0x02FE
#define TAG_SPORT_MODE_APP_META          0x02FF

typedef struct writer_s {
    uint8_t *buf;
    size_t   cap;
    size_t   pos;
} writer_t;

/* Every write below goes through one of these, each bounds-checked against the writer's
 * capacity before touching memory - a real flash region has a hard size limit
 * (AMBIT3_SM_REGION_SIZE), and SuuntoLink's own code logs "CustomModes size larger than
 * FLASH area" for exactly the failure this guards against. */
static int w_room(const writer_t *w, size_t n)
{
    return w->pos + n <= w->cap;
}

static int w_put16(writer_t *w, uint16_t v)
{
    if (!w_room(w, 2)) return -1;
    w->buf[w->pos]     = (uint8_t)(v & 0xff);
    w->buf[w->pos + 1] = (uint8_t)(v >> 8);
    w->pos += 2;
    return 0;
}

static int w_put32(writer_t *w, uint32_t v)
{
    if (!w_room(w, 4)) return -1;
    w->buf[w->pos]     = (uint8_t)(v & 0xff);
    w->buf[w->pos + 1] = (uint8_t)((v >> 8) & 0xff);
    w->buf[w->pos + 2] = (uint8_t)((v >> 16) & 0xff);
    w->buf[w->pos + 3] = (uint8_t)((v >> 24) & 0xff);
    w->pos += 4;
    return 0;
}

static int w_put8(writer_t *w, uint8_t v)
{
    if (!w_room(w, 1)) return -1;
    w->buf[w->pos] = v;
    w->pos += 1;
    return 0;
}

static int w_bytes(writer_t *w, const void *data, size_t n)
{
    if (!w_room(w, n)) return -1;
    memcpy(w->buf + w->pos, data, n);
    w->pos += n;
    return 0;
}

static int w_name(writer_t *w, const char *name)
{
    uint8_t field[AMBIT3_SM_NAME_BYTES];
    size_t len = strlen(name);
    if (len > AMBIT3_SM_NAME_BYTES) {
        len = AMBIT3_SM_NAME_BYTES;
    }
    memset(field, 0, sizeof(field));
    memcpy(field, name, len);
    return w_bytes(w, field, sizeof(field));
}

/* Reserves a 4-byte tag header, to be filled in once the content length is known -
 * every container tag's length depends on what ends up inside it. */
static int w_reserve_header(writer_t *w, size_t *at)
{
    if (!w_room(w, 4)) return -1;
    *at = w->pos;
    w->pos += 4;
    return 0;
}

static void w_patch_header(writer_t *w, size_t at, uint16_t tag_id, size_t content_start)
{
    uint16_t length = (uint16_t)(w->pos - content_start);
    w->buf[at]     = (uint8_t)(tag_id & 0xff);
    w->buf[at + 1] = (uint8_t)(tag_id >> 8);
    w->buf[at + 2] = (uint8_t)(length & 0xff);
    w->buf[at + 3] = (uint8_t)(length >> 8);
}

static int build_settings(writer_t *w, const ambit3_sm_settings_t *s)
{
    size_t header_at, content_start;
    uint16_t cmid_low  = (uint16_t)(s->custom_mode_id & 0xffff);
    uint16_t cmid_high = (uint16_t)((s->custom_mode_id >> 16) & 0xffff);
    int i;

    if (w_reserve_header(w, &header_at) != 0) return -1;
    content_start = w->pos;

    if (w_name(w, s->name) != 0) return -1;
    if (w_put16(w, s->activity_id) != 0) return -1;
    if (w_put16(w, cmid_low) != 0) return -1;
    if (w_put16(w, cmid_high) != 0) return -1;
    if (w_put16(w, s->use_hw) != 0) return -1;
    if (w_put16(w, s->alti_baro_mode) != 0) return -1;
    if (w_put16(w, s->gps_power_mode) != 0) return -1;
    if (w_put16(w, s->recording_interval) != 0) return -1;
    if (w_put16(w, s->autolap) != 0) return -1;
    if (w_put16(w, s->hr_high) != 0) return -1;
    if (w_put16(w, s->hr_low) != 0) return -1;
    if (w_put16(w, s->hr_limits_use) != 0) return -1;
    if (w_put16(w, s->auto_start) != 0) return -1;
    if (w_put16(w, s->auto_pause) != 0) return -1;
    if (w_put16(w, s->auto_scrolling) != 0) return -1;
    if (w_put16(w, s->int_timer_flags) != 0) return -1;
    if (w_put16(w, s->int_timer_count) != 0) return -1;

    for (i = 0; i < AMBIT3_SM_INTERVAL_SLOTS; i++) {
        const ambit3_sm_interval_slot_t *slot = &s->intervals[i];
        if (w_put8(w, slot->flags) != 0) return -1;
        if (w_put8(w, slot->type) != 0) return -1;
        if (w_put16(w, slot->max_limit) != 0) return -1;
        if (w_put16(w, slot->min_limit) != 0) return -1;
        if (i == 0) {
            if (w_put16(w, slot->padding) != 0) return -1;
            if (w_put32(w, slot->len) != 0) return -1;
        }
    }

    if (w->pos - content_start != AMBIT3_SM_SETTINGS_SIZE) {
        return -1; /* the whole point of the fixed-size check: never write a mismatched
                      settings block, this project's convention of never silently guessing */
    }
    w_patch_header(w, header_at, TAG_EXERCISE_MODES_SETTING_NAME, content_start);
    return 0;
}

static int build_disp_field(writer_t *w, const ambit3_sm_disp_field_t *f)
{
    size_t field_at, field_content, setting_at, setting_content;
    size_t i;

    if (w_reserve_header(w, &field_at) != 0) return -1;
    field_content = w->pos;

    if (w_reserve_header(w, &setting_at) != 0) return -1;
    setting_content = w->pos;
    if (w_put16(w, f->index) != 0) return -1;
    if (w_put16(w, f->type) != 0) return -1;
    w_patch_header(w, setting_at, TAG_EXERCISE_MODES_DISP_FIELD_SETTING, setting_content);

    for (i = 0; i < f->shortcut_count; i++) {
        size_t sc_at, sc_content;
        if (w_reserve_header(w, &sc_at) != 0) return -1;
        sc_content = w->pos;
        if (w_put16(w, f->shortcuts[i]) != 0) return -1;
        w_patch_header(w, sc_at, TAG_EXERCISE_MODES_DISP_FIELD_SHORTCUT, sc_content);
    }

    w_patch_header(w, field_at, TAG_EXERCISE_MODES_DISP_FIELD, field_content);
    return 0;
}

static int build_display(writer_t *w, const ambit3_sm_display_t *d)
{
    size_t disp_at, disp_content, setting_at, setting_content;
    size_t i;

    if (w_reserve_header(w, &disp_at) != 0) return -1;
    disp_content = w->pos;

    if (w_reserve_header(w, &setting_at) != 0) return -1;
    setting_content = w->pos;
    if (w_put16(w, d->template_id) != 0) return -1;
    if (w_put16(w, d->type) != 0) return -1;
    w_patch_header(w, setting_at, TAG_EXERCISE_MODES_DISP_SETTING, setting_content);

    for (i = 0; i < d->field_count; i++) {
        if (build_disp_field(w, &d->fields[i]) != 0) return -1;
    }

    w_patch_header(w, disp_at, TAG_EXERCISE_MODES_DISPLAY, disp_content);
    return 0;
}

static int build_mode(writer_t *w, const ambit3_sm_mode_t *m)
{
    size_t mode_at, mode_content, disps_at, disps_content, rules_at, rules_content;
    size_t i;

    if (w_reserve_header(w, &mode_at) != 0) return -1;
    mode_content = w->pos;

    if (build_settings(w, &m->settings) != 0) return -1;

    if (m->has_app_meta) {
        size_t meta_at, meta_content;
        if (w_reserve_header(w, &meta_at) != 0) return -1;
        meta_content = w->pos;
        if (w_put32(w, m->app_meta_ts1) != 0) return -1;
        if (w_put32(w, m->app_meta_ts2) != 0) return -1;
        w_patch_header(w, meta_at, TAG_EXERCISE_MODES_APP_META, meta_content);
    }

    /* Tag order (SETTINGS, APP_META, DISPLAYS, RULES) matches
     * training_program_andre.md's confirmed-real ordering - not append-at-the-end, which
     * that investigation found and fixed once already for the app-install path. */
    if (w_reserve_header(w, &disps_at) != 0) return -1;
    disps_content = w->pos;
    for (i = 0; i < m->display_count; i++) {
        if (build_display(w, &m->displays[i]) != 0) return -1;
    }
    w_patch_header(w, disps_at, TAG_EXERCISE_MODES_DISPLAYS, disps_content);

    if (m->rule_count > 0) {
        if (w_reserve_header(w, &rules_at) != 0) return -1;
        rules_content = w->pos;
        for (i = 0; i < m->rule_count; i++) {
            size_t rule_at, rule_content;
            if (w_reserve_header(w, &rule_at) != 0) return -1;
            rule_content = w->pos;
            if (w_put16(w, m->rules[i].rule_idx) != 0) return -1;
            if (w_put16(w, m->rules[i].use_rule) != 0) return -1;
            if (w_put16(w, m->rules[i].log_rule) != 0) return -1;
            w_patch_header(w, rule_at, TAG_EXERCISE_MODES_RULE, rule_content);
        }
        w_patch_header(w, rules_at, TAG_EXERCISE_MODES_RULES, rules_content);
    }

    w_patch_header(w, mode_at, TAG_EXERCISE_MODES_MODE, mode_content);
    return 0;
}

static int build_sport_mode_slot(writer_t *w, const ambit3_sm_sport_mode_slot_t *slot)
{
    size_t slot_at, slot_content, name_at, name_content, act_at, act_content;
    size_t i;

    if (w_reserve_header(w, &slot_at) != 0) return -1;
    slot_content = w->pos;

    if (w_reserve_header(w, &name_at) != 0) return -1;
    name_content = w->pos;
    if (w_name(w, slot->name) != 0) return -1;
    w_patch_header(w, name_at, TAG_SPORT_MODE_SETTING_NAME, name_content);

    if (w_reserve_header(w, &act_at) != 0) return -1;
    act_content = w->pos;
    if (w_put16(w, slot->activity_id) != 0) return -1;
    w_patch_header(w, act_at, TAG_SPORT_MODE_ACTIVITY_ID, act_content);

    for (i = 0; i < slot->exercise_count; i++) {
        size_t ex_at, ex_content;
        if (w_reserve_header(w, &ex_at) != 0) return -1;
        ex_content = w->pos;
        if (w_put16(w, slot->exercises[i]) != 0) return -1;
        w_patch_header(w, ex_at, TAG_SPORT_MODE_EXERCISE, ex_content);
    }

    {
        size_t order_at, order_content;
        if (w_reserve_header(w, &order_at) != 0) return -1;
        order_content = w->pos;
        if (w_put32(w, slot->order) != 0) return -1;
        w_patch_header(w, order_at, TAG_SPORT_MODE_ORDER, order_content);
    }
    if (slot->has_app_meta) {
        size_t meta_at, meta_content;
        if (w_reserve_header(w, &meta_at) != 0) return -1;
        meta_content = w->pos;
        if (w_put32(w, slot->app_meta) != 0) return -1;
        w_patch_header(w, meta_at, TAG_SPORT_MODE_APP_META, meta_content);
    }

    w_patch_header(w, slot_at, TAG_SPORT_MODE, slot_content);
    return 0;
}

int ambit3_sport_modes_build(const ambit3_sm_mode_t *modes, size_t mode_count,
                             const ambit3_sm_sport_mode_slot_t *sport_modes,
                             size_t sport_mode_count, uint16_t format_type,
                             uint8_t region[AMBIT3_SM_REGION_SIZE])
{
    writer_t w;
    size_t root_at, root_content, ex_at, ex_content, type_at, type_content;
    size_t sm_at, sm_content;
    size_t i;

    if (mode_count > AMBIT3_SM_MAX_MODES || sport_mode_count > AMBIT3_SM_MAX_SPORT_MODES) {
        return -1;
    }

    w.buf = region;
    w.cap = AMBIT3_SM_REGION_SIZE;
    w.pos = 0;

    if (w_reserve_header(&w, &root_at) != 0) return -1;
    root_content = w.pos;

    if (w_reserve_header(&w, &ex_at) != 0) return -1;
    ex_content = w.pos;

    if (w_reserve_header(&w, &type_at) != 0) return -1;
    type_content = w.pos;
    if (w_put16(&w, format_type) != 0) return -1;
    w_patch_header(&w, type_at, TAG_EXERCISE_MODES_TYPE, type_content);

    for (i = 0; i < mode_count; i++) {
        if (build_mode(&w, &modes[i]) != 0) return -1;
    }
    w_patch_header(&w, ex_at, TAG_EXERCISE_MODES, ex_content);

    if (w_reserve_header(&w, &sm_at) != 0) return -1;
    sm_content = w.pos;
    for (i = 0; i < sport_mode_count; i++) {
        if (build_sport_mode_slot(&w, &sport_modes[i]) != 0) return -1;
    }
    w_patch_header(&w, sm_at, TAG_SPORT_MODES, sm_content);

    w_patch_header(&w, root_at, TAG_DEVICE_CUSTOM, root_content);

    {
        size_t body_len = w.pos;
        /* Pad the rest of the region with 0xff (unwritten-flash convention already used
         * for every other region this project has read - Apps, CustomModes itself). Does
         * NOT claim this is the real closing structure - see this file's header. */
        memset(region + body_len, 0xff, AMBIT3_SM_REGION_SIZE - body_len);
        return (int)body_len;
    }
}
