#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// pull.mjs — the triage routine's READ tool (lane feedback-triage, Do 2).
//
//   node tooling/feedback/pull.mjs --out <dir> [--limit N] [--screenshots]
//
// RUNS ON THE LEAD'S LAPTOP, never in CI: it reads `feedback_reports` from the
// LIVE platform_db and the screenshots from the private bucket, through the
// Cloudflare credential wrangler already holds there for D1 (no new secret).
// Wrangler is run as `node <wrangler.js>` from services/feedback's own install,
// never through a shebang or a `.sh` shim, so the same command works on Windows.
//
// WHAT IT WRITES, and only into --out:
//   <out>/reports.json        the `new` reports, oldest first, at most --limit
//                             (default and ceiling: triage-config.json
//                             perRun.reports). Columns: id, app, version,
//                             surface, category, description, steps,
//                             diagnostics, created_at, screenshot (a file name).
//                             NEVER the contact address and NEVER the account id:
//                             triage needs neither, so neither leaves the store.
//   <out>/shots/<id>.<ext>    with --screenshots, each attached screenshot.
//
// 🔴 --out INSIDE ANY GIT WORK TREE IS REFUSED, exit 2, before anything is read
// or written. Report text in a work tree is one `git add -A` from the public
// repository. Choose a directory outside every checkout (the lead's laptop path
// is in the PR's lead steps, never in this repo).
//
// 🔴 STDOUT CARRIES COUNTS ONLY. Never a report's text, never a diagnostics
// value, never wrangler's own output (which would echo rows): a failure prints
// which step failed and wrangler's exit code.
//
// Exit: 0 pulled · 1 a read failed · 2 refused (bad arguments, --out in a git tree).
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { insideGitTree, loadConfig, pathFor, ROOT } from './lib.mjs';

export const WORKER_DIR = path.join(ROOT, 'services', 'feedback');
export const WRANGLER_JS = path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
export const DATABASE = 'platform_db';
export const BUCKET = 'nikatru-feedback';

/** The one query. No `contact_email`, no `user_id`: triage reads neither. */
export function reportsQuery(limit) {
  return (
    'SELECT id, app_id, app_version, surface, category, description, steps, diagnostics, created_at, screenshot_key ' +
    `FROM feedback_reports WHERE status = 'new' ORDER BY created_at LIMIT ${Number(limit)}`
  );
}

/** Wrangler, as `node <wrangler.js> …` in services/feedback. Returns { status, stdout }. */
export function wranglerRunner(args) {
  const r = spawnSync(process.execPath, [WRANGLER_JS, ...args], { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

export function parseArgs(argv) {
  const out = { out: null, limit: null, screenshots: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i] ?? null;
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--screenshots') out.screenshots = true;
    else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  if (!out.out) return { error: '--out <dir> is required' };
  if (out.limit !== null && !(Number.isInteger(out.limit) && out.limit > 0)) return { error: '--limit must be a positive integer' };
  return out;
}

/**
 * The pull, with every effect injectable for tests: `run` is wrangler,
 * `exists` the git-tree probe, `write`/`mkdir` the file writes, `log` stdout.
 * Returns the exit code.
 */
export function pull(opts, deps = {}) {
  const { run = wranglerRunner, exists = existsSync, write = writeFileSync, mkdir = mkdirSync, log = console.log, config = loadConfig() } = deps;
  const p = pathFor(opts.out);
  const out = p.resolve(opts.out);
  const tree = insideGitTree(out, exists);
  if (tree !== null) {
    log(`pull: REFUSED — --out is inside the git work tree at ${tree}. Report text never lands in a checkout; choose a directory outside every repository.`);
    return 2;
  }
  const limit = Math.min(opts.limit ?? config.perRun.reports, config.perRun.reports);
  const q = run(['d1', 'execute', DATABASE, '--remote', '--json', '--command', reportsQuery(limit)]);
  if (q.status !== 0) {
    log(`pull: the D1 read failed (wrangler exited ${q.status}); nothing written.`);
    return 1;
  }
  let rows;
  try {
    const parsed = JSON.parse(q.stdout);
    rows = Array.isArray(parsed) ? parsed.flatMap((r) => r?.results ?? []) : null;
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows)) {
    log('pull: the D1 answer was not the JSON wrangler --json prints; nothing written.');
    return 1;
  }
  mkdir(out, { recursive: true });
  let shots = 0;
  let shotFailures = 0;
  const reports = rows.map((r) => {
    const ext = typeof r.screenshot_key === 'string' ? r.screenshot_key.split('.').pop() : null;
    return {
      id: r.id,
      app: r.app_id,
      version: r.app_version,
      surface: r.surface,
      category: r.category,
      description: r.description,
      steps: r.steps,
      diagnostics: (() => {
        try {
          return JSON.parse(r.diagnostics ?? '{}');
        } catch {
          return {};
        }
      })(),
      created_at: r.created_at,
      screenshot: ext ? `shots/${r.id}.${ext}` : null,
      _key: r.screenshot_key,
    };
  });
  if (opts.screenshots) {
    const dir = p.join(out, 'shots');
    mkdir(dir, { recursive: true });
    for (const r of reports) {
      if (!r._key) continue;
      const res = run(['r2', 'object', 'get', `${BUCKET}/${r._key}`, '--remote', '--file', p.join(out, r.screenshot)]);
      if (res.status === 0) shots++;
      else shotFailures++;
    }
  }
  write(p.join(out, 'reports.json'), JSON.stringify(reports.map(({ _key, ...r }) => r), null, 2) + '\n');
  const withShot = reports.filter((r) => r._key).length;
  log(
    `pull: ${reports.length} new report(s) (limit ${limit}), ${withShot} with a screenshot` +
      (opts.screenshots ? `, ${shots} screenshot(s) read${shotFailures ? `, ${shotFailures} failed` : ''}` : '') +
      ` -> ${out}`,
  );
  return shotFailures ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.log(`pull: ${args.error}\nusage: node tooling/feedback/pull.mjs --out <dir outside any git tree> [--limit N] [--screenshots]`);
    process.exit(2);
  }
  process.exit(pull(args));
}
