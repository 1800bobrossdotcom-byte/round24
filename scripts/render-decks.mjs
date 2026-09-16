#!/usr/bin/env node
// Render the pitch decks in docs/pitch/*.html to PDF with headless Chromium.
//
//   node scripts/render-decks.mjs            # render every deck
//   node scripts/render-decks.mjs investor   # render decks whose name matches
//
// Each deck is a plain HTML file: one 1280×720 <section class="slide"> per
// page, sharing docs/pitch/assets/deck.css. No build step, no dependencies —
// Chromium's own print engine does the layout, so what you see in a browser
// tab is exactly what lands in the PDF.
//
// Chromium lookup order: $CHROME_PATH → Playwright's cache
// (~/.cache/ms-playwright or $PLAYWRIGHT_BROWSERS_PATH) → chromium / chrome
// on $PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pitchDir = join(root, 'docs', 'pitch');
const filter = process.argv[2] || '';

function findChromium() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(process.env.HOME || '', '.cache', 'ms-playwright')].filter(Boolean);
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    const hits = readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse()
      .map((d) => join(cache, d, 'chrome-linux', 'chrome'))
      .filter(existsSync);
    if (hits[0]) return hits[0];
  }
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

const chrome = findChromium();
if (!chrome) {
  console.error('No Chromium found. Set CHROME_PATH=/path/to/chrome and re-run.');
  process.exit(1);
}

const decks = readdirSync(pitchDir)
  .filter((f) => f.endsWith('-deck.html') && f.includes(filter));
if (!decks.length) {
  console.error(`No *-deck.html in ${pitchDir}` + (filter ? ` matching "${filter}"` : ''));
  process.exit(1);
}

let failed = false;
for (const html of decks) {
  const src = join(pitchDir, html);
  const out = join(pitchDir, `caliper-${basename(html, '.html')}.pdf`);
  const args = [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--run-all-compositor-stages-before-draw', '--virtual-time-budget=8000',
    '--no-pdf-header-footer', `--print-to-pdf=${out}`, pathToFileURL(src).href,
  ];
  const r = spawnSync(chrome, args, { encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(out)) {
    failed = true;
    console.error(`✗ ${html}\n${(r.stderr || '').split('\n').filter((l) => !/dbus|DBus/.test(l)).join('\n')}`);
    continue;
  }
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`✓ ${basename(out)}  (${kb} KB)`);
}
process.exit(failed ? 1 : 0);
