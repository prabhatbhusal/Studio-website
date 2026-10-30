import type { Reservation } from '../../lib/api';

/** Checkout is exclusive: departing guests do not occupy that night. */
export function overlapsDates(r: Reservation, from = '', to = '') {
  if (from && to && from > to) return false;
  const start = r.checkin || r.date;
  const overnight = r.kind === 'stay' || ((r.kind === 'request' || r.kind === 'wait') && r.of === 'room');
  const end = overnight && r.checkout && r.checkout > start ? r.checkout : null;
  return (!to || start <= to) && (!from || (end ? end > from : start >= from));
}

export function matchesReservation(r: Reservation, query: string, resourceLabel = '') {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [r.id, r.name, r.phone, r.email, r.notes, r.item, r.spaceTitle,
    r.roomLabel, r.hallLabel, r.tableLabel, r.outletName, r.occasion, resourceLabel].join(' ').toLocaleLowerCase();
  const digits = (r.phone || '').replace(/\D/g, '');
  return words.every((word) => text.includes(word) || (/^[+\d().-]+$/.test(word) &&
    word.replace(/\D/g, '').length >= 3 && digits.includes(word.replace(/\D/g, ''))));
}

/** UTC arithmetic keeps the venue's date unchanged across browser time zones. */
export function monthDays(month: string): (string | null)[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const first = new Date(`${month}-01T12:00:00Z`);
  const days: (string | null)[] = Array((first.getUTCDay() + 6) % 7).fill(null);
  const cursor = new Date(first);
  while (cursor.toISOString().slice(0, 7) === month) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  while (days.length % 7) days.push(null);
  return days;
}

export function shiftMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
