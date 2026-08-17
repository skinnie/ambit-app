import { getIntervalsIcuCredentials, IntervalsIcuCredentials } from './ApiIntervalsIcu';
import { RemoteGear, RemoteReminder, normGear } from './GearRemoteModel';

// ─── Intervals.icu — gear + components + maintenance reminders (network client) ─
// The pure model + normalisers live in GearRemoteModel.ts (dependency-free, unit-tested).
// This file is only the authenticated HTTP surface. Schema CONFIRMED against a live GET /gear
// (2026-08-17); see docs/reference/intervals-gear-schema.md. Auth is HTTP Basic API_KEY:<key>,
// same as activity upload (ApiIntervalsIcu.ts).

export type { RemoteGear, RemoteReminder } from './GearRemoteModel';
export { normGear } from './GearRemoteModel';

const API_BASE = 'https://intervals.icu/api/v1';

function authHeader(apiKey: string): string {
  return 'Basic ' + btoa(`API_KEY:${apiKey}`);
}

async function creds(): Promise<IntervalsIcuCredentials> {
  const c = await getIntervalsIcuCredentials();
  if (!c) throw new Error('Intervals.icu is not connected (no API key).');
  return c;
}

async function apiFetch(
  c: IntervalsIcuCredentials, method: string, path: string, body?: any,
): Promise<any> {
  const res = await fetch(`${API_BASE}/athlete/${encodeURIComponent(c.athleteId)}${path}`, {
    method,
    headers: {
      Authorization: authHeader(c.apiKey),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Intervals.icu gear: ${res.status} ${res.statusText} — ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Normalisers (lenient reads, canonical writes) ────────────────────────────

function gearBody(g: Partial<RemoteGear>): any {
  const body: any = {};
  if (g.id != null) body.id = g.id;
  if (g.name != null) body.name = g.name;
  if (g.type != null) body.type = g.type;
  if (g.component != null) body.component = g.component;
  if (g.componentIds != null) body.component_ids = g.componentIds;
  if (g.retired != null) body.retired = g.retired;
  // distance/time are computed by intervals.icu from activities; never written here.
  return body;
}

function reminderBody(r: Partial<RemoteReminder>): any {
  return {
    name: r.name ?? '',
    distance: r.distanceM ?? 0,
    time: r.timeS ?? 0,
    days: r.days ?? 0,
    activities: r.activities ?? 0,
  };
}

// ─── Operations ───────────────────────────────────────────────────────────────

export async function listGear(): Promise<RemoteGear[]> {
  const c = await creds();
  const json = await apiFetch(c, 'GET', '/gear');
  const arr = Array.isArray(json) ? json : (json?.gear ?? []);
  return arr.map(normGear);
}

/** Create gear or a component. For a component pass component:true; attach it to its parent
 * afterwards with updateGear(parentId, { componentIds }). Returns the new remote id. */
export async function createGear(g: Partial<RemoteGear>): Promise<string> {
  const c = await creds();
  const json = await apiFetch(c, 'POST', '/gear', gearBody(g));
  const id = String((json?.id ?? json?.gearId) ?? '');
  if (!id) throw new Error('Intervals.icu: gear create returned no id\n' + JSON.stringify(json));
  return id;
}

export async function updateGear(id: string, g: Partial<RemoteGear>): Promise<void> {
  const c = await creds();
  await apiFetch(c, 'PUT', `/gear/${encodeURIComponent(id)}`, gearBody({ ...g, id }));
}

export async function deleteGear(id: string): Promise<void> {
  const c = await creds();
  await apiFetch(c, 'DELETE', `/gear/${encodeURIComponent(id)}`);
}

export async function addReminder(gearId: string, r: Partial<RemoteReminder>): Promise<string> {
  const c = await creds();
  const json = await apiFetch(c, 'POST', `/gear/${encodeURIComponent(gearId)}/reminder`, reminderBody(r));
  return String((json?.id ?? '') || '');
}

/** Update a reminder. `reset` restarts its counter; `snoozeDays` postpones it. */
export async function updateReminder(
  gearId: string, reminderId: string, r: Partial<RemoteReminder>, reset = false, snoozeDays = 0,
): Promise<void> {
  const c = await creds();
  const q = `?reset=${reset ? 'true' : 'false'}&snoozeDays=${snoozeDays}`;
  await apiFetch(c, 'PUT', `/gear/${encodeURIComponent(gearId)}/reminder/${encodeURIComponent(reminderId)}${q}`, reminderBody(r));
}

export async function deleteReminder(gearId: string, reminderId: string): Promise<void> {
  const c = await creds();
  await apiFetch(c, 'DELETE', `/gear/${encodeURIComponent(gearId)}/reminder/${encodeURIComponent(reminderId)}`);
}

/** Retire a worn component and create a fresh copy that keeps the reminders (new chain, etc.). */
export async function replaceGear(gearId: string): Promise<string> {
  const c = await creds();
  const json = await apiFetch(c, 'POST', `/gear/${encodeURIComponent(gearId)}/replace`);
  return String((json?.id ?? '') || '');
}

/** Assign gear to an already-uploaded activity (auto-assign on sync). Not under /athlete —
 * intervals.icu updates a single activity at PUT /api/v1/activity/{id}. */
export async function setActivityGear(activityId: string, gearRemoteId: string): Promise<void> {
  const c = await creds();
  const res = await fetch(`${API_BASE}/activity/${encodeURIComponent(activityId)}`, {
    method: 'PUT',
    headers: { Authorization: authHeader(c.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ gear_id: gearRemoteId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Intervals.icu set gear: ${res.status} ${res.statusText} — ${text}`);
  }
}
