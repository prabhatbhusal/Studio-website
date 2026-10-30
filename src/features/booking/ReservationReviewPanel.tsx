'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL, getReservationReview, type Reservation, type ReservationReview, type ReservationStatus } from '../../lib/api';

export function GuestNotification({ reservation: r }: { reservation: Reservation }) {
  if (r.blocked || !['confirmed', 'declined'].includes(r.status)) return null;
  const d = r.guestDelivery;
  if (!d || d.pending || (d.status && d.status !== r.status)) return <p className="se-hint" role="status">Guest notification is not yet verified. Refresh to check, or contact the guest directly.</p>;
  const channels = [d.sent && 'email', d.sms?.sent && 'SMS', d.whatsapp?.sent && 'WhatsApp'].filter(Boolean);
  return <p className="se-hint" role="status">{channels.length
    ? `Notification sent via ${channels.join(', ')}. This does not confirm the guest has read it.`
    : 'Guest notification was not sent. Please call or email the guest directly.'}</p>;
}

export default function ReservationReviewPanel({ project, reservation: r, busy, onClose, onDecision, onRefresh }: {
  project: string; reservation: Reservation; busy: boolean; onClose: () => void;
  onDecision: (r: Reservation, status: ReservationStatus) => Promise<boolean>; onRefresh: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ReservationReview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [decision, setDecision] = useState<'confirmed' | 'declined' | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(''); setImageFailed(false);
    try { const result = await getReservationReview(project, r.id); if (!result) throw new Error('Reservation review is unavailable.'); setData(result); }
    catch (e) { setData(null); setError((e as Error).message); }
    finally { setLoading(false); }
  }, [project, r.id]);
  useEffect(() => { void load(); }, [load, r.status]);
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  const apply = async () => {
    if (!decision) return;
    if (await onDecision(r, decision)) setDecision(null);
    else { setError('The reservation was not changed. Refresh and review its current status.'); void load(); }
  };
  return <dialog ref={dialog} className="rs-review" aria-labelledby="rs-review-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="rs-review-head"><div><h2 id="rs-review-title">Review reservation</h2><p>{r.name} · {r.id}</p></div><button disabled={busy} onClick={onClose} autoFocus>Close</button></div>
    <p><strong>{r.item || r.roomLabel || r.hallLabel || r.tableLabel || 'Requested space'}</strong> · {r.party} guests</p>
    <p>{r.checkin || r.date}{r.checkout ? ` to ${r.checkout} (checkout)` : ''}{r.time ? ` · ${r.time}` : ''}{r.session ? ` · ${r.session}` : ''}</p>
    <div className="rs-contact">{r.phone && <a href={`tel:${r.phone}`}>Call {r.phone}</a>}{r.email && <a href={`mailto:${r.email}`}>Email {r.email}</a>}</div>
    {r.notes && <p>{r.notes}</p>}
    <button disabled={loading || busy} onClick={() => { void load(); onRefresh(); }}>Refresh availability</button>
    {loading && <p role="status">Checking this reservation’s dates and space…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && data && <>
      <p className={`rs-review-availability ${data.available === false ? 'is-unavailable' : ''}`}>
        {data.available === true ? 'Available in this platform for this request.' : data.available === false ? 'Unavailable or conflicting booking configuration. Do not confirm.' : 'Availability could not be verified. Check with the venue before deciding.'}
      </p>
      <p className="se-hint">The reservation’s own hold is excluded. Checked {new Date(data.checkedAt).toLocaleTimeString()}. Availability is checked again when confirming.</p>
      {data.plan && !imageFailed ? <div className="rs-review-plan">
        {/* eslint-disable-next-line @next/next/no-img-element -- venue floor plan at its native aspect ratio */}
        <img src={`${API_BASE_URL}/api/assets/${data.plan}`} alt="Floor plan for this reservation" onError={() => setImageFailed(true)} />
        {data.markers.map((m) => <span key={m.id} className={`rs-plan-pin${m.selected ? ' is-selected' : ''}${!m.available ? ' is-taken' : ''}`}
          style={{ left: `${Math.max(0, Math.min(1, m.x)) * 100}%`, top: `${Math.max(0, Math.min(1, m.y)) * 100}%` }}
          title={`${m.label}: ${m.selected ? 'requested, ' : ''}${m.available ? 'available' : 'unavailable'}`}>
          {m.selected ? '★ ' : ''}{m.label}{!m.available ? ' · Taken' : ''}
        </span>)}
      </div> : <p className="se-hint">{imageFailed ? 'The floor-plan image could not be loaded.' : 'No floor plan is linked to this space yet.'} You can still review the request and contact the guest.</p>}
      <p className="se-hint">{data.note} {data.markers.length > 0 && '★ marks the requested resource. Pins are for reference, not reassignment.'}</p>
    </>}
    <GuestNotification reservation={r} />
    {r.status === 'requested' && !r.blocked && <div className="rs-review-decision">
      {!decision ? <>
        <button className="se-main" disabled={busy || loading || data?.available !== true} onClick={() => setDecision('confirmed')}>Confirm booking</button>
        <button disabled={busy} onClick={() => setDecision('declined')}>Decline request</button>
      </> : <>
        <p>{decision === 'confirmed' ? 'Confirm this reservation and reserve its space?' : 'Decline this request and release its hold?' } The guest will be notified through configured email and messaging services. Check the delivery result afterwards.</p>
        <button className="se-main" disabled={busy || (decision === 'confirmed' && (loading || data?.available !== true))} onClick={apply}>{busy ? 'Saving…' : decision === 'confirmed' ? 'Confirm and notify guest' : 'Decline and notify guest'}</button>
        <button disabled={busy} onClick={() => setDecision(null)}>Go back</button>
      </>}
    </div>}
    {r.status !== 'requested' && <p>Status: <strong>{r.status}</strong></p>}
  </dialog>;
}
