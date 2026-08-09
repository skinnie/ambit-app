#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QUrl>
#include <QVariantList>
#include <QVariantMap>

// Real, 2026-08-09 ("2 bigger. Let's ship the full catalog") - the Suunto App Slot chain
// (tools/apps.py, tools/workout_install.py, custom_modes.py's own FT_RULE_ENGINE_0/1/2
// "Suunto App Slot N" fields) is fully reverse-engineered and wired into backend/server.py's
// own three endpoints. Kept as its own service rather than folded into CustomModesService -
// this is genuinely a different data domain (a 13,104-entry app catalog and the watch's own
// separate Apps flash region), not sport-mode structure itself.
class AppsService : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
    // Real apps currently installed on the watch (tools/apps.py's own decode of the Apps
    // flash region). Each entry: {ruleIdx, name, activityId, binaryLength, catalogMatch?:
    // {ruleId, name, categoryId, description}}. ruleIdx is confirmed to be exactly the
    // RuleIdx a display field's own RULE record points at - a UI can label a "Suunto App
    // Slot N" field by matching its RuleIdx against this list's own ruleIdx.
    Q_PROPERTY(QVariantList installedApps READ installedApps NOTIFY installedAppsChanged)
    Q_PROPERTY(bool searching READ searching NOTIFY searchingChanged)
    // Real catalog search results (data/suunto_apps/ - this app's own bundled copy of
    // SuuntoLink's real Suunto Apps catalog). Each entry: {ruleId, name, categoryId,
    // activityId, description, userCount, compatibleVariants}.
    Q_PROPERTY(QVariantList searchResults READ searchResults NOTIFY searchResultsChanged)
    Q_PROPERTY(bool installing READ installing NOTIFY installingChanged)
    // Result of the last install() call - {ok, dryRun?, wouldBeRuleIdx?, ruleIdx?, name,
    // ruleId, error?}. A UI reads this right after install() rather than a separate signal
    // payload, matching how every other write-result property in this app already works.
    Q_PROPERTY(QVariantMap lastInstallResult READ lastInstallResult NOTIFY lastInstallResultChanged)

public:
    explicit AppsService(QObject *parent = nullptr);

    bool loading() const { return m_loading; }
    QString lastError() const { return m_lastError; }
    QVariantList installedApps() const { return m_installedApps; }
    bool searching() const { return m_searching; }
    QVariantList searchResults() const { return m_searchResults; }
    bool installing() const { return m_installing; }
    QVariantMap lastInstallResult() const { return m_lastInstallResult; }

    // GET /api/apps - real, read-only (apps.py's own fast probe-first path), safe any time.
    Q_INVOKABLE void refreshInstalledApps();

    // GET /api/apps/catalog?q=&variant=&category= - no watch touched, a local file search.
    // `categoryId` < 0 means "any category" (QML has no clean "omit this arg" for an
    // optional int, so this stands in for that).
    Q_INVOKABLE void searchCatalog(const QString &query, const QString &variant,
                                    int categoryId = -1);

    // POST /api/apps/install. `mode` is the same 0-based EXERCISE_MODES_MODE index
    // CustomModesService.modes' own array position already is - not the mode's name.
    // confirm:false gets a real preview (wouldBeRuleIdx, built from the already-safe
    // /api/apps data - see backend/server.py's own _handle_apps_install comment for why
    // this never calls the write-capable tool at all in that case) without touching the
    // watch; confirm:true performs the real write. Same "explicit UI action is the
    // confirmation" rule as every other write in this app.
    Q_INVOKABLE void install(int mode, int display, int field, int ruleId, bool confirm);

signals:
    void loadingChanged();
    void lastErrorChanged();
    void installedAppsChanged();
    void searchingChanged();
    void searchResultsChanged();
    void installingChanged();
    void lastInstallResultChanged();

private:
    QNetworkAccessManager m_network;
    bool m_loading = false;
    QString m_lastError;
    QVariantList m_installedApps;
    bool m_searching = false;
    QVariantList m_searchResults;
    bool m_installing = false;
    QVariantMap m_lastInstallResult;

    void setLoading(bool value);
    void setLastError(const QString &message);
    void setSearching(bool value);
    void setInstalling(bool value);

    static QUrl backendUrl(const QString &path);
};
