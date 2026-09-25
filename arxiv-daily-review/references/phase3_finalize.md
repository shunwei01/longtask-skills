# Phase 3: Finalization & Validation

Phase goal: Merge individual analyses into a polished markdown daily report.

## 3.1 — Run merge.js

```bash
node scripts/merge.js --root .
```

This will:
1. Read all `segments/*-output.json` files
2. Parse each analysis
3. Sort by relevance score (high → low)
4. Generate `daily-reports/YYYY-MM-DD.md`

## 3.2 — Report Structure

The generated report contains:

1. **Header**: date, category, research direction, paper count
2. **Table of Contents**: paper title, relevance score, core theme
3. **Paper Details**: for each paper:
   - Background & motivation
   - Method & approach
   - Key results
   - Limitations & outlook
   - Innovation points
   - Keywords

## 3.3 — Quality Check

After merging, review the report:

```bash
# Open the generated report
open daily-reports/$(date +%Y-%m-%d).md

# Or view top entries in terminal
head -100 daily-reports/$(date +%Y-%m-%d).md
```

Key quality signals:
- Papers with relevance ≥ 4 are genuinely relevant to your direction
- Summaries are in Chinese with substance, not filler
- Innovation points distinguish genuine novelty from restatements of the abstract

If some analyses look off (e.g., summaries in English instead of Chinese, generic filler), note the paper IDs and re-dispatch those specific papers with refined prompts.

## 3.4 — Re-dispatch Specific Papers (Optional)

To re-analyze specific papers:

1. Add their arXiv IDs to `.agent.env`:
   ```
   ARXIV_SPECIFIC_IDS=2401.12345,2401.12346
   ```
2. Reset their status in `manifest.json` from `done` to `pending`
3. Run `node scripts/dispatch.js --root . --retry-failed`
4. Re-run merge

## 3.5 — Cleanup Temp Files (Optional)

The `.task-data/` directory can be cleared once you're satisfied with the report:

```bash
# Keep for resumption debugging — or remove to save space
rm -rf .task-data/
```

The generated `.agent.env` and `daily-reports/` are the persistent artifacts.

## Completion Criteria

- [ ] `daily-reports/YYYY-MM-DD.md` exists and is well-formed
- [ ] Report contains all completed papers, sorted by relevance
- [ ] Quick scan confirms summaries are substantive and in Chinese

→ Skill run complete. Repeat daily by running Phase 1 → 2 → 3.