/** Explicit integration drill on an EMPTY disposable database ending in _test.
 * Never uses DATABASE_URL from the normal application environment. */
import assert from 'node:assert/strict';
import { databaseUrl } from '../src/dbConfig.js';

const url = databaseUrl({ DATABASE_URL: process.env.TEST_DATABASE_URL });
if (!decodeURIComponent(url.pathname).endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a dedicated database ending in _test.');
process.env.DATABASE_URL = url.toString();
delete process.env.DATABASE_PASSWORD;
const { pool, migrate, tx } = await import('../src/db.js');
const { importAccounts } = await import('../src/importAccounts.js');
let ownsSchema = false;
try {
  const existing = await pool.query("select 1 from pg_namespace where nspname = 'app'");
  assert.equal(existing.rowCount, 0, 'Refusing a database that already has an app schema.');
  ownsSchema = true;
  await Promise.all([migrate(), migrate()]);
  const users = await import('../src/usersStore-pg.js');
  const created = await Promise.all(['one', 'two'].map((name) => users.createUser({ name, email: `${name}@example.test`, password: 'original-test-password' })));
  assert.equal(created.filter((u) => u.role === 'admin').length, 1, 'Concurrent bootstrap has one administrator.');
  const admin = created.find((u) => u.role === 'admin');
  const other = created.find((u) => u.role !== 'admin');
  assert.ok(await users.verifyUser(admin.email, 'original-test-password'));
  assert.equal(await users.verifyUser(admin.email, 'incorrect'), null);
  const reset = await users.createResetToken(other.id);
  const outcomes = await Promise.all([users.resetPassword(reset.token, 'updated-test-password'), users.resetPassword(reset.token, 'updated-test-password')]);
  assert.equal(outcomes.filter(Boolean).length, 1, 'Reset token has one winner.');
  await users.setUserRole(other.id, 'admin');
  const demotions = await Promise.allSettled(created.map((u) => users.setUserRole(u.id, 'editor')));
  assert.equal(demotions.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await users.listUsers()).filter((u) => u.role === 'admin').length, 1);
  const newId = '11111111-1111-4111-8111-111111111111';
  await assert.rejects(tx((c) => importAccounts(c, [
    { id: newId, name: 'Import', email: 'import@example.test', passwordHash: 'test-hash' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Conflict', email: admin.email, passwordHash: 'test-hash' }
  ])), /identity conflict/);
  assert.equal(await users.getUserById(newId), null, 'A later conflict rolls back earlier inserts.');
  console.log('PostgreSQL drill passed: migration concurrency, bootstrap, passwords, reset race, last-admin protection and import rollback.');
} finally {
  // Only the app schema created by this run, after checking the dedicated DB.
  try {
    if (ownsSchema) await pool.query('drop schema if exists app cascade');
  } finally {
    await pool.end();
  }
}
