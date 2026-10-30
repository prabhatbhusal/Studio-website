import { serialMutation } from './serial.js';
/**
 * Studio accounts. One JSON file per user under data/users/, named by a hash
 * of the lowercased email — so an email never becomes a path, and lookup is
 * one read. Same file-backed pattern as scenes/leads; usersStore-pg.js is the Postgres twin.
 *
 * Passwords: scrypt from node:crypto (no dependency), random 16-byte salt,
 * compared with timingSafeEqual. The hash never leaves this module.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { normEmail, hashPassword, passwordMatches, publicUser, sha, RESET_TTL } from './accountCredentials.js';
export { normEmail, hashPassword, passwordMatches, publicUser, sha, RESET_TTL } from './accountCredentials.js';
import { DATA_DIR, writeFileWhole } from './dataDir.js';
import { readRecord } from './records.js';

const USERS_DIR = path.join(DATA_DIR, 'users');
const fileFor = (email) =>
  path.join(USERS_DIR, `${createHash('sha256').update(normEmail(email)).digest('hex')}.json`);

async function readUser(email) {
  try {
    return JSON.parse(await fs.readFile(fileFor(email), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Every account file, parsed. Small team (CLAUDE.md §1: three to five
 *  people) — a directory scan per call is fine; revisit if that grows. */
async function readAllUsers() {
  let files;
  try {
    files = await fs.readdir(USERS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return (await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => readRecord(path.join(USERS_DIR, f))))).filter(Boolean);
}

/** Every account, for the admin-only team list. Newest first. */
export async function listUsers() {
  const all = await readAllUsers();
  return all.map(publicUser).sort((a, b) => b.id.localeCompare(a.id));
}

/** Scans by id — accounts are filed by email hash (see `fileFor`), so there
 *  is no direct lookup. Null if the account was deleted since the session
 *  was issued. */
export async function getUserById(id) {
  const found = (await readAllUsers()).find((u) => u.id === id);
  return found ? publicUser(found) : null;
}

/** For adding a teammate to a project by the email they sign in with. */
export async function getUserByEmail(email) {
  const found = await readUser(email);
  return found ? publicUser(found) : null;
}

/** Promote or demote an account. Refuses to leave the team with zero admins
 *  — the one guard rail against locking everyone out. */
export const setUserRole = serialMutation(setUserRoleImpl);
async function setUserRoleImpl(id, role) {
  if (role !== 'admin' && role !== 'editor') throw new Error('role must be "admin" or "editor"');
  const all = await readAllUsers();
  const record = all.find((u) => u.id === id);
  if (!record) return null;
  // A client's staff account, invited to answer one project's guests, never becomes a team account.
  if (record.role === 'staff') throw Object.assign(new Error('That’s a client staff account. Invite the person with a team account of their own instead.'), { status: 400 });
  if (record.role === 'admin' && role !== 'admin' && all.filter((u) => u.role === 'admin').length <= 1) {
    throw Object.assign(new Error('That is the only admin left — promote someone else first.'), { status: 409 });
  }
  record.role = role;
  await writeFileWhole(fileFor(record.email), JSON.stringify(record, null, 2));
  return publicUser(record);
}

/** Returns the public user, or null if that email is already registered.
 *  The first account ever created becomes admin (there is no admin yet to
 *  invite anyone); every account after that starts as an editor and an
 *  admin promotes them from the team list. */
