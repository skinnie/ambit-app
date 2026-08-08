#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QSettings>
#include <QString>
#include <QTcpServer>

// Home and Settings both showed a static "Intervals.icu / Runalyze / Strava" list with grey
// dots and no way to actually click into any of them - found 2026-08-07 via real testing
// ("you can't click to setup or input your key, our android app has that well implemented").
//
// Checked what the real Android app (oss/opensportsync-main) actually does before building
// this, twice - first for Intervals.icu, then again after André corrected an assumption
// about Runalyze:
// - Intervals.icu: simple personal API-key auth (HTTP Basic, athleteId + a key from
//   intervals.icu's own Settings -> Developer Settings, NOT OAuth -
//   src/services/ApiIntervalsIcu.ts).
// - Runalyze: also simple API-key auth (a single token header, NOT OAuth -
//   src/services/ApiRunalyze.ts) - the original version of this class wrongly lumped it in
//   with Strava as "needs real OAuth," corrected once actually checked.
// - Strava: genuinely real OAuth2 (src/services/ApiStrava.ts - real client ID/secret from
//   its own registered app, authorize/token URLs, refresh tokens). Built for real 2026-08-07:
//   opensportsync uses a custom URL scheme (opensportsync://oauth/strava) for the redirect,
//   which needs the app registered as a URL handler with the OS - real, doable on Linux, but
//   heavier than this app currently needs. A local loopback HTTP callback server
//   (http://127.0.0.1:<ephemeral port>/callback, opened via QDesktopServices::openUrl into
//   the system browser) is the standard equivalent for a desktop app and needs no OS
//   registration - Strava's own OAuth docs list "http://localhost" as a valid Authorization
//   Callback Domain for exactly this case. Same client_id/client_secret/token/refresh_token
//   shape as the real Android app either way - see connectStrava()/exchangeStravaCode().
//
// Credentials stored via QSettings (this app's own org/name, set in main.cpp) - local,
// plain-text config, the same tier of storage most small desktop apps use for this; not an
// OS keychain, worth revisiting if this app ever handles anything more sensitive than a
// personal read/write API key.
class ConnectionsService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool intervalsIcuConnected READ intervalsIcuConnected NOTIFY intervalsIcuChanged)
    Q_PROPERTY(QString intervalsIcuAthleteId READ intervalsIcuAthleteId NOTIFY intervalsIcuChanged)
    Q_PROPERTY(bool runalyzeConnected READ runalyzeConnected NOTIFY runalyzeChanged)
    Q_PROPERTY(bool stravaConnected READ stravaConnected NOTIFY stravaChanged)
    Q_PROPERTY(bool stravaConnecting READ stravaConnecting NOTIFY stravaConnectingChanged)
    Q_PROPERTY(QString stravaClientId READ stravaClientId NOTIFY stravaChanged)
    Q_PROPERTY(QString stravaError READ stravaError NOTIFY stravaErrorChanged)

public:
    explicit ConnectionsService(QObject *parent = nullptr);

    bool intervalsIcuConnected() const { return !m_intervalsIcuAthleteId.isEmpty(); }
    QString intervalsIcuAthleteId() const { return m_intervalsIcuAthleteId; }
    bool runalyzeConnected() const { return m_runalyzeConnected; }
    bool stravaConnected() const { return !m_stravaRefreshToken.isEmpty(); }
    bool stravaConnecting() const { return m_stravaConnecting; }
    QString stravaClientId() const { return m_stravaClientId; }
    QString stravaError() const { return m_stravaError; }

    Q_INVOKABLE void saveIntervalsIcu(const QString &athleteId, const QString &apiKey);
    Q_INVOKABLE void disconnectIntervalsIcu();
    // Never exposed as a Q_PROPERTY - read once, into a form field, not bound in a Text
    // anywhere. QSettings' own storage is already plain text; no reason to also keep the
    // key sitting in a live QML property for longer than the dialog needs it.
    Q_INVOKABLE QString intervalsIcuApiKey() const;

    Q_INVOKABLE void saveRunalyze(const QString &apiKey);
    Q_INVOKABLE void disconnectRunalyze();
    Q_INVOKABLE QString runalyzeApiKey() const;

    // Starts the real OAuth2 flow: saves clientId/clientSecret, opens the system browser to
    // Strava's authorize page, and listens on a local loopback port for the redirect. Ends by
    // emitting stravaChanged() (success) or stravaErrorChanged() (any failure - server bind,
    // user never approves within the timeout, token exchange rejected).
    Q_INVOKABLE void connectStrava(const QString &clientId, const QString &clientSecret);
    Q_INVOKABLE void disconnectStrava();
    Q_INVOKABLE QString stravaClientSecret() const;

signals:
    void intervalsIcuChanged();
    void runalyzeChanged();
    void stravaChanged();
    void stravaConnectingChanged();
    void stravaErrorChanged();

private:
    void setStravaError(const QString &message);
    void handleStravaCallback(const QString &requestLine);
    void exchangeStravaCode(const QString &clientId, const QString &clientSecret,
                             const QString &code);
    void stopStravaCallbackServer();

    QSettings m_settings;
    QString m_intervalsIcuAthleteId;
    bool m_runalyzeConnected = false;

    QNetworkAccessManager m_network;
    QTcpServer *m_stravaCallbackServer = nullptr;
    QString m_stravaClientId;
    QString m_stravaRefreshToken;
    bool m_stravaConnecting = false;
    QString m_stravaError;
};
