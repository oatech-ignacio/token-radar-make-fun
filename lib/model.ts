// Token radar model, "comps-3": one sealed snapshot in, one ranked board out.
//
// Every number below is derived from the snapshot's own ten fields. No protocol name is special-cased:
// the same functions score every row, and the only tables are about categories and chains (what a
// lending market or a Solana transaction costs), never about which protocol should win.
//
// 1. Status. A protocol is PRE-TOKEN when its record carries no token at all (no symbol, no CoinGecko id,
//    no market cap). TRADING when it records a market cap. RECORDED when it names a symbol or id but no
//    market cap. Only pre-token protocols are ranked; the other two are the comparables and are kept apart.
//
// 2. Comparable multiple. For every category, the median mcap/TVL of the snapshot's TRADING protocols in
//    it (CEX excluded: an exchange token is not priced on TVL). Thin categories are shrunk toward the
//    all-category median in log space, weight n / (n + K):
//        ln M_cat = (n x ln med_cat + K x ln med_all) / (n + K),   then clamped to [M_MIN, M_MAX]
//
// 3. Implied value (the token's implied market cap at launch, in USD):
//        implied = TVL x M_cat x m_momentum x m_age x m_reach x m_family
//        m_family   = 0.35 when a same-named protocol in the snapshot already records a token,
//                     0.60 when it is above the floor yet off the watchlist (filed under a parent), else 1
//        m_momentum = (1 + clamp(change_7d, -50, 100) / 100) ^ 0.5          0.71 .. 1.41
//        m_age      = 0.80 + 0.40 x min(days listed with no token, 1095) / 1095   0.80 .. 1.20
//        m_reach    = 1 + 0.04 x min(chains - 1, 5)                          1.00 .. 1.20
//
// 4. Airdrop. share = the category family's typical community allocation (user-facing 12%, DeFi
//    infrastructure 10%, institutional / curated 6%); pool = implied x share; 70% of the pool is assumed
//    to reach depositors pro rata to TVL, so  per_1k = pool x 0.7 x 1,000 / TVL.
//
// 5. Risk 0..100 from the record: youth, size, seven-day outflow, single chain, category.
//
// 6. Farm plan: the cheapest of the protocol's top three chains, that chain's wallet and gas, the
//    category's own actions, a position sized to the protocol's TVL, a hold window from its age.

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

export const MODEL_VERSION = 'comps-3';

/** The model's constants, all stated on the dashboard's Method panel. */
export const MODEL = {
  shrink_k: 4,
  multiple_min: 0.03,
  multiple_max: 1.5,
  growth_floor: -50,
  growth_cap: 100,
  growth_exponent: 0.5,
  age_floor: 0.8,
  age_range: 0.4,
  age_cap_days: 1095,
  unknown_age_days: 365,
  reach_step: 0.04,
  reach_cap: 5,
  depositor_share: 0.7,
  family_sibling: 0.35,
  family_parent: 0.6,
} as const;

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

export interface Breakdown {
  tvl_usd: number;
  category_multiple: number;
  category_comps: number;
  category_median: number | null;
  growth_pct: number;
  m_momentum: number;
  age_days: number | null;
  m_age: number;
  chain_count: number;
  m_reach: number;
  m_family: number;
  family_kind: Family['kind'];
  family_reason: string;
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
  total_cost_usd: number;
  est_drop_usd: number;
  roi_multiple: number;
  steps: FarmStep[];
}

export interface Risk {
  score: number;
  level: 'Low' | 'Medium' | 'High';
  notes: string[];
}

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
  airdrop_share: number;
  airdrop_pool_usd: number;
  per_1k_usd: number;
  breakdown: Breakdown;
  risk: Risk;
  plan: Plan;
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's own number, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

export interface Comparable {
  category: string;
  trading: number;
  median: number | null;
  multiple: number;
  pre_token: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  global_median: number;
  counts: { protocols: number; pre_token: number; trading: number; recorded: number; ranked: number; watchlist: number; early: number };
  comparables: Comparable[];
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

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : Math.sqrt(s[m - 1]! * s[m]!);
}

/** Category multiples from the trading protocols, shrunk toward the all-category median. */
export function comparables(snapshot: Snapshot): { global: number; table: Map<string, Comparable> } {
  const ratios = new Map<string, number[]>();
  const preCount = new Map<string, number>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    const cat = p.category ?? 'Uncategorized';
    if (isCandidate(p) || snapshot.watchlist.includes(p.slug)) preCount.set(cat, (preCount.get(cat) ?? 0) + 1);
    if (statusOf(p) !== 'trading' || p.category === 'CEX' || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd! / p.tvl_usd;
    all.push(ratio);
    ratios.set(cat, [...(ratios.get(cat) ?? []), ratio]);
  }
  const global = median(all) ?? 0.2;
  const table = new Map<string, Comparable>();
  const cats = new Set([...ratios.keys(), ...preCount.keys()]);
  for (const cat of [...cats].sort()) {
    const xs = ratios.get(cat) ?? [];
    const med = median(xs);
    const n = xs.length;
    const k = MODEL.shrink_k;
    const ln = med === null ? Math.log(global) : (n * Math.log(med) + k * Math.log(global)) / (n + k);
    table.set(cat, { category: cat, trading: n, median: med === null ? null : r4(med), multiple: r4(clamp(Math.exp(ln), MODEL.multiple_min, MODEL.multiple_max)), pre_token: preCount.get(cat) ?? 0 });
  }
  return { global: r4(global), table };
}

