#include "gearservice.h"

#include <QDateTime>
#include <QDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSettings>
#include <QSqlError>
#include <QSqlQuery>
#include <QStandardPaths>
#include <QtMath>

namespace {
const QString kBase = QStringLiteral("https://intervals.icu/api/v1");
const QString kAthleteKey = QStringLiteral("connections/intervals_icu/athleteId");
const QString kApiKeyKey = QStringLiteral("connections/intervals_icu/apiKey");

// intervals.icu gear `type` is free-form; only Bike/Shoes are top-level (the rest are parts).
bool isTopLevel(const QString &type)
{
    const QString t = type.toLower();
    return t == QStringLiteral("bike") || t == QStringLiteral("shoes") || t == QStringLiteral("shoe");
}

// Local due-ness: (gear total - reset baseline) / interval, max across the units a reminder sets.
// On desktop the gear total is the imported intervals distance/time (baseline); this still
// computes due-ness ourselves rather than trusting percent_used.
double reminderPercent(const QSqlQuery &r, double gearDistanceM, double gearTimeS, qint64 nowMs)
{
    double pct = 0.0;
    const double distInt = r.value(QStringLiteral("distance_m")).toDouble();
    const double timeInt = r.value(QStringLiteral("time_s")).toDouble();
    const int days = r.value(QStringLiteral("days")).toInt();
    const double startDist = r.value(QStringLiteral("starting_distance_m")).toDouble();
    const double startTime = r.value(QStringLiteral("starting_time_s")).toDouble();
    const qint64 lastReset = r.value(QStringLiteral("last_reset")).toLongLong();
    if (distInt > 0) pct = qMax(pct, qMax(0.0, gearDistanceM - startDist) / distInt * 100.0);
    if (timeInt > 0) pct = qMax(pct, qMax(0.0, gearTimeS - startTime) / timeInt * 100.0);
    if (days > 0 && lastReset > 0)
        pct = qMax(pct, double(nowMs - lastReset) / 86400000.0 / days * 100.0);
    return pct;
}

QString reminderLabel(const QSqlQuery &r)
{
    const double dist = r.value(QStringLiteral("distance_m")).toDouble();
    const double time = r.value(QStringLiteral("time_s")).toDouble();
    const int days = r.value(QStringLiteral("days")).toInt();
    const int acts = r.value(QStringLiteral("activities")).toInt();
    if (dist > 0) return QStringLiteral("%1 km").arg(qRound(dist / 1000.0));
    if (time > 0) return QStringLiteral("%1 h").arg(qRound(time / 3600.0));
    if (days > 0) return QStringLiteral("%1 d").arg(days);
    if (acts > 0) return QStringLiteral("%1×").arg(acts);
    return QStringLiteral("—");
}
} // namespace

GearService::GearService(QObject *parent) : QObject(parent)
{
    openDatabase();
    loadFromDb();
}

QString GearService::apiKey() const { return QSettings().value(kApiKeyKey).toString(); }
QString GearService::athleteId() const { return QSettings().value(kAthleteKey).toString(); }
bool GearService::connected() const { return !apiKey().isEmpty() && !athleteId().isEmpty(); }

void GearService::setLoading(bool v)
{
    if (m_loading == v) return;
    m_loading = v;
    emit loadingChanged();
}

void GearService::setLastError(const QString &e)
{
    m_lastError = e;
    emit lastErrorChanged();
}

