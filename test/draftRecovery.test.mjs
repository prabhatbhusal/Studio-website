import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRecovery, recoveryKey, canRecover } from '../src/features/studio/draftRecovery.ts';

const doc = { id: 'room', propertyId: 'hotel', revision: 3, title: 'Room', unitScale: 1, hotspots: [], tracks: [], colliders: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, spawn: { position: [0, 1, 2], yaw: 0 } };
const copy = { version: 1, account: 'editor', scene: 'room', revision: 3, at: '2026-10-29T00:00:00Z', doc };
test('recovery copies are scoped to account and scene', () => {
  const raw = JSON.stringify(copy);
  assert.deepEqual(readRecovery(raw, 'editor', 'room'), copy);
  assert.equal(readRecovery(raw, 'another', 'room'), null);
  assert.equal(readRecovery(raw, 'editor', 'other'), null);
  assert.notEqual(recoveryKey('a:b', 'c'), recoveryKey('a', 'b:c'));
});
test('recovery rejects truncated records and malformed document shape', () => {
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...copy, revision: -1 }), JSON.stringify({ ...copy, doc: { ...doc, spawn: null } })]) {
    assert.equal(readRecovery(raw, 'editor', 'room'), null);
  }
});
test('recovery cannot replace a newer server draft or different project', () => {
  assert.equal(canRecover(copy, doc), true);
  assert.equal(canRecover(copy, { ...doc, revision: 4 }), false);
  assert.equal(canRecover(copy, { ...doc, propertyId: 'different' }), false);
  assert.equal(canRecover(copy, { ...doc, id: 'different' }), false);
});
