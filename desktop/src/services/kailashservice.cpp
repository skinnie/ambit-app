#include "kailashservice.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QUrlQuery>

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

        m_visitedPlaces.clear();
        for (const auto &v : obj.value(QStringLiteral("visited_places")).toArray()) {
            const auto p = v.toObject();
            QVariantMap place;
            place[QStringLiteral("lat")] = p.value(QStringLiteral("lat")).toDouble();
            place[QStringLiteral("lon")] = p.value(QStringLiteral("lon")).toDouble();
            place[QStringLiteral("country")] = p.value(QStringLiteral("country")).toString();
            m_visitedPlaces.append(place);
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

void KailashService::refreshHomeLocation(double latitude, double longitude)
{
    m_hasHomeLocation = true;
    m_homeLatitude = latitude;
    m_homeLongitude = longitude;
    m_homeCity = QString();
    emit homeLocationChanged();

    // Same real Nominatim reverse-geocode WeatherService::fetchPlaceName() already uses -
    // see that function's own comments for the address-hierarchy fallback reasoning and the
    // real-User-Agent requirement (OSM's own usage policy).
    QUrl url(QStringLiteral("https://nominatim.openstreetmap.org/reverse"));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("lat"), QString::number(latitude));
    query.addQueryItem(QStringLiteral("lon"), QString::number(longitude));
    query.addQueryItem(QStringLiteral("format"), QStringLiteral("json"));
    query.addQueryItem(QStringLiteral("zoom"), QStringLiteral("10"));  // city/town level
    url.setQuery(query);

    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("AmbitApp/2.0"));

    QNetworkReply *reply = m_network.get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply, latitude, longitude] {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError)
            return;  // same "just don't show it" rule WeatherService's own lookup uses
        // A later call for different coordinates may have started (and finished) while
        // this one was in flight - don't let a stale reply overwrite a newer result.
        if (m_homeLatitude != latitude || m_homeLongitude != longitude)
            return;

        const auto doc = QJsonDocument::fromJson(reply->readAll());
        const auto address = doc.object().value(QStringLiteral("address")).toObject();
        for (const auto &key : {"city", "town", "village", "municipality", "county"}) {
            const auto value = address.value(QLatin1String(key)).toString();
            if (!value.isEmpty()) {
                m_homeCity = value;
                emit homeLocationChanged();
                break;
            }
        }
    });
}