void GearService::openDatabase()
{
    m_db = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"), QStringLiteral("gear"));
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(dir);
    m_db.setDatabaseName(dir + QStringLiteral("/gear.db"));
    if (!m_db.open()) {
        setLastError(m_db.lastError().text());
        return;
    }
    QSqlQuery q(m_db);
    q.exec(QStringLiteral(
        "CREATE TABLE IF NOT EXISTS gear ("
        "id TEXT PRIMARY KEY, remote_id TEXT, parent_id TEXT, name TEXT, type TEXT, "
        "component INTEGER, distance_m REAL, time_s REAL, retired INTEGER, "
        "component_ids TEXT)"));
    q.exec(QStringLiteral("ALTER TABLE gear ADD COLUMN component_ids TEXT")); // migrate older DBs
    q.exec(QStringLiteral(
        "CREATE TABLE IF NOT EXISTS gear_reminder ("
        "id TEXT PRIMARY KEY, gear_id TEXT, name TEXT, distance_m REAL, time_s REAL, "
        "days INTEGER, activities INTEGER, starting_distance_m REAL, starting_time_s REAL, "
        "last_reset INTEGER)"));
    // Default gear per decoded sport name, and the local usage ledger (manual per-activity gear).
    q.exec(QStringLiteral(
        "CREATE TABLE IF NOT EXISTS gear_assignment (sport TEXT PRIMARY KEY, gear_id TEXT)"));
    q.exec(QStringLiteral(
        "CREATE TABLE IF NOT EXISTS activity_gear ("
        "activity_key TEXT PRIMARY KEY, gear_id TEXT, distance_m REAL, time_s REAL)"));
}

void GearService::send(const QByteArray &verb, const QString &path, const QJsonObject &body,
                       std::function<void(const QJsonDocument &)> onOk)
{
    if (!connected()) {
        setLastError(tr("Connect Intervals.icu in Settings first."));
        return;
    }
    setLoading(true);
    setLastError(QString());

    QNetworkRequest req(QUrl(QStringLiteral("%1/athlete/%2%3").arg(kBase, athleteId(), path)));
    const QByteArray basic = QByteArrayLiteral("API_KEY:") + apiKey().toUtf8();
    req.setRawHeader("Authorization", "Basic " + basic.toBase64());
    // Cloudflare in front of intervals.icu returns 1010 (banned) for QNetworkAccessManager's
    // empty default User-Agent — proven live 2026-08-18. A normal Mozilla-style UA passes.
    req.setRawHeader("User-Agent",
                     "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Sommet/1.0");
    QByteArray data;
    if (!body.isEmpty()) {
        data = QJsonDocument(body).toJson(QJsonDocument::Compact);
        req.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    }

    QNetworkReply *reply = nullptr;
    if (verb == "GET") reply = m_net.get(req);
    else if (verb == "POST") reply = m_net.post(req, data);
    else if (verb == "PUT") reply = m_net.put(req, data);
    else if (verb == "DELETE") reply = m_net.deleteResource(req);
    else reply = m_net.sendCustomRequest(req, verb, data);

    connect(reply, &QNetworkReply::finished, this, [this, reply, onOk]() {
        reply->deleteLater();
        setLoading(false);
        if (reply->error() != QNetworkReply::NoError) {
            setLastError(reply->errorString());
            return;
        }
        onOk(QJsonDocument::fromJson(reply->readAll()));
    });
}

void GearService::importFromIntervals()
{
    send("GET", QStringLiteral("/gear"), {}, [this](const QJsonDocument &doc) {
        if (!doc.isArray()) {
            setLastError(tr("Unexpected response from Intervals.icu."));
            return;
        }
        const QJsonArray arr = doc.array();

        // Build the child -> parent map from every parent's component_ids.
        QHash<QString, QString> parentOf;
        for (const QJsonValue &v : arr) {
            const QJsonObject o = v.toObject();
            const QString id = o.value(QStringLiteral("id")).toVariant().toString();
            for (const QJsonValue &c : o.value(QStringLiteral("component_ids")).toArray())
                parentOf.insert(c.toVariant().toString(), id);
        }

        // Pull-only: remote is the source, so replace the local snapshot wholesale.
        QSqlQuery clear(m_db);
        clear.exec(QStringLiteral("DELETE FROM gear"));
        clear.exec(QStringLiteral("DELETE FROM gear_reminder"));

        int count = 0;
        for (const QJsonValue &v : arr) {
            const QVariantMap g = v.toObject().toVariantMap();
            const QString id = g.value(QStringLiteral("id")).toString();
            storeGear(g, parentOf.value(id));
            ++count;
        }

        loadFromDb();
        emit importFinished(count);
    });
}

