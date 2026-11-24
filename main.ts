// Pre-Token Radar, a token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits the value equation
// ln mcap = b0 + b1 ln TVL + b2 ln(1+7d) + b3 ln(1+years) on the snapshot's own trading protocols and tests
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
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
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
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
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
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
