---
name: longtask-orchestrator
description: >
  A meta-skill for designing and generating "long-running task Skills". Use when a user needs to create a Skill that spans a large number of files or items, requires cross-session resumption, or needs concurrent subagent scheduling.
  Trigger scenarios: (1) the user says "help me make a skill that bulk-processes XXX", (2) the user describes a batch task spanning dozens to thousands of items/files, even if they never say "skill",
  (3) the user says "create a long-running task", "make a long-running task skill", "a skill that fetches a set of items and analyzes each in parallel".
  This skill drives generation end-to-end, runs an independent grader review, then invokes `skill-eval` for a smoke test behind a single user-confirmation gate.
---

# Longtask Orchestrator — Meta-Skill

A framework for designing and generating **long-running task Skills** for AI coding agents. A
long-running task touches dozens to thousands of items, cannot finish in one session, and needs
concurrent scheduling with cross-session resumption. The meta-skill turns a one-line description
into a complete, runnable Skill.

This document has two halves:

- **PART A — Generation workflow**: what *you* (the meta-agent) do to build a skill.
- **PART B — Runtime contract**: the content you *embed* into the generated SKILL.md so the
  resulting skill runs reliably. It is not what the meta-agent executes.

---

## PART A — Generation Workflow

Three stages; each names the reference to consult.

### Stage 1 — Specify & Decide

Infer initial answers to the requirement fields from the user's description, confirm the genuinely
ambiguous ones with directed questions, then lock the three architecture decisions (state storage,
grouping, state machine) plus isolation. The template, decision matrix, and the two shipped worked
examples are all in `references/specify.md`. Always present your inferred answers before asking
anything — do not hand the user a blank questionnaire.

### Stage 2 — Generate

Write the skill files in this order, consulting the named reference before each:

1. `setup-env.js` — environment init (`references/pi_cli.md` § Environment Initialization)
2. `discover.js` — scan → group → task manifest (`references/script_patterns.md`; scope vars per `references/specify.md` § Scope Variables)
3. `build-prompt.js` — self-contained subtask prompts (`references/prompt_design.md`)
4. `dispatch.js` — concurrent scheduling core (`references/script_patterns.md`, `references/error_handling.md`)
5. `status.js` — progress query
6. `merge.js` — collect and merge results
7. `SKILL.md` + the generated skill's `references/phaseN_*.md` (`references/phase_template.md`)

Generated layout:

```
<skill-name>/
├── SKILL.md
├── scripts/
│   ├── setup-env.js
│   ├── discover.js
│   ├── dispatch.js
│   ├── build-prompt.js
│   ├── status.js
│   └── merge.js
├── references/
│   ├── phase0_setup.md
│   ├── phase1_analyze.md
│   ├── phase2_dispatch.md
│   └── phase3_finalize.md
└── evals/
    └── evals.json
```

When writing `dispatch.js` / `merge.js` / `status.js`, include the hardening patterns from
`references/runtime_patterns.md` (startup recovery, `events.jsonl`, retry budget, completion gate,
dispatch lock). They are small and cheap; skipping them means every interrupted run risks silent
data loss.

### Stage 3 — Validate

Two quality gates on the same artifact — grader first (static, cheap), eval smoke test second
(spends real tokens and ends in the user gate):

1. **Independent grader review** — launch a separate `pi -p` agent over the generated directory,
   fix findings by abstracting and generalizing the underlying pattern (never patching a single
   line), and loop up to 3 rounds. Full flow and prompt template in `references/eval_grader.md`.
2. **Eval smoke test** — invoke `skill-eval` once against the generated skill, present the complete
   result, and **wait for the user's decision**: accept → done; improve → edit the files and return
   to the grader. This is the only user-confirmation gate in the workflow.

---

## PART B — Runtime Contract of the Generated Skill

The following is embedded into the generated `SKILL.md`; it describes how the *resulting skill*
behaves at run time.

### Four Phases

| Phase | Responsibility | Executor | Output |
|-------|----------------|----------|--------|
| 0 Setup | Node / pi CLI / API key / model → write all vars to `.agent.env` in one shot | Main Agent + setup-env.js | `.agent.env` |
| 1 Analyze | Scan items, group, generate task manifest | Main Agent + discover.js | `manifest.json` |
| 2 Execute | Dispatch subagents concurrently, validate, retry | dispatch.js + subagents | per-item `segments/{id}-output.json` |
| 3 Finalize | Merge, global validation, generate report | Main Agent + merge.js | final artifact |

Before each phase the main agent reads the generated skill's `references/phaseN_*.md`.

### Subagent execution model

Subtasks run as **independent CLI processes** launched by `dispatch.js` via `pi -p`, never as nested
Agent-tool calls inside the main agent's session. This single rule is the load-bearing decision of
the framework, because independent processes:

1. **Guarantee prompt determinism** — `build-prompt.js` assembles each prompt programmatically; if
   the main agent relayed prompts through its session it would re-interpret and rewrite them,
   drifting from intent.
2. **Eliminate context accumulation** — each process carries only its own task's context; nothing
   from prior chunks bloats the window or distracts attention.
3. **Enable real concurrency control** — the pool size is a script parameter (3–20+), adjustable to
   rate limits, not the agent's naturally conservative self-scheduling.
4. **Support pre/post orchestration** — scripts inject deterministic logic around each run (validate
   output, update state, clean temp files) without spending agent tokens.

Canonical invocation (matches the shipped skills):

```bash
cd <root> && QUERY_CONTENT=$(cat <tmp-query-file>); \
  pi -p "$QUERY_CONTENT" --model <MODEL> --tools write --mode json --no-session < /dev/null
```

Success is judged by the output file (exists + parses), never by parsing stdout.

### Session resumption detection

Written into the generated SKILL.md verbatim:

```
1. .agent.env exists?              No → Phase 0
2. manifest exists?                No → Phase 1
3. Any in_progress entries?        Yes → valid output? mark done : reset to pending
4. All terminal (done/permanent_failed/skipped)?  Yes → Phase 3 : No → Phase 2 (continue)
```

### Six design principles the generated skill must embody

1. **File As Progress** — every state change is followed by an immediate `writeFileSync`; resumption
   relies only on disk.
2. **Context Reset** — each subagent prompt is fully self-contained (file bodies, rules, output
   format + path, validation criteria); never assume the subagent "already knows" anything.
3. **Task Contract** — completion = output file exists + parses; not text output.
4. **Idempotent & Incremental** — re-running never overwrites completed results; discover only adds,
   dispatch only processes pending/failed.
5. **Programmatic over Agent** — grouping, prompt assembly, state updates, and merging are scripted;
   the agent only does work requiring comprehension.
6. **Failure Isolation** — errors are resolved at the smallest scope and never escape a subtask;
   phase 2 ends with only done or explicitly-failed states. Three-layer retry in
   `references/error_handling.md`.

### Completion criteria

```bash
node scripts/status.js --root .   # exit 0 = all terminal; non-0 = incomplete entries remain
```

---

## References

| File | Consumed by | Content |
|------|-------------|---------|
| `references/specify.md` | Stage 1 | Requirements template, decision matrix, scope variables, worked examples |
| `references/pi_cli.md` | Stage 2 | pi CLI reference + Phase 0 environment-init spec |
| `references/script_patterns.md` | Stage 2 | Interface specs + implementation patterns for each script |
| `references/prompt_design.md` | Stage 2 | Prompt quality principles, five-component structure, Context Budget |
| `references/error_handling.md` | Stage 2 | Success determination, three-layer retry, IN_PROGRESS residual handling |
| `references/runtime_patterns.md` | Stage 2 | Startup recovery, event log, retry budget, completion gate, dispatch lock |
| `references/phase_template.md` | Stage 2 | Writing pattern for the generated `phaseN_*.md` files |
| `references/eval_grader.md` | Stage 3 | Grader prompt template, review dimensions, abstract-generalization principle |
