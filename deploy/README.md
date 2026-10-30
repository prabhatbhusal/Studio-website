# VPS deployment and restore

These are reviewed starter configurations, not a deployed server. Replace the domain and paths before use. Keep this repository and the audit folder outside the nginx document root.

1. Use Node 24 and an unprivileged `rcaas` account. Install nginx, a TLS certificate, PM2, and PostgreSQL client tools if using PostgreSQL. Open only SSH/HTTP/HTTPS in the firewall; keep ports 3000/4000 private.
2. Put code at `/srv/rcaas/app`, runtime JSON at `/srv/rcaas/data`, and local scans at `/srv/rcaas/assets`, owned by the service user. Transfer all existing runtime data and scan files explicitly; ignored files do not come with a git clone. Stop writes during migration. Preserve directory structure and permissions.
3. Put frontend production values in root `.env.production`: `NEXT_PUBLIC_API_URL=https://YOUR_DOMAIN` and `NEXT_PUBLIC_SITE_URL=https://YOUR_DOMAIN`. Set them **before building**, since browser code includes these values. Empty `NEXT_PUBLIC_BASE_PATH` deploys at the root.
4. Put API secrets in `server/.env`, mode 600. Set `NODE_ENV=production`, `CLIENT_ORIGIN=https://YOUR_DOMAIN`, three newly generated secrets (`SESSION_SECRET` and `EMBED_TOKEN_SECRET` at least 32 characters, `EDITOR_PASSWORD` at least 12), plus mail/storage/database settings as needed. Never reuse the examples. Production requires HTTPS origins and will not allow accountless login. Create a personal team account and verify its admin role locally before launch; existing file accounts must be migrated if enabling PostgreSQL.
5. Run `npm ci` and `npm ci --prefix server`, then `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`. Frontend build needs Google Fonts network access. Build dependencies including Tailwind must be installed. Do not run `npm ci --omit=dev` before building.
6. Replace `example.com` in nginx.conf, provision the certificate, validate with `nginx -t`, and enable it using your operating system's nginx configuration mechanism. Start `pm2 start deploy/ecosystem.config.cjs`, then configure PM2 boot persistence for the service user. API must have exactly one instance: its file-store lock refuses another writer. Use **stop then start** for API upgrades; do not use cluster/rolling reload. Build new releases separately from the active `.next` output; stop the web process before swapping release paths.
7. Verify HTTPS sign-in, owner/member/staff permissions, every published model, publish/unpublish/restore, enquiry emails, bookings/conflicts, attachments, mobile tours and metadata. Verify error logs and `/api/health`. Confirm direct API and web ports are inaccessible externally.

After a forced kill or machine power loss an API lock may remain. Startup fails closed rather than racing another process to remove it. Verify there is no API process for that DATA_DIR before manually removing `.api.lock`; normal SIGTERM/SIGINT shutdown releases it.

## Availability engines and storage limits

Production engine hosts must be explicitly named in `ENGINE_ALLOWED_HOSTS=api.hotel.example,engine.other.example`. Only HTTPS on port 443 is accepted; the connection's DNS resolution refuses private IPs. A host allowlist does not create the per-hotel adapter: it must still provide the documented JSON. Unavailable engines return unknown, not an invented availability result.

`UPLOAD_MAX_BYTES` defaults to 8 GiB per upload; `UPLOAD_FILES_MAX` to 20,000. Staging expires after 24 hours. `UPLOAD_ACCOUNT_MAX_BYTES` defaults to 100 GiB across uploads created with ownership metadata. Set appropriate VPS disk alerts and budgets; existing pre-audit orphan staging has no owner and needs a reviewed manual cleanup. Existing uploads in progress must restart after this upgrade.

To prevent duplicate inventory, room/hall hotspot requests and marks are refused when the website has booking enabled for that resource kind. Use the website booking form and mark its room/hall inventory instead. Existing hotspot bookings must be reconciled before enabling website booking; the API rejects enabling it over active hotspot bookings. Tables are still distinct per dining place and tour hotspot.

## Backups

Run `cd /srv/rcaas/app/server && npm run backup` under the service user. The archive contains `data.tar.gz`, optional `assets.tar.gz` (when local assets are outside DATA_DIR), optional `accounts.dump` (PostgreSQL custom format), and `manifest.json`. `pg_dump` must be installed when DATABASE_URL is set; a missing/failed dump makes backup fail. The manifest names exactly what is included. The archive does not contain `.env` secrets; keep those in a separate secured secret backup. Restrict backup permissions (umask 077). If using S3 the complete archive is copied to `backups.private/data/`; configure bucket encryption, restricted credentials and lifecycle independently. A cloud copy of JSON does not independently back up the scan bucket: enable versioning/backup appropriate to the provider.

Daily cron example (create the log directory with service-user permissions first):

```cron
15 3 * * * cd /srv/rcaas/app/server && umask 077 && npm run backup >> /srv/rcaas/backup.log 2>&1
```

Local retention defaults to 14 days. Remote lifecycle must be configured separately. Monitor exit codes and periodically copy a backup to a different machine. For a consistent application-wide backup, pause writes or stop the API; per-file atomic writes do not make a multi-file snapshot transactional.

## Restore drill (required before launch)

1. Use an isolated staging machine and empty target directories/database. Stop the API and web processes. Read manifest.json before extracting anything. Do not extract an untrusted archive.
2. Extract the outer archive into a private temporary directory. Extract `data.tar.gz` under the parent of the intended DATA_DIR; move/rename the restored directory if its original basename differs. Do the same for optional `assets.tar.gz` under the ASSET_DIR parent. Set service-user ownership and restrictive permissions.
3. If present, restore `accounts.dump` with `pg_restore --no-owner --no-acl --dbname=<new database> accounts.dump` using secured connection environment variables. Use an empty database; review roles/grants needed by the application before restore. Do not expose database passwords in shell history. Verify migration records and account IDs (project ownership refers to those IDs).
4. Remove a restored `.api.lock` only after confirming no API owns that data directory. Restore secrets from their separate store and point DATA_DIR/ASSET_DIR/DATABASE_URL at the restored targets. Start one API and the web process.
5. Test real accounts, permissions, bookings, attachments, every scan and website, and compare counts and checksums with the backup source. Document the restore time and recovery point. This drill has not been performed on your VPS by this code change.

## Remaining operator decisions

Configure DNS/TLS and mail domain verification; replace public content placeholders and approve policy wording; decide whether GitHub Pages remains enabled; set backups/monitoring/retention and test real hotel integrations. Source changes cannot verify these account-level settings.
