// Exercise real offline page behavior over Chrome DevTools, using only Node's standard library.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const profile = mkdtempSync('/tmp/radar-browser-'), port = 9837;
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let targets;
  for (let i = 0; i < 60 && !targets; i++) { await sleep(100); try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {} }
  assert(targets, 'Chrome started');
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }); assert(!r.result.exceptionDetails, JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const url = 'file://' + resolve(process.argv[2] || 'out', 'dashboard/index.html');
  await send('Page.navigate', { url }); await sleep(500);
  assert.equal(await evaluate("document.querySelectorAll('tr[data-slug]').length"), 198);
  assert.equal(await evaluate("document.querySelector('tr[data-slug]').dataset.slug"), await evaluate('RADAR.rows[0].slug'));
  await evaluate("document.querySelector('th[data-k=name]').click()");
  assert.equal(await evaluate("document.querySelector('tr[data-slug] .pname').textContent"), await evaluate("RADAR.rows.map(r=>r.name).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()))[0]"));
  await evaluate("var cat=document.querySelector('#f-cat');cat.value='Lending';cat.dispatchEvent(new Event('change'))");
  assert(await evaluate("Array.from(document.querySelectorAll('tr[data-slug]')).every(tr=>RADAR.rows.find(r=>r.slug===tr.dataset.slug).category==='Lending')"));
  await evaluate("document.querySelector('#f-reset').click();document.querySelector('tr[data-slug=upshift]').click()"); await sleep(300);
  assert(await evaluate("document.querySelector('#drawer').classList.contains('on') && document.querySelectorAll('#drawer .plan tr').length===7"));
  assert(await evaluate("document.querySelector('#drawer').textContent.includes('chain: Ethereum')"));
  assert(await evaluate("document.querySelector('#drawer .totals').getBoundingClientRect().bottom<=900"), 'detail actions and totals visible');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
  assert(await evaluate("!document.querySelector('#drawer').classList.contains('on')"));
  await evaluate("document.querySelector('[data-tab=live]').click()");
  assert.equal(await evaluate("document.querySelectorAll('#app tbody tr').length >= RADAR.live.length"), true);
  await evaluate("document.querySelector('[data-tab=method]').click()");
  assert(await evaluate("document.querySelector('#app').textContent.includes('Nested 5-fold')"));
  assert(await evaluate("!document.body.textContent.includes('undefined') && !document.body.textContent.includes('NaN')"));
  await send('Page.navigate', { url: url + '#status=early&verdict=Worth%20it&sort=verdict&dir=-1' }); await sleep(300);
  assert(await evaluate("Array.from(document.querySelectorAll('tr[data-slug]')).every(tr=>{let r=RADAR.rows.find(r=>r.slug===tr.dataset.slug);return !r.on_watchlist&&r.plan.verdict.label==='Worth it'})"));
  assert(await evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"), 'desktop no horizontal page overflow');
  assert.deepEqual(errors, []);
  console.log('PASS browser: full board, sort, category filter, reset, detail equation/actions, close, trading, model, filtered URL, no runtime errors');
} finally { ws?.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
