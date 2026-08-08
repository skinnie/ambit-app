#include <jni.h>
#include <android/log.h>
#include <string>
#include <sstream>
#include <iomanip>
#include <cstring>
#include <ctime>
#include <vector>
#include <set>

// ─── libambit ─────────────────────────────────────────────────────────────────
#include "libambit/libambit.h"

// libambit_new_from_fd() est déclaré dans libambit_android.c
extern "C" ambit_object_t *libambit_new_from_fd(int fd, int ep_in, int ep_out,
                                                 uint16_t vid, uint16_t pid);

#undef  LOG_TAG
#define LOG_TAG "AmbitJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// ─── État global ──────────────────────────────────────────────────────────────

static ambit_object_t *g_device = nullptr;

// Cache des logs lus (rempli lors de nativeAmbitGetLogCount, consommé par nativeAmbitGetLogAsGpx)
static std::vector<std::string> g_log_cache;

// IDs des activités déjà synchronisées — format "YYYYMMDDTHHMMSS"
// Rempli par nativeAmbitGetLogCount avant chaque lecture
static std::set<std::string> g_known_dates;

// Formate la date d'un header en ID comparable à ceux stockés en DB
static std::string formatLogId(const ambit_log_header_t *h)
{
    char buf[20];
    snprintf(buf, sizeof(buf), "%04d%02d%02dT%02d%02d%02d",
             h->date_time.year, h->date_time.month, h->date_time.day,
             h->date_time.hour, h->date_time.minute,
             (int)(h->date_time.msec / 1000));
    return std::string(buf);
}

// ─── Conversion log → GPX ─────────────────────────────────────────────────────
//
// ambit_log_entry_t contient :
//   - header.date_time  (ambit_date_time_t : year/month/day/hour/minute/msec)
//   - header.activity_name, header.duration (ms), header.distance (m), header.ascent (m)
//   - samples : tableau de ambit_log_sample_t
//
// Types de samples avec coordonnées GPS :
//   ambit_log_sample_type_gps_base  → u.gps_base.latitude/longitude/altitude (×10^-7, ×0.01 m)
//   ambit_log_sample_type_gps_small → u.gps_small.latitude/longitude
//   ambit_log_sample_type_gps_tiny  → u.gps_tiny.latitude/longitude
//   ambit_log_sample_type_periodic  → u.periodic.values[] contenant lat/lon séparément

