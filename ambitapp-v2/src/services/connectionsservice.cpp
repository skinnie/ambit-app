#include "connectionsservice.h"

#include <QDesktopServices>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTcpSocket>
#include <QTimer>
#include <QUrl>
#include <QUrlQuery>

static const QString kIntervalsGroup = QStringLiteral("connections/intervals_icu");
static const QString kRunalyzeGroup = QStringLiteral("connections/runalyze");
static const QString kStravaGroup = QStringLiteral("connections/strava");

static const QString kStravaAuthUrl = QStringLiteral("https://www.strava.com/oauth/authorize");
static const QString kStravaTokenUrl = QStringLiteral("https://www.strava.com/oauth/token");
// Matches ApiStrava.ts's own STRAVA_SCOPES exactly - "read" for pulling athlete/activity
// data back down the line, "activity:write" for uploading (neither is wired to anything yet,
// this is the Connect step only - see this class's header comment).
static const QString kStravaScopes = QStringLiteral("activity:write,read");

ConnectionsService::ConnectionsService(QObject *parent) : QObject(parent)
{
    m_intervalsIcuAthleteId =
        m_settings.value(kIntervalsGroup + QStringLiteral("/athleteId")).toString();
    m_runalyzeConnected =
        !m_settings.value(kRunalyzeGroup + QStringLiteral("/apiKey")).toString().isEmpty();
    m_stravaClientId = m_settings.value(kStravaGroup + QStringLiteral("/clientId")).toString();
    m_stravaRefreshToken =
        m_settings.value(kStravaGroup + QStringLiteral("/refreshToken")).toString();
}

void ConnectionsService::saveIntervalsIcu(const QString &athleteId, const QString &apiKey)
{
    m_settings.setValue(kIntervalsGroup + QStringLiteral("/athleteId"), athleteId.trimmed());
    m_settings.setValue(kIntervalsGroup + QStringLiteral("/apiKey"), apiKey.trimmed());
    m_intervalsIcuAthleteId = athleteId.trimmed();
    emit intervalsIcuChanged();
}

void ConnectionsService::disconnectIntervalsIcu()
{
    m_settings.remove(kIntervalsGroup);
    m_intervalsIcuAthleteId.clear();
    emit intervalsIcuChanged();
}

QString ConnectionsService::intervalsIcuApiKey() const
{
    return m_settings.value(kIntervalsGroup + QStringLiteral("/apiKey")).toString();
}

void ConnectionsService::saveRunalyze(const QString &apiKey)
{
    m_settings.setValue(kRunalyzeGroup + QStringLiteral("/apiKey"), apiKey.trimmed());
    m_runalyzeConnected = !apiKey.trimmed().isEmpty();
    emit runalyzeChanged();
}

void ConnectionsService::disconnectRunalyze()
{
    m_settings.remove(kRunalyzeGroup);
    m_runalyzeConnected = false;
    emit runalyzeChanged();
}

QString ConnectionsService::runalyzeApiKey() const
{
    return m_settings.value(kRunalyzeGroup + QStringLiteral("/apiKey")).toString();
}

void ConnectionsService::setStravaError(const QString &message)
{
    m_stravaError = message;
    emit stravaErrorChanged();
}

void ConnectionsService::stopStravaCallbackServer()
{
    if (m_stravaCallbackServer) {
        m_stravaCallbackServer->close();
        m_stravaCallbackServer->deleteLater();
        m_stravaCallbackServer = nullptr;
    }
}

