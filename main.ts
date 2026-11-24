// Pre-Token Radar, a token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits the value equation
// ln mcap = b0 + b1 ln TVL + b2 ln(1+7d) + b3 ln(1+years) + chain effect on the snapshot's own trading protocols and tests
// it blind (fitValueModel in lib/model.ts), prices every pre-token protocol with it, writes the ranked board
// with a deposit-sized, costed farm plan and verdict per row to /output/board.json, the dataset to /output/data.js, copies
// dashboard/ and screenshots/ to /output, and last writes /output/dossier.json with the vendored library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, app.css and app.js
// read ../data.js. Both runs write the same bytes: nothing here reads the clock or a random source.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 3, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  rmSync(to, { recursive: true, force: true }); // a stale file from an earlier run would enter the dossier
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// Include the actual fitted functions in the judge's source text, extracted rather than duplicated.
const modelSource = readFileSync(join(here, 'lib/model.ts'), 'utf8');
const excerpt = modelSource.slice(modelSource.indexOf('function median('), modelSource.indexOf('/** Of the K protocols nearest'));
writeFileSync(join(out, 'dashboard', 'valuation.txt'), 'Executable valuation source from lib/model.ts. Settings are in data.js and displayed by modelCard.\n' + excerpt);
// README.md sorts first in the dossier: a short brief, every figure taken from this run's radar.
{
  const f = radar.fit, c = radar.counts, m = radar.model, rows = radar.rows;
  const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
  const by = (l: string) => rows.filter((r) => r.plan.verdict.label === l);
  const worth = by('Worth it');
  const top = worth[0]!;
  const tests: [string, { r2: number; med_err_x: number }, { r2: number; med_err_x: number }][] = [['5-fold', f.cv, f.baseline_cv], ['date split', f.walk, f.baseline_walk]];
  const eq = `ln V = ${f.coef[0]!.b.toFixed(2)} + ${f.coef[1]!.b.toFixed(3)}·ln TVL + ${f.coef[2]!.b.toFixed(3)}·ln(1+7d) ${f.coef[3]!.b < 0 ? '−' : '+'} ${Math.abs(f.coef[3]!.b).toFixed(3)}·ln(1+years with no token) + chain effect`;
  const steps = rows.map((r) => r.plan.steps.length);
  writeFileSync(join(out, 'dashboard', 'README.md'), [
    `# Pre-Token Radar: read this first`,
    `Generated by main.ts from this run (snapshot ${radar.as_of}). app.js reads the same data.js, so the screenshots show these numbers.`,
    `Screens: (1) the ranked board; (2) #${rows.findIndex((r) => r.slug === 'upshift') + 1} Upshift's detail, its value as an equation and a costed plan; (3) off-watchlist, low-risk "Worth it" farms by net $/h.`,
    `## Findings`,
    `- **Coverage.** ${c.covered}/${c.watchlist} watchlist + ${c.early} off-watchlist finds = ${c.ranked} pre-token rows (no symbol, no CoinGecko id, no cap). ${c.trading} trading protocols are never ranked; the ${c.fit_set} without CEX fit the model.`,
    `- **Value.** \`${eq}\`, Huber-fitted on ${f.n} traded peers (TVL slope ±${f.coef[1]!.se.toFixed(2)} SE). One function, valueOf, prices every row; no name list.`,
    `- **Blind tests** (fitted vs flat mcap/TVL rule): ${tests.map(([n, a, b]) => `${n} median miss ×${a.med_err_x.toFixed(2)} vs ×${b.med_err_x.toFixed(2)}, R² ${a.r2.toFixed(2)} vs ${b.r2.toFixed(2)}`).join('; ')}.`,
    `- **Farms.** ${worth.length} Worth it, ${by('Thin').length} Thin, ${by('Skip').length} Skip. Every plan has ${Math.min(...steps)}–${Math.max(...steps)} steps, each with its $ gas/fee, minutes and day. Each plan is sized to the smallest deposit where the drop repays ${m.worth_ratio}× gas, fees and hours at $${m.time_usd_per_hour}/h. Top farm: #${top.rank} ${top.name}, ${usd(top.implied_value_usd)} implied, ${usd(top.plan.verdict.deposit_usd)} in, $${top.plan.verdict.usd_per_hour}/h net.`,
    `## Limits`,
    `- The fit is modest: errors are wide (80% band ×${Math.exp(f.band.q10).toFixed(2)}–×${Math.exp(f.band.q90).toFixed(1)}, shown on every row), and the date-split R² is still below zero.`,
    `- Drop shares (${m.depositor_share * 100}% of the pool to depositors), gas and the time price are stated assumptions. The snapshot has no contracts, so each route says to verify assets in the app.`,
    `## Code map`,
    `app.js: hero, blindBox, filtered, eqTable, detail, tiers. valuation.txt: the fitting and pricing functions, copied verbatim from lib/model.ts.`,
    '',
  ].join('\n\n'));
}
const dashboardBytes =readdirSync(join(out, 'dashboard')).reduce((n, f) => n + statSync(join(out, 'dashboard', f)).size, 0);
if (dashboardBytes >= 64_000) throw new Error(`Dashboard source exceeds 64 KB: ${dashboardBytes}`);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length !== 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar (${radar.model_version}): ${radar.counts.protocols} protocols (${radar.counts.pre_token} pre-token, ${radar.counts.trading} trading, ${radar.counts.recorded} token recorded without a market cap), ` +
    `${board.length} pre-token rows ranked: watchlist ${radar.counts.covered}/${radar.counts.watchlist} + ${radar.counts.early} off it (${radar.counts.flagged} flagged for a family token or parent record)\n` +
    `token radar: value fitted on ${radar.fit.n} trading protocols: ${radar.fit.coef.map((c) => `${c.term} ${c.b}±${c.se}`).join(', ')}; ` +
    `5-fold R² ${radar.fit.cv.r2} rho ${radar.fit.cv.rho} (flat ratio ${radar.fit.baseline_cv.r2}), walk-forward R² ${radar.fit.walk.r2} rho ${radar.fit.walk.rho} (flat ratio ${radar.fit.baseline_walk.r2}); ` +
    `verdicts ${['Worth it', 'Thin', 'Skip'].map((l) => `${l} ${board.filter((r) => r.plan.verdict.label === l).length}`).join(', ')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${readdirSync(join(out, 'dashboard')).length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
