#include "localfileservice.h"

#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QStandardPaths>

LocalFileService::LocalFileService(QObject *parent) : QObject(parent) {}

QUrl LocalFileService::downloadsLocation() const
{
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    return QUrl::fromLocalFile(dir);
}

QUrl LocalFileService::backupsLocation() const
{
    return QUrl::fromLocalFile(QDir::homePath() + QStringLiteral("/AmbitAppBackups"));
}

bool LocalFileService::openFolder(const QUrl &folderUrl)
{
    return QDesktopServices::openUrl(folderUrl);
}

static QString writeFile(const QUrl &fileUrl, const QByteArray &data)
{
    const QString path = fileUrl.toLocalFile();
    if (path.isEmpty())
        return QStringLiteral("Invalid file location");
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly))
        return QStringLiteral("Couldn't open %1 for writing: %2").arg(path, file.errorString());
    if (file.write(data) != data.size())
        return QStringLiteral("Couldn't write all data to %1").arg(path);
    return QString();
}

QString LocalFileService::saveText(const QUrl &fileUrl, const QString &text)
{
    return writeFile(fileUrl, text.toUtf8());
}

QString LocalFileService::saveBase64(const QUrl &fileUrl, const QString &base64)
{
    return writeFile(fileUrl, QByteArray::fromBase64(base64.toUtf8()));
}
