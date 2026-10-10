// Draws assets/banner.png for the README. Run with: npx electron scripts/make-banner.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const draw = () => {
  const W = 1280;
  const H = 360;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  g.beginPath();
  g.roundRect(0, 0, W, H, 72);
  g.clip();
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#211e1b');
  bg.addColorStop(1, '#100f0e');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H * 1.25, 20, W / 2, H * 1.25, W * 0.55);
  glow.addColorStop(0, 'rgba(255, 122, 47, 0.38)');
  glow.addColorStop(1, 'rgba(255, 122, 47, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  g.font = '500 150px "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
  g.textBaseline = 'middle';
  const word = 'Ember';
  const mark = 190;
  const gap = 34;
  const total = mark + gap + g.measureText(word).width;
  const left = (W - total) / 2;

  // the app mark: a leaning drop with a hollow core, same geometry as scripts/make-icon.js
  const C = { x: -0.015, y: 0.085 };
  const R = 0.205;
  const A = { x: 0.085, y: -0.33 };
  const base = Math.atan2(A.y - C.y, A.x - C.x);
  const spread = Math.acos(R / Math.hypot(A.x - C.x, A.y - C.y));
  const s = mark / 0.62;
  const ox = left + mark / 2 + 0.01 * s;
  const oy = H / 2 + 0.03 * s;
  const fill = g.createLinearGradient(0, oy + A.y * s, 0, oy + (C.y + R) * s);
  fill.addColorStop(0, '#ffbe54');
  fill.addColorStop(1, '#ff541c');
  g.shadowColor = 'rgba(255, 122, 47, 0.55)';
  g.shadowBlur = 60;
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(ox + A.x * s, oy + A.y * s);
  g.lineTo(ox + (C.x + R * Math.cos(base + spread)) * s, oy + (C.y + R * Math.sin(base + spread)) * s);
  g.arc(ox + C.x * s, oy + C.y * s, R * s, base + spread, base - spread + Math.PI * 2);
  g.closePath();
  g.moveTo(ox + (C.x + 0.078) * s, oy + 0.1 * s);
  g.arc(ox + C.x * s, oy + 0.1 * s, 0.078 * s, 0, Math.PI * 2, true);
  g.fill('evenodd');

  g.shadowColor = 'transparent';
  g.fillStyle = '#f4efe7';
  g.fillText(word, left + mark + gap, H / 2 + 8);
  return c.toDataURL('image/png');
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  await win.loadURL('about:blank');
  const url = await win.webContents.executeJavaScript(`(${draw})()`);
  const out = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'banner.png'), Buffer.from(url.split(',')[1], 'base64'));
  app.quit();
});
