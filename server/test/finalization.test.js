import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { hashPassword, passwordMatches } from '../src/accountCredentials.js';
import { databaseConfig, databaseUrl } from '../src/dbConfig.js';
import { importAccounts } from '../src/importAccounts.js';
import { daysBetween, bookingTimezone } from '../src/calendar.js';

test('malformed stored hashes fail closed instead of matching empty derived keys', async () => {
  for (const hash of ['zz:zz', 'aa:zz', ':', '00:00', null, 'a'.repeat(32) + ':' + 'a'.repeat(126)]) {
    assert.equal(await passwordMatches('incorrect password', hash), false);
  }
  const hash = await hashPassword('correct password');
  assert.equal(await passwordMatches('correct password', hash), true);
  assert.equal(await passwordMatches('wrong password', hash), false);
});

test('separate database password survives pg URL parsing including reserved characters', () => {
  const env = { DATABASE_URL: 'postgresql://app@localhost:5432/app', DATABASE_PASSWORD: 'private:@/#? %value' };
  const client = new pg.Client(databaseConfig(env));
  assert.equal(client.password, env.DATABASE_PASSWORD);
  assert.equal(decodeURIComponent(databaseUrl(env).password), env.DATABASE_PASSWORD);
  assert.equal(databaseConfig(env).connectionTimeoutMillis, 5000);
});

test('database config rejects ambiguous TLS, credentials and unbounded pool settings without leaking secrets', () => {
  const base = { DATABASE_URL: 'postgresql://app:secret@localhost/app' };
  assert.throws(() => databaseConfig({ ...base, DATABASE_PASSWORD: 'other' }), /not both/);
  for (const param of ['sslmode=require', 'ssl=false', 'sslrootcert=another.pem']) {
    assert.throws(() => databaseConfig({ DATABASE_URL: `${base.DATABASE_URL}?${param}`, DATABASE_CA_FILE: 'ca.pem' }), /without SSL/);
  }
  for (const value of ['-1', '0', 'Infinity', '1.5', '101', 'bad']) {
    assert.throws(() => databaseConfig({ ...base, DATABASE_POOL_MAX: value }), /DATABASE_POOL_MAX/);
  }
  assert.throws(() => databaseConfig({ DATABASE_URL: 'https://secret:password@host/db' }), (e) => !e.message.includes('password'));
  const cfg = databaseConfig({ ...base, DATABASE_CA_FILE: 'ca.pem' }, () => 'certificate');
  assert.deepEqual(cfg.ssl, { ca: 'certificate', rejectUnauthorized: true });
});

test('account imports refuse identity conflicts and retain matching existing accounts', async () => {
  const source = { id: 'source-id', email: 'Guest@Example.test', passwordHash: 'hash' };
  let writes = 0;
  const client = (rows) => ({ query: async (sql) => {
    if (sql.startsWith('insert')) writes++;
    return { rows: sql.startsWith('select id') ? rows : [] };
  } });
  await assert.rejects(importAccounts(client([{ id: 'other-id', email: 'guest@example.test' }]), [source]), /identity conflict/);
  await assert.rejects(importAccounts(client([{ id: source.id, email: 'other@example.test' }]), [source]), /identity conflict/);
  assert.deepEqual(await importAccounts(client([{ id: source.id, email: 'guest@example.test' }]), [source]), { added: 0, existing: 1 });
  assert.equal(writes, 0);
});

test('account imports preserve password reset links and IDs when inserting', async () => {
  let values;
  const source = { id: 'source-id', name: 'Guest', email: 'Guest@Example.test', passwordHash: 'hash', reset: { hash: 'token-hash', expires: 2000000000000 } };
  const client = { query: async (sql, params) => { if (sql.startsWith('insert')) values = params; return { rows: [] }; } };
  assert.deepEqual(await importAccounts(client, [source]), { added: 1, existing: 0 });
  assert.equal(values[0], source.id);
  assert.equal(values[2], 'guest@example.test');
  assert.equal(values[3], source.passwordHash);
  assert.equal(values[7], source.reset.hash);
  assert.equal(values[8].getTime(), source.reset.expires);
});

test('duration validation measures the full interval including dates beyond the night iterator cap', () => {
  assert.equal(daysBetween('2028-01-01', '2029-01-01'), 366);
  assert.equal(daysBetween('2028-01-01', '2030-01-01'), 731);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.ok(Number.isNaN(daysBetween('2026-02-30', '2026-03-05')));
});

test('booking summaries use enabled services before disabled table defaults', () => {
  assert.equal(bookingTimezone({ booking: { on: false, timezone: 'Asia/Kathmandu' }, stays: { on: true, timezone: 'Pacific/Honolulu' } }), 'Pacific/Honolulu');
  assert.equal(bookingTimezone({ dining: [{ booking: { on: true, timezone: 'Pacific/Auckland' } }] }), 'Pacific/Auckland');
  assert.equal(bookingTimezone(null), 'Asia/Kathmandu');
});
