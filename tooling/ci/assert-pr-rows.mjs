#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-pr-rows.mjs — a pull request body names the register rows it moves, or
// says why it moves none.
//
// Row: O-CLOSURE-AUDIT-NEVER-WRITES-BACK (this is its Public half).
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// Measured 2026-09-24 over the 200 commits ending at main 53e5fd85: 120 mention
// a row id somewhere in their message, and ONE carries a `Rows:` line — #914,
// written by hand from a brief. A mention in a title cannot be told apart from a
// row that was merely discussed, so no reader could tie a merge to the rows it
// moves. The register lives in the private corpus, which CI cannot read, and
// nothing in this repository read a PR body, so the closure audit's verdicts had
// no path back to a row. The body is the one place a PR can say which rows it
// closes or advances, and a squash merge carries it into main's history.
//
// ── THE LINE ─────────────────────────────────────────────────────────────────
// Exactly one line, outside `<!-- -->` comments and fenced code blocks, of one
// of two forms:
//     Rows: <row id>[, <row id>…]
//     Rows: none — <why no row moves, at least 10 characters>   (` - ` also)
// A leading `- ` bullet and `**Rows:**` bold are stripped first, so
// `- **Rows:** <row id>` is the same line. `<`, `>` and every other form are
// refused; the template's placeholder is one of them, on purpose, so a body
// left as the template wrote it is red.
//
// ── WIRING ───────────────────────────────────────────────────────────────────
// ci.yml job guard-meta runs this on pull_request events, `edited` included, so
// fixing the body re-runs it. A PR body is untrusted input: it arrives through
// the step's `env:`, and is never interpolated into `run:`.
//   PR_BODY        github.event.pull_request.body        (a null body arrives as '')
//   PR_CREATED_AT  github.event.pull_request.created_at
//   BASE_SHA       github.event.pull_request.base.sha
//
// ── GRANDFATHER ──────────────────────────────────────────────────────────────
// A PR opened before this file landed on its base could not have known the rule.
//     git log -1 --diff-filter=A --format=%cI $BASE_SHA -- tooling/ci/assert-pr-rows.mjs
// gives the date it landed. When that is later than PR_CREATED_AT, a missing or
// bad line is a `::warning::` naming the line to add, and the exit is 0. No date
// is written here: the base's own history answers. A base that does not carry
// this file yet (the PR that adds it) is not grandfathered. The read needs the
// base's history, so a shallow checkout is COVERAGE LOST rather than a guess.
//
// Tests: tooling/ci/test/pr-rows.test.mjs.
//
// Usage:  PR_BODY=… PR_CREATED_AT=… BASE_SHA=… node tooling/ci/assert-pr-rows.mjs [repoRoot]
// Exit:   0 = one valid line, or a grandfathered PR (warned)
//         1 = the line is missing, duplicated or malformed
//         2 = COVERAGE LOST: PR_BODY unset (unset is lost wiring; empty is a body
//             with no line), PR_CREATED_AT or BASE_SHA unset or malformed, or the
//             base git read failed
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This file, relative to the repository root: the path the grandfather read asks about. */
export const GUARD_REL = 'tooling/ci/assert-pr-rows.mjs';
/** One register row id. */
export const ROW_ID = /^O-[A-Z0-9-]+$/;
/** The shortest `none` reason accepted, in characters. */
export const MIN_REASON = 10;
/** The two forms, as a reader is told to write them. */
export const ACCEPTED_FORMS = Object.freeze([
  'Rows: <row id>[, <row id>…]',
  `Rows: none — <why no row moves, at least ${MIN_REASON} characters>`,
]);

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * The body's lines as a reader of the rendered PR sees them: `<!-- -->` comments
 * blanked (a comment can open and close mid-line, or span lines, and one left
 * open hides the rest of the body) and fenced code blocks dropped. Returns
 * `[{ n, text }]`, `n` 1-based over the raw body. CRLF, which a body edited in
 * the GitHub web editor carries, splits like LF.
 */