static std::string convertEntryToGpx(const ambit_log_entry_t *entry)
{
    std::ostringstream gpx;

    // Formater la date ISO 8601
    char date_buf[32];
    snprintf(date_buf, sizeof(date_buf), "%04d-%02d-%02dT%02d:%02d:%02dZ",
             entry->header.date_time.year,
             entry->header.date_time.month,
             entry->header.date_time.day,
             entry->header.date_time.hour,
             entry->header.date_time.minute,
             (int)(entry->header.date_time.msec / 1000));

    // activity_name peut être non-null mais pointer vers une chaîne vide (NUL)
    const char *act_raw  = entry->header.activity_name;
    bool        act_ok   = act_raw && act_raw[0] != '\0';
    uint8_t     act_type = entry->header.activity_type;

    __android_log_print(ANDROID_LOG_DEBUG, "AmbitJNI",
        "Activity: name='%s' sport_type=0x%02x(%d)",
        act_raw ? act_raw : "(null)", act_type, act_type);

    gpx << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        << "<gpx version=\"1.1\" creator=\"AmbitSyncModern\""
        << " xmlns=\"http://www.topografix.com/GPX/1/1\""
        << " xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v1\">\n"
        << "  <metadata><time>" << date_buf << "</time></metadata>\n"
        << "  <trk><name>" << (act_ok ? act_raw : "") << "</name>\n"
        << "    <extensions>\n"
        << "      <duration>"    << entry->header.duration / 1000 << "</duration>\n"
        << "      <distance>"    << entry->header.distance         << "</distance>\n"
        << "      <ascent>"      << entry->header.ascent           << "</ascent>\n"
        << "      <sport_type>"  << (int)act_type                  << "</sport_type>\n"
        << "    </extensions>\n"
        << "  <trkseg>\n";

    // État GPS courant — mis à jour par gps_base, complété par gps_small/tiny/periodic
    double cur_lat = 0.0, cur_lon = 0.0, cur_ele = 0.0;
    bool   has_pos = false;
    uint32_t cur_time_ms = 0;  // temps depuis le début en ms

    // Calculer le timestamp Unix de début (approximatif, seconds depuis epoch)
    struct tm start_tm = {};
    start_tm.tm_year  = entry->header.date_time.year  - 1900;
    start_tm.tm_mon   = entry->header.date_time.month - 1;
    start_tm.tm_mday  = entry->header.date_time.day;
    start_tm.tm_hour  = entry->header.date_time.hour;
    start_tm.tm_min   = entry->header.date_time.minute;
    start_tm.tm_sec   = (int)(entry->header.date_time.msec / 1000);
    time_t start_epoch = mktime(&start_tm);

    for (uint32_t i = 0; i < entry->samples_count; i++) {
        const ambit_log_sample_t &s = entry->samples[i];
        cur_time_ms = s.time;

        bool emit = false;

        if (s.type == ambit_log_sample_type_gps_base) {
            cur_lat = s.u.gps_base.latitude  / 1e7;
            cur_lon = s.u.gps_base.longitude / 1e7;
            cur_ele = s.u.gps_base.altitude  / 100.0;  // cm → m
            has_pos = true;
            emit    = true;
        }
        else if (s.type == ambit_log_sample_type_gps_small) {
            cur_lat = s.u.gps_small.latitude  / 1e7;
            cur_lon = s.u.gps_small.longitude / 1e7;
            has_pos = true;
            emit    = true;
        }
        else if (s.type == ambit_log_sample_type_gps_tiny) {
            cur_lat = s.u.gps_tiny.latitude  / 1e7;
            cur_lon = s.u.gps_tiny.longitude / 1e7;
            has_pos = true;
            emit    = true;
        }
        else if (s.type == ambit_log_sample_type_periodic && has_pos) {
            // Les samples périodiques peuvent contenir lat/lon séparément
            double lat = cur_lat, lon = cur_lon;
            bool lat_ok = false, lon_ok = false;
            for (uint8_t v = 0; v < s.u.periodic.value_count; v++) {
                const ambit_log_sample_periodic_value_t &pv = s.u.periodic.values[v];
                if (pv.type == ambit_log_sample_periodic_type_latitude)  { lat = pv.u.latitude  / 1e7; lat_ok = true; }
                if (pv.type == ambit_log_sample_periodic_type_longitude) { lon = pv.u.longitude / 1e7; lon_ok = true; }
                // Ne pas écraser cur_ele avec l'altitude barométrique periodique :
                // elle diverge souvent de l'altitude GPS (gps_base) et cause des D+ délirants.
            }
            if (lat_ok && lon_ok) { cur_lat = lat; cur_lon = lon; emit = true; }
        }

        if (emit && has_pos && (cur_lat != 0.0 || cur_lon != 0.0)) {
            time_t point_epoch = start_epoch + (time_t)(cur_time_ms / 1000);
            struct tm *ptm = gmtime(&point_epoch);
            char time_buf[32];
            strftime(time_buf, sizeof(time_buf), "%Y-%m-%dT%H:%M:%SZ", ptm);

            gpx << std::fixed << std::setprecision(7)
                << "    <trkpt lat=\"" << cur_lat << "\" lon=\"" << cur_lon << "\">"
                << "<ele>" << std::setprecision(1) << cur_ele << "</ele>"
                << "<time>" << time_buf << "</time>"
                << "</trkpt>\n";
        }
    }

    gpx << "  </trkseg></trk>\n</gpx>";
    return gpx.str();
}

// ─── Callback libambit_log_read ────────────────────────────────────────────────

static void log_push_callback(void *userdata, ambit_log_entry_t *log_entry)
{
    (void)userdata;
    std::string gpx = convertEntryToGpx(log_entry);
    g_log_cache.push_back(gpx);
    LOGI("log_push_callback: log #%zu ajouté (%zu bytes)",
         g_log_cache.size(), gpx.size());
    // Ne pas libérer ici : device_driver_ambit.c appelle libambit_log_entry_free après push_cb
}

static int log_skip_callback(void *userdata, ambit_log_header_t *log_header)
{
    (void)userdata;
    if (g_known_dates.empty()) return 1;  // rien à skipper
    std::string id = formatLogId(log_header);
    int skip = g_known_dates.count(id) ? 0 : 1;
    if (skip == 0) LOGI("log_skip_callback: skip %s (déjà synchro)", id.c_str());
    return skip;  // 0 = skipper, 1 = lire
}

// ─── JNI ──────────────────────────────────────────────────────────────────────

