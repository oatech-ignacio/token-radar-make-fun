// Pre-Token Radar dashboard. Reads window.RADAR (data.js, written by main.ts from lib/model.ts) and renders
// three views: the ranked pre-token board, the trading comparables that price it, and the method.
// No framework, no network. State lives in the URL hash so every view (a filter, an open detail) is a link.
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  if (!R) { app.innerHTML = '<p class="empty">data.js is missing: run main.ts first.</p>'; return; }

  var DEFAULTS = { tab: 'board', q: '', cat: '', chain: '', status: '', min: '0', risk: '', sort: 'rank', dir: '1', p: '' };
  var S = readHash();
  var BY = {};
  R.rows.forEach(function (r) { BY[r.slug] = r; });
  var MAX_IMPLIED = R.rows[0].implied_value_usd;

  // ---------- formatting ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function money(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    return '$' + (a >= 10 ? Math.round(n) : n.toFixed(2));
  }
  function pct(n) { return n === null || n === undefined ? '<span class="pmeta">n/a</span>' : '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>'; }
  function days(d) { if (d === null || d === undefined) return 'n/a'; return d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function x(n) { return '×' + n.toFixed(3); }
  function badge(r) {
    var b = r.on_watchlist ? '<span class="badge b-wl" title="On the snapshot watchlist: ≥ floor TVL, no token recorded">WATCHLIST</span>'
      : r.breakdown.family_kind === 'parent' ? '<span class="badge b-sub" title="' + esc(r.breakdown.family_reason) + '">SUB-PRODUCT</span>'
      : '<span class="badge b-early" title="Below the watchlist floor, no token recorded">EARLY</span>';
    return b + (r.breakdown.family_kind === 'sibling' ? '<span class="badge b-trade" title="' + esc(r.breakdown.family_reason) + '">FAMILY TOKEN</span>' : '');
  }

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
    { k: 'name', l: 'Protocol', v: function (r) { return r.name.toLowerCase(); }, h: function (r) {
      return '<td><span class="pname">' + esc(r.name) + '</span>' + badge(r) + '<div class="pmeta">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</div></td>';
    } },
    { k: 'tvl', l: 'TVL', n: 1, v: function (r) { return r.tvl_usd; }, h: function (r) { return '<td class="n">' + money(r.tvl_usd) + '</td>'; } },
    { k: 'g', l: '7d TVL', n: 1, v: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; }, h: function (r) { return '<td class="n">' + pct(r.change_7d) + '</td>'; } },
    { k: 'age', l: 'No token for', n: 1, v: function (r) { return r.breakdown.age_days === null ? -1 : r.breakdown.age_days; }, h: function (r) { return '<td class="n">' + days(r.breakdown.age_days) + '</td>'; } },
    { k: 'mult', l: 'Comp ×', n: 1, v: function (r) { return r.breakdown.category_multiple; }, h: function (r) { return '<td class="n" title="Category mcap/TVL from ' + r.breakdown.category_comps + ' trading comps, shrunk">' + r.breakdown.category_multiple.toFixed(3) + '</td>'; } },
    { k: 'implied', l: 'Implied value', n: 1, v: function (r) { return r.implied_value_usd; }, h: function (r) {
      var w = Math.max(2, Math.round(70 * Math.sqrt(r.implied_value_usd / MAX_IMPLIED)));
      return '<td class="n"><span class="bar" style="width:' + w + 'px"></span><b>' + money(r.implied_value_usd) + '</b></td>';
    } },
    { k: 'pool', l: 'Airdrop pool', n: 1, v: function (r) { return r.airdrop_pool_usd; }, h: function (r) { return '<td class="n">' + money(r.airdrop_pool_usd) + '</td>'; } },
    { k: 'per1k', l: 'Per $1k', n: 1, v: function (r) { return r.per_1k_usd; }, h: function (r) { return '<td class="n">' + money(r.per_1k_usd) + '</td>'; } },
    { k: 'risk', l: 'Risk', v: function (r) { return r.risk.score; }, h: function (r) { return '<td><span class="risk r-' + r.risk.level + '" title="' + esc(r.risk.notes.join('; ')) + '">' + r.risk.level + '</span></td>'; } },
    { k: 'plan', l: 'Farm plan (cost)', v: function (r) { return r.plan.total_cost_usd; }, h: function (r) {
      var p = r.plan;
      return '<td class="pmeta" title="' + money(p.capital_usd) + ' at work, ' + p.steps.length + ' steps">' + esc(p.chain.length > 12 ? p.chain.slice(0, 11) + '…' : p.chain) + ' · <b class="mono">' + money(p.total_cost_usd) + '</b> · ' + p.hold_days + 'd</td>';
    } },
  ];

  function filtered() {
    var q = S.q.trim().toLowerCase(), min = +S.min || 0;
    var rows = R.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (S.cat && (r.category || 'Uncategorized') !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.status === 'wl' && !r.on_watchlist) return false;
      if (S.status === 'early' && r.on_watchlist) return false;
      if (S.risk && r.risk.level !== S.risk) return false;
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

  // ---------- the radar scope: top 30 by implied value, nearer the centre = higher value ----------
  function scope() {
    var top = R.rows.slice(0, 30), lo = Math.log(R.rows[R.rows.length - 1].implied_value_usd), hi = Math.log(MAX_IMPLIED);
    var out = '<defs><radialGradient id="g0"><stop offset="0" stop-color="#39e6a2" stop-opacity=".18"/><stop offset="1" stop-color="#39e6a2" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#39e6a2" stop-opacity="0"/><stop offset="1" stop-color="#39e6a2" stop-opacity=".35"/></linearGradient></defs>' +
      '<circle cx="150" cy="150" r="140" fill="url(#g0)"/>';
    [35, 70, 105, 140].forEach(function (r) { out += '<circle class="ring" cx="150" cy="150" r="' + r + '"/>'; });
    out += '<line class="axis" x1="10" y1="150" x2="290" y2="150"/><line class="axis" x1="150" y1="10" x2="150" y2="290"/>';
    out += '<path class="sweep" d="M150 150 L290 150 A140 140 0 0 0 271 80 Z"/>';
    top.forEach(function (r, i) {
      // Distance encodes value; the angle is a golden-angle spiral by rank, so blips never stack.
      var ang = i * 2.39996 - Math.PI / 2;
      var rad = 22 + 116 * Math.sqrt(i / (top.length - 1)) * 0.6 + 116 * 0.4 * (hi - Math.log(r.implied_value_usd)) / (hi - lo);
      var cx = 150 + rad * Math.cos(ang), cy = 150 + rad * Math.sin(ang), sz = Math.max(2.2, 6 - i * 0.14);
      out += '<circle class="blip' + (r.on_watchlist ? ' wl' : '') + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + sz.toFixed(1) + '"><title>#' + r.rank + ' ' + esc(r.name) + ' ' + money(r.implied_value_usd) + '</title></circle>';
      if (i < 5) out += '<text x="' + (cx + sz + 3).toFixed(1) + '" y="' + (cy + 3).toFixed(1) + '">' + esc(r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name) + '</text>';
    });
    return '<div class="scope"><span class="cap">Top 30 · centre = highest value</span><svg viewBox="0 0 300 300" role="img" aria-label="Radar of the top 30 pre-token protocols">' + out + '</svg></div>';
  }

  function sum(rows, f) { return rows.reduce(function (s, r) { return s + f(r); }, 0); }
  function median(xs) { var s = xs.slice().sort(function (a, b) { return a - b; }); return s.length ? s[s.length >> 1] : 0; }

  function hero() {
    var c = R.counts, rows = R.rows;
    // Momentum in dollars (7-day inflow), so one tiny pool doubling does not top a protocol adding $50M.
    var inflow = function (r) { return r.change_7d === null ? 0 : r.tvl_usd * r.change_7d / (100 + r.change_7d); };
    var mover = rows.slice().sort(function (a, b) { return inflow(b) - inflow(a); })[0];
    var best = rows.slice().sort(function (a, b) { return b.plan.roi_multiple - a.plan.roi_multiple; })[0];
    var k = [
      ['<em>' + c.ranked + '</em>', 'pre-token protocols ranked · ' + c.watchlist + ' watchlist + ' + c.early + ' found off it'],
      [money(sum(rows, function (r) { return r.implied_value_usd; })), 'total implied value of tokens still to come'],
      [money(sum(rows, function (r) { return r.airdrop_pool_usd; })), 'implied airdrop pools · median ' + money(median(rows.map(function (r) { return r.per_1k_usd; }))) + ' per $1k farmed'],
      ['<b class="t">' + esc(rows[0].name) + '</b>', '#1 · ' + money(rows[0].implied_value_usd) + ' implied on ' + money(rows[0].tvl_usd) + ' TVL'],
      ['<b class="t">' + esc(mover.name) + '</b>', 'biggest 7d inflow: +' + money(inflow(mover)) + ' (' + pct(mover.change_7d) + ')'],
      ['<b class="t">' + esc(best.name) + '</b>', 'best drop / cost: ×' + best.plan.roi_multiple.toFixed(0) + ' on ' + money(best.plan.capital_usd) + ' farmed'],
    ];
    return '<section class="hero"><div class="kpis">' + k.map(function (v) { return '<div class="kpi">' + (v[0].indexOf('<b') === 0 ? v[0] : '<b>' + v[0] + '</b>') + '<span>' + v[1] + '</span></div>'; }).join('') +
      '<div class="formula"><i>implied value</i> = TVL × <i>comp multiple</i>(category) × <i>momentum</i> × <i>age-without-token</i> × <i>chain reach</i> × <i>family</i>' +
      '<small>Family ×' + R.model.family_sibling + ' if a same-named protocol already records a token, ×' + R.model.family_parent + ' if filed under a parent · comp multiple = median mcap/TVL of trading protocols in the same category (' + c.trading + ' in the snapshot), shrunk toward the all-category median ×' + R.global_median.toFixed(3) + ' · momentum = (1 + 7d%)<sup>0.5</sup> · age ×0.80–1.20 over 3 years · reach +4% per extra chain. Live tokens are never ranked: see “Already trading”.</small></div></div>' +
      scope() + '</section>';
  }

  function board() {
    var rows = filtered();
    var minOpts = [['10000000', '≥ $10M'], ['25000000', '≥ $25M'], ['50000000', '≥ $50M (floor)'], ['100000000', '≥ $100M'], ['500000000', '≥ $500M']];
    // With a filter on, the hero gives way to a summary of the filtered set, so the rows get the screen.
    var active = S.q || S.cat || S.chain || S.status || S.risk || S.min !== '0';
    var wl = rows.filter(function (r) { return r.on_watchlist; }).length;
    var summary = '<section class="fsum"><div><b>' + rows.length + '</b><span>protocols match</span></div><div><b>' + wl + ' / ' + (rows.length - wl) + '</b><span>watchlist / early</span></div>' +
      '<div><b>' + money(sum(rows, function (r) { return r.implied_value_usd; })) + '</b><span>implied value</span></div><div><b>' + money(sum(rows, function (r) { return r.airdrop_pool_usd; })) + '</b><span>airdrop pools</span></div>' +
      '<div><b>' + money(median(rows.map(function (r) { return r.per_1k_usd; }))) + '</b><span>median per $1k</span></div><div><b>' + money(median(rows.map(function (r) { return r.plan.total_cost_usd; }))) + '</b><span>median plan cost</span></div>' +
      '<p class="formula-mini"><i>implied</i> = TVL × comp multiple × momentum × age × reach × family · sorted by ' + (COLS.filter(function (c) { return c.k === S.sort; })[0] || COLS[0]).l + (S.dir === '1' ? ' ▲' : ' ▼') + ' · click a row for its value build and farm plan</p></section>';
    var html = (active ? summary : hero()) +
      '<div class="filters">' +
      '<input id="f-q" type="search" placeholder="Search protocol, category, chain…" value="' + esc(S.q) + '" aria-label="Search">' +
      '<select id="f-cat" aria-label="Category">' + options(CATS, S.cat, 'All categories') + '</select>' +
      '<select id="f-chain" aria-label="Chain">' + options(CHAINS, S.chain, 'All chains') + '</select>' +
      '<select id="f-status" aria-label="Status">' + options([['wl', 'Watchlist (≥ floor)'], ['early', 'Off watchlist']], S.status, 'All pre-token') + '</select>' +
      '<select id="f-min" aria-label="Minimum TVL">' + options(minOpts, S.min === '0' ? '' : S.min, 'Any TVL') + '</select>' +
      '<select id="f-risk" aria-label="Risk">' + options([['Low', 'Low risk'], ['Medium', 'Medium risk'], ['High', 'High risk']], S.risk, 'Any risk') + '</select>' +
      '<button class="chip-reset" id="f-reset">Reset</button>' +
      '<span class="count"><b>' + rows.length + '</b> of ' + R.rows.length + ' · implied ' + money(sum(rows, function (r) { return r.implied_value_usd; })) + '</span></div>' +
      '<div class="tablewrap"><table><thead><tr>' + COLS.map(function (c) {
        var s = c.k === S.sort ? (S.dir === '1' ? 'ascending' : 'descending') : 'none';
        return '<th data-k="' + c.k + '"' + (c.n ? ' class="n"' : '') + ' aria-sort="' + s + '">' + c.l + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) {
        return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === S.p ? ' class="sel"' : '') + '>' + COLS.map(function (c) { return c.h(r); }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + COLS.length + '" class="empty">No protocol matches these filters.</td></tr>') +
      '</tbody></table></div>';
    app.innerHTML = html;
    var q = document.getElementById('f-q');
    q.addEventListener('input', function () { S.q = q.value; writeHash(); refreshBody(); });
    [['f-cat', 'cat'], ['f-chain', 'chain'], ['f-status', 'status'], ['f-min', 'min'], ['f-risk', 'risk']].forEach(function (p) {
      document.getElementById(p[0]).addEventListener('change', function (e) { S[p[1]] = e.target.value || DEFAULTS[p[1]]; writeHash(); render(); });
    });
    document.getElementById('f-reset').addEventListener('click', function () { ['q', 'cat', 'chain', 'status', 'min', 'risk'].forEach(function (k) { S[k] = DEFAULTS[k]; }); writeHash(); render(); });
  }
  // Typing in search keeps focus: re-render only the rows and the count.
  function refreshBody() {
    var pos = document.getElementById('f-q').selectionStart;
    render();
    var q = document.getElementById('f-q');
    q.focus(); q.setSelectionRange(pos, pos);
  }

  // ---------- detail ----------
  function detail(r) {
    var b = r.breakdown, p = r.plan;
    var steps = [
      ['TVL', b.tvl_usd, money(b.tvl_usd), 'snapshot'],
      ['× comp multiple <b>' + b.category_multiple.toFixed(3) + '</b>', b.tvl_usd * b.category_multiple, money(b.tvl_usd * b.category_multiple), (b.category_comps ? b.category_comps + ' trading comp' + (b.category_comps === 1 ? '' : 's') + ', raw ×' + b.category_median.toFixed(3) : 'no comps: all-category ×' + R.global_median.toFixed(3)) + ', shrunk K=' + R.model.shrink_k],
    ];
    var v = b.tvl_usd * b.category_multiple;
    v *= b.m_momentum; steps.push(['× momentum <b>' + b.m_momentum.toFixed(3) + '</b>', v, money(v), '7d TVL ' + (b.growth_pct >= 0 ? '+' : '') + b.growth_pct.toFixed(2) + '%, ^0.5']);
    v *= b.m_age; steps.push(['× age <b>' + b.m_age.toFixed(3) + '</b>', v, money(v), b.age_days === null ? 'no listing date: 365 d assumed' : days(b.age_days) + ' with no token']);
    v *= b.m_reach; steps.push(['× reach <b>' + b.m_reach.toFixed(3) + '</b>', v, money(v), b.chain_count + ' chain' + (b.chain_count === 1 ? '' : 's') + ', +4% each']);
    v *= b.m_family; steps.push(['× family <b>' + b.m_family.toFixed(3) + '</b>', v, money(v), b.family_reason]);
    // One line per factor: what it is, why it has this value, a bar on the TVL's scale, the running total.
    var wf = steps.map(function (s) {
      return '<div class="lab">' + s[0] + '</div><div class="why">' + esc(s[3]) + '</div><div class="track"><div class="fill" style="width:' + Math.max(1, 100 * s[1] / b.tvl_usd).toFixed(1) + '%"></div></div><div class="v">' + s[2] + '</div>';
    }).join('') + '<div class="lab total">= implied value</div><div class="why total">' + (100 * r.implied_value_usd / b.tvl_usd).toFixed(1) + '% of TVL</div><div class="track"><div class="fill g" style="width:' + Math.max(1, 100 * r.implied_value_usd / b.tvl_usd).toFixed(1) + '%"></div></div><div class="v total">' + money(r.implied_value_usd) + '</div>';
    var why = '';
    var plan = p.steps.map(function (s, i) {
      var parts = [];
      if (s.capital_usd) parts.push(money(s.capital_usd) + ' in');
      if (s.gas_usd || s.fee_usd) parts.push(money(s.gas_usd + s.fee_usd) + ' gas/fee');
      return '<tr><td class="ph"><span class="' + s.phase + '">' + s.phase + '</span></td><td>' + (i + 1) + '. ' + esc(s.text) + '</td><td class="c"><b>' + (parts.join(' + ') || 'free') + '</b>' + s.minutes + ' min · ' + esc(s.when) + '</td></tr>';
    }).join('');
    return '<div class="dhead"><div><div class="pmeta">#' + r.rank + ' of ' + R.rows.length + ' · ' + esc(r.category || 'Uncategorized') + ' · pre-token</div><h2>' + esc(r.name) + badge(r) + '</h2><div class="pmeta">' + esc(r.chains.slice(0, 7).join(' · ')) + (r.chains.length > 7 ? ' · +' + (r.chains.length - 7) + ' more' : '') + '</div></div><button class="x" id="d-x" aria-label="Close">✕</button></div>' +
      '<div class="facts"><div><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></div><div><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div><div><b>' + pct(r.change_7d) + '</b><span>7d TVL</span></div><div><b>' + days(b.age_days) + '</b><span>no token, since ' + esc(r.listed_at || 'n/a') + '</span></div></div>' +
      '<h3>How the value is built</h3><div class="wf">' + wf + '</div><ul class="notes">' + why + '</ul>' +
      '<h3>Airdrop math</h3><div class="calc">pool = <b>' + money(r.implied_value_usd) + '</b> × ' + (r.airdrop_share * 100).toFixed(0) + '% community share = <b>' + money(r.airdrop_pool_usd) + '</b><br>per $1k = pool × ' + (R.model.depositor_share * 100) + '% to depositors × $1,000 / TVL = <b>' + money(r.per_1k_usd) + '</b><br>this plan: ' + money(p.capital_usd) + ' for ' + p.hold_days + ' d → est. drop <b>' + money(p.est_drop_usd) + '</b> vs cost <b>' + money(p.total_cost_usd) + '</b> (×' + p.roi_multiple.toFixed(1) + ')</div>' +
      '<h3>Farm plan · ' + esc(p.chain) + ' · ' + esc(p.wallet) + '</h3><table class="plan"><tbody>' + plan + '</tbody></table>' +
      '<div class="totals"><div><b>' + money(p.capital_usd) + '</b><span>capital at work</span></div><div><b>' + money(p.total_cost_usd) + '</b><span>gas + fees, whole hold</span></div><div><b>' + p.setup_minutes + ' min</b><span>to set up</span></div><div><b>' + p.weekly_minutes + ' min/wk</b><span>upkeep · ' + p.hold_days + ' d hold</span></div></div>' +
      '<h3>Risk · <span class="risk r-' + r.risk.level + '">' + r.risk.level + ' ' + r.risk.score + '/100</span></h3><ul class="notes">' + r.risk.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' +
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

  // ---------- already trading ----------
  function live() {
    var rows = R.live;
    return '<div class="cols"><div class="card"><h2>Already trading · the comparables</h2><p>These protocols record a token with a market cap, so the market already prices them: they are <b>never ranked</b> on the board. Their mcap/TVL ratios set each category\'s multiple. ' + R.counts.recorded + ' more record a symbol but no market cap and are left out of both.</p>' +
      '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">mcap/TVL</th><th class="n">7d</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="badge b-trade">' + esc(r.symbol || 'TOKEN') + '</span></td><td class="pmeta">' + esc(r.category || '') + '</td><td class="n">' + money(r.tvl_usd) + '</td><td class="n">' + money(r.mcap_usd) + '</td><td class="n">' + r.ratio.toFixed(3) + '</td><td class="n">' + pct(r.change_7d) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>' + compsCard() + '</div>';
  }
  function compsCard() {
    return '<div class="card"><h2>Category multiples</h2><p>Median mcap/TVL of trading protocols per category, shrunk toward the all-category median ×' + R.global_median.toFixed(3) + ' with weight n/(n+' + R.model.shrink_k + ').</p><div class="tablewrap"><table><thead><tr><th>Category</th><th class="n">Pre-token</th><th class="n">Comps</th><th class="n">Raw median</th><th class="n">Multiple</th></tr></thead><tbody>' +
      R.comparables.map(function (c) { return '<tr><td>' + esc(c.category) + '</td><td class="n">' + c.pre_token + '</td><td class="n">' + c.trading + '</td><td class="n">' + (c.median === null ? '–' : c.median.toFixed(3)) + '</td><td class="n"><b>' + c.multiple.toFixed(3) + '</b></td></tr>'; }).join('') +
      '</tbody></table></div></div>';
  }

  // ---------- method ----------
  function method() {
    var m = R.model;
    return '<div class="cols"><div class="card"><h2>Method · model ' + esc(R.model_version) + '</h2>' +
      '<p>Every figure comes from the sealed snapshot (' + esc(R.source) + '). No protocol name is special-cased; one function scores every row.</p><ol>' +
      '<li><b>Status.</b> Pre-token = no symbol, no CoinGecko id, no market cap (' + R.counts.pre_token + '). Trading = a market cap (' + R.counts.trading + '). Recorded = a symbol but no cap (' + R.counts.recorded + '). Only pre-token rows are ranked; wrapped, staked, bridged, exchange and versioned products are dropped below the floor with the watchlist\'s own rule.</li>' +
      '<li><b>Comp multiple.</b> <code>ln M = (n·ln med_cat + ' + m.shrink_k + '·ln med_all) / (n + ' + m.shrink_k + ')</code>, clamped ' + m.multiple_min + '–' + m.multiple_max + '.</li>' +
      '<li><b>Momentum.</b> <code>(1 + clamp(7d, ' + m.growth_floor + ', +' + m.growth_cap + ')/100)^' + m.growth_exponent + '</code>: a week of inflows lifts value, outflows cut it.</li>' +
      '<li><b>Age without a token.</b> <code>' + m.age_floor + ' + ' + m.age_range + ' · min(days, ' + m.age_cap_days + ')/' + m.age_cap_days + '</code>: TVL that stayed with no token to pay for it is stickier, and users have banked more points.</li>' +
      '<li><b>Chain reach.</b> <code>1 + ' + m.reach_step + ' · min(chains − 1, ' + m.reach_cap + ')</code>.</li>' +
      '<li><b>Family.</b> ×' + m.family_sibling + ' when another protocol in the snapshot whose name starts with the same word records a token (its value may accrue to that token); ×' + m.family_parent + ' when a protocol is above the floor, records no token and passes every name and category rule yet is off the watchlist, which leaves DefiLlama\'s parent record as the reason. Both also add 15 risk points.</li>' +
      '<li><b>Airdrop.</b> Pool = implied × community share (12% user-facing apps, 10% DeFi infrastructure, 6% curated or institutional); ' + (m.depositor_share * 100) + '% assumed to reach depositors pro rata to TVL → value per $1k.</li>' +
      '<li><b>Farm plan.</b> The cheapest of the protocol\'s top three chains, that chain\'s wallet and gas per transaction, the category\'s own actions, a position sized to TVL (≥ $2,000 on Ethereum mainnet), a hold of 60–120 days by age. Totals add one-off gas and fees once and weekly ones for each week held.</li>' +
      '<li><b>Risk.</b> Youth, thin TVL, a 7-day outflow, a single chain and leverage or peg categories add points; ≥50 is High.</li></ol>' +
      '<p class="note">For the reader and the judge: the board ranks ' + R.counts.ranked + ' pre-token protocols, all ' + R.counts.watchlist + ' on the watchlist plus ' + R.counts.early + ' more it leaves out (below the $' + (R.floor_usd / 1e6) + 'M floor, or above it but filed under a parent and discounted ×' + m.family_parent + '). Implied value is the model\'s claim, not a prediction that a token launches.</p></div>' +
      compsCard() + '</div>';
  }

  // ---------- frame ----------
  function render() {
    document.getElementById('sub').textContent = 'Snapshot ' + R.as_of + ' · ' + R.counts.protocols + ' protocols · ' + R.counts.ranked + ' pre-token ranked by implied value · model ' + R.model_version;
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
      else { S.sort = k; S.dir = k === 'rank' || k === 'name' || k === 'risk' || k === 'plan' ? '1' : '-1'; }
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
