#!/usr/bin/env node
/**
 * merge.js — Merge individual target analyses into a single research report
 *
 * Usage: node scripts/merge.js --root <dir> [--output <path>]
 *
 * Reads all segments/*-output.json, sorts by period_change_pct descending,
 * generates a formatted markdown report with programmatic comparison ranking.
 */

const fs = require('fs');
const path = require('path');

function fmtPct(x) {
  if (x === null || x === undefined || isNaN(x)) return '?';
  return (x > 0 ? '+' : '') + x + '%';
}

function main() {
  let root = process.cwd();
  let outputPath = null;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--root' && process.argv[i + 1]) { root = path.resolve(process.argv[i + 1]); i++; }
    else if (process.argv[i] === '--output' && process.argv[i + 1]) { outputPath = process.argv[i + 1]; i++; }
  }

  // Load env for output directory and report header fields
  let outputDir = path.join(root, 'reports');
  let focus = '趋势与关键位';
  let targets = '';
  const envPath = path.join(root, '.agent.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const m = content.match(/OUTPUT_DIR=(.+)/);
    if (m) outputDir = m[1].trim();
    const f = content.match(/ANALYSIS_FOCUS=(.+)/);
    if (f) focus = f[1].trim();
    const t = content.match(/TARGETS=(.+)/);
    if (t) targets = t[1].trim();
  } else {
    if (process.env.ANALYSIS_FOCUS) focus = process.env.ANALYSIS_FOCUS;
    if (process.env.TARGETS) targets = process.env.TARGETS;
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // Read all segment outputs
  const segmentsDir = path.join(root, '.task-data', 'segments');
  if (!fs.existsSync(segmentsDir)) {
    console.error('[merge] No segments directory found. Run dispatch first.');
    process.exit(1);
  }

  const files = fs.readdirSync(segmentsDir).filter(f => f.endsWith('-output.json'));
  if (files.length === 0) {
    console.error('[merge] No output files found.');
    process.exit(1);
  }

  const analyses = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(segmentsDir, file), 'utf-8'));
      if (data && data.target && data.target.name) {
        analyses.push(data);
      }
    } catch (err) {
      console.warn(`[merge] Skipping corrupt file: ${file}`);
    }
  }

  // Sort by period change descending (strongest first)
  analyses.sort((a, b) => (b.period_change_pct ?? -Infinity) - (a.period_change_pct ?? -Infinity));

  // ── Completion check (declarative, no LLM): flag incomplete targets in the report ──
  const manifestPath = path.join(root, '.task-data', 'manifest.json');
  const incomplete = [];
  if (fs.existsSync(manifestPath)) {
    try {
      for (const e of JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))) {
        if (e.status !== 'done' && e.status !== 'skipped') {
          incomplete.push(`${e.name || e.id}（${e.status}${e.error ? ': ' + e.error : ''}）`);
        }
      }
    } catch {}
  }
  if (incomplete.length > 0) {
    console.warn(`[merge] WARNING — ${incomplete.length} target(s) not done; report is partial:`);
    for (const s of incomplete) console.warn(`  ✗ ${s}`);
    console.warn('[merge] Run dispatch.js --retry-failed to complete them, then re-run merge.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = outputPath || path.join(outputDir, `${today}.md`);
  const period = analyses[0]?.period || {};

  // ── Generate markdown ──
  const lines = [];

  lines.push(`# 📈 A 股研究日报 — ${today}`);
  lines.push('');
  if (incomplete.length > 0) {
    lines.push(`> ⚠️ **部分完成**：本报告缺少 ${incomplete.length} 个未完成标的（${incomplete.join('、')}）——先运行 dispatch --retry-failed 再重新 merge 可补全。`);
    lines.push('');
  }
  lines.push(`> **区间**: ${period.beg || '?'} ~ ${period.end || '?'}  `);
  lines.push(`> **标的数**: ${analyses.length} 个  `);
  lines.push(`> **研究重点**: ${focus}  `);
  lines.push(`> **生成时间**: ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('*本报告由技术数据自动分析生成，不构成投资建议。*');
  lines.push('');

  // Programmatic comparison ranking
  if (analyses.length > 1) {
    const ranking = analyses.map(a => `${a.target.name}（${fmtPct(a.period_change_pct)}）`).join(' > ');
    lines.push(`## 🏆 区间表现排序`);
    lines.push('');
    lines.push(`> ${ranking}`);
    lines.push('');
  }

  // TOC
  lines.push('## 📋 总览');
  lines.push('');
  lines.push('| # | 标的 | 区间涨跌幅 | 趋势阶段 | 关键支撑 | 关键压力 |');
  lines.push('|---|------|-----------|---------|---------|---------|');
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    const shortName = a.target.name.length > 12 ? a.target.name.slice(0, 11) + '…' : a.target.name;
    const phase = (a.trend?.phase || '?').slice(0, 12);
    const sup = a.key_levels?.support?.[0]?.price ?? '?';
    const res = a.key_levels?.resistance?.[0]?.price ?? '?';
    lines.push(`| ${i + 1} | [${shortName}](#target-${i + 1}) | ${fmtPct(a.period_change_pct)} | ${phase} | ${sup} | ${res} |`);
  }
  lines.push('');

  // Detailed sections
  lines.push('## 📝 标的详情');
  lines.push('');

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    lines.push(`---`);
    lines.push('');
    lines.push(`### <a id="target-${i + 1}"></a>${i + 1}. ${a.target.name}（${a.target.secid}）`);
    lines.push('');
    lines.push(`- **区间**: ${a.period?.beg} ~ ${a.period?.end}（${a.period?.trading_days} 个交易日）  `);
    lines.push(`- **区间涨跌幅**: ${fmtPct(a.period_change_pct)}（${a.period?.beg} 开盘 → ${a.period?.end} 收盘）`);
    lines.push('');

    lines.push(`#### 趋势判断：${a.trend?.phase || '未判断'}`);
    lines.push('');
    lines.push(a.trend?.summary || '（未分析）');
    lines.push('');

    lines.push('#### 关键位');
    lines.push('');
    if (a.key_levels?.support?.length) {
      lines.push(`- **支撑**: ${a.key_levels.support.map(l => `${l.price}（${l.basis || '?'}）`).join('、')}`);
    }
    if (a.key_levels?.resistance?.length) {
      lines.push(`- **压力**: ${a.key_levels.resistance.map(l => `${l.price}（${l.basis || '?'}）`).join('、')}`);
    }
    lines.push('');

    lines.push(`#### 量能：${a.volume?.assessment || '?'}`);
    lines.push('');
    lines.push(a.volume?.detail || '（未分析）');
    lines.push('');

    if (a.patterns && a.patterns.length > 0) {
      lines.push('#### 形态与节奏');
      lines.push('');
      for (const p of a.patterns) {
        lines.push(`- ${p}`);
      }
      lines.push('');
    }

    lines.push('#### 风险提示');
    lines.push('');
    lines.push(a.risk || '（未分析）');
    lines.push('');

    lines.push('#### 后市展望');
    lines.push('');
    lines.push(a.outlook || '（未分析）');
    lines.push('');

    if (a.summary_zh) {
      lines.push(`> **小结**: ${a.summary_zh}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`*报告由 ashare-research skill 自动生成 · ${new Date().toISOString()}*`);
  lines.push('');

  // Write report
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  console.log(`[merge] Report generated: ${reportPath}`);
  console.log(`[merge] ${analyses.length} targets merged, sorted by period change.`);

  // Print ranking quick view
  console.log('\n[merge] Ranking by period change:');
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    console.log(`  ${fmtPct(a.period_change_pct).padStart(7)} — ${a.target.name}（${a.trend?.phase || '?'}）`);
  }
}

main();
