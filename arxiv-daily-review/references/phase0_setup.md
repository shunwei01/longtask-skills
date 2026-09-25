# Phase 0: Environment Setup

Phase goal: Ensure all dependencies are ready and write configuration to `.agent.env` in one shot.

## 0.1 — Run setup-env.js

Run the environment setup script. By default it uses `cs.AI` category and "LLM Agent" as research direction — adjust options as needed:

```bash
# Default (cs.AI, 20 papers, LLM Agent)
node scripts/setup-env.js --root .

# Customized
node scripts/setup-env.js --root . --category cs.CL --max-papers 30 --direction "RLHF alignment"
```

The script will:
1. Check Node.js and pi CLI are available
2. Collect configuration defaults or from CLI args
3. Create `daily-reports/` output directory
4. Write `.agent.env` with all variables

## 0.2 — Verify .agent.env

After setup, check `.agent.env` contains:

```
MODEL=pi-default
ARXIV_CATEGORY=cs.AI
MAX_PAPERS=20
RESEARCH_DIRECTION=LLM Agent
PROJECT_DIR=<absolute path>
OUTPUT_DIR=<absolute path>/daily-reports
```

**One-shot principle**: After Phase 0 ends, `.agent.env` contains all variables needed by Phases 1-3. No phase should prompt the user again mid-run.

## 0.3 — Scope Variables (Optional)

For incremental or focused runs, you can add scope variables to `.agent.env`:

```
# Only process specific papers (bypasses arXiv search):
ARXIV_SPECIFIC_IDS=2301.12345,2301.12346

# Or limit date range:
ARXIV_DATE_RANGE=2025-01-10:2025-01-15
```

## Completion Criteria

- [ ] `.agent.env` exists and contains all required variables
- [ ] `daily-reports/` directory exists
- [ ] `setup-env.js` exited with code 0

→ Proceed to Phase 1.