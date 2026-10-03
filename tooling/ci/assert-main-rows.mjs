#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-main-rows.mjs — the newest merge on main carries a `Rows:` line in its
// squash message, or main is red.
//
// Row: O-SQUASH-DROPS-THE-ROWS-LINE (SYN-C1). Cites O-PR-ROWS-NAME-NONEXISTENT-ROWS.
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// assert-pr-rows.mjs makes every PR BODY name the rows it moves. The register's
// lag reader (Private requirements/tooling/public-log.mjs) reads `Rows:` lines
// from main's SQUASH MESSAGES, not from PR bodies — and GitHub's squash default
// (squash_merge_commit_message=COMMIT_MESSAGES) writes the branch's commit
// messages, not the body. Measured 2026-10-01: 82 of 114 merges at RT carried no
// `Rows:` line, and 7 more wrote a singular `Row:` the reader never reads. A
// green PR guard therefore said nothing about what main's history says. This
// reads the place the reader reads, after the merge, on the push to main.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
// Walk main's first-parent history from --ref (default HEAD), newest first, and
// take the newest commit whose SUBJECT names a pull request the way a squash
// merge does: it ends `(#<n>)`. Its message must hold a line matching `^Rows:`
// (multiline, plural, case-sensitive) — the reader's own regex, byte for byte,
// so a line this accepts is a line the reader reads. A `- **Rows:**` bullet is
// NOT that line; tooling/ops/land-merge.mjs writes it bare.
// A direct push whose subject names no PR is walked past, not judged.
// Renovate is not exempted by name: its merges pass only through their own
// `Rows:` line (renovate.json prBodyNotes, #1059), which reaches the squash
// message when the repository squashes with the PR body.
//
// ── WIRING ───────────────────────────────────────────────────────────────────
// ci.yml job guard-meta, a STEP-level `if:` for push to main — never on a PR,
// whose merge does not exist yet, and no job-level `if:` but the draft predicate
// every ci.yml job shares with ci-gate (true on a push to main), because ci-gate
// counts a skipped job red. guard-meta checks out with fetch-depth: 0.
//
// Tests: tooling/ci/test/main-rows.test.mjs.
//
// Usage:  node tooling/ci/assert-main-rows.mjs [repoRoot] [--ref <rev>]
// Exit:   0 = the newest PR merge carries a `Rows:` line
//         1 = it does not (or writes only the singular `Row:`)
//         2 = COVERAGE LOST: the history could not be read (no commits, a bad
//             ref, git failed), or no commit in the WINDOW names a PR — an empty
//             or shallow history is not evidence that the line is there
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How many first-parent commits are walked looking for a PR merge. */
export const WINDOW = 50;
/** A squash merge's subject: GitHub appends ` (#<n>)`. */
export const PR_SUBJECT = /\(#(\d+)\)\s*$/;
/** The reader's line: plural, at the start of a line. */
export const ROWS_LINE = /^Rows:/m;
/** The singular form the reader never reads; named when it is all there is. */
export const ROW_SINGULAR = /^(?:- )?(?:\*\*Row:\*\*|Row:)/m;

const SEP_FIELD = '\x1f';
const SEP_RECORD = '\x1e';

/** PURE. `git log --format=%H%x1f%B%x1e` output → [{ sha, subject, message }], newest first. */
export function parseLog(text) {
  return String(text ?? '')
    .split(SEP_RECORD)
    .map((r) => r.replace(/^\s+/, ''))
    .filter((r) => r.includes(SEP_FIELD))
    .map((r) => {
      const i = r.indexOf(SEP_FIELD);
      const message = r.slice(i + 1).replace(/\s+$/, '');
      return { sha: r.slice(0, i).trim(), subject: message.split(/\r?\n/)[0], message };
    });
}

/**
 * PURE. The verdict over a first-parent history, newest first.
 *   { code: 0, commit, pr }                    the newest PR merge carries the line
 *   { code: 1, commit, pr, singular }          it does not
 *   { code: 2, why }                           no commit names a PR (nothing judged)
 */
export function judgeHistory(commits) {
  if (!commits.length) return { code: 2, why: 'the history holds no commit' };
  const commit = commits.find((c) => PR_SUBJECT.test(c.subject));
  if (!commit) return { code: 2, why: `none of the ${commits.length} newest first-parent commit(s) has a subject naming a pull request (\`… (#<n>)\`)` };
  const pr = Number(PR_SUBJECT.exec(commit.subject)[1]);
  const body = commit.message.split(/\r?\n/).slice(1).join('\n');
  if (ROWS_LINE.test(body)) return { code: 0, commit, pr };
  return { code: 1, commit, pr, singular: ROW_SINGULAR.test(body) };
}

// ── main ─────────────────────────────────────────────────────────────────────
function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
const IS_MAIN = Boolean(process.argv[1]) && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));

if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const refAt = argv.indexOf('--ref');
  const ref = refAt === -1 ? 'HEAD' : argv[refAt + 1];
  const positional = argv.filter((a, i) => a !== '--ref' && (refAt === -1 || i !== refAt + 1));
  const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

  if (!ref || ref.startsWith('-')) coverageLost(['--ref needs a revision after it.']);

  const log = spawnSync('git', ['-C', ROOT, 'log', '--first-parent', `-n${WINDOW}`, `--format=%H${SEP_FIELD}%B${SEP_RECORD}`, ref, '--'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (log.error || log.status !== 0) {
    coverageLost([
      `\`git -C ${ROOT} log --first-parent -n${WINDOW} ${ref}\` failed: ${log.error ? log.error.message : (log.stderr || '').trim() || `exit ${log.status}`}.`,
      'An unborn or unreadable history says nothing about whether main\'s newest merge carries its `Rows:` line.',
    ]);
  }
  const commits = parseLog(log.stdout);
  const v = judgeHistory(commits);
  if (v.code === 2) {
    coverageLost([
      `${v.why}, reading ${ref} in ${ROOT}.`,
      'With no squash merge in the window there is nothing to judge. On a push to main guard-meta checks out with',
      'fetch-depth: 0; a shallow clone, or a history of direct pushes only, is not evidence the line is there.',
    ]);
  }
  const short = v.commit.sha.slice(0, 8);
  if (v.code === 0) {
    const line = v.commit.message.split(/\r?\n/).find((l) => /^Rows:/.test(l));
    console.log(`ok  main rows — ${short} (#${v.pr}) carries \`${line.trim()}\``);
  } else {
    const sentence = v.singular
      ? `${short} (#${v.pr}) carries only a singular \`Row:\` line, which main's reader never reads`
      : `${short} (#${v.pr}) was squashed without a \`Rows:\` line`;
    console.log(`::error title=Main's newest merge carries no Rows: line::${sentence}. The register's lag reader reads \`^Rows:\` from main's squash messages, so the rows this merge moved are invisible to it. Land with tooling/ops/land-merge.mjs, which squashes with the PR body, or set the repository to squash with the PR body.`);
    console.error(`✗ main rows — ${sentence}`);
    console.error(`FAIL ${sentence}`);
    console.error('');
    console.error(`  subject: ${v.commit.subject}`);
    console.error('  The squash message must hold a line starting `Rows:` (plural, at the start of the line).');
    console.error('  Squash with the PR body:  node tooling/ops/land-merge.mjs <pr>');
    console.error('  or set the repository:    gh api -X PATCH repos/<owner>/<name> -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY');
    console.error('  A merged commit cannot be re-squashed: name its rows in the NEXT merge\'s body.');
    process.exit(1);
  }
}
