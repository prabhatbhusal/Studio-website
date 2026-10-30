/**
 * The Postgres connection (Supabase, or any Postgres: nothing here is
 * Supabase-specific, so moving providers is pg_dump + a new DATABASE_URL).
 * Only this server talks to the database; tables live in the `app` schema,
 * which Supabase's public Data API doesn't expose, with RLS on as well.
 */
import pg from 'pg';
import { promises as fs } from 'fs';
import path from 'path';
import { databaseConfig } from './dbConfig.js';

// DATABASE_CA_FILE: the provider's CA certificate (Supabase: Database → SSL
// configuration → download), so the TLS connection is verified, not just encrypted.
export const pool = new pg.Pool(databaseConfig());
// An idle connection the provider drops must not crash the server.
pool.on('error', (err) => console.error('[db] idle connection error:', err.message));

/** Runs `fn(client)` in one transaction; rolls back if it throws. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Lock before even creating the schema, so simultaneous migration runners
 * cannot race DDL or apply the same migration. All changes commit together. */
export async function migrate() {
  const dir = path.join(import.meta.dirname, '..', 'db');
  await tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(7240032)');
    await c.query(`create schema if not exists app;
      create table if not exists app.schema_migrations (name text primary key, applied_at timestamptz not null default now());
      alter table app.schema_migrations enable row level security;`);
    const done = new Set((await c.query('select name from app.schema_migrations')).rows.map((r) => r.name));
    for (const name of (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      const sql = await fs.readFile(path.join(dir, name), 'utf8');
      await c.query(sql);
      await c.query('insert into app.schema_migrations (name) values ($1)', [name]);
    }
  });
}