type Family = 'user' | 'defi' | 'inst';
const FAMILY_SHARE: Record<Family, number> = { user: 0.12, defi: 0.1, inst: 0.06 };

function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (/dex|derivative|perp|option|prediction|payment|card|farm|launchpad|nft|gaming|chain|otc/.test(c)) return 'user';
  if (/curator|allocator|rwa|cedefi|insurance|basis/.test(c)) return 'inst';
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
    step(`Put the other ${usd(c.capital * 0.4)} into a second ${c.name} vault with a different asset (WETH or a BTC wrapper) so points accrue on two strategies.`, c.capital * 0.4, 2, c.gas, 0, 10, 'day 1'),
    step(`Each week check the vault's realised APY and allocation; if a market it lends to drops below 90% utilisation health, move to the other vault.`, 0, 1, c.gas, 0, 10, 'weekly'),
  ]],
  [/^lending|uncollateral|collateral|cdp/i, (c) => [
    step(`Supply ${usd(c.capital)} USDC to ${c.name} on ${c.chain} and enable it as collateral.`, c.capital, 2, c.gas, 0, 10, 'day 1'),
    step(`Borrow 30% of the collateral value in a second stablecoin or ETH so the account shows both supply and borrow activity; keep the health factor above 1.8.`, 0, 1, c.gas, 0, 5, 'day 1'),
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
    step(`Close every position flat before the weekend and keep a stop-loss on each: volume earns points, directional bets only add risk.`, 0, 2, c.gas, 0, 5, 'weekly'),
  ]],
  [/rwa/i, (c) => [
    step(`Complete ${c.name}'s onboarding (KYC or accredited check if it asks) and whitelist your ${c.chain} address; allow 1 to 3 business days.`, 0, 0, c.gas, 0, 30, 'days 1-3'),
    step(`Subscribe ${usd(c.capital)} USDC to ${c.name}'s yield token on ${c.chain}, or buy it on a secondary DEX pool if the minimum ticket is above your size.`, c.capital, 2, c.gas, 0, 15, 'day 3'),
    step(`Use the yield token once a week where it is accepted (as lending collateral or in its DEX pool) so it registers as an active holder, not a dormant one.`, 0, 2, c.gas, 0, 10, 'weekly'),
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
  step(`Use a second feature of ${c.name} (a vault, a lock, a vote or a referral) so the address shows more than one action.`, 0, 2, c.gas, 0, 10, 'week 1'),
  step(`Interact once a week on a different day each week; most programs count active weeks.`, 0, 1, c.gas, 0, 5, 'weekly'),
];

function capitalFor(tvl: number, chain: string): number {
  const base = tvl >= 1_000_000_000 ? 3000 : tvl >= 250_000_000 ? 2000 : tvl >= 50_000_000 ? 1000 : 500;
  return ETH_L1.has(chain) ? Math.max(base, 2000) : base; // mainnet gas eats a small position
}

function holdFor(age: number | null): number {
  if (age === null) return 90;
  if (age < 180) return 120; // young: a token is further out, points seasons run long
  if (age < 540) return 90;
  return 60; // long without a token: the window is likelier to close sooner
}

export function farmPlan(p: SnapshotProtocol, age: number | null, per1k: number): Plan {
  const top = p.chains.slice(0, 3);
  const primary = p.chains[0] ?? 'Ethereum';
  const chain = top.length === 0 ? 'Ethereum' : [...top].sort((a, b) => gasOf(a) - gasOf(b) || top.indexOf(a) - top.indexOf(b))[0]!;
  const gas = gasOf(chain);
  const capital = capitalFor(p.tvl_usd, chain);
  const hold = holdFor(age);
  const weeks = Math.round(hold / 7);
  const ctx: Ctx = { name: p.name, chain, capital, gas, hold };
  const play = PLAYS.find(([re]) => re.test(p.category ?? ''))?.[1] ?? DEFAULT_PLAY;
  const core = play(ctx);
  const fund = fundingRoute(chain);
  const wallet = walletOf(chain);
  const chainNote = chain === primary ? `${chain} is where it holds the most TVL` : `${primary} holds more TVL but ${chain} is the cheapest of its top chains at about ${usd(gas)} a transaction`;

  const steps: FarmStep[] = [
    { phase: 'Setup', text: `Create a fresh ${chain} address in ${wallet} used only for ${p.name}; ${chainNote}.`, capital_usd: 0, gas_usd: 0, fee_usd: 0, minutes: 10, when: 'day 1' },
    { phase: 'Setup', text: `Fund it: ${fund.text}, ${usd(capital)} plus about ${usd(Math.max(1, gas * 25))} for gas.`, capital_usd: 0, gas_usd: r2(gas), fee_usd: fund.fee, minutes: fund.minutes, when: 'day 1' },
    ...core.map((s, i) => ({ ...s, phase: (i === 0 ? 'Position' : s.when === 'weekly' || s.when === 'monthly' ? 'Repeat' : 'Position') as FarmStep['phase'] })),
    { phase: 'Hold', text: `Keep the position open at least ${hold} days (${weeks} weekly check-ins) so it spans several points snapshots; log every transaction hash in a sheet.`, capital_usd: 0, gas_usd: 0, fee_usd: 0, minutes: 5 * weeks, when: `${hold} days` },
    { phase: 'Exit', text: `Before withdrawing, check ${p.name}'s official points or rewards page from its verified social account; never sign a claim from a DM or ad, and withdraw in one transaction.`, capital_usd: 0, gas_usd: r2(gas * 2), fee_usd: 0, minutes: 15, when: `day ${hold}` },
  ];

  // Totals: one-off gas and fees once, weekly ones for every week of the hold.
  let oneOff = 0;
  let weekly = 0;
  let setupMin = 0;
  let weeklyMin = 0;
  for (const s of steps) {
    if (s.phase === 'Hold') continue;
    const cost = s.gas_usd + s.fee_usd;
    if (s.when === 'weekly') { weekly += cost; weeklyMin += s.minutes; }
    else if (s.when === 'monthly') { weekly += cost / 4.3; weeklyMin += s.minutes / 4.3; }
    else { oneOff += cost; setupMin += s.minutes; }
  }
  const total = r2(oneOff + weekly * weeks);
  const drop = Math.round((per1k * capital) / 1000);
  return {
    chain, primary_chain: primary, wallet, gas_per_tx_usd: gas, capital_usd: capital, hold_days: hold,
    setup_minutes: Math.round(setupMin), weekly_minutes: Math.round(weeklyMin), total_cost_usd: total,
    est_drop_usd: drop, roi_multiple: total > 0 ? r2(drop / total) : 0, steps,
  };
}

/** A step as one board.json string: the action, then its capital, gas, fees and time. */
export function stepText(s: FarmStep): string {
  const cost: string[] = [];
  if (s.capital_usd > 0) cost.push(`${usd(s.capital_usd)} capital`);
  if (s.gas_usd > 0) cost.push(`~${usd(s.gas_usd)} gas`);
  if (s.fee_usd > 0) cost.push(`~${usd(s.fee_usd)} fees`);
  const t = `[${s.phase}] ${s.text} Cost: ${cost.length ? cost.join(' + ') : 'none'}. Time: ${s.minutes} min, ${s.when}.`;
  return t.length > 600 ? `${t.slice(0, 597)}...` : t;
}

const RISKY_CATEGORY = /derivative|basis|leverag|algo|dual-token|uncollateral|option|prediction|cedefi/i;

export function riskOf(p: SnapshotProtocol, age: number | null): Risk {
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
  if (notes.length === 0) notes.push('established, multi-chain, steady TVL');
  const score = Math.min(100, s);
  return { score, level: score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low', notes };
}

// ---------- family: is part of this value already priced in someone else's token? ----------
// Two signals, both read from the snapshot itself:
//  - a SIBLING TOKEN: another protocol whose name starts with the same word records a token
//    ("Solv Strategies" beside "Solv Basis Trading" trading as SOLV): x FAMILY_SIBLING;
//  - a PARENT RECORD: at or above the floor, pre-token, passing every name and category rule, yet left off
//    the watchlist. The only rule left is DefiLlama's parentProtocol, so it is filed under a parent: x FAMILY_PARENT.
export const FAMILY_SIBLING = MODEL.family_sibling;
export const FAMILY_PARENT = MODEL.family_parent;

const firstWord = (name: string): string => name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] ?? '';

export interface Family { factor: number; kind: 'none' | 'sibling' | 'parent'; reason: string }

export function familyIndex(snapshot: Snapshot): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of [...snapshot.protocols].sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || bySlug(a, b))) {
    const w = firstWord(p.name);
    if (w.length >= 3 && statusOf(p) !== 'pre-token' && !m.has(w)) m.set(w, `${p.name}${p.symbol ? ` (${p.symbol})` : ''}`);
  }
  return m;
}

