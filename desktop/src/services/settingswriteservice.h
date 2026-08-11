#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QUrl>
#include <QVariantList>

// Ambit3 (and Traverse/Ambit2, same schema family) DeviceSettings, real and hardware-
// confirmed 2026-08-08: this session found and fixed a real bug (an entry ID read off one
// watch's schema silently hit a different field when reused against another - see
// custom_modes_andre.md), then re-tested properly and had André confirm on the watch's own
// screen that flipping Display.Invert visibly switched it Light -> Dark. Wraps backend/
// server.py's /api/settings (GET for the current values, POST for a real write) which in
// turn wraps tools/settings_write.py - the curated, schema-driven field table lives there,
// not duplicated here; this class just re-shapes that JSON for QML.
class SettingsWriteService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    Q_PROPERTY(bool ok READ ok NOTIFY settingsChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
    // Which watch's own curated settings table to use - "" (default) for the Ambit3's,
    // "kailash" for Kailash's own (added 2026-08-08, see backend/server.py's own
    // _handle_settings_read()/_handle_settings_write() comments). Set from QML before
    // calling refresh()/writeSetting() based on HomeViewModel.isKailash.
    Q_PROPERTY(QString device READ device WRITE setDevice NOTIFY deviceChanged)
    // Each entry: {key, path, kind ("bool"/"enum"/"number"/"text"/"raw"), value, choices
    // ([{value, label}, ...] for "enum" - converted here from the tool's own [[value,
    // label], ...] pairs), min, max (for "number"), writable (false for a field with no
    // write path, e.g. Kailash's enabled_navigation_systems - show it, offer no editor)
    // and screen
    // ("general"/"units"/"personal", or null - which of SuuntoLink's own settings screens
    // it belongs to, so a UI can group the ~34 Ambit3 fields the way the watch's owner
    // already knows them). Kailash or a smaller
    // schema than Ambit3's own may legitimately be missing some of these (per-entry "ok"
    // dropped, not surfaced as a whole-list failure) - filtered out here rather than shown
    // as broken rows.
    Q_PROPERTY(QVariantList settings READ settings NOTIFY settingsChanged)
    // Key of the setting a write is currently in flight for, or empty - lets a single row's
    // control show a busy state without disabling the whole list.
    Q_PROPERTY(QString writingKey READ writingKey NOTIFY writingKeyChanged)

public:
    explicit SettingsWriteService(QObject *parent = nullptr);

    bool loading() const { return m_loading; }
    bool ok() const { return m_ok; }
    QString lastError() const { return m_lastError; }
    QVariantList settings() const { return m_settings; }
    QString writingKey() const { return m_writingKey; }
    QString device() const { return m_device; }
    void setDevice(const QString &value);

    // GET /api/settings - real, read-only (a single 0x1100 query), safe any time.
    Q_INVOKABLE void refresh();

    // POST /api/settings, confirm:true - a real 0x1101 write, applied immediately (the
    // same "an explicit tap/selection in this page's own UI is the confirmation" rule
    // DeviceService's own GPS-orbit "tap to update" already uses, not a second dialog).
    // `value` is the enum's own raw integer / the number's own value, matching what
    // tools/settings_write.py's --set expects - never a display label.
    Q_INVOKABLE void writeSetting(const QString &key, const QVariant &value);

signals:
    void loadingChanged();
    void settingsChanged();
    void lastErrorChanged();
    void writingKeyChanged();
    void deviceChanged();

private:
    QNetworkAccessManager m_network;
    bool m_loading = false;
    bool m_ok = false;
    QString m_lastError;
    QVariantList m_settings;
    QString m_writingKey;
    QString m_device;

    void setLoading(bool value);
    void setLastError(const QString &message);
    void setWritingKey(const QString &key);

    static QUrl backendUrl(const QString &path);
};
