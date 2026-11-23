// Screenshot helper (not part of the entry's run): drives headless Chrome over the DevTools protocol and
// writes each view as an image of 300..350 KB, 1440x900, the band the dossier asks for.
//   node tools/shot.mjs <out dir with dashboard/> <screenshots dir> name=hash [name=hash ...]
// A PNG is kept when it lands in the band; otherwise JPEG quality is searched until it does.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [outDir, shotDir, ...views] = process.argv.slice(2);
const W = 1440, H = 900, LO = 310_000, HI = 350_000; // inside 300..350 KB whether KB means 1000 or 1024
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'radar-chrome-'));
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--disable-gpu', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200);
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {}
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const base = 'file://' + resolve(outDir, 'dashboard', 'index.html');

for (const v of views) {
  const [name, hash = ''] = v.split('=', 2).length === 2 ? [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)] : [v, ''];
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url: `${base}${hash ? '#' + hash : ''}` });
  await sleep(1500);
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  let file, buf;
  if (png.length >= LO && png.length <= HI) { file = `${name}.png`; buf = png; }
  else {
    // JPEG size is not smooth in quality: scan every step and keep the one nearest the band's middle.
    // If two neighbouring qualities straddle the band, trim the capture height a little and scan again.
    const sizes = [];
    for (let h = H; h >= 820 && !buf; h -= 16) {
      for (let q = 100; q >= 60; q--) {
        const clip = { x: 0, y: 0, width: W, height: h, scale: 1 };
        const jpg = Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: q, clip })).result.data, 'base64');
        sizes.push(`${h}/${q}:${Math.round(jpg.length / 1024)}`);
        const d = Math.abs(jpg.length - (LO + HI) / 2);
        if (jpg.length >= LO && jpg.length <= HI && (!buf || d < Math.abs(buf.length - (LO + HI) / 2))) buf = jpg;
        if (jpg.length < LO) break;
      }
    }
    file = `${name}.jpg`;
    if (!buf) { console.log(`${name}: no quality lands in the band: ${sizes.join(' ')}`); continue; }
  }
  for (const ext of ['png', 'jpg']) rmSync(join(shotDir, `${name}.${ext}`), { force: true });
  writeFileSync(join(shotDir, file), buf);
  console.log(`${file} ${buf.length} bytes (png was ${png.length})`);
}
ws.close();
chrome.kill();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
