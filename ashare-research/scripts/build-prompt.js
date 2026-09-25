#!/usr/bin/env node
/**
 * build-prompt.js — Build self-contained subagent prompt for one target
 *
 * Interface:
 *   function buildPrompt(root, inputPath, outputPath, analysisFocus) → string
 *
 * Can also run standalone for testing:
 *   node scripts/build-prompt.js --root <dir> --chunk-id <id>
 */

const fs = require('fs');
const path = require('path');

function fmtPct(x) { return (x > 0 ? '+' : '') + x + '%'; }

function buildPrompt(root, inputPath, outputPath, analysisFocus) {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const t = input.target;
  const p = input.period;
  const s = input.stats;
  const focus = analysisFocus || '趋势与关键位';

  const tableRows = input.klines.map(k =>
    `| ${k.date} | ${k.open} | ${k.high} | ${k.low} | ${k.close} | ${fmtPct(k.pct_chg)} | ${(k.amount / 1e8).toFixed(0)} |`
  ).join('\n');

  const prompt = `请分析以下 A 股标的在指定区间的行情数据，产出结构化中文研究报告。

## 标的信息
- **名称**: ${t.name}
- **代码 (secid)**: ${t.secid}
- **区间**: ${p.beg} ~ ${p.end}（${p.trading_days} 个交易日）
- **研究重点**: ${focus}

## 日线行情数据
| 日期 | 开盘 | 最高 | 最低 | 收盘 | 涨跌幅 | 成交额(亿元) |
|------|------|------|------|------|--------|--------------|
${tableRows}

## 预计算统计（可直接引用，请勿重算出不同数值）
- 区间涨跌幅（首日开盘 → 末日收盘）: ${fmtPct(s.period_change_pct)}
- 区间最高: ${s.period_high.price}（${s.period_high.date}）；区间最低: ${s.period_low.price}（${s.period_low.date}）
- 上涨/下跌/平盘天数: ${s.up_days}/${s.down_days}/${s.flat_days}
- 日均成交额: ${s.avg_amount_yi} 亿元；下半区间相对上半区间量能变化: ${fmtPct(s.volume_shift_pct)}
- 最大回撤（按收盘价）: ${s.max_drawdown_pct}%
- 日涨跌幅标准差: ${s.daily_volatility_pct}%${s.recent_5d_change_pct !== null ? `\n- 近 5 个交易日涨跌: ${fmtPct(s.recent_5d_change_pct)}` : ''}

## 你的任务
基于以上数据（且仅基于以上数据），用中文完成以下分析：

### 1. 趋势判断
区间整体处于什么阶段（单边上行 / 冲高回落 / 震荡 / 单边下行等）？分阶段描述节奏（起止日期 + 点位）。

### 2. 关键支撑与压力位
给出 2-3 个支撑位和 2-3 个压力位，必须是具体数值，并注明依据（区间低点/高点、成交密集区、前高前低、整数关口等）。

### 3. 量能评估
区间量能是放量、缩量还是平稳？量价如何配合（涨时量能、跌时量能）？

### 4. 形态与节奏
识别值得注意的 K 线形态或节奏特征（长上影/下影、连续阴跌、V 型反弹、跳空等，须注明日期）。

### 5. 风险提示
当前走势下最需要警惕的 1-2 个风险。

### 6. 后市展望
基于纯技术数据给出倾向性观点。注明"不构成投资建议"。

## 输出要求
将分析写入 \`${outputPath}\`，格式为合法 JSON（无 markdown 围栏、无多余文本、字符串内不要使用未转义的英文双引号——引用数据时用中文引号「」）：

\`\`\`json
{
  "chunk_id": "${input.chunk_id}",
  "target": { "secid": "${t.secid}", "name": "${t.name}" },
  "period": { "beg": "${p.beg}", "end": "${p.end}", "trading_days": ${p.trading_days} },
  "period_change_pct": ${s.period_change_pct},
  "trend": { "phase": "冲高回落震荡", "summary": "..." },
  "key_levels": {
    "support": [ { "price": 3850.86, "basis": "区间最低价" } ],
    "resistance": [ { "price": 3995.18, "basis": "区间最高价" } ]
  },
  "volume": { "assessment": "缩量", "detail": "..." },
  "patterns": ["9/11-9/15 连续阴跌，累计跌幅约 2.3%"],
  "risk": "...",
  "outlook": "...",
  "summary_zh": "（150 字以内小结）"
}
\`\`\`

## 重要
- 只使用给定数据，禁止编造数据或引用外部信息
- 支撑/压力必须给出具体数值
- 中文输出，一次性完成，直接写文件`;

  return prompt;
}

// ── Standalone execution (for testing) ──
if (require.main === module) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--root' && process.argv[i + 1]) { args.root = path.resolve(process.argv[i + 1]); i++; }
    else if (process.argv[i] === '--chunk-id' && process.argv[i + 1]) { args.chunkId = process.argv[i + 1]; i++; }
  }

  if (!args.root || !args.chunkId) {
    console.error('Usage: node build-prompt.js --root <dir> --chunk-id <id>');
    process.exit(1);
  }

  const envPath = path.join(args.root, '.agent.env');
  let focus = '趋势与关键位';
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf-8').match(/ANALYSIS_FOCUS=(.+)/);
    if (m) focus = m[1].trim();
  }

  const inputPath = path.join(args.root, '.task-data', 'inputs', `${args.chunkId}-input.json`);
  const outputPath = path.join(args.root, '.task-data', 'segments', `${args.chunkId}-output.json`);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(buildPrompt(args.root, inputPath, outputPath, focus));
}

module.exports = { buildPrompt };
