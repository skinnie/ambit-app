#include "deviceservice.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkInformation>
#include <QNetworkReply>
#include <QSettings>
#include <QStandardPaths>
#include <QTextStream>
#include <QTimeZone>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

DeviceService::DeviceService(QObject *parent) : QObject(parent)
{
    // Restore the persisted "Ephemeris GPS only" choice on launch.
    m_ephemerisGpsOnly = QSettings().value(QStringLiteral("ephemeris/gpsOnly"), false).toBool();
    m_pollTimer.setSingleShot(true);
    connect(&m_pollTimer, &QTimer::timeout, this, &DeviceService::refresh);

    m_heartbeatTimer.setSingleShot(true);
    connect(&m_heartbeatTimer, &QTimer::timeout, this, &DeviceService::refresh);

    // Whether we have a route to the internet, from Qt's own reachability backend. Asked
    // rather than probed: the clock and orbit features need this only to decide whether they
    // CAN run, and probing a server on every device poll would put real traffic on the wire
    // for something the OS already knows. If no backend loads (a stripped build, an unusual
    // platform), assume online - the update paths already report honestly when a download
    // fails, so a wrong "yes" costs one failed attempt while a wrong "no" would silently
    // disable a working feature.
    if (QNetworkInformation::loadDefaultBackend() && QNetworkInformation::instance()) {
        auto *info = QNetworkInformation::instance();
        auto apply = [this, info] {
            const bool up = info->reachability() == QNetworkInformation::Reachability::Online;
            if (up == m_online)
                return;
            m_online = up;
            emit onlineChanged();
        };
        connect(info, &QNetworkInformation::reachabilityChanged, this, apply);
        apply();
    } else {
        m_online = true;
    }
}

QUrl DeviceService::backendUrl(const QString &path)
{
    return QUrl(kBackendBase + path);
}

void DeviceService::setLoading(bool value)
{
    if (m_loading == value)
        return;
    m_loading = value;
    emit loadingChanged();
}

void DeviceService::logToFile(const QString &line)
{
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(dir);
    QFile file(dir + QStringLiteral("/ambitapp.log"));
    if (!file.open(QIODevice::Append | QIODevice::Text))
        return;  // real but non-critical - never blocks the actual UI/retry flow on this
    QTextStream out(&file);
    out << QDateTime::currentDateTime().toString(Qt::ISODate) << ' ' << line << '\n';
}

void DeviceService::setLastError(const QString &friendlyMessage, const QString &technicalDetail)
{
    // Found via real testing, 2026-08-07: this used to show Qt's own raw network error text
    // ("Error transferring http://127.0.0.1:8766/api/... - server replied: Bad Gateway")
    // directly in the UI - technically accurate, not actually useful to look at. The real
    // detail isn't thrown away, just moved to a real log file instead of the user's face.
    if (!technicalDetail.isEmpty())
        logToFile(friendlyMessage + QStringLiteral(" | ") + technicalDetail);
    m_lastError = friendlyMessage;
    emit lastErrorChanged();
}

void DeviceService::refreshDemoMode()
{
    QNetworkReply *reply =
        m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/demo"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError)
            return;
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool on = obj.value(QStringLiteral("enabled")).toBool();
        if (on == m_demoMode)
            return;
        m_demoMode = on;
        emit demoModeChanged();
    });
}

void DeviceService::setDemoMode(bool enabled)
{
    QNetworkRequest request(backendUrl(QStringLiteral("/api/demo")));
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                      QStringLiteral("application/json"));
    QJsonObject payload;
    payload.insert(QStringLiteral("enabled"), enabled);
    QNetworkReply *reply = m_network.post(request, QJsonDocument(payload).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        m_demoMode = obj.value(QStringLiteral("enabled")).toBool();
        emit demoModeChanged();
        // Switching either way changes what every page is looking at, so re-read now rather
        // than leaving the previous device's data on screen.
        m_autoSyncedThisConnection = true;   // never auto-write to a watch on a demo switch
        refresh();
    });
}

void DeviceService::refresh()
{
    m_pollTimer.stop();
    m_heartbeatTimer.stop();
    setLoading(true);

    QNetworkReply *reply = m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/health"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        const bool reachable = (reply->error() == QNetworkReply::NoError);
        if (m_backendReachable != reachable) {
            m_backendReachable = reachable;
            emit backendReachableChanged();
        }
        if (!reachable) {
            setLoading(false);
            setLastError(QStringLiteral("Backend not running"),
                QStringLiteral("GET /api/health: %1").arg(reply->errorString()));
            m_pollTimer.start(kPollIntervalMs);
            return;
        }
        fetchDeviceInfo();
    });
}

