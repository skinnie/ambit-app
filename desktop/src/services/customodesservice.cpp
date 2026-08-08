#include "customodesservice.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

CustomModesService::CustomModesService(QObject *parent) : QObject(parent)
{
}

QUrl CustomModesService::backendUrl(const QString &path)
{
    return QUrl(kBackendBase + path);
}

void CustomModesService::setLoading(bool value)
{
    if (m_loading == value)
        return;
    m_loading = value;
    emit loadingChanged();
}

void CustomModesService::setLastError(const QString &message)
{
    m_lastError = message;
    emit lastErrorChanged();
}

void CustomModesService::setWritingMode(const QString &mode)
{
    if (m_writingMode == mode)
        return;
    m_writingMode = mode;
    emit writingModeChanged();
}

void CustomModesService::refresh()
{
    setLoading(true);
    QNetworkReply *reply =
        m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/customodes"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        m_ok = (reply->error() == QNetworkReply::NoError) && obj.value(QStringLiteral("ok")).toBool();

        if (!m_ok) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("GET /api/customodes: %1").arg(reply->errorString())
                : QStringLiteral("GET /api/customodes: %1")
                    .arg(obj.value(QStringLiteral("error")).toString(
                        obj.value(QStringLiteral("stderr")).toString())));
            emit modesChanged();
            return;
        }

        QVariantList modes;
        for (const auto &m : obj.value(QStringLiteral("exerciseModes")).toArray()) {
            const auto mode = m.toObject();
            QVariantMap row;
            row[QStringLiteral("name")] = mode.value(QStringLiteral("name")).toString();
            row[QStringLiteral("activityId")] = mode.value(QStringLiteral("activityId")).toInt();
            row[QStringLiteral("useHw")] = mode.value(QStringLiteral("useHw")).toInt();
            row[QStringLiteral("autolap")] = mode.value(QStringLiteral("autolap")).toInt();
            row[QStringLiteral("hrHigh")] = mode.value(QStringLiteral("hrHigh")).toInt();
            row[QStringLiteral("hrLow")] = mode.value(QStringLiteral("hrLow")).toInt();
            row[QStringLiteral("hrLimitsUse")] = mode.value(QStringLiteral("hrLimitsUse")).toInt();
            row[QStringLiteral("recordingInterval")] =
                mode.value(QStringLiteral("recordingInterval")).toInt();

            QVariantList displays;
            for (const auto &d : mode.value(QStringLiteral("displays")).toArray()) {
                const auto disp = d.toObject();
                QVariantMap dispRow;
                dispRow[QStringLiteral("index")] = disp.value(QStringLiteral("index")).toInt();
                dispRow[QStringLiteral("template")] = disp.value(QStringLiteral("template")).toString();
                dispRow[QStringLiteral("templateLabel")] = disp.value(QStringLiteral("templateLabel")).toString();

                QVariantList fields;
                int fieldIdx = 0;
                for (const auto &f : disp.value(QStringLiteral("fields")).toArray()) {
                    const auto field = f.toObject();
                    QVariantMap fieldRow;
                    fieldRow[QStringLiteral("field")] = fieldIdx++;
                    fieldRow[QStringLiteral("indexName")] = field.value(QStringLiteral("indexName")).toString();
                    fieldRow[QStringLiteral("type")] = field.value(QStringLiteral("type")).toInt();
                    fieldRow[QStringLiteral("typeLabel")] = field.value(QStringLiteral("typeLabel")).toString();
                    fields.append(fieldRow);
                }
                dispRow[QStringLiteral("fields")] = fields;
                displays.append(dispRow);
            }
            row[QStringLiteral("displays")] = displays;

            modes.append(row);
        }
        m_modes = modes;
        setLastError(QString());
        emit modesChanged();
    });
}

void CustomModesService::refreshFieldTypes()
{
    QNetworkReply *reply = m_network.get(
        QNetworkRequest(backendUrl(QStringLiteral("/api/customodes/field-types"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        if (reply->error() != QNetworkReply::NoError || !obj.value(QStringLiteral("ok")).toBool())
            return;  // non-fatal - a UI picker just has nothing to show without it

        QVariantList types;
        for (const auto &t : obj.value(QStringLiteral("fieldTypes")).toArray()) {
            const auto entry = t.toObject();
            QVariantMap row;
            row[QStringLiteral("value")] = entry.value(QStringLiteral("value")).toInt();
            row[QStringLiteral("name")] = entry.value(QStringLiteral("name")).toString();
            row[QStringLiteral("label")] = entry.value(QStringLiteral("label")).toString();
            types.append(row);
        }
        m_fieldTypes = types;
        emit fieldTypesChanged();
    });
}

void CustomModesService::renameMode(const QString &fromName, const QString &toName)
{
    setWritingMode(fromName);

    QNetworkRequest request(backendUrl(QStringLiteral("/api/customodes/rename")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QJsonObject body;
    body[QStringLiteral("from")] = fromName;
    body[QStringLiteral("to")] = toName;
    body[QStringLiteral("confirm")] = true;

    QNetworkReply *reply = m_network.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, fromName] {
        reply->deleteLater();
        if (m_writingMode == fromName)
            setWritingMode(QString());

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool writeOk = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();
        if (!writeOk) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("POST /api/customodes/rename: %1").arg(reply->errorString())
                : QStringLiteral("POST /api/customodes/rename: %1").arg(
                    obj.value(QStringLiteral("error")).toString(QStringLiteral("write not confirmed"))));
        } else {
            setLastError(QString());
        }
        refresh();
    });
}

void CustomModesService::writeField(const QString &mode, const QVariantMap &fields)
{
    setWritingMode(mode);

    QNetworkRequest request(backendUrl(QStringLiteral("/api/customodes/field")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QJsonObject body;
    body[QStringLiteral("mode")] = mode;
    body[QStringLiteral("fields")] = QJsonObject::fromVariantMap(fields);
    body[QStringLiteral("confirm")] = true;

    QNetworkReply *reply = m_network.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, mode] {
        reply->deleteLater();
        if (m_writingMode == mode)
            setWritingMode(QString());

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool writeOk = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();
        if (!writeOk) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("POST /api/customodes/field: %1").arg(reply->errorString())
                : QStringLiteral("POST /api/customodes/field: %1").arg(
                    obj.value(QStringLiteral("error")).toString(QStringLiteral("write not confirmed"))));
        } else {
            setLastError(QString());
        }
        refresh();
    });
}

void CustomModesService::writeDisplayField(const QString &mode, int display, int field,
                                            const QString &newType)
{
    setWritingMode(mode);

    QNetworkRequest request(backendUrl(QStringLiteral("/api/customodes/display-field")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QJsonObject body;
    body[QStringLiteral("mode")] = mode;
    body[QStringLiteral("display")] = display;
    body[QStringLiteral("field")] = field;
    body[QStringLiteral("type")] = newType;
    body[QStringLiteral("confirm")] = true;

    QNetworkReply *reply = m_network.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, mode] {
        reply->deleteLater();
        if (m_writingMode == mode)
            setWritingMode(QString());

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool writeOk = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();
        if (!writeOk) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("POST /api/customodes/display-field: %1").arg(reply->errorString())
                : QStringLiteral("POST /api/customodes/display-field: %1").arg(
                    obj.value(QStringLiteral("error")).toString(QStringLiteral("write not confirmed"))));
        } else {
            setLastError(QString());
        }
        refresh();
    });
}
