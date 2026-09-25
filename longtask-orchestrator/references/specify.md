# Specify & Decide — Stage 1 Reference

One-stop reference for the first generation stage: capture requirements, make the three
architecture decisions, and see how the two shipped skills resolve them. Read this before
writing any script.

---

## 1. Requirements Template

**Analyze-first principle**: infer an initial answer for every field from the user's
description, state plainly what you can already determine, and reserve option-style
questions for the genuinely ambiguous fields. Never hand the user a blank questionnaire.

```
Task Name: ___
Task Description: one sentence

Input:
  - Input type: [code files / API records / JSON data / config files]
  - Input scope: [whole repo / a directory / a fixed target list / user-supplied ids]
    ↳ Scope support is required by default when BOTH hold:
        (a) a subset can be processed independently of the whole, and
        (b) each item's success/failure is judged without reference to items outside scope
  - Estimated scale: [file count / item count / line count]

Operations:
  - What each subtask does: [analyze / transform / generate a report section]
  - Does it modify source files: [yes → needs validation + rollback / no → report only]

Output:
  - Output type: [modified files / per-item JSON / merged document]
  - Merge needed: [yes → merge.js / no → each segment independent]

Validation:
  - Success criterion: [output file exists + parses + required fields present]
  - Failure handling: [mark FAILED / revert / keep for manual pass]

Environment:
  - Extra runtime deps: [none / a data API / a build tool]
  - Target concurrency: [3–5 default / 10–20 high]
```

---

## 2. Decision Matrix

Three decisions follow directly from the template. The **shipped default** is what both
worked examples use; reach for an alternative only when the template forces it.

### 2.1 State storage

| Form | Use when | Notes |
|------|----------|-------|
| JSON manifest + `inputs/` (**shipped default**) | many items, each chunk carries its own input payload | manifest stays tiny (ids + status only); a subagent reads only its own input file |
| JSON single file | small, flat task list | simplest; fine when the whole manifest comfortably fits one read |

Layout (shipped default):

```
.task-data/
  manifest.json              # [{id, status, retry_count, ...}] — no file bodies
  inputs/{id}-input.json     # per-chunk payload the subagent reads
  segments/{id}-output.json  # per-chunk result the subagent writes
```

### 2.2 Grouping — what goes into one chunk

| Strategy | Use when |
|----------|----------|
| Per item (**shipped default**) | items are independent units — one paper, one stock, one file — each mapping to exactly one subagent |
| By directory + line-count ceiling | related files share context (imports/types) and must be handled together |

Set a ceiling so a chunk never overflows the context window. Work backwards from the model
window: fixed prompt overhead + file bodies must stay under ~60–70% of it. Empirical starting
point: 3000 lines/chunk (≈15–24K tokens); read-only review up to 5000. `build-prompt.js`
re-checks the real size at runtime (see `prompt_design.md` § Context Budget), so a loose
grouping ceiling is acceptable.

### 2.3 State machine (shipped default)

```
pending → in_progress → done ✅
                      ↘ failed ❌ → (retry budget) → permanent_failed
                      ↘ skipped ⏭️
```

`permanent_failed` is reached once `retry_count` exceeds the cap (see `runtime_patterns.md`
§ Retry Budget). `status.js` reports it separately so the final report never drops items
silently.

### 2.4 Isolation

Both shipped skills run subagents in the **shared working directory** with **disjoint output
files** — no isolation needed, because each chunk writes only its own
`segments/{id}-output.json` and never touches another chunk's files. This is the default;
only escalate if subtasks would write to overlapping paths.

---

## 3. Scope Variables

When §1 marks scope support required, the generated skill:

1. Defines scope variables in **`.agent.env`** with full-set defaults, overridable by the user:
   ```
   SCOPE_DIR=        # limit directory, relative to project root
   SCOPE_FILES=      # glob pattern, combined with SCOPE_DIR
   ```
2. Has `discover.js` apply the filter at scan time — not at dispatch time.
3. Regenerates the manifest idempotently when scope changes: keep `done` entries, append new
   ones, mark items moved out of scope `skipped` (never delete, to avoid losing progress).
4. Has `setup-env.js` explain each scope variable so users can validate on a small slice first.

> Pattern: run with `SCOPE_DIR=src/utils` to prove the rules cheaply, then clear it and run all.

---

## 4. Worked Examples (both shipped & evaluated in this repo)

The two skills below are the same architecture applied to two domains. They are the reference a
new skill should start from — read their `scripts/` for the concrete implementation.

| Dimension | arxiv-daily-review | ashare-research |
|-----------|--------------------|-----------------|
| Task | fetch the latest N papers of a category → per-paper structured summary → relevance-ranked daily report | fetch kline for a target list → per-target technical analysis → performance-ranked report |
| Modifies source files | No (report only) | No (report only) |
| discover fetches | arXiv API (category, `MAX_PAPERS`, `ARXIV_SPECIFIC_IDS`, date range) | Eastmoney kline API + programmatic interval stats (period change, drawdown, volatility) |
| State storage | JSON manifest + `inputs/` | JSON manifest + `inputs/` |
| Grouping | Per item (one chunk per paper) | Per item (one chunk per target) |
| Isolation | None (shared dir, disjoint outputs) | None (shared dir, disjoint outputs) |
| State machine | Basic (`pending/in_progress/done/failed/skipped` + `permanent_failed`) | Same |
| merge.js | Yes → `daily-reports/YYYY-MM-DD.md`, sorted by relevance, partial-completion banner | Yes → `reports/YYYY-MM-DD.md`, sorted by interval performance, same banner |
| Hardening present | events.jsonl, dispatch.lock + stale takeover, retry budget, completion gate | Same |
| pi invocation | `cd <root> && pi -p "$Q" --model <M> --tools write --mode json --no-session < /dev/null` | Same |

Both ship the six core scripts (`setup-env / discover / dispatch / build-prompt / status / merge`)
and no optional scripts. When your task matches "fetch a set of items → analyze each → merge one
report", copy one of these and change only three things: what `discover` fetches, what the
subagent produces, and what `merge` sorts by.
