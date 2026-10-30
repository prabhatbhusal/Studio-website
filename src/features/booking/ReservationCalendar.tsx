'use client';

import type { Reservation } from '../../lib/api';
import { monthDays, overlapsDates, shiftMonth } from './reservationFilters';

export default function ReservationCalendar({ month, today, reservations, selected, onMonth, onSelect }: {
  month: string; today: string; reservations: Reservation[]; selected: string;
  onMonth: (month: string) => void; onSelect: (date: string) => void;
}) {
  const title = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return <section className="se-card rs-calendar" aria-label="Reservation calendar">
    <div className="rs-calendar-bar">
      <h2>{title}</h2>
      <div>
        <button aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}>Previous</button>
        <button onClick={() => { onMonth(today.slice(0, 7)); onSelect(today); }}>Today</button>
        <button aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}>Next</button>
      </div>
    </div>
    <p className="se-hint">Counts follow your tab and search. Rooms appear on each occupied night, excluding checkout. Select a day to see its records below. Counts are reservations, not available capacity.</p>
    <div className="rs-calendar-grid">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span className="rs-weekday" key={day}>{day}</span>)}
      {monthDays(month).map((date, index) => {
        if (!date) return <span key={`empty-${index}`} />;
        const count = reservations.filter((r) => overlapsDates(r, date, date)).length;
        return <button key={date} className={`rs-calendar-day${date === today ? ' is-today' : ''}`}
          aria-label={`${date}: ${count} ${count === 1 ? 'reservation' : 'reservations'}`}
          aria-pressed={selected === date} onClick={() => onSelect(date)}>
          <span>{Number(date.slice(-2))}</span><strong>{count || '–'}</strong>
        </button>;
      })}
    </div>
  </section>;
}
