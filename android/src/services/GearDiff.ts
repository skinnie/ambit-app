import { RemoteGear } from './ApiIntervalsIcuGear';
import { LocalGear } from '../database/gearDb';

// Pure two-way reconciliation between the local gear store and intervals.icu, with NO IO — so it
// unit-tests cleanly. The mirror service calls planGearSync(), applies the non-conflicting
// actions, and hands the conflicts to the UI resolver (decision 1: never auto-merge a real
// conflict — stop and ask).

export type GearAction =
  | { kind: 'pull-create'; remote: RemoteGear }               // new on intervals.icu -> add local
  | { kind: 'pull-update'; localId: string; remote: RemoteGear } // remote edited -> adopt
  | { kind: 'push-create'; localId: string }                  // new local -> create remote
  | { kind: 'push-update'; localId: string }                  // local edited -> push
  | { kind: 'push-delete'; localId: string; remoteId: string } // local tombstone -> delete remote
  | { kind: 'delete-local'; localId: string };                // gone from remote -> drop local

export type GearConflict = {
  localId: string;
  remoteId: string;
  reason: 'both-edited' | 'local-deleted-remote-edited' | 'remote-deleted-local-edited';
  local: EditableGear;
  remote: EditableGear | null;   // null when the remote row is gone
};

export interface GearPlan {
  actions: GearAction[];
  conflicts: GearConflict[];
}

/** The fields a user can edit and that therefore drive conflict detection. distance/time are
 * computed by intervals.icu and never conflict material; `primary` isn't in /gear so it is a
 * local-only flag and never mirrored either. */
export interface EditableGear {
  name: string;
  type: string;
  retired: boolean;
}

export function editableOf(g: RemoteGear | LocalGear): EditableGear {
  return { name: g.name, type: g.type, retired: g.retired };
}

function sameEditable(a: EditableGear, b: EditableGear): boolean {
  return a.name === b.name && a.type === b.type && a.retired === b.retired;
}

function snapshotOf(local: LocalGear): EditableGear | null {
  if (!local.remoteSnapshot) return null;
  try {
    const g = JSON.parse(local.remoteSnapshot) as RemoteGear;
    return editableOf(g);
  } catch {
    return null;
  }
}

/**
 * @param locals every local gear row (including tombstones: deleted === true)
 * @param remotes every gear currently on intervals.icu
 */
export function planGearSync(locals: LocalGear[], remotes: RemoteGear[]): GearPlan {
  const actions: GearAction[] = [];
  const conflicts: GearConflict[] = [];

  const remoteById = new Map<string, RemoteGear>();
  for (const r of remotes) remoteById.set(r.id, r);
  const claimedRemote = new Set<string>();

  for (const local of locals) {
    const localChanged = local.updatedAt > local.lastSyncedAt;

    // Never-pushed local row.
    if (!local.remoteId) {
      if (!local.deleted) actions.push({ kind: 'push-create', localId: local.id });
      // a deleted, never-pushed row is just purged by the caller — no remote to touch
      continue;
    }

    claimedRemote.add(local.remoteId);
    const remote = remoteById.get(local.remoteId);
    const localEdit = editableOf(local);

    // Remote row is gone.
    if (!remote) {
      if (local.deleted || !localChanged) {
        actions.push({ kind: 'delete-local', localId: local.id });
      } else {
        conflicts.push({
          localId: local.id, remoteId: local.remoteId, reason: 'remote-deleted-local-edited',
          local: localEdit, remote: null,
        });
      }
      continue;
    }

    const remoteEdit = editableOf(remote);
    const snap = snapshotOf(local);
    const remoteChanged = snap ? !sameEditable(remoteEdit, snap) : !sameEditable(remoteEdit, localEdit);

    // Local tombstone.
    if (local.deleted) {
      if (remoteChanged) {
        conflicts.push({
          localId: local.id, remoteId: local.remoteId, reason: 'local-deleted-remote-edited',
          local: localEdit, remote: remoteEdit,
        });
      } else {
        actions.push({ kind: 'push-delete', localId: local.id, remoteId: local.remoteId });
      }
      continue;
    }

    if (sameEditable(localEdit, remoteEdit)) continue; // in sync (values already equal)

    if (localChanged && remoteChanged) {
      conflicts.push({
        localId: local.id, remoteId: local.remoteId, reason: 'both-edited',
        local: localEdit, remote: remoteEdit,
      });
    } else if (localChanged) {
      actions.push({ kind: 'push-update', localId: local.id });
    } else {
      actions.push({ kind: 'pull-update', localId: local.id, remote });
    }
  }

  // Remote gear with no local counterpart -> pull it in.
  for (const r of remotes) {
    if (!claimedRemote.has(r.id)) actions.push({ kind: 'pull-create', remote: r });
  }

  return { actions, conflicts };
}
