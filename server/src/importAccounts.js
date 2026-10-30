import { normEmail } from './accountCredentials.js';

/** Run inside one transaction. Identity conflicts must not silently change
 * the accounts referenced by project ownership and memberships. */
export async function importAccounts(client, accounts) {
  await client.query('select pg_advisory_xact_lock(7240031)');
  let added = 0;
  for (const u of accounts) {
    if (!u.id || !u.email || !u.passwordHash) throw new Error('Invalid source account; import cancelled.');
    const email = normEmail(u.email);
    const existing = await client.query('select id, email from app.users where id = $1 or email = $2 for update', [u.id, email]);
    if (existing.rows.length) {
      if (existing.rows.length !== 1 || existing.rows[0].id !== u.id || existing.rows[0].email !== email) {
        throw new Error('Account identity conflict; reconcile database and file accounts before importing.');
      }
      continue;
    }
    await client.query(
      `insert into app.users (id, name, email, password_hash, role, password_changed_at, created_at, reset_hash, reset_expires)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [u.id, u.name, email, u.passwordHash, u.role ?? 'editor', u.passwordChangedAt ? new Date(u.passwordChangedAt) : null,
        u.createdAt ?? new Date(), u.reset?.hash ?? null, u.reset?.expires ? new Date(u.reset.expires) : null]
    );
    added++;
  }
  return { added, existing: accounts.length - added };
}
