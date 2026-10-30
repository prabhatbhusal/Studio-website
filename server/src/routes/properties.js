/**
 * Properties (CLAUDE.md §5.1) — one per client. Studio-only for now: the
 * public hub page (/t/<property>) that would read these is not built yet,
 * so there is no public read and no publish state here.
 *
 * Ownership (2026-09-24, private per account 2026-09-27): a project belongs to
 * whoever created it. Each account sees only the projects it owns or was
 * shared into — an admin too; admin is for running accounts, not a view of
 * everyone's work. Projects from before accounts (ownerId null) show only as
 * a name any account can claim. Only the owner can rename, delete, rebrand or
 * change who else has access.
 */
import { Router } from 'express';
import {
  listProperties, getProperty, createProperty, renameProperty, deleteProperty, listScenes,
  addPropertyMember, removePropertyMember, propertyIsVisible, propertyStaffSees, propertyIsManageable, propertyIsClaimable, claimProperty, setPropertyTheme, setPropertyInfo, setLeadEmails, setPropertyFeatures, FEATURES, setPropertyStatus
} from '../store.js';
import { listLeads, leadsCsv } from '../leadsStore.js';
import { monthStats, monthOf } from '../stats.js';
import { getScene } from '../store.js';
import express from 'express';
import { Readable } from 'stream';
import * as storage from '../storage.js';
import { imageKind } from './assets.js';
import { requireEditorSession } from '../middleware/auth.js';
import { getUserById, getUserByEmail } from '../usersStore.js';
import { freshSession as fresh, refuseStaff } from '../access.js';
import { createStaffAccount } from '../usersStore.js';
import { record, recent } from '../activity.js';
import { removeSite, readSite } from './sites.js';
import { bookingTimezone } from '../calendar.js';
import { readReservations, nowIn } from '../reservations.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../dataDir.js';
import { sendMail, teamRecipients, venueMail } from '../mailer.js';

export const propertiesRouter = Router();

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

/** The session's current role (access.js); a deleted account can see nothing. */
const freshSession = async (req) => (await fresh(req.session)) ?? { sub: req.session.sub, role: 'none' };

const NOT_FOUND = { error: 'That project does not exist.' };

/** Public: a project's branding, WhatsApp number and whether it takes
 *  enquiries and bookings, for its tours. Nothing else about it. */
propertiesRouter.get('/:id/theme', wrap(async (req, res) => {
  const p = await getProperty(req.params.id);
  if (!p) return res.status(404).json(NOT_FOUND);
  res.json({
    title: p.title, theme: p.theme ?? {}, whatsapp: p.info?.whatsapp ?? null,
    features: { enquiries: p.features.enquiries, reservations: p.features.reservations }
  });
}));

/** Owner or admin: the project, or the reason they can't change it. */
async function manageable(req, res) {
  const session = await freshSession(req);
  const p = await getProperty(req.params.id);
  if (!p || !propertyIsVisible(p, session)) { res.status(404).json(NOT_FOUND); return null; }
  if (!propertyIsManageable(p, session)) { res.status(403).json({ error: 'Only the project\u2019s owner can change that.' }); return null; }
  return p;
}

/** Anyone who can see the project: its enquiries, newest first. */
export async function visibleProject(req, res) {
  const session = await freshSession(req);
  const p = await getProperty(req.params.id);
  if (!p || !propertyIsVisible(p, session)) { res.status(404).json(NOT_FOUND); return null; }
  return p;
}
/** Anyone who can see the project, or is on its client's staff: for the
 *  routes that answer guests (enquiries, reservations, the report). */
export async function staffProject(req, res) {
  const session = await freshSession(req);
  const p = await getProperty(req.params.id);
  if (!p || !propertyStaffSees(p, session)) { res.status(404).json(NOT_FOUND); return null; }
  return p;
}
const projectLeads = async (id) => (await listLeads()).filter((l) => l.propertyId === id);

