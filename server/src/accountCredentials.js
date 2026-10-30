/** Shared account representation and scrypt format for both persistence adapters. */
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const KEY_LEN = 64;
export const RESET_TTL = 24 * 60 * 60 * 1000;
export const normEmail = (email) => String(email ?? '').trim().toLowerCase();
export const publicUser = ({ id, name, email, role }) => ({ id, name, email, role: role ?? 'editor' });
export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function passwordMatches(password, stored) {
  // Buffer.from silently truncates invalid hex. A zero-length stored key must
  // never become a zero-length comparison that accepts every password.
  if (typeof stored !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(stored)) return false;
  const [salt, key] = stored.split(':');
  const actual = await derive(password, Buffer.from(salt, 'hex'), KEY_LEN);
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
