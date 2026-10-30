'use client';

import { use, useCallback, useEffect, useState } from 'react';
import {
  getProperty, getReservations, setReservationStatus, markBooked, bookingPlanUrl, getHereTables,
  type BookableHotspot, type EventSession, type Reservation, type ReservationStatus, type SiteBooking, type SiteEvents, type SiteStays
} from '../../../../lib/api';
import { useStudioSession } from '../../../../features/auth/useStudioSession';
import { matchesReservation, overlapsDates } from '../../../../features/booking/reservationFilters';
import ReservationCalendar from '../../../../features/booking/ReservationCalendar';
import ReservationReviewPanel, { GuestNotification } from '../../../../features/booking/ReservationReviewPanel';
import '../../../../features/studio/editor.css';
import '../site/site-editor.css';

type Tab = 'reply' | 'upcoming' | 'past' | 'all' | 'waitlist';
const LABEL: Record<ReservationStatus, string> = {
  requested: 'Waiting for you', confirmed: 'Confirmed', declined: 'Declined', cancelled: 'Cancelled',
  waiting: 'On the waitlist', notified: 'Told it may be free', removed: 'Removed'
};

const dayName = (date: string, today: string) => {
  const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const long = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return diff === 0 ? `Today · ${long}` : diff === 1 ? `Tomorrow · ${long}` : long;
};
const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const isStay = (r: Reservation) => r.kind === 'stay';
const isEvent = (r: Reservation) => r.kind === 'event';
/** Tables, rooms or events: the inbox's filter. */
type Kind = 'tables' | 'rooms' | 'events';
/** Book now on a hotspot in the tour (kind 'request'): a room, a hall or a table, with nothing else set up. */
const asked = (r: Reservation, of: 'room' | 'hall' | 'table') => r.kind === 'request' && r.of === of;
/** Held by the night (a stay, or a room asked for from the tour); by the part of a day (an event, or a hall asked for). */
const nightly = (r: Reservation) => isStay(r) || asked(r, 'room');
const eventish = (r: Reservation) => isEvent(r) || asked(r, 'hall');
const kindOf = (r: Reservation): Kind => (nightly(r) ? 'rooms' : eventish(r) ? 'events' : 'tables');
const SESSION: Record<string, string> = { day: 'Daytime', evening: 'Evening', full: 'Whole day' };

/**
 * Mark a room, hall or table booked (2026-10-26; tables 2026-10-27): visitors then see it
 * taken in the tour and on the website. Cancel on its row frees it again.
 */