// A project's enquiries, and the addresses their emails go to.
propertiesRouter.get('/:id/leads', requireEditorSession, wrap(async (req, res) => {
  const p = await staffProject(req, res);
  if (!p) return;
  res.json({ leads: await projectLeads(p.id), emails: p.leadEmails ?? [], emailOn: !!process.env.RESEND_API_KEY });
}));

/** The monthly client report (studio/report/[property]): visits and time per
 *  space from stats.js, enquiries per space from the leads; the path to a
 *  booking (visits, hotspots opened, cards opened, enquiries, booking
 *  requests, confirmed) and the hotspots that got attention, with the
 *  enquiries sent after each. ?month=YYYY-MM, this month by default. */
propertiesRouter.get('/:id/report', requireEditorSession, wrap(async (req, res) => {
  const p = await staffProject(req, res);
  if (!p) return;
  const month = typeof req.query.month === 'string' ? req.query.month : monthOf();
  const stats = await monthStats(p.id, month);
  if (!stats) return res.status(400).json({ error: 'month must look like 2026-09.' });
  const leads = (await projectLeads(p.id)).filter((l) => l.createdAt.startsWith(month));
  const ids = new Set([...Object.keys(stats.spaces), ...leads.map((l) => l.sceneId).filter((id) => id !== 'hub'),
    ...(await listScenes()).filter((s) => s.propertyId === p.id).map((s) => s.id)]);
  const spaces = [];
  const hsLabel = new Map(); // "<space>/<hotspot>" -> its name, for hotspots looked at but never opened
  for (const id of ids) {
    const doc = await getScene(id).catch(() => null);
    for (const h of doc?.hotspots ?? []) hsLabel.set(`${id}/${h.id}`, h.label);
    const st = stats.spaces[id] ?? { visits: 0, seconds: 0 };
    spaces.push({ id, title: doc?.title || id, visits: st.visits, seconds: st.seconds, enquiries: leads.filter((l) => l.sceneId === id).length });
  }
  spaces.sort((a, b) => b.visits - a.visits || b.enquiries - a.enquiries);

  // Booking requests made this month, and how many of them were confirmed.
  // guests' bookings only: the team's "booked" marks are no visitor's doing
  const made = (await readReservations(p.id)).filter((r) => r.createdAt?.startsWith(month) && !r.blocked);
  // (a waitlist entry, kind 'wait', is not a booking request)
  // a Book now request from a hotspot (kind 'request') counts with its kind of booking
  const asked = (of) => (r) => r.kind === 'request' && r.of === of;
  const rooms = made.filter((r) => r.kind === 'stay' || asked('room')(r)), tables = made.filter((r) => !r.kind || asked('table')(r));
  const events = made.filter((r) => r.kind === 'event' || asked('hall')(r));
  const confirmed = (list) => list.filter((r) => r.status === 'confirmed').length;
  const titleOf = new Map(spaces.map((s) => [s.id, s.title]));
  // every hotspot opened or looked at (in the middle of the view), with both counts
  const keys = new Set([
    ...Object.entries(stats.hotspots).flatMap(([space, byId]) => Object.keys(byId).map((hid) => `${space}/${hid}`)),
    ...Object.entries(stats.looked).flatMap(([space, byId]) => Object.keys(byId).map((hid) => `${space}/${hid}`))
  ]);
  const hotspots = [...keys].map((key) => {
    const space = key.slice(0, key.indexOf('/')), hid = key.slice(key.indexOf('/') + 1);
    const opened = stats.hotspots[space]?.[hid];
    return {
      space, spaceTitle: titleOf.get(space) ?? space, id: hid, label: opened?.label || hsLabel.get(key) || hid,
      opens: opened?.opens ?? 0, looked: stats.looked[space]?.[hid] ?? 0,
      enquiries: leads.filter((l) => l.sceneId === space && l.hotspotId === hid).length
    };
  }).sort((a, b) => b.opens - a.opens || b.looked - a.looked || b.enquiries - a.enquiries).slice(0, 15);
  // where visitors came from, and the enquiries each source brought
  const sourceNames = new Set([...Object.keys(stats.sources), ...leads.map((l) => l.source || 'direct')]);
  const sources = [...sourceNames].map((name) => ({
    name, visits: stats.sources[name] ?? 0, enquiries: leads.filter((l) => (l.source || 'direct') === name).length
  })).sort((a, b) => b.visits - a.visits || b.enquiries - a.enquiries);
  // cards opened; going on to the hotel's own booking page is its own step, not another card
  const { handoff: handoffs = 0, ...cards } = stats.intent;
  const intents = Object.values(cards).reduce((a, n) => a + n, 0);
  res.json({
    project: { id: p.id, title: p.title, theme: p.theme ?? {} },
    month,
    visits: stats.visits,
    seconds: stats.seconds,
    days: stats.days,
    enquiries: leads.length,
    fromProjectPage: leads.filter((l) => l.sceneId === 'hub').length,
    spaces,
    funnel: {
      visits: stats.visits, engaged: stats.engaged, intent: stats.intent, intents, handoffs,
      enquiries: leads.length,
      requests: { tables: tables.length, rooms: rooms.length, events: events.length },
      confirmed: { tables: confirmed(tables), rooms: confirmed(rooms), events: confirmed(events) }
    },
    hotspots,
    sources
  });
}));

