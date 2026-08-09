#include "appsservice.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QUrlQuery>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

AppsService::AppsService(QObject *parent) : QObject(parent)
{
}

QUrl AppsService::backendUrl(const QString &path)
{
    return QUrl(kBackendBase + path);
}

void AppsService::setLoading(bool value)
{
    if (m_loading == value)
        return;
    m_loading = value;
    emit loadingChanged();
}

void AppsService::setLastError(const QString &message)
{
    m_lastError = message;
    emit lastErrorChanged();
}

void AppsService::setSearching(bool value)
{
    if (m_searching == value)
        return;
    m_searching = value;
    emit searchingChanged();
}

void AppsService::setInstalling(bool value)
{
    if (m_installing == value)
        return;
    m_installing = value;
    emit installingChanged();
}

void AppsService::refreshInstalledApps()
{
    setLoading(true);
    QNetworkReply *reply = m_network.get(QNetworkRequest(backendUrl(QStringLiteral("/api/apps"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool ok = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();
        if (!ok) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("GET /api/apps: %1").arg(reply->errorString())
                : QStringLiteral("GET /api/apps: %1").arg(obj.value(QStringLiteral("error"))
                    .toString(obj.value(QStringLiteral("stderr")).toString())));
            emit installedAppsChanged();
            return;
        }

        m_installedApps.clear();
        for (const auto &v : obj.value(QStringLiteral("entries")).toArray()) {
            const auto e = v.toObject();
            QVariantMap row;
            row[QStringLiteral("ruleIdx")] = e.value(QStringLiteral("ruleIdx")).toInt();
            row[QStringLiteral("name")] = e.value(QStringLiteral("name")).toString();
            row[QStringLiteral("activityId")] = e.value(QStringLiteral("activityId")).toInt();
            row[QStringLiteral("binaryLength")] = e.value(QStringLiteral("binaryLength")).toInt();
            const auto match = e.value(QStringLiteral("catalogMatch"));
            if (match.isObject()) {
                QVariantMap m;
                const auto mo = match.toObject();
                m[QStringLiteral("ruleId")] = mo.value(QStringLiteral("ruleId")).toInt();
                m[QStringLiteral("name")] = mo.value(QStringLiteral("name")).toString();
                m[QStringLiteral("categoryId")] = mo.value(QStringLiteral("categoryId")).toInt();
                m[QStringLiteral("description")] = mo.value(QStringLiteral("description")).toString();
                row[QStringLiteral("catalogMatch")] = m;
            }
            m_installedApps.append(row);
        }
        setLastError(QString());
        emit installedAppsChanged();
    });
}

void AppsService::searchCatalog(const QString &query, const QString &variant, int categoryId)
{
    setSearching(true);
    QUrl url = backendUrl(QStringLiteral("/api/apps/catalog"));
    QUrlQuery q;
    if (!query.isEmpty())
        q.addQueryItem(QStringLiteral("q"), query);
    if (!variant.isEmpty())
        q.addQueryItem(QStringLiteral("variant"), variant);
    if (categoryId >= 0)
        q.addQueryItem(QStringLiteral("category"), QString::number(categoryId));
    url.setQuery(q);

    QNetworkReply *reply = m_network.get(QNetworkRequest(url));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setSearching(false);

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool ok = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();
        if (!ok) {
            setLastError(reply->error() != QNetworkReply::NoError
                ? QStringLiteral("GET /api/apps/catalog: %1").arg(reply->errorString())
                : QStringLiteral("GET /api/apps/catalog: %1").arg(
                    obj.value(QStringLiteral("error")).toString()));
            m_searchResults.clear();
            emit searchResultsChanged();
            return;
        }

        m_searchResults.clear();
        for (const auto &v : obj.value(QStringLiteral("results")).toArray()) {
            const auto e = v.toObject();
            QVariantMap row;
            row[QStringLiteral("ruleId")] = e.value(QStringLiteral("ruleId")).toInt();
            row[QStringLiteral("name")] = e.value(QStringLiteral("name")).toString();
            row[QStringLiteral("categoryId")] = e.value(QStringLiteral("categoryId")).toInt();
            row[QStringLiteral("activityId")] = e.value(QStringLiteral("activityId")).toInt();
            row[QStringLiteral("description")] = e.value(QStringLiteral("description")).toString();
            row[QStringLiteral("userCount")] = e.value(QStringLiteral("userCount")).toInt();
            m_searchResults.append(row);
        }
        emit searchResultsChanged();
    });
}

void AppsService::install(int mode, int display, int field, int ruleId, bool confirm)
{
    setInstalling(true);

    QNetworkRequest request(backendUrl(QStringLiteral("/api/apps/install")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QJsonObject body;
    body[QStringLiteral("mode")] = mode;
    body[QStringLiteral("display")] = display;
    body[QStringLiteral("field")] = field;
    body[QStringLiteral("ruleId")] = ruleId;
    body[QStringLiteral("confirm")] = confirm;

    QNetworkReply *reply = m_network.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, confirm] {
        reply->deleteLater();
        setInstalling(false);

        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool ok = (reply->error() == QNetworkReply::NoError)
            && obj.value(QStringLiteral("ok")).toBool();

        QVariantMap result;
        result[QStringLiteral("ok")] = ok;
        result[QStringLiteral("dryRun")] = !confirm;
        if (ok) {
            result[QStringLiteral("name")] = obj.value(QStringLiteral("name")).toString();
            if (obj.contains(QStringLiteral("wouldBeRuleIdx")))
                result[QStringLiteral("wouldBeRuleIdx")] = obj.value(QStringLiteral("wouldBeRuleIdx")).toInt();
            if (obj.contains(QStringLiteral("ruleIdx")))
                result[QStringLiteral("ruleIdx")] = obj.value(QStringLiteral("ruleIdx")).toInt();
            if (obj.contains(QStringLiteral("ruleId")))
                result[QStringLiteral("ruleId")] = obj.value(QStringLiteral("ruleId")).toInt();
        } else {
            result[QStringLiteral("error")] = reply->error() != QNetworkReply::NoError
                ? QStringLiteral("POST /api/apps/install: %1").arg(reply->errorString())
                : QStringLiteral("POST /api/apps/install: %1").arg(
                    obj.value(QStringLiteral("error")).toString());
            setLastError(result[QStringLiteral("error")].toString());
        }
        m_lastInstallResult = result;
        emit lastInstallResultChanged();

        // A real write changed the watch's own Apps region - refresh the installed list
        // so a UI showing it doesn't go stale.
        if (ok && confirm)
            refreshInstalledApps();
    });
}
