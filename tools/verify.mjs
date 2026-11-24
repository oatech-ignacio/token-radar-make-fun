// Local reproduction of the seven published gate checks, plus the user's stricter artifact caps.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';
const out = process.argv[2] || 'out';
const snapshot = JSON.parse(readFileSync(process.argv[3] || '../token-radar-01-kit/input/snapshot.json'));
const read = (p) => readFileSync(join(out, p));
const rows = JSON.parse(read('board.json')).rows;
const check = (name, f) => { try { console.log(`PASS ${name}: ${f() || 'ok'}`); } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };
check('dashboard_files', () => {
  const names = readdirSync(join(out, 'dashboard'));
  assert(names.includes('index.html') && names.some((n) => n.endsWith('.css')) && names.some((n) => n.endsWith('.js')));
  assert(names.length <= 400);
  let bytes = 0;
  for (const n of names) {
    assert(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(n));
    assert(lstatSync(join(out, 'dashboard', n)).isFile());
    const b = read(`dashboard/${n}`); bytes += b.length;
    if (/\.(html|css|js|mjs)$/.test(n)) assert(!/https?:\/\//i.test(b.toString()), `network address in ${n}`);
  }
  assert(bytes < 64_000); return `${names.length} files, ${bytes} bytes (<64 KB)`;
});
check('board_file', () => {
  assert(read('board.json').length <= 8 * 1024 ** 2);
  assert(rows.length >= 100 && rows.length <= 4000);
  const protocols = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  assert(new Set(rows.map((r) => r.slug)).size === rows.length);
  for (const r of rows) {
    assert(protocols.has(r.slug) && r.name.trim());
    const p = protocols.get(r.slug);
    assert(!p.symbol && !p.gecko_id && !p.mcap_usd, `${r.slug} is not pre-token`);
    assert(Number.isSafeInteger(r.rank) && r.rank > 0);
    assert(Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0 && r.implied_value_usd <= 1e14);
    assert(Array.isArray(r.farm_steps));
  }
  assert(new Set(rows.map((r) => r.implied_value_usd)).size > 1); return `${rows.length} real pre-token protocols`;
});
check('sorted_by_value', () => { rows.forEach((r, i) => assert(r.rank === i + 1 && (!i || r.implied_value_usd <= rows[i - 1].implied_value_usd))); });
check('coverage', () => { const slugs = new Set(rows.map((r) => r.slug)); assert(snapshot.watchlist.every((s) => slugs.has(s))); return `${snapshot.watchlist.length}/${snapshot.watchlist.length}`; });
check('farm_steps', () => {
  for (const r of rows) {
    assert(r.farm_steps.length >= 3 && r.farm_steps.length <= 12);
    for (const s of r.farm_steps) assert(typeof s === 'string' && s.trim().length >= 20 && s.trim().length <= 600);
    const p = r.plan, weeks = Math.round(p.hold_days / 7);
    const times = p.steps.reduce((n, s) => n + s.minutes * (s.when === 'weekly' ? weeks : s.when === 'monthly' ? weeks / 4.3 : 1), 0);
    const costs = p.steps.reduce((n, s) => n + (s.gas_usd + s.fee_usd) * (s.when === 'weekly' ? weeks : s.when === 'monthly' ? weeks / 4.3 : 1), 0);
    assert(Math.round(times) === p.total_minutes, `${r.slug} minute total`);
    assert(Math.abs(costs - p.total_cost_usd) <= .011, `${r.slug} cash total`);
    assert(r.farm_steps.slice(0, -1).every((s) => s.includes(p.chain) && s.includes('Cost:') && s.includes('Time:')));
    assert(Math.abs(Math.exp(r.value.ln_value) / r.implied_value_usd - 1) < .0001);
  }
  return 'all actions include chain, costs and minutes; totals recomputed';
});
check('screenshots', () => {
  const names = readdirSync(join(out, 'screenshots'));
  assert(names.length === 3);
  for (const n of names) {
    const b = read(`screenshots/${n}`); assert(b.length >= 307200 && b.length <= 350000);
    let w, h;
    if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
    else {
      assert(b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217);
      let i = 2;
      while (i < b.length) {
        assert(b[i] === 255); const marker = b[i + 1], len = b.readUInt16BE(i + 2);
        if ([192,193,194].includes(marker)) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
        i += 2 + len;
      }
    }
    assert(Math.max(w, h) <= 1440 && Math.min(w, h) >= 800);
    console.log(`  ${n}: ${w}×${h}, ${b.length} bytes`);
  }
  return 'exactly 3 within requested dimensions and byte band';
});
check('dossier_matches', () => {
  const actual = read('dossier.json'), expected = Buffer.from(buildDossier(out, { text_max_bytes: 65536 }));
  assert(actual.equals(expected)); assert(actual.length <= 1.5 * 1024 ** 2);
  const dossier = JSON.parse(actual); assert(!dossier.text.includes('lines not shown'));
  assert(dossier.text.includes('function fitValueModel') && dossier.text.includes('function valueOf'));
  return `byte-equal, ${actual.length} bytes, valuation source included`;
});
