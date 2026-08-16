#include "cloudstorageservice.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QHttpMultiPart>
#include <QHttpPart>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSet>
#include <QUrl>
#include <QUrlQuery>

#include <algorithm>

CloudStorageService::CloudStorageService(QObject *parent) : QObject(parent) {}

void CloudStorageService::setBusy(bool value)
{
    if (m_busy == value)
        return;
    m_busy = value;
    emit busyChanged();
}

void CloudStorageService::setAction(const QString &text, bool ok)
{
    m_actionText = text;
    m_actionOk = ok;
    emit actionChanged();
}

QString CloudStorageService::backupDir()
{
    // Matches desktop/backend/server.py's own BACKUP_DIR (Path.home() / "AmbitAppBackups")
    // exactly - a downloaded file needs to land in the same place a local backup already
    // does for BackupService's existing list/restore code to see it with zero changes.
    return QDir::homePath() + QStringLiteral("/AmbitAppBackups");
}

QString CloudStorageService::tokenUrlFor(const QString &provider)
{
    if (provider == QLatin1String("dropbox"))
        return QStringLiteral("https://api.dropboxapi.com/oauth2/token");
    if (provider == QLatin1String("googledrive"))
        return QStringLiteral("https://oauth2.googleapis.com/token");
    if (provider == QLatin1String("onedrive"))
        return QStringLiteral("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    return QString();
}

void CloudStorageService::withAccessToken(
    const QString &provider, const std::function<void(const QString &, const QString &)> &onReady)
{
    const QString group = QStringLiteral("connections/") + provider;
    const QString refreshToken = m_settings.value(group + QStringLiteral("/refreshToken")).toString();
    if (refreshToken.isEmpty()) {
        onReady(QString(), QStringLiteral("Not connected - connect it in Settings first."));
        return;
    }
    const QString accessToken = m_settings.value(group + QStringLiteral("/accessToken")).toString();
    const qint64 expiresAt = m_settings.value(group + QStringLiteral("/expiresAt")).toLongLong();
    if (!accessToken.isEmpty() && QDateTime::currentSecsSinceEpoch() < expiresAt - 60) {
        onReady(accessToken, QString());
        return;
    }
    const QString clientId = m_settings.value(group + QStringLiteral("/clientId")).toString();
    const QString clientSecret = m_settings.value(group + QStringLiteral("/clientSecret")).toString();
    refreshAccessToken(provider, clientId, clientSecret, refreshToken, onReady);
}

void CloudStorageService::refreshAccessToken(
    const QString &provider, const QString &clientId, const QString &clientSecret,
    const QString &refreshToken, const std::function<void(const QString &, const QString &)> &onReady)
{
    QUrlQuery body;
    body.addQueryItem(QStringLiteral("client_id"), clientId);
    body.addQueryItem(QStringLiteral("grant_type"), QStringLiteral("refresh_token"));
    body.addQueryItem(QStringLiteral("refresh_token"), refreshToken);
    // OneDrive's stored clientSecret is always empty (PKCE, no secret) - naturally skipped.
    if (!clientSecret.isEmpty())
        body.addQueryItem(QStringLiteral("client_secret"), clientSecret);

    QNetworkRequest request{QUrl(tokenUrlFor(provider))};
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                       QStringLiteral("application/x-www-form-urlencoded"));
    QNetworkReply *reply = m_network.post(request, body.query(QUrl::FullyEncoded).toUtf8());
    connect(reply, &QNetworkReply::finished, this, [this, reply, provider, onReady] {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            onReady(QString(), QStringLiteral("Token refresh failed: %1").arg(reply->errorString()));
            return;
        }
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const QString accessToken = obj.value(QStringLiteral("access_token")).toString();
        if (accessToken.isEmpty()) {
            onReady(QString(), QStringLiteral("Token refresh didn't return an access token."));
            return;
        }
        const qint64 expiresIn = obj.value(QStringLiteral("expires_in")).toVariant().toLongLong();
        const qint64 expiresAt =
            QDateTime::currentSecsSinceEpoch() + (expiresIn > 0 ? expiresIn : 3600);
        // Not every provider rotates the refresh token on every use - keep the old one when
        // a new one isn't handed back rather than overwriting it with an empty string.
        const QString newRefreshToken = obj.value(QStringLiteral("refresh_token")).toString();

        const QString group = QStringLiteral("connections/") + provider;
        m_settings.setValue(group + QStringLiteral("/accessToken"), accessToken);
        m_settings.setValue(group + QStringLiteral("/expiresAt"), expiresAt);
        if (!newRefreshToken.isEmpty())
            m_settings.setValue(group + QStringLiteral("/refreshToken"), newRefreshToken);
        onReady(accessToken, QString());
    });
}