function MarkBooked({ id, hotspots, stays, events, today, onMarked }: {
  id: string; hotspots: BookableHotspot[]; stays: SiteStays | null; events: SiteEvents | null; today: string; onMarked: () => void;
}) {
  // every room, hall and table that can be marked: `h:<space>:<hotspot>`, `hall:<id>`, `room:<id>`
  const options = [
    ...hotspots.map((h) => ({ key: `h:${h.space}:${h.hotspot}`, of: h.of, label: `${h.label} (${h.of} in the tour, ${h.spaceTitle})` })),
    ...(events?.halls ?? []).map((h) => ({ key: `hall:${h.id}`, of: 'hall' as const, label: `${h.label} (hall on the website)` })),
    ...(stays?.rooms ?? []).map((r) => ({ key: `room:${r.id}`, of: 'room' as const, label: `${r.label} (room type on the website)` }))
  ];
  const [key, setKey] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState('');
  const [session, setSession] = useState<EventSession>('full');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const pick = options.find((o) => o.key === key) ?? options[0];
  // a table: the sittings it is still free at that day, from the tour's own table times
  const [space, spot] = pick?.of === 'table' ? pick.key.split(':').slice(1) : [];
  const [times, setTimes] = useState<string[]>([]);
  const [time, setTime] = useState('');
  useEffect(() => {
    if (!space || !spot || !from) return;
    let live = true;
    getHereTables(id, space, from).then((a) => {
      if (!live) return;
      const t = a?.date === from ? a.slots.filter((s) => s.free.includes(spot)).map((s) => s.time) : [];
      setTimes(t);
      setTime((x) => (t.includes(x) ? x : t[0] ?? ''));
    }).catch(() => { if (live) setTimes([]); });
    return () => { live = false; };
  }, [id, space, spot, from]);
  if (!pick) return null;
  const send = async () => {
    const [k, a, b] = pick.key.split(':');
    const where = k === 'h' ? { space: a, hotspot: b } : k === 'hall' ? { hall: a } : { room: a };
    const when = pick.of === 'room' ? { checkin: from, checkout: to } : pick.of === 'table' ? { date: from, time } : { date: from, session };
    setBusy(true);
    setMsg('');
    try {
      await markBooked(id, { ...where, ...when, note });
      setMsg(`Marked: visitors now see ${pick.of === 'room' ? 'those nights' : pick.of === 'table' ? 'that table at that time' : 'that day'} taken.`);
      if (pick.of === 'table') setTimes((t) => t.filter((x) => x !== time));
      setNote('');
      onMarked();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="se-card">
      <h2>Block availability</h2>
      <p className="se-hint">Use this for a phone booking, walk-in or commitment recorded elsewhere. This creates an availability block without guest details or a notification. For an incoming request, use Review reservation and confirm it there.</p>
      <label className="se-field"><span>Room, hall or table</span>
        <select value={pick.key} onChange={(e) => setKey(e.target.value)}>{options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
      </label>
      <div className="se-row">
        <label className="se-field"><span>{pick.of === 'room' ? 'First night' : 'Day'}</span>
          <input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} /></label>
        {pick.of === 'room' ? (
          <label className="se-field"><span>Free again on</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        ) : pick.of === 'table' ? (
          <label className="se-field"><span>Time</span>
            <select value={time} disabled={!times.length} onChange={(e) => setTime(e.target.value)}>
              {times.length ? times.map((t) => <option key={t} value={t}>{t}</option>) : <option value="">No free times that day</option>}
            </select>
          </label>
        ) : (
          <label className="se-field"><span>Part of the day</span>
            <select value={session} onChange={(e) => setSession(e.target.value as EventSession)}>
              {Object.entries(SESSION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        )}
      </div>
      <label className="se-field"><span>Note <em>only you see it</em></span><input value={note} maxLength={120} placeholder="e.g. Sharma wedding, booked by phone" onChange={(e) => setNote(e.target.value)} /></label>
      <button className="se-main" disabled={busy || !from || (pick.of === 'room' && !(to > from)) || (pick.of === 'table' && !time)} onClick={send}>Block availability</button>
      {msg && <p className="se-hint" role="status">{msg}</p>}
    </section>
  );
}

/**
 * A place's bookings (/studio/<project>/reservations): tables, picked on
 * its website's floor plan, rooms, listed on the day guests arrive, and
 * events, listed on their day. New
 * ones wait for a reply: Confirm or Decline (the guest is emailed, if they
 * left an address). Checks for new ones every 30 seconds while it's open.
 */
export default function ReservationsPage({ params }: { params: Promise<{ property: string }> }) {
  const { property: id } = use(params);
  const ok = useStudioSession(`/studio/${id}/reservations`);
  const [title, setTitle] = useState('');
  const [list, setList] = useState<Reservation[] | null>(null);
  const [booking, setBooking] = useState<SiteBooking | null>(null);
  const [stays, setStays] = useState<SiteStays | null>(null);
  const [events, setEvents] = useState<SiteEvents | null>(null);
  const [hotspots, setHotspots] = useState<BookableHotspot[]>([]);
  const [today, setToday] = useState('');
  const [tab, setTab] = useState<Tab>('reply');
  const [kind, setKind] = useState<'all' | Kind>('all');
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [staff, setStaff] = useState(false); // the client's staff: no setup to go to
  const [booksOff, setBooksOff] = useState(false); // the project switched bookings off (its home)
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reviewId, setReviewId] = useState<string | null>(null);

  const load = useCallback(() => getReservations(id).then((r) => {
    if (!r) return;
    setList(r.reservations);
    setBooking(r.booking);
    setStays(r.stays);
    setEvents(r.events ?? null);
    setHotspots(r.hotspots ?? []);
    setToday(r.today);
  }).catch((e: Error) => setError(e.message)), [id]);

  useEffect(() => {
    if (!ok) return;
    getProperty(id).then((p) => { if (p) { setTitle(p.theme?.brand || p.title); setStaff(p.access === 'staff'); setBooksOff(p.features?.reservations === false); } }).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [ok, id, load]);

  if (!ok) return <div className="ed2-boot">Opening the studio…</div>;
  if (!list) return <div className="ed2-boot">{error || 'Loading reservations…'}</div>;

  // A stay is upcoming until its guests have left.
  const upcoming = (r: Reservation) => (nightly(r) ? (r.checkout ?? r.date) > today : r.date >= today);
  // The waitlist has its own tab; the other tabs are bookings.
  const waitlist = list.filter((r) => r.kind === 'wait' && (r.of === 'room' ? (r.checkout ?? r.date) > today : r.date >= today));
  const bookings = list.filter((r) => r.kind !== 'wait');
  const kinds = [...new Set(bookings.map(kindOf))];
  const both = kinds.length > 1;
  const ofKind = bookings.filter((r) => kind === 'all' || kindOf(r) === kind);
  const waiting = ofKind.filter((r) => r.status === 'requested' && upcoming(r));
  const stillWaiting = waitlist.filter((r) => r.status === 'waiting').length;
  const tabRecords = (tab === 'waitlist' ? waitlist.filter((r) => r.status !== 'removed')
    : tab === 'reply' ? waiting
    : tab === 'upcoming' ? ofKind.filter((r) => upcoming(r) && ['requested', 'confirmed'].includes(r.status))
      : tab === 'past' ? ofKind.filter((r) => !upcoming(r)).reverse()
        : ofKind);

  const set = async (r: Reservation, status: ReservationStatus) => {
    setBusy(r.id);
    setError('');
    try {
      const next = await setReservationStatus(id, r.id, status, r.status);
      if (!next) throw new Error('The reservation update was not returned. Refresh before trying again.');
      if (next) setList((l) => l && l.map((x) => (x.id === r.id ? next : x)));
      if (next?.waitlistTold) { setError(''); load(); window.alert(`${next.waitlistTold} ${next.waitlistTold === 1 ? 'guest' : 'guests'} on the waitlist can now book, and ${next.waitlistTold === 1 ? 'has' : 'have'} been told.`); }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  };
  // a table at one of the site's other dining places says which
  const tableName = (r: Reservation) => {
    const table = r.tableLabel || (r.outlet ? '' : booking?.tables.find((t) => t.id === r.table)?.label) || r.table;
    return r.outletName ? `${r.outletName} · ${table}` : table;
  };
  const roomName = (r: Reservation) => {
    const name = r.roomLabel || stays?.rooms.find((x) => x.id === r.room)?.label || r.room || 'Room';
    return (r.rooms ?? 1) > 1 ? `${r.rooms} × ${name}` : name;
  };
  const hallName = (r: Reservation) => r.hallLabel || events?.halls.find((h) => h.id === r.hall)?.label || r.hall || 'Hall';
  const matching = tabRecords.filter((r) => matchesReservation(r, query,
    nightly(r) || (r.kind === 'wait' && r.of === 'room') ? roomName(r) : eventish(r) ? hallName(r) : tableName(r)));
  const invalidDates = Boolean(fromDate && toDate && fromDate > toDate);
  const visibleMonth = month || today.slice(0, 7);
  const shown = matching.filter((r) => view === 'calendar'
    ? selectedDay ? overlapsDates(r, selectedDay, selectedDay) : (r.date.slice(0, 7) === visibleMonth || overlapsDates(r, `${visibleMonth}-01`, `${visibleMonth}-31`))
    : overlapsDates(r, fromDate, toDate));
  const days = [...new Set(shown.map((r) => r.date))].sort((a, b) => tab === 'past' ? b.localeCompare(a) : a.localeCompare(b));
  const filtered = Boolean(query.trim() || (view === 'list' && (fromDate || toDate)) || view === 'calendar');
  // What a day adds up to: guests at tables, rooms for guests arriving, and events.
  const dayTotal = (d: string) => {
    const live = shown.filter((r) => r.date === d && r.status !== 'declined' && r.status !== 'cancelled');
    const guests = live.filter((r) => kindOf(r) === 'tables').reduce((a, r) => a + r.party, 0);
    // the tour's room and hall hotspots too, guests' and the team's marks alike
    const rooms = live.filter(nightly).reduce((a, r) => a + (r.rooms ?? 1), 0);
    const evts = live.filter(eventish).length;
    return [guests && `${guests} ${guests === 1 ? 'guest' : 'guests'} at tables`, rooms && `${rooms} ${rooms === 1 ? 'room' : 'rooms'} for arrivals`,
      evts && `${evts} ${evts === 1 ? 'event' : 'events'}`]
      .filter(Boolean).join(' · ') || 'Nothing booked or waiting';
  };

  return (
    <div className="ed2 se">
      <header className="se-bar">
        {/* plain <a>: the studio holds a page-singleton renderer and wants a full load */}
        <a href={staff ? '/studio' : `/studio/${encodeURIComponent(id)}`} className="se-back">{staff ? '← Projects' : '← Project'}</a>
        <div className="se-title"><b>Reservations</b><span>{title}</span></div>
        {error && <span className="se-err" role="alert">{error}</span>}
        <button onClick={load}>Refresh</button>
        {!staff && <a className="se-open" href={`/studio/${encodeURIComponent(id)}/site`}>Booking setup</a>}
      </header>

      <main className="se-body">
        {booksOff && (
          <div className="se-note" role="note"><p>Bookings are off for this project: its tours and website take none. Anything asked before is still below.</p></div>
        )}
        {!booksOff && !booking?.on && !stays?.on && !events?.on && !list.some((r) => r.kind === 'request') && (
          <div className="se-note" role="note">
            {staff ? (
              <p>Online booking isn’t switched on for this place yet. Whoever runs its website can turn it on.</p>
            ) : (
              <>
                <p>Website booking is off. Book now on the tour’s room, hall and table hotspots still sends its requests here.</p>
                <p className="se-note-go">
                  To take bookings on the website too, set one up and publish:
                  {([['table-booking', 'Tables'], ['room-booking', 'Rooms'], ['event-booking', 'Events']] as const).map(([k, l]) => (
                    <a key={k} href={`/studio/${encodeURIComponent(id)}/site#se-${k}`}>{l}</a>
                  ))}
                </p>
              </>
            )}
          </div>
        )}
        {!booksOff && <details className="rs-manual-block"><summary>Block availability for an external booking</summary>
          <MarkBooked id={id} hotspots={hotspots} stays={stays} events={events} today={today} onMarked={load} />
        </details>}
        <div className="rs-tabs" role="tablist">
          {([['reply', `Needs a reply${waiting.length ? ` (${waiting.length})` : ''}`], ['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All'], ['waitlist', `Waitlist${stillWaiting ? ` (${stillWaiting})` : ''}`]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
          {both && tab !== 'waitlist' && (
            <span className="rs-kinds">
              {([['all', 'All'], ['tables', 'Tables'], ['rooms', 'Rooms'], ['events', 'Events']] as const).filter(([k]) => k === 'all' || kinds.includes(k)).map(([k, label]) => (
                <button key={k} aria-pressed={kind === k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>{label}</button>
              ))}
            </span>
          )}
        </div>

        <section className="se-card" aria-label="Find reservations">
          <label className="se-field"><span>Search reservations</span>
            <input type="search" value={query} placeholder="Guest, phone, email, reference or room" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="rs-filter-bar">
            <div className="rs-tabs" role="group" aria-label="Reservation view">
              <button aria-pressed={view === 'list'} className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')}>List</button>
              <button aria-pressed={view === 'calendar'} className={view === 'calendar' ? 'is-on' : ''} onClick={() => setView('calendar')}>Calendar</button>
            </div>
            <button onClick={() => { setQuery(''); setFromDate(''); setToDate(''); setSelectedDay(''); }}>Clear filters</button>
          </div>
          {view === 'list' && <>
            <div className="rs-date-filters">
              <label className="se-field"><span>From date</span><input type="date" value={fromDate} aria-invalid={invalidDates} aria-describedby="rs-date-help" onChange={(e) => setFromDate(e.target.value)} /></label>
              <label className="se-field"><span>Through date</span><input type="date" value={toDate} min={fromDate || undefined} aria-invalid={invalidDates} aria-describedby="rs-date-help" onChange={(e) => setToDate(e.target.value)} /></label>
            </div>
            <p id="rs-date-help" className="se-hint">{invalidDates ? 'Choose an end date on or after the start date.' : 'Includes room stays occupying any night in this range; checkout day is excluded.'}</p>
          </>}
        </section>
        {view === 'calendar' && visibleMonth && <ReservationCalendar month={visibleMonth} today={today} reservations={matching}
          selected={selectedDay} onMonth={(value) => { setMonth(value); setSelectedDay(''); }} onSelect={setSelectedDay} />}
        <p className="se-hint" role="status">{shown.length} {shown.length === 1 ? 'record' : 'records'} shown{view === 'calendar' && selectedDay ? ` for ${shortDay(selectedDay)}` : ''} in this tab.
          {view === 'calendar' && selectedDay && <> <button onClick={() => setSelectedDay('')}>Show whole month</button></>}
        </p>

        {!shown.length && (
          <p className="se-hint">{filtered ? 'No reservations match these filters in this tab. Try another date, search or tab.' : tab === 'reply' ? 'Nothing waiting. New requests from the website and the 3D tour appear here.'
            : tab === 'waitlist' ? 'No one is waiting. When a day or dates are full, guests can join the waitlist; if you decline or cancel a booking, the ones who now fit are told by text and email.'
              : 'No bookings here.'}</p>
        )}

        {days.map((d) => (
          <section key={d} className="se-card">
            <h2>{dayName(d, today)}</h2>
            <p className="se-hint">{dayTotal(d)}</p>
            {shown.filter((r) => r.date === d).map((r) => r.kind === 'wait' ? (
              <div key={r.id} className={`rs-item is-${r.status}`}>
                <div className="rs-when">
                  <b>{r.of === 'room' ? `${r.nights} ${r.nights === 1 ? 'night' : 'nights'}` : r.time || 'Any time'}</b>
                  <span>{r.party} {r.party === 1 ? 'guest' : 'guests'}</span>
                </div>
                <div className="rs-who">
                  <b>{r.name}</b> <span className="rs-table">{r.of === 'room' ? r.roomLabel || 'Any room' : 'A table'}</span>
                  <p className="se-hint">Reference: {r.id}</p>
                  {r.of === 'room' && <p className="rs-stay">{shortDay(r.date)} → {shortDay(r.checkout ?? r.date)}</p>}
                  <div className="rs-contact">
                    <a href={`tel:${r.phone}`}>{r.phone}</a>
                    {r.email && <a href={`mailto:${r.email}`}>{r.email}</a>}
                  </div>
                  {r.notifiedAt && <p className="se-hint">Told {new Date(r.notifiedAt).toLocaleString()}</p>}
                </div>
                <div className="rs-act">
                  <span className={`rs-status is-${r.status}`}>{LABEL[r.status]}</span>
                  <button disabled={busy === r.id} onClick={() => set(r, 'notified')}>{r.status === 'notified' ? 'Tell again' : 'Tell them it’s free'}</button>
                  <button disabled={busy === r.id} onClick={() => set(r, 'removed')}>Remove</button>
                </div>
              </div>
            ) : (
              <div key={r.id} className={`rs-item is-${r.status}`}>
                {nightly(r) ? (
                  <div className="rs-when"><b>{r.nights} {r.nights === 1 ? 'night' : 'nights'}</b><span>{r.blocked ? 'marked' : `${r.party} ${r.party === 1 ? 'guest' : 'guests'}`}</span></div>
                ) : eventish(r) ? (
                  <div className="rs-when"><b>{SESSION[r.session ?? ''] ?? r.session}</b><span>{r.blocked ? 'marked' : `${r.party} guests`}</span></div>
                ) : (
                  <div className="rs-when"><b>{r.time}</b><span>{r.blocked ? 'marked' : `${r.party} ${r.party === 1 ? 'guest' : 'guests'}`}</span></div>
                )}
                <div className="rs-who">
                  <b>{r.name}</b> <span className="rs-table">{r.kind === 'request' ? [r.item, r.occasion].filter(Boolean).join(' · ')
                    : isStay(r) ? roomName(r) : isEvent(r) ? `${r.occasion} · ${hallName(r)}` : tableName(r)}</span>
                  {nightly(r) && <p className="rs-stay">{shortDay(r.checkin ?? r.date)} → {shortDay(r.checkout ?? r.date)}</p>}
                  {r.kind === 'request' && !r.blocked && (
                    <p className="se-hint">{[`Book now in the tour (${r.spaceTitle})`, r.price, r.deposit && `deposit ${r.deposit}`].filter(Boolean).join(' · ')}</p>
                  )}
                  {r.blocked ? <p className="se-hint">Marked booked by the team: no guest to reach.</p> : (
                    <div className="rs-contact">
                      {r.phone && <a href={`tel:${r.phone}`}>{r.phone}</a>}
                      {r.email && <a href={`mailto:${r.email}`}>{r.email}</a>}
                    </div>
                  )}
                  {r.notes && <p className="rs-notes">“{r.notes}”</p>}
                  <p className="se-hint">Reference: {r.id}</p>
                  {r.attachment && (
                    <p className="se-hint">
                      Event plan: <a href={bookingPlanUrl(id, r.id)}>{r.attachment.name}</a> ({Math.max(1, Math.round(r.attachment.bytes / 1024))} KB)
                    </p>
                  )}
                  {r.delivery && !r.delivery.sent && <p className="se-hint">Not emailed to you: {r.delivery.reason}</p>}
                  <GuestNotification reservation={r} />
                </div>
                <div className="rs-act">
                  <span className={`rs-status is-${r.status}`}>{LABEL[r.status]}</span>
                  {r.status === 'requested' && (
                    <>
                      <button className="se-main" disabled={!!busy} onClick={() => setReviewId(r.id)}>Review reservation</button>
                    </>
                  )}
                  {r.status !== 'requested' && !r.blocked && <button disabled={!!busy} onClick={() => setReviewId(r.id)}>View reservation &amp; plan</button>}
                  {r.status === 'confirmed' && <button disabled={busy === r.id} onClick={() => set(r, 'cancelled')}>{r.blocked ? 'Remove the mark' : 'Cancel'}</button>}
                  {(r.status === 'declined' || r.status === 'cancelled') && upcoming(r) && (
                    <button disabled={busy === r.id} onClick={() => set(r, 'requested')}>Reopen</button>
                  )}
                </div>
              </div>
            ))}
          </section>
        ))}
      </main>
      {reviewId && list.find((r) => r.id === reviewId) && <ReservationReviewPanel key={reviewId} project={id}
        reservation={list.find((r) => r.id === reviewId)!} busy={!!busy} onClose={() => setReviewId(null)} onDecision={set} onRefresh={load} />}
    </div>
  );
}
