/**
 * Public lead intake (CLAUDE.md §6.4). Hostile-facing by definition — no
 * auth, reachable from any embed — so: rate limit by IP, a honeypot field,
 * a submission-time check, a size cap per field, and nothing stored or
 * echoed back that could carry HTML.
 *
 * The rate limiter and the timing check are both in-memory: fine for one
 * process; a real deployment behind multiple instances needs a shared store
 * (Redis, or a column on the Postgres this is standing in for) — noted, not
 * built, since there's exactly one Node process today.
 */
import { Router } from 'express';
import { saveLead, listLeads, setLeadDelivery } from '../leadsStore.js';
import { requireAdmin } from '../middleware/auth.js';
import { getPublishedScene, getProperty } from '../store.js';
import { sendLeadEmail } from '../mailer.js';
import { cleanSource } from '../stats.js';
import { validPhone, validEmail, PHONE_WRONG } from '../notify.js';
import { rateLimiter } from '../rateLimit.js';

export const leadsRouter = Router();

const FIELD_LIMITS = { name: 100, phone: 30, email: 200, requirement: 200, dates: 100, message: 2000, hotspotId: 100, hotspotLabel: 120 };
const MIN_FILL_TIME_MS = 1200; // a bot fills the form instantly; a person doesn't

const rateLimited = rateLimiter(Number(process.env.LEADS_RATE_MAX) || 5); // per IP; tests raise it

/** No HTML in anything we store or ever render back. */
const clean = (s) => String(s ?? '').replace(/[<>]/g, '').trim();

// An enquiry from a tour or website: filed with its project and emailed to its team (rate-limited).
leadsRouter.post('/', async (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      return res.status(429).json({ error: 'Too many enquiries from this connection. Try again shortly.' });
    }

    const body = req.body || {};

    // Bot-catches fail SILENTLY (200, nothing stored) — telling an attacker
    // which check tripped just teaches them to route around it.
    if (clean(body.website)) return res.json({ ok: true });
    const renderedAt = Number(body.formRenderedAt);
    if (!renderedAt || Date.now() - renderedAt < MIN_FILL_TIME_MS) return res.json({ ok: true });

    if (!clean(body.name)) return res.status(400).json({ error: 'Name is required.' });
    // A phone, an email or both (a client website's form takes either in one box).
    if (!clean(body.phone) && !clean(body.email)) return res.status(400).json({ error: 'Add a phone number or email so we can reach you.' });
    for (const [field, max] of Object.entries(FIELD_LIMITS)) {
      if (clean(body[field]).length > max) {
        return res.status(400).json({ error: `${field} is too long — keep it under ${max} characters.` });
      }
    }
    if (clean(body.phone) && !validPhone(body.phone)) return res.status(400).json({ error: PHONE_WRONG });
    if (clean(body.email) && !validEmail(body.email)) return res.status(400).json({ error: 'That email address doesn’t look right.' });
    if (!body.sceneId) return res.status(400).json({ error: 'Missing which space this enquiry is about.' });

    // Which project it's for: the space's own (resolved here, never taken on
    // trust), or, from a project's hub page, that project if it exists.
    const sceneId = clean(body.sceneId);
    let propertyId = null;
    const scene = sceneId !== 'hub' ? await getPublishedScene(sceneId) : null;
    if (scene) propertyId = scene.propertyId ?? null;
    else if (sceneId === 'hub' && typeof body.propertyId === 'string' && (await getProperty(body.propertyId))) propertyId = body.propertyId;
    if (!scene && !propertyId) return res.status(404).json({ error: 'That published space or project does not exist.' });
    // A project that switched enquiries off takes none, even from a page published before.
    if (propertyId && !(await getProperty(propertyId))?.features.enquiries) {
      return res.status(403).json({ error: 'This place doesn’t take enquiries here. Contact it directly.' });
    }

    const lead = await saveLead({
      propertyId,
      sceneId,
      sceneName: clean(body.sceneName),
      name: clean(body.name),
      phone: clean(body.phone),
      email: clean(body.email),
      requirement: clean(body.requirement),
      dates: clean(body.dates),
      message: clean(body.message),
      // what they were looking at before asking (the tour's last hotspot)
      hotspotId: clean(body.hotspotId),
      hotspotLabel: clean(body.hotspotLabel),
      // where the visitor came from (stats.js cleanSource): the report counts enquiries per source
      source: cleanSource(body.source),
      ip
    });

    res.json({ ok: true, id: lead.id });

    // Email after answering the visitor: a slow mail service never makes them
    // wait, and a failed send is recorded on the lead, not lost.
    (async () => {
      const p = propertyId ? await getProperty(propertyId) : null;
      const r = await sendLeadEmail(lead, p?.leadEmails ?? [], p ? p.theme?.brand || p.title : '');
      await setLeadDelivery(lead.id, { ...r, at: new Date().toISOString() });
    })().catch((err) => console.warn('[leads] email:', err.message));
  } catch (err) {
    next(err);
  }
});

// Every project's enquiries: admins only. A project's own are at
// /api/properties/:id/leads, for anyone who can see that project.
leadsRouter.get('/', requireAdmin, async (req, res, next) => {
  try {
    res.json(await listLeads());
  } catch (err) {
    next(err);
  }
});
