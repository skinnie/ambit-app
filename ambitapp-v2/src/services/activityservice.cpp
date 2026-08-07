#include "activityservice.h"

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QStandardPaths>
#include <QXmlStreamReader>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

ActivityService::ActivityService(QObject *parent) : QObject(parent) {}

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

    QNetworkReply *reply = m_network.get(
        QNetworkRequest(QUrl(kBackendBase + QStringLiteral("/api/activities"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);

        if (reply->error() != QNetworkReply::NoError) {
            m_ok = loadFromCache();
            if (!m_ok)
                setLastError(reply->errorString());
            emit activitiesChanged();
            return;
        }

        const auto doc = QJsonDocument::fromJson(reply->readAll());
        const auto root = doc.object();
        const bool liveOk = root.value(QStringLiteral("ok")).toBool();
        if (!liveOk) {
            m_ok = loadFromCache();
            if (!m_ok)
                setLastError(root.value(QStringLiteral("stderr")).toString());
            emit activitiesChanged();
            return;
        }

        m_ok = true;
        m_showingCachedData = false;
        m_activities.clear();
        const auto rawList = root.value(QStringLiteral("activities")).toArray();
        for (const auto &rawValue : rawList) {
            const auto rawObj = rawValue.toObject();
            const QString gpxText = rawObj.value(QStringLiteral("gpx")).toString();
            QVariantMap parsed = parseGpx(gpxText);
            parsed[QStringLiteral("index")] = rawObj.value(QStringLiteral("index")).toInt();
            // Kept for real 2026-08-07: Export GPX/FIT (ActivitiesPage.qml) and the local
            // offline cache below both need the exact bytes exercise_log.py's to_gpx()/
            // to_fit() produced, not a re-serialization of the fields parseGpx() extracted
            // from it - those are a lossy subset (no <extensions> round-trip, etc.).
            parsed[QStringLiteral("gpxText")] = gpxText;
            parsed[QStringLiteral("fitBase64")] =
                rawObj.value(QStringLiteral("fit_base64")).toString();
            m_activities.append(parsed);
        }
        saveToCache(rawList);
        emit activitiesChanged();
    });
}

QString ActivityService::cacheDir()
{
    return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)
        + QStringLiteral("/activities_cache");
}

void ActivityService::saveToCache(const QJsonArray &rawActivities)
{
    const QString dir = cacheDir();
    QDir().mkpath(dir);
    for (const auto &rawValue : rawActivities) {
        const auto rawObj = rawValue.toObject();
        const int index = rawObj.value(QStringLiteral("index")).toInt();
        QFile gpxFile(QStringLiteral("%1/move%2.gpx").arg(dir).arg(index));
        if (gpxFile.open(QIODevice::WriteOnly | QIODevice::Text))
            gpxFile.write(rawObj.value(QStringLiteral("gpx")).toString().toUtf8());

        const QString fitBase64 = rawObj.value(QStringLiteral("fit_base64")).toString();
        if (!fitBase64.isEmpty()) {
            QFile fitFile(QStringLiteral("%1/move%2.fit").arg(dir).arg(index));
            if (fitFile.open(QIODevice::WriteOnly))
                fitFile.write(QByteArray::fromBase64(fitBase64.toUtf8()));
        }
    }
}

bool ActivityService::loadFromCache()
{
    const QDir dir(cacheDir());
    const QStringList gpxFiles =
        dir.entryList({QStringLiteral("move*.gpx")}, QDir::Files, QDir::Name);
    if (gpxFiles.isEmpty())
        return false;

    m_activities.clear();
    for (const QString &fileName : gpxFiles) {
        QFile file(dir.filePath(fileName));
        if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
            continue;
        const QString gpxText = QString::fromUtf8(file.readAll());
        QVariantMap parsed = parseGpx(gpxText);
        // "moveN.gpx" -> N, same index the live path uses, so a cached and a live
        // activities[] entry always mean the same watch-side move.
        const QString stem = fileName.mid(4, fileName.size() - 4 - 4);  // strip "move"/".gpx"
        parsed[QStringLiteral("index")] = stem.toInt();
        parsed[QStringLiteral("gpxText")] = gpxText;
        const QString fitPath = dir.filePath(QStringLiteral("move%1.fit").arg(stem));
        QFile fitFile(fitPath);
        parsed[QStringLiteral("fitBase64")] =
            fitFile.open(QIODevice::ReadOnly) ? QString::fromLatin1(fitFile.readAll().toBase64())
                                               : QString();
        m_activities.append(parsed);
    }
    m_showingCachedData = !m_activities.isEmpty();
    return m_showingCachedData;
}