// Google's drive.file scope means this app only ever sees files/folders it created itself -
// so unlike Dropbox's App Folder or OneDrive's /special/approot, there's no folder handed to
// it automatically. Search-or-create once, then cache the id (it's a permanent Drive id) so
// every later call skips straight to it.
void CloudStorageService::ensureGoogleDriveFolder(
    const QString &token, const std::function<void(const QString &, const QString &)> &onReady)
{
    const QString group = QStringLiteral("connections/googledrive");
    const QString cached = m_settings.value(group + QStringLiteral("/folderId")).toString();
    if (!cached.isEmpty()) {
        onReady(cached, QString());
        return;
    }

    QUrlQuery q;
    q.addQueryItem(QStringLiteral("q"),
                    QStringLiteral("mimeType='application/vnd.google-apps.folder' and "
                                   "name='AmbitApp Backups' and trashed=false"));
    q.addQueryItem(QStringLiteral("fields"), QStringLiteral("files(id)"));
    QUrl url(QStringLiteral("https://www.googleapis.com/drive/v3/files"));
    url.setQuery(q);
    QNetworkRequest request{url};
    request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
    QNetworkReply *reply = m_network.get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply, token, group, onReady] {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            onReady(QString(), QStringLiteral("Google Drive: %1").arg(reply->errorString()));
            return;
        }
        const auto files =
            QJsonDocument::fromJson(reply->readAll()).object().value(QStringLiteral("files")).toArray();
        if (!files.isEmpty()) {
            const QString id = files.first().toObject().value(QStringLiteral("id")).toString();
            m_settings.setValue(group + QStringLiteral("/folderId"), id);
            onReady(id, QString());
            return;
        }

        QJsonObject body;
        body[QStringLiteral("name")] = QStringLiteral("AmbitApp Backups");
        body[QStringLiteral("mimeType")] = QStringLiteral("application/vnd.google-apps.folder");
        QNetworkRequest createReq{QUrl(QStringLiteral("https://www.googleapis.com/drive/v3/files"))};
        createReq.setRawHeader("Authorization", "Bearer " + token.toUtf8());
        createReq.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
        QNetworkReply *createReply = m_network.post(createReq, QJsonDocument(body).toJson());
        connect(createReply, &QNetworkReply::finished, this, [this, createReply, group, onReady] {
            createReply->deleteLater();
            if (createReply->error() != QNetworkReply::NoError) {
                onReady(QString(), QStringLiteral("Google Drive: could not create the backups "
                                                   "folder - %1").arg(createReply->errorString()));
                return;
            }
            const QString id =
                QJsonDocument::fromJson(createReply->readAll()).object().value(QStringLiteral("id")).toString();
            if (id.isEmpty()) {
                onReady(QString(), QStringLiteral("Google Drive: folder creation didn't return an id."));
                return;
            }
            m_settings.setValue(group + QStringLiteral("/folderId"), id);
            onReady(id, QString());
        });
    });
}