export function familyOfProtocol(p: SnapshotProtocol, snapshot: Snapshot, siblings: Map<string, string>, onWatchlist: boolean): Family {
  const sib = siblings.get(firstWord(p.name));
  if (sib !== undefined) return { factor: FAMILY_SIBLING, kind: 'sibling', reason: `sibling token: ${sib} already records one` };
  if (!onWatchlist && p.tvl_usd >= snapshot.floor_usd) return { factor: FAMILY_PARENT, kind: 'parent', reason: 'above the floor but off the watchlist: filed under a parent protocol' };
  return { factor: 1, kind: 'none', reason: 'no token in its family on record' };
}

/** The implied value and its full breakdown for one protocol. */
export function impliedValue(p: SnapshotProtocol, asOf: string, comps: Map<string, Comparable>, global: number, family: Family = { factor: 1, kind: 'none', reason: '' }): { implied: number; b: Breakdown } {
  const cat = comps.get(p.category ?? 'Uncategorized');
  const mult = cat?.multiple ?? global;
  const growth = clamp(p.change_7d ?? 0, MODEL.growth_floor, MODEL.growth_cap);
  const mMom = Math.pow(1 + growth / 100, MODEL.growth_exponent);
  const age = ageDays(asOf, p.listed_at);
  const mAge = MODEL.age_floor + (MODEL.age_range * Math.min(age ?? MODEL.unknown_age_days, MODEL.age_cap_days)) / MODEL.age_cap_days;
  const mReach = 1 + MODEL.reach_step * Math.min(Math.max(p.chains.length - 1, 0), MODEL.reach_cap);
  const implied = Math.max(1, Math.round(p.tvl_usd * mult * mMom * mAge * mReach * family.factor));
  return {
    implied,
    b: { tvl_usd: p.tvl_usd, category_multiple: mult, category_comps: cat?.trading ?? 0, category_median: cat?.median ?? null, growth_pct: r2(growth), m_momentum: r4(mMom), age_days: age, m_age: r4(mAge), chain_count: p.chains.length, m_reach: r4(mReach), m_family: family.factor, family_kind: family.kind, family_reason: family.reason },
  };
}

