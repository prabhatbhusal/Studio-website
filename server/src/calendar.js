/** Strict YYYY-MM-DD, including leap years; Date.parse alone normalizes bad dates. */
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Count the entire interval; a bounded iterator cannot validate its own cap. */
export function daysBetween(start, end) {
  if (!validDate(start) || !validDate(end)) return NaN;
  return (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000;
}

/** The inbox/project summary follows the first enabled booking service. */
export function bookingTimezone(site) {
  const configs = [site?.booking, site?.stays, site?.events, ...(site?.dining ?? []).map((o) => o.booking)];
  return configs.find((c) => c?.on && c.timezone)?.timezone || site?.booking?.timezone || 'Asia/Kathmandu';
}
