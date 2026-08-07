#include "deviceservice.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QStandardPaths>
#include <QTextStream>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

DeviceService::DeviceService(QObject *parent) : QObject(parent)
{
    m_retryTimer.setSingleShot(true);
    connect(&m_retryTimer, &QTimer::timeout, this, &DeviceService::refresh);

    m_autoRefreshTimer.setInterval(kAutoRefreshIntervalMs);
    connect(&m_autoRefreshTimer, &QTimer::timeout, this, &DeviceService::refresh);
    m_autoRefreshTimer.start();
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

void DeviceService::scheduleRetry()
{
    if (m_retryCount >= kMaxRetries) {
        logToFile(QStringLiteral("giving up after %1 retries").arg(m_retryCount));
        return;
    }
    m_retryCount++;
    m_retryTimer.start(kRetryIntervalMs);
}

void DeviceService::refresh()
{
    m_retryTimer.stop();
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
            scheduleRetry();
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
            m_retryCount = 0;
            setLastError(QString(), QString());
        } else {
            const QString technical = reply->error() != QNetworkReply::NoError
                ? QStringLiteral("GET /api/device: %1").arg(reply->errorString())
                : QStringLiteral("GET /api/device: %1")
                    .arg(obj.value(QStringLiteral("stderr")).toString());
            setLastError(QStringLiteral("Watch not connected"), technical);
            scheduleRetry();
        }
        emit deviceInfoChanged();
    });
}

void DeviceService::updateGpsOrbit()
{
    m_gpsOrbitBusy = true;
    m_gpsOrbitStatusText = QStringLiteral("Checking...");
    emit gpsOrbitChanged();

    QNetworkRequest request(backendUrl(QStringLiteral("/api/agps/update")));
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                       QStringLiteral("application/json"));
    const QByteArray body = QByteArrayLiteral(R"({"confirm": true})");
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
            m_gpsOrbitStatusText = QStringLiteral("No update needed (watch has %1)")
                .arg(obj.value(QStringLiteral("watch_date")).toString());
        } else if (obj.value(QStringLiteral("offline")).toBool()) {
            const QString watchDate = obj.value(QStringLiteral("watch_date")).toString();
            m_gpsOrbitStatusText = watchDate.isEmpty()
                ? QStringLiteral("No internet connection, and the watch has no orbit data yet")
                : QStringLiteral("No internet connection - watch's current data is from %1")
                    .arg(watchDate);
        } else if (obj.value(QStringLiteral("wrote")).toBool()) {
            m_gpsOrbitStatusText = QStringLiteral("Updated");
        } else {
            m_gpsOrbitStatusText = QStringLiteral("Checked - nothing written");
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
        m_gpsOrbitStatusText = obj.value(QStringLiteral("valid")).toBool()
            ? QStringLiteral("%1 - tap to update").arg(obj.value(QStringLiteral("date")).toString())
            : QStringLiteral("No data yet - tap to update");
        emit gpsOrbitChanged();
    });
}
