// Token radar model, "fit-2": one sealed snapshot in, one ranked board out.
//
// Every number is derived from the snapshot's own ten fields. No protocol name is special-cased: the same
// functions score every row. The only tables are about chains (what a transaction costs there) and category
// playbooks (what a lending market or a DEX asks you to do), never about which protocol should win.
//
// 1. Status. PRE-TOKEN: the record carries no symbol, no CoinGecko id, no market cap. TRADING: it records a
//    market cap. RECORDED: a symbol or id but no market cap. Only pre-token protocols are ranked; trading
//    ones are the fit set and are kept apart, recorded ones are left out of both.
//
// 2. Value model, fitted (fitValueModel). On every TRADING protocol (CEX left out: an exchange token is not
//    priced on TVL) regress
//        ln mcap = b0 + b1 ln TVL + b2 ln(1 + g7) + b3 ln(1 + years live) + primary-chain effect
//    by Huber-weighted least squares (IRLS, k = 1.345 MAD) with a small ridge on the slopes. g7 is the 7-day
//    TVL change clamped to -50..+100%; years live run from listed_at to as_of (for a pre-token protocol that
//    is exactly how long it has run with no token).
//    Tested blind three ways (validate): 5-fold cross-validation, a walk-forward split that trains on the
//    oldest 60% by listing date and predicts the newest 40%, and a term-by-term ablation; each against a
//    flat-ratio baseline (mcap = TVL x the median mcap/TVL). Coefficient errors are delete-a-fold jackknife.
//
// 3. Implied value = e^(b . x) for each pre-token protocol, with an 80% band from the held-out residuals.
//
// 4. Peer odds (peerOdds): of the 40 protocols nearest in (ln TVL, ln years live), the share that already
//    record a token. Shown, never priced: the bounty asks what a token would be worth, not whether it comes.
//
// 5. Airdrop. pool = implied x community share (12% user-facing apps, 10% DeFi infrastructure, 6% curated or
//    institutional); 70% of the pool reaches depositors pro rata to TVL: per_1k = pool x 0.7 x 1,000 / TVL.
//
// 6. Farm plan (sizedPlan). First listed chain, wallet, gas assumptions and conditional category steps.
//    Gas and fees are linear in the deposit D, so cost(D) = fixed + rate x D exactly; the break-even deposit
//    and the deposit where the drop is 3x the cost follow, and the plan is sized to the latter.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'fit-2';

/** The model's settings, all stated on the dashboard. The coefficients are not here: they are fitted. */
export const MODEL = {
  growth_floor: -50,
  growth_cap: 100,
  ridge: 0.5,
  effect_ridge: 5,
  huber_k: 1.345,
  folds: 5,
  walk_train_share: 0.6,
  peer_k: 40,
  depositor_share: 0.7,
  worth_ratio: 3,
  time_usd_per_hour: 20,
  deposit_max: 50_000,
  deposit_tiers: [250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000],
  family_risk: 15,
} as const;

export const TERMS = ['intercept', 'ln TVL', 'ln(1+7d)', 'ln(1+years)'] as const;

export type Status = 'pre-token' | 'trading' | 'recorded';

/** One step of a farm plan, structured for the page and flattened to text for board.json. */
export interface FarmStep {
  phase: 'Setup' | 'Position' | 'Repeat' | 'Hold' | 'Exit';
  text: string;
  capital_usd: number;
  gas_usd: number;
  fee_usd: number;
  minutes: number;
  when: string;
}

export interface Verdict {
  label: 'Worth it' | 'Thin' | 'Skip';
  deposit_usd: number;
  ratio: number;
  breakeven_usd: number | null;
  worth_usd: number | null;
  hours: number;
  time_cost_usd: number;
  net_usd: number;
  usd_per_hour: number;
  text: string;
}

export interface Plan {
  chain: string;
  primary_chain: string;
  wallet: string;
  gas_per_tx_usd: number;
  capital_usd: number;
  hold_days: number;
  setup_minutes: number;
  weekly_minutes: number;
  total_minutes: number;
  fixed_cost_usd: number;
  cost_rate: number;
  total_cost_usd: number;
  est_drop_usd: number;
  roi_multiple: number;
  verdict: Verdict;
  steps: FarmStep[];
}

export interface Risk {
  score: number;
  level: 'Low' | 'Medium' | 'High';
  notes: string[];
}

/** One term of a row's value equation: coefficient x feature = log contribution. */
export interface Term { term: string; b: number; x: number; contrib: number }

export interface Value {
  terms: Term[];
  ln_value: number;
  low_usd: number;
  high_usd: number;
  to_tvl: number;
  growth_pct: number;
  age_days: number | null;
  years_used: number;
}

export interface Flag { kind: 'none' | 'sibling' | 'parent'; reason: string }

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  value: Value;
  flag: Flag;
  peer_token_share: number;
  airdrop_share: number;
  airdrop_pool_usd: number;
  per_1k_usd: number;
  risk: Risk;
  plan: Plan;
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's number beside the model's blind guess of it. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  cv_pred_usd: number;
  wf_pred_usd: number | null;
}

export interface Score { n: number; r2: number; rho: number; med_err_x: number; hit3: number }

