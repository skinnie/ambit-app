#include "kailashservice.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

KailashService::KailashService(QObject *parent) : QObject(parent)
{
}

QUrl KailashService::backendUrl(const QString &path)
{
    return QUrl(kBackendBase + path);
}

void KailashService::setLoading(bool value)
{
    if (m_loading == value)
        return;
    m_loading = value;
    emit loadingChanged();
}

void KailashService::setLastError(const QString &message)
{
    m_lastError = message;
    emit lastErrorChanged();
}

void KailashService::refreshHistory()
{
    setLoading(true);
    QNetworkReply *reply =
        m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/kailash/history"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        m_historyOk = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();

        if (!m_historyOk) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("GET /api/kailash/history: %1").arg(reply->errorString())
                : QStringLiteral("GET /api/kailash/history: %1")
                    .arg(obj.value(QStringLiteral("error")).toString(
                        obj.value(QStringLiteral("stderr")).toString())));
            emit historyChanged();
            return;
        }

        m_citiesVisited = obj.value(QStringLiteral("cities_visited")).toInt();
        m_countriesVisited = obj.value(QStringLiteral("countries_visited")).toInt();
        m_lastKnownCountry = obj.value(QStringLiteral("last_known_country")).toString();
        m_lastKnownTime = obj.value(QStringLiteral("last_known_time")).toString();
        m_travellingDays = obj.value(QStringLiteral("travelling_days")).toInt();
        m_travelledDistanceMeters = obj.value(QStringLiteral("travelled_distance_m")).toDouble();
        m_furthestFromHomeMeters = obj.value(QStringLiteral("furthest_from_home_m")).toDouble();

        const auto loc = obj.value(QStringLiteral("last_known_location")).toArray();
        m_hasLastKnownLocation = (loc.size() == 2);
        if (m_hasLastKnownLocation) {
            m_lastKnownLatitude = loc.at(0).toDouble();
            m_lastKnownLongitude = loc.at(1).toDouble();
        }

        m_sessions.clear();
        for (const auto &v : obj.value(QStringLiteral("sessions")).toArray()) {
            const auto s = v.toObject();
            QVariantMap session;
            session[QStringLiteral("when")] = s.value(QStringLiteral("when")).toString();
            session[QStringLiteral("durationSeconds")] =
                s.value(QStringLiteral("duration_s")).toDouble();
            session[QStringLiteral("distanceMeters")] =
                s.value(QStringLiteral("distance_m")).toDouble();
            session[QStringLiteral("maxSpeed")] = s.value(QStringLiteral("max_speed")).toDouble();
            m_sessions.append(session);
        }

        setLastError(QString());
        emit historyChanged();
    });
}

void KailashService::refreshTrackLog()
{
    setLoading(true);
    QNetworkReply *reply =
        m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/kailash/tracklog"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        m_trackLogOk = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();

        if (!m_trackLogOk) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("GET /api/kailash/tracklog: %1").arg(reply->errorString())
                : QStringLiteral("GET /api/kailash/tracklog: %1")
                    .arg(obj.value(QStringLiteral("error")).toString(
                        obj.value(QStringLiteral("stderr")).toString())));
            emit trackLogChanged();
            return;
        }

        const auto activity = obj.value(QStringLiteral("activity")).toObject();
        QVariantMap map;
        map[QStringLiteral("name")] = activity.value(QStringLiteral("name")).toString();
        map[QStringLiteral("startTime")] = activity.value(QStringLiteral("startTime")).toString();
        map[QStringLiteral("distanceMeters")] =
            activity.value(QStringLiteral("distanceMeters")).toDouble();
        map[QStringLiteral("durationSeconds")] =
            activity.value(QStringLiteral("durationSeconds")).toDouble();
        // No confirmed altitude field in TrackLog and no FIT writer for this format yet
        // (see kailash_tracklog.py's own docstring) - filled with the same defaults
        // ActivityCard/MapView already tolerate for a GPX-only activity.
        map[QStringLiteral("ascentMeters")] = 0;
        map[QStringLiteral("sportTypeRaw")] = -1;
        map[QStringLiteral("fitBase64")] = QString();
        map[QStringLiteral("gpxText")] = activity.value(QStringLiteral("gpxText")).toString();

        QVariantList track;
        for (const auto &v : activity.value(QStringLiteral("track")).toArray()) {
            const auto p = v.toObject();
            QVariantMap point;
            point[QStringLiteral("lat")] = p.value(QStringLiteral("lat")).toDouble();
            point[QStringLiteral("lon")] = p.value(QStringLiteral("lon")).toDouble();
            point[QStringLiteral("ele")] = 0;  // not part of this format, see docstring
            track.append(point);
        }
        map[QStringLiteral("track")] = track;

        m_trackLogActivity = map;
        setLastError(QString());
        emit trackLogChanged();
    });
}