void DeviceService::fetchDeviceInfo()
{
    QNetworkReply *reply = m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/device"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);

        const auto doc = QJsonDocument::fromJson(reply->readAll());
        const auto obj = doc.object();
        m_deviceInfoOk = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();

        if (m_deviceInfoOk) {
            m_model = obj.value(QStringLiteral("model")).toString();
            m_serial = obj.value(QStringLiteral("serial")).toString();
            m_firmwareVersion = obj.value(QStringLiteral("fw_version")).toString();
            m_hardwareVersion = obj.value(QStringLiteral("hw_version")).toString();
            m_batteryPercent = obj.value(QStringLiteral("battery_percent")).toInt(-1);
            setLastError(QString(), QString());
            // Connected - real request 2026-08-08 ("if watch is connected don't refresh"):
            // m_pollTimer (the fast 1s "searching" poll) stays stopped. But a real
            // disconnect must still eventually be noticed (found live, same day: "it is
            // blocked on ambit connected even if it disconnected" - the manual Refresh
            // button was removed in the same change, so with nothing polling there was
            // no way back). This slow heartbeat re-checks every 10s while connected -
            // enough to catch a real unplug within a bounded time without hammering the
            // USB link the way continuous 1s polling would.
            m_heartbeatTimer.start(kHeartbeatIntervalMs);

            // Real request, 2026-08-11 (Andre, G2/G3): "clock, sync upon connection of the
            // watch if connected to internet" and the same for the GPS orbit. This is a
            // deliberate exception to this app's own "explicit tap for any write" rule -
            // both are self-correcting, low-risk operations (set the clock to now; refresh
            // ephemeris that expires on its own), and having to remember to tap them is
            // exactly the busywork the rule exists to avoid elsewhere.
            //
            // Guarded so it happens once per CONNECTION, not once per poll: the heartbeat
            // re-reads this endpoint every 10s while connected, and syncing on each of those
            // would write to the watch continuously. Offline, nothing is attempted at all
            // and the UI keeps its existing tap-to-sync message.
            if (!m_autoSyncedThisConnection && m_online) {
                m_autoSyncedThisConnection = true;
                syncTime();
                updateGpsOrbit();
            }
        } else {
            const QString technical = reply->error() != QNetworkReply::NoError
                ? QStringLiteral("GET /api/device: %1").arg(reply->errorString())
                : QStringLiteral("GET /api/device: %1")
                    .arg(obj.value(QStringLiteral("stderr")).toString());
            setLastError(QStringLiteral("Watch not connected"), technical);
            // Disconnected: the next connection is a new one and syncs again.
            m_autoSyncedThisConnection = false;
            // Not connected - real request 2026-08-08 ("if not connected, refresh with a 1
            // second interval"): keep polling, uncapped, until it connects.
            m_pollTimer.start(kPollIntervalMs);
        }
        emit deviceInfoChanged();
    });
}

void DeviceService::setEphemerisGpsOnly(bool value)
{
    if (m_ephemerisGpsOnly == value)
        return;
    m_ephemerisGpsOnly = value;
    // Same QSettings mechanism ConnectionsService already uses for credentials - one bool
    // needs no new service class.
    QSettings().setValue(QStringLiteral("ephemeris/gpsOnly"), value);
    emit ephemerisGpsOnlyChanged();
}

void DeviceService::updateGpsOrbit()
{
    m_gpsOrbitBusy = true;
    m_gpsOrbitStatusText = QStringLiteral("Checking...");
    emit gpsOrbitChanged();

    QNetworkRequest request(backendUrl(QStringLiteral("/api/agps/update")));
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                       QStringLiteral("application/json"));
    QJsonObject bodyObj;
    bodyObj.insert(QStringLiteral("confirm"), true);
    bodyObj.insert(QStringLiteral("gps_only"), m_ephemerisGpsOnly);
    const QByteArray body = QJsonDocument(bodyObj).toJson(QJsonDocument::Compact);
    QNetworkReply *reply = m_network.post(request, body);
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        m_gpsOrbitBusy = false;

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        if (reply->error() != QNetworkReply::NoError && obj.isEmpty()) {
            m_gpsOrbitStatusText =
                QStringLiteral("Couldn't reach the backend: %1").arg(reply->errorString());
            emit gpsOrbitChanged();
            return;
        }

        if (!obj.value(QStringLiteral("ok")).toBool()) {
            m_gpsOrbitStatusText = QStringLiteral("Failed: %1")
                .arg(obj.value(QStringLiteral("error")).toString(
                    obj.value(QStringLiteral("stderr")).toString()));
        } else if (obj.value(QStringLiteral("skipped")).toBool()) {
            // André, 2026-08-11: "If already synced and updated just say synced." The date
            // it is synced TO is already on this card, so repeating it here said nothing.
            m_gpsOrbitStatusText = QStringLiteral("Synced");
        } else if (obj.value(QStringLiteral("offline")).toBool()) {
            const QString watchDate = obj.value(QStringLiteral("watch_date")).toString();
            m_gpsOrbitStatusText = watchDate.isEmpty()
                ? QStringLiteral("No internet connection, and the watch has no orbit data yet")
                : QStringLiteral("No internet connection - watch's current data is from %1")
                    .arg(watchDate);
        } else if (obj.value(QStringLiteral("wrote")).toBool()) {
            m_gpsOrbitStatusText = QStringLiteral("Updated");
        } else {
            m_gpsOrbitStatusText = QStringLiteral("Synced");
        }
        emit gpsOrbitChanged();
    });
}