export interface Fit {
  n: number;
  coef: { term: string; b: number; se: number }[];
  in_sample: Score;
  cv: Score;
  walk: Score & { n_train: number; cut: string };
  baseline_cv: Score;
  baseline_walk: Score;
  baseline_ratio: number;
  ablation: { term: string; cv: Score }[];
  band: { q10: number; q90: number };
  fallback_age_days: number;
  chain_effects: string[];
  experiments: { name: string; cv: Score; walk: Score }[];
  nested_cv: Score;
  selected: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  fit: Fit;
  counts: { protocols: number; pre_token: number; trading: number; fit_set: number; recorded: number; ranked: number; watchlist: number; covered: number; early: number; flagged: number };
  rows: BoardRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const bySlug = (a: { slug: string }, b: { slug: string }): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** Days from listed_at to as_of, or null. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function statusOf(p: SnapshotProtocol): Status {
  if (p.mcap_usd !== null && p.mcap_usd > 0) return 'trading';
  if (p.symbol !== null || p.gecko_id !== null || p.mcap_usd !== null) return 'recorded';
  return 'pre-token';
}

// The watchlist's own exclusion rule, applied below the floor too: a wrapped, staked, bridged or
// exchange product is not a token still to come.
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isCandidate(p: SnapshotProtocol): boolean {
  return statusOf(p) === 'pre-token' && !DERIVATIVE_CATEGORIES.has(p.category ?? '') && !VERSIONED.test(p.name) && !WRAPPED_WORD.test(p.name) && !EXCHANGE_NAME.test(p.name);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (at - lo);
}

// ---------- the fitted value model ----------

/** The feature vector [1, ln TVL, ln(1+g7), ln(1+years)] of one protocol. */
export function features(p: SnapshotProtocol, asOf: string, fallbackAgeDays: number, effects: string[] = []): { x: number[]; growth: number; age: number | null; years: number } {
  const growth = clamp(p.change_7d ?? 0, MODEL.growth_floor, MODEL.growth_cap);
  const age = ageDays(asOf, p.listed_at);
  const years = (age ?? fallbackAgeDays) / 365;
  return { x: [1, Math.log(Math.max(p.tvl_usd, 1)), Math.log(1 + growth / 100), Math.log(1 + years), ...effects.map((c) => Number((p.chains[0] ?? 'Unknown') === c))], growth, age, years };
}

/** Solve A b = c by Gaussian elimination with partial pivoting. */
function solve(A: number[][], c: number[]): number[] {
  const k = c.length;
  const M = A.map((row, i) => [...row, c[i]!]);
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(M[r]![i]!) > Math.abs(M[p]![i]!)) p = r;
    [M[i], M[p]] = [M[p]!, M[i]!];
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = M[r]![i]! / M[i]![i]!;
      for (let j = i; j <= k; j++) M[r]![j]! -= f * M[i]![j]!;
    }
  }
  return M.map((row, i) => row[k]! / row[i]!);
}

/** Weighted ridge least squares on the chosen columns; the intercept (column 0) is never penalised. */
function wls(X: number[][], y: number[], w: number[], cols: number[]): number[] {
  const k = cols.length;
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const c = new Array<number>(k).fill(0);
  X.forEach((row, i) => {
    for (let a = 0; a < k; a++) {
      c[a]! += w[i]! * row[cols[a]!]! * y[i]!;
      for (let b = 0; b < k; b++) A[a]![b]! += w[i]! * row[cols[a]!]! * row[cols[b]!]!;
    }
  });
  for (let a = 0; a < k; a++) if (cols[a] !== 0) A[a]![a]! += cols[a]! >= 4 ? MODEL.effect_ridge : MODEL.ridge;
  const sub = solve(A, c);
  const full = new Array<number>(X[0]!.length).fill(0);
  cols.forEach((col, a) => { full[col] = sub[a]!; });
  return full;
}

const dot = (b: number[], x: number[]): number => b.reduce((s, v, i) => s + v * x[i]!, 0);

/** Huber regression by iteratively reweighted least squares. */
export function fitHuber(X: number[][], y: number[], cols: number[] = X[0]!.map((_, i) => i)): number[] {
  let w = y.map(() => 1);
  let b = wls(X, y, w, cols);
  for (let it = 0; it < 30; it++) {
    const res = X.map((x, i) => y[i]! - dot(b, x));
    const c = MODEL.huber_k * (1.4826 * median(res.map(Math.abs)) || 1);
    w = res.map((e) => (Math.abs(e) <= c ? 1 : c / Math.abs(e)));
    b = wls(X, y, w, cols);
  }
  return b;
}

function rankOf(v: number[]): number[] {
  const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const r = new Array<number>(v.length);
  order.forEach(([, i], j) => { r[i] = j; });
  return r;
}

/** Held-out score: R^2, Spearman's rho, the median error as a factor (x2 = off by half or double) and hit3, the share within x3. */
export function score(y: number[], yh: number[]): Score {
  const m = y.reduce((s, v) => s + v, 0) / y.length;
  let ss = 0;
  let sr = 0;
  y.forEach((v, i) => { ss += (v - m) ** 2; sr += (v - yh[i]!) ** 2; });
  const ra = rankOf(y);
  const rb = rankOf(yh);
  const n = y.length;
  const d2 = ra.reduce((s, v, i) => s + (v - rb[i]!) ** 2, 0);
  return { n, r2: r4(1 - sr / ss), rho: r4(1 - (6 * d2) / (n * (n * n - 1))), med_err_x: r4(Math.exp(median(y.map((v, i) => Math.abs(v - yh[i]!))))), hit3: r4(y.filter((v, i) => Math.abs(v - yh[i]!) < Math.log(3)).length / n) };
}

export function fitSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => statusOf(p) === 'trading' && p.category !== 'CEX' && p.tvl_usd > 0);
}

