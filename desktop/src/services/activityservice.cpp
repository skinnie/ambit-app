#include "activityservice.h"

#include <QDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QSettings>
#include <QSqlError>
#include <QSqlQuery>
#include <QStandardPaths>
#include <QXmlStreamReader>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

ActivityService::ActivityService(QObject *parent) : QObject(parent)
{
    openDatabase();
}

void ActivityService::setLoading(bool value)
{
    if (m_loading == value)
        return;
    m_loading = value;
    emit loadingChanged();
}

void ActivityService::setLastError(const QString &message)
{
    m_lastError = message;
    emit lastErrorChanged();
}

// Parses exactly the shape tools/exercise_log.py's to_gpx() produces - see this class's own
// header comment. Deliberately narrow (no namespace-prefix handling, no alternate GPX
// dialects) since this only ever reads GPX this project generated itself, not arbitrary
// third-party files - that's a different, real need (Routes' "Import GPX" in Step 8) with
// its own, more defensive parser, not this one.
QVariantMap ActivityService::parseGpx(const QString &gpxText)
{
    QVariantMap result;
    result[QStringLiteral("name")] = QString();
    result[QStringLiteral("durationSeconds")] = 0;
    result[QStringLiteral("distanceMeters")] = 0;
    result[QStringLiteral("ascentMeters")] = 0;
    // kcal straight off the watch (see exercise_log.py's own comment on the unit). 0 means
    // "not recorded" - an older GPX in the cache predates this field entirely, and the UI
    // hides the figure rather than claiming the move cost nothing.
    result[QStringLiteral("energyKcal")] = 0;
    result[QStringLiteral("sportTypeRaw")] = -1;
    result[QStringLiteral("startTime")] = QString();
    // Richer summary metrics carried through from the watch log header (exercise_log.py).
    // -1 / 0 mean "not recorded" so the UI can hide the figure rather than show a false 0.
    result[QStringLiteral("avgHr")] = 0;
    result[QStringLiteral("maxHr")] = 0;
    result[QStringLiteral("avgCadence")] = 0;
    result[QStringLiteral("maxCadence")] = 0;
    result[QStringLiteral("avgSpeedMh")] = 0;     // metres/hour, watch's own unit
    result[QStringLiteral("maxSpeedMh")] = 0;
    result[QStringLiteral("descentMeters")] = 0;
    result[QStringLiteral("recoverySeconds")] = 0;
    result[QStringLiteral("peakTrainingEffect")] = 0;   // value*10 (35 -> 3.5)
    result[QStringLiteral("poolLengths")] = 0;
    result[QStringLiteral("maxAltitudeMeters")] = 0;

    QVariantList track;
    QXmlStreamReader xml(gpxText);
    QString currentTag;
    QString pendingLat, pendingLon, pendingEle;
    bool inExtensions = false;

    while (!xml.atEnd()) {
        const auto token = xml.readNext();
        if (token == QXmlStreamReader::StartElement) {
            const QString tag = xml.name().toString();
            if (tag == QStringLiteral("extensions")) {
                inExtensions = true;
            } else if (tag == QStringLiteral("trkpt")) {
                pendingLat = xml.attributes().value(QStringLiteral("lat")).toString();
                pendingLon = xml.attributes().value(QStringLiteral("lon")).toString();
                pendingEle.clear();
            }
            currentTag = tag;
        } else if (token == QXmlStreamReader::EndElement) {
            const QString tag = xml.name().toString();
            if (tag == QStringLiteral("extensions"))
                inExtensions = false;
            if (tag == QStringLiteral("trkpt")) {
                QVariantMap point;
                point[QStringLiteral("lat")] = pendingLat.toDouble();
                point[QStringLiteral("lon")] = pendingLon.toDouble();
                point[QStringLiteral("ele")] = pendingEle.toDouble();
                track.append(point);
            }
            currentTag.clear();
        } else if (token == QXmlStreamReader::Characters && !xml.isWhitespace()) {
            const QString text = xml.text().toString();
            if (currentTag == QStringLiteral("name")) {
                result[QStringLiteral("name")] = text;
            } else if (currentTag == QStringLiteral("ele")) {
                pendingEle = text;
            } else if (currentTag == QStringLiteral("time")
                       && result[QStringLiteral("startTime")].toString().isEmpty()) {
                result[QStringLiteral("startTime")] = text;
            } else if (inExtensions && currentTag == QStringLiteral("duration")) {
                result[QStringLiteral("durationSeconds")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("distance")) {
                result[QStringLiteral("distanceMeters")] = text.toDouble();
            } else if (inExtensions && currentTag == QStringLiteral("ascent")) {
                result[QStringLiteral("ascentMeters")] = text.toDouble();
            } else if (inExtensions && currentTag == QStringLiteral("energy")) {
                result[QStringLiteral("energyKcal")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("sport_type")) {
                result[QStringLiteral("sportTypeRaw")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("avg_hr")) {
                result[QStringLiteral("avgHr")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("max_hr")) {
                result[QStringLiteral("maxHr")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("avg_cadence")) {
                result[QStringLiteral("avgCadence")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("max_cadence")) {
                result[QStringLiteral("maxCadence")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("avg_speed")) {
                result[QStringLiteral("avgSpeedMh")] = text.toDouble();
            } else if (inExtensions && currentTag == QStringLiteral("max_speed")) {
                result[QStringLiteral("maxSpeedMh")] = text.toDouble();
            } else if (inExtensions && currentTag == QStringLiteral("descent")) {
                result[QStringLiteral("descentMeters")] = text.toDouble();
            } else if (inExtensions && currentTag == QStringLiteral("recovery_time")) {
                result[QStringLiteral("recoverySeconds")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("peak_training_effect")) {
                result[QStringLiteral("peakTrainingEffect")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("pool_lengths")) {
                result[QStringLiteral("poolLengths")] = text.toInt();
            } else if (inExtensions && currentTag == QStringLiteral("max_altitude")) {
                result[QStringLiteral("maxAltitudeMeters")] = text.toDouble();
            }
        }
    }

    // Derived: average pace (seconds per km). Prefer the watch's own avg speed; fall back to
    // distance/duration. 0 when there's no distance to pace against.
    const double distM = result.value(QStringLiteral("distanceMeters")).toDouble();
    const double durS = result.value(QStringLiteral("durationSeconds")).toDouble();
    const double avgSpeedMh = result.value(QStringLiteral("avgSpeedMh")).toDouble();
    double paceSecPerKm = 0;
    if (avgSpeedMh > 0)
        paceSecPerKm = 3600.0 * 1000.0 / avgSpeedMh;   // (s/h)*(m/km) / (m/h) = s/km
    else if (distM > 0 && durS > 0)
        paceSecPerKm = durS / (distM / 1000.0);
    result[QStringLiteral("paceSecPerKm")] = paceSecPerKm;

    // If the watch didn't record an average speed (older GPX, or a sport that doesn't), derive
    // it from distance/duration so the Avg-speed column still has something to show. The watch's
    // own value (moving average) is preferred when present.
    if (avgSpeedMh <= 0 && distM > 0 && durS > 0)
        result[QStringLiteral("avgSpeedMh")] = distM / (durS / 3600.0);

    result[QStringLiteral("track")] = track;
    return result;
}

void ActivityService::refresh()
{
    setLoading(true);
    setLastError(QString());
    requestActivities(dbKnownCount(), false);
}

void ActivityService::requestActivities(int knownCount, bool alreadyRetried)
{
    // Experimental "mark synced workouts as synced" toggle (DeviceService persists it to
    // this same QSettings key; read here rather than coupling the two services). When on,
    // ask the backend to write the watch's per-move synced flag after this read. Off by
    // default - see DeviceService::markSyncedEnabled's header comment.
    const bool markSynced =
        QSettings().value(QStringLiteral("experimental/markSynced"), false).toBool();
    QString path = QStringLiteral("/api/activities?known_count=%1").arg(knownCount);
    if (markSynced)
        path += QStringLiteral("&mark_synced=1");
    const QUrl url(kBackendBase + path);
    QNetworkReply *reply = m_network.get(QNetworkRequest(url));
    connect(reply, &QNetworkReply::finished, this, [this, reply, knownCount, alreadyRetried] {
        reply->deleteLater();

        if (reply->error() != QNetworkReply::NoError) {
            setLoading(false);
            m_ok = dbLoadAll();
            if (!m_ok)
                setLastError(reply->errorString());
            emit activitiesChanged();
            return;
        }

        const auto doc = QJsonDocument::fromJson(reply->readAll());
        const auto root = doc.object();
        const bool liveOk = root.value(QStringLiteral("ok")).toBool();
        if (!liveOk) {
            setLoading(false);
            m_ok = dbLoadAll();
            if (!m_ok)
                setLastError(root.value(QStringLiteral("stderr")).toString());
            emit activitiesChanged();
            return;
        }

        // Real total entry count straight from the watch (exercise_log.py's own
        // master.json, see server.py's own comment) - if it's LESS than what we already
        // knew, the watch's log wrapped/reset since our database was built, so our cached
        // indices no longer mean the same activities. One automatic retry from scratch
        // (known_count 0) rather than silently mixing old and new data under the same idx.
        const int totalEntries = root.value(QStringLiteral("total_entries")).toInt();
        if (totalEntries < knownCount && !alreadyRetried) {
            dbClear();
            requestActivities(0, true);
            return;
        }

        const auto rawList = root.value(QStringLiteral("activities")).toArray();
        for (const auto &rawValue : rawList) {
            const auto rawObj = rawValue.toObject();
            const int index = rawObj.value(QStringLiteral("index")).toInt();
            const QString gpxText = rawObj.value(QStringLiteral("gpx")).toString();
            const QString fitBase64 = rawObj.value(QStringLiteral("fit_base64")).toString();
            const QVariantMap parsed = parseGpx(gpxText);
            dbInsert(index, parsed, gpxText, fitBase64);
        }

        setLoading(false);
        m_ok = dbLoadAll();
        m_showingCachedData = false;
        emit activitiesChanged();
    });
}

void ActivityService::openDatabase()
{
    // A named connection (not the default one) - QML_SINGLETON means exactly one instance
    // of this class ever exists, but naming it anyway avoids the classic Qt trap where a
    // second addDatabase() call with the default connection name silently steals the first.
    m_db = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"), QStringLiteral("activities"));
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(dir);
    m_db.setDatabaseName(dir + QStringLiteral("/activities.db"));
    if (!m_db.open()) {
        setLastError(m_db.lastError().text());
        return;
    }
    QSqlQuery q(m_db);
    q.exec(QStringLiteral(
        "CREATE TABLE IF NOT EXISTS activities ("
        "idx INTEGER PRIMARY KEY, name TEXT, duration_s INTEGER, distance_m REAL, "
        "ascent_m REAL, energy_kcal INTEGER, sport_type_raw INTEGER, start_time TEXT, "
        "track_json TEXT, gpx_text TEXT, fit_base64 TEXT)"));
}

int ActivityService::dbKnownCount()
{
    if (!m_db.isOpen())
        return 0;
    QSqlQuery q(QStringLiteral("SELECT MAX(idx) FROM activities"), m_db);
    if (q.next())
        return q.value(0).toInt();  // NULL (empty table) -> QVariant().toInt() == 0
    return 0;
}

void ActivityService::dbClear()
{
    if (!m_db.isOpen())
        return;
    QSqlQuery q(m_db);
    q.exec(QStringLiteral("DELETE FROM activities"));
}

void ActivityService::dbInsert(int index, const QVariantMap &parsed, const QString &gpxText,
                                const QString &fitBase64)
{
    if (!m_db.isOpen())
        return;
    const QJsonDocument trackDoc(QJsonArray::fromVariantList(parsed.value(
        QStringLiteral("track")).toList()));

    QSqlQuery q(m_db);
    q.prepare(QStringLiteral(
        "INSERT OR REPLACE INTO activities "
        "(idx, name, duration_s, distance_m, ascent_m, energy_kcal, sport_type_raw, "
        " start_time, track_json, gpx_text, fit_base64) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"));
    q.addBindValue(index);
    q.addBindValue(parsed.value(QStringLiteral("name")));
    q.addBindValue(parsed.value(QStringLiteral("durationSeconds")));
    q.addBindValue(parsed.value(QStringLiteral("distanceMeters")));
    q.addBindValue(parsed.value(QStringLiteral("ascentMeters")));
    q.addBindValue(parsed.value(QStringLiteral("energyKcal")));
    q.addBindValue(parsed.value(QStringLiteral("sportTypeRaw")));
    q.addBindValue(parsed.value(QStringLiteral("startTime")));
    q.addBindValue(QString::fromUtf8(trackDoc.toJson(QJsonDocument::Compact)));
    q.addBindValue(gpxText);
    q.addBindValue(fitBase64);
    q.exec();
}

bool ActivityService::dbLoadAll()
{
    m_activities.clear();
    if (!m_db.isOpen())
        return false;

    QSqlQuery q(QStringLiteral(
        "SELECT idx, name, duration_s, distance_m, ascent_m, energy_kcal, sport_type_raw, "
        "start_time, track_json, gpx_text, fit_base64 FROM activities ORDER BY idx ASC"),
        m_db);
    while (q.next()) {
        QVariantMap parsed;
        parsed[QStringLiteral("index")] = q.value(0).toInt();
        parsed[QStringLiteral("name")] = q.value(1).toString();
        parsed[QStringLiteral("durationSeconds")] = q.value(2).toInt();
        parsed[QStringLiteral("distanceMeters")] = q.value(3).toDouble();
        parsed[QStringLiteral("ascentMeters")] = q.value(4).toDouble();
        parsed[QStringLiteral("energyKcal")] = q.value(5).toInt();
        parsed[QStringLiteral("sportTypeRaw")] = q.value(6).toInt();
        parsed[QStringLiteral("startTime")] = q.value(7).toString();
        const auto trackDoc = QJsonDocument::fromJson(q.value(8).toString().toUtf8());
        parsed[QStringLiteral("track")] = trackDoc.array().toVariantList();
        parsed[QStringLiteral("gpxText")] = q.value(9).toString();
        parsed[QStringLiteral("fitBase64")] = q.value(10).toString();
        // The richer metrics (HR/cadence/speed/pace/descent/…) aren't stored as their own DB
        // columns - re-parse the cached GPX text for them so the configurable Activities
        // columns work offline too, without a schema migration. Cheap: a local in-memory
        // string parse, and the extras just merge onto the fast DB core fields above.
        const QString gpx = q.value(9).toString();
        if (!gpx.isEmpty()) {
            const QVariantMap extra = parseGpx(gpx);
            for (const QString &key : {
                     QStringLiteral("avgHr"), QStringLiteral("maxHr"),
                     QStringLiteral("avgCadence"), QStringLiteral("maxCadence"),
                     QStringLiteral("avgSpeedMh"), QStringLiteral("maxSpeedMh"),
                     QStringLiteral("descentMeters"), QStringLiteral("recoverySeconds"),
                     QStringLiteral("peakTrainingEffect"), QStringLiteral("poolLengths"),
                     QStringLiteral("maxAltitudeMeters"), QStringLiteral("paceSecPerKm") }) {
                parsed[key] = extra.value(key);
            }
        }
        m_activities.append(parsed);
    }
    m_showingCachedData = !m_activities.isEmpty();
    return !m_activities.isEmpty();
}