QString GearService::componentIdsJson(const QString &gearId) const
{
    QSqlQuery q(m_db);
    q.prepare(QStringLiteral("SELECT component_ids FROM gear WHERE id = ?"));
    q.addBindValue(gearId);
    q.exec();
    return q.next() ? q.value(0).toString() : QString();
}

// ── Editing (write-through to intervals.icu, then re-import to refresh) ─────────

void GearService::addGear(const QString &name, const QString &type)
{
    send("POST", QStringLiteral("/gear"),
         QJsonObject{{"name", name}, {"type", type}, {"component", false}},
         [this](const QJsonDocument &) { importFromIntervals(); });
}

void GearService::addComponent(const QString &parentId, const QString &name, const QString &type)
{
    const QString stored = componentIdsJson(parentId);
    send("POST", QStringLiteral("/gear"),
         QJsonObject{{"name", name}, {"type", type}, {"component", true}},
         [this, parentId, stored](const QJsonDocument &doc) {
             const QString newId = doc.object().value(QStringLiteral("id")).toVariant().toString();
             if (newId.isEmpty() || parentId.isEmpty()) { importFromIntervals(); return; }
             QJsonArray ids = QJsonDocument::fromJson(stored.toUtf8()).array();
             ids.append(newId);
             send("PUT", QStringLiteral("/gear/%1").arg(parentId),
                  QJsonObject{{"component_ids", ids}},
                  [this](const QJsonDocument &) { importFromIntervals(); });
         });
}

void GearService::renameGear(const QString &id, const QString &name)
{
    send("PUT", QStringLiteral("/gear/%1").arg(id), QJsonObject{{"name", name}},
         [this](const QJsonDocument &) { importFromIntervals(); });
}

void GearService::setRetired(const QString &id, bool retired)
{
    send("PUT", QStringLiteral("/gear/%1").arg(id), QJsonObject{{"retired", retired}},
         [this](const QJsonDocument &) { importFromIntervals(); });
}

void GearService::removeGear(const QString &id)
{
    send("DELETE", QStringLiteral("/gear/%1").arg(id), {},
         [this](const QJsonDocument &) { importFromIntervals(); });
}

void GearService::addReminder(const QString &gearId, const QString &name,
                              double km, double hours, int days, int activities)
{
    send("POST", QStringLiteral("/gear/%1/reminder").arg(gearId),
         QJsonObject{{"name", name}, {"distance", km * 1000.0}, {"time", hours * 3600.0},
                     {"days", days}, {"activities", activities}},
         [this](const QJsonDocument &) { importFromIntervals(); });
}

void GearService::removeReminder(const QString &gearId, const QString &reminderId)
{
    send("DELETE", QStringLiteral("/gear/%1/reminder/%2").arg(gearId, reminderId), {},
         [this](const QJsonDocument &) { importFromIntervals(); });
}

// ── Local distance tally + manual per-activity gear (D2-a, all local) ──────────

void GearService::setAssignment(const QString &sport, const QString &gearId)
{
    QSqlQuery q(m_db);
    if (gearId.isEmpty()) {
        q.prepare(QStringLiteral("DELETE FROM gear_assignment WHERE sport = ?"));
        q.addBindValue(sport);
    } else {
        q.prepare(QStringLiteral("INSERT OR REPLACE INTO gear_assignment (sport, gear_id) VALUES (?, ?)"));
        q.addBindValue(sport);
        q.addBindValue(gearId);
    }
    q.exec();
    loadFromDb();
}

