#include "smartsensorservice.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

SmartSensorService::SmartSensorService(QObject *parent) : QObject(parent) {}

void SmartSensorService::setLoading(bool value)
{
    if (m_loading == value)
        return;
    m_loading = value;
    emit loadingChanged();
}

void SmartSensorService::refresh()
{
    setLoading(true);
    QNetworkRequest req(QUrl(kBackendBase + QStringLiteral("/api/smartsensor/status")));
    QNetworkReply *reply = m_network.get(req);
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);
        m_checked = true;
        const auto doc = QJsonDocument::fromJson(reply->readAll());
        const auto obj = doc.object();
        m_ok = (reply->error() == QNetworkReply::NoError) && obj.value(QStringLiteral("ok")).toBool();
        if (!m_ok) {
            m_found = false;
            m_errorText = obj.value(QStringLiteral("error")).toString(reply->errorString());
            emit stateChanged();
            return;
        }
        m_found = obj.value(QStringLiteral("found")).toBool();
        if (m_found) {
            m_manufacturer = obj.value(QStringLiteral("manufacturer")).toString();
            m_model = obj.value(QStringLiteral("model")).toString();
            m_serial = obj.value(QStringLiteral("serial")).toString();
            m_hwRevision = obj.value(QStringLiteral("hw_revision")).toString();
            m_fwRevision = obj.value(QStringLiteral("fw_revision")).toString();
            m_swRevision = obj.value(QStringLiteral("sw_revision")).toString();
            m_batteryPercent = obj.value(QStringLiteral("battery_percent")).isNull()
                ? -1 : obj.value(QStringLiteral("battery_percent")).toInt();
            m_heartRateBpm = obj.value(QStringLiteral("heart_rate_bpm")).isNull()
                ? -1 : obj.value(QStringLiteral("heart_rate_bpm")).toInt();
        }
        emit stateChanged();
    });
}

void SmartSensorService::forget()
{
    setLoading(true);
    QNetworkRequest req(QUrl(kBackendBase + QStringLiteral("/api/smartsensor/forget")));
    req.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *reply = m_network.post(req, QByteArray("{}"));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);
        m_checked = true;
        const auto doc = QJsonDocument::fromJson(reply->readAll());
        const auto obj = doc.object();
        m_ok = (reply->error() == QNetworkReply::NoError) && obj.value(QStringLiteral("ok")).toBool();
        if (!m_ok) {
            m_errorText = obj.value(QStringLiteral("error")).toString(reply->errorString());
            emit stateChanged();
            return;
        }
        m_found = false;
        m_manufacturer.clear();
        m_model.clear();
        m_serial.clear();
        m_hwRevision.clear();
        m_fwRevision.clear();
        m_swRevision.clear();
        m_batteryPercent = -1;
        m_heartRateBpm = -1;
        emit stateChanged();
    });
}