void CloudStorageService::uploadOneFile(const QString &provider, const QString &token,
                                         const QString &localPath, const QString &remoteName,
                                         const std::function<void(const QString &)> &onDone)
{
    QFile file(localPath);
    if (!file.open(QIODevice::ReadOnly)) {
        onDone(QStringLiteral("Could not read local file %1").arg(localPath));
        return;
    }
    const QByteArray fileBytes = file.readAll();
    file.close();

    if (provider == QLatin1String("dropbox")) {
        QJsonObject argObj;
        // Paths are relative to the app's own folder (App Folder access, registered by the
        // user at dropbox.com/developers) - "/" is the folder root, not the real Dropbox root.
        argObj[QStringLiteral("path")] = QStringLiteral("/") + remoteName;
        argObj[QStringLiteral("mode")] = QStringLiteral("overwrite");
        argObj[QStringLiteral("mute")] = true;
        QNetworkRequest request{QUrl(QStringLiteral("https://content.dropboxapi.com/2/files/upload"))};
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
        request.setRawHeader("Dropbox-API-Arg", QJsonDocument(argObj).toJson(QJsonDocument::Compact));
        request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/octet-stream"));
        QNetworkReply *reply = m_network.post(request, fileBytes);
        connect(reply, &QNetworkReply::finished, this, [reply, onDone] {
            reply->deleteLater();
            if (reply->error() != QNetworkReply::NoError)
                onDone(QStringLiteral("Dropbox: %1").arg(reply->errorString()));
            else
                onDone(QString());
        });
        return;
    }

    if (provider == QLatin1String("googledrive")) {
        ensureGoogleDriveFolder(token, [this, token, remoteName, fileBytes, onDone](
                                            const QString &folderId, const QString &folderError) {
            if (!folderError.isEmpty()) {
                onDone(folderError);
                return;
            }
            QJsonObject metadata;
            metadata[QStringLiteral("name")] = remoteName;
            metadata[QStringLiteral("parents")] = QJsonArray{folderId};

            auto *multiPart = new QHttpMultiPart(QHttpMultiPart::RelatedType);
            QHttpPart metadataPart;
            metadataPart.setHeader(QNetworkRequest::ContentTypeHeader,
                                    QStringLiteral("application/json; charset=UTF-8"));
            metadataPart.setBody(QJsonDocument(metadata).toJson(QJsonDocument::Compact));
            QHttpPart filePart;
            filePart.setHeader(QNetworkRequest::ContentTypeHeader,
                                QStringLiteral("application/octet-stream"));
            filePart.setBody(fileBytes);
            multiPart->append(metadataPart);
            multiPart->append(filePart);

            QNetworkRequest request{
                QUrl(QStringLiteral("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"))};
            request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
            QNetworkReply *reply = m_network.post(request, multiPart);
            multiPart->setParent(reply);
            connect(reply, &QNetworkReply::finished, this, [reply, onDone] {
                reply->deleteLater();
                if (reply->error() != QNetworkReply::NoError)
                    onDone(QStringLiteral("Google Drive: %1").arg(reply->errorString()));
                else
                    onDone(QString());
            });
        });
        return;
    }

    if (provider == QLatin1String("onedrive")) {
        QNetworkRequest request{QUrl(
            QStringLiteral("https://graph.microsoft.com/v1.0/me/drive/special/approot:/%1:/content")
                .arg(remoteName))};
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
        request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/octet-stream"));
        QNetworkReply *reply = m_network.put(request, fileBytes);
        connect(reply, &QNetworkReply::finished, this, [reply, onDone] {
            reply->deleteLater();
            if (reply->error() != QNetworkReply::NoError)
                onDone(QStringLiteral("OneDrive: %1").arg(reply->errorString()));
            else
                onDone(QString());
        });
        return;
    }

    onDone(QStringLiteral("Unknown provider %1").arg(provider));
}

