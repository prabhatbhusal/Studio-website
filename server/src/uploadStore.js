import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, writeFileWhole } from './dataDir.js';
import { freshSession, STAFF_ONLY } from './access.js';
import { serialMutation } from './serial.js';

const dir = path.join(DATA_DIR, 'upload-owners');
const file = (id) => path.join(dir, `${id}.json`);
export const UPLOAD_MAX = Number(process.env.UPLOAD_MAX_BYTES) || 8 * 1024 ** 3;
export const UPLOAD_FILES_MAX = Number(process.env.UPLOAD_FILES_MAX) || 20000;
export const UPLOAD_TTL = 24 * 60 * 60 * 1000;
export const createUpload = serialMutation(async (id, session) => {
  await fs.mkdir(dir, { recursive: true });
  const records = await fs.readdir(dir);
  let active = 0;
  for (const name of records.filter((n) => n.endsWith('.json'))) {
    const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    if (!record.complete && record.owner === (session.sub ?? null) && record.created > Date.now() - UPLOAD_TTL) active++;
  }
  if (active >= 20) throw Object.assign(new Error('Finish or wait for existing uploads to expire before starting more.'), { status: 429 });
  await writeFileWhole(file(id), JSON.stringify({ owner: session.sub ?? null, created: Date.now(), bytes: 0 }), { flag: 'wx' });
}, 'uploads');

export async function checkUploadBudget(id, bytes) {
  const record = JSON.parse(await fs.readFile(file(id), 'utf8'));
  let total = bytes;
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && n !== `${id}.json`)) {
    const other = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    if (other.owner === record.owner) total += other.bytes || 0;
  }
  if (bytes > UPLOAD_MAX || total > (Number(process.env.UPLOAD_ACCOUNT_MAX_BYTES) || 100 * 1024 ** 3)) {
    throw Object.assign(new Error('Upload storage quota exceeded. Contact the team.'), { status: 413 });
  }
  await writeFileWhole(file(id), JSON.stringify({ ...record, bytes }));
}
export async function uploadGuard(req, res, next) {
  try {
    const session = await freshSession(req.session);
    if (!session) return res.status(401).json({ error: 'Sign in again.' });
    if (session.role === 'staff') return res.status(403).json(STAFF_ONLY);
    let record;
    try { record = JSON.parse(await fs.readFile(file(req.params.assetId), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return res.status(404).json({ error: 'Start a new upload first.' }); throw err; }
    if (record.owner !== (session.sub ?? null)) return res.status(403).json({ error: 'This upload belongs to another account.' });
    if (record.complete) return res.status(409).json({ error: 'This upload is already finished.' });
    if (record.created < Date.now() - UPLOAD_TTL) return res.status(410).json({ error: 'This upload expired. Start a new upload.' });
    next();
  } catch (err) { next(err); }
}
// Serialize chunks and finalization; the ownership check runs again in the queue.
export function uploadHandler(fn) {
  const run = serialMutation(async (req, res) => {
    let permitted = false;
    let failure;
    await uploadGuard(req, res, (err) => { failure = err; permitted = !err; });
    if (failure) throw failure;
    if (permitted) {
      const result = await fn(req, res);
      if (req.path.endsWith('/finalize') && res.statusCode < 300) await finishUpload(req.params.assetId);
      return result;
    }
  }, 'uploads');
  return (req, res, next) => run(req, res).catch(next);
}
export async function finishUpload(id) {
  const record = JSON.parse(await fs.readFile(file(id), 'utf8'));
  await writeFileWhole(file(id), JSON.stringify({ ...record, complete: true }));
}
export const forgetUpload = (id) => fs.rm(file(id), { force: true });

// Expired staging paths are built only from server-generated, validated IDs.
export const cleanupUploads = serialMutation(async () => {
  let names;
  try { names = await fs.readdir(dir); } catch (err) { if (err.code === 'ENOENT') return; throw err; }
  for (const name of names) {
    if (!/^ast_[a-f0-9]{12}\.json$/.test(name)) continue;
    const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    if (record.complete || record.created > Date.now() - UPLOAD_TTL) continue;
    await fs.rm(path.join(DATA_DIR, 'uploads-staging', name.slice(0, -5)), { recursive: true, force: true });
    await fs.rm(path.join(dir, name));
  }
}, 'uploads');
