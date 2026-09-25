#!/usr/bin/env node
/**
 * discover.js — Scan arXiv for latest papers, generate task manifest
 *
 * Usage: node scripts/discover.js --root <dir> [--category <cat>] [--max-papers <N>]
 *
 * Idempotent: re-running preserves DONE entries, only processes new papers.
 *
 * Output files:
 *   .task-data/manifest.json  — paper list with status
 *   .task-data/inputs/{id}-input.json — full paper metadata for each chunk
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

// ── .env loading ──
function loadEnv(root) {
  const envPath = path.join(root, '.agent.env');
  if (!fs.existsSync(envPath)) {
    console.error('[discover] .agent.env not found. Run setup-env.js first (Phase 0).');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) env[key] = val; // CLI args override .env
  }
  return env;
}

// ── Argument parsing ──
function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) { args.root = path.resolve(argv[i + 1]); i++; }
    else if (argv[i] === '--category' && argv[i + 1]) { args.category = argv[i + 1]; i++; }
    else if (argv[i] === '--max-papers' && argv[i + 1]) { args.maxPapers = parseInt(argv[i + 1], 10); i++; }
  }
  return args;
}

// ── arXiv API client ──
function fetchArxiv(url) {
  return new Promise((resolve, reject) => {
    console.log(`[discover] Fetching: ${url}`);

    const client = url.startsWith('https:') ? https : http;
    client.get(url, { timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`arXiv API returned ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    }).on('error', reject).on('timeout', () => reject(new Error('arXiv API timeout')));
  });
}

// ── Parse Atom XML (lightweight, zero-dependency) ──
function parseArxivXml(xml) {
  const papers = [];
  // Split by <entry> tags
  const entries = xml.split(/<entry>/g).slice(1); // first chunk before <entry> is header

  for (const entry of entries) {
    const endIdx = entry.indexOf('</entry>');
    const content = endIdx !== -1 ? entry.slice(0, endIdx) : entry;

    // Extract arxiv ID from <id> tag
    const idMatch = content.match(/<id>[^<]*?(\d{4}\.\d{4,}v?\d*)<\/id>/);
    const arxivId = idMatch ? idMatch[1] : null;
    if (!arxivId) continue;

    // Extract title
    const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

    // Extract summary (abstract)
    const summaryMatch = content.match(/<summary>([\s\S]*?)<\/summary>/);
    const summary = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : '';

    // Extract authors
    const authors = [];
    const authorRe = /<name>([^<]+)<\/name>/g;
    let m;
    while ((m = authorRe.exec(content)) !== null) {
      authors.push(m[1].trim());
    }

    // Extract published date
    const pubMatch = content.match(/<published>([^<]+)<\/published>/);
    const pubDate = pubMatch ? pubMatch[1] : '';

    // Extract primary category
    const catMatch = content.match(/<arxiv:primary[^>]*term="([^"]+)"/);
    const primaryCat = catMatch ? catMatch[1] : '';

    // Extract PDF link
    const pdfMatch = content.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);
    const pdfUrl = pdfMatch ? pdfMatch[1] : `https://arxiv.org/pdf/${arxivId}`;

    // Extract arXiv URL
    const absUrl = `https://arxiv.org/abs/${arxivId}`;

    papers.push({
      arxiv_id: arxivId,
      title,
      authors,
      summary,
      published: pubDate,
      primary_category: primaryCat,
      pdf_url: pdfUrl,
      abs_url: absUrl,
    });
  }

  return papers;
}

// ── Chunk ID generator ──
function toChunkId(arxivId) {
  return 'paper_' + arxivId.replace(/\./g, '_');
}

// ── Main ──
async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnv(args.root);

  const category = args.category || env.ARXIV_CATEGORY || 'cs.AI';
  const maxPapers = args.maxPapers || parseInt(env.MAX_PAPERS || '20', 10);
  const apiBase = env.ARXIV_API_BASE || 'https://export.arxiv.org/api/query';

  // Ensure .task-data directories exist
  const taskDir = path.join(args.root, '.task-data');
  const inputsDir = path.join(taskDir, 'inputs');
  const segmentsDir = path.join(taskDir, 'segments');
  fs.mkdirSync(inputsDir, { recursive: true });
  fs.mkdirSync(segmentsDir, { recursive: true });

  // ── Fetch papers from arXiv ──
  const specificIds = (env.ARXIV_SPECIFIC_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const queryUrl = specificIds.length > 0
    ? `${apiBase}?id_list=${specificIds.map(encodeURIComponent).join(',')}&max_results=${specificIds.length}`
    : `${apiBase}?search_query=cat:${encodeURIComponent(category)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxPapers}`;

  if (specificIds.length > 0) {
    console.log(`[discover] Fetching ${specificIds.length} specific papers by ID: ${specificIds.join(', ')}`);
  } else {
    console.log(`[discover] Fetching latest ${maxPapers} papers from arXiv ${category}...`);
  }
  let papers;
  try {
    const xml = await fetchArxiv(queryUrl);
    papers = parseArxivXml(xml);
    console.log(`[discover] Got ${papers.length} papers from arXiv.`);
  } catch (err) {
    console.error(`[discover] Failed to fetch arXiv: ${err.message}`);
    process.exit(2);
  }

  if (papers.length === 0) {
    console.error('[discover] No papers found. Check category name and network.');
    process.exit(2);
  }

  // ── Load existing manifest (idempotent) ──
  const manifestPath = path.join(taskDir, 'manifest.json');
  let existingManifest = [];
  const existingIds = new Set();
  if (fs.existsSync(manifestPath)) {
    existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    for (const entry of existingManifest) {
      existingIds.add(entry.id);
    }
  }

  // ── Build new manifest ──
  const newEntries = [];
  for (const paper of papers) {
    const chunkId = toChunkId(paper.arxiv_id);

    // Skip already-DONE entries (idempotent)
    if (existingIds.has(chunkId)) {
      const existing = existingManifest.find(e => e.id === chunkId);
      if (existing && (existing.status === 'done' || existing.status === 'skipped')) {
        newEntries.push(existing); // preserve
        console.log(`[discover]   Skip (${existing.status}): ${paper.arxiv_id} — ${paper.title.slice(0, 60)}`);
        continue;
      }
      // If previously FAILED or IN_PROGRESS, reset to TODO
      if (existing && existing.status === 'in_progress') {
        console.log(`[discover]   Reset (was in_progress): ${paper.arxiv_id}`);
      }
    }

    // Write input file for this paper
    const inputPath = path.join(inputsDir, `${chunkId}-input.json`);
    fs.writeFileSync(inputPath, JSON.stringify({
      chunk_id: chunkId,
      ...paper,
      fetched_at: new Date().toISOString(),
    }, null, 2), 'utf-8');

    newEntries.push({
      id: chunkId,
      arxiv_id: paper.arxiv_id,
      title: paper.title,
      authors: paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : ''),
      published: paper.published,
      primary_category: paper.primary_category,
      status: 'pending',
    });

    console.log(`[discover]   New: ${paper.arxiv_id} — ${paper.title.slice(0, 80)}`);
  }

  // Write manifest
  fs.writeFileSync(manifestPath, JSON.stringify(newEntries, null, 2), 'utf-8');
  const doneCount = newEntries.filter(e => e.status === 'done').length;
  const pendingCount = newEntries.filter(e => e.status === 'pending').length;

  console.log(`\n[discover] Manifest written: ${newEntries.length} total, ${pendingCount} pending, ${doneCount} done.`);
  console.log('[discover] Ready for Phase 2 (dispatch).');
}

main().catch(err => {
  console.error('[discover] Fatal:', err.message);
  process.exit(1);
});