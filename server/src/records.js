import { promises as fs } from 'node:fs';

/** A corrupt record must be reported without disabling unrelated tenants. */
export async function readRecord(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Expected a record object');
    return value;
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    console.error('[store] Invalid JSON record; recover from backup:', file);
    return null;
  }
}
