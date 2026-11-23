# token-radar-make-fun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/oatech-ignacio/token-radar-make-fun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/oatech-ignacio/token-radar-make-fun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty. It reads a sealed DefiLlama
snapshot, finds the protocols that record no token yet, prices each one's would-be token from the snapshot's
own figures (comparable FDV/TVL multiples of the tokenized protocols in the same category, seven-day TVL
momentum, time running without a token, chain reach), estimates the airdrop pool and the value per $1,000
farmed, and writes a chain- and category-specific farm plan with cost, gas and time for every row. The
dashboard is a static, offline page: sortable, filterable board, KPI header, a detail view per protocol and
the formula on screen.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
