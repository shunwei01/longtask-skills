# Phase 2: Batch Execution

Phase goal: Dispatch subagents to analyze each paper in parallel.

## 2.1 — Verify Model

Check `.agent.env` for the model to use:

```bash
grep MODEL .agent.env
```

Default is `pi-default`. If you want to use a different model for batch analysis, edit it.

## 2.2 — Dry Run (Recommended)

Before launching 20 concurrent subagents, preview the prompts:

```bash
node scripts/dispatch.js --root . --dry-run
```

This prints each paper's prompt and estimated token count without making API calls. Verify:
- Research direction is correct in prompts
- Token estimates are reasonable (<4000 per paper)
- No garbled or missing paper data

## 2.3 — Launch Dispatch

```bash
# Default: 5 concurrent subagents
node scripts/dispatch.js --root .

# Custom concurrency (arXiv rate limits are lenient; 10 is safe)
node scripts/dispatch.js --root . --concurrency 10
```

What happens:
1. Manifest is read; pending papers are filtered
2. For each paper: `build-prompt.js` assembles a self-contained prompt
3. Prompt is passed to `pi -p` as an independent process
4. Subagent reads abstract, writes structured analysis to `segments/{id}-output.json`
5. dispatch.js checks output file → marks DONE or FAILED
6. State written to disk immediately after each paper (crash-safe)

**This is not nested Agent tool calling** — each paper analysis is an independent CLI process, guaranteeing:
- No context accumulation across papers
- True concurrent execution
- Single-paper failures don't cascade

## 2.4 — Monitor Progress

```bash
# Check progress any time
node scripts/status.js --root .
```

While dispatch runs, you can watch progress in another terminal.

## 2.5 — Retry Failures

After the initial run, retry any failed papers:

```bash
node scripts/dispatch.js --root . --retry-failed --concurrency 3
```

This re-processes entries with `failed` or `error` status. Only 3 concurrent for retries (issues may be transient).

## 2.6 — Interruption Recovery

If dispatch is interrupted (Ctrl+C, network drop, etc.):

1. Some papers may show `in_progress` — these are stale
2. Re-running dispatch resets `in_progress` to `pending` automatically (discover.js handles this)
3. Run `node scripts/dispatch.js --root .` again — only remaining and failed papers are processed

## Completion Criteria

- [ ] All papers in `done` or `failed` status (`status.js` exit code 0)
- [ ] `.task-data/segments/` has output files for each done paper
- [ ] Review a few output files to verify quality

→ Proceed to Phase 3.