# Phase 0: Environment Setup

Phase goal: Configure targets, lookback window, and analysis focus; write `.agent.env`.

## 0.1 — Choose Targets

Map the user's request to a target list (secid:名称, comma-separated):

- 用户提到具体标的（如"上证指数"）→ 只放该标的
- 用户要对比多个标的 → 全部放入
- 未指定 → 默认三大指数

Common secids: `1.000001` 上证指数 | `0.399001` 深证成指 | `0.399006` 创业板指 | 沪市个股 `1.600519`（贵州茅台）| 深市个股 `0.000001`（平安银行）

## 0.2 — Run setup-env.js

```bash
MODEL=<your-model> node scripts/setup-env.js --root . \
  --targets "1.000001:上证指数" \
  --days 31 \
  --focus "趋势与关键位"
```

- `--days`: 回看自然日数。"过去一个月" → 31；"过去一季度" → 92
- `--focus`: 研究重点，会注入每个子 Agent 的 prompt（如"中线布局视角"、"风险管理视角"）

## 0.3 — Verify .agent.env

Check the written values (MODEL / TARGETS / LOOKBACK_DAYS / ANALYSIS_FOCUS) match user intent. Fix by editing `.agent.env` directly if needed.

## Completion Criteria

- [ ] `.agent.env` exists with correct targets, days, model
- [ ] `reports/` output directory created

→ Proceed to Phase 1.
