# Whitelabel brand logos

Drop an org's logo here and point to it from `src/lib/brand.js` (keyed by org id).

- **Evolution24** → upload as `evolution24.png` (this exact filename — the code
  references `/brands/evolution24.png`).
- PNG with a **transparent background** works best (it sits on both light and
  dark surfaces). ~400–800px wide is plenty; it's displayed small.

Until a file exists here the app falls back to the Round24 lockup, so adding an
org to `brand.js` before the logo is uploaded never breaks anything.