void DeviceService::checkGpsOrbitStatus()
{
    QNetworkReply *reply =
        m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/agps/status"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        if (reply->error() != QNetworkReply::NoError || !obj.value(QStringLiteral("ok")).toBool()) {
            // Same "just don't show it" rule as WeatherService's own place-name lookup -
            // this is a passive background check, not something worth surfacing an error
            // for on its own; the explicit "Update" button's own errors still show.
            return;
        }
        // André, 2026-08-11 (item 14): "If already synced and updated just say synced."
        // Orbit data is dated and expires, so "current" means the watch's own date is
        // today's - anything older is worth an update and says so with the date, which is
        // the one case where the date is useful.
        {
            const QString watchDate = obj.value(QStringLiteral("date")).toString();
            const QString today =
                QDateTime::currentDateTime().toString(QStringLiteral("yyyy-MM-dd"));
            if (!obj.value(QStringLiteral("valid")).toBool())
                m_gpsOrbitStatusText = QStringLiteral("No data yet - tap to update");
            else if (watchDate == today)
                m_gpsOrbitStatusText = QStringLiteral("Synced");
            else
                m_gpsOrbitStatusText = QStringLiteral("%1 - tap to update").arg(watchDate);
        }
        // Asked of the watch, not assumed from its model - see the header's own comment.
        m_glonassSupported = obj.value(QStringLiteral("glonass")).toObject()
            .value(QStringLiteral("supported")).toBool();
        emit gpsOrbitChanged();
    });
}

void DeviceService::syncTime(const QString &timezone)
{
    m_timeSyncBusy = true;
    m_timeSyncStatusText = QStringLiteral("Syncing...");
    emit timeSyncChanged();

    QNetworkRequest request(backendUrl(QStringLiteral("/api/time/sync")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QJsonObject bodyObj;
    if (!timezone.isEmpty()) {
        bodyObj.insert(QStringLiteral("timezone"), timezone);
    }
    QNetworkReply *reply = m_network.post(request, QJsonDocument(bodyObj).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        m_timeSyncBusy = false;

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        if (reply->error() != QNetworkReply::NoError && obj.isEmpty()) {
            m_timeSyncStatusText =
                QStringLiteral("Couldn't reach the backend: %1").arg(reply->errorString());
            emit timeSyncChanged();
            return;
        }

        if (!obj.value(QStringLiteral("ok")).toBool()) {
            m_timeSyncStatusText = QStringLiteral("Failed: %1")
                .arg(obj.value(QStringLiteral("error")).toString());
        } else {
            m_timeSyncStatusText = QStringLiteral("Synced to %1")
                .arg(obj.value(QStringLiteral("time")).toString());
        }
        emit timeSyncChanged();
    });
}

void DeviceService::fetchTimezones()
{
    if (!m_timezones.isEmpty()) {
        return;  // already fetched this session - zoneinfo's own list never changes at runtime
    }
    QNetworkReply *reply =
        m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/time/zones"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        if (reply->error() != QNetworkReply::NoError || !obj.value(QStringLiteral("ok")).toBool()) {
            return;
        }
        QStringList zones;
        for (const auto &v : obj.value(QStringLiteral("zones")).toArray()) {
            zones << v.toString();
        }
        m_timezones = zones;
        emit timezonesChanged();
    });
}

QString DeviceService::currentTimeInZone(const QString &timezone) const
{
    const QTimeZone tz(timezone.toUtf8());
    if (!tz.isValid()) {
        return QString();
    }
    // Real, 2026-08-10 ("it shows the date and that makes the hour no visible") - this is
    // shown inline next to a long zone name in a fixed-width dropdown row (HomePage.qml's
    // own tzCombo delegate); the full date+seconds this originally returned pushed the
    // actually-useful hour:minute off the visible edge. Just the time - picking a timezone
    // to compare "what hour is it there" doesn't need today's date repeated 599 times.
    return QDateTime::currentDateTime(tz).toString(QStringLiteral("HH:mm"));
}
