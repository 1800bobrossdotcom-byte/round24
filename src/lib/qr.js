import qrcode from 'qrcode-generator';

// Round24's brand spectrum (matches --grad)
const SPECTRUM = ['#111111', '#111111', '#111111', '#111111', '#111111', '#111111'];

// render a QR for `text` onto a fresh canvas and return a PNG data URL.
// High error-correction ('H') so a logo/overlay or a smudged print still scans.
export function qrDataUrl(text, { size = 640, margin = 4, dark = '#050505', light = '#ffffff' } = {}) {
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cells = count + margin * 2;
  const px = Math.floor(size / cells);
  const dim = px * cells;
  const c = document.createElement('canvas');
  c.width = dim; c.height = dim;
  const ctx = c.getContext('2d');
  ctx.fillStyle = light; ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = dark;
  for (let r = 0; r < count; r++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(r, col)) ctx.fillRect((col + margin) * px, (r + margin) * px, px, px);
    }
  }
  return c.toDataURL('image/png');
}

// trigger a browser download of a data URL
export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

// a branded, print-ready poster (portrait, ~Letter ratio) with the QR big and
// centered, a heading, the building, and the URL — drop straight into a notice
// or lease packet. Returns a PNG data URL.
export function qrPosterDataUrl(text, { building = '', heading = 'Report a maintenance issue' } = {}) {
  const W = 1000, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  // top spectrum bar
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  SPECTRUM.forEach((c0, i) => grad.addColorStop(i / (SPECTRUM.length - 1), c0));
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 14);

  const cx = W / 2;
  ctx.textAlign = 'center';

  // wordmark
  ctx.fillStyle = '#050505';
  ctx.font = '800 46px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('Round24', cx, 100);

  // heading (may wrap to two lines) — flow everything below off its real bottom
  ctx.fillStyle = '#050505';
  ctx.font = '800 60px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  let y = wrap(ctx, heading, cx, 200, 840, 68);

  // sub-instruction
  ctx.fillStyle = '#6b6b6b';
  ctx.font = '400 29px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  y = wrap(ctx, 'Scan with your phone camera to send a photo and description straight to the maintenance office. No app, no login.', cx, y + 62, 800, 40);

  // building chip
  if (building) {
    ctx.fillStyle = '#050505';
    ctx.font = '700 36px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    y += 66; ctx.fillText(building, cx, y);
  }
  const qrTop = y + 44;

  // QR — quiet margin already baked in; frame it lightly
  const qrPng = qrDataUrl(text, { size: 620, margin: 2 });
  const img = new Image();
  return new Promise((resolve) => {
    img.onload = () => {
      const qs = 600;
      const qx = cx - qs / 2;
      ctx.strokeStyle = '#e4e8e7'; ctx.lineWidth = 2;
      ctx.strokeRect(qx - 18, qrTop - 18, qs + 36, qs + 36);
      ctx.drawImage(img, qx, qrTop, qs, qs);

      // footer: the URL — shrink to fit, fall back to the bare host if the full
      // link (org UUID + building) is still too wide for the poster
      ctx.fillStyle = '#6b6b6b';
      const maxW = W - 80;
      let label = text.replace(/^https?:\/\//, '');
      let fs = 26;
      const fits = (s, size) => { ctx.font = `500 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`; return ctx.measureText(s).width <= maxW; };
      while (fs > 16 && !fits(label, fs)) fs -= 1;
      if (!fits(label, fs)) { try { label = new URL(text).host; } catch { /* keep */ } fs = 26; }
      ctx.font = `500 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(label, cx, qrTop + qs + 74);
      ctx.fillStyle = '#9aa8a5';
      ctx.font = '400 22px system-ui, sans-serif';
      ctx.fillText('Powered by Round24', cx, H - 40);

      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(c.toDataURL('image/png'));
    img.src = qrPng;
  });
}

// simple word-wrap for canvas text
function wrap(ctx, text, cx, y, maxW, lh) {
  const words = text.split(' ');
  let line = '', yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, cx, yy); line = w; yy += lh; }
    else line = test;
  }
  if (line) ctx.fillText(line, cx, yy);
  return yy;
}
