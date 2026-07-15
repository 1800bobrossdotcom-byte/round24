// Sample inspections for demo mode — one complete (with a failed item that needs
// follow-up) and one in progress. Fictional; dates near the demo "today".
export const DEMO_INSPECTIONS = [
  {
    id: 'in1', building: 'Parkview Lofts', unit: '2A', title: 'Move-out — Unit 2A', kind: 'move_out',
    status: 'complete', inspector: 'Marco Rossi', date: '2026-07-10',
    items: [
      { label: 'Walls & ceilings', status: 'pass', note: '' },
      { label: 'Floors & carpet', status: 'fail', note: 'Carpet stained in bedroom — replace before move-in.' },
      { label: 'Windows & screens', status: 'pass', note: '' },
      { label: 'Doors & locks', status: 'pass', note: '' },
      { label: 'Kitchen — clean & working', status: 'pass', note: '' },
      { label: 'Bathroom — clean & working', status: 'pass', note: '' },
      { label: 'Plumbing — no leaks', status: 'pass', note: '' },
      { label: 'Trash removed', status: 'pass', note: '' },
      { label: 'Keys returned', status: 'pass', note: '' },
      { label: 'Damage beyond normal wear', status: 'na', note: '' },
    ],
  },
  {
    id: 'in2', building: 'Halsey Commons', unit: 'Common', title: 'Quarterly safety — common areas', kind: 'quarterly',
    status: 'in_progress', inspector: 'Marco Rossi', date: '2026-07-14',
    items: [
      { label: 'Smoke & CO detectors', status: 'pass', note: '' },
      { label: 'Fire extinguishers charged', status: 'pass', note: '' },
      { label: 'Exit routes clear', status: 'pass', note: '' },
      { label: 'Handrails & stairs', status: 'fail', note: 'Loose handrail on 2nd-floor landing.' },
      { label: 'Exterior lighting', status: '', note: '' },
      { label: 'Common-area cleanliness', status: '', note: '' },
      { label: 'Roof / gutters', status: '', note: '' },
      { label: 'Heating system', status: '', note: '' },
      { label: 'Water heater', status: '', note: '' },
      { label: 'No visible leaks', status: '', note: '' },
    ],
  },
];
