# Phase 1: Data & Planning

Phase goal: Fetch market data per target and generate the task manifest.

## 1.1 — Run discover.js

```bash
node scripts/discover.js --root .
```

This will:
1. Read `.agent.env` for targets and lookback days
2. Call the Eastmoney kline API per target (daily bars, 前复权)
3. Compute interval statistics programmatically (period change, high/low, drawdown, volume shift, volatility)
4. Write `.task-data/manifest.json` — the task manifest
5. Write `.task-data/inputs/{chunk}-input.json` — per-target kline data + stats

## 1.2 — Review Manifest

```bash
node scripts/status.js --root .
```

Example output:
```
Total: 3 | Done: 0 | Failed: 0 | Skipped: 0 | InProgress: 0 | Pending: 3
Progress: 0% (0/3)
```

Check the console lines from discover: each target should show trading-day count and period change. Sanity-check against what you know of the market (e.g. a target that "should" be down showing +20% indicates a wrong secid).

## 1.3 — Adjust Scope (Optional)

Wrong targets or window? Edit `.agent.env` (`TARGETS` / `LOOKBACK_DAYS`) and re-run discover — it preserves DONE entries.

## Completion Criteria

- [ ] `manifest.json` exists with all targets in `pending` or `done` status
- [ ] `inputs/` has one file per target with `klines` and `stats` populated
- [ ] Each target shows a plausible trading-day count (~20-23 for one month)

→ Proceed to Phase 2.