void CloudStorageService::downloadOneFile(const QString &provider, const QString &token,
                                           const QString &remoteName, const QString &localPath,
                                           const std::function<void(const QString &)> &onDone)
{
    auto writeAndFinish = [localPath, onDone](QNetworkReply *reply) {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            onDone(reply->errorString());
            return;
        }
        QFile f(localPath);
        if (!f.open(QIODevice::WriteOnly)) {
            onDone(QStringLiteral("Could not write %1").arg(localPath));
            return;
        }
        f.write(reply->readAll());
        onDone(QString());
    };

    if (provider == QLatin1String("dropbox")) {
        QJsonObject argObj;
        argObj[QStringLiteral("path")] = QStringLiteral("/") + remoteName;
        QNetworkRequest request{QUrl(QStringLiteral("https://content.dropboxapi.com/2/files/download"))};
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
        request.setRawHeader("Dropbox-API-Arg", QJsonDocument(argObj).toJson(QJsonDocument::Compact));
        QNetworkReply *reply = m_network.post(request, QByteArray());
        connect(reply, &QNetworkReply::finished, this, [reply, writeAndFinish] { writeAndFinish(reply); });
        return;
    }

    if (provider == QLatin1String("googledrive")) {
        // drive.file has no "get by path" - find the id first, then fetch its content.
        QUrlQuery q;
        q.addQueryItem(QStringLiteral("q"),
                        QStringLiteral("name='%1' and trashed=false").arg(remoteName));
        q.addQueryItem(QStringLiteral("fields"), QStringLiteral("files(id)"));
        QUrl searchUrl(QStringLiteral("https://www.googleapis.com/drive/v3/files"));
        searchUrl.setQuery(q);
        QNetworkRequest searchReq{searchUrl};
        searchReq.setRawHeader("Authorization", "Bearer " + token.toUtf8());
        QNetworkReply *searchReply = m_network.get(searchReq);
        connect(searchReply, &QNetworkReply::finished, this,
                [this, searchReply, token, writeAndFinish, onDone] {
                    searchReply->deleteLater();
                    if (searchReply->error() != QNetworkReply::NoError) {
                        onDone(searchReply->errorString());
                        return;
                    }
                    const auto files = QJsonDocument::fromJson(searchReply->readAll())
                                            .object()
                                            .value(QStringLiteral("files"))
                                            .toArray();
                    if (files.isEmpty()) {
                        onDone(QStringLiteral("File not found on Google Drive."));
                        return;
                    }
                    const QString fileId = files.first().toObject().value(QStringLiteral("id")).toString();
                    QNetworkRequest dlReq{QUrl(
                        QStringLiteral("https://www.googleapis.com/drive/v3/files/%1?alt=media").arg(fileId))};
                    dlReq.setRawHeader("Authorization", "Bearer " + token.toUtf8());
                    QNetworkReply *dlReply = m_network.get(dlReq);
                    connect(dlReply, &QNetworkReply::finished, this,
                            [dlReply, writeAndFinish] { writeAndFinish(dlReply); });
                });
        return;
    }

    if (provider == QLatin1String("onedrive")) {
        QNetworkRequest request{QUrl(
            QStringLiteral("https://graph.microsoft.com/v1.0/me/drive/special/approot:/%1:/content")
                .arg(remoteName))};
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
        QNetworkReply *reply = m_network.get(request);
        connect(reply, &QNetworkReply::finished, this, [reply, writeAndFinish] { writeAndFinish(reply); });
        return;
    }

    onDone(QStringLiteral("Unknown provider %1").arg(provider));
}

