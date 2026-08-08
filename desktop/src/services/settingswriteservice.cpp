#include "settingswriteservice.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

SettingsWriteService::SettingsWriteService(QObject *parent) : QObject(parent)
{
}

QUrl SettingsWriteService::backendUrl(const QString &path)
{
    return QUrl(kBackendBase + path);
}

void SettingsWriteService::setLoading(bool value)
{
    if (m_loading == value)
        return;
    m_loading = value;
    emit loadingChanged();
}

void SettingsWriteService::setLastError(const QString &message)
{
    m_lastError = message;
    emit lastErrorChanged();
}

void SettingsWriteService::setWritingKey(const QString &key)
{
    if (m_writingKey == key)
        return;
    m_writingKey = key;
    emit writingKeyChanged();
}

void SettingsWriteService::setDevice(const QString &value)
{
    if (m_device == value)
        return;
    m_device = value;
    emit deviceChanged();
}

void SettingsWriteService::refresh()
{
    setLoading(true);
    QString path = QStringLiteral("/api/settings");
    if (!m_device.isEmpty())
        path += QStringLiteral("?device=") + QUrl::toPercentEncoding(m_device);
    QNetworkReply *reply = m_network.get(QNetworkRequest(backendUrl(path)));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        m_ok = (reply->error() == QNetworkReply::NoError) && obj.value(QStringLiteral("ok")).toBool();

        if (!m_ok) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("GET /api/settings: %1").arg(reply->errorString())
                : QStringLiteral("GET /api/settings: %1")
                    .arg(obj.value(QStringLiteral("error")).toString(
                        obj.value(QStringLiteral("stderr")).toString())));
            emit settingsChanged();
            return;
        }

        QVariantList rows;
        const auto settingsObj = obj.value(QStringLiteral("settings")).toObject();
        for (auto it = settingsObj.constBegin(); it != settingsObj.constEnd(); ++it) {
            const auto entry = it.value().toObject();
            if (!entry.value(QStringLiteral("ok")).toBool())
                continue;  // not present in this watch's own schema - not an error to show

            QVariantMap row;
            row[QStringLiteral("key")] = it.key();
            row[QStringLiteral("path")] = entry.value(QStringLiteral("path")).toString();
            row[QStringLiteral("kind")] = entry.value(QStringLiteral("kind")).toString();
            row[QStringLiteral("value")] = entry.value(QStringLiteral("value")).toVariant();
            row[QStringLiteral("min")] = entry.value(QStringLiteral("min")).toVariant();
            row[QStringLiteral("max")] = entry.value(QStringLiteral("max")).toVariant();

            QVariantList choices;
            for (const auto &c : entry.value(QStringLiteral("choices")).toArray()) {
                const auto pair = c.toArray();
                QVariantMap choice;
                choice[QStringLiteral("value")] = pair.at(0).toVariant();
                choice[QStringLiteral("label")] = pair.at(1).toString();
                choices.append(choice);
            }
            row[QStringLiteral("choices")] = choices;

            rows.append(row);
        }
        m_settings = rows;
        setLastError(QString());
        emit settingsChanged();
    });
}

void SettingsWriteService::writeSetting(const QString &key, const QVariant &value)
{
    setWritingKey(key);

    QNetworkRequest request(backendUrl(QStringLiteral("/api/settings")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QJsonObject body;
    body[QStringLiteral("key")] = key;
    // QJsonValue::fromVariant handles both int (enum/number) and double cleanly; the
    // backend/tool only ever needs a plain numeric value, never a display label.
    body[QStringLiteral("value")] = QJsonValue::fromVariant(value);
    body[QStringLiteral("confirm")] = true;
    if (!m_device.isEmpty())
        body[QStringLiteral("device")] = m_device;

    QNetworkReply *reply = m_network.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, key] {
        reply->deleteLater();
        if (m_writingKey == key)
            setWritingKey(QString());

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool writeOk = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();

        if (!writeOk) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("POST /api/settings (%1): %2").arg(key, reply->errorString())
                : QStringLiteral("POST /api/settings (%1): %2").arg(key,
                    obj.value(QStringLiteral("error")).toString(
                        QStringLiteral("write not confirmed by re-read"))));
            // Real value may or may not have changed depending on where the write failed -
            // re-fetching is the only honest way to show what the watch actually has now,
            // rather than leaving the UI showing the value the user tried to set.
            refresh();
            return;
        }

        setLastError(QString());
        refresh();
    });
}
