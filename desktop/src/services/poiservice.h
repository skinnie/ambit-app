#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QUrl>
#include <QVariantList>

// Step 9. Deliberately thinner than DeviceService/RouteService: on-watch POIs come back as
// raw text only (see backend/server.py's own comment on why - the schema-driven field names
// aren't something this project can confirm ahead of a real watch check, unlike routes'
// fixed print format). addPoi() is a REAL write since 2026-08-11: the backend runs
// write_nav.py's `addpoi`, the Android app's hardware-confirmed (2026-08-06) native
// algorithm ported back into this repo's tools - the honest-501 era this class's comments
// used to describe is over.
class PoiService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    Q_PROPERTY(QString rawOutput READ rawOutput NOTIFY dataChanged)
    Q_PROPERTY(bool ok READ ok NOTIFY dataChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
    Q_PROPERTY(QString addResultText READ addResultText NOTIFY addResultChanged)
    // Whether the last addPoi() succeeded - the page colors addResultText by it (success
    // green vs error red) instead of assuming every result is a failure, which was true
    // in the 501 era and isn't anymore.
    Q_PROPERTY(bool addOk READ addOk NOTIFY addResultChanged)
    // GPX <wpt> import - real, confirmed-working on the Android app (opensportsync-main's
    // "POI import (GPX file and manual coordinates)"), missing here until 2026-08-07. Each
    // entry: {name, lat, lon}; submitting one goes through the same real addPoi() write as
    // manual entry - see this class's own note above.
    Q_PROPERTY(QVariantList importedPois READ importedPois NOTIFY importedPoisChanged)
    Q_PROPERTY(QString importError READ importError NOTIFY importedPoisChanged)
    // Real request 2026-08-08 ("POIs on the watch, please do like for the routes") - real
    // per-POI {name, lat, lon}, parsed from the same raw_output already fetched by
    // refresh(), matching this class's own header comment's caveat: those field names
    // (Name=/Location.Latitude=/Location.Longitude=) are now confirmed directly from real
    // hardware output, not guessed at ahead of a real watch check the way that comment
    // originally worried about.
    Q_PROPERTY(QVariantList onWatchPois READ onWatchPois NOTIFY dataChanged)

public:
    explicit PoiService(QObject *parent = nullptr);

    bool loading() const { return m_loading; }
    QString rawOutput() const { return m_rawOutput; }
    bool ok() const { return m_ok; }
    QString lastError() const { return m_lastError; }
    QString addResultText() const { return m_addResultText; }
    bool addOk() const { return m_addOk; }
    QVariantList importedPois() const { return m_importedPois; }
    QString importError() const { return m_importError; }
    QVariantList onWatchPois() const { return m_onWatchPois; }

    Q_INVOKABLE void refresh();
    Q_INVOKABLE void addPoi(const QString &name, double lat, double lon);
    Q_INVOKABLE void importGpxFile(const QUrl &fileUrl);
    // A single real <wpt> GPX, for LocalFileService.saveText() - built locally (no backend
    // round trip) since a one-point GPX needs nothing the watch/network has to supply beyond
    // the name/lat/lon this page already has in memory.
    Q_INVOKABLE QString buildWaypointGpx(const QString &name, double lat, double lon) const;

signals:
    void loadingChanged();
    void dataChanged();
    void lastErrorChanged();
    void addResultChanged();
    void importedPoisChanged();

private:
    QNetworkAccessManager m_network;
    bool m_loading = false;
    QString m_rawOutput;
    bool m_ok = false;
    QString m_lastError;
    QString m_addResultText;
    bool m_addOk = false;
    QVariantList m_importedPois;
    QString m_importError;
    QVariantList m_onWatchPois;

    void setLoading(bool value);
    static QVariantList parseOnWatchPois(const QString &rawOutput);
};