QString GearService::defaultGearForSport(const QString &sport) const
{
    QSqlQuery q(m_db);
    q.prepare(QStringLiteral("SELECT gear_id FROM gear_assignment WHERE sport = ? LIMIT 1"));
    q.addBindValue(sport);
    q.exec();
    return q.next() ? q.value(0).toString() : QString();
}

void GearService::attributeActivity(const QString &key, const QString &gearId,
                                    double distanceM, double timeS)
{
    QSqlQuery q(m_db);
    if (gearId.isEmpty()) {
        q.prepare(QStringLiteral("DELETE FROM activity_gear WHERE activity_key = ?"));
        q.addBindValue(key);
    } else {
        q.prepare(QStringLiteral(
            "INSERT OR REPLACE INTO activity_gear (activity_key, gear_id, distance_m, time_s) "
            "VALUES (?, ?, ?, ?)"));
        q.addBindValue(key);
        q.addBindValue(gearId);
        q.addBindValue(distanceM);
        q.addBindValue(timeS);
    }
    q.exec();
    loadFromDb();
}

void GearService::clearActivity(const QString &key)
{
    attributeActivity(key, QString(), 0, 0);
}

QString GearService::activityGearId(const QString &key) const
{
    QSqlQuery q(m_db);
    q.prepare(QStringLiteral("SELECT gear_id FROM activity_gear WHERE activity_key = ? LIMIT 1"));
    q.addBindValue(key);
    q.exec();
    return q.next() ? q.value(0).toString() : QString();
}

void GearService::storeGear(const QVariantMap &g, const QString &parentId)
{
    const QString id = g.value(QStringLiteral("id")).toString();
    const QJsonArray compIds = QJsonArray::fromStringList(
        [&] { QStringList out; for (const QVariant &c : g.value(QStringLiteral("component_ids")).toList())
                  out << c.toString(); return out; }());

    QSqlQuery q(m_db);
    q.prepare(QStringLiteral(
        "INSERT OR REPLACE INTO gear "
        "(id, remote_id, parent_id, name, type, component, distance_m, time_s, retired, component_ids) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"));
    q.addBindValue(id);
    q.addBindValue(id); // remote_id == id (numeric intervals id)
    q.addBindValue(parentId);
    q.addBindValue(g.value(QStringLiteral("name")).toString());
    q.addBindValue(g.value(QStringLiteral("type")).toString());
    q.addBindValue(g.value(QStringLiteral("component")).toBool() ? 1 : 0);
    q.addBindValue(g.value(QStringLiteral("distance")).toDouble());
    q.addBindValue(g.value(QStringLiteral("time")).toDouble());
    q.addBindValue(g.value(QStringLiteral("retired")).toBool() ? 1 : 0);
    q.addBindValue(QString::fromUtf8(QJsonDocument(compIds).toJson(QJsonDocument::Compact)));
    q.exec();

    for (const QVariant &rv : g.value(QStringLiteral("reminders")).toList()) {
        const QVariantMap r = rv.toMap();
        QSqlQuery rq(m_db);
        rq.prepare(QStringLiteral(
            "INSERT OR REPLACE INTO gear_reminder "
            "(id, gear_id, name, distance_m, time_s, days, activities, "
            " starting_distance_m, starting_time_s, last_reset) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"));
        rq.addBindValue(r.value(QStringLiteral("id")).toString());
        rq.addBindValue(id);
        rq.addBindValue(r.value(QStringLiteral("name")).toString());
        rq.addBindValue(r.value(QStringLiteral("distance")).toDouble());
        rq.addBindValue(r.value(QStringLiteral("time")).toDouble());
        rq.addBindValue(r.value(QStringLiteral("days")).toInt());
        rq.addBindValue(r.value(QStringLiteral("activities")).toInt());
        rq.addBindValue(r.value(QStringLiteral("starting_distance")).toDouble());
        rq.addBindValue(r.value(QStringLiteral("starting_time")).toDouble());
        const QString lastReset = r.value(QStringLiteral("last_reset")).toString();
        const QDateTime dt = QDateTime::fromString(lastReset, Qt::ISODateWithMs);
        rq.addBindValue(dt.isValid() ? dt.toMSecsSinceEpoch() : 0);
        rq.exec();
    }
}

