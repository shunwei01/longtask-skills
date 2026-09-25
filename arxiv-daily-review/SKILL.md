---
name: arxiv-daily-review
description: >
  每日 arXiv 论文速览。从 arXiv 指定分类抓取最新论文，逐篇生成中文结构化摘要（背景·方法·结果·局限）、
  提取创新点、按研究方向评相关性，最终合并为 markdown 日报。适合需要持续跟踪特定领域前沿的研究者。
  Trigger: "论文日读"、"arxiv daily"、"今日论文"、"每日arXiv"、"paper review"
---

# ArXiv Daily Review — 论文日读

每天从 arXiv 抓取最新 N 篇论文 → 并发分析 → 生成结构化中文日报。

## Four Phases

| Phase | Responsibility | Executor | Output |
|-------|---------------|----------|--------|
| 0: Environment Setup | 配置分类、论文数、研究方向，写入 `.agent.env` | Main Agent + setup-env.js | `.agent.env` |
| 1: Analysis & Planning | 调用 arXiv API，生成论文清单 | Main Agent + discover.js | `manifest.json` + `inputs/` |
| 2: Batch Execution | 并发调度子 Agent 逐篇分析 | dispatch.js + subagents | `segments/*.json` |
| 3: Finalization | 合并为日报 markdown，按相关度排序 | Main Agent + merge.js | `daily-reports/YYYY-MM-DD.md` |

Before each Phase, read the corresponding `references/phaseN_xxx.md` for detailed instructions.

## Session Resumption Detection

```
1. Does .agent.env exist?         No → Phase 0
2. Does .task-data/manifest.json exist?  No → Phase 1
3. Any IN_PROGRESS tasks?         Yes → Check if their output files exist and are valid
                                       → Valid: mark DONE, continue
                                       → Invalid or missing: reset to TODO, enter Phase 2
4. All DONE or FAILED?            Yes → Phase 3 / No → Phase 2 (continue)
```

## Key Design Principles

1. **File As Progress** — 所有状态写磁盘。dispatch 每处理完一篇论文立即更新 manifest，不等到批次结束
2. **Context Reset** — 每个子 Agent 拿到的是自包含 prompt（论文标题+摘要+任务要求），不依赖其他论文的上下文
3. **Task Contract** — 成功标准：输出文件存在 + JSON 可解析 + 包含必要字段。不解析子 Agent 的文本输出
4. **Idempotent & Incremental** — 重复运行 discover 不覆盖已完成的论文；dispatch 只处理 pending/failed
5. **Programmatic over Agent** — 论文抓取、prompt 组装、状态管理、结果合并全是脚本完成。Agent 只做需要理解力的工作：阅读摘要、撰写分析
6. **Failure Isolation** — 单篇论文失败不影响其他；retry-failed 机制单独重试；merge 自动跳过损坏文件

## Installation & First Run

```bash
# Step 1: Setup
node scripts/setup-env.js --root . --direction "你的研究方向"

# Step 2: Fetch papers
node scripts/discover.js --root .

# Step 3: Dry-run preview
node scripts/dispatch.js --root . --dry-run

# Step 4: Analyze (concurrent)
node scripts/dispatch.js --root . --concurrency 5

# Step 5: Check progress
node scripts/status.js --root .

# Step 6: Generate report
node scripts/merge.js --root .

# Done! Open the report:
open daily-reports/$(date +%Y-%m-%d).md
```

## Configuration (`.agent.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `ARXIV_CATEGORY` | `cs.AI` | arXiv category (cs.CL, cs.LG, cs.MA, stat.ML...) |
| `MAX_PAPERS` | `20` | Papers to fetch per run |
| `RESEARCH_DIRECTION` | `LLM Agent` | Your research area for relevance scoring |
| `MODEL` | `pi-default` | Model for subagent analysis |
| `ARXIV_SPECIFIC_IDS` | *(empty)* | Comma-separated IDs to analyze specific papers (bypasses search) |
| `ARXIV_DATE_RANGE` | *(empty)* | Date filter: `2025-01-10:2025-01-15` |

## Daily Workflow

```bash
# Each morning, three commands:
node scripts/discover.js --root . && \
node scripts/dispatch.js --root . --concurrency 10 && \
node scripts/merge.js --root .
```

## Common Customizations

### Change research field
Edit `.agent.env`: `RESEARCH_DIRECTION=Reinforcement Learning`

### Track multiple categories
Run with different `--category` values, output to different report directories.

### Deep-dive on specific papers
Set `ARXIV_SPECIFIC_IDS` in `.agent.env`, then re-run discover + dispatch + merge.

### Increase/decrease depth
Edit `build-prompt.js` to adjust summary length, add/remove sections, or change language.

## Completion Criteria

```bash
node scripts/status.js --root .
# Exit code 0 = all complete, non-0 = pending/failed remain
```

## References

| File | Content |
|------|---------|
| `references/phase0_setup.md` | Environment setup instructions |
| `references/phase1_analyze.md` | Paper discovery & manifest review |
| `references/phase2_dispatch.md` | Concurrent execution & monitoring |
| `references/phase3_finalize.md` | Report generation & quality check |