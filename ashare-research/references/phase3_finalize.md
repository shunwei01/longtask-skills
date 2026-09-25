# Phase 3: Finalization

Phase goal: Merge segment analyses into the final research report.

## 3.1 — Run merge.js

```bash
node scripts/merge.js --root .
```

Generates `reports/YYYY-MM-DD.md`: performance ranking (programmatic, by period change), overview table, per-target sections (trend / key levels / volume / patterns / risk / outlook).

## 3.2 — Quality Check

Read the generated report and verify:

1. **数据正确** — period change, high/low match the manifest/inputs (no hallucinated numbers)
2. **覆盖完整** — every target has a section; no "（未分析）" placeholders
3. **排序正确** — ranking matches period changes (strongest first)
4. **结论呼应任务** — if the user asked a comparison question, the ranking + agent-added synthesis answers it

## 3.3 — Fix and Re-merge

Bad sections → re-run that target (Phase 2 §2.5), then re-run merge. Merge is idempotent — it re-reads all segments fresh.

## 3.4 — Deliver

Copy the report to the user's requested location (or present it). `.task-data/` may be kept for resume/debugging or deleted.

## Completion Criteria

- [ ] Report file exists in `reports/`
- [ ] All targets covered with concrete key levels
- [ ] Ranking consistent with data
