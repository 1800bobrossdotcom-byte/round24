// ============================================================
// Geofence math for verified clock-in. Standard haversine — no dependency.
// ============================================================

// meters between two lat/lng points
export function distanceM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000; // earth radius, m
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

// check a punch location against a building's fence.
// returns { verified, distance } — verified is null when we can't judge
// (building has no pin, or no punch location).
export function geofenceCheck(buildingLoc, punchLoc, radiusM = 150) {
  if (!buildingLoc || buildingLoc.lat == null || !punchLoc || punchLoc.lat == null) {
    return { verified: null, distance: null };
  }
  const d = distanceM(buildingLoc, punchLoc);
  return { verified: d <= (radiusM || 150), distance: d };
}

// human distance
export function fmtDistance(m) {
  if (m == null) return '';
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// browser geolocation as a promise (short timeout; never throws)
export function getPosition({ timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}
