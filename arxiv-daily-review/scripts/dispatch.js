#!/usr/bin/env node
/**
 * dispatch.js — Concurrent subagent dispatcher for paper analysis
 *
 * Usage:
 *   node scripts/dispatch.js --root <dir> [--concurrency <N>] [--dry-run] [--retry-failed]
 *
 * Architecture:
 *   1. Read manifest.json → filter pending (or failed with --retry-failed)
 *   2. For each paper: build prompt → launch subagent via pi -p → check output → update state
 *   3. Concurrency controlled by pool; state written to disk immediately after each change
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ── .env loading ──
function loadEnv(root) {
  const envPath = path.join(root, '.agent.env');
  if (!fs.existsSync(envPath)) {
    console.error('[dispatch] .agent.env not found. Run setup-env.js first.');
    process.exit(1);
  }
  const env = {};
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

// ── Argument parsing ──
function parseArgs(argv) {
  const args = { root: process.cwd(), concurrency: 5 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) { args.root = path.resolve(argv[i + 1]); i++; }
    else if (argv[i] === '--concurrency' && argv[i + 1]) { args.concurrency = parseInt(argv[i + 1], 10); i++; }
    else if (argv[i] === '--dry-run') { args.dryRun = true; }
    else if (argv[i] === '--retry-failed') { args.retryFailed = true; }
  }
  return args;
}

// ── Shell-safe quoting ──
function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Async exec ──
function execAsync(cmd, opts) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

// ── Concurrency pool ──
async function runPool(tasks, concurrency, handler) {
  const executing = new Set();
  let completed = 0;
  for (const task of tasks) {
    const p = handler(task).then(
      () => { executing.delete(p); completed++; },
      () => { executing.delete(p); completed++; }
    );
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

// ── Manifest read/write helpers ──
function readManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function writeManifest(manifestPath, manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

function updateStatus(manifestPath, chunkId, status, errorReason) {
  const manifest = readManifest(manifestPath);
  const entry = manifest.find(e => e.id === chunkId);
  if (entry) {
    entry.status = status;
    if (errorReason) entry.error = errorReason;
    writeManifest(manifestPath, manifest);
  }
}

// ── Append-only event log (post-mortem auditability) ──
function logEvent(root, type, detail) {
  const line = JSON.stringify({ ts: new Date().toISOString(), type, ...detail });
  try {
    fs.appendFileSync(path.join(root, '.task-data', 'events.jsonl'), line + '\n', 'utf-8');
  } catch {}
}

// ── Single-instance guard (concurrent dispatch processes race on manifest) ──
const MAX_RETRIES = 3;

function acquireDispatchLock(root) {
  const lockPath = path.join(root, '.task-data', 'dispatch.lock');
  if (fs.existsSync(lockPath)) {
    let alive = false;
    try {
      const { pid } = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    } catch { alive = false; } // unparseable lock file — stale
    if (alive) {
      console.error(`[dispatch] Another dispatch (pid in ${lockPath}) is running. Aborting.`);
      process.exit(3);
    }
    console.log('[dispatch] Removing stale dispatch lock.');
  }
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf-8');
  return lockPath;
}

function releaseDispatchLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch {}
}

// ── Main ──
async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnv(args.root);
  const { buildPrompt } = require('./build-prompt.js');

  const manifestPath = path.join(args.root, '.task-data', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('[dispatch] manifest.json not found. Run discover.js first (Phase 1).');
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const model = env.MODEL || 'pi-default';
  const direction = env.RESEARCH_DIRECTION || 'LLM Agent';
  const segmentsDir = path.join(args.root, '.task-data', 'segments');
  const inputsDir = path.join(args.root, '.task-data', 'inputs');

  const lockPath = acquireDispatchLock(args.root);
  logEvent(args.root, 'dispatch_start', { tasks: manifest.length, concurrency: args.concurrency, model, retryFailed: !!args.retryFailed });

  // Startup recovery: reconcile stale in_progress entries (interrupted runs).
  // Valid output → done; missing/invalid output → back to pending.
  for (const entry of manifest) {
    if (entry.status === 'in_progress') {
      const outputPath = path.join(segmentsDir, `${entry.id}-output.json`);
      let recovered = false;
      if (fs.existsSync(outputPath)) {
        try {
          const out = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
          if (out && out.title) recovered = true;
        } catch {}
      }
      entry.status = recovered ? 'done' : 'pending';
      console.log(`[dispatch] Recover in_progress→${entry.status}: ${entry.id}`);
      logEvent(args.root, 'recovered_stale', { chunk: entry.id, to: entry.status });
    }
  }

  // Retry budget: entries that already consumed MAX_RETRIES attempts become permanent_failed.
  for (const entry of manifest) {
    if ((entry.status === 'failed' || entry.status === 'error') && (entry.retry_count || 0) >= MAX_RETRIES) {
      entry.status = 'permanent_failed';
      console.log(`[dispatch] Retry budget exhausted: ${entry.id} → permanent_failed`);
      logEvent(args.root, 'retry_budget_exhausted', { chunk: entry.id });
    }
  }
  writeManifest(manifestPath, manifest);

  // Filter tasks
  let tasks;
  if (args.retryFailed) {
    tasks = manifest.filter(e => e.status === 'pending' || e.status === 'failed' || e.status === 'error');
  } else {
    tasks = manifest.filter(e => e.status === 'pending');
  }

  console.log(`[dispatch] ${tasks.length} tasks to process, concurrency=${args.concurrency}, model=${model}`);
  if (args.dryRun) {
    console.log('[dispatch] DRY RUN — previewing prompts only. No subagents launched.');
    for (const task of tasks) {
      const inputPath = path.join(inputsDir, `${task.id}-input.json`);
      const outputPath = path.join(segmentsDir, `${task.id}-output.json`);
      const prompt = buildPrompt(args.root, inputPath, outputPath, direction);
      console.log(`\n─── ${task.id} ───`);
      console.log(`Prompt length: ${prompt.length} chars (~${Math.ceil(prompt.length / 2.5)} tokens est.)`);
    }
    return;
  }

  // ── Process each chunk ──
  function bumpRetry(chunkId) {
    const m = readManifest(manifestPath);
    const entry = m.find(e => e.id === chunkId);
    if (entry) {
      entry.retry_count = (entry.retry_count || 0) + 1;
      writeManifest(manifestPath, m);
      return entry.retry_count;
    }
    return 0;
  }

  async function runChunk(chunk) {
    const { id: chunkId } = chunk;
    updateStatus(manifestPath, chunkId, 'in_progress');
    bumpRetry(chunkId);
    logEvent(args.root, 'chunk_start', { chunk: chunkId });
    console.log(`[dispatch] ▶ ${chunkId}`);

    const inputPath = path.join(inputsDir, `${chunkId}-input.json`);
    const outputPath = path.join(segmentsDir, `${chunkId}-output.json`);

    if (!fs.existsSync(inputPath)) {
      console.error(`[dispatch] ✗ ${chunkId}: input file missing`);
      updateStatus(manifestPath, chunkId, 'failed', 'Input file missing');
      return;
    }

    // Build prompt
    const prompt = buildPrompt(args.root, inputPath, outputPath, direction);

    // Write prompt to temp file to avoid shell escaping issues
    const tmpFile = path.join(args.root, `.tmp-query-${chunkId}-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt, 'utf-8');

    try {
      const cmd = [
        `cd ${shellQuote(args.root)} &&`,
        `QUERY_CONTENT=$(cat ${shellQuote(tmpFile)});`,
        `pi -p "$QUERY_CONTENT"`,
        `--model ${shellQuote(model)}`,
        `--tools write`,
        `--mode json`,
        `--no-session`,
        `< /dev/null`,
      ].join(' ');

      await execAsync(cmd, {
        timeout: 10 * 60 * 1000,       // 10 min per paper
        maxBuffer: 10 * 1024 * 1024,    // 10 MB
      });

      // Check output
      if (fs.existsSync(outputPath)) {
        try {
          const out = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
          if (out && out.title) {
            updateStatus(manifestPath, chunkId, 'done');
            logEvent(args.root, 'chunk_done', { chunk: chunkId, relevance: out.relevance?.score });
            console.log(`[dispatch] ✓ ${chunkId}: done (relevance=${out.relevance?.score || '?'}/5)`);
          } else {
            updateStatus(manifestPath, chunkId, 'failed', 'Output missing required fields');
            logEvent(args.root, 'chunk_failed', { chunk: chunkId, reason: 'Output missing required fields' });
            console.log(`[dispatch] ✗ ${chunkId}: output missing fields`);
          }
        } catch {
          updateStatus(manifestPath, chunkId, 'failed', 'Output not valid JSON');
          logEvent(args.root, 'chunk_failed', { chunk: chunkId, reason: 'Output not valid JSON' });
          console.log(`[dispatch] ✗ ${chunkId}: output not valid JSON`);
        }
      } else {
        updateStatus(manifestPath, chunkId, 'failed', 'No output file produced');
        logEvent(args.root, 'chunk_failed', { chunk: chunkId, reason: 'No output file produced' });
        console.log(`[dispatch] ✗ ${chunkId}: no output file`);
      }
    } catch (err) {
      console.error(`[dispatch] ✗ ${chunkId}: ${err.message?.slice(0, 120)}`);
      // Check again if output was written despite process error
      if (!fs.existsSync(outputPath)) {
        updateStatus(manifestPath, chunkId, 'failed', err.message?.slice(0, 200));
      } else {
        try {
          JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
          updateStatus(manifestPath, chunkId, 'done');
          console.log(`[dispatch] ✓ ${chunkId}: output found despite error`);
        } catch {
          updateStatus(manifestPath, chunkId, 'failed', 'Output corrupted');
        }
      }
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  try {
    await runPool(tasks, args.concurrency, runChunk);
  } finally {
    releaseDispatchLock(lockPath);
  }

  // ── Summary ──
  const finalManifest = readManifest(manifestPath);
  const done = finalManifest.filter(e => e.status === 'done').length;
  const failed = finalManifest.filter(e => e.status === 'failed').length;
  const permanent = finalManifest.filter(e => e.status === 'permanent_failed').length;
  const pending = finalManifest.filter(e => e.status === 'pending').length;
  logEvent(args.root, 'dispatch_complete', { done, failed, permanent_failed: permanent, pending, total: finalManifest.length });
  console.log(`\n[dispatch] Complete. Done=${done}, Failed=${failed}, PermanentFailed=${permanent}, Pending=${pending}/${finalManifest.length}`);
  console.log('[dispatch] Run merge.js next (Phase 3) to generate daily report.');
}

main().catch(err => {
  console.error('[dispatch] Fatal:', err.message);
  process.exit(1);
});