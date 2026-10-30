#!/usr/bin/env node
/**
 * A dated bundle: DATA_DIR, external local ASSET_DIR, and (when configured)
 * the PostgreSQL app schema. Scan buckets need their own provider backup.
 * Keeps the last BACKUP_KEEP_DAYS (14) in
 * BACKUP_DIR (DATA_DIR's sibling "backups"). With ASSET_DRIVER=s3 each copy also
 * goes to the bucket under backups.private/, which the API can never serve,
 * because a dead VPS disk takes its own copies with it.
 *
 *   cd server && npm run backup
 *   cron on the VPS: 15 3 * * *  cd /srv/rcaas/app/server && npm run backup >> /srv/rcaas/backups/backup.log 2>&1
 *   restore:          see deploy/README.md (outer bundle contains component archives)
 *
 * Each data file is written whole (dataDir.js), so every file in the copy is
 * complete; a save made while tar runs may land in the next day's copy.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { databaseUrl } from '../src/dbConfig.js';
import { DATA_DIR } from '../src/dataDir.js';
import { createS3Driver } from '../src/storage-s3.js';
import { ASSET_DIR } from '../src/storage.js';

const outDir = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(DATA_DIR), 'backups'));
const keepDays = Number(process.env.BACKUP_KEEP_DAYS) || 14;
const name = `data-${new Date().toISOString().slice(0, 10)}.tar.gz`;
const file = path.join(outDir, name);
for (const source of [DATA_DIR, ...(process.env.ASSET_DRIVER === 's3' ? [] : [ASSET_DIR])]) {
  const relative = path.relative(source, outDir);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
    throw new Error('BACKUP_DIR must be outside DATA_DIR and ASSET_DIR.');
  }
}

process.umask(0o077);
await fs.mkdir(outDir, { recursive: true, mode: 0o700 });
const stage = await fs.mkdtemp(path.join(outDir, 'bundle-'));
const components = [];
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: stage, env, stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`${command} backup failed (${result.error?.code ?? result.status}). No complete backup was published.`);
}
try {
  const base = path.basename(DATA_DIR);
  run('tar', ['-czf', 'data.tar.gz', `--exclude=${base}/.api.lock`, `--exclude=${base}/uploads-staging`, '-C', path.dirname(DATA_DIR), base]);
  components.push({ archive: 'data.tar.gz', target: 'DATA_DIR', basename: base });
  const relativeAssets = path.relative(DATA_DIR, ASSET_DIR);
  if (process.env.ASSET_DRIVER !== 's3' && (relativeAssets.startsWith('..' + path.sep) || path.isAbsolute(relativeAssets))) {
    run('tar', ['-czf', 'assets.tar.gz', '-C', path.dirname(ASSET_DIR), path.basename(ASSET_DIR)]);
    components.push({ archive: 'assets.tar.gz', target: 'ASSET_DIR', basename: path.basename(ASSET_DIR) });
  }
  if (process.env.DATABASE_URL) {
    const db = databaseUrl();
    // Pass connection credentials in environment, never shell arguments or logs.
    run('pg_dump', ['--format=custom', '--schema=app', '--file=accounts.dump'], {
      ...process.env, PGHOST: db.hostname, PGPORT: db.port || '5432',
      PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password),
      PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
      PGSSLMODE: db.searchParams.get('sslmode') || (process.env.DATABASE_CA_FILE ? 'verify-full' : process.env.PGSSLMODE || 'prefer'),
      ...(process.env.DATABASE_CA_FILE ? { PGSSLROOTCERT: process.env.DATABASE_CA_FILE } : {})
    });
    components.push({ archive: 'accounts.dump', target: 'PostgreSQL app schema', format: 'pg_dump custom' });
  }
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ format: 2, createdAt: new Date().toISOString(), components, external: process.env.ASSET_DRIVER === 's3' ? ['Scan bucket: back up separately with provider versioning/replication'] : [], secrets: 'Back up environment credentials separately' }, null, 2));
  run('tar', ['-czf', path.relative(stage, `${file}.tmp`), ...components.map((c) => c.archive), 'manifest.json']);
  await fs.rename(`${file}.tmp`, file);
} finally {
  // Only the freshly-created bundle directory beneath BACKUP_DIR is removed.
  if (path.dirname(stage) !== outDir || !path.basename(stage).startsWith('bundle-')) throw new Error('Invalid backup staging path.');
  await fs.rm(stage, { recursive: true, force: true });
}
const { size } = await fs.stat(file);
console.log(`[backup] ${file} (${(size / 1048576).toFixed(1)} MB)`);

for (const old of await fs.readdir(outDir)) {
  const day = old.match(/^data-(\d{4}-\d{2}-\d{2})\.tar\.gz$/)?.[1];
  if (day && Date.now() - Date.parse(day) > keepDays * 86400000) await fs.rm(path.join(outDir, old));
}

if (process.env.ASSET_DRIVER === 's3') {
  // The driver puts at <prefix><id>/<file>. A dot in the folder keeps it out of
  // the API's reach whatever S3_PREFIX is: asset ids are [a-zA-Z0-9_-] only (routes/assets.js).
  await createS3Driver({ ...process.env, S3_PREFIX: 'backups.private/' }).put('data', name, createReadStream(file), 'application/gzip');
  console.log(`[backup] copied to the bucket as backups.private/data/${name}`);
}
