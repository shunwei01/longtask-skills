# Error Handling Spec

This document defines the runtime error handling strategy for long-running task Skills. For design decisions (state storage, grouping, etc.), see `specify.md`.

---

## Core Principle: Resolve Errors at the Smallest Possible Scope

"Smallest scope" is layered:

- **Subtask self-containment**: If a subagent detects invalid output during execution (e.g., compilation fails, JSON schema validation fails), it should fix the issue within the current session rather than leaving errors for subsequent steps. When unfixable, revert the workspace, mark FAILED, and explicitly inform the upper layer — do not let problematic output mix into the completion queue.
- **Phase-level convergence**: Failed tasks during Phase 2 (batch execution) must be handled within that phase (retried or marked FAILED); when entering Phase 3 (finalization), only "completed" or "explicitly marked FAILED" states are allowed. Handoffs between phases must be clean — otherwise downstream work continues on problematic output, and issues only surface during acceptance, wasting the entire chain.

## Success Determination

Check the output file as specified by the Task Contract: file exists + format valid (e.g., JSON.parse passes) = success.

Do not parse subagent text output — text is unreliable (may be truncated, format inconsistent).

## Three-Layer Retry Mechanism

**Inner layer: Re-dispatch on abnormal exit (continuation)**

Applicable when: process crash, network failure, or other abnormal exit where the task logic itself is not at fault — the output file is missing but nothing about the task is wrong.

Because each subagent runs stateless (`--no-session`, see `pi_cli.md`), the default recovery is simply to re-dispatch the *same* prompt as a fresh process. The Task Contract makes this safe: a chunk is only marked done when its output file exists and parses, so re-running an unfinished chunk is idempotent.

```javascript
// Inner layer: re-dispatch the same prompt (in the catch branch of runChunk,
// still via execAsync so the concurrency pool is not blocked).
// ⚠️ pi CLI has no --cwd flag; change working directory with cd.
await execAsync(originalCmd, { timeout: 30 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });
```

If your provider supports persistent sessions, an optional lower-cost variant is to resume the prior
session instead of restarting (`pi -p "Continue the previous task" --resume <session_id> …`) — the
agent then picks up from the interruption point rather than re-reading its input. Cap this layer at
1-2 attempts; beyond that the exit is probably not transient.

**Middle layer: New session with feedback (targeted fix)**

Applicable when: the subagent completes normally, but the output fails validation (schema invalid, required fields missing, a build/type check the task defines).

Start a fresh subagent session and attach the complete error information (error content, the failed validation rule) as context in the prompt. The agent fixes only the error point, not the whole chunk.

- Cap at **3 attempts** — the same budget `runtime_patterns.md` § Retry Budget tracks as `retry_count`; when it is exhausted the entry moves to `permanent_failed` rather than looping forever.
- Each attempt carries the *accumulated* errors (not just the latest), so the agent can see the failure pattern.
- On exhaustion: revert any files the subtask touched, clean up, and mark the entry `failed` / `permanent_failed`.

**Outer layer: Main Agent re-dispatch (decision layer)**

Applicable when: after the middle layer is exhausted, a batch of FAILED tasks has accumulated.

The main Agent checks the FAILED count and error characteristics, and makes a decision:

- **Few FAILEDs (e.g., ≤5%)**: Errors may be intermittent and worth re-dispatching this batch of files (re-group, generate new prompts, launch new subagents) — essentially rerunning them as brand-new tasks.
- **Many FAILEDs (e.g., >10%)**: May indicate the task rules themselves have problems (rules unclear, target files have systemic issues); blindly retrying only wastes tokens. The main Agent should first analyze the failure patterns, possibly needing to adjust build-prompt rule descriptions or exclude certain files.

You need to judge whether a retry is worthwhile. Non-recoverable errors do not need to be retried.

### Three-Layer Reference Table

| Layer | Trigger | Implementation | Cost | Limit |
|-------|---------|----------------|------|-------|
| Inner | Process crash / network failure, output missing | Re-dispatch same prompt (stateless); optional `--resume` | Lowest | 1–2 |
| Middle | Output exists but fails validation | New session + accumulated error info | Medium | 3 (→ `permanent_failed`) |
| Outer | Batch of failures after middle exhausted | Main Agent decides whether to re-dispatch | High | Main Agent judgment |

## IN_PROGRESS Residual Handling

When the Agent is interrupted, some tasks may be stuck in IN_PROGRESS. New sessions resuming must handle this:

- **Option A (reset to TODO)**: Suitable for idempotent, side-effect-free tasks (e.g., read-only review, revertible migration operations)
- **Option B (check output file to decide)**: Suitable for tasks that modify source files. Check if output file exists and is valid; if so, mark DONE, otherwise reset to TODO

Which option to choose depends on "whether re-executing this subtask is safe". Read-only tasks use A; tasks that modify files and whose output is verifiable use B.
