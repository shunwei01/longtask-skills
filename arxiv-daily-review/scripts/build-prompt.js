#!/usr/bin/env node
/**
 * build-prompt.js — Build self-contained subagent prompt for one paper
 *
 * Interface:
 *   function buildPrompt(root, inputPath, outputPath, researchDirection) → string
 *
 * Can also run standalone for testing:
 *   node scripts/build-prompt.js --root <dir> --chunk-id <id>
 */

const fs = require('fs');
const path = require('path');

/**
 * Build a complete, self-contained prompt for the subagent to analyze one paper.
 *
 * The prompt includes: paper metadata (title, authors, abstract), research direction
 * context, structured summary requirements, output format specification, and output path.
 *
 * @param {string} root - Project root directory
 * @param {string} inputPath - Path to paper input JSON
 * @param {string} outputPath - Where subagent should write output
 * @param {string} researchDirection - User's research direction for relevance scoring
 * @returns {string} Complete prompt text
 */
function buildPrompt(root, inputPath, outputPath, researchDirection) {
  const paper = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const wordCount = paper.summary ? paper.summary.length : 0;

  // Estimate token count: ~1 token per 3.5 characters for English text
  // This prompt is mostly Chinese + English mix, so use ~2.5 chars/token as rough estimate
  const estTokens = Math.ceil(paper.summary.length / 2.5) + 800; // 800 for fixed instruction text
  if (estTokens > 4000) {
    // Truncate abstract if excessively long
    paper.summary = paper.summary.slice(0, 6000) + '...[truncated]';
  }

  const prompt = `Please analyze the following academic paper and produce a structured Chinese summary.

## Paper Information
- **Title**: ${paper.title}
- **Authors**: ${paper.authors.join(', ')}
- **arXiv ID**: ${paper.arxiv_id}
- **Published**: ${paper.published}
- **Primary Category**: ${paper.primary_category}
- **URL**: ${paper.abs_url}

## Abstract
${paper.summary}

## Your Task
Read the abstract carefully and produce the following in Chinese:

### 1. 论文概述 (Structured Summary, ~200 words)
Break down into four labeled sections:
- **背景与动机**: What problem does this paper address? Why is it important?
- **方法与思路**: What approach / method / framework does the paper propose? Key technical novelty?
- **核心结果**: What are the main findings? Key numbers/metrics?
- **局限与展望**: What limitations does the paper acknowledge? What future work is suggested?

### 2. 创新点 (Innovation Points)
List 1-3 specific innovations. Each one sentence. Distinguish from "the paper mentions X" — focus on what is genuinely new or surprising.

### 3. 相关性评分 (Relevance to "${researchDirection}")
Score 1-5 (1 = irrelevant, 5 = highly relevant) with a one-sentence justification.

## Output Requirements
Write analysis to \`${outputPath}\` in valid JSON format:

\`\`\`json
{
  "chunk_id": "${paper.chunk_id}",
  "arxiv_id": "${paper.arxiv_id}",
  "title": "${paper.title.replace(/"/g, '\\"')}",
  "summary_zh": {
    "background": "背景与动机...",
    "method": "方法与思路...",
    "results": "核心结果...",
    "limitations": "局限与展望..."
  },
  "innovations": ["创新点1", "创新点2"],
  "relevance": {
    "score": 4,
    "reason": "直接研究 LLM Agent 的规划能力，与研究方向高度相关"
  },
  "keywords": ["关键词1", "关键词2", "关键词3"]
}
\`\`\`

## Important
- Complete this task directly in one session.
- Write only valid JSON to the output file — no extra text, no markdown fences.
- If the abstract is genuinely too sparse to extract certain sections, write "摘要未提及" for that field.
- Keep summaries concise and substantive — avoid filler phrases like "本文是一篇关于...的论文".`;

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
  let direction = 'LLM Agent';
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const m = content.match(/RESEARCH_DIRECTION=(.+)/);
    if (m) direction = m[1].trim();
  }

  const inputPath = path.join(args.root, '.task-data', 'inputs', `${args.chunkId}-input.json`);
  const outputPath = path.join(args.root, '.task-data', 'segments', `${args.chunkId}-output.json`);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const prompt = buildPrompt(args.root, inputPath, outputPath, direction);
  console.log(prompt);
}

module.exports = { buildPrompt };