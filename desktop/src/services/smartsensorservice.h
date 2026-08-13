#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>

// Settings-page card, 2026-08-13 (André: "just a card on settings ... pair the Suunto Smart
// Sensor and that it reports firmware, battery charge, serial, HR etc"). The Smart Sensor
// (the old Ambit-era HR belt) is a second, independent BLE peripheral - nothing to do with
// DeviceService's watch. Thin client over backend/server.py's /api/smartsensor/status,
// which wraps tools/smart_sensor.py - real, hardware-confirmed reads (Device Information +
// Battery + Heart Rate GATT services), not a mock.
class SmartSensorService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    // false until the first refresh() reply lands, so the card can tell "never checked"
    // apart from "checked, nothing found".
    Q_PROPERTY(bool checked READ checked NOTIFY stateChanged)
    Q_PROPERTY(bool ok READ ok NOTIFY stateChanged)
    Q_PROPERTY(bool found READ found NOTIFY stateChanged)
    Q_PROPERTY(QString errorText READ errorText NOTIFY stateChanged)
    Q_PROPERTY(QString manufacturer READ manufacturer NOTIFY stateChanged)
    Q_PROPERTY(QString model READ model NOTIFY stateChanged)
    Q_PROPERTY(QString serial READ serial NOTIFY stateChanged)
    Q_PROPERTY(QString hwRevision READ hwRevision NOTIFY stateChanged)
    Q_PROPERTY(QString fwRevision READ fwRevision NOTIFY stateChanged)
    Q_PROPERTY(QString swRevision READ swRevision NOTIFY stateChanged)
    // -1 means "not reported" (a real level is always 0-100).
    Q_PROPERTY(int batteryPercent READ batteryPercent NOTIFY stateChanged)
    // -1 means "no reading" - not worn (no skin contact) is the expected common case, not
    // an error, so this is never surfaced as one.
    Q_PROPERTY(int heartRateBpm READ heartRateBpm NOTIFY stateChanged)

public:
    explicit SmartSensorService(QObject *parent = nullptr);

    bool loading() const { return m_loading; }
    bool checked() const { return m_checked; }
    bool ok() const { return m_ok; }
    bool found() const { return m_found; }
    QString errorText() const { return m_errorText; }
    QString manufacturer() const { return m_manufacturer; }
    QString model() const { return m_model; }
    QString serial() const { return m_serial; }
    QString hwRevision() const { return m_hwRevision; }
    QString fwRevision() const { return m_fwRevision; }
    QString swRevision() const { return m_swRevision; }
    int batteryPercent() const { return m_batteryPercent; }
    int heartRateBpm() const { return m_heartRateBpm; }

    Q_INVOKABLE void refresh();
    // Unpairs/removes the belt from Bluetooth entirely (POST /api/smartsensor/forget) -
    // real request, 2026-08-13, so Pair can be exercised again without a terminal. Clears
    // the cached identity/battery/HR fields on success, since they'd otherwise keep
    // showing stale data for a device Bluetooth no longer knows about.
    Q_INVOKABLE void forget();

signals:
    void loadingChanged();
    void stateChanged();

private:
    QNetworkAccessManager m_network;
    bool m_loading = false;
    bool m_checked = false;
    bool m_ok = false;
    bool m_found = false;
    QString m_errorText;
    QString m_manufacturer;
    QString m_model;
    QString m_serial;
    QString m_hwRevision;
    QString m_fwRevision;
    QString m_swRevision;
    int m_batteryPercent = -1;
    int m_heartRateBpm = -1;

    void setLoading(bool value);
};
