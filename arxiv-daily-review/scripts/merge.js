#!/usr/bin/env node
/**
 * merge.js — Merge individual paper analyses into a single daily report
 *
 * Usage: node scripts/merge.js --root <dir> [--output <path>]
 *
 * Reads all segments/*-output.json, sorts by relevance score desc,
 * generates a formatted markdown report.
 */

const fs = require('fs');
const path = require('path');

function main() {
  let root = process.cwd();
  let outputPath = null;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--root' && process.argv[i + 1]) { root = path.resolve(process.argv[i + 1]); i++; }
    else if (process.argv[i] === '--output' && process.argv[i + 1]) { outputPath = process.argv[i + 1]; i++; }
  }

  // Load env for output directory
  let outputDir = path.join(root, 'daily-reports');
  const envPath = path.join(root, '.agent.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const m = content.match(/OUTPUT_DIR=(.+)/);
    if (m) outputDir = m[1].trim();
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
      if (data && data.title) {
        analyses.push(data);
      }
    } catch (err) {
      console.warn(`[merge] Skipping corrupt file: ${file}`);
    }
  }

  // Sort by relevance score descending, then by date
  analyses.sort((a, b) => {
    const scoreDiff = (b.relevance?.score || 0) - (a.relevance?.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.published || '').localeCompare(a.published || '');
  });

  // ── Completion check (declarative, no LLM): flag incomplete targets in the report ──
  const manifestPath = path.join(root, '.task-data', 'manifest.json');
  const incomplete = [];
  if (fs.existsSync(manifestPath)) {
    try {
      for (const e of JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))) {
        if (e.status !== 'done' && e.status !== 'skipped') {
          incomplete.push(`${e.arxiv_id || e.id}（${e.status}${e.error ? ': ' + e.error : ''}）`);
        }
      }
    } catch {}
  }
  if (incomplete.length > 0) {
    console.warn(`[merge] WARNING — ${incomplete.length} target(s) not done; report is partial:`);
    for (const s of incomplete) console.warn(`  ✗ ${s}`);
    console.warn('[merge] Run dispatch.js --retry-failed to complete them, then re-run merge.');
  }

  // Determine date for filename
  const today = new Date().toISOString().slice(0, 10);
  const reportPath = outputPath || path.join(outputDir, `${today}.md`);

  // ── Generate markdown ──
  const lines = [];

  lines.push(`# 📄 arXiv 论文日读 — ${today}`);
  lines.push('');
  if (incomplete.length > 0) {
    lines.push(`> ⚠️ **部分完成**：本报告缺少 ${incomplete.length} 个未完成标的（${incomplete.join('、')}）——先运行 dispatch --retry-failed 再重新 merge 可补全。`);
    lines.push('');
  }
  lines.push(`> **分类**: ${process.env.ARXIV_CATEGORY || 'cs.AI'}  `);
  lines.push(`> **研究方向**: ${process.env.RESEARCH_DIRECTION || 'LLM Agent'}  `);
  lines.push(`> **论文数**: ${analyses.length} 篇  `);
  lines.push(`> **生成时间**: ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  // TOC
  lines.push('## 📋 目录');
  lines.push('');
  lines.push('| # | 评分 | 论文 | 核心主题 |');
  lines.push('|---|------|------|----------|');
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    const score = a.relevance?.score || '?';
    const scoreEmoji = score >= 4 ? '⭐' : score >= 3 ? '🔶' : score >= 2 ? '🔹' : '⬜';
    const shortTitle = a.title.length > 60 ? a.title.slice(0, 57) + '...' : a.title;
    const method = (a.summary_zh?.method || '').slice(0, 25);
    lines.push(`| ${i + 1} | ${scoreEmoji} ${score} | [${shortTitle}](#paper-${i + 1}) | ${method} |`);
  }
  lines.push('');

  // Detailed cards
  lines.push('## 📝 论文详情');
  lines.push('');

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    const score = a.relevance?.score || '?';
    const scoreBar = '█'.repeat(Math.max(1, score)) + '░'.repeat(5 - Math.max(1, score));

    lines.push(`---`);
    lines.push('');
    lines.push(`### <a id="paper-${i + 1}"></a>${i + 1}. ${a.title}`);
    lines.push('');
    lines.push(`- **arXiv**: [${a.arxiv_id}](${a.abs_url || `https://arxiv.org/abs/${a.arxiv_id}`})  `);
    lines.push(`- **相关度**: ${scoreBar} ${score}/5 — ${a.relevance?.reason || '未评估'}`);
    lines.push('');

    const s = a.summary_zh || {};
    lines.push('#### 背景与动机');
    lines.push('');
    lines.push(s.background || '（未分析）');
    lines.push('');
    lines.push('#### 方法与思路');
    lines.push('');
    lines.push(s.method || '（未分析）');
    lines.push('');
    lines.push('#### 核心结果');
    lines.push('');
    lines.push(s.results || '（未分析）');
    lines.push('');
    lines.push('#### 局限与展望');
    lines.push('');
    lines.push(s.limitations || '（未分析）');
    lines.push('');

    if (a.innovations && a.innovations.length > 0) {
      lines.push('#### 💡 创新点');
      lines.push('');
      for (const innov of a.innovations) {
        lines.push(`- ${innov}`);
      }
      lines.push('');
    }

    if (a.keywords && a.keywords.length > 0) {
      lines.push(`**关键词**: ${a.keywords.join(' · ')}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`*报告由 arxiv-daily-review skill 自动生成 · ${new Date().toISOString()}*`);
  lines.push('');

  // Write report
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  console.log(`[merge] Report generated: ${reportPath}`);
  console.log(`[merge] ${analyses.length} papers merged, sorted by relevance score.`);

  // Print top-5 quick view
  console.log('\n[merge] Top 5 by relevance:');
  for (let i = 0; i < Math.min(5, analyses.length); i++) {
    const a = analyses[i];
    console.log(`  ${a.relevance?.score || '?'}/5 — ${a.title.slice(0, 70)}`);
  }
}

main();