export const createUser = serialMutation(createUserImpl);
async function createUserImpl({ name, email, password, role }) {
  await fs.mkdir(USERS_DIR, { recursive: true });
  const isFirstAccount = !(await fs.readdir(USERS_DIR)).some((f) => f.endsWith('.json'));
  const record = {
    id: randomUUID(),
    name: String(name).trim(),
    email: normEmail(email),
    passwordHash: await hashPassword(password),
    role: isFirstAccount ? 'admin' : role === 'staff' ? 'staff' : 'editor',
    createdAt: new Date().toISOString()
  };
  try {
    // 'wx' fails if the file exists — the uniqueness check and the write are one step.
    await writeFileWhole(fileFor(email), JSON.stringify(record, null, 2), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') return null;
    throw err;
  }
  return publicUser(record);
}

/* ------------------------------------------------------------------ */
/* Reset links and removal (2026-09-25). No email service yet, so an    */
/* admin makes a one-time link and sends it however suits. Only its     */
/* hash is stored; it lasts a day and works once.                       */
/* ------------------------------------------------------------------ */



/**
 * A client's staff account (2026-09-28), made by a project owner's invite:
 * role 'staff', no password yet (a random one nobody knows), and a one-time
 * link to set theirs. Staff never sign up with the team's code. Returns the
 * account and its link, or null if the email already has an account.
 */
export const createStaffAccount = serialMutation(createStaffAccountImpl);
async function createStaffAccountImpl({ name, email }) {
  const user = await createUser({ name, email, password: randomBytes(32).toString('base64url'), role: 'staff' });
  if (!user) return null;
  const link = await createResetToken(user.id);
  return { user, token: link.token, expires: link.expires };
}


/** When the password last changed: sessions issued before it are void. */
export async function passwordChangedAt(id) {
  const u = (await readAllUsers()).find((x) => x.id === id);
  return u ? u.passwordChangedAt ?? null : undefined; // undefined: no such account
}

export const createResetToken = serialMutation(createResetTokenImpl);
async function createResetTokenImpl(id) {
  const all = await readAllUsers();
  const record = all.find((u) => u.id === id);
  if (!record) return null;
  const token = randomBytes(24).toString('base64url');
  record.reset = { hash: sha(token), expires: Date.now() + RESET_TTL };
  await writeFileWhole(fileFor(record.email), JSON.stringify(record, null, 2));
  return { token, expires: new Date(record.reset.expires).toISOString(), user: publicUser(record) };
}

/** Sets the new password if the token is live; null otherwise. */
export const resetPassword = serialMutation(resetPasswordImpl);
async function resetPasswordImpl(token, password) {
  const hash = sha(token);
  const record = (await readAllUsers()).find((u) => u.reset && u.reset.hash === hash);
  if (!record || record.reset.expires < Date.now()) return null;
  record.passwordHash = await hashPassword(password);
  record.passwordChangedAt = Date.now();
  delete record.reset;
  await writeFileWhole(fileFor(record.email), JSON.stringify(record, null, 2));
  return publicUser(record);
}

/** A signed-in person's own new password (the route checks the old one).
 *  Voids older sessions and any reset link still waiting. */
export const setPassword = serialMutation(setPasswordImpl);
async function setPasswordImpl(id, password) {
  const record = (await readAllUsers()).find((u) => u.id === id);
  if (!record) return null;
  record.passwordHash = await hashPassword(password);
  record.passwordChangedAt = Date.now();
  delete record.reset;
  await writeFileWhole(fileFor(record.email), JSON.stringify(record, null, 2));
  return publicUser(record);
}

/** Refuses to remove the last admin. */
export const deleteUser = serialMutation(deleteUserImpl);
async function deleteUserImpl(id) {
  const all = await readAllUsers();
  const record = all.find((u) => u.id === id);
  if (!record) return null;
  if (record.role === 'admin' && all.filter((u) => u.role === 'admin').length <= 1) {
    throw Object.assign(new Error('That is the only admin — promote someone else first.'), { status: 409 });
  }
  await fs.rm(fileFor(record.email), { force: true });
  return publicUser(record);
}

/** Returns the public user when the credentials are right, else null. */
export async function verifyUser(email, password) {
  const user = await readUser(email);
  if (!user) {
    // Spend the same time as a real check, so response time doesn't reveal
    // which emails have accounts.
    await hashPassword(String(password));
    return null;
  }
  return (await passwordMatches(String(password), user.passwordHash)) ? publicUser(user) : null;
}