/** Fit on every trading protocol, then test it blind: k-fold, walk-forward, ablation and a baseline. */
export function fitValueModel(snapshot: Snapshot): { fit: Fit; beta: number[]; cvPred: number[]; wfPred: (number | null)[]; set: SnapshotProtocol[] } {
  const set = fitSet(snapshot);
  const ages = set.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const fallback = Math.round(median(ages));
  const effects = [...new Set(set.map((p) => p.chains[0] ?? 'Unknown'))].sort();
  const terms = [...TERMS, ...effects.map((c) => `chain: ${c}`)];
  const X = set.map((p) => features(p, snapshot.as_of, fallback, effects).x);
  const cols = X[0]!.map((_, i) => i);
  const y = set.map((p) => Math.log(p.mcap_usd!));
  const lnRatio = (idx: number[]): number => median(idx.map((i) => y[i]! - X[i]![1]!));
  const all = set.map((_, i) => i);
  const beta = fitHuber(X, y);
  const K = MODEL.folds;
  const foldOf = (i: number): number => i % K; // the snapshot is sorted by slug: a fixed, name-blind split

  const crossValidate = (cols: number[]): { pred: number[]; betas: number[][] } => {
    const pred = new Array<number>(y.length);
    const betas: number[][] = [];
    for (let f = 0; f < K; f++) {
      const train = all.filter((i) => foldOf(i) !== f);
      const b = fitHuber(train.map((i) => X[i]!), train.map((i) => y[i]!), cols);
      betas.push(b);
      all.filter((i) => foldOf(i) === f).forEach((i) => { pred[i] = dot(b, X[i]!); });
    }
    return { pred, betas };
  };
  const cv = crossValidate(cols);
  const se = beta.map((_, j) => {
    const bj = cv.betas.map((b) => b[j]!);
    const mean = bj.reduce((s, v) => s + v, 0) / K;
    return Math.sqrt(((K - 1) / K) * bj.reduce((s, v) => s + (v - mean) ** 2, 0));
  });
  const basePred = new Array<number>(y.length);
  for (let f = 0; f < K; f++) {
    const ratio = lnRatio(all.filter((i) => foldOf(i) !== f));
    all.filter((i) => foldOf(i) === f).forEach((i) => { basePred[i] = X[i]![1]! + ratio; });
  }

  // Walk-forward: train on the oldest listings, predict the newest. Unknown listing dates train only.
  const dated = all.filter((i) => set[i]!.listed_at !== null).sort((a, b) => (set[a]!.listed_at! < set[b]!.listed_at! ? -1 : set[a]!.listed_at! > set[b]!.listed_at! ? 1 : a - b));
  const cutAt = Math.floor(dated.length * MODEL.walk_train_share);
  const test = dated.slice(cutAt);
  const testSet = new Set(test);
  const train = all.filter((i) => !testSet.has(i));
  const bw = fitHuber(train.map((i) => X[i]!), train.map((i) => y[i]!));
  const wfPred: (number | null)[] = all.map((i) => (testSet.has(i) ? dot(bw, X[i]!) : null));
  const trainRatio = lnRatio(train);

  const resid = y.map((v, i) => v - cv.pred[i]!);
  const fit: Fit = {
    n: set.length,
    coef: beta.map((b, j) => ({ term: terms[j]!, b: r4(b), se: r4(se[j]!) })),
    in_sample: score(y, X.map((x) => dot(beta, x))),
    cv: score(y, cv.pred),
    walk: { ...score(test.map((i) => y[i]!), test.map((i) => wfPred[i]!)), n_train: train.length, cut: set[test[0]!]!.listed_at! },
    baseline_cv: score(y, basePred),
    baseline_walk: score(test.map((i) => y[i]!), test.map((i) => X[i]![1]! + trainRatio)),
    baseline_ratio: r4(Math.exp(lnRatio(all))),
    ablation: [1, 2, 3].map((j) => ({ term: TERMS[j]!, cv: score(y, crossValidate(cols.filter((c) => c !== j)).pred) })),
    band: { q10: r4(quantile(resid, 0.1)), q90: r4(quantile(resid, 0.9)) },
    fallback_age_days: fallback,
    chain_effects: effects,
    selected: 'Primary-chain ridge effects',
    experiments: [],
    nested_cv: score(y, cv.pred),
  };
  // Compare four fixed feature families. Category and chain vocabularies use labels only;
  // unseen labels have zero coefficients. Every inner fit excludes its validation targets.
  const categories = [...new Set(set.map((p) => p.category ?? 'Unknown'))].sort();
  const catX = set.map((p, i) => [...X[i]!.slice(0, 4), ...categories.map((c) => Number((p.category ?? 'Unknown') === c))]);
  const candidates = [
    { name: 'Original equation', x: X.map((x) => x.slice(0, 4)) },
    { name: 'Category effects', x: catX },
    { name: 'Primary-chain ridge effects', x: X },
    { name: 'Category + primary chain', x: X.map((x, i) => [...x, ...catX[i]!.slice(4)]) },
  ];
  function predictCV(x: number[][], indices: number[], folds: number): { pred: number[]; error: number } {
    const pred = new Array<number>(y.length);
    for (let f = 0; f < folds; f++) {
      const tr = indices.filter((_, j) => j % folds !== f);
      const te = indices.filter((_, j) => j % folds === f);
      const b = fitHuber(tr.map((i) => x[i]!), tr.map((i) => y[i]!));
      te.forEach((i) => { pred[i] = dot(b, x[i]!); });
    }
    return { pred, error: indices.reduce((s, i) => s + (y[i]! - pred[i]!) ** 2, 0) };
  }
  fit.experiments = candidates.map((c) => {
    const pred = predictCV(c.x, all, K).pred;
    const b = fitHuber(train.map((i) => c.x[i]!), train.map((i) => y[i]!));
    return { name: c.name, cv: score(y, pred), walk: score(test.map((i) => y[i]!), test.map((i) => dot(b, c.x[i]!))) };
  });
  const nested = new Array<number>(y.length);
  for (let f = 0; f < K; f++) {
    const tr = all.filter((i) => foldOf(i) !== f);
    const te = all.filter((i) => foldOf(i) === f);
    const winner = candidates.map((c) => ({ c, e: predictCV(c.x, tr, 4).error })).sort((a, b) => a.e - b.e)[0]!.c;
    const b = fitHuber(tr.map((i) => winner.x[i]!), tr.map((i) => y[i]!));
    te.forEach((i) => { nested[i] = dot(b, winner.x[i]!); });
  }
  fit.nested_cv = score(y, nested);
  return { fit, beta, cvPred: cv.pred, wfPred, set };
}

