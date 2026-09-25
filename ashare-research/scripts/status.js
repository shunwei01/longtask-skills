#!/usr/bin/env node
/**
 * status.js — Query task progress
 *
 * Usage: node scripts/status.js --root <dir>
 *
 * Exit codes: 0 = all complete, 1 = pending/failed remain, 2 = manifest not found
 */

const fs = require('fs');
const path = require('path');

function main() {
  let root = process.cwd();
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--root' && process.argv[i + 1]) {
      root = path.resolve(process.argv[i + 1]);
      break;
    }
  }

  const manifestPath = path.join(root, '.task-data', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.log('Manifest not found. Run discover.js first.');
    process.exit(2);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const total = manifest.length;
  const done = manifest.filter(e => e.status === 'done').length;
  const failed = manifest.filter(e => e.status === 'failed').length;
  const permanent = manifest.filter(e => e.status === 'permanent_failed').length;
  const skipped = manifest.filter(e => e.status === 'skipped').length;
  const pending = manifest.filter(e => e.status === 'pending').length;
  const inProgress = manifest.filter(e => e.status === 'in_progress').length;

  const terminal = done + failed + permanent + skipped;
  const pct = total > 0 ? Math.round((terminal / total) * 100) : 0;

  console.log(`Total: ${total} | Done: ${done} | Failed: ${failed} | PermanentFailed: ${permanent} | Skipped: ${skipped} | InProgress: ${inProgress} | Pending: ${pending}`);
  console.log(`Progress: ${pct}% (${terminal}/${total})`);

  if (failed + permanent > 0) {
    console.log('\nFailed targets:');
    for (const e of manifest) {
      if (e.status === 'failed' || e.status === 'permanent_failed') {
        console.log(`  ${e.status === 'permanent_failed' ? '⛔' : '✗'} ${e.name} (${e.secid})${e.error ? ' (' + e.error + ')' : ''}${e.status === 'permanent_failed' ? ` [retry_count=${e.retry_count || '?'}]` : ''}`);
      }
    }
  }

  // Exit 0 only when every entry reached terminal-success (done/skipped);
  // pending, in_progress, failed, and permanent_failed are all non-zero.
  process.exit(pending + inProgress + failed + permanent === 0 ? 0 : 1);
}

main();
