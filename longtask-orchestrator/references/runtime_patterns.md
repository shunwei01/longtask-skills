# Runtime Hardening Patterns

Optional patterns to include when generating a long-running task skill. They harden the
generated dispatch/merge/status scripts against the failure modes observed in real
end-to-end evaluations. Each is cheap to generate and pays for itself on any interrupted or flaky run.

## 1. Startup Recovery — reconcile stale `in_progress`

**Problem.** A dispatch process killed mid-run (network drop, Ctrl-C, machine sleep)
leaves manifest entries in `in_progress`. The default pending-only filter silently
skips them — the final report is missing targets and nobody notices.

**Pattern.** At dispatch startup, before filtering tasks:

```js
for (const entry of manifest) {
  if (entry.status === 'in_progress') {
    // Task Contract check: does a valid output already exist?
    const ok = validOutputExists(entry);   // file exists + parses + has required fields
    entry.status = ok ? 'done' : 'pending';
  }
}
```

Valid output → recover to `done` (work was finished, only the status write was lost).
Missing/invalid output → back to `pending` (will be re-dispatched this run).

## 2. Event Log — append-only `.task-data/events.jsonl`

**Problem.** After a failed or partial run, reconstructing *when and why* chunks failed
requires the executor's transcript, which may not exist.

**Pattern.** One JSON line per orchestration-level event; append-only, never rewritten:

```js
function logEvent(root, type, detail) {
  const line = JSON.stringify({ ts: new Date().toISOString(), type, ...detail });
  fs.appendFileSync(path.join(root, '.task-data', 'events.jsonl'), line + '\n', 'utf-8');
}
// Events: dispatch_start · chunk_start · chunk_done · chunk_failed ·
//         recovered_stale · retry_budget_exhausted · dispatch_complete
```

Tolerate read errors in downstream consumers; a corrupted trailing line must not block
the next run (post-mortem tooling truncates or skips bad lines).

## 3. Retry Budget — cap retries, then `permanent_failed`

**Problem.** `--retry-failed` can be re-run indefinitely. A systematically broken chunk
(e.g. a prompt the model always answers with invalid JSON) burns tokens forever.

**Pattern.** Track attempts in the manifest entry (`retry_count`). On each dispatch,
before filtering:

```js
const MAX_RETRIES = 3;
if ((entry.status === 'failed') && (entry.retry_count || 0) >= MAX_RETRIES) {
  entry.status = 'permanent_failed';   // excluded from retry filter
}
```

`status.js` reports `PermanentFailed` separately; the final report lists these targets
explicitly rather than dropping them silently. Raising the budget is a one-line change
the main agent can make deliberately after inspecting `events.jsonl`.

## 4. Completion Gate — declarative check at merge time

**Problem.** merge.js happily generates a report from whatever segments exist. If 3 of
10 chunks failed, the user gets a polished-looking partial report with no signal.

**Pattern.** merge.js reads the manifest and, for every entry not in a terminal-success
state, prints a warning and injects a banner into the report:

```js
> ⚠️ **部分完成**：本报告缺少 N 个未完成标的（id（failed: reason）…）
> 先运行 dispatch --retry-failed 再重新 merge 可补全。
```

Key principle: completion is checked by *code*, not by the LLM's own judgment. Fail-soft —
generate the partial report anyway, but never silently.

## 5. Dispatch Lock — single-instance guard

**Problem.** Two dispatch processes running concurrently (user re-runs in a second
terminal; a cron overlaps a manual run) interleave read-modify-write cycles on
manifest.json and lose status updates.

**Pattern.** A pid lock file with liveness detection:

```js
// .task-data/dispatch.lock = { pid, startedAt }
try { process.kill(pid, 0); alive = true; } catch { alive = false; }
// alive → abort (exit 3); stale/unparseable → remove and take over
```

Always release in a `finally`. On process crash the lock goes stale and the next run
takes over automatically.

## 6. Provider Preflight — verify the subagent CLI before batch dispatch

**Problem.** A wrong CLI flag or model name (e.g. `--allowedTools` vs `--tools`,
a model not in the provider catalog) surfaces only 10 minutes into a batch, after
every chunk has timed out.

**Pattern.** Document a preflight step in `references/phase0_setup.md`:

```bash
pi -p "Reply with: ok" --model <MODEL> --tools write --mode json --no-session < /dev/null
```

If this fails, fix the env config *before* discover/dispatch. (Optionally automate it
in setup-env.js behind a `--smoke` flag; keep it opt-in since it spends one model call.)
