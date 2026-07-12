// Sample approved-vendor rolodex for demo mode — trusted contractors by trade,
// specialty suppliers, and the products a portfolio reorders. Same normalized
// shape as backend listVendors() / listVendorProducts().
const V = (id, name, kind, trade, extra) => ({
  id, name, kind, trade,
  contactName: '', phone: '', email: '', website: '', address: '', license: '',
  rating: null, approved: true, favorite: false, notes: '', ...extra,
});

export const DEMO_VENDORS = [
  // approved contractors, by trade
  V('v1', 'Rapids Plumbing Co.', 'contractor', 'plumbing', { favorite: true, rating: 5, phone: '(585) 555-0311', contactName: 'Dave Marino', license: 'NY PL-44219 · insured', notes: 'Fast on emergencies. Preferred for all water/drain work.' }),
  V('v2', 'Voltage Bros Electric', 'contractor', 'electrical', { rating: 4, phone: '(585) 555-0347', license: 'NY EL-88120 · insured' }),
  V('v3', 'TrueClimate Heating & Air', 'contractor', 'hvac', { favorite: true, rating: 5, phone: '(585) 555-0362', contactName: 'Renee O. ', notes: 'Services all our furnaces; seasonal tune-up contract.' }),
  V('v4', 'Summit Roofing & Gutters', 'contractor', 'roofing', { rating: 4, phone: '(585) 555-0208' }),
  V('v5', 'GreenScape Lawn & Snow', 'contractor', 'landscaping', { rating: 4, phone: '(585) 555-0155', notes: 'Season contract — mowing + plowing all buildings.' }),
  V('v6', 'Handy Hands General Contracting', 'contractor', 'general', { favorite: true, rating: 5, phone: '(585) 555-0129', contactName: 'Marcus Bell', notes: 'Go-to for turnovers, drywall, doors, punch lists.' }),
  V('v7', 'ClearView Window & Glass', 'contractor', 'general', { rating: 4, phone: '(315) 555-0177' }),
  V('v12', 'Overhead Door Co. of Rochester', 'contractor', 'doors', { favorite: true, rating: 5, phone: '(585) 555-0288', contactName: 'Rick Halloran', notes: 'Garage & overhead doors, openers, photo-eye sensors. Same-day on stuck doors.' }),
  // specialty suppliers
  V('v8', 'Ferguson Plumbing Supply', 'supplier', 'plumbing', { favorite: true, rating: 5, phone: '(585) 555-0400', website: 'ferguson.com', notes: 'Trade account — better pricing than retail on fixtures.' }),
  V('v9', 'Sherwin-Williams (Monroe Ave)', 'supplier', 'paint', { favorite: true, phone: '(585) 555-0412', website: 'sherwin-williams.com', notes: 'Contractor pricing on file. ProClassic is our standard.' }),
  V('v10', 'City Appliance Wholesale', 'supplier', 'appliance', { rating: 4, phone: '(585) 555-0433' }),
  V('v11', 'Home Depot (Henrietta Pro Desk)', 'supplier', 'general', { favorite: true, website: 'homedepot.com', notes: 'Pro Xtra account for everyday materials.' }),
];

const P = (id, name, vendorId, category, price, extra) => ({
  id, vendorId, name, category, sku: '', url: '', price, favorite: true, notes: '', ...extra,
});

export const DEMO_VENDOR_PRODUCTS = [
  P('p1', 'Moen 1225 faucet cartridge', 'v8', 'plumbing', 24.97, { sku: 'MOEN-1225', notes: 'Standard for kitchen faucets across the portfolio.' }),
  P('p2', 'SharkBite 1/2" push coupling', 'v11', 'plumbing', 8.47, { sku: 'SB-U008' }),
  P('p3', 'ProClassic Interior — Extra White (gal)', 'v9', 'paint', 62.0, { notes: 'Turnover standard — one sheen, one color, easy touch-ups.' }),
  P('p4', 'Honeywell T6 Pro thermostat', 'v10', 'hvac', 89.0, { sku: 'TH6220' }),
  P('p5', 'GE 4500W water heater element', 'v11', 'appliance', 18.44, {}),
  P('p6', 'Kwikset SmartKey deadbolt (satin nickel)', 'v11', 'general', 32.9, { notes: 'Re-key on every turnover; one key system.' }),
];