/** The same, for Excel. */
propertiesRouter.get('/:id/leads.csv', requireEditorSession, wrap(async (req, res) => {
  const p = await staffProject(req, res);
  if (!p) return;
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${p.id}-enquiries-${day}.csv"`);
  res.send(leadsCsv(await projectLeads(p.id)));
  await record(req, p.id, 'downloaded the enquiries', p.title);
}));

/** Owner or admin: who new enquiries are emailed to. */
propertiesRouter.put('/:id/lead-emails', requireEditorSession, wrap(async (req, res) => {
  const p = await manageable(req, res);
  if (!p) return;
  try {
    const next = await setLeadEmails(p.id, req.body?.emails);
    await record(req, p.id, 'changed who gets enquiries', p.title, next.leadEmails.join(', ') || 'no one');
    res.json({ emails: next.leadEmails });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

/** Which parts of the platform the project uses (store.js FEATURES). Owner only. */
propertiesRouter.put('/:id/features', requireEditorSession, wrap(async (req, res) => {
  const p = await manageable(req, res);
  if (!p) return;
  const next = await setPropertyFeatures(p.id, req.body ?? {});
  const changed = FEATURES.filter((k) => next.features[k] !== p.features[k]);
  if (changed.length) await record(req, p.id, 'changed the features it uses', p.title, changed.map((k) => `${k} ${next.features[k] ? 'on' : 'off'}`).join(', '));
  res.json(next);
}));

/** In progress, delivered or archived (store.js PROJECT_STATUSES), kept in its
 *  activity log. Owner only. */
propertiesRouter.put('/:id/status', requireEditorSession, wrap(async (req, res) => {
  const p = await manageable(req, res);
  if (!p) return;
  const next = await setPropertyStatus(p.id, req.body?.status);
  if (next.status !== p.status) {
    const did = next.status === 'archived' ? 'archived the project'
      : p.status === 'archived' ? 'restored the project'
      : `marked the project ${next.status === 'delivered' ? 'delivered' : 'in progress'}`;
    await record(req, p.id, did, p.title);
  }
  res.json(next);
}));

/** What waits on a project, for its card in the list: booking requests needing
 *  a reply (counted as its home counts them) and enquiries in the last 7 days. */
const WEEK = 7 * 24 * 3600 * 1000;
async function waitingOn(p, leads) {
  const today = nowIn(bookingTimezone((await readSite(p.id))?.published)).date;
  const bookings = p.features.reservations
    ? (await readReservations(p.id)).filter((r) => r.kind !== 'wait' && r.status === 'requested' && (r.checkout ? r.checkout > today : r.date >= today)).length
    : 0;
  const enquiries = p.features.enquiries ? leads.filter((l) => l.propertyId === p.id && Date.now() - Date.parse(l.createdAt) < WEEK).length : 0;
  return { bookings, enquiries };
}

/** Anyone who can see the project: a test email to where its enquiries go, to
 *  check the email set-up. Says why when it can't send (mailer.js resendReason). */
propertiesRouter.post('/:id/lead-emails/test', requireEditorSession, wrap(async (req, res) => {
  const p = await visibleProject(req, res);
  if (!p) return;
  const to = teamRecipients(p.leadEmails ?? []);
  const r = await sendMail({
    to, subject: `Test email for ${p.theme?.brand || p.title}`,
    text: `This is a test from RCAAS.tech. Enquiries and booking requests for ${p.theme?.brand || p.title} will come to this address.\n\nGuests' emails are sent in the venue's name, and their replies go to ${venueMail(p).replyTo || 'nobody yet: add the brand email or an enquiry address'}.`,
    ...venueMail(p)
  });
  res.status(r.sent ? 200 : 502).json(r.sent ? r : { error: r.reason, to });
}));

/** Brand name, accent colour, heading font. */
propertiesRouter.put('/:id/theme', requireEditorSession, wrap(async (req, res) => {
  const p = await manageable(req, res);
  if (!p) return;
  const patch = {};
  for (const k of ['brand', 'accent', 'font']) if (req.body && k in req.body) patch[k] = req.body[k];
  try {
    const next = await setPropertyTheme(p.id, patch);
    await record(req, p.id, 'changed the branding', p.title);
    res.json(next);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

/** The logo, and the favicon its tour and website show in the browser tab:
 *  PNG, JPEG or WebP, 2 MB at most, stored in the asset `brand_<project>`,
 *  so they're served like any other asset. A new one replaces the old;
 *  `?v=` in the path makes browsers fetch the new one. */
const LOGO_MAX = 2 * 1024 * 1024;
// Upload the project's logo or favicon (PNG, JPEG or WebP, as the raw body).
propertiesRouter.put('/:id/:image(logo|favicon)', requireEditorSession, express.raw({ type: () => true, limit: LOGO_MAX }), wrap(async (req, res) => {
  const p = await manageable(req, res);
  if (!p) return;
  const { image } = req.params;
  const body = req.body;
  const kind = Buffer.isBuffer(body) && body.length ? imageKind(body) : undefined;
  if (!kind) return res.status(415).json({ error: `Use a PNG, JPEG or WebP image for the ${image}.` });
  const assetId = `brand_${p.id}`;
  for (const ext of ['png', 'jpg', 'webp']) await storage.remove(assetId, `${image}.${ext}`);
  await storage.put(assetId, `${image}.${kind}`, Readable.from([body]));
  const next = await setPropertyTheme(p.id, { [image]: `${assetId}/${image}.${kind}?v=${Date.now()}` });
  await record(req, p.id, `uploaded a ${image}`, p.title);
  res.json(next);
}), (err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That image is over 2 MB. Export it smaller.' });
  next(err);
});

// Remove the project's logo or favicon.
propertiesRouter.delete('/:id/:image(logo|favicon)', requireEditorSession, wrap(async (req, res) => {
  const p = await manageable(req, res);
  if (!p) return;
  const { image } = req.params;
  for (const ext of ['png', 'jpg', 'webp']) await storage.remove(`brand_${p.id}`, `${image}.${ext}`);
  const next = await setPropertyTheme(p.id, { [image]: null });
  await record(req, p.id, `removed the ${image}`, p.title);
  res.json(next);
}));

/** What the project says about its brand (store.js setPropertyInfo). Owner only. */
propertiesRouter.put('/:id/info', requireEditorSession, wrap(async (req, res) => {
  const p = await manageable(req, res);
  if (!p) return;
  const next = await setPropertyInfo(p.id, req.body ?? {});
  await record(req, p.id, 'updated the brand information', p.title);
  res.json(next);
}));

/** Every property this session can see, with how many spaces it holds. Projects
 *  from before accounts (no owner) come too, but only as a name to claim. */
propertiesRouter.get('/', requireEditorSession, wrap(async (req, res) => {
  const session = await freshSession(req);
  const [properties, scenes, leads] = await Promise.all([listProperties(), listScenes(), listLeads()]);
  const count = (id) => scenes.filter((s) => s.propertyId === id).length;
  const mine = await Promise.all(properties.filter((p) => propertyIsVisible(p, session))
    .map(async (p) => ({ ...p, access: propertyIsManageable(p, session) ? 'owner' : 'member', spaceCount: count(p.id), waiting: await waitingOn(p, leads) })));
  const staffed = properties.filter((p) => !propertyIsVisible(p, session) && propertyStaffSees(p, session)).map(staffView);
  const unclaimed = properties.filter((p) => session.role !== 'staff' && !propertyIsVisible(p, session) && !propertyStaffSees(p, session) && propertyIsClaimable(p, session))
    .map((p) => ({ id: p.id, title: p.title, ownerId: null, members: [], claimable: true, spaceCount: count(p.id) }));
  res.json([...mine, ...staffed, ...unclaimed]);
}));

/** Make a project from before accounts yours: from then on only you (and whoever
 *  you share it with) can see it. */
propertiesRouter.post('/:id/claim', requireEditorSession, wrap(async (req, res) => {
  if (await refuseStaff(req, res)) return;
  const session = await freshSession(req);
  const p = await getProperty(req.params.id);
  if (!p) return res.status(404).json(NOT_FOUND);
  if (!propertyIsClaimable(p, session)) {
    return res.status(409).json({ error: p.ownerId ? 'That project already has an owner.' : 'Sign in with your own account to claim a project.' });
  }
  const claimed = await claimProperty(p.id, session.sub);
  if (!claimed) return res.status(409).json({ error: 'Someone has just claimed it.' });
  await record(req, p.id, 'claimed the project', p.title);
  res.json(claimed);
}));

// One project with its members' names; a staff account gets only what staff may see.
propertiesRouter.get('/:id', requireEditorSession, wrap(async (req, res) => {
  const session = await freshSession(req);
  const p = await getProperty(req.params.id);
  if (!p || !propertyStaffSees(p, session)) return res.status(404).json(NOT_FOUND);
  if (!propertyIsVisible(p, session)) return res.json(staffView(p));
  // Resolve names for the share panel — cheap at this team size (usersStore).
  const [ownerUser, memberUsers, staffUsers] = await Promise.all([
    p.ownerId ? getUserById(p.ownerId) : null,
    Promise.all(p.members.map(getUserById)),
    Promise.all(p.staff.map(getUserById))
  ]);
  const who = (list) => list.filter(Boolean).map((u) => ({ id: u.id, name: u.name, email: u.email }));
  res.json({
    ...p,
    access: propertyIsManageable(p, session) ? 'owner' : 'member',
    ownerName: ownerUser?.name ?? null,
    memberDetails: who(memberUsers),
    staffDetails: who(staffUsers)
  });
}));

/** What the client's staff see of a project: its name and brand, no one's details. */
const staffView = (p) => ({ id: p.id, title: p.title, theme: p.theme ?? {}, features: p.features, ownerId: p.ownerId, members: [], staff: [], access: 'staff', spaceCount: 0 });

// Create a project (team accounts only).
propertiesRouter.post('/', requireEditorSession, wrap(async (req, res) => {
  if (await refuseStaff(req, res)) return;
  const p = await createProperty(req.body?.title, req.session.sub ?? null);
  await record(req, p.id, 'created the project', p.title);
  res.status(201).json(p);
}));

/** Who did what in this project, newest first. Anyone who can see it. */
propertiesRouter.get('/:id/activity', requireEditorSession, wrap(async (req, res) => {
  const session = await freshSession(req);
  const p = await getProperty(req.params.id);
  if (!p || !propertyIsVisible(p, session)) return res.status(404).json(NOT_FOUND);
  res.json(await recent(p.id));
}));

/** Title only — the id never changes (see renameProperty). Owner or admin. */
propertiesRouter.patch('/:id', requireEditorSession, wrap(async (req, res) => {
  const session = await freshSession(req);
  const existing = await getProperty(req.params.id);
  if (!existing || !propertyIsVisible(existing, session)) return res.status(404).json(NOT_FOUND);
  if (!propertyIsManageable(existing, session)) return res.status(403).json({ error: 'Only the project’s owner can rename it.' });
  const renamed = await renameProperty(req.params.id, req.body?.title);
  await record(req, existing.id, 'renamed the project', renamed.title, `was “${existing.title}”`);
  res.json(renamed);
}));

/** Its spaces are kept and become unfiled; nothing published changes. Owner or admin. */
propertiesRouter.delete('/:id', requireEditorSession, wrap(async (req, res) => {
  const session = await freshSession(req);
  const existing = await getProperty(req.params.id);
  if (!existing || !propertyIsVisible(existing, session)) return res.status(404).json(NOT_FOUND);
  if (!propertyIsManageable(existing, session)) return res.status(403).json({ error: 'Only the project’s owner can delete it.' });
  const gone = await deleteProperty(req.params.id, session.sub ?? null);
  await storage.remove(`brand_${existing.id}`); // its logo
  await removeSite(existing.id); // its website and photos
  await fs.rm(path.join(DATA_DIR, 'attachments', existing.id), { recursive: true, force: true }); // guests' event plans
  await record(req, existing.id, 'deleted the project', existing.title, gone.released ? `${gone.released} space(s) moved to “Not in a project yet”` : undefined);
  res.json(gone);
}));

/** Share the project with a teammate, by email: as a member (full access), or
 *  with `as: 'staff'` as the client's staff. Owner only. */
propertiesRouter.post('/:id/members', requireEditorSession, wrap(async (req, res) => {
  const session = await freshSession(req);
  const existing = await getProperty(req.params.id);
  if (!existing || !propertyIsVisible(existing, session)) return res.status(404).json(NOT_FOUND);
  if (!propertyIsManageable(existing, session)) return res.status(403).json({ error: 'Only the project’s owner can share it.' });
  const email = String(req.body?.email ?? '').trim();
  if (!email) return res.status(400).json({ error: 'Enter an email address.' });
  const as = req.body?.as === 'staff' ? 'staff' : 'member';
  let user = await getUserByEmail(email);
  let invite = null;
  // The client's staff don't sign up with the team's code: the owner invites them. A new
  // email gets a staff account and a one-time link to set its password, for the owner to send.
  if (!user && as === 'staff') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email address doesn’t look right.' });
    const name = String(req.body?.name ?? '').trim().slice(0, 80) || email.split('@')[0];
    const made = await createStaffAccount({ name, email });
    if (made) { user = made.user; invite = { path: `/login?reset=${made.token}`, expires: made.expires }; }
  }
  if (!user) return res.status(404).json({ error: 'No account with that email. They need to sign up first, or add them as client staff to invite them.' });
  if (user.role === 'staff' && as === 'member') return res.status(400).json({ error: 'That’s a client staff account: it can only be added as client staff.' });
  const shared = await addPropertyMember(req.params.id, user.id, as);
  await record(req, existing.id, as === 'staff' ? (invite ? 'invited client staff' : 'added client staff') : 'shared the project', existing.title, `${user.name}`);
  if (invite) return res.json({ ...shared, invite });
  res.json(shared);
}));

// Take someone off a project (its owner only).
propertiesRouter.delete('/:id/members/:userId', requireEditorSession, wrap(async (req, res) => {
  const session = await freshSession(req);
  const existing = await getProperty(req.params.id);
  if (!existing || !propertyIsVisible(existing, session)) return res.status(404).json(NOT_FOUND);
  if (!propertyIsManageable(existing, session)) return res.status(403).json({ error: 'Only the project’s owner can change who has access.' });
  const left = await removePropertyMember(req.params.id, req.params.userId);
  const who = await getUserById(req.params.userId);
  await record(req, existing.id, 'removed a teammate', existing.title, who ? who.name : undefined);
  res.json(left);
}));
