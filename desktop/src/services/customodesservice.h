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
    // Multisport modes - real, 2026-08-11 (André, item 22): "triathlon/multisport mode is
    // missing from our menu, and it is on the watch". It was never missing data: a multisport
    // mode lives in the SPORT_MODE slots, not the exercise modes this list carries, and has
    // no displays of its own - only an ordered list of legs pointing at other modes.
    Q_PROPERTY(QVariantList multisportModes READ multisportModes NOTIFY modesChanged)
    // Each entry: {value, name} - the real FIELD_TYPES catalog, fetched once and cached;
    // a UI builds its own "which data" picker from this.
    Q_PROPERTY(QVariantList fieldTypes READ fieldTypes NOTIFY fieldTypesChanged)
    Q_PROPERTY(QVariantList rowMenu READ rowMenu NOTIFY rowMenuChanged)
    Q_PROPERTY(bool rowMenuMultiValue READ rowMenuMultiValue NOTIFY rowMenuChanged)
    Q_PROPERTY(int rowMenuMaxValues READ rowMenuMaxValues NOTIFY rowMenuChanged)
    // Name of the mode a write is currently in flight for, or empty.
    // This watch's own limits and features, from the generated per-device table. Defaults
    // are the Ambit3 family's so a UI has sane numbers before the fetch lands.
    Q_PROPERTY(QVariantMap capabilities READ capabilities NOTIFY capabilitiesChanged)
    Q_PROPERTY(QString writingMode READ writingMode NOTIFY writingModeChanged)

public:
    explicit CustomModesService(QObject *parent = nullptr);

    bool loading() const { return m_loading; }
    bool ok() const { return m_ok; }
    QString lastError() const { return m_lastError; }
    QVariantList modes() const { return m_modes; }
    QVariantList multisportModes() const { return m_multisportModes; }
    QVariantList fieldTypes() const { return m_fieldTypes; }
    QVariantList rowMenu() const { return m_rowMenu; }
    bool rowMenuMultiValue() const { return m_rowMenuMultiValue; }
    int rowMenuMaxValues() const { return m_rowMenuMaxValues; }
    QVariantMap capabilities() const { return m_capabilities; }
    QString writingMode() const { return m_writingMode; }

    // GET /api/customodes - real, read-only (a single ~12KB flash read), safe any time.
    Q_INVOKABLE void refresh();

    // GET /api/customodes/field-types - no watch touched, fetch once and cache.
    Q_INVOKABLE void refreshFieldTypes();
    // What may go on one particular row, as SuuntoLink itself would offer it: grouped into
    // its categories, in its order, with its labels, filtered by the mode's sport and the
    // display's type. Unlike fieldTypes() - which is the whole 95-entry catalogue and is
    // wrong to show a user directly, since most of it is not offerable on a given row - this
    // is per-row and answers "what can this row become". Results land in rowMenu.
    Q_INVOKABLE void refreshRowMenu(int activityId, int template_, const QString &row);
    // GET /api/customodes/capabilities?variant=<codename>. Call with DeviceService.model.
    Q_INVOKABLE void refreshCapabilities(const QString &variant);

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
    // Real, 2026-08-10 (items 6/7/10): structural display edits - add/remove a display,
    // change its type, set a row's values - applied as ONE region write. `edits` is the
    // list the UI has staged; the watch has no per-field command for sport modes, so every
    // save rewrites the whole ~7.5 KB region and writing per click would cost a full write
    // per click. Staging and saving once is also what SuuntoLink does. The tool behind this
    // refuses any write unless it can first reproduce the watch's current region byte-for-
    // byte (tools/custom_modes_edit.py).
    Q_INVOKABLE void applyDisplayEdits(const QString &mode, const QVariantList &edits);
    Q_INVOKABLE void writeDisplayField(const QString &mode, int display, int field,
                                        const QString &newType);

signals:
    void loadingChanged();
    void modesChanged();
    void fieldTypesChanged();
    void rowMenuChanged();
    void capabilitiesChanged();
    void lastErrorChanged();
    void writingModeChanged();
    void displayEditsApplied(bool ok);

private:
    QNetworkAccessManager m_network;
    bool m_loading = false;
    bool m_ok = false;
    QString m_lastError;
    QVariantList m_modes;
    QVariantList m_multisportModes;
    QVariantList m_fieldTypes;
    QVariantList m_rowMenu;
    bool m_rowMenuMultiValue = false;
    int m_rowMenuMaxValues = 1;
    QVariantMap m_capabilities;
    QString m_writingMode;

    void setLoading(bool value);
    void setLastError(const QString &message);
    void setWritingMode(const QString &mode);

    static QUrl backendUrl(const QString &path);
};
