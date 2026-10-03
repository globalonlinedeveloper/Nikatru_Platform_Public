#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// fixed-reports.mjs — the reports a release fixes, from its commits' trailers
// (lane feedback-triage, Do 3).
//
//   node tooling/feedback/fixed-reports.mjs <from-ref> <to-ref> [--json]
//
// A fix PR names the reports it fixes with one trailer per report:
//     Fixes-Report: FB-XXXXXXXXXX
// This reads every commit message in <from-ref>..<to-ref> (git, a binary, never
// a shell) and prints the de-duplicated, sorted ids — the list a release record
// carries, and the list the lead feeds to `move.mjs <id> fixed --version <v>`.
// There is no release.json in this tree yet (lane release-notes owns it); when
// it lands, its writer reads `fixedReports()` here instead of a second parser.
//
// Exit: 0 printed (an empty list is a valid answer) · 2 git could not read the range.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib.mjs';

const TRAILER = /^Fixes-Report:[ \t]*(FB-[0-9A-HJKMNP-TV-Z]{10})[ \t]*$/gm;

/** Every FB- id named by a `Fixes-Report:` trailer line in `messages`, sorted, once each. */
export function fixedReports(messages) {
  const ids = new Set();
  for (const m of messages) for (const hit of String(m).matchAll(TRAILER)) ids.add(hit[1]);
  return [...ids].sort();
}

export function commitMessages(from, to, root = ROOT) {
  const r = spawnSync('git', ['log', '--format=%B%x00', `${from}..${to}`], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter((s) => s.trim() !== '');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [from, to, flag] = process.argv.slice(2);
  if (!from || !to) {
    console.log('usage: node tooling/feedback/fixed-reports.mjs <from-ref> <to-ref> [--json]');
    process.exit(2);
  }
  const msgs = commitMessages(from, to);
  if (msgs === null) {
    console.log(`fixed-reports: git could not read ${from}..${to}`);
    process.exit(2);
  }
  const ids = fixedReports(msgs);
  console.log(flag === '--json' ? JSON.stringify({ range: `${from}..${to}`, fixedReports: ids }) : ids.join('\n') || '(no Fixes-Report trailers)');
}
