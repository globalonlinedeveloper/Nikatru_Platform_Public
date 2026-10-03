#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// land-merge.mjs — the one squash merge a lander runs: with the PR's title as
// the subject and the PR's BODY as the message, read at the head it merges.
//
// Row: O-SQUASH-DROPS-THE-ROWS-LINE (SYN-C1).
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// `gh pr merge --squash` with no body takes the repository's squash default,
// squash_merge_commit_message=COMMIT_MESSAGES: the branch's commit messages, and
// never the PR body that assert-pr-rows.mjs made name its rows. Measured
// 2026-10-01, 82 of 114 merges reached main without a `Rows:` line that way, and
// main's history is the only place the register's lag reader looks. So the
// subject and the body are passed, never left to a setting:
//
//   gh pr merge <n> --repo <r> --squash --match-head-commit <head>
//              --subject "<title> (#<n>)" --body-file <the PR body>
//
// The body and the head come from ONE `gh pr view` read, and
// --match-head-commit makes GitHub refuse the merge if the head moved after it,
// so the message is the body of the commit that merges. The `Rows:` line is
// rewritten bare (`- **Rows:** X` → `Rows: X`): main's reader and
// tooling/ci/assert-main-rows.mjs read `^Rows:` only. A body with no valid line
// is refused here, before the merge, rather than red on main after it.
//
// Usage:  node tooling/ops/land-merge.mjs <pr> [--repo <owner/name>] [--head <sha>]
//                                             [--dry-run] [--view-file <json>]
//   --head       refuse (exit 2) unless the PR head is still this sha
//   --dry-run    print the command and keep the body file; merge nothing
//   --view-file  the `gh pr view <n> --json number,title,body,headRefOid,state`
//                document from a file instead of gh (tests, a recorded read)
// Exit:   0 = merged, or (dry run) the command composed
//         1 = refused: the body carries no valid `Rows:` line, or gh pr merge failed
//         2 = not a verdict: bad arguments, the PR unreadable or not open, the head moved
// The first stdout line is always `<VERDICT> <why>`.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeVerdict, parseRows } from '../ci/assert-pr-rows.mjs';
import { PLATFORM_REPO_SLUG } from '../generated/codehost.mjs';

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_SHAPE = /^[0-9a-f]{40}$/;
export const DEFAULT_REPO = PLATFORM_REPO_SLUG;
/** What the one `gh pr view` read asks for. */
export const VIEW_FIELDS = 'number,title,body,headRefOid,state';

/** PURE. The squash subject GitHub's own default writes: the title, then ` (#<n>)`. */
export function squashSubject(title, number) {
  const t = String(title ?? '').trim();
  const tag = `(#${number})`;
  return t.endsWith(tag) ? t : `${t} ${tag}`;
}

/**
 * PURE. The squash message: the PR body with its one `Rows:` line rewritten bare.
 *   { ok: true, text, rows }    rows is the bare line
 *   { ok: false, why }          the body would land without a line the reader reads
 */
export function squashBody(body) {
  const v = parseRows(body);
  if (!v.ok) return { ok: false, why: describeVerdict(v) };
  const rows = v.kind === 'ids' ? `Rows: ${v.ids.join(', ')}` : `Rows: none — ${v.reason}`;
  const lines = String(body ?? '').split(/\r\n|\r|\n/);
  lines[v.line - 1] = rows;
  return { ok: true, text: `${lines.join('\n').replace(/\s+$/, '')}\n`, rows };
}

/** PURE. The `gh` argv of the merge. Never a shell string: the title is untrusted. */
export function mergeArgs({ number, repo, headRefOid, subject, bodyFile }) {
  return ['pr', 'merge', String(number), '--repo', repo, '--squash', '--match-head-commit', headRefOid, '--subject', subject, '--body-file', bodyFile];
}

const defaultView = (number, repo) => {
  const r = spawnSync('gh', ['pr', 'view', String(number), '--repo', repo, '--json', VIEW_FIELDS], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`gh pr view ${number} failed: ${r.error ? r.error.message : (r.stderr || '').trim() || `exit ${r.status}`}`);
  return JSON.parse(r.stdout);
};