void GearService::loadFromDb()
{
    m_gears.clear();
    m_assignments.clear();
    m_dueCount = 0;
    m_soonCount = 0;
    if (!m_db.isOpen()) {
        emit gearsChanged();
        return;
    }
    const qint64 now = QDateTime::currentMSecsSinceEpoch();

    QSqlQuery aq(QStringLiteral("SELECT sport, gear_id FROM gear_assignment"), m_db);
    while (aq.next())
        m_assignments.insert(aq.value(0).toString(), aq.value(1).toString());

    QSqlQuery q(QStringLiteral(
        "SELECT id, remote_id, parent_id, name, type, component, distance_m, time_s, retired "
        "FROM gear ORDER BY retired ASC, name ASC"), m_db);
    while (q.next()) {
        const QString id = q.value(QStringLiteral("id")).toString();
        const double distanceM = q.value(QStringLiteral("distance_m")).toDouble();
        const double timeS = q.value(QStringLiteral("time_s")).toDouble();

        QVariantList reminders;
        QSqlQuery rq(m_db);
        rq.prepare(QStringLiteral(
            "SELECT id, name, distance_m, time_s, days, activities, starting_distance_m, "
            "starting_time_s, last_reset FROM gear_reminder WHERE gear_id = ?"));
        rq.addBindValue(id);
        rq.exec();
        while (rq.next()) {
            const double pct = reminderPercent(rq, distanceM, timeS, now);
            if (pct >= 100.0) ++m_dueCount;
            else if (pct >= 90.0) ++m_soonCount;
            QVariantMap rm;
            rm.insert(QStringLiteral("id"), rq.value(QStringLiteral("id")).toString());
            rm.insert(QStringLiteral("name"), rq.value(QStringLiteral("name")).toString());
            rm.insert(QStringLiteral("label"), reminderLabel(rq));
            rm.insert(QStringLiteral("percent"), qRound(pct));
            rm.insert(QStringLiteral("due"), pct >= 100.0);
            rm.insert(QStringLiteral("soon"), pct >= 90.0 && pct < 100.0);
            reminders.append(rm);
        }

        QVariantMap gm;
        gm.insert(QStringLiteral("id"), id);
        gm.insert(QStringLiteral("parentId"), q.value(QStringLiteral("parent_id")).toString());
        gm.insert(QStringLiteral("name"), q.value(QStringLiteral("name")).toString());
        gm.insert(QStringLiteral("type"), q.value(QStringLiteral("type")).toString());
        gm.insert(QStringLiteral("component"), q.value(QStringLiteral("component")).toInt() != 0);
        gm.insert(QStringLiteral("topLevel"), isTopLevel(q.value(QStringLiteral("type")).toString()));
        // Locally-attributed distance (manual per-activity picks) added on top of the baseline.
        QSqlQuery aq2(m_db);
        aq2.prepare(QStringLiteral("SELECT COALESCE(SUM(distance_m),0) FROM activity_gear WHERE gear_id = ?"));
        aq2.addBindValue(id);
        aq2.exec();
        const double addedM = aq2.next() ? aq2.value(0).toDouble() : 0.0;

        gm.insert(QStringLiteral("distanceKm"), qRound((distanceM + addedM) / 1000.0));
        gm.insert(QStringLiteral("baselineKm"), qRound(distanceM / 1000.0));
        gm.insert(QStringLiteral("addedKm"), qRound(addedM / 1000.0));
        gm.insert(QStringLiteral("retired"), q.value(QStringLiteral("retired")).toInt() != 0);
        gm.insert(QStringLiteral("reminders"), reminders);
        m_gears.append(gm);
    }
    emit gearsChanged();
}
