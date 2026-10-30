/** Offline, atomic account import. Source JSON is never changed. */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/dataDir.js';
import { importAccounts } from '../src/importAccounts.js';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL in server/.env first.');
  process.exit(1);
}
const { pool, migrate, tx } = await import('../src/db.js');
try {
  const dir = path.join(DATA_DIR, 'users');
  // Missing/unreadable source is a failure, not a successful empty migration.
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  if (!files.length) throw new Error('No source accounts found; check DATA_DIR.');
  const accounts = await Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))));
  await migrate();
  const result = await tx((client) => importAccounts(client, accounts));
  console.log(`${result.added} account(s) added, ${result.existing} matching identities already present.`);
} catch {
  console.error('Account import failed. Check source files, database access and identity conflicts. Source files were not changed; account inserts were rolled back.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