extern "C" {

/**
 * nativeAmbitInit
 *
 * @param fd     FileDescriptor de la connexion USB Android
 * @param epIn   Adresse endpoint interrupt IN  (ex: 0x81)
 * @param epOut  Adresse endpoint interrupt OUT (ex: 0x01), ou -1
 * @param vid    Vendor ID Suunto (0x1493)
 * @param pid    Product ID Suunto (0x001C Ambit3 Sport, 0x0010 Ambit 1…)
 */
JNIEXPORT jboolean JNICALL
Java_com_ambitsyncmodern_usb_AmbitUsbModule_nativeAmbitInit(
        JNIEnv * /* env */, jobject /* thiz */,
        jint fd, jint epIn, jint epOut, jint vid, jint pid)
{
    LOGI("nativeAmbitInit fd=%d epIn=0x%02x epOut=0x%02x vid=0x%04x pid=0x%04x",
         fd, epIn, epOut, vid, pid);

    // Fermer un éventuel device précédent
    if (g_device) {
        libambit_close(g_device);
        g_device = nullptr;
    }
    g_log_cache.clear();

    g_device = libambit_new_from_fd(fd, epIn, epOut,
                                    (uint16_t)vid, (uint16_t)pid);
    if (!g_device) {
        LOGE("libambit_new_from_fd failed : VID/PID 0x%04x/0x%04x non supporté", vid, pid);
        return JNI_FALSE;
    }

    LOGI("Ambit initialisé avec succès (driver sélectionné)");
    return JNI_TRUE;
}

/**
 * nativeAmbitGetLogCount
 *
 * Lit TOUS les logs depuis la montre et les met en cache (g_log_cache).
 * Retourne le nombre de logs lus, ou -1 en cas d'erreur.
 * Opération synchrone longue — appelée depuis un thread background Kotlin.
 */
JNIEXPORT jint JNICALL
Java_com_ambitsyncmodern_usb_AmbitUsbModule_nativeAmbitGetLogCount(
        JNIEnv *env, jobject /* thiz */, jobjectArray knownDates)
{
    if (!g_device) { LOGE("Not initialized"); return -1; }

    // Charger les IDs déjà connus pour le skip_callback
    g_known_dates.clear();
    if (knownDates) {
        jsize n = env->GetArrayLength(knownDates);
        for (jsize i = 0; i < n; i++) {
            auto jstr = (jstring)env->GetObjectArrayElement(knownDates, i);
            const char *s = env->GetStringUTFChars(jstr, nullptr);
            g_known_dates.insert(s);
            env->ReleaseStringUTFChars(jstr, s);
            env->DeleteLocalRef(jstr);
        }
        LOGI("nativeAmbitGetLogCount: %zu IDs connus (skip activé)", g_known_dates.size());
    }

    g_log_cache.clear();
    int ret = libambit_log_read(g_device,
                                log_skip_callback,
                                log_push_callback,
                                nullptr,   // progress_callback
                                nullptr);  // userdata
    if (ret < 0) {
        LOGE("libambit_log_read failed: %d", ret);
        return -1;
    }
    LOGI("nativeAmbitGetLogCount: %zu logs lus", g_log_cache.size());
    return (jint)g_log_cache.size();
}

/**
 * nativeAmbitGetLogAsGpx
 *
 * Retourne le GPX du log à l'index donné depuis le cache g_log_cache.
 * Doit être appelé après nativeAmbitGetLogCount.
 */
JNIEXPORT jstring JNICALL
Java_com_ambitsyncmodern_usb_AmbitUsbModule_nativeAmbitGetLogAsGpx(
        JNIEnv *env, jobject /* thiz */, jint index)
{
    if ((size_t)index >= g_log_cache.size()) {
        LOGE("nativeAmbitGetLogAsGpx: index %d hors limites (cache=%zu)",
             index, g_log_cache.size());
        return nullptr;
    }
    return env->NewStringUTF(g_log_cache[(size_t)index].c_str());
}

/**
 * nativeAmbitSendSgee
 *
 * Envoie les éphémérides GPS à la montre via libambit_gps_orbit_write.
 */
JNIEXPORT jboolean JNICALL
Java_com_ambitsyncmodern_usb_AmbitUsbModule_nativeAmbitSendSgee(
        JNIEnv *env, jobject /* thiz */, jbyteArray data)
{
    if (!g_device) { LOGE("Not initialized"); return JNI_FALSE; }

    jsize len   = env->GetArrayLength(data);
    jbyte *bytes = env->GetByteArrayElements(data, nullptr);
    LOGI("nativeAmbitSendSgee: %d bytes", (int)len);

    int ret = libambit_gps_orbit_write(g_device, (uint8_t *)bytes, (size_t)len);
    env->ReleaseByteArrayElements(data, bytes, JNI_ABORT);

    if (ret != 0) { LOGE("libambit_gps_orbit_write failed: %d", ret); return JNI_FALSE; }
    return JNI_TRUE;
}

/**
 * nativeAmbitDisconnect
 */
JNIEXPORT void JNICALL
Java_com_ambitsyncmodern_usb_AmbitUsbModule_nativeAmbitDisconnect(
        JNIEnv * /* env */, jobject /* thiz */)
{
    LOGI("nativeAmbitDisconnect");
    g_log_cache.clear();
    if (g_device) {
        libambit_close(g_device);
        g_device = nullptr;
    }
}

} // extern "C"