void CloudStorageService::setRemoteBackupsFromNames(const QStringList &names)
{
    static const QString kRoutesSuffix = QStringLiteral("-routes.bin");
    static const QString kWaypointsSuffix = QStringLiteral("-waypoints.bin");

    // Only a real, complete pair counts as a backup - same rule
    // BackupService::backups()/_handle_backups_list() already applies to the local list.
    QSet<QString> labels;
    for (const QString &name : names) {
        if (name.endsWith(kRoutesSuffix)) {
            const QString label = name.left(name.size() - kRoutesSuffix.size());
            if (names.contains(label + kWaypointsSuffix))
                labels.insert(label);
        }
    }

    QVariantList result;
    for (const QString &label : labels) {
        QVariantMap entry;
        entry[QStringLiteral("label")] = label;
        // Labels are BackupService's own "YYYYMMDD-HHMMSS" convention - parsed back into a
        // timestamp instead of a second remote metadata round-trip for sort/display.
        const QDateTime dt = QDateTime::fromString(label, QStringLiteral("yyyyMMdd-HHmmss"));
        entry[QStringLiteral("createdAt")] = dt.isValid() ? dt.toSecsSinceEpoch() : 0;
        result.append(entry);
    }
    std::sort(result.begin(), result.end(), [](const QVariant &a, const QVariant &b) {
        return a.toMap().value(QStringLiteral("createdAt")).toLongLong()
             > b.toMap().value(QStringLiteral("createdAt")).toLongLong();
    });

    m_remoteBackups = result;
    emit remoteBackupsChanged();
    setAction(QString(), true);
}

void CloudStorageService::uploadBackup(const QString &provider, const QString &prefix,
                                        const QString &label)
{
    setBusy(true);
    setAction(QString(), true);
    withAccessToken(provider, [this, provider, prefix, label](const QString &token, const QString &error) {
        if (!error.isEmpty()) {
            setBusy(false);
            setAction(error, false);
            return;
        }
        const QString routesLocal = prefix + QStringLiteral("-routes.bin");
        const QString waypointsLocal = prefix + QStringLiteral("-waypoints.bin");
        const QString routesRemote = label + QStringLiteral("-routes.bin");
        const QString waypointsRemote = label + QStringLiteral("-waypoints.bin");

        uploadOneFile(provider, token, routesLocal, routesRemote,
                      [this, provider, token, waypointsLocal, waypointsRemote, label](const QString &err1) {
            if (!err1.isEmpty()) {
                setBusy(false);
                setAction(QStringLiteral("Upload failed: %1").arg(err1), false);
                return;
            }
            uploadOneFile(provider, token, waypointsLocal, waypointsRemote,
                          [this, label](const QString &err2) {
                setBusy(false);
                if (!err2.isEmpty()) {
                    setAction(QStringLiteral("Upload failed: %1").arg(err2), false);
                    return;
                }
                setAction(QStringLiteral("Uploaded %1 to the cloud.").arg(label), true);
            });
        });
    });
}

