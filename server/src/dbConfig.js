import { readFileSync } from 'node:fs';

function integer(env, name, fallback, max) {
  if (!env[name]) return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}.`);
  return value;
}

/** Keep credentials server-side; never include the URL in validation errors. */
export function databaseUrl(env = process.env) {
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
    throw new Error('DATABASE_URL must name a PostgreSQL host and database.');
  }
  if (env.DATABASE_PASSWORD) {
    if (url.password || url.searchParams.has('password')) throw new Error('Set the database password in DATABASE_PASSWORD or DATABASE_URL, not both.');
    url.password = encodeURIComponent(env.DATABASE_PASSWORD);
  }
  return url;
}

export function databaseConfig(env = process.env, read = readFileSync) {
  const url = databaseUrl(env);
  // pg lets URL TLS parameters replace the ssl object, silently dropping our CA.
  if (env.DATABASE_CA_FILE && ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl'].some((k) => url.searchParams.has(k))) {
    throw new Error('Use DATABASE_CA_FILE without SSL parameters in DATABASE_URL.');
  }
  return {
    connectionString: url.toString(),
    max: integer(env, 'DATABASE_POOL_MAX', 10, 100),
    connectionTimeoutMillis: integer(env, 'DATABASE_CONNECT_TIMEOUT_MS', 5000, 60000),
    statement_timeout: integer(env, 'DATABASE_STATEMENT_TIMEOUT_MS', 15000, 300000),
    idle_in_transaction_session_timeout: 30000,
    ...(env.DATABASE_CA_FILE ? { ssl: { ca: read(env.DATABASE_CA_FILE, 'utf8'), rejectUnauthorized: true } } : {})
  };
}
