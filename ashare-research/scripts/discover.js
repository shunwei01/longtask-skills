#!/usr/bin/env node
/**
 * discover.js — Fetch A-share market data per target, generate task manifest
 *
 * Usage: node scripts/discover.js --root <dir> [--days <N>]
 *
 * Idempotent: re-running preserves DONE entries, only re-fetches pending/failed.
 *
 * Output files:
 *   .task-data/manifest.json  — target list with status
 *   .task-data/inputs/{chunk}-input.json — kline data + precomputed stats per target
 *
 * Data source: Eastmoney public kline API (JSON, no auth).
 * Kline fields: date, open, close, high, low, volume(手), amount(元), amplitude, pct_chg
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── .env loading ──
function loadEnv(root) {
  const envPath = path.join(root, '.agent.env');
  if (!fs.existsSync(envPath)) {
    console.error('[discover] .agent.env not found. Run setup-env.js first (Phase 0).');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

// ── Argument parsing ──
function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) { args.root = path.resolve(argv[i + 1]); i++; }
    else if (argv[i] === '--days' && argv[i + 1]) { args.days = parseInt(argv[i + 1], 10); i++; }
  }
  return args;
}

// ── HTTP JSON client ──
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      timeout: 30000,
      ciphers: 'DEFAULT:!aNULL', // some Eastmoney edges reject Node's default cipher list
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API returned ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from API')); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('API timeout')));
  });
}

// ── Fetch with retry (Eastmoney API is occasionally flaky) ──
async function fetchJsonRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchJson(url);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

// ── Kline parsing ──
// Requested fields2: f51(date), f52(open), f53(close), f54(high), f55(low),
//                    f56(volume), f57(amount), f59(pct_chg) — 8 columns in that order.
function parseKlines(raw) {
  return raw.map(line => {
    const f = line.split(',');
    return {
      date: f[0],
      open: parseFloat(f[1]),
      close: parseFloat(f[2]),
      high: parseFloat(f[3]),
      low: parseFloat(f[4]),
      volume: parseFloat(f[5]),
      amount: parseFloat(f[6]),
      pct_chg: parseFloat(f[7]),
    };
  });
}

// ── Stats computation (programmatic, not by agent) ──
function round2(x) { return Math.round(x * 100) / 100; }

function computeStats(klines) {
  const n = klines.length;
  const first = klines[0];
  const last = klines[n - 1];
  const period_change_pct = (last.close / first.open - 1) * 100;

  let hi = klines[0], lo = klines[0];
  for (const k of klines) {
    if (k.high > hi.high) hi = k;
    if (k.low < lo.low) lo = k;
  }

  let peak = klines[0].close, maxDD = 0;
  for (const k of klines) {
    if (k.close > peak) peak = k.close;
    const dd = (k.close / peak - 1) * 100;
    if (dd < maxDD) maxDD = dd;
  }

  const up = klines.filter(k => k.pct_chg > 0).length;
  const down = klines.filter(k => k.pct_chg < 0).length;

  const amounts = klines.map(k => k.amount);
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / n;
  const half = Math.floor(n / 2);
  const fh = amounts.slice(0, half);
  const sh = amounts.slice(half);
  const fhAvg = fh.reduce((a, b) => a + b, 0) / fh.length;
  const shAvg = sh.reduce((a, b) => a + b, 0) / sh.length;
  const volume_shift_pct = (shAvg / fhAvg - 1) * 100;

  const pcts = klines.map(k => k.pct_chg);
  const mean = pcts.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(pcts.reduce((a, b) => a + (b - mean) ** 2, 0) / n);

  let recent5 = null;
  if (n >= 6) recent5 = (last.close / klines[n - 6].close - 1) * 100;

  return {
    first_open: first.open,
    last_close: last.close,
    period_change_pct: round2(period_change_pct),
    period_high: { price: hi.high, date: hi.date },
    period_low: { price: lo.low, date: lo.date },
    up_days: up,
    down_days: down,
    flat_days: n - up - down,
    avg_amount_yi: round2(avgAmount / 1e8),
    volume_shift_pct: round2(volume_shift_pct),
    max_drawdown_pct: round2(maxDD),
    daily_volatility_pct: round2(std),
    recent_5d_change_pct: recent5 === null ? null : round2(recent5),
  };
}

// ── Target parsing ──
function parseTargets(spec) {
  return spec.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf(':');
    return i === -1 ? { secid: s, name: s } : { secid: s.slice(0, i), name: s.slice(i + 1) };
  });
}

// ── Main ──
async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnv(args.root);

  const days = args.days || parseInt(env.LOOKBACK_DAYS || '30', 10);
  const apiBase = env.API_BASE || 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
  const targets = parseTargets(env.TARGETS || '1.000001:上证指数');

  // Date range (calendar days back from today)
  const end = new Date();
  const beg = new Date(end.getTime() - days * 86400000);
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const begStr = fmt(beg), endStr = fmt(end);
  const begIso = fmt(beg).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const endIso = fmt(end).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

  // Ensure .task-data directories exist
  const taskDir = path.join(args.root, '.task-data');
  const inputsDir = path.join(taskDir, 'inputs');
  const segmentsDir = path.join(taskDir, 'segments');
  fs.mkdirSync(inputsDir, { recursive: true });
  fs.mkdirSync(segmentsDir, { recursive: true });

  // ── Load existing manifest (idempotent) ──
  const manifestPath = path.join(taskDir, 'manifest.json');
  let existingManifest = [];
  const existingIds = new Set();
  if (fs.existsSync(manifestPath)) {
    existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    for (const entry of existingManifest) existingIds.add(entry.id);
  }

  console.log(`[discover] Fetching ${targets.length} targets, lookback ${days} days (${begIso} ~ ${endIso})...`);

  const newEntries = [];
  let fetched = 0;

  for (const t of targets) {
    const chunkId = 'target_' + t.secid.replace('.', '_');

    // Skip already-DONE entries (idempotent)
    if (existingIds.has(chunkId)) {
      const existing = existingManifest.find(e => e.id === chunkId);
      if (existing && (existing.status === 'done' || existing.status === 'skipped')) {
        newEntries.push(existing);
        console.log(`[discover]   Skip (${existing.status}): ${t.name}`);
        continue;
      }
      if (existing && existing.status === 'in_progress') {
        console.log(`[discover]   Reset (was in_progress): ${t.name}`);
      }
    }

    // Fetch klines
    const url = `${apiBase}?secid=${encodeURIComponent(t.secid)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f59&klt=101&fqt=1&beg=${begStr}&end=${endStr}`;
    let klines;
    try {
      const resp = await fetchJsonRetry(url);
      const data = resp && resp.data;
      if (!data || !Array.isArray(data.klines) || data.klines.length === 0) {
        throw new Error('no kline data returned');
      }
      if (data.name) t.name = data.name; // trust API name
      klines = parseKlines(data.klines);
    } catch (err) {
      console.error(`[discover]   ✗ ${t.name} (${t.secid}): ${err.message}`);
      continue; // failure isolation: other targets continue
    }
    fetched++;

    const stats = computeStats(klines);
    const inputPath = path.join(inputsDir, `${chunkId}-input.json`);
    fs.writeFileSync(inputPath, JSON.stringify({
      chunk_id: chunkId,
      target: { secid: t.secid, name: t.name },
      period: { beg: begIso, end: endIso, trading_days: klines.length },
      klines,
      stats,
    }, null, 2), 'utf-8');

    newEntries.push({
      id: chunkId,
      secid: t.secid,
      name: t.name,
      trading_days: klines.length,
      period_change_pct: stats.period_change_pct,
      status: 'pending',
    });

    console.log(`[discover]   ${t.name}: ${klines.length} 个交易日 (${klines[0].date} ~ ${klines[klines.length - 1].date}), 区间涨跌 ${stats.period_change_pct > 0 ? '+' : ''}${stats.period_change_pct}%`);
  }

  if (fetched === 0 && newEntries.filter(e => e.status === 'done').length === 0) {
    console.error('[discover] No targets fetched successfully. Check TARGETS and network.');
    process.exit(2);
  }

  // Write manifest
  fs.writeFileSync(manifestPath, JSON.stringify(newEntries, null, 2), 'utf-8');
  const doneCount = newEntries.filter(e => e.status === 'done').length;
  const pendingCount = newEntries.filter(e => e.status === 'pending').length;

  console.log(`\n[discover] Manifest written: ${newEntries.length} total, ${pendingCount} pending, ${doneCount} done.`);
  console.log('[discover] Ready for Phase 2 (dispatch).');
}

main().catch(err => {
  console.error('[discover] Fatal:', err.message);
  process.exit(1);
});
