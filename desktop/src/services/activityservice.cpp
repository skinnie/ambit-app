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
            }
        }
    }

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
        m_activities.append(parsed);
    }
    m_showingCachedData = !m_activities.isEmpty();
    return !m_activities.isEmpty();
}
