// Sample building handbooks for demo mode — one commercial (Halsey Commons),
// one residential (Parkview Lofts). Content is illustrative, fictional.
const S = (icon, title, body) => ({ id: `hb_${title.toLowerCase().replace(/\W+/g, '_')}`, icon, title, body });

export const DEMO_HANDBOOKS = [
  {
    building: 'Halsey Commons',
    sections: [
      S('👋', 'Welcome', 'Welcome to Halsey Commons — a two-story mixed-commercial building at 48 Halsey St. This handbook covers building access, policies, emergency procedures, and how to reach the management office. Keep it handy; it’s updated as things change.'),
      S('📞', 'Key contacts', 'Management office: Mon–Fri 8:30a–5:00p, (585) 555-0100.\nMaintenance / after-hours emergency: (585) 555-0199.\nFor a non-urgent repair, submit a request through your Caliper tenant link — it’s the fastest way to get it tracked.'),
      S('🚨', 'Emergency & safety', 'Fire: pull the nearest alarm, exit via the marked stairwells (never the elevator), and meet at the north parking lot.\nMedical: call 911, then notify the office.\nUtility shut-offs: main water and gas are in the ground-floor mechanical room (staff access).\nExtinguishers are at each stairwell landing; AED is in the first-floor lobby.'),
      S('🔑', 'Building access & hours', 'Common areas are open 7:00a–7:00p on weekdays. After-hours entry is by fob only — request additional fobs through the office. Do not prop exterior doors; they lock automatically for everyone’s security.'),
      S('📋', 'Building policies', 'Deliveries: use the Halsey St entrance; oversized deliveries by appointment.\nSignage: exterior and window signage must be approved by management.\nCommon areas: keep hallways and stairwells clear at all times (fire code).\nInsurance: tenants must keep a current certificate of insurance on file naming ownership as additional insured.'),
      S('🅿️', 'Parking', 'Assigned surface spaces are noted on your lease. Visitor spaces are marked along the east row. Overnight parking requires office notice. Snow is cleared by 7:00a after any storm.'),
      S('🔧', 'Repairs & requests', 'Report anything — a flickering hallway light, a warm suite, a leak — through your tenant link. Emergencies (flooding, no heat, security) should also get a call to the after-hours line. You’ll see each request move from received to scheduled to done.'),
      S('♻️', 'Trash & recycling', 'Trash and recycling dumpsters are in the enclosed east corral. Pickup is Tuesday and Friday mornings. Break down boxes; no bulk items in the dumpster — arrange bulk removal through the office.'),
    ],
  },
  {
    building: 'Parkview Lofts',
    sections: [
      S('👋', 'Welcome', 'Welcome home to Parkview Lofts. This handbook has the essentials — who to call, house rules, and what to do in an emergency. We’re glad you’re here.'),
      S('📞', 'Key contacts', 'Management: (585) 555-0100, Mon–Fri 9a–5p.\nAfter-hours maintenance emergency: (585) 555-0199.\nReport repairs any time through your Caliper resident link.'),
      S('🚨', 'Emergency & safety', 'Fire: exit via the front or rear stairs and meet across Park Ave. Test your smoke detector monthly.\nGas smell: leave immediately, then call 911 and the office.\nWater shut-off for your unit is under the kitchen sink; the building main is in the basement.'),
      S('📋', 'House rules', 'Quiet hours are 10:00p–8:00a. Guests are welcome; overnight guests longer than two weeks need office notice. Pets per your lease; always leashed in common areas and cleaned up after.'),
      S('🧺', 'Amenities', 'Shared laundry is on the ground floor (card-operated), open 6:00a–10:00p. The ground-floor café is open to residents during business hours.'),
      S('🔧', 'Repairs & requests', 'Submit a repair with a photo through your resident link and follow it to done. For no-heat, flooding, or a lockout, also call the after-hours line.'),
      S('♻️', 'Trash & recycling', 'Chute is on each floor for household trash. Recycling and cardboard go in the blue bins by the rear door. Pickup is Wednesday.'),
    ],
  },
];