/** A row's implied value as its equation: each term's coefficient, feature and log contribution. */
export function valueOf(p: SnapshotProtocol, asOf: string, beta: number[], fit: Fit): { implied: number; value: Value } {
  const f = features(p, asOf, fit.fallback_age_days, fit.chain_effects);
  const terms = beta.map((b, j): Term => ({ term: fit.coef[j]!.term, b: r4(b), x: r4(f.x[j]!), contrib: r4(b * f.x[j]!) })).filter((t, j) => j < 4 || t.x !== 0);
  const ln = dot(beta, f.x);
  const implied = Math.max(1, Math.round(Math.exp(ln)));
  return {
    implied,
    value: {
      terms, ln_value: r4(ln), low_usd: Math.round(Math.exp(ln + fit.band.q10)), high_usd: Math.round(Math.exp(ln + fit.band.q90)),
      to_tvl: r4(implied / p.tvl_usd), growth_pct: r2(f.growth), age_days: f.age, years_used: r2(f.years),
    },
  };
}

/** Of the K protocols nearest in (ln TVL, ln years live), the share that already record a token. */
export function peerOdds(snapshot: Snapshot, fallbackAgeDays: number): (p: SnapshotProtocol) => number {
  const pool = snapshot.protocols.filter((p) => p.category !== 'CEX' && p.tvl_usd > 0);
  const pts = pool.map((p) => { const f = features(p, snapshot.as_of, fallbackAgeDays); return { slug: p.slug, a: f.x[1]!, b: f.x[3]!, token: statusOf(p) !== 'pre-token' }; });
  const sd = (xs: number[]): number => { const m = xs.reduce((s, v) => s + v, 0) / xs.length; return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length) || 1; };
  const sa = sd(pts.map((q) => q.a));
  const sb = sd(pts.map((q) => q.b));
  return (p) => {
    const f = features(p, snapshot.as_of, fallbackAgeDays);
    const near = pts.filter((q) => q.slug !== p.slug)
      .map((q) => ({ d: ((q.a - f.x[1]!) / sa) ** 2 + ((q.b - f.x[3]!) / sb) ** 2, q }))
      .sort((u, v) => u.d - v.d || (u.q.slug < v.q.slug ? -1 : 1))
      .slice(0, MODEL.peer_k);
    return r4(near.filter((n) => n.q.token).length / near.length);
  };
}

type Family = 'user' | 'defi' | 'inst';
const FAMILY_SHARE: Record<Family, number> = { user: 0.12, defi: 0.1, inst: 0.06 };

function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (/curator|allocator|rwa|cedefi|insurance|basis/.test(c)) return 'inst';
  if (/dex|derivative|perp|option|prediction|payment|card|farm|launchpad|nft|gaming|chain|otc/.test(c)) return 'user';
  return 'defi';
}

// ---------- chains: wallet and gas per transaction, by chain family ----------

const ETH_L1 = new Set(['Ethereum']);
const PRICEY = new Map<string, number>([['Ethereum', 2.5], ['Bitcoin', 1.8], ['Tron', 1.2], ['Litecoin', 0.05], ['Doge', 0.2], ['Zcash', 0.05], ['Cardano', 0.2]]);
const NON_EVM_WALLET = new Map<string, string>([
  ['Solana', 'Phantom or Backpack'], ['Bitcoin', 'Xverse or Unisat'], ['Sui', 'Slush (Sui Wallet)'], ['Aptos', 'Petra'], ['Algorand', 'Pera'],
  ['Stellar', 'Freighter'], ['Ripple', 'Xaman'], ['Tron', 'TronLink'], ['Noble', 'Keplr'], ['Babylon Genesis', 'Keplr'], ['Near', 'Meteor'],
  ['Cardano', 'Lace'], ['Bittensor', 'Talisman'], ['Starknet', 'Ready (Argent) or Braavos'], ['Stacks', 'Leather'], ['Provenance', 'Leap'],
  ['Hyperliquid L1', 'Rabby (Hyperliquid account)'], ['Canton', 'the issuer\'s Canton wallet'], ['Qubic', 'Qubic Wallet'], ['Aleo', 'Leo Wallet'],
  ['Flow', 'Flow Wallet'], ['Zcash', 'Zashi'], ['Doge', 'MyDoge'], ['Litecoin', 'Litewallet'], ['Filecoin', 'MetaMask (FEVM)'], ['XION', 'Keplr'],
]);

function gasOf(chain: string): number {
  if (PRICEY.has(chain)) return PRICEY.get(chain)!;
  if (chain === 'Solana' || chain === 'Sui' || chain === 'Aptos' || chain === 'Algorand' || chain === 'Stellar' || chain === 'Ripple' || chain === 'Hyperliquid L1') return 0.01;
  if (chain === 'Binance' || chain === 'Avalanche' || chain === 'Polygon') return 0.05;
  return 0.04; // rollups and fast EVM chains
}

const walletOf = (chain: string): string => NON_EVM_WALLET.get(chain) ?? 'Rabby or MetaMask';
const usd = (n: number): string => (n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : n >= 1 ? `$${n.toFixed(n % 1 === 0 ? 0 : 2)}` : `$${n.toFixed(2)}`);

function fundingRoute(chain: string): { text: string; fee: number; minutes: number } {
  if (ETH_L1.has(chain)) return { text: `withdraw USDC from an exchange straight to Ethereum mainnet`, fee: 4, minutes: 15 };
  if (NON_EVM_WALLET.has(chain) && chain !== 'Hyperliquid L1' && chain !== 'Filecoin') return { text: `withdraw USDC (or ${chain}'s native asset) from an exchange that lists the ${chain} network`, fee: 1, minutes: 15 };
  if (chain === 'Hyperliquid L1') return { text: `deposit USDC from Arbitrum through Hyperliquid's native bridge`, fee: 1, minutes: 10 };
  return { text: `withdraw USDC to Arbitrum or Base from an exchange, then bridge to ${chain} with a canonical or intent bridge (Across, Relay)`, fee: 2, minutes: 20 };
}

