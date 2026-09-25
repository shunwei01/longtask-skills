# Phase 2: Batch Execution

Phase goal: Concurrently dispatch subagents to analyze each target.

## 2.1 — Dry-run Preview

```bash
node scripts/dispatch.js --root . --dry-run
```

Check prompt sizes (should be well under 4000 tokens each). If a prompt is huge, the target may have an unexpectedly long window — re-check `LOOKBACK_DAYS`.

## 2.2 — Run Dispatch

```bash
node scripts/dispatch.js --root . --concurrency 5
```

- Each target: prompt built → `pi -p` subprocess launched → output validated (file exists + valid JSON + required fields) → manifest updated immediately
- 10-minute timeout per target; failures are isolated and marked `failed` without affecting others

## 2.3 — Monitor

```bash
node scripts/status.js --root .
```

## 2.4 — Inspect Output Quality (Optional but Recommended)

Spot-check 1-2 segment files:

```bash
cat .task-data/segments/target_1_000001-output.json
```

Verify: trend phase matches the kline table, support/resistance are concrete numbers, volume assessment matches the stats. Bad output (wrong direction, made-up numbers) → re-run that target.

## 2.5 — Handle Failures

```bash
node scripts/dispatch.js --root . --retry-failed --concurrency 3
```

Common failure: subagent writes invalid JSON (e.g. unescaped quotes). Retry usually succeeds. Persistent failures: check MODEL config, then analyze that target yourself and write the output JSON by hand following the schema in `build-prompt.js`.

## Completion Criteria

- [ ] `status.js` exit code 0 (all done, or failures consciously accepted)
- [ ] Segment outputs validated

→ Proceed to Phase 3.
