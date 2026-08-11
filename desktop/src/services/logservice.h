#pragma once

#include <QObject>
#include <QQmlEngine>
#include <QString>

// One place for "something went wrong" - real request, 2026-08-11 (André, G1): "general error
// messages, don't show every info of the error, say just, an error has occurred, send logs,
// and create a button which creates an action to send an email to my github, with the logs
// attached."
//
// The detail is not thrown away, it is moved off the user's face and into a log file, the
// same split DeviceService::setLastError has done since 2026-08-07 - this generalises it so
// every service and page can do the same instead of printing raw backend stderr into the UI.
//
// On attachments, honestly: a `mailto:` URL cannot carry one. Rather than pretend, this
// composes the mail with the tail of the log inline (capped, because mail clients truncate
// long URLs) and opens the folder containing the full file so it can be dragged in. That is
// the most a desktop app can do without bundling an SMTP client and asking for credentials,
// which this project deliberately avoids (no accounts, no API keys).
class LogService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QString logPath READ logPath CONSTANT)

public:
    explicit LogService(QObject *parent = nullptr);

    QString logPath() const;

    // Append a line. Used by pages that catch an error they do not want to show verbatim.
    Q_INVOKABLE void append(const QString &line);

    // The generic message every error banner shows. Kept here so the wording is identical
    // everywhere rather than retyped per page.
    Q_INVOKABLE QString userMessage() const;

    // Compose the report mail and reveal the log file. `context` is whatever the page knows
    // about what failed - it is logged first, so the mail and the file agree.
    Q_INVOKABLE void reportProblem(const QString &context = QString());

    // Open the folder holding the log, so the full file can be attached by hand.
    Q_INVOKABLE void revealLog();

private:
    static QString tailOfLog(int maxChars);
};
