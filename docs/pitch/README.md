# Pitch decks

Two decks, one design system, rendered to PDF by headless Chromium.

| Deck | Source | Output | Audience |
|---|---|---|---|
| Investor brief | `investor-deck.html` | `round24-investor-deck.pdf` | Pre-seed investors — thesis, three products, engine, proof, market, landscape, team, ask |
| Product overview | `user-deck.html` | `round24-user-deck.pdf` | Operators, crews, estates, residents — what each product and portal does |

Both are structured around the three products and the portals inside each:

- **Round24 Pro** → Office portal · Crew portal
- **Round24 Enterprise** → Estates portal
- **Round24 Community** → Residents portal (free with Pro)

Module lists on the product slides mirror `TABS` / `OWNER_TABS` in `src/App.jsx`
and the resident views — when a module ships or is renamed, update the deck too.
Brass-coloured chips mark work in progress (Rent Manager sync, pay-period lock,
neighbor messaging); everything else shown is in production use.

## Editing

Each deck is plain HTML: one `<section class="slide">` per page, 1280×720,
styled by `assets/deck.css` (tokens, rules, cards, stat strips, product map,
module chips, screenshot frames). Fonts are vendored in `assets/fonts/` so the
PDF embeds Barlow, Barlow Condensed and IBM Plex Mono. Screenshots are the same sample-data captures
the landing page uses (`public/shots/`).

Open the HTML in a browser to preview; slides stack vertically on screen and
paginate in print.

## Rendering

```bash
node scripts/render-decks.mjs            # both decks → docs/pitch/*.pdf
node scripts/render-decks.mjs investor   # just one
```

Needs a Chromium: `$CHROME_PATH`, a Playwright browser cache, or `chromium` on
`$PATH`. No npm dependencies.