/** A family token or parent record means a drop may go to the parent's holders instead: +15 risk. */
function familyRisk(risk: Risk, b: Breakdown): Risk {
  if (b.family_kind === 'none') return risk;
  const score = Math.min(100, risk.score + 15);
  const notes = risk.notes[0] === 'established, multi-chain, steady TVL' ? [] : risk.notes;
  return { score, level: score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low', notes: [...notes, b.family_reason] };
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; comps: Map<string, Comparable>; global: number } {
  const { global, table } = comparables(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isCandidate(p));
  const siblings = familyIndex(snapshot);
  const scored = chosen.map((p) => {
    const fam = familyOfProtocol(p, snapshot, siblings, watch.has(p.slug));
    const { implied, b } = impliedValue(p, snapshot.as_of, table, global, fam);
    const share = FAMILY_SHARE[familyOf(p.category)];
    const pool = Math.round(implied * share);
    const per1k = p.tvl_usd > 0 ? r2((pool * MODEL.depositor_share * 1000) / p.tvl_usd) : 0;
    return { p, implied, b, share, pool, per1k };
  });
  scored.sort((x, y) => y.implied - x.implied || bySlug(x.p, y.p));
  const board = scored.map((s, i): BoardRow => {
    const plan = farmPlan(s.p, s.b.age_days, s.per1k);
    return {
      rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains, tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d, listed_at: s.p.listed_at, token_status: 'pre-token', on_watchlist: watch.has(s.p.slug),
      implied_value_usd: s.implied, airdrop_share: s.share, airdrop_pool_usd: s.pool, per_1k_usd: s.per1k,
      breakdown: s.b, risk: familyRisk(riskOf(s.p, s.b.age_days), s.b), plan, farm_steps: plan.steps.map(stepText),
    };
  });
  return { board, comps: table, global };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => statusOf(p) === 'trading' && p.category !== 'CEX' && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || bySlug(a, b))
    .slice(0, 80)
    .map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, chains: p.chains.slice(0, 4), tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: r4(p.mcap_usd! / p.tvl_usd), change_7d: p.change_7d }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, comps, global } = buildBoard(snapshot);
  const st = snapshot.protocols.map(statusOf);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    global_median: global,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: st.filter((s) => s === 'pre-token').length,
      trading: st.filter((s) => s === 'trading').length,
      recorded: st.filter((s) => s === 'recorded').length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
      early: board.filter((r) => !watch.has(r.slug)).length,
    },
    comparables: [...comps.values()].filter((c) => c.pre_token > 0).sort((a, b) => b.pre_token - a.pre_token || (a.category < b.category ? -1 : 1)),
    rows: board,
    live: liveRows(snapshot),
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
