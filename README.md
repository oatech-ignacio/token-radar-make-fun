# token-radar-make-fun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/oatech-ignacio/token-radar-make-fun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/oatech-ignacio/token-radar-make-fun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty. It reads a sealed DefiLlama
snapshot, finds the protocols that record no token yet, prices each one's would-be token from the snapshot's
own figures with one fitted equation, `ln V = b0 + b1·ln TVL + b2·ln(1+7d growth) + b3·ln(1+years with no token) + fitted first-listed-chain effect`.
The coefficients are fitted (Huber IRLS, base ridge 0.5 and chain-effect ridge 5) on the snapshot's own protocols whose token
trades, and evaluated with exploratory 5-fold validation, a listing-date split, a term-by-term
ablation and a flat mcap/TVL baseline. Primary-chain effects improve 5-fold log-cap R² from
0.093 to 0.132 (rank correlation 0.34 to 0.40); listing-date R² remains negative at −0.104.
Nested feature-family selection gives R² 0.124. These are snapshot diagnostics, not a historical backtest. Each row carries an 80% band from the held-out errors. It
estimates the airdrop pool and the drop per $1,000, and writes a chain- and category-specific farm plan
with gas, fees and minutes per step. Routes are conditional: the snapshot cannot verify accepted
assets, deployments or eligibility. Gas, shares and the hourly time price are explicit assumptions. Costs are linear in the deposit, so every plan is sized to the
deposit where the drop pays 3× its gas and your hours, with a Worth it / Thin / Skip verdict. The
dashboard is a static, offline page. It has an integrity strip that answers the checks (coverage x/40,
pre-token vs traded, model fit), KPIs, a sortable and filterable board, and a detail view that prints
each value as its equation. The traded fit set sits on its own tab with blind predictions.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. The build includes an exact excerpt of the
valuation functions in `out/dashboard/valuation.txt`, so the dossier exposes the fitted model too.
It also writes `out/dashboard/README.md`, a short brief whose figures come from the same run; it sorts first in the dossier.

```sh
node tools/verify.mjs out
node tools/shot.mjs out screenshots 1-board '2-detail=p=upshift' '3-filtered=status=early&risk=Low&verdict=Worth%20it&sort=verdict&dir=-1'
# Rebuild after capturing screenshots, then run verify again.
```

Verification reproduces the seven published scorer checks locally and adds stricter screenshot,
source-size, pre-token-status and plan-accounting checks. It does not invoke the sealed judge.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
