import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesReservation, overlapsDates, monthDays, shiftMonth } from '../src/features/booking/reservationFilters.ts';

test('room calendar includes occupied nights across months, never checkout', () => {
  for (const record of [
    { kind: 'stay' }, { kind: 'request', of: 'room' }, { kind: 'wait', of: 'room' }
  ]) {
    const stay = { ...record, date: '2026-10-30', checkout: '2026-11-03' };
    assert.equal(overlapsDates(stay, '2026-11-01', '2026-11-01'), true);
    assert.equal(overlapsDates(stay, '2026-11-03', '2026-11-03'), false);
    assert.equal(overlapsDates(stay, '', '2026-10-29'), false);
    assert.equal(overlapsDates(stay, '2026-11-02', ''), true);
    assert.equal(overlapsDates(stay, '2026-11-02', '2026-11-01'), false);
  }
});

test('tables and halls belong only to their booked date, inclusive range edges', () => {
  for (const kind of [undefined, 'event', 'request']) {
    const record = { kind, of: 'hall', date: '2026-10-29' };
    assert.equal(overlapsDates(record, '2026-10-29', '2026-10-29'), true);
    assert.equal(overlapsDates(record, '2026-10-30', ''), false);
    assert.equal(overlapsDates(record, '', '2026-10-28'), false);
    assert.equal(overlapsDates(record), true);
  }
});

test('search supports combined guest/resource terms, formatted phones and references', () => {
  const record = { id: 'abc-123', name: 'Sita Sharma', phone: '+977 (980)-1234567', email: 'Sita@example.com', notes: 'Late arrival' };
  assert.equal(matchesReservation(record, 'SHARMA deluxe', 'Deluxe suite'), true);
  assert.equal(matchesReservation(record, '9801234567'), true);
  assert.equal(matchesReservation(record, 'abc-123'), true);
  assert.equal(matchesReservation(record, 'sita@example.com'), true);
  assert.equal(matchesReservation(record, 'Sharma missing'), false);
  assert.equal(matchesReservation(record, '   '), true);
});

test('calendar uses Monday first and handles leap years and year transitions', () => {
  const days = monthDays('2028-02');
  assert.equal(days[0], null);
  assert.equal(days[1], '2028-02-01');
  assert.equal(days.filter(Boolean).length, 29);
  assert.equal(days.length % 7, 0);
  assert.deepEqual(monthDays('2026-13'), []);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2027-01', -1), '2026-12');
});