// ---------- category playbooks ----------

interface Ctx { name: string; chain: string; capital: number; gas: number; hold: number }
type Play = (c: Ctx) => Omit<FarmStep, 'phase'>[];

const step = (text: string, capital: number, gasTx: number, gas: number, fee: number, minutes: number, when: string): Omit<FarmStep, 'phase'> => ({ text, capital_usd: capital, gas_usd: r2(gasTx * gas), fee_usd: fee, minutes, when });

const PLAYS: Array<[RegExp, Play]> = [
  [/curator|allocator|yield aggregator|liquidity manager/i, (c) => [
    step(`Deposit ${usd(c.capital * 0.6)} USDC into the largest ${c.name}-curated USDC vault on ${c.chain} (the vault page lists ${c.name} as curator); record the share balance.`, c.capital * 0.6, 2, c.gas, 0, 10, 'day 1'),
    step(`Put the other ${usd(c.capital * 0.4)} into a second ${c.name} vault with a different asset (WETH or a BTC wrapper) only if both assets and vaults are supported; otherwise keep the second allocation in cash.`, c.capital * 0.4, 2, c.gas, 0, 10, 'day 1'),
    step(`Each week check the vault's realised APY and allocation; if withdrawals are paused or the asset loses its peg, stop adding and request an exit.`, 0, 1, c.gas, 0, 10, 'weekly'),
  ]],
  [/^lending|uncollateral|collateral|cdp/i, (c) => [
    step(`Supply ${usd(c.capital)} USDC to ${c.name} on ${c.chain} and enable it as collateral.`, c.capital, 2, c.gas, 0, 10, 'day 1'),
    step(`Borrow 30% of the collateral value in a second stablecoin or ETH only if a borrow market exists; keep the health factor above 1.8.`, 0, 1, c.gas, 0, 5, 'day 1'),
    step(`Once a week repay and re-borrow a small amount (one round trip) and re-check the health factor; interest on the borrow is roughly ${usd(c.capital * 0.3 * 0.06 / 52)} a week at 6% APR.`, 0, 2, c.gas, r2(c.capital * 0.3 * 0.06 / 52), 10, 'weekly'),
  ]],
  [/^dex/i, (c) => [
    step(`Add ${usd(c.capital)} of liquidity to ${c.name}'s deepest stable or blue-chip pool on ${c.chain} (a ±2% concentrated range for stable pairs, full range otherwise).`, c.capital, 2, c.gas, 0, 15, 'day 1'),
    step(`Swap about ${usd(c.capital)} through ${c.name}'s own router each week, split into two trades, to register as a trader too; at a 0.05% to 0.3% pool fee that is ${usd(c.capital * 0.0005)} to ${usd(c.capital * 0.003)}.`, 0, 2, c.gas, r2(c.capital * 0.002), 5, 'weekly'),
    step(`Rebalance the LP range when price leaves it, at most once a week; out-of-range liquidity earns no fees and may not earn points.`, 0, 2, c.gas, 0, 10, 'weekly'),
  ]],
  [/derivative|option|perp/i, (c) => [
    step(`Deposit ${usd(c.capital)} USDC as margin on ${c.name} (${c.chain}).`, c.capital, 1, c.gas, 0, 10, 'day 1'),
    step(`Trade about ${usd(c.capital * 5)} notional a week at 2x or less, using limit (maker) orders on BTC or ETH; at a 0.02% maker / 0.05% taker fee that costs ${usd(c.capital * 5 * 0.0002)} to ${usd(c.capital * 5 * 0.0005)}.`, 0, 4, c.gas, r2(c.capital * 5 * 0.00035), 15, 'weekly'),
    step(`Close every position flat before the weekend and keep a stop-loss on each: rewards eligibility is unverified; trading P&L is excluded from this estimate.`, 0, 2, c.gas, 0, 5, 'weekly'),
  ]],
  [/rwa/i, (c) => [
    step(`Complete ${c.name}'s onboarding (KYC or accredited check if it asks) and whitelist your ${c.chain} address; allow 1 to 3 business days.`, 0, 0, c.gas, 0, 30, 'days 1-3'),
    step(`Subscribe ${usd(c.capital)} USDC to ${c.name}'s yield token on ${c.chain}, or buy it on a secondary DEX pool if the minimum ticket is above your size.`, c.capital, 2, c.gas, 0, 15, 'day 3'),
    step(`Use the yield token once a week where it is accepted (as lending collateral or in its DEX pool) only where the app documents support; otherwise hold without that transaction.`, 0, 2, c.gas, 0, 10, 'weekly'),
  ]],
  [/basis|stablecoin|dual-token|cedefi|algo|reserve/i, (c) => [
    step(`Mint ${usd(c.capital)} of ${c.name}'s stable or yield-bearing dollar with USDC on ${c.chain}; note the mint fee and the redemption delay on the mint page.`, c.capital, 2, c.gas, r2(c.capital * 0.001), 10, 'day 1'),
    step(`Stake or lock the minted dollar in ${c.name}'s savings or points vault (usually the step that earns the higher points multiplier).`, 0, 2, c.gas, 0, 5, 'day 1'),
    step(`Each week check the peg and the backing report; if it trades below $0.995, redeem or swap out rather than wait.`, 0, 0, c.gas, 0, 10, 'weekly'),
  ]],
  [/restak|staking pool|btc|anchor/i, (c) => [
    step(`Acquire ${usd(c.capital)} of the asset ${c.name} accepts (BTC, ETH or the ${c.chain} native token) on ${c.chain}.`, c.capital, 1, c.gas, r2(c.capital * 0.001), 10, 'day 1'),
    step(`Deposit or delegate it through ${c.name}, choose an operator or pool with low commission, and keep the receipt.`, 0, 2, c.gas, 0, 10, 'day 1'),
    step(`Plan for the unbonding period (often 7 to 21 days) before any exit, and claim the staking rewards monthly.`, 0, 1, c.gas, 0, 5, 'monthly'),
  ]],
  [/prediction/i, (c) => [
    step(`Deposit ${usd(c.capital)} USDC to ${c.name} on ${c.chain}.`, c.capital, 1, c.gas, 0, 10, 'day 1'),
    step(`Place three to five small positions a week on liquid markets (at most 10% of the balance each), mostly near-certain outcomes to keep capital stable.`, 0, 5, c.gas, r2(c.capital * 0.002), 15, 'weekly'),
    step(`Provide liquidity to one market with resting limit orders if ${c.name} offers maker rewards.`, 0, 2, c.gas, 0, 10, 'weekly'),
  ]],
  [/chain/i, (c) => [
    step(`Bridge ${usd(c.capital)} to ${c.name} and keep a little of its gas token.`, c.capital, 2, c.gas, 2, 15, 'day 1'),
    step(`Use three different native apps on it (a DEX swap, a lending deposit, an LP) so the address shows breadth, not one contract.`, 0, 6, c.gas, r2(c.capital * 0.003), 30, 'week 1'),
    step(`Make at least one transaction a week on separate days; many airdrop rules count active weeks, not volume.`, 0, 2, c.gas, 0, 5, 'weekly'),
  ]],
  [/payment|card/i, (c) => [
    step(`Open an account with ${c.name} on ${c.chain} and fund it with ${usd(c.capital)}.`, c.capital, 1, c.gas, 1, 20, 'day 1'),
    step(`Send or spend through it at least three times a week in small amounts; payment protocols reward recurring users over idle balances.`, 0, 3, c.gas, 1, 10, 'weekly'),
    step(`Keep the receipts of each payment and the routing fees paid, so the activity can be shown if an eligibility check asks.`, 0, 0, c.gas, 0, 5, 'weekly'),
  ]],
];