void CloudStorageService::refreshRemoteBackups(const QString &provider)
{
    setBusy(true);
    withAccessToken(provider, [this, provider](const QString &token, const QString &error) {
        if (!error.isEmpty()) {
            setBusy(false);
            setAction(error, false);
            return;
        }

        if (provider == QLatin1String("dropbox")) {
            QJsonObject body;
            body[QStringLiteral("path")] = QString(); // app-folder root
            QNetworkRequest request{QUrl(QStringLiteral("https://api.dropboxapi.com/2/files/list_folder"))};
            request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
            request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
            QNetworkReply *reply = m_network.post(request, QJsonDocument(body).toJson());
            connect(reply, &QNetworkReply::finished, this, [this, reply] {
                reply->deleteLater();
                setBusy(false);
                if (reply->error() != QNetworkReply::NoError) {
                    setAction(QStringLiteral("Dropbox: %1").arg(reply->errorString()), false);
                    return;
                }
                const auto entries = QJsonDocument::fromJson(reply->readAll())
                                          .object().value(QStringLiteral("entries")).toArray();
                QStringList names;
                for (const auto &v : entries)
                    names << v.toObject().value(QStringLiteral("name")).toString();
                setRemoteBackupsFromNames(names);
            });
            return;
        }

        if (provider == QLatin1String("googledrive")) {
            ensureGoogleDriveFolder(token, [this, token](const QString &folderId, const QString &folderError) {
                if (!folderError.isEmpty()) {
                    setBusy(false);
                    setAction(folderError, false);
                    return;
                }
                QUrlQuery q;
                q.addQueryItem(QStringLiteral("q"),
                                QStringLiteral("'%1' in parents and trashed=false").arg(folderId));
                q.addQueryItem(QStringLiteral("fields"), QStringLiteral("files(name)"));
                QUrl url(QStringLiteral("https://www.googleapis.com/drive/v3/files"));
                url.setQuery(q);
                QNetworkRequest request{url};
                request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
                QNetworkReply *reply = m_network.get(request);
                connect(reply, &QNetworkReply::finished, this, [this, reply] {
                    reply->deleteLater();
                    setBusy(false);
                    if (reply->error() != QNetworkReply::NoError) {
                        setAction(QStringLiteral("Google Drive: %1").arg(reply->errorString()), false);
                        return;
                    }
                    const auto files = QJsonDocument::fromJson(reply->readAll())
                                            .object().value(QStringLiteral("files")).toArray();
                    QStringList names;
                    for (const auto &v : files)
                        names << v.toObject().value(QStringLiteral("name")).toString();
                    setRemoteBackupsFromNames(names);
                });
            });
            return;
        }

        if (provider == QLatin1String("onedrive")) {
            QNetworkRequest request{QUrl(
                QStringLiteral("https://graph.microsoft.com/v1.0/me/drive/special/approot:/children?$select=name"))};
            request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
            QNetworkReply *reply = m_network.get(request);
            connect(reply, &QNetworkReply::finished, this, [this, reply] {
                reply->deleteLater();
                setBusy(false);
                if (reply->error() != QNetworkReply::NoError) {
                    setAction(QStringLiteral("OneDrive: %1").arg(reply->errorString()), false);
                    return;
                }
                const auto values = QJsonDocument::fromJson(reply->readAll())
                                         .object().value(QStringLiteral("value")).toArray();
                QStringList names;
                for (const auto &v : values)
                    names << v.toObject().value(QStringLiteral("name")).toString();
                setRemoteBackupsFromNames(names);
            });
            return;
        }

        setBusy(false);
        setAction(QStringLiteral("Unknown provider %1").arg(provider), false);
    });
}

void CloudStorageService::downloadBackup(const QString &provider, const QString &label)
{
    setBusy(true);
    setAction(QString(), true);
    QDir().mkpath(backupDir());

    withAccessToken(provider, [this, provider, label](const QString &token, const QString &error) {
        if (!error.isEmpty()) {
            setBusy(false);
            setAction(error, false);
            return;
        }
        const QString routesRemote = label + QStringLiteral("-routes.bin");
        const QString waypointsRemote = label + QStringLiteral("-waypoints.bin");
        const QString routesLocal = backupDir() + QStringLiteral("/") + routesRemote;
        const QString waypointsLocal = backupDir() + QStringLiteral("/") + waypointsRemote;

        downloadOneFile(provider, token, routesRemote, routesLocal,
                        [this, provider, token, waypointsRemote, waypointsLocal, label](const QString &err1) {
            if (!err1.isEmpty()) {
                setBusy(false);
                setAction(QStringLiteral("Download failed: %1").arg(err1), false);
                return;
            }
            downloadOneFile(provider, token, waypointsRemote, waypointsLocal,
                            [this, label](const QString &err2) {
                setBusy(false);
                if (!err2.isEmpty()) {
                    setAction(QStringLiteral("Download failed: %1").arg(err2), false);
                    return;
                }
                setAction(QStringLiteral("Downloaded %1 - it now appears in the local backups "
                                          "list below.").arg(label), true);
                emit backupDownloaded();
            });
        });
    });
}
