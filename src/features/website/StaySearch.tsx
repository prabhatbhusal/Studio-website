'use client';

import { useEffect, useState } from 'react';
import { getVenueClock, type SiteStays } from '../../lib/api';
import { nightsBetween } from '../booking/booking';

/** A shortcut to the existing booking desk, not a second reservation form. */
export function StaySearch({ project, stays }: { project: string; stays: SiteStays }) {
  const [today, setToday] = useState('');
  const [checkin, setCheckin] = useState('');
  const [checkout, setCheckout] = useState('');
  const [guests, setGuests] = useState(Math.min(2, stays.maxGuests));
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    getVenueClock(project, 'stay').then(c => { if (live && c) setToday(c.today); }).catch(() => {});
    return () => { live = false; };
  }, [project]);
  return <form className="ws-stay-search" aria-label="Find a room" onSubmit={(e) => {
    e.preventDefault();
    const nights = nightsBetween(checkin, checkout);
    if (!today) return setError('The venue’s date could not be checked. Use the booking calendar below.');
    if (checkin < today || !(nights >= stays.minNights && nights <= stays.maxNights)) return setError(`Choose a stay starting today or later, of ${stays.minNights} to ${stays.maxNights} nights.`);
    setError('');
    window.dispatchEvent(new CustomEvent('rcaas:stay-search', { detail: { project, checkin, checkout, guests } }));
    if (location.hash === '#stay') window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = 'stay';
  }}>
    <label><span>Check-in</span><input type="date" required min={today || undefined} value={checkin} onChange={e => setCheckin(e.target.value)} /></label>
    <label><span>Check-out</span><input type="date" required min={checkin || today || undefined} value={checkout} onChange={e => setCheckout(e.target.value)} /></label>
    <label><span>Guests</span><input type="number" required min={1} max={stays.maxGuests} value={guests} onChange={e => setGuests(Number(e.target.value))} /></label>
    <button className="ws-btn" type="submit">Find a room</button>
    {error && <p role="alert">{error} <a href="#stay">Open booking calendar</a></p>}
  </form>;
}
