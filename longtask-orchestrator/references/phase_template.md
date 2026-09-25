# Phase Reference Writing Pattern

When writing `references/phaseN_xxx.md` for the generated Skill, each file follows a unified structure:

```
# Phase N: [Phase Name]
Phase goal: one sentence.

## N.1 [First Step]
(Specific instructions, including commands to run)

## N.2 [Second Step]
...

## Completion Criteria
[What file/condition exists] → Phase N complete, can proceed to Phase N+1.
```

---

## What Each Generated Phase File Should Contain

The phase contract itself lives in SKILL.md § Four Phases; this is the authoring detail for the
per-phase `references/phaseN_*.md` files the generated skill ships.

- **phase0_setup.md** — the 5-step environment init from `pi_cli.md`: check Node / pi CLI / API key /
  model, write every variable later phases need **to `.agent.env` in one shot**, run `setup-env.js`,
  and verify the exit code. After Phase 0, nothing may prompt the user again.
- **phase1_analyze.md** — run `discover.js`, then report the chunking result (chunk count, item/file
  count, size distribution) so the user can sanity-check scope before any tokens are spent.
- **phase2_dispatch.md** — confirm the model, run `dispatch.js`, check progress, retry failures, and
  document interruption recovery. Subagents run as independent `pi -p` processes (see SKILL.md §
  Subagent execution model); command options in `pi_cli.md`.
- **phase3_finalize.md** — run `merge.js`, then a task-specific global check (for report-style skills:
  validate every segment parsed and required fields are present; for source-modifying skills: run the
  build/type check the task defines), generate the final report, and clean up temp files.
