# Pi CLI Reference

`pi` is the CLI tool used by the long-running task framework (i.e., the Pi coding agent CLI).

For full CLI parameter documentation, see the official Pi documentation.

---

## Environment Initialization Spec

The generated Skill's `setup-env.js` / Phase 0 must complete environment checks and configuration in the following order, and **write all variables needed by subsequent phases to `.agent.env`** (not just export them), ensuring each Phase does not depend on the current shell state when reading them.

### Step 1 — Ensure Node.js is Available

```bash
node --version
```

If not present, install via fnm:

```bash
curl -fsSL https://fnm.vercel.app/install | bash
fnm install --lts && fnm use lts-latest
# After installation, source the corresponding shell config (~/.bashrc or ~/.zshrc)
```

### Step 2 — Ensure pi CLI is Available

```bash
pi --version
```

If not present, install globally:

```bash
npm install -g @earendil-works/pi-coding-agent
```

### Step 3 — Obtain and Persist API Key

First check the user's query, then check environment variables. If not set, prompt the user to obtain an API Key, and:
1. Persist to shell config (`~/.bashrc` or `~/.zshrc`)
2. Write to the `.agent.env` file in the working directory (**must write to file, cannot just export**)

```bash
# .agent.env format
API_KEY=your_api_key_here
MODEL=pi-default
PROJECT_DIR=/absolute/path/to/project
# ... other variables needed by subsequent phases
```

### Step 4 — Model

Use the default Pi model; write it to the `MODEL` field in `.agent.env`.

### Step 5 — Confirm All Paths Are Literal Absolute Paths

All paths passed to pi subcommands **must be resolved to literal absolute paths**; shell variable forms (e.g., `$PROJECT_DIR`) are prohibited — shell variables in `.agent.env` are not expanded, causing silent failures.

### .agent.env One-Shot Collection Principle

When Phase 0 ends, `.agent.env` must contain all variables needed by all subsequent Phases. Each Phase reads from `.agent.env` and must not prompt the user again mid-run.

---

## Calling Pattern in dispatch.js

Key point: pass prompts via a temporary file (to avoid shell escaping), and **judge success by the
output file, not by parsing stdout** (see the Task Contract principle in SKILL.md).

```bash
# ⚠️ pi CLI has no --cwd flag; change working directory with cd
QUERY_CONTENT=$(cat /path/to/tmp-query.txt)
cd /path/to/project && pi -p "$QUERY_CONTENT" \
  --model "$MODEL" \
  --tools write \
  --mode json \
  --no-session < /dev/null
```

- `--tools write` — pre-approves the tools the subagent needs, avoiding interactive confirmation prompts mid-run.
- `--mode json` — structured output.
- `--no-session` — each run is stateless, so a fresh process never inherits stale context.
- `< /dev/null` — closes stdin so the CLI never blocks waiting for input.
- Working directory is switched via `cd`, not `--cwd` (that flag does not exist).

**Retrying a failed chunk**: because every run is stateless (`--no-session`), the shipped skills retry
by re-dispatching the *same* prompt as a brand-new process — driven by `--retry-failed` and a
`retry_count` budget (see `runtime_patterns.md` § Retry Budget). If your provider supports persistent
sessions, an optional lower-cost alternative is to resume the prior session instead of restarting:

```bash
cd /path/to/project && pi -p "Continue the previous task" \
  --resume <session_id> \
  --model "$MODEL" \
  --tools write \
  --mode json
```

For full invocation examples and the concurrency pool implementation, see `script_patterns.md` § dispatch.js.
