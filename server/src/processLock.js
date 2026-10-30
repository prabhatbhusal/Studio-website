import { openSync, readFileSync, unlinkSync, writeFileSync, closeSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './dataDir.js';

/** File stores require one writer process. Fail closed rather than silently cluster. */
export function acquireProcessLock() {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, '.api.lock');
  let fd;
  try { fd = openSync(file, 'wx'); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let pid;
    try { pid = Number(readFileSync(file, 'utf8')); } catch { /* fail closed */ }
    if (!Number.isInteger(pid) || pid < 1) throw new Error('API lock is invalid. Verify no API is running before removing .api.lock.');
    try { process.kill(pid, 0); }
    catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
      // Never race another starter by removing a lock automatically.
      throw new Error('A stale API lock remains. Verify no API is running, then remove DATA_DIR/.api.lock and restart.');
    }
    throw new Error('Another API process already owns this DATA_DIR. File storage supports one process only.');
  }
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { if (readFileSync(file, 'utf8') === String(process.pid)) unlinkSync(file); } catch { /* already removed */ }
  };
  process.once('exit', release);
  return release;
}
