// Normalize a building name for MATCHING only (never for display). Folds case,
// whitespace, and punctuation so a resident's property label reconciles to the
// building a handbook / amenity was authored against even when the two strings
// drift — e.g. "179-189 St Paul" vs "179-189 St. Paul" vs "179 189 st paul".
export function normBuilding(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
