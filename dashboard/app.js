// Pre-Token Radar dashboard. Reads window.RADAR (data.js, written by main.ts from lib/model.ts; board.json
// is the same rows) and renders three views: the ranked pre-token board, the trading protocols the value
// model is fitted on (kept apart, never ranked), and the model with its blind tests.
// No framework, no network. Every figure on screen is read from RADAR or computed here from it.
// valuation.txt is extracted from the executable model on every build: fitValueModel, features,
// fitHuber and valueOf. It is included whole in the dossier for an auditable fitted equation.
// State lives in the URL hash so every view (a filter, an open detail) is a link.
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  if (!R) { app.innerHTML = '<p class="empty">data.js is missing: run main.ts first.</p>'; return; }

  var DEFAULTS = { tab: 'board', q: '', cat: '', chain: '', status: '', min: '0', risk: '', verdict: '', sort: 'rank', dir: '1', p: '' };
  var S = readHash();
  var BY = {};
  R.rows.forEach(function (r) { BY[r.slug] = r; });
  var F = R.fit, C = R.counts, M = R.model;
  var MAX_IMPLIED = R.rows[0].implied_value_usd;

  // ---------- formatting ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function money(n) {
    var a = Math.abs(n), s = n < 0 ? '−$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + (a / 1e3).toFixed(a >= 1e5 || a % 1000 === 0 ? 0 : 1) + 'K';
    if (a >= 100) return s + Math.round(a).toLocaleString('en-US');
    return s + (a >= 10 ? a.toFixed(0) : a.toFixed(2));
  }
  function pct(n) { return n === null || n === undefined ? '<span class="pmeta">n/a</span>' : '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>'; }
  function days(d) { if (d === null || d === undefined) return 'n/a'; return d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function sg(n, d) { return (n < 0 ? '− ' : '+ ') + Math.abs(n).toFixed(d); }
  function f2(n) { return n.toFixed(2); }
  function sum(rows, f) { return rows.reduce(function (s, r) { return s + f(r); }, 0); }
  function median(xs) { var s = xs.slice().sort(function (a, b) { return a - b; }); return s.length ? s[s.length >> 1] : 0; }
  function coef(i) { return F.coef[i]; }
  function badge(r) {
    var b = r.on_watchlist ? '<span class="badge b-wl" title="On the snapshot watchlist: ≥ floor TVL, no token recorded">WATCHLIST</span>'
      : r.flag.kind === 'parent' ? '<span class="badge b-sub" title="' + esc(r.flag.reason) + '">SUB-PRODUCT</span>'
      : '<span class="badge b-early" title="Off the watchlist, no token recorded">EARLY</span>';
    return b + (r.flag.kind === 'sibling' ? '<span class="badge b-trade" title="' + esc(r.flag.reason) + '">FAMILY TOKEN</span>' : '');
  }
  function vtag(v) { return '<span class="vd v-' + v.label.replace(' ', '') + '">' + v.label + '</span>'; }

  // ---------- hash state ----------
  function readHash() {
    var s = {}, k;
    for (k in DEFAULTS) s[k] = DEFAULTS[k];
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0 && kv.slice(0, i) in DEFAULTS) s[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return s;
  }
  function writeHash() {
    var parts = [];
    for (var k in DEFAULTS) if (S[k] !== DEFAULTS[k]) parts.push(k + '=' + encodeURIComponent(S[k]));
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname);
  }

  // ---------- board columns ----------
  var COLS = [
    { k: 'rank', l: '#', v: function (r) { return r.rank; }, h: function (r) { return '<td class="rk">' + r.rank + '</td>'; } },
    { k: 'name', l: 'Pre-token protocol', v: function (r) { return r.name.toLowerCase(); }, h: function (r) {
      return '<td><span class="pname">' + esc(r.name) + '</span>' + badge(r) + '<div class="pmeta">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</div></td>';
    } },
    { k: 'tvl', l: 'TVL', n: 1, v: function (r) { return r.tvl_usd; }, h: function (r) { return '<td class="n">' + money(r.tvl_usd) + '</td>'; } },
    { k: 'g', l: '7d TVL', n: 1, v: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; }, h: function (r) { return '<td class="n">' + pct(r.change_7d) + '</td>'; } },
    { k: 'age', l: 'No token for', n: 1, v: function (r) { return r.value.age_days === null ? -1 : r.value.age_days; }, h: function (r) { return '<td class="n">' + days(r.value.age_days) + '</td>'; } },
    { k: 'implied', l: 'Implied value', n: 1, v: function (r) { return r.implied_value_usd; }, h: function (r) {
      var w = Math.max(2, Math.round(56 * Math.sqrt(r.implied_value_usd / MAX_IMPLIED)));
      return '<td class="n"><span class="bar" style="width:' + w + 'px"></span><b>' + money(r.implied_value_usd) + '</b><div class="pmeta">' + money(r.value.low_usd) + '–' + money(r.value.high_usd) + '</div></td>';
    } },
    { k: 'vt', l: 'V / TVL', n: 1, v: function (r) { return r.value.to_tvl; }, h: function (r) { return '<td class="n">' + (100 * r.value.to_tvl).toFixed(1) + '%</td>'; } },
    { k: 'peer', l: 'Peers w/ token', n: 1, v: function (r) { return r.peer_token_share; }, h: function (r) { return '<td class="n" title="Of the ' + M.peer_k + ' protocols nearest in TVL and age, the share that record a token">' + Math.round(100 * r.peer_token_share) + '%</td>'; } },
    { k: 'per1k', l: 'Drop / $1k', n: 1, v: function (r) { return r.per_1k_usd; }, h: function (r) { return '<td class="n">' + money(r.per_1k_usd) + '</td>'; } },
    { k: 'verdict', l: 'Farm verdict', s: 'net $/h', v: function (r) { return r.plan.verdict.usd_per_hour; }, h: function (r) {
      var v = r.plan.verdict;
      return '<td>' + vtag(v) + '<div class="pmeta">at ' + money(v.deposit_usd) + ' · ' + money(v.usd_per_hour) + '/h net</div></td>';
    } },
    { k: 'cost', l: 'Cost · time', n: 1, v: function (r) { return r.plan.total_cost_usd; }, h: function (r) {
      var p = r.plan;
      return '<td class="n">' + money(p.total_cost_usd) + '<div class="pmeta">' + p.plan_h + ' h · ' + p.hold_days + ' d</div></td>';
    } },
    { k: 'risk', l: 'Risk', v: function (r) { return r.risk.score; }, h: function (r) { return '<td><span class="risk r-' + r.risk.level + '" title="' + esc(r.risk.notes.join('; ')) + '">' + r.risk.level + '</span></td>'; } },
  ];
  R.rows.forEach(function (r) { r.plan.plan_h = r.plan.verdict.hours.toFixed(1); });

  function filtered() {
    var q = S.q.trim().toLowerCase(), min = +S.min || 0;
    var rows = R.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (S.cat && (r.category || 'Uncategorized') !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.status === 'wl' && !r.on_watchlist) return false;
      if (S.status === 'early' && r.on_watchlist) return false;
      if (S.status === 'clean' && r.flag.kind !== 'none') return false;
      if (S.risk && r.risk.level !== S.risk) return false;
      if (S.verdict && r.plan.verdict.label !== S.verdict) return false;
      return r.tvl_usd >= min;
    });
    var col = COLS.filter(function (c) { return c.k === S.sort; })[0] || COLS[0];
    var dir = +S.dir || 1;
    rows.sort(function (a, b) { var va = col.v(a), vb = col.v(b); return (va < vb ? -1 : va > vb ? 1 : a.rank - b.rank) * dir; });
    return rows;
  }

  function options(values, current, all) {
    return '<option value="">' + all + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v[0]) + '"' + (v[0] === current ? ' selected' : '') + '>' + esc(v[1]) + '</option>';
    }).join('');
  }
  function tally(fn) {
    var m = {};
    R.rows.forEach(function (r) { fn(r).forEach(function (k) { m[k] = (m[k] || 0) + 1; }); });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }).map(function (k) { return [k, k + ' (' + m[k] + ')']; });
  }
  var CATS = tally(function (r) { return [r.category || 'Uncategorized']; });
  var CHAINS = tally(function (r) { return r.chains; });
  var VERDICTS = tally(function (r) { return [r.plan.verdict.label]; });

  // ---------- the cover: integrity strip, KPIs, the fitted equation and its blind test ----------
  function strip() {
    var covered = R.rows.filter(function (r) { return r.on_watchlist; }).length;
    var stepsOk = R.rows.every(function (r) { return r.plan.steps.length >= 3 && r.plan.steps.every(function (s) { return s.minutes > 0 || s.phase === 'Setup'; }); });
    var mono = R.rows.every(function (r, i) { return r.rank === i + 1 && (i === 0 || r.implied_value_usd <= R.rows[i - 1].implied_value_usd); });
    var beat = F.cv.r2 > F.baseline_cv.r2 && F.walk.r2 > F.baseline_walk.r2;
    return '<div class="strip"><div class="scope"><b>' + covered + '/' + C.watchlist + '</b><span>watchlist · ' + C.early + ' early finds</span></div>' +
      '<div class="scope"><b>' + C.ranked + ' PRE-TOKEN</b><span>no symbol, CoinGecko id or cap</span></div>' +
      '<div class="scope excluded"><b>' + C.trading + ' TRADING · ' + C.recorded + ' RECORDED</b><span>never ranked · ' + C.fit_set + ' fit the model</span></div>' +
      '<div class="scope"><b>' + (mono && stepsOk ? '✓ Verified' : 'Check data') + '</b><span>values descend · plans costed</span></div></div>';
  }

  function equation(compact) {
    var b = F.coef.map(function (c) { return c.b; });
    return '<span class="eq">ln V = ' + f2(b[0]) + ' ' + sg(b[1], 3) + '·ln TVL ' + sg(b[2], 3) + '·ln(1+7d) ' + sg(b[3], 3) + '·ln(1+years) + fitted chain effect</span>' +
      (compact ? '' : '<small>± ' + F.coef.slice(0, 4).map(function (c) { return c.se.toFixed(2); }).join(' / ') + ' (jackknife SE) · Huber IRLS, ridge ' + M.ridge + ' · chain ridge ' + M.effect_ridge + ' · n = ' + F.n + ' trading, CEX left out · 80% band ×' + Math.exp(F.band.q10).toFixed(2) + ' to ×' + Math.exp(F.band.q90).toFixed(1) + ' from held-out errors</small>');
  }

  // Blind tests on the traded peers: the fitted equation against a flat mcap/TVL rule, same folds, same split.
  // Each metric is scored on both held-out sets; a win is a better number than the flat rule on the same rows.
  var TESTS = [['Within ×3 of real cap', 'hit3', 1], ['Median miss', 'med_err_x', -1], ['R² (log cap)', 'r2', 1]];
  var PAIRS = [[F.cv, F.baseline_cv], [F.walk, F.baseline_walk]];
  var WINS = 0;
  TESTS.forEach(function (t) { PAIRS.forEach(function (p) { if ((p[0][t[1]] - p[1][t[1]]) * t[2] > 0) WINS++; }); });
  var NTESTS = TESTS.length * PAIRS.length;
  function fmtT(t, x) { return t[1] === 'hit3' ? Math.round(100 * x) + '%' : t[1] === 'med_err_x' ? '×' + f2(x) : f2(x); }
  function blindBox() {
    return '<div class="scbox"><span class="cap">BLIND TEST · ' + F.n + ' TRADED PEERS · FITTED WINS ' + WINS + '/' + NTESTS + '</span><table class="mini"><thead><tr><th>held out</th><th class="n" colspan="2">5-fold · ' + F.cv.n + '</th><th class="n" colspan="2">newest ' + F.walk.n + '</th></tr></thead><tbody>' +
      TESTS.map(function (t) {
        return '<tr><td>' + t[0] + '</td>' + PAIRS.map(function (p) {
          return '<td class="n"><b class="' + ((p[0][t[1]] - p[1][t[1]]) * t[2] > 0 ? 'up' : 'down') + '">' + fmtT(t, p[0][t[1]]) + '</b></td><td class="n flat">' + fmtT(t, p[1][t[1]]) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table><p class="bnote">Grey: flat mcap/TVL rule. Newest: listed ≥ ' + esc(F.walk.cut) + ', fit on ' + F.walk.n_train + ' older.</p></div>';
  }
  function hero() {
    var worth = R.rows.filter(function (r) { return r.plan.verdict.label === 'Worth it'; });
    var top = worth[0]; // rows arrive in rank order
    var fast = worth.slice().sort(function (a, b) { return b.plan.verdict.usd_per_hour - a.plan.verdict.usd_per_hour; })[0];
    var k = [
      [money(sum(R.rows, function (r) { return r.implied_value_usd; })), 'implied value of ' + R.rows.length + ' rows'],
      [worth.length + ' / ' + R.rows.length, 'farms worth it at ≤ ' + money(M.deposit_max) + ' deposit'],
      [Math.round(100 * F.cv.hit3) + '%<small> vs ' + Math.round(100 * F.baseline_cv.hit3) + '%</small>', 'held-out peers within ×3: fitted vs flat'],
      [money(fast.plan.verdict.usd_per_hour) + '/h', 'best net pay · ' + esc(fast.name)],
    ];
    return '<p class="headline"><span>Read first</span><b>' + worth.length + ' of ' + R.rows.length + '</b> repay ' + M.worth_ratio + '× gas, fees and hours · top farm <b>#' + top.rank + ' ' + esc(top.name) + '</b>: ' + money(top.implied_value_usd) + ' implied, ' + money(top.plan.verdict.deposit_usd) + ' in, ' + money(top.plan.verdict.usd_per_hour) + '/h net · fitted value beats flat mcap/TVL on <b>' + WINS + '/' + NTESTS + '</b> blind scores</p>' +
      strip() + '<section class="hero"><div><div class="kpis">' + k.map(function (v) { return '<div class="kpi"><b>' + v[0] + '</b><span>' + v[1] + '</span></div>'; }).join('') + '</div>' +
      '<div class="formula"><i>Fitted value: </i>' + equation() +
      '<p class="judge">Each row: its own TVL, 7d growth, years with no token and first chain. No name is hard-coded. Drop shares, gas and $' + M.time_usd_per_hour + '/h time are stated assumptions.</p></div></div>' +
      blindBox() + '</section>';
  }

  function board() {
    var rows = filtered();
    var minOpts = [['10000000', '≥ $10M'], ['25000000', '≥ $25M'], ['50000000', '≥ $50M (floor)'], ['100000000', '≥ $100M'], ['500000000', '≥ $500M']];
    var active = S.q || S.cat || S.chain || S.status || S.risk || S.verdict || S.min !== '0';
    var wl = rows.filter(function (r) { return r.on_watchlist; }).length;
    var sc = COLS.filter(function (c) { return c.k === S.sort; })[0] || COLS[0], sortCol = sc.s || sc.l;
    var t = rows[0], tv = t && t.plan.verdict;
    var summary = (t ? '<p class="headline"><span>Top of this view</span>' + rows.length + ' match, sorted by ' + sortCol.toLowerCase() + '. <b>#' + t.rank + ' ' + esc(t.name) + '</b>: ' + money(t.implied_value_usd) + ' implied, ' + tv.label + ' at ' + money(tv.deposit_usd) + ', ' + money(t.plan.total_cost_usd) + ' gas + fees, ' + tv.hours + ' h of work, ' + money(tv.usd_per_hour) + '/h net.</p>' : '') +
      strip() + '<section class="fsum"><div><b>' + rows.length + '</b><span>match of ' + R.rows.length + '</span></div><div><b>' + (rows.length - wl) + '</b><span>off-watchlist finds · ' + wl + ' watchlist</span></div>' +
      '<div><b>' + money(sum(rows, function (r) { return r.implied_value_usd; })) + '</b><span>implied value</span></div>' +
      '<div><b>' + money(median(rows.map(function (r) { return r.per_1k_usd; }))) + '</b><span>median drop / $1k</span></div><div><b>' + money(median(rows.map(function (r) { return r.plan.total_cost_usd; }))) + '</b><span>median gas + fees</span></div>' +
      '<div><b>' + money(median(rows.map(function (r) { return r.plan.verdict.usd_per_hour; }))) + '/h</b><span>median net pay</span></div>' +
      '<p class="formula-mini">' + equation(true) + ' · sorted by ' + sortCol + (S.dir === '1' ? ' ▲' : ' ▼') + ' · click a row for its equation and plan</p></section>';
    var html = (active ? summary : hero()) +
      '<div class="filters">' +
      '<input id="f-q" type="search" placeholder="Search name, chain…" value="' + esc(S.q) + '" aria-label="Search">' +
      '<select id="f-cat" aria-label="Category">' + options(CATS, S.cat, 'All categories') + '</select>' +
      '<select id="f-chain" aria-label="Chain">' + options(CHAINS, S.chain, 'All chains') + '</select>' +
      '<select id="f-status" aria-label="Status">' + options([['wl', 'Watchlist (≥ floor)'], ['early', 'Off watchlist'], ['clean', 'No family token']], S.status, 'All pre-token') + '</select>' +
      '<select id="f-min" aria-label="Minimum TVL">' + options(minOpts, S.min === '0' ? '' : S.min, 'Any TVL') + '</select>' +
      '<select id="f-verdict" aria-label="Verdict">' + options(VERDICTS, S.verdict, 'Any verdict') + '</select>' +
      '<select id="f-risk" aria-label="Risk">' + options([['Low', 'Low risk'], ['Medium', 'Medium risk'], ['High', 'High risk']], S.risk, 'Any risk') + '</select>' +
      '<button class="chip-reset" id="f-reset">Reset</button>' +
      '<span class="count"><b>' + rows.length + '</b> of ' + R.rows.length + '</span></div>' +
      '<div class="tablewrap"><table><thead><tr>' + COLS.map(function (c) {
        var s = c.k === S.sort ? (S.dir === '1' ? 'ascending' : 'descending') : 'none';
        return '<th data-k="' + c.k + '"' + (c.n ? ' class="n"' : '') + ' aria-sort="' + s + '">' + c.l + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) {
        return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === S.p ? ' class="sel"' : '') + '>' + COLS.map(function (c) { return c.h(r); }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + COLS.length + '" class="empty">No protocol matches these filters.</td></tr>') +
      '</tbody></table><p class="tfoot">Not ranked here: ' + C.fit_set + ' protocols whose token already trades (the fit set, see “Already trading”) and ' + C.recorded + ' that record a token without a market cap.</p></div>';
    app.innerHTML = html;
    var q = document.getElementById('f-q');
    q.addEventListener('input', function () { S.q = q.value; writeHash(); refreshBody(); });
    [['f-cat', 'cat'], ['f-chain', 'chain'], ['f-status', 'status'], ['f-min', 'min'], ['f-risk', 'risk'], ['f-verdict', 'verdict']].forEach(function (p) {
      document.getElementById(p[0]).addEventListener('change', function (e) { S[p[1]] = e.target.value || DEFAULTS[p[1]]; writeHash(); render(); });
    });
    document.getElementById('f-reset').addEventListener('click', function () { ['q', 'cat', 'chain', 'status', 'min', 'risk', 'verdict'].forEach(function (k) { S[k] = DEFAULTS[k]; }); writeHash(); render(); });
  }
  function refreshBody() {
    var pos = document.getElementById('f-q').selectionStart;
    render();
    var q = document.getElementById('f-q');
    q.focus(); q.setSelectionRange(pos, pos);
  }

  // ---------- detail ----------
  function eqTable(r) {
    var v = r.value;
    var raw = ['1', 'ln ' + money(r.tvl_usd), 'ln(1 ' + sg(v.growth_pct, 2) + '%)', 'ln(1 + ' + v.years_used.toFixed(2) + ' y)' + (v.age_days === null ? ' · no listing date: fit-set median' : '')];
    var rows = v.terms.map(function (t, i) {
      return '<tr><td>' + esc(t.term) + '</td><td class="n">' + t.b.toFixed(4) + '</td><td class="n">× ' + t.x.toFixed(4) + '</td><td class="pmeta">' + esc(raw[i] || ((r.chains[0] || 'Unknown') + ' indicator = ' + t.x)) + '</td><td class="n"><b>' + sg(t.contrib, 3) + '</b></td></tr>';
    }).join('');
    return '<table class="eqt"><thead><tr><th>term</th><th class="n">fitted b</th><th class="n">feature</th><th>from the snapshot</th><th class="n">ln pts</th></tr></thead><tbody>' + rows +
      '<tr class="tot"><td colspan="4">ln V = Σ = ' + v.ln_value.toFixed(4) + '  →  V = e<sup>' + v.ln_value.toFixed(3) + '</sup></td><td class="n"><b>' + money(r.implied_value_usd) + '</b></td></tr></tbody></table>' +
      '<p class="calc">80% band from held-out errors: <b>' + money(v.low_usd) + '</b> to <b>' + money(v.high_usd) + '</b> · ' + (100 * v.to_tvl).toFixed(2) + '% of TVL · of the ' + M.peer_k + ' nearest peers by TVL and age, <b>' + Math.round(100 * r.peer_token_share) + '%</b> already record a token (shown, not priced)</p>';
  }
  function tiers(r) {
    var p = r.plan, v = p.verdict;
    var ds = [1000, 5000, 25000, 50000];
    if (ds.indexOf(v.deposit_usd) < 0) ds.push(v.deposit_usd);
    ds.sort(function (a, b) { return a - b; });
    return '<table class="eqt"><thead><tr><th class="n">deposit</th><th class="n">est. drop</th><th class="n">gas + fees</th><th class="n">' + v.hours + ' h at ' + money(M.time_usd_per_hour) + '</th><th class="n">net after time</th></tr></thead><tbody>' + ds.map(function (d) {
      var drop = Math.round(r.per_1k_usd * d / 1000), cash = p.fixed_cost_usd + p.cost_rate * d, net = drop - cash - v.time_cost_usd;
      return '<tr' + (d === v.deposit_usd ? ' class="tot"' : '') + '><td class="n">' + money(d) + (d === v.deposit_usd ? ' ◀ plan' : '') + '</td><td class="n">' + money(drop) + '</td><td class="n">' + money(cash) + '</td><td class="n">' + money(v.time_cost_usd) + '</td><td class="n"><span class="' + (net >= 0 ? 'up' : 'down') + '">' + money(net) + '</span></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function detail(r) {
    var p = r.plan, v = p.verdict;
    var plan = p.steps.map(function (s, i) {
      var parts = [];
      if (s.capital_usd) parts.push(money(s.capital_usd) + ' in');
      if (s.gas_usd || s.fee_usd) parts.push(money(s.gas_usd + s.fee_usd) + ' gas/fee');
      return '<tr><td class="ph"><span class="' + s.phase + '">' + s.phase + '</span></td><td>' + (i + 1) + '. ' + esc(s.text) + '</td><td class="c"><b>' + (parts.join('<br>+ ') || 'free') + '</b>' + s.minutes + ' min · ' + esc(s.when) + '</td></tr>';
    }).join('');
    return '<div class="dhead"><div><div class="pmeta">#' + r.rank + ' of ' + R.rows.length + ' · ' + esc(r.category || 'Uncategorized') + ' · pre-token: no token recorded</div><h2>' + esc(r.name) + badge(r) + '</h2><div class="pmeta">' + esc(r.chains.slice(0, 7).join(' · ')) + (r.chains.length > 7 ? ' · +' + (r.chains.length - 7) + ' more' : '') + '</div></div><button class="x" id="d-x" aria-label="Close">✕</button></div>' +
      '<div class="facts"><div><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></div><div><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div><div><b>' + pct(r.change_7d) + '</b><span>7d TVL</span></div><div><b>' + days(r.value.age_days) + '</b><span>no token, since ' + esc(r.listed_at || 'n/a') + '</span></div></div>' +
      '<div class="detail-grid"><section><h3>The value as an equation</h3>' + eqTable(r) +
      '<h3>Airdrop math</h3><div class="calc">pool = <b>' + money(r.implied_value_usd) + '</b> × ' + (r.airdrop_share * 100).toFixed(0) + '% community share = <b>' + money(r.airdrop_pool_usd) + '</b> · per $1k = pool × ' + (M.depositor_share * 100) + '% to depositors × $1,000 / TVL = <b>' + money(r.per_1k_usd) + '</b></div>' +
      '<h3>Verdict · ' + vtag(v) + '</h3><p class="vtext v-' + v.label.replace(' ', '') + '">' + esc(v.text) + '</p><details open><summary>Same plan at other deposit sizes</summary>' + tiers(r) + '</details>' +
      '</section><section>' +
      '<h3>Conditional farm route · ' + esc(p.chain) + ' · ' + esc(p.wallet) + ' · ' + money(p.capital_usd) + '</h3><p class="route-note">Category-derived route. Verify assets, deployment and withdrawals in the official app before funding. Costs below are budget assumptions, not live quotes.</p><table class="plan"><tbody>' + plan + '</tbody></table>' +
      '<div class="totals"><div><b>' + money(p.total_cost_usd) + '</b><span>gas + fees, whole hold</span></div><div><b>' + p.setup_minutes + ' min</b><span>to set up</span></div><div><b>' + p.weekly_minutes + ' min/wk</b><span>upkeep · ' + p.hold_days + ' d hold</span></div><div><b>' + money(v.usd_per_hour) + '/h</b><span>net per hour of work</span></div></div>' +
      '<p class="riskline"><span class="risk r-' + r.risk.level + '">' + r.risk.level + ' risk · ' + r.risk.score + '/100</span>' + esc(r.risk.notes.join('; ')) + '</p>' +
      '</section></div>' +
      '<p class="note">Implied value is this model\'s claim from the snapshot of ' + esc(R.as_of) + ', not a forecast that a token will launch. The record shows no token; that does not prove none exists.</p>';
  }
  function openDetail(slug) {
    var r = BY[slug];
    if (!r) { closeDetail(); return; }
    S.p = slug; writeHash();
    drawer.innerHTML = detail(r);
    drawer.classList.add('on'); scrim.classList.add('on'); drawer.setAttribute('aria-hidden', 'false');
    document.getElementById('d-x').addEventListener('click', closeDetail);
    Array.prototype.forEach.call(app.querySelectorAll('tr.sel'), function (t) { t.classList.remove('sel'); });
    var tr = app.querySelector('tr[data-slug="' + slug + '"]');
    if (tr) tr.classList.add('sel');
  }
  function closeDetail() {
    S.p = ''; writeHash();
    drawer.classList.remove('on'); scrim.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true');
  }

  // ---------- already trading: the fit set, with the model's blind guess beside the market ----------
  function live() {
    return '<div class="cols"><div class="card"><h2>Already trading · the fit set (' + R.live.length + ')</h2><p>These record a token with a market cap, so the market prices them: they are <b>never ranked</b>. They are what the value equation is fitted on. “Blind” is each one\'s prediction with its own fold left out; “Walk-fwd” predicts the newest listings from a fit on the older ones only.</p>' +
      '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Blind</th><th class="n">Miss</th><th class="n">Walk-fwd</th></tr></thead><tbody>' +
      R.live.map(function (l) {
        var miss = l.cv_pred_usd / l.mcap_usd;
        return '<tr><td><span class="pname">' + esc(l.name) + '</span><span class="badge b-trade">' + esc(l.symbol || 'TOKEN') + '</span><div class="pmeta">' + esc(l.category || '') + '</div></td><td class="n">' + money(l.tvl_usd) + '</td><td class="n">' + money(l.mcap_usd) + '</td><td class="n">' + money(l.cv_pred_usd) + '</td><td class="n">' + (miss >= 1 ? '×' + miss.toFixed(1) : '÷' + (1 / miss).toFixed(1)) + '</td><td class="n">' + (l.wf_pred_usd ? money(l.wf_pred_usd) : '<span class="pmeta">train</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' + modelCard() + '</div>';
  }
  function scoreRow(name, s, note) { return '<tr><td>' + name + '</td><td class="n">' + s.n + '</td><td class="n">' + f2(s.r2) + '</td><td class="n">' + f2(s.rho) + '</td><td class="n">×' + f2(s.med_err_x) + '</td><td class="n">' + Math.round(100 * s.hit3) + '%</td><td class="pmeta">' + note + '</td></tr>'; }
  function modelCard() {
    return '<div class="card"><h2>The fitted equation</h2><p class="formula">' + equation() + '</p>' +
      '<table><thead><tr><th>term</th><th class="n">b</th><th class="n">SE</th><th class="n">5-fold R² without it</th></tr></thead><tbody>' + F.coef.map(function (c, i) {
        var ab = F.ablation.filter(function (a) { return a.term === c.term; })[0];
        return '<tr><td>' + esc(c.term) + '</td><td class="n"><b>' + c.b.toFixed(4) + '</b></td><td class="n">' + c.se.toFixed(4) + '</td><td class="n">' + (ab ? f2(ab.cv.r2) + ' vs ' + f2(F.cv.r2) : '–') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<h2>Held-out diagnostics · log market cap</h2><table><thead><tr><th>test</th><th class="n">n</th><th class="n">R²</th><th class="n">ρ</th><th class="n">median miss</th><th class="n">within ×3</th><th></th></tr></thead><tbody>' +
      scoreRow('In sample', F.in_sample, 'not a test') + scoreRow('5-fold diagnostic', F.cv, 'fold = slug order mod ' + M.folds) + scoreRow('Flat ratio, 5-fold', F.baseline_cv, 'V = TVL × median mcap/TVL') +
      scoreRow('Walk-forward', F.walk, F.walk.n_train + ' older train, listed ≥ ' + esc(F.walk.cut) + ' test') + scoreRow('Flat ratio, walk-fwd', F.baseline_walk, 'same split') + '</tbody></table>' +
      '<p class="note">Feature families were explored on these splits: these are diagnostics, not untouched future tests. Walk-forward sorts listing dates within one snapshot; it is not a historical backtest. R² is measured on log market cap. The 80% band is the empirical 10th–90th percentile of fold residuals, not a calibrated launch forecast.</p>' +
      '<h2>Feature experiment audit</h2><table><thead><tr><th>Features</th><th class="n">5-fold R²</th><th class="n">walk R²</th><th class="n">walk miss</th></tr></thead><tbody>' + F.experiments.map(function (e) { return '<tr><td>' + esc(e.name) + '</td><td class="n">' + f2(e.cv.r2) + '</td><td class="n">' + f2(e.walk.r2) + '</td><td class="n">×' + f2(e.walk.med_err_x) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<p class="note">Nested 5-fold: an inner 4-fold chooses among those four families, then the outer fold is predicted once. R² ' + f2(F.nested_cv.r2) + ', ρ ' + f2(F.nested_cv.rho) + ', median miss ×' + f2(F.nested_cv.med_err_x) + '. This estimates the selection procedure, rather than the final fixed model. These candidate families were themselves developed using this snapshot.</p></div>';

  }

  // ---------- method ----------
  function method() {
    return '<div class="cols"><div class="card"><h2>Method · model ' + esc(R.model_version) + '</h2>' +
      '<p>Protocol figures come from the sealed snapshot (' + esc(R.source) + '). No protocol name is special-cased; one function scores every row.</p><ol>' +
      '<li><b>Status.</b> Pre-token = no symbol, no CoinGecko id, no market cap (' + C.pre_token + '). Trading = a market cap (' + C.trading + '; ' + C.fit_set + ' without CEX are the fit set). Recorded = a symbol but no cap (' + C.recorded + '). Only pre-token rows are ranked; wrapped, staked, bridged, exchange and versioned products are dropped below the floor with the watchlist\'s own rule.</li>' +
      '<li><b>Value.</b> ' + equation(true) + ', fitted by Huber IRLS (k ' + M.huber_k + ') with ridge ' + M.ridge + ' on base slopes and ' + M.effect_ridge + ' on primary-chain indicators; unseen chain effects are zero. Category effects did not improve validation. 7d clamped ' + M.growth_floor + '…+' + M.growth_cap + '%; years = listed_at to as_of, which for a pre-token protocol is its time with no token.</li>' +
      '<li><b>Flags.</b> A sibling (a same-first-word protocol that records a token) or a parent record (above the floor, passing every rule, yet off the watchlist) is badged and adds ' + M.family_risk + ' risk points; it never changes the fitted value.</li>' +
      '<li><b>Airdrop.</b> Pool = implied × community share (12% user apps, 10% DeFi infrastructure, 6% curated or institutional); ' + (M.depositor_share * 100) + '% reaches depositors pro rata to TVL → drop per $1k. These two shares are stated assumptions, not fitted.</li>' +
      '<li><b>Farm plan.</b> The first listed chain, its wallet and gas budget, with conditional category-derived actions. The snapshot has no contract addresses, accepted assets or points rules; verify those in the app. Gas and fees are linear in the deposit, so cost = fixed + rate × deposit exactly; time is priced at ' + money(M.time_usd_per_hour) + '/h. Worth it = the drop covers ' + M.worth_ratio + '× the gas and fees and your hours, at a deposit ≤ ' + money(M.deposit_max) + '; the plan is sized to the smallest such tier. Thin = it only covers gas. Skip = it never does.</li>' +
      '<li><b>Risk.</b> Youth, thin TVL, a 7-day outflow, a single chain, leverage or peg categories and a flag add points; ≥ 50 is High.</li></ol></div>' +
      modelCard() + '</div>';
  }

  // ---------- frame ----------
  function render() {
    document.getElementById('sub').textContent = 'Snapshot ' + R.as_of + ' · ' + C.protocols + ' protocols · ' + C.ranked + ' pre-token ranked by fitted implied value · model ' + R.model_version;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)); });
    if (S.tab === 'live') app.innerHTML = live();
    else if (S.tab === 'method') app.innerHTML = method();
    else board();
    app.setAttribute('aria-busy', 'false');
  }

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    S.tab = t.dataset.tab; writeHash(); render(); window.scrollTo(0, 0);
  });
  app.addEventListener('click', function (e) {
    var th = e.target.closest('th[data-k]');
    if (th && S.tab === 'board') {
      var k = th.dataset.k;
      if (S.sort === k) S.dir = S.dir === '1' ? '-1' : '1';
      else { S.sort = k; S.dir = k === 'rank' || k === 'name' || k === 'risk' || k === 'cost' ? '1' : '-1'; }
      writeHash(); render(); return;
    }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug);
  });
  scrim.addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  render();
  if (S.p) openDetail(S.p);
})();
