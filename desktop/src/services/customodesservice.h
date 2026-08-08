#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QUrl>
#include <QVariantList>

// Ambit3 CustomModes (sport modes) - real, hardware-confirmed 2026-08-08. See
// custom_modes_andre.md for the full story: renaming a mode, changing its own settings
// (Autolap/HR limits/pod search), and changing which data a display row shows are all
// real, live-verified capabilities as of this session, not theoretical. Wraps backend/
// server.py's /api/customodes (GET) and its three write endpoints
// (rename/field/display-field), which in turn wrap tools/custom_modes.py and this
// session's three new write tools - the curated field semantics (SETTING_FIELDS,
// FIELD_TYPES) live there, not duplicated here.
class CustomModesService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    Q_PROPERTY(bool ok READ ok NOTIFY modesChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
    // Each entry: {name, activityId, customModeId, useHw, autolap, hrHigh, hrLow,
    // hrLimitsUse, autoStart, autoPause, autoScrolling, backlightMode, displayMode,
    // quickNavigation, displays: [{index, template, fields: [{indexName, type, typeName}]}]}
    Q_PROPERTY(QVariantList modes READ modes NOTIFY modesChanged)
    // Each entry: {value, name} - the real FIELD_TYPES catalog, fetched once and cached;
    // a UI builds its own "which data" picker from this.
    Q_PROPERTY(QVariantList fieldTypes READ fieldTypes NOTIFY fieldTypesChanged)
    // Name of the mode a write is currently in flight for, or empty.
    Q_PROPERTY(QString writingMode READ writingMode NOTIFY writingModeChanged)

public:
    explicit CustomModesService(QObject *parent = nullptr);

    bool loading() const { return m_loading; }
    bool ok() const { return m_ok; }
    QString lastError() const { return m_lastError; }
    QVariantList modes() const { return m_modes; }
    QVariantList fieldTypes() const { return m_fieldTypes; }
    QString writingMode() const { return m_writingMode; }

    // GET /api/customodes - real, read-only (a single ~12KB flash read), safe any time.
    Q_INVOKABLE void refresh();

    // GET /api/customodes/field-types - no watch touched, fetch once and cache.
    Q_INVOKABLE void refreshFieldTypes();

    // POST /api/customodes/rename, confirm:true - real write, applied immediately (same
    // "explicit UI action is the confirmation" rule as SettingsWriteService). Refreshes
    // modes() afterward either way, so the UI always reflects the watch's own real state.
    Q_INVOKABLE void renameMode(const QString &fromName, const QString &toName);

    // POST /api/customodes/field, confirm:true. `fields` maps SETTING_FIELDS names
    // (Autolap, HrHigh, HrLow, HrLimitsUse, UseHw, ...) to their new integer values.
    Q_INVOKABLE void writeField(const QString &mode, const QVariantMap &fields);

    // POST /api/customodes/display-field, confirm:true. `newType` is a FIELD_TYPES name
    // (e.g. "FT_HEART_RATE_CURR") - real, live-confirmed finding: `type`, not `index`, is
    // what actually selects the rendered content for the common case (see this class's
    // own header comment). `index` is left unchanged by this call on purpose - a UI
    // shouldn't need to touch it given what's now known.
    Q_INVOKABLE void writeDisplayField(const QString &mode, int display, int field,
                                        const QString &newType);

signals:
    void loadingChanged();
    void modesChanged();
    void fieldTypesChanged();
    void lastErrorChanged();
    void writingModeChanged();

private:
    QNetworkAccessManager m_network;
    bool m_loading = false;
    bool m_ok = false;
    QString m_lastError;
    QVariantList m_modes;
    QVariantList m_fieldTypes;
    QString m_writingMode;

    void setLoading(bool value);
    void setLastError(const QString &message);
    void setWritingMode(const QString &mode);

    static QUrl backendUrl(const QString &path);
};
