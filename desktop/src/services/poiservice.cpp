#include "poiservice.h"

#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QXmlStreamReader>

static const QString kBackendBase = QStringLiteral("http://127.0.0.1:8766");

PoiService::PoiService(QObject *parent) : QObject(parent) {}

void PoiService::setLoading(bool value)
{
    if (m_loading == value)
        return;
    m_loading = value;
    emit loadingChanged();
}

// Matches write_nav.py's show_entries() print format exactly (confirmed directly against
// real hardware output, 2026-08-08 - see this class's own header comment):
//   Name='Casa Lille, Nor'  RouteName=''  Timestamp='...'  RouteIndex=0  Type=0  SubType=0
//   TypeIndex=0  Flags=0  Location.Latitude=506236700  Location.Longitude=30559214
// Latitude/Longitude are degrees * 1e7, the same convention as WaypointDescriptor's own
// lat/lon fields (show_navigation()'s `w.lat / 1e7`) - sanity-checked against a real POI
// named after a real place (Lille) decoding to Lille's actual coordinates.
QVariantList PoiService::parseOnWatchPois(const QString &rawOutput)
{
    QVariantList pois;
    static const QRegularExpression re(
        QStringLiteral(R"(Name='([^']*)'.*?Location\.Latitude=(-?\d+)\s+)"
                        R"(Location\.Longitude=(-?\d+))"));

    auto it = re.globalMatch(rawOutput);
    while (it.hasNext()) {
        const auto m = it.next();
        QVariantMap poi;
        poi[QStringLiteral("name")] = m.captured(1);
        poi[QStringLiteral("lat")] = m.captured(2).toDouble() / 1e7;
        poi[QStringLiteral("lon")] = m.captured(3).toDouble() / 1e7;
        pois.append(poi);
    }
    return pois;
}

QString PoiService::buildWaypointGpx(const QString &name, double lat, double lon) const
{
    return QStringLiteral(
               "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
               "<gpx version=\"1.1\" creator=\"AmbitApp\" "
               "xmlns=\"http://www.topografix.com/GPX/1/1\">\n"
               "  <wpt lat=\"%1\" lon=\"%2\"><name>%3</name></wpt>\n"
               "</gpx>\n")
        .arg(lat, 0, 'f', 7)
        .arg(lon, 0, 'f', 7)
        .arg(name.toHtmlEscaped());
}

void PoiService::refresh()
{
    setLoading(true);
    QNetworkReply *reply = m_network.get(
        QNetworkRequest(QUrl(kBackendBase + QStringLiteral("/api/pois"))));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        setLoading(false);

        if (reply->error() != QNetworkReply::NoError) {
            m_ok = false;
            m_lastError = reply->errorString();
            emit lastErrorChanged();
            emit dataChanged();
            return;
        }
        const auto doc = QJsonDocument::fromJson(reply->readAll());
        const auto obj = doc.object();
        m_ok = obj.value(QStringLiteral("ok")).toBool();
        m_rawOutput = obj.value(QStringLiteral("raw_output")).toString();
        m_onWatchPois = m_ok ? parseOnWatchPois(m_rawOutput) : QVariantList();
        if (!m_ok)
            m_lastError = obj.value(QStringLiteral("stderr")).toString();
        emit dataChanged();
    });
}

void PoiService::addPoi(const QString &name, double lat, double lon)
{
    QJsonObject body;
    body[QStringLiteral("name")] = name;
    body[QStringLiteral("lat")] = lat;
    body[QStringLiteral("lon")] = lon;

    QNetworkRequest req(QUrl(kBackendBase + QStringLiteral("/api/pois")));
    req.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *reply = m_network.post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        reply->deleteLater();
        const auto doc = QJsonDocument::fromJson(reply->readAll());
        // Expected to be the honest 501 right now (see this class's own header comment) -
        // shown to the user exactly as the backend phrases it, not reworded into something
        // that sounds more finished than it is.
        m_addResultText = doc.object().value(QStringLiteral("error")).toString();
        emit addResultChanged();
    });
}

void PoiService::importGpxFile(const QUrl &fileUrl)
{
    m_importedPois.clear();
    m_importError.clear();

    QFile file(fileUrl.toLocalFile());
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        m_importError = QStringLiteral("Couldn't open %1").arg(fileUrl.toLocalFile());
        emit importedPoisChanged();
        return;
    }

    // <wpt lat lon><name>...</name></wpt> - GPX's own waypoint element, distinct from
    // <trkpt>/<rtept> (RouteService's own parser, which reads those instead). Same
    // "accept GPX from anywhere" stance as RouteService::loadGpxFile: only looks for what
    // every real-world GPX file actually has, no assumptions beyond that.
    QXmlStreamReader xml(&file);
    bool inWpt = false;
    QString currentTag, pendingLat, pendingLon, pendingName;
    while (!xml.atEnd()) {
        const auto token = xml.readNext();
        if (token == QXmlStreamReader::StartElement) {
            currentTag = xml.name().toString();
            if (currentTag == QStringLiteral("wpt")) {
                inWpt = true;
                pendingLat = xml.attributes().value(QStringLiteral("lat")).toString();
                pendingLon = xml.attributes().value(QStringLiteral("lon")).toString();
                pendingName.clear();
            }
        } else if (token == QXmlStreamReader::EndElement) {
            if (xml.name() == QStringLiteral("wpt") && inWpt) {
                QVariantMap poi;
                poi[QStringLiteral("name")] =
                    pendingName.isEmpty() ? QStringLiteral("Unnamed") : pendingName;
                poi[QStringLiteral("lat")] = pendingLat.toDouble();
                poi[QStringLiteral("lon")] = pendingLon.toDouble();
                m_importedPois.append(poi);
                inWpt = false;
            }
            currentTag.clear();
        } else if (token == QXmlStreamReader::Characters && !xml.isWhitespace()) {
            if (inWpt && currentTag == QStringLiteral("name"))
                pendingName = xml.text().toString();
        }
    }

    if (xml.hasError()) {
        m_importError = QStringLiteral("GPX parse error: %1").arg(xml.errorString());
        m_importedPois.clear();
    } else if (m_importedPois.isEmpty()) {
        m_importError = QStringLiteral("No <wpt> waypoints found in this file.");
    }
    emit importedPoisChanged();
}
