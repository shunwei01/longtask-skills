# Phase 1: Analysis & Planning

Phase goal: Fetch the latest papers from arXiv and generate the task manifest.

## 1.1 — Run discover.js

```bash
node scripts/discover.js --root .
```

This will:
1. Read `.agent.env` for category and paper count
2. Call arXiv API (`export.arxiv.org`) to fetch the latest papers
3. Parse XML response into structured paper entries
4. Write `.task-data/manifest.json` — the task manifest
5. Write `.task-data/inputs/{paper_id}-input.json` — per-paper metadata

## 1.2 — Review Manifest

Check what discover.js found:

```bash
node scripts/status.js --root .
```

Example output:
```
Total: 20 | Done: 0 | Failed: 0 | Skipped: 0 | InProgress: 0 | Pending: 20
Progress: 0% (0/20)
```

## 1.3 — Adjust Scope (Optional)

If the default 20 papers is too many or too few, edit `.agent.env`:

```
MAX_PAPERS=10
```

Then re-run discover — it preserves already-DONE entries and adds new ones. Already-processed papers won't be re-analyzed.

## 1.4 — Custom Paper List (Optional)

To analyze specific papers instead of the latest feed, set in `.agent.env`:

```
ARXIV_SPECIFIC_IDS=2301.12345,2301.12346,2301.12347
```

Then re-run discover.

## Completion Criteria

- [ ] `manifest.json` exists with papers and all in `pending` or `done` status
- [ ] `inputs/` directory has one file per paper
- [ ] `status.js --root .` shows expected paper count

→ Proceed to Phase 2.