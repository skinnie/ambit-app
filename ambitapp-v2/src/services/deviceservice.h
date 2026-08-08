#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QTimer>
#include <QUrl>

// AMBITAPP_SPEC.md's architecture: QML -> ViewModels -> Services -> Current Backend ->
// libambit. This is the first real "Services" class - a thin HTTP client against
// ambitapp-v2/backend/server.py (see that file and ../../README.md's "Architecture
// decision" section for why the backend is Python, not C++). It knows nothing about the
// watch protocol itself, only how to ask the local backend about it.
//
// QML_SINGLETON: one instance, shared app-wide - matches there being exactly one backend
// server process to talk to, not one client per page.
//
// 2026-08-07, real testing found this was slower to show "Connected" than the real Android
// app: refresh() used to also fetch /api/nav (a full read of the Waypoints+Routes flash
// regions, ~146KB over USB) just to use its success/failure as the connectivity signal -
// nothing in the UI ever showed navOk/navRawOutput otherwise (checked directly - zero other
// references). /api/device (a single ~40-byte 0x0000 command) is a real, much faster
// connectivity signal on its own; the nav fetch added real, unnecessary latency to
// something that never needed it. Removed entirely, not just deferred.
class DeviceService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    Q_PROPERTY(bool backendReachable READ backendReachable NOTIFY backendReachableChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)

    // 2026-08-07: real, confirmed working against real hardware (tools/device_info.py) -
    // see device_info.py's own docstring for the source (commands this project already
    // knew about, reply layout from openambit's real code).
    Q_PROPERTY(bool deviceInfoOk READ deviceInfoOk NOTIFY deviceInfoChanged)
    Q_PROPERTY(QString model READ model NOTIFY deviceInfoChanged)
    Q_PROPERTY(QString serial READ serial NOTIFY deviceInfoChanged)
    Q_PROPERTY(QString firmwareVersion READ firmwareVersion NOTIFY deviceInfoChanged)
    Q_PROPERTY(QString hardwareVersion READ hardwareVersion NOTIFY deviceInfoChanged)
    Q_PROPERTY(int batteryPercent READ batteryPercent NOTIFY deviceInfoChanged)

    // GPS orbit (AGPS/SGEE) update - real, 2026-08-07. The backend side
    // (POST /api/agps/update, sgee_andre.md) was already built and hardware-verified; only
    // this Service and HomePage.qml's "Not available yet" text were missing, found via real
    // testing ("check android version, it is working there" - opensportsync-main's
    // SgeeService.ts/HomeScreen.tsx do exactly this on one tap, matched here the same way
    // rather than adding a separate rehearse step this app doesn't otherwise expose for it).
    Q_PROPERTY(bool gpsOrbitBusy READ gpsOrbitBusy NOTIFY gpsOrbitChanged)
    Q_PROPERTY(QString gpsOrbitStatusText READ gpsOrbitStatusText NOTIFY gpsOrbitChanged)

public:
    explicit DeviceService(QObject *parent = nullptr);

    bool loading() const { return m_loading; }
    bool backendReachable() const { return m_backendReachable; }
    QString lastError() const { return m_lastError; }

    bool deviceInfoOk() const { return m_deviceInfoOk; }
    QString model() const { return m_model; }
    QString serial() const { return m_serial; }
    QString firmwareVersion() const { return m_firmwareVersion; }
    QString hardwareVersion() const { return m_hardwareVersion; }
    int batteryPercent() const { return m_batteryPercent; }

    // Checks /api/health, then /api/device (identity, battery). Read-only on the backend
    // side, safe to call any time.
    Q_INVOKABLE void refresh();

    bool gpsOrbitBusy() const { return m_gpsOrbitBusy; }
    QString gpsOrbitStatusText() const { return m_gpsOrbitStatusText; }

    // Downloads fresh orbital data and writes it to the watch in one call (POST
    // /api/agps/update, confirm:true) - a real watch write, not a rehearsal; the backend's
    // own sgee.py already only actually re-flashes if the generation date changed, so a
    // repeat tap when nothing's stale is cheap, matching the real Android app's own
    // no-separate-confirm-step UI.
    Q_INVOKABLE void updateGpsOrbit();

    // Read-only (GET /api/agps/status, a plain 0x0b15 query - no network fetch, nothing
    // written), safe to call on every Home load the same way refresh() is. Shows the watch's
    // own currently-stored orbit-data date even with no internet connection at all, which is
    // the whole point of it being separate from updateGpsOrbit() rather than folded into it.
    Q_INVOKABLE void checkGpsOrbitStatus();

signals:
    void loadingChanged();
    void backendReachableChanged();
    void lastErrorChanged();
    void deviceInfoChanged();
    void gpsOrbitChanged();

private:
    QNetworkAccessManager m_network;
    bool m_loading = false;
    bool m_backendReachable = false;
    QString m_lastError;

    bool m_deviceInfoOk = false;
    QString m_model;
    QString m_serial;
    QString m_firmwareVersion;
    QString m_hardwareVersion;
    int m_batteryPercent = -1;

    bool m_gpsOrbitBusy = false;
    QString m_gpsOrbitStatusText;

    // Auto-refresh, real request 2026-08-08 ("if watch is connected don't refresh, if not
    // connected refresh with a 1 second interval, remove the refresh button"). Superseded
    // an earlier 5s-always-polling design (see V3_CHANGELOG.md).
    QTimer m_pollTimer;
    static constexpr int kPollIntervalMs = 1000;

    // Real bug, found live 2026-08-08 ("it is blocked on ambit connected even if it
    // disconnected"): taking "don't refresh once connected" completely literally - stopping
    // m_pollTimer outright and also removing the manual Refresh button in the same round -
    // meant a real disconnection was *never* noticed once deviceInfoOk had gone true: with
    // nothing polling and no button, refresh() would simply never run again. This slower
    // heartbeat is the real fix - not a return to fast polling, just a low-cost "is it still
    // there" check every 10s while connected, so a real unplug gets noticed within a bounded
    // time instead of being stuck forever. m_pollTimer (1s) stays reserved for the "actively
    // searching" case; the two are never running at the same time.
    QTimer m_heartbeatTimer;
    static constexpr int kHeartbeatIntervalMs = 10000;

    void setLoading(bool value);
    void setLastError(const QString &friendlyMessage, const QString &technicalDetail);
    void fetchDeviceInfo();
    void logToFile(const QString &line);

    static QUrl backendUrl(const QString &path);
};