export function visibleLines(body) {
  const out = [];
  let inComment = false;
  let fence = null;
  String(body ?? '')
    .split(/\r\n|\r|\n/)
    .forEach((raw, i) => {
      const n = i + 1;
      if (fence) {
        const m = FENCE_CLOSE.exec(raw);
        if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null;
        return;
      }
      if (!inComment) {
        const m = FENCE_OPEN.exec(raw);
        if (m) {
          fence = { ch: m[1][0], len: m[1].length };
          return;
        }
      }
      let text = '';
      let rest = raw;
      while (rest.length) {
        if (inComment) {
          const end = rest.indexOf('-->');
          if (end === -1) break;
          rest = rest.slice(end + 3);
          inComment = false;
        } else {
          const start = rest.indexOf('<!--');
          if (start === -1) {
            text += rest;
            break;
          }
          text += rest.slice(0, start);
          rest = rest.slice(start + 4);
          inComment = true;
        }
      }
      out.push({ n, text });
    });
  return out;
}

/** A visible line with its leading `- ` bullet and `**Rows:**` bold stripped. */
const normalise = (text) => text.replace(/^- /, '').replace(/^\*\*Rows:\*\*/, 'Rows:').replace(/[ \t]+$/, '');

/** Judge what follows `Rows:`. Returns `{ ok: true, kind, ids | reason }` or `{ ok: false, why }`. */
export function judgeValue(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return { ok: false, why: 'the line names nothing after `Rows:`' };
  if (/[<>]/.test(value)) {
    return { ok: false, why: `\`${value}\` carries \`<\` or \`>\` — that is the template's placeholder, not a row id or a reason` };
  }
  const none = /^none(?: — | - )(.*)$/.exec(value);
  if (none) {
    const reason = none[1].trim();
    if ([...reason].length < MIN_REASON) {
      return { ok: false, why: `the reason after \`none\` is ${[...reason].length} character(s): \`${reason}\` — at least ${MIN_REASON} say why no row moves` };
    }
    return { ok: true, kind: 'none', reason };
  }
  if (/^none\b/i.test(value)) {
    return { ok: false, why: `\`${value}\` — write \`none\` in lower case, then \` — \` or \` - \`, then at least ${MIN_REASON} characters of reason` };
  }
  const ids = value.split(',').map((s) => s.trim());
  const bad = ids.filter((id) => !ROW_ID.test(id));
  if (bad.length) {
    return { ok: false, why: `not a row id: ${bad.map((b) => `\`${b}\``).join(', ')} — each id matches ${ROW_ID.source}, comma-separated` };
  }
  return { ok: true, kind: 'ids', ids };
}

/**
 * The verdict on one PR body, with no I/O.
 *   { ok: true,  kind: 'ids', ids, line }         one valid id list
 *   { ok: true,  kind: 'none', reason, line }     one valid `none`
 *   { ok: false, problem: 'missing', hints }      no line (hints: visible near misses)
 *   { ok: false, problem: 'duplicated', lines }   more than one line
 *   { ok: false, problem: 'malformed', line, why } one line, not in an accepted form
 */
export function parseRows(body) {
  const visible = visibleLines(body);
  const found = visible.map(({ n, text }) => ({ n, text: normalise(text) })).filter((l) => /^Rows:/.test(l.text));
  if (found.length === 0) {
    const hints = visible
      .filter(({ text }) => /rows\s*:|\*\*rows\*\*/i.test(text))
      .map(({ n, text }) => `line ${n}: \`${text.trim()}\` is not read — the line must start \`Rows:\` (after an optional \`- \` and \`**Rows:**\` bold)`);
    return { ok: false, problem: 'missing', hints };
  }
  if (found.length > 1) return { ok: false, problem: 'duplicated', lines: found.map((l) => l.n) };
  const [{ n, text }] = found;
  const v = judgeValue(text.slice('Rows:'.length));
  if (!v.ok) return { ok: false, problem: 'malformed', line: n, why: v.why };
  return { ...v, line: n };
}

