// Pure two-way reconciliation between the local gear store and intervals.icu.
// Decision 1 (André 2026-08-17): a genuine two-sided edit is a CONFLICT, never an auto-merge.

import { planGearSync } from '../GearDiff';
import { LocalGear } from '../../database/gearDb';
import { RemoteGear } from '../ApiIntervalsIcuGear';

function local(over: Partial<LocalGear>): LocalGear {
  return {
    id: 'L1', remoteId: 'b1', parentId: null, name: 'Bike', type: 'Bike',
    distanceM: 0, timeS: 0, retired: false, isPrimary: false,
    updatedAt: 100, lastSyncedAt: 100, remoteSnapshot: '', deleted: false, ...over,
  };
}
function remote(over: Partial<RemoteGear>): RemoteGear {
  return {
    id: 'b1', name: 'Bike', type: 'Bike', component: false, componentIds: [],
    distanceM: 0, timeS: 0, retired: false, reminders: [], ...over,
  };
}
/** A snapshot equal to `remote(base)` — i.e. remote is unchanged since last sync. */
function snap(over: Partial<RemoteGear> = {}): string {
  return JSON.stringify(remote(over));
}

describe('planGearSync', () => {
  test('never-pushed local gear -> push-create', () => {
    const p = planGearSync([local({ id: 'L9', remoteId: null })], []);
    expect(p.conflicts).toHaveLength(0);
    expect(p.actions).toEqual([{ kind: 'push-create', localId: 'L9' }]);
  });

  test('remote-only gear -> pull-create', () => {
    const p = planGearSync([], [remote({ id: 'bX', name: 'New' })]);
    expect(p.conflicts).toHaveLength(0);
    expect(p.actions[0].kind).toBe('pull-create');
  });

  test('identical local & remote -> no action', () => {
    const p = planGearSync([local({ remoteSnapshot: snap() })], [remote({})]);
    expect(p.actions).toHaveLength(0);
    expect(p.conflicts).toHaveLength(0);
  });

  test('only local edited -> push-update', () => {
    const p = planGearSync(
      [local({ name: 'Renamed', updatedAt: 200, lastSyncedAt: 100, remoteSnapshot: snap() })],
      [remote({ name: 'Bike' })],
    );
    expect(p.conflicts).toHaveLength(0);
    expect(p.actions).toEqual([{ kind: 'push-update', localId: 'L1' }]);
  });

  test('only remote edited -> pull-update', () => {
    const p = planGearSync(
      [local({ name: 'Bike', updatedAt: 100, lastSyncedAt: 100, remoteSnapshot: snap({ name: 'Bike' }) })],
      [remote({ name: 'Bike v2' })],
    );
    expect(p.conflicts).toHaveLength(0);
    expect(p.actions[0].kind).toBe('pull-update');
  });

  test('both edited differently -> conflict, no action', () => {
    const p = planGearSync(
      [local({ name: 'Local name', updatedAt: 200, lastSyncedAt: 100, remoteSnapshot: snap({ name: 'Bike' }) })],
      [remote({ name: 'Remote name' })],
    );
    expect(p.actions).toHaveLength(0);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].reason).toBe('both-edited');
    expect(p.conflicts[0].local.name).toBe('Local name');
    expect(p.conflicts[0].remote?.name).toBe('Remote name');
  });

  test('local tombstone, remote unchanged -> push-delete', () => {
    const p = planGearSync(
      [local({ deleted: true, updatedAt: 200, remoteSnapshot: snap() })],
      [remote({})],
    );
    expect(p.actions).toEqual([{ kind: 'push-delete', localId: 'L1', remoteId: 'b1' }]);
  });

  test('local tombstone but remote edited -> conflict', () => {
    const p = planGearSync(
      [local({ deleted: true, updatedAt: 200, remoteSnapshot: snap({ name: 'Bike' }) })],
      [remote({ name: 'Bike edited on web' })],
    );
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].reason).toBe('local-deleted-remote-edited');
  });

  test('remote deleted, local unchanged -> delete-local', () => {
    const p = planGearSync([local({ updatedAt: 100, lastSyncedAt: 100 })], []);
    expect(p.actions).toEqual([{ kind: 'delete-local', localId: 'L1' }]);
  });

  test('remote deleted but local edited -> conflict', () => {
    const p = planGearSync([local({ name: 'Edited', updatedAt: 200, lastSyncedAt: 100 })], []);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].reason).toBe('remote-deleted-local-edited');
    expect(p.conflicts[0].remote).toBeNull();
  });
});
