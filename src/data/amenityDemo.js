// Sample amenities + bookings for demo mode. Dates sit around the demo
// "today" (2026-07-15) so the office sees live pending requests and upcoming
// confirmed holds. Fictional.
export const DEMO_AMENITIES = [
  { id: 'am1', building: 'Halsey Commons', name: 'Conference room', description: 'Ground-floor shared conference room, seats 12. Screen + whiteboard.', capacity: 12, hours: '8:00a–6:00p', requiresApproval: true, active: true },
  { id: 'am2', building: 'Halsey Commons', name: 'Roof terrace', description: 'Rooftop terrace for tenant events (after-hours by request).', capacity: 40, hours: '7:00a–9:00p', requiresApproval: true, active: true },
  { id: 'am3', building: 'Parkview Lofts', name: 'Community room', description: 'Ground-floor lounge with kitchenette — good for small gatherings.', capacity: 20, hours: '9:00a–10:00p', requiresApproval: true, active: true },
  { id: 'am4', building: 'Parkview Lofts', name: 'Laundry room', description: 'Card-operated shared laundry, first come first served.', capacity: null, hours: '6:00a–10:00p', requiresApproval: false, active: true },
];

export const DEMO_BOOKINGS = [
  { id: 'bk1', amenityId: 'am1', bookedBy: 'Northline Design Co', building: 'Halsey Commons', unit: '102', date: '2026-07-18', startTime: '10:00', endTime: '11:30', status: 'confirmed', notes: 'Client presentation.' },
  { id: 'bk2', amenityId: 'am1', bookedBy: 'Verdant Health PT', building: 'Halsey Commons', unit: '201', date: '2026-07-21', startTime: '14:00', endTime: '15:00', status: 'pending', notes: 'Staff training.' },
  { id: 'bk3', amenityId: 'am2', bookedBy: 'Basin & Co Coffee', building: 'Halsey Commons', unit: '101', date: '2026-07-25', startTime: '17:30', endTime: '20:00', status: 'pending', notes: 'Customer appreciation evening.' },
  { id: 'bk4', amenityId: 'am3', bookedBy: 'Priya Nadeem', building: 'Parkview Lofts', unit: '1B', date: '2026-07-19', startTime: '18:00', endTime: '21:00', status: 'confirmed', notes: 'Birthday gathering.' },
];
