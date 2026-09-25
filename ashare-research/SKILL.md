---
name: ashare-research
description: >
  A 股市场研究日报。抓取指数/板块/个股的区间行情数据（东财免费接口），程序化计算区间统计，
  并发调度子 Agent 逐标的做技术面分析（趋势阶段、关键支撑压力位、量价关系、形态、风险、展望），
  最终合并为按表现排序的结构化中文研究报告。适合每日复盘、标的对比、批量技术分析。
  Trigger: "A股复盘"、"股市日报"、"上证分析"、"A股研究"、"行情复盘"、"指数对比"、"market review"
---

# AShare Research — A 股研究日报

抓取 A 股标的过去 N 天行情 → 程序化统计 → 并发逐标的分析 → 合并研究报告。

## Four Phases

| Phase | Responsibility | Executor | Output |
|-------|---------------|----------|--------|
| 0: Environment Setup | 配置标的列表、回看天数、研究重点，写入 `.agent.env` | Main Agent + setup-env.js | `.agent.env` |
| 1: Data & Planning | 调用东财行情 API 抓取 K 线，计算区间统计，生成任务清单 | Main Agent + discover.js | `manifest.json` + `inputs/` |
| 2: Batch Execution | 并发调度子 Agent 逐标的技术分析 | dispatch.js + subagents | `segments/*.json` |
| 3: Finalization | 合并为研究报告，按区间表现排序 | Main Agent + merge.js | `reports/YYYY-MM-DD.md` |

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

1. **File As Progress** — 所有状态写磁盘。dispatch 每处理完一个标的立即更新 manifest，不等到批次结束
2. **Context Reset** — 每个子 Agent 拿到的是自包含 prompt（完整 K 线表 + 预计算统计 + 任务要求），不依赖其他标的的上下文
3. **Task Contract** — 成功标准：输出文件存在 + JSON 可解析 + 包含必要字段。不解析子 Agent 的文本输出
4. **Idempotent & Incremental** — 重复运行 discover 不覆盖已完成标的；dispatch 只处理 pending/failed
5. **Programmatic over Agent** — 行情抓取、统计计算（涨跌幅/高低点/回撤/量能对比）、状态管理、结果合并全是脚本完成。Agent 只做需要理解力的工作：读数据、写分析
6. **Failure Isolation** — 单个标的数据抓取或分析失败不影响其他；retry-failed 机制单独重试；merge 自动跳过损坏文件

## Installation & First Run

```bash
# Step 1: Setup (targets format: secid:名称, comma-separated)
node scripts/setup-env.js --root . \
  --targets "1.000001:上证指数,0.399001:深证成指,0.399006:创业板指" \
  --days 31 --focus "趋势与关键位"

# Step 2: Fetch market data + compute stats
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
open reports/$(date +%Y-%m-%d).md
```

## Configuration (`.agent.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGETS` | 三大指数 | 标的列表，格式 `secid:名称` 逗号分隔 |
| `LOOKBACK_DAYS` | `30` | 回看自然日数（转化为交易日约 20-23 天） |
| `ANALYSIS_FOCUS` | `趋势与关键位` | 研究重点，注入每个子 Agent 的 prompt |
| `MODEL` | `pi-default` | 子 Agent 分析用的模型 |
| `API_BASE` | 东财 K 线接口 | 行情数据源 |

常用 secid：`1.000001` 上证指数 | `0.399001` 深证成指 | `0.399006` 创业板指 | 沪市个股 `1.600519`（贵州茅台）| 深市个股 `0.000001`（平安银行）

## Daily Workflow

```bash
# 每天收盘后，三条命令：
node scripts/discover.js --root . && \
node scripts/dispatch.js --root . --concurrency 5 && \
node scripts/merge.js --root .
```

## Common Customizations

### 换标的
编辑 `.agent.env` 的 `TARGETS`，重跑 discover（已完成的旧标的会被保留进报告，不重复分析）。

### 深度复盘单标的
`TARGETS=1.000001:上证指数` + `LOOKBACK_DAYS=90`。

### 调整分析深度
编辑 `build-prompt.js` 增删分析维度（如加入北向资金、板块联动提示位）。

## Completion Criteria

```bash
node scripts/status.js --root .
# Exit code 0 = all complete, non-0 = pending/failed remain
```

## References

| File | Content |
|------|---------|
| `references/phase0_setup.md` | Environment setup instructions |
| `references/phase1_analyze.md` | Market data fetching & manifest review |
| `references/phase2_dispatch.md` | Concurrent execution & monitoring |
| `references/phase3_finalize.md` | Report generation & quality check |