const DEFAULT_PLAY: Play = (c) => [
  step(`Deposit ${usd(c.capital)} USDC (or the asset it asks for) into ${c.name}'s main product on ${c.chain}.`, c.capital, 2, c.gas, 0, 10, 'day 1'),
  step(`Test a partial withdrawal of 1% (${usd(c.capital * .01)}) on ${c.chain}; confirm the received asset and fee before leaving the remaining deposit.`, 0, 2, c.gas, 0, 10, 'week 1'),
  step(`Check the deposit balance and withdrawal availability weekly; make one small deposit only if the product supports it.`, 0, 1, c.gas, 0, 5, 'weekly'),
];

function holdFor(age: number | null): number {
  if (age === null) return 90;
  if (age < 180) return 120; // young: a token is further out, points seasons run long
  if (age < 540) return 90;
  return 60; // long without a token: the window is likelier to close sooner
}

function farmChain(p: SnapshotProtocol): string {
  return p.chains[0] ?? 'Ethereum';
}

type RawPlan = Omit<Plan, 'verdict' | 'fixed_cost_usd' | 'cost_rate'>;

/** The plan's steps and totals at one deposit size. */
export function farmPlan(p: SnapshotProtocol, age: number | null, per1k: number, capital: number): RawPlan {
  const primary = p.chains[0] ?? 'Ethereum';
  const chain = farmChain(p);
  const gas = gasOf(chain);
  const hold = holdFor(age);
  const weeks = Math.round(hold / 7);
  const ctx: Ctx = { name: p.name, chain, capital, gas, hold };
  const play = PLAYS.find(([re]) => re.test(p.category ?? ''))?.[1] ?? DEFAULT_PLAY;
  const core = play(ctx);
  const fund = fundingRoute(chain);
  const wallet = walletOf(chain);
  const chainNote = `${chain} is the first listed snapshot chain; deployments and accepted assets must be checked in the app`;

  const steps: FarmStep[] = [
    { phase: 'Setup', text: `Connect ${wallet} on ${chain} to ${p.name} via its verified site. Confirm the deposit asset and withdrawal route before funding; ${chainNote}.`, capital_usd: 0, gas_usd: 0, fee_usd: 0, minutes: 10, when: 'day 1' },
    { phase: 'Setup', text: `Fund it: ${fund.text}, ${usd(capital)} plus about ${usd(Math.max(1, gas * 25))} for gas.`, capital_usd: 0, gas_usd: r2(gas), fee_usd: fund.fee, minutes: fund.minutes, when: 'day 1' },
    ...core.map((s, i) => ({ ...s, phase: (i === 0 ? 'Position' : s.when === 'weekly' || s.when === 'monthly' ? 'Repeat' : 'Position') as FarmStep['phase'] })),
    { phase: 'Hold', text: `Keep the position open at least ${hold} days (${weeks} weekly check-ins) as the modeled holding window; record balances and transaction hashes. No points or token launch is confirmed.`, capital_usd: 0, gas_usd: 0, fee_usd: 0, minutes: 5 * weeks, when: `${hold} days` },
    { phase: 'Exit', text: `Before withdrawing, check ${p.name}'s official points or rewards page from its verified social account; never sign a claim from a DM or ad, and redeem the position, wait for its displayed cooldown, then withdraw on ${chain}; budget two transactions.`, capital_usd: 0, gas_usd: r2(gas * 2), fee_usd: 0, minutes: 15, when: `day ${hold}` },
  ];

  // Totals: one-off gas and fees once, weekly ones for every week of the hold.
  let oneOff = 0;
  let weekly = 0;
  let setupMin = 0;
  let exitMin = 0;
  let weeklyMin = 0;
  for (const s of steps) {
    if (s.phase === 'Hold') { weeklyMin += s.minutes / weeks; continue; }
    const cost = s.gas_usd + s.fee_usd;
    if (s.when === 'weekly') { weekly += cost; weeklyMin += s.minutes; }
    else if (s.when === 'monthly') { weekly += cost / 4.3; weeklyMin += s.minutes / 4.3; }
    else { oneOff += cost; if (s.phase === 'Exit') exitMin += s.minutes; else setupMin += s.minutes; }
  }
  const total = r2(oneOff + weekly * weeks);
  const drop = Math.round((per1k * capital) / 1000);
  return {
    chain, primary_chain: primary, wallet, gas_per_tx_usd: gas, capital_usd: capital, hold_days: hold,
    setup_minutes: Math.round(setupMin), weekly_minutes: Math.round(weeklyMin), total_minutes: Math.round(setupMin + exitMin + weeklyMin * weeks),
    total_cost_usd: total, est_drop_usd: drop, roi_multiple: total > 0 ? r2(drop / total) : 0, steps,
  };
}

/** The smallest deposit tier at or above `need`, or null past the cap. */
const tierFor = (need: number): number | null => MODEL.deposit_tiers.find((t) => t >= need) ?? null;

/**
 * Size the plan. Costs are linear in the deposit (gas is fixed, swap and mint fees scale), so two plans
 * give cost(D) = fixed + rate x D exactly. The drop is per_1k x D / 1000. Break-even and 3x deposits follow;
 * the plan is sized to the smallest tier that reaches 3x, and the verdict says so.
 */
export function sizedPlan(p: SnapshotProtocol, age: number | null, per1k: number): Plan {
  const a = farmPlan(p, age, per1k, 1000);
  const b = farmPlan(p, age, per1k, 2000);
  const rate = Math.max(0, (b.total_cost_usd - a.total_cost_usd) / 1000);
  const fixed = Math.max(0, a.total_cost_usd - rate * 1000);
  const yieldRate = per1k / 1000;
  // Hours of work do not depend on the deposit; they are priced at a stated hourly rate.
  const hours = r2(a.total_minutes / 60);
  const timeCost = r2(hours * MODEL.time_usd_per_hour);
  const at = (k: number, cost: number): number | null => (yieldRate - k * rate > 0 ? Math.ceil((k * cost) / (yieldRate - k * rate)) : null);
  const breakeven = at(1, fixed);
  const cash3 = at(MODEL.worth_ratio, fixed);
  const allIn = at(1, fixed + timeCost);
  const worth = cash3 === null || allIn === null ? null : Math.max(cash3, allIn);
  const minTier = ETH_L1.has(a.chain) ? 1000 : 250;
  let label: Verdict['label'];
  let deposit: number;
  if (worth !== null && worth <= MODEL.deposit_max) { label = 'Worth it'; deposit = Math.max(minTier, tierFor(worth)!); }
  else if (breakeven !== null && breakeven <= MODEL.deposit_max) { label = 'Thin'; deposit = Math.max(minTier, tierFor(Math.min(MODEL.deposit_max, breakeven * 2))!); }
  else { label = 'Skip'; deposit = minTier; }
  const plan = farmPlan(p, age, per1k, deposit);
  const net = r2(plan.est_drop_usd - plan.total_cost_usd);
  const perHour = r2(net / hours);
  const text = label === 'Worth it'
    ? `Worth it at ${usd(deposit)}: est. drop ${usd(plan.est_drop_usd)} vs ${usd(plan.total_cost_usd)} gas and fees (x${plan.roi_multiple.toFixed(1)}) and ${hours} h of work over ${plan.hold_days} days, about ${usd(perHour)} per hour net; covers its gas from ${usd(breakeven!)}.`
    : label === 'Thin'
      ? `Thin: covers its gas and fees from ${usd(breakeven!)}, but paying ${hours} h of work at ${usd(MODEL.time_usd_per_hour)}/h and ${MODEL.worth_ratio}x the gas needs ${worth === null ? 'more than any deposit' : usd(worth)}; at ${usd(deposit)} the drop is ${usd(plan.est_drop_usd)} vs ${usd(plan.total_cost_usd)} cash cost.`
      : `Skip: at any deposit up to ${usd(MODEL.deposit_max)} the gas and fees (${usd(fixed)} fixed + ${(rate * 100).toFixed(2)}% of the deposit) outrun the implied drop of ${usd(per1k)} per $1k.`;
  return {
    ...plan, fixed_cost_usd: r2(fixed), cost_rate: rate,
    verdict: { label, deposit_usd: deposit, ratio: plan.roi_multiple, breakeven_usd: breakeven, worth_usd: worth, hours, time_cost_usd: timeCost, net_usd: net, usd_per_hour: perHour, text },
  };
}

/** A step as one board.json string: the action, then its capital, gas, fees and time. */
export function stepText(s: FarmStep, chain = 'snapshot chain'): string {
  const cost: string[] = [];
  if (s.capital_usd > 0) cost.push(`${usd(s.capital_usd)} capital`);
  if (s.gas_usd > 0) cost.push(`~${usd(s.gas_usd)} gas`);
  if (s.fee_usd > 0) cost.push(`~${usd(s.fee_usd)} fees`);
  const t = `[${s.phase} · ${chain}] ${s.text} Cost: ${cost.length ? cost.join(' + ') : 'none'}. Time: ${s.minutes} min, ${s.when}.`;
  return t.length > 600 ? `${t.slice(0, 597)}...` : t;
}

const RISKY_CATEGORY = /derivative|basis|leverag|algo|dual-token|uncollateral|option|prediction|cedefi/i;

export function riskOf(p: SnapshotProtocol, age: number | null, flag: Flag): Risk {
  const notes: string[] = [];
  let s = 0;
  const a = age ?? 365;
  if (a < 180) { s += 25; notes.push(`young: ${age === null ? 'no listing date' : `${a} days tracked`}`); }
  else if (a < 365) { s += 12; notes.push(`under a year tracked (${a} days)`); }
  if (p.tvl_usd < 20_000_000) { s += 20; notes.push('thin TVL under $20M'); }
  else if (p.tvl_usd < 100_000_000) { s += 10; notes.push('TVL under $100M'); }
  const g = p.change_7d ?? 0;
  if (g <= -15) { s += 20; notes.push(`TVL fell ${Math.abs(g).toFixed(1)}% in 7 days`); }
  else if (g <= -5) { s += 10; notes.push(`TVL down ${Math.abs(g).toFixed(1)}% in 7 days`); }
  if (g >= 100) { s += 10; notes.push('TVL more than doubled in a week: check it is not one deposit'); }
  if (p.chains.length <= 1) { s += 8; notes.push('single chain'); }
  if (RISKY_CATEGORY.test(p.category ?? '')) { s += 20; notes.push(`${p.category}: leverage or peg risk`); }
  if (flag.kind !== 'none') { s += MODEL.family_risk; notes.push(`${flag.reason}: a drop may go to that token's holders instead`); }
  if (notes.length === 0) notes.push('established, multi-chain, steady TVL');
  const score = Math.min(100, s);
  return { score, level: score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low', notes };
}

// ---------- flags: could part of this value already sit in someone else's token? ----------
// Read from the snapshot itself, shown and risk-scored, never multiplied into the fitted value:
//  - SIBLING: another protocol whose name starts with the same word records a token;
//  - PARENT: at or above the floor, pre-token, passing every name and category rule, yet off the
//    watchlist; the only rule left is DefiLlama's parentProtocol, so it is filed under a parent.
const firstWord = (name: string): string => name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] ?? '';

export function siblingIndex(snapshot: Snapshot): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of [...snapshot.protocols].sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || bySlug(a, b))) {
    const w = firstWord(p.name);
    if (w.length >= 3 && statusOf(p) !== 'pre-token' && !m.has(w)) m.set(w, `${p.name}${p.symbol ? ` (${p.symbol})` : ''}`);
  }
  return m;
}

export function flagOf(p: SnapshotProtocol, snapshot: Snapshot, siblings: Map<string, string>, onWatchlist: boolean): Flag {
  const sib = siblings.get(firstWord(p.name));
  if (sib !== undefined) return { kind: 'sibling', reason: `sibling token: ${sib} already records one` };
  if (!onWatchlist && p.tvl_usd >= snapshot.floor_usd) return { kind: 'parent', reason: 'above the floor but off the watchlist: filed under a parent protocol' };
  return { kind: 'none', reason: 'no token in its family on record' };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { fit, beta, cvPred, wfPred, set } = fitValueModel(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isCandidate(p));
  const siblings = siblingIndex(snapshot);
  const odds = peerOdds(snapshot, fit.fallback_age_days);
  const scored = chosen.map((p) => {
    const flag = flagOf(p, snapshot, siblings, watch.has(p.slug));
    const { implied, value } = valueOf(p, snapshot.as_of, beta, fit);
    const share = FAMILY_SHARE[familyOf(p.category)];
    const pool = Math.round(implied * share);
    const per1k = p.tvl_usd > 0 ? r2((pool * MODEL.depositor_share * 1000) / p.tvl_usd) : 0;
    return { p, implied, value, flag, share, pool, per1k };
  });
  scored.sort((x, y) => y.implied - x.implied || bySlug(x.p, y.p));
  const board = scored.map((s, i): BoardRow => {
    const plan = sizedPlan(s.p, s.value.age_days, s.per1k);
    return {
      rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains, tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d, listed_at: s.p.listed_at, token_status: 'pre-token', on_watchlist: watch.has(s.p.slug),
      implied_value_usd: s.implied, value: s.value, flag: s.flag, peer_token_share: odds(s.p),
      airdrop_share: s.share, airdrop_pool_usd: s.pool, per_1k_usd: s.per1k,
      risk: riskOf(s.p, s.value.age_days, s.flag), plan,
      farm_steps: [...plan.steps.map((s) => stepText(s, plan.chain)), `[Verdict] ${plan.verdict.text}`],
    };
  });
  const st = snapshot.protocols.map(statusOf);
  const live: LiveRow[] = set.map((p, i) => ({
    slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!,
    change_7d: p.change_7d, listed_at: p.listed_at, cv_pred_usd: Math.round(Math.exp(cvPred[i]!)),
    wf_pred_usd: wfPred[i] === null ? null : Math.round(Math.exp(wfPred[i]!)),
  })).sort((a, b) => b.mcap_usd - a.mcap_usd || bySlug(a, b));
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model_version: MODEL_VERSION, model: MODEL, fit,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: st.filter((s) => s === 'pre-token').length,
      trading: st.filter((s) => s === 'trading').length,
      fit_set: set.length,
      recorded: st.filter((s) => s === 'recorded').length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
      covered: board.filter((r) => watch.has(r.slug)).length,
      early: board.filter((r) => !watch.has(r.slug)).length,
      flagged: board.filter((r) => r.flag.kind !== 'none').length,
    },
    rows: board,
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v !== '-' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    const p = (v ?? {}) as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || num(p.tvl_usd) === null) throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name, category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: num(p.tvl_usd)!, change_7d: num(p.change_7d), mcap_usd: num(p.mcap_usd), listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id), symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why the gate would refuse this board, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i} has rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

/** data.js: the dashboard's whole dataset as one script beside the page, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  const compact = { ...radar, rows: radar.rows.map(({ farm_steps: _f, ...rest }) => rest) };
  return `window.RADAR=${JSON.stringify(compact)};\n`;
}
