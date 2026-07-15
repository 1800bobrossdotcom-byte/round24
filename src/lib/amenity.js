// ============================================================
// Amenity reservations — booking helpers. Pure and dependency-free.
// Times are 'HH:MM' 24h strings; a booking without times is treated as a
// whole-day hold.
// ============================================================

const mins = (t) => {
  if (!t || typeof t !== 'string') return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

// Do two bookings overlap? Same amenity + same date is assumed by the caller.
// Whole-day holds (missing times) conflict with anything else that day.
export function bookingsOverlap(a, b) {
  const as = mins(a.startTime), ae = mins(a.endTime);
  const bs = mins(b.startTime), be = mins(b.endTime);
  if (as == null || ae == null || bs == null || be == null) return true; // a day-hold blocks the day
  return as < be && bs < ae; // half-open intervals
}

// Is a proposed booking free of CONFIRMED conflicts? Pending requests don't
// block — the office decides. Ignores declined/cancelled and itself.
export function isSlotFree(proposed, existing = []) {
  return !existing.some((b) =>
    b.id !== proposed.id &&
    b.amenityId === proposed.amenityId &&
    b.date === proposed.date &&
    b.status === 'confirmed' &&
    bookingsOverlap(proposed, b));
}

// Upcoming bookings for a day/amenity, or the whole org — sorted by date+time.
export function sortBookings(bookings = []) {
  return [...bookings].sort((a, b) => {
    if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
    return (mins(a.startTime) ?? 0) - (mins(b.startTime) ?? 0);
  });
}

// counts for the office dashboard row
export function bookingSummary(bookings = [], today) {
  const t = today || '';
  const upcoming = bookings.filter((b) => (b.date || '') >= t && b.status !== 'declined' && b.status !== 'cancelled');
  return {
    pending: bookings.filter((b) => b.status === 'pending').length,
    confirmedUpcoming: upcoming.filter((b) => b.status === 'confirmed').length,
    upcoming: upcoming.length,
  };
}