void ConnectionsService::connectStrava(const QString &clientId, const QString &clientSecret)
{
    stopStravaCallbackServer();

    const QString trimmedId = clientId.trimmed();
    const QString trimmedSecret = clientSecret.trimmed();
    if (trimmedId.isEmpty() || trimmedSecret.isEmpty()) {
        setStravaError(QStringLiteral("Client ID and Client Secret are both required - "
                                       "register a real app at strava.com/settings/api first."));
        return;
    }

    m_settings.setValue(kStravaGroup + QStringLiteral("/clientId"), trimmedId);
    m_settings.setValue(kStravaGroup + QStringLiteral("/clientSecret"), trimmedSecret);
    m_stravaClientId = trimmedId;

    m_stravaCallbackServer = new QTcpServer(this);
    if (!m_stravaCallbackServer->listen(QHostAddress::LocalHost)) {
        setStravaError(QStringLiteral("Could not open a local port for the Strava login "
                                       "callback: %1")
                            .arg(m_stravaCallbackServer->errorString()));
        stopStravaCallbackServer();
        return;
    }
    const quint16 port = m_stravaCallbackServer->serverPort();

    m_stravaError.clear();
    emit stravaErrorChanged();
    m_stravaConnecting = true;
    emit stravaConnectingChanged();

    // Strava's own OAuth docs list "localhost" as a valid Authorization Callback Domain -
    // the standard desktop-app equivalent of the real Android app's custom URL scheme
    // redirect (see this class's header comment for why that path wasn't used here).
    const QString redirectUri = QStringLiteral("http://127.0.0.1:%1/callback").arg(port);

    QUrlQuery authQuery;
    authQuery.addQueryItem(QStringLiteral("client_id"), trimmedId);
    authQuery.addQueryItem(QStringLiteral("redirect_uri"), redirectUri);
    authQuery.addQueryItem(QStringLiteral("response_type"), QStringLiteral("code"));
    authQuery.addQueryItem(QStringLiteral("approval_prompt"), QStringLiteral("auto"));
    authQuery.addQueryItem(QStringLiteral("scope"), kStravaScopes);
    QUrl authUrl(kStravaAuthUrl);
    authUrl.setQuery(authQuery);

    connect(m_stravaCallbackServer, &QTcpServer::newConnection, this,
            [this, trimmedId, trimmedSecret] {
                QTcpSocket *socket = m_stravaCallbackServer->nextPendingConnection();
                connect(socket, &QTcpSocket::readyRead, this,
                        [this, socket, trimmedId, trimmedSecret] {
                            const QByteArray data = socket->readAll();
                            const QString requestLine =
                                QString::fromLatin1(data).split(QStringLiteral("\r\n")).value(0);

                            static const QString body = QStringLiteral(
                                "<html><body style=\"font-family:sans-serif;text-align:center;"
                                "margin-top:15%\"><h2>AmbitApp</h2><p>You can close this tab "
                                "and go back to AmbitApp.</p></body></html>");
                            const QByteArray bodyUtf8 = body.toUtf8();
                            const QByteArray response =
                                QStringLiteral("HTTP/1.1 200 OK\r\nContent-Type: "
                                               "text/html\r\nContent-Length: %1\r\nConnection: "
                                               "close\r\n\r\n")
                                    .arg(bodyUtf8.size())
                                    .toUtf8()
                                + bodyUtf8;
                            socket->write(response);
                            socket->flush();
                            socket->disconnectFromHost();

                            // requestLine looks like "GET /callback?code=... HTTP/1.1" - the
                            // path+query is the one space-separated field between the method
                            // and the HTTP version.
                            const QUrl requestUrl(QStringLiteral("http://127.0.0.1")
                                                   + requestLine.section(QLatin1Char(' '), 1, 1));
                            const QUrlQuery callbackQuery(requestUrl);
                            stopStravaCallbackServer();

                            if (callbackQuery.hasQueryItem(QStringLiteral("error"))) {
                                setStravaError(
                                    QStringLiteral("Strava login was cancelled or denied."));
                                m_stravaConnecting = false;
                                emit stravaConnectingChanged();
                                return;
                            }
                            const QString code =
                                callbackQuery.queryItemValue(QStringLiteral("code"));
                            if (code.isEmpty()) {
                                setStravaError(QStringLiteral(
                                    "Strava didn't send back an authorization code."));
                                m_stravaConnecting = false;
                                emit stravaConnectingChanged();
                                return;
                            }
                            exchangeStravaCode(trimmedId, trimmedSecret, code);
                        });
                connect(socket, &QTcpSocket::disconnected, socket, &QTcpSocket::deleteLater);
            });

    // Real people take longer than a few seconds to approve an OAuth prompt in a browser - 3
    // minutes, generous but not unbounded, so an abandoned/closed browser tab doesn't leave
    // the local port open (and "Connect" looking permanently stuck) forever.
    QTimer::singleShot(180000, this, [this] {
        if (m_stravaCallbackServer) {
            setStravaError(QStringLiteral("Timed out waiting for Strava login - try again."));
            m_stravaConnecting = false;
            emit stravaConnectingChanged();
            stopStravaCallbackServer();
        }
    });

    QDesktopServices::openUrl(authUrl);
}

void ConnectionsService::exchangeStravaCode(const QString &clientId, const QString &clientSecret,
                                             const QString &code)
{
    QUrlQuery body;
    body.addQueryItem(QStringLiteral("client_id"), clientId);
    body.addQueryItem(QStringLiteral("client_secret"), clientSecret);
    body.addQueryItem(QStringLiteral("code"), code);
    body.addQueryItem(QStringLiteral("grant_type"), QStringLiteral("authorization_code"));

    QNetworkRequest request{QUrl(kStravaTokenUrl)};
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                       QStringLiteral("application/x-www-form-urlencoded"));
    QNetworkReply *reply =
        m_network.post(request, body.query(QUrl::FullyEncoded).toUtf8());
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        m_stravaConnecting = false;
        emit stravaConnectingChanged();

        if (reply->error() != QNetworkReply::NoError) {
            setStravaError(
                QStringLiteral("Strava token exchange failed: %1").arg(reply->errorString()));
            return;
        }
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const QString refreshToken = obj.value(QStringLiteral("refresh_token")).toString();
        if (refreshToken.isEmpty()) {
            setStravaError(QStringLiteral("Strava didn't return a refresh token."));
            return;
        }
        m_settings.setValue(kStravaGroup + QStringLiteral("/refreshToken"), refreshToken);
        m_settings.setValue(kStravaGroup + QStringLiteral("/accessToken"),
                             obj.value(QStringLiteral("access_token")).toString());
        m_settings.setValue(kStravaGroup + QStringLiteral("/expiresAt"),
                             obj.value(QStringLiteral("expires_at")).toVariant());
        m_stravaRefreshToken = refreshToken;
        emit stravaChanged();
    });
}

void ConnectionsService::disconnectStrava()
{
    stopStravaCallbackServer();
    m_settings.remove(kStravaGroup);
    m_stravaClientId.clear();
    m_stravaRefreshToken.clear();
    m_stravaConnecting = false;
    emit stravaChanged();
    emit stravaConnectingChanged();
}

QString ConnectionsService::stravaClientSecret() const
{
    return m_settings.value(kStravaGroup + QStringLiteral("/clientSecret")).toString();
}