const defaultExec = (args) => {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  return { status: r.error ? null : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}` };
};

/**
 * Land one PR. `view(number, repo)` returns the gh pr view document; `exec(args)`
 * runs gh and returns { status, out }. Both are injected by the tests.
 * Returns { code, lines, args?, bodyFile? }.
 */
export function land({ number, repo = DEFAULT_REPO, head = null, dryRun = false, view = defaultView, exec = defaultExec, tmp = tmpdir() }) {
  if (!Number.isInteger(number) || number < 1) return { code: 2, lines: ['NONE the first argument is not a pull request number'] };
  if (!REPO_SHAPE.test(repo)) return { code: 2, lines: [`NONE ${JSON.stringify(repo).slice(0, 80)} is not an owner/name slug`] };
  if (head !== null && !SHA_SHAPE.test(head)) return { code: 2, lines: [`NONE --head ${JSON.stringify(head).slice(0, 50)} is not a full commit sha`] };
  let doc;
  try {
    doc = view(number, repo);
  } catch (e) {
    return { code: 2, lines: [`NONE the pull request could not be read (${e.message})`] };
  }
  if (!doc || doc.number !== number || typeof doc.title !== 'string' || !SHA_SHAPE.test(String(doc.headRefOid ?? ''))) {
    return { code: 2, lines: [`NONE the read is not #${number}'s ${VIEW_FIELDS} document`] };
  }
  if (doc.state !== 'OPEN') return { code: 2, lines: [`NONE #${number} is ${doc.state}, not OPEN`] };
  if (head !== null && doc.headRefOid !== head) {
    return { code: 2, lines: [`NONE #${number}'s head is ${doc.headRefOid.slice(0, 8)}, not ${head.slice(0, 8)}: it moved, so its gate and body are not the ones asked about`] };
  }
  const body = squashBody(doc.body ?? '');
  if (!body.ok) {
    return { code: 1, lines: [`REFUSED #${number} would squash without a Rows: line main can read: ${body.why}`, 'Fix the PR body (assert-pr-rows.mjs reads it on `edited`), then land again.'] };
  }
  const dir = mkdtempSync(join(tmp, 'nikatru-land-merge-'));
  const bodyFile = join(dir, `pr-${number}-body.md`);
  writeFileSync(bodyFile, body.text);
  const args = mergeArgs({ number, repo, headRefOid: doc.headRefOid, subject: squashSubject(doc.title, number), bodyFile });
  const shown = `gh ${args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))).join(' ')}`;
  if (dryRun) {
    return { code: 0, lines: [`COMPOSED #${number} at ${doc.headRefOid.slice(0, 8)}, ${body.rows}`, shown, `body ${bodyFile}`], args, bodyFile };
  }
  try {
    const r = exec(args);
    if (r.status !== 0) {
      return { code: 1, lines: [`FAILED gh pr merge #${number} exited ${r.status}`, shown, ...String(r.out ?? '').trim().split('\n').filter(Boolean)], args, bodyFile };
    }
    return { code: 0, lines: [`MERGED #${number} at ${doc.headRefOid.slice(0, 8)}, ${body.rows}`, shown], args, bodyFile };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgv(argv) {
  const opts = { number: Number.NaN, repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO, head: null, dryRun: false, viewFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') opts.repo = argv[++i] ?? '';
    else if (a === '--head') opts.head = argv[++i] ?? '';
    else if (a === '--view-file') opts.viewFile = argv[++i] ?? '';
    else if (a === '--dry-run') opts.dryRun = true;
    else if (/^\d+$/.test(a) && Number.isNaN(opts.number)) opts.number = Number(a);
    else return { error: `unknown argument ${JSON.stringify(a).slice(0, 40)}` };
  }
  return opts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = parseArgv(process.argv.slice(2));
  let r;
  if (opts.error) {
    r = { code: 2, lines: [`NONE ${opts.error}; usage: land-merge.mjs <pr> [--repo o/n] [--head <sha>] [--dry-run] [--view-file <json>]`] };
  } else {
    const view = opts.viewFile ? () => JSON.parse(readFileSync(opts.viewFile, 'utf8')) : defaultView;
    r = land({ number: opts.number, repo: opts.repo, head: opts.head, dryRun: opts.dryRun, view });
  }
  for (const l of r.lines) console.log(l);
  process.exitCode = r.code;
}
