#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QSettings>
#include <QString>
#include <QStringList>
#include <QVariantList>

#include <functional>

// Added 2026-08-12 alongside ConnectionsService's Dropbox/Google Drive/OneDrive OAuth support
// (see that class's header comment for the "why these three, why self-serve client IDs"
// reasoning). This is the other half: actually moving the Backup & Restore files
// (~/AmbitAppBackups/<label>-routes.bin / <label>-waypoints.bin - the same two files
// BackupService::createBackup()/backups() already produce and list, "the backup that
// milestone 4 asked for and never had") to and from whichever provider the user connected.
//
// Deliberately a separate class from ConnectionsService (which only owns the OAuth
// connect/disconnect/token lifecycle - Strava's own real upload code was never even built
// into it on desktop, see that class's header comment) and from BackupService (which owns
// the *local* backup list/create/restore, unchanged by any of this). Reads the access/
// refresh tokens straight out of the same "connections/<provider>/..." QSettings groups
// ConnectionsService writes, refreshing them here when stale rather than routing through a
// live pointer to that singleton - see ConnectionsService's own header comment for why (no
// established cross-singleton wiring exists in this app between two QML_SINGLETON classes;
// duplicating the ~30-line refresh POST was simpler than adding it).
//
// Downloaded files are written into the exact same ~/AmbitAppBackups/<label>-*.bin location
// and naming convention a local backup already uses, so BackupService::refresh() (called via
// this class's backupDownloaded() signal) picks them up and the existing "Restore" button
// works completely unmodified - no new restore code needed anywhere.
class CloudStorageService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    // Every backup found in the connected provider's app folder - each {label, createdAt}.
    // createdAt comes from parsing the label itself (BackupService's own "YYYYMMDD-HHMMSS"
    // convention), not a second remote metadata round-trip.
    Q_PROPERTY(QVariantList remoteBackups READ remoteBackups NOTIFY remoteBackupsChanged)
    Q_PROPERTY(QString actionText READ actionText NOTIFY actionChanged)
    Q_PROPERTY(bool actionOk READ actionOk NOTIFY actionChanged)

public:
    explicit CloudStorageService(QObject *parent = nullptr);

    bool busy() const { return m_busy; }
    QVariantList remoteBackups() const { return m_remoteBackups; }
    QString actionText() const { return m_actionText; }
    bool actionOk() const { return m_actionOk; }

    // provider is "dropbox"/"googledrive"/"onedrive" - the same key ConnectionsService uses.
    // prefix is a BackupService.backups() entry's own "prefix" field (a full local path with
    // no "-routes.bin"/"-waypoints.bin" suffix yet); label is that same entry's "label".
    Q_INVOKABLE void uploadBackup(const QString &provider, const QString &prefix, const QString &label);
    Q_INVOKABLE void refreshRemoteBackups(const QString &provider);
    Q_INVOKABLE void downloadBackup(const QString &provider, const QString &label);

signals:
    void busyChanged();
    void remoteBackupsChanged();
    void actionChanged();
    // Emitted after a successful downloadBackup() - BackupPage.qml calls
    // BackupService.refresh() on this so the newly-downloaded files show up in the normal
    // local list immediately, without polling.
    void backupDownloaded();

private:
    void setBusy(bool value);
    void setAction(const QString &text, bool ok);
    static QString backupDir();
    static QString tokenUrlFor(const QString &provider);

    // Reads clientId/clientSecret(-or-empty for OneDrive's PKCE flow)/refreshToken/
    // accessToken/expiresAt straight out of QSettings (see this class's header comment for
    // why), refreshing via the provider's token endpoint first if the cached access token is
    // missing or within 60s of expiry.
    void withAccessToken(const QString &provider,
                          const std::function<void(const QString &token, const QString &error)> &onReady);
    void refreshAccessToken(const QString &provider, const QString &clientId,
                             const QString &clientSecret, const QString &refreshToken,
                             const std::function<void(const QString &token, const QString &error)> &onReady);

    void ensureGoogleDriveFolder(const QString &token,
                                  const std::function<void(const QString &folderId, const QString &error)> &onReady);

    void uploadOneFile(const QString &provider, const QString &token, const QString &localPath,
                        const QString &remoteName,
                        const std::function<void(const QString &error)> &onDone);
    void downloadOneFile(const QString &provider, const QString &token, const QString &remoteName,
                          const QString &localPath,
                          const std::function<void(const QString &error)> &onDone);
    void setRemoteBackupsFromNames(const QStringList &names);

    QNetworkAccessManager m_network;
    QSettings m_settings;
    bool m_busy = false;
    QVariantList m_remoteBackups;
    QString m_actionText;
    bool m_actionOk = false;
};
