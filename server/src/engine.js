/**
 * A hotel's own booking engine, asked which nights a room is taken
 * (2026-10-26). A room hotspot can name an availability link
 * (payload.availabilityUrl) with {checkin} {checkout} {guests} {nights}
 * filled in, which answers JSON:
 *   { "booked": ["2026-11-02", …] }   the nights taken, or
 *   { "available": false }            every night of the stay taken.
 * Engines differ, so a real one needs a small adapter that answers this. The
 * demo engine (`/api/demo-engine/…`, routes/demoEngine.js) does, for showing
 * it on this PC. Answers are kept a minute. Anything wrong (down, slow, not
 * JSON) means "don't know": nothing is struck out, and the hotel's own page
 * has the last word.
 */
import { nightsOf } from './stays.js';
import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

const day = (d) => Math.floor(Date.parse(`${d}T12:00:00Z`) / 86400000);
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The demo engine's calendar: about every third night taken, the same each time, different per room. */
export function demoBooked(params) {
  const checkin = params.get('checkin') ?? '', checkout = params.get('checkout') ?? '';
  const salt = hash(params.get('room') ?? '');
  return nightsOf(checkin, checkout).filter((n) => (day(n) + salt) % 3 === 0);
}

const cache = new Map(); // filled-in link -> { at, booked }
const pending = new Map();
let active = 0;
const denied = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) denied.addSubnet(ip,prefix,'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::',3,'ipv6');
export const publicAddress = (address) => isIP(address) === 4 ? !denied.check(address,'ipv4')
  : isIP(address) === 6 && globalV6.check(address,'ipv6') && !address.toLowerCase().startsWith('2001:db8:');

// Resolve in the actual connection lookup, not in a separate preflight: the
// verified IP is the one used by the socket, preventing DNS rebinding.
function safeLookup(host, options, callback) {
  lookup(host, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((x) => !publicAddress(x.address))) return callback(new Error('Engine address is private.'));
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

function readEngine(url, production) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { agent: false, headers: { accept: 'application/json' }, ...(production ? { lookup: safeLookup } : {}) }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('Engine did not answer.')); }
      const chunks = []; let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 65536) { res.destroy(new Error('Engine response is too large.')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (err) { reject(err); } });
    });
    const timer = setTimeout(() => req.destroy(new Error('Engine timed out.')), 4000);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
  });
}

/** The nights of a stay the engine says are taken, or null when it can't say. */
export async function engineBooked(template, stay) {
  if (typeof template !== 'string' || !template.trim()) return null;
  const nights = nightsOf(stay.checkin, stay.checkout);
  if (!nights.length) return [];
  const values = { checkin: stay.checkin, checkout: stay.checkout, guests: String(stay.guests ?? ''), nights: String(nights.length) };
  const url = template.trim().replace(/\{(checkin|checkout|guests|nights)\}/g, (_, k) => encodeURIComponent(values[k]));
  if (url.startsWith('/api/demo-engine/')) return process.env.NODE_ENV !== 'production' || process.env.DEMO_ENGINE === '1'
    ? demoBooked(new URL(url, 'http://demo').searchParams) : null;

  let u;
  try { u = new URL(url); } catch { return null; }
  const dev = process.env.NODE_ENV !== 'production';
  if (!(u.protocol === 'https:' || (dev && u.protocol === 'http:')) || u.username || u.password) return null;
  if (!dev) {
    const hosts = (process.env.ENGINE_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!hosts.includes(u.hostname.toLowerCase()) || u.port && u.port !== '443') return null;
    if (isIP(u.hostname.replace(/^\[|\]$/g,'')) && !publicAddress(u.hostname.replace(/^\[|\]$/g,''))) return null;
  }
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.booked === null ? 10000 : 60000)) return hit.booked;
  if (pending.has(url)) return pending.get(url);
  if (active >= 4) return null;
  active++;
  const run = (async () => {
   let booked = null;
   try {
    const j = await readEngine(u, !dev);
    booked = j?.available === false ? nights
      : Array.isArray(j?.booked) ? j.booked.filter((d) => typeof d === 'string' && nights.includes(d)) : null;
   } catch { /* Unknown availability: the external engine has the final word. */ }
   finally { active--; pending.delete(url); }
   if (cache.size >= 500) cache.clear();
   cache.set(url, { at: Date.now(), booked });
   return booked;
  })();
  pending.set(url, run);
  return run;
}
