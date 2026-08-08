#pragma once

#include <QJsonArray>
#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QVariantList>

// Step 7. Wraps backend/server.py's /api/activities (raw GPX/FIT per recorded move) and
// parses the GPX side into structured fields - the backend deliberately doesn't parse GPX
// itself (see that endpoint's own comment: it just re-exposes what exercise_log.py already
// wrote to disk), so that parsing happens here, once, rather than once per QML page that
// wants activity data.
//
// Parses against the *real*, known GPX shape `tools/exercise_log.py`'s own `to_gpx()`
// produces (checked directly, not guessed): <trk><name>, <extensions><duration/distance/
// ascent/sport_type>, and a <trkseg> of <trkpt lat lon><ele><time>.
//
// Honest gap, not fabricated: `sport_type` in that GPX is a raw byte
// (`header["activity_type"]` in exercise_log.py) that is never decoded to a real sport name
// anywhere in this project's own tooling - so this class exposes it as a raw number and
// nothing in the UI picks a sport-specific icon from it yet. Inventing a mapping here would
// be guessing at something this project has explicitly never verified.
//
// Local offline cache, real 2026-08-07 ("activities in general should be saved in the
// computer... loads when watch is not plugged"): every successful live refresh() also
// writes each activity's real GPX/FIT bytes to QStandardPaths::AppDataLocation +
// "/activities_cache/" (moveN.gpx/.fit - the same naming the backend's own temp dir already
// uses). A plain per-file cache, not a SQL database - this app has no database anywhere
// else either (QSettings for Connections, nothing more), and activities are already
// real, self-contained files once exported; a DB would be solving a problem that doesn't
// exist here. GPX only (not FIT) for the cache-driven UI itself, matching parseGpx()'s own
// input; FIT is cached alongside purely so offline Export FIT still works.
class ActivityService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    Q_PROPERTY(bool ok READ ok NOTIFY activitiesChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
    // True when activities[] came from the local cache (no live watch read succeeded this
    // time) rather than a real, just-now read off the watch.
    Q_PROPERTY(bool showingCachedData READ showingCachedData NOTIFY activitiesChanged)
    // Each entry: {name, durationSeconds, distanceMeters, ascentMeters, sportTypeRaw,
    // startTime (ISO string, from the first track point, empty if none),
    // track: [{lat, lon, ele}, ...], gpxText, fitBase64}
    Q_PROPERTY(QVariantList activities READ activities NOTIFY activitiesChanged)

public:
    explicit ActivityService(QObject *parent = nullptr);

    bool loading() const { return m_loading; }
    bool ok() const { return m_ok; }
    QString lastError() const { return m_lastError; }
    bool showingCachedData() const { return m_showingCachedData; }
    QVariantList activities() const { return m_activities; }

    Q_INVOKABLE void refresh();

signals:
    void loadingChanged();
    void activitiesChanged();
    void lastErrorChanged();

private:
    QNetworkAccessManager m_network;
    bool m_loading = false;
    bool m_ok = false;
    bool m_showingCachedData = false;
    QString m_lastError;
    QVariantList m_activities;

    void setLoading(bool value);
    void setLastError(const QString &message);
    static QVariantMap parseGpx(const QString &gpxText);
    static QString cacheDir();
    void saveToCache(const QJsonArray &rawActivities);
    bool loadFromCache();
};