/** One sentence per failing verdict, for the FAIL line and the annotation. */
export function describeVerdict(verdict) {
  if (verdict.problem === 'missing') return 'the pull request body has no `Rows:` line';
  if (verdict.problem === 'duplicated') return `the pull request body has ${verdict.lines.length} \`Rows:\` lines (lines ${verdict.lines.join(', ')}); it carries exactly one`;
  return `the \`Rows:\` line at body line ${verdict.line} is malformed: ${verdict.why}`;
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
  const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const env = process.env;

  if (env.PR_BODY === undefined) {
    coverageLost([
      'PR_BODY is not set, so there is no pull request body to read.',
      'In CI it comes from the env of the ci.yml guard-meta step that runs this file; unset means that wiring is gone.',
      'An EMPTY PR_BODY is a different verdict — a body with no `Rows:` line, exit 1.',
    ]);
  }
  const createdAt = env.PR_CREATED_AT ?? '';
  if (createdAt === '' || Number.isNaN(Date.parse(createdAt))) {
    coverageLost([
      `PR_CREATED_AT is ${createdAt === '' ? 'not set' : `\`${createdAt}\`, not a date`}.`,
      'The grandfather rule compares it with the date this guard landed on the base; without it that cannot be decided.',
    ]);
  }
  const baseSha = env.BASE_SHA ?? '';
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(baseSha)) {
    coverageLost([
      `BASE_SHA is ${baseSha === '' ? 'not set' : `\`${baseSha}\`, not a commit id`}.`,
      'The grandfather rule reads the base commit\'s history; without the commit that cannot be decided.',
    ]);
  }
  const shallow = spawnSync('git', ['-C', ROOT, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' });
  if (shallow.error || shallow.status !== 0 || shallow.stdout.trim() !== 'false') {
    coverageLost([
      `\`git -C ${ROOT} rev-parse --is-shallow-repository\` answered ${shallow.error ? shallow.error.message : `\`${(shallow.stdout || shallow.stderr).trim()}\` (exit ${shallow.status})`}.`,
      'The grandfather read needs the base\'s full history: in a shallow clone the boundary commit reads as the one that',
      'added this guard, and a PR opened after the rule would be excused. guard-meta checks out with fetch-depth: 0.',
    ]);
  }
  const added = spawnSync('git', ['-C', ROOT, 'log', '-1', '--diff-filter=A', '--format=%cI', baseSha, '--', GUARD_REL], { encoding: 'utf8' });
  if (added.error || added.status !== 0) {
    coverageLost([
      `\`git log -1 --diff-filter=A --format=%cI ${baseSha} -- ${GUARD_REL}\` failed: ${added.error ? added.error.message : (added.stderr || '').trim() || `exit ${added.status}`}.`,
      'Without the base\'s history, whether this PR predates the rule cannot be decided.',
    ]);
  }
  const landed = added.stdout.trim();
  if (landed !== '' && Number.isNaN(Date.parse(landed))) {
    coverageLost([`the base's history gave \`${landed}\` as the date ${GUARD_REL} landed, which is not a date.`]);
  }

  const verdict = parseRows(env.PR_BODY);
  if (verdict.ok) {
    const what = verdict.kind === 'ids' ? `${verdict.ids.length} row(s): ${verdict.ids.join(', ')}` : `none — ${verdict.reason}`;
    console.log(`ok  PR rows — body line ${verdict.line} names ${what}`);
  } else {
    const sentence = describeVerdict(verdict);
    const fix = `Add ONE line to the PR body, outside any <!-- comment --> or code fence: "${ACCEPTED_FORMS[0]}" or "${ACCEPTED_FORMS[1]}". Editing the body re-runs this check.`;
    const grandfathered = landed !== '' && Date.parse(landed) > Date.parse(createdAt);
    if (grandfathered) {
      console.log(
        `::warning title=This PR body has no valid Rows: line::${sentence}. The PR was opened ${createdAt}, before ${GUARD_REL} landed on its base (${landed}), so this is a warning, not a failure. ${fix}`,
      );
      console.log(`ok  PR rows — grandfathered: opened ${createdAt}, before the rule landed on the base at ${landed}`);
    } else {
      console.log(`::error title=This PR body has no valid Rows: line::${sentence}. ${fix}`);
      console.error(`✗ PR rows — ${sentence}`);
      console.error(`FAIL ${sentence}`);
      for (const h of verdict.hints ?? []) console.error(`  hint  ${h}`);
      console.error('');
      console.error('  Add ONE line to the PR body, outside any <!-- comment --> or code fence:');
      console.error(`      ${ACCEPTED_FORMS[0]}      the rows this PR closes or advances`);
      console.error(`      ${ACCEPTED_FORMS[1]}`);
      console.error('  A leading `- ` and `**Rows:**` bold are accepted. Editing the body re-runs this check (pull_request `edited`).');
      process.exit(1);
    }
  }
}
