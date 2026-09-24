// ─────────────────────────────────────────────────────────────────────────────
// pr-rows.test.mjs — tooling/ci/assert-pr-rows.mjs must accept exactly the two
// forms of the `Rows:` line, refuse every other body, and tell lost wiring
// (exit 2) from a body with no line (exit 1).
//
// Row: O-CLOSURE-AUDIT-NEVER-WRITES-BACK.
//
// THE CASES, each with its green control on the same fixture first, so a red
// proves the mutation and not the fixture:
//   C1  a real PR body with `- **Rows:** O-…` passes; with that line deleted, missing
//   C2  `none — <reason>` passes; a short, bare or mis-spelled `none` is malformed
//   C3  one line passes; two lines are duplicated, and both are named
//   C4  a line inside a comment or a code fence is not read; CRLF splits like LF
//   C5  an id list passes; a placeholder, lower case, a trailing comma, backticks
//       and a space-separated list are malformed
//   C6  the CLI: PR_BODY unset exits 2, empty exits 1; BASE_SHA and PR_CREATED_AT
//       unset, a base the history lacks, and a shallow clone each exit 2
//   C7  the grandfather rule, over real repositories: a PR opened before the
//       guard landed on its base is warned and exits 0; one opened after, or on a
//       base without the guard, exits 1
//   C8  the PR template, unedited, is red; filled, it is green
//   C9  (live only: a body edit on a real PR re-runs guard-meta; not a unit case)
//   and the automated bodies site-drift-repair.yml and store-screenshots.yml
//   write each carry a valid line, read out of the workflows themselves.
//
// Every case builds its repository with `git init` in a temp directory: no
// network, no real history.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GUARD_REL, MIN_REASON, parseRows, visibleLines } from '../assert-pr-rows.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-pr-rows.mjs');
const TEMPLATE = join(REPO, '.github', 'PULL_REQUEST_TEMPLATE.md');
const SITE_DRIFT = join(REPO, '.github', 'workflows', 'site-drift-repair.yml');
const SCREENSHOTS = join(REPO, '.github', 'workflows', 'store-screenshots.yml');

/** This PR's own body, as the brief wrote it: the guard's first real subject. */
const PR_TEXT = [
  '- **Rows:** O-CLOSURE-AUDIT-NEVER-WRITES-BACK',
  '- **What was wrong:** 0 of the last 200 main commits tie a merge to the rows it moves; nothing reads a PR body.',
  '- **What this changes:** the template line; `tooling/ci/assert-pr-rows.mjs` in guard-meta, reading the body through `env:`.',
  '',
  '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
].join('\n');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pr-rows-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const scratch = (name) => {
  const d = join(TMP, `${name}-${seq++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

/** The environment every spawn starts from: the three inputs removed, so a value a
 *  developer exported cannot leak into an "unset" case, and the git variables a
 *  hook exports removed, so `git -C` answers about the fixture. */
const baseEnv = () => {
  const env = { ...process.env };
  for (const k of ['PR_BODY', 'PR_CREATED_AT', 'BASE_SHA', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  return env;
};

const git = (where, args, extraEnv = {}) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8', env: { ...baseEnv(), ...extraEnv } });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout.trim();
};

/** A repository with one unrelated commit, and — when `guardAt` is given — a
 *  second commit, dated `guardAt`, that adds GUARD_REL. Returns { root, sha }. */
function baseRepo(guardAt) {
  const root = scratch('base');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git(root, ['add', '-A']);
  const early = '2026-01-01T00:00:00Z';
  git(root, ['commit', '-q', '-m', 'first'], { GIT_AUTHOR_DATE: early, GIT_COMMITTER_DATE: early });
  if (guardAt) {
    mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
    copyFileSync(GUARD, join(root, ...GUARD_REL.split('/')));
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'add the guard'], { GIT_AUTHOR_DATE: guardAt, GIT_COMMITTER_DATE: guardAt });
  }
  return { root, sha: git(root, ['rev-parse', 'HEAD']) };
}

/** Run the REAL guard with `root` as the repository its git read asks. `inputs`
 *  holds the three variables; a key set to `undefined` is left unset. */
const run = (root, inputs) => {
  const env = baseEnv();
  for (const [k, v] of Object.entries(inputs)) if (v !== undefined) env[k] = v;
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

const LATER = '2026-12-01T00:00:00Z';

// ── C1 ───────────────────────────────────────────────────────────────────────
describe('C1 — a real PR body', () => {
  test('green control: this PR\'s own body names its row', () => {
    const v = parseRows(PR_TEXT);
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.kind, 'ids');
    assert.deepEqual(v.ids, ['O-CLOSURE-AUDIT-NEVER-WRITES-BACK']);
    assert.equal(v.line, 1);
  });

  test('the same body with the Rows line deleted is missing', () => {
    const body = PR_TEXT.split('\n').slice(1).join('\n');
    assert.notEqual(body, PR_TEXT);
    const v = parseRows(body);
    assert.equal(v.ok, false);
    assert.equal(v.problem, 'missing');
  });

  test('a plain `Rows:` line, no bullet and no bold, is the same line', () => {
    const v = parseRows('Rows: O-CLOSURE-AUDIT-NEVER-WRITES-BACK\n');
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(v.ids, ['O-CLOSURE-AUDIT-NEVER-WRITES-BACK']);
  });

  test('an indented or lower-case line is not read, and the miss is named as a hint', () => {
    const v = parseRows('  Rows: O-A\nrows: O-B\n');
    assert.equal(v.ok, false);
    assert.equal(v.problem, 'missing');
    assert.equal(v.hints.length, 2);
    assert.match(v.hints[0], /^line 1: /);
    assert.match(v.hints[1], /^line 2: /);
  });
});

// ── C2 ───────────────────────────────────────────────────────────────────────
describe('C2 — `none` with a reason', () => {
  test('green control: `none — <reason>` passes and keeps the reason', () => {
    const v = parseRows('Rows: none — a typo in a README, no row moves\n');
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.kind, 'none');
    assert.equal(v.reason, 'a typo in a README, no row moves');
  });

  test('` - ` is the other accepted separator', () => {
    const v = parseRows('- **Rows:** none - automated site drift repair\n');
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.kind, 'none');
  });

  test(`a reason of exactly ${MIN_REASON} characters passes, one fewer is malformed`, () => {
    assert.equal(parseRows('Rows: none — 0123456789').ok, true);
    const v = parseRows('Rows: none — 012345678');
    assert.equal(v.ok, false);
    assert.equal(v.problem, 'malformed');
    assert.match(v.why, /9 character\(s\)/);
  });

  test('a bare `none` is malformed', () => {
    const v = parseRows('Rows: none\n');
    assert.equal(v.problem, 'malformed');
    assert.match(v.why, /lower case, then ` — ` or ` - `/);
  });

  test('`None` in title case is malformed', () => {
    const v = parseRows('Rows: None — a typo in a README, no row moves\n');
    assert.equal(v.problem, 'malformed');
  });

  test('`none:` with a colon is malformed', () => {
    const v = parseRows('Rows: none: a typo in a README, no row moves\n');
    assert.equal(v.problem, 'malformed');
  });
});

// ── C3 ───────────────────────────────────────────────────────────────────────
describe('C3 — exactly one line', () => {
  test('green control: one line passes', () => {
    assert.equal(parseRows('Rows: O-A\n\nbody text\n').ok, true);
  });

  test('two lines are duplicated, and both line numbers are named', () => {
    const v = parseRows('Rows: O-A\n\nbody text\n- **Rows:** O-B\n');
    assert.equal(v.ok, false);
    assert.equal(v.problem, 'duplicated');
    assert.deepEqual(v.lines, [1, 4]);
  });

  test('two lines are duplicated even when both are valid and identical', () => {
    const v = parseRows('Rows: O-A\nRows: O-A\n');
    assert.equal(v.problem, 'duplicated');
  });
});

// ── C4 ───────────────────────────────────────────────────────────────────────
describe('C4 — what a reader of the rendered body cannot see is not read', () => {
  test('green control: the line outside any comment or fence passes', () => {
    assert.equal(parseRows('intro\nRows: O-A\noutro\n').ok, true);
  });

  test('a line inside a multi-line <!-- --> comment is not read', () => {
    const v = parseRows('intro\n<!--\nRows: O-A\n-->\noutro\n');
    assert.equal(v.problem, 'missing');
  });

  test('a comment left open hides every line after it', () => {
    const v = parseRows('intro\n<!-- never closed\n\nRows: O-A\n');
    assert.equal(v.problem, 'missing');
  });

  test('a line after a comment closed on the same line is read', () => {
    const v = parseRows('<!-- a note -->Rows: O-A\n');
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  test('a line inside a ``` fence is not read', () => {
    const v = parseRows('intro\n```\nRows: O-A\n```\noutro\n');
    assert.equal(v.problem, 'missing');
  });

  test('a line inside a ~~~ fence is not read, and a ``` inside it does not close it', () => {
    const v = parseRows('~~~md\n```\nRows: O-A\n~~~\n');
    assert.equal(v.problem, 'missing');
  });

  test('the line after a closed fence is read, and a fence inside a comment is not a fence', () => {
    assert.equal(parseRows('```\ncode\n```\nRows: O-A\n').ok, true);
    assert.equal(parseRows('<!--\n```\n-->\nRows: O-A\n').ok, true);
  });

  test('a CRLF body — the GitHub web editor writes one — splits like LF', () => {
    const v = parseRows('intro\r\n- **Rows:** O-A, O-B\r\noutro\r\n');
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(v.ids, ['O-A', 'O-B']);
    assert.equal(visibleLines('a\r\nb\r\n').length, 3);
  });
});

// ── C5 ───────────────────────────────────────────────────────────────────────
describe('C5 — the id list', () => {
  test('green control: a comma list, with or without spaces, passes', () => {
    const v = parseRows('Rows: O-A1,O-B-2, O-C\n');
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(v.ids, ['O-A1', 'O-B-2', 'O-C']);
  });

  test('the template placeholder `<…>` is malformed', () => {
    const v = parseRows('Rows: <O-ROW-ID, … | none — why>\n');
    assert.equal(v.problem, 'malformed');
    assert.match(v.why, /placeholder/);
  });

  test('a `none` reason that is still the placeholder is malformed', () => {
    const v = parseRows('Rows: none — <why no row moves, at least 10 characters>\n');
    assert.equal(v.problem, 'malformed');
  });

  test('a lower-case id is malformed', () => {
    const v = parseRows('Rows: o-closure-audit\n');
    assert.equal(v.problem, 'malformed');
    assert.match(v.why, /not a row id: `o-closure-audit`/);
  });

  test('a trailing comma is malformed', () => {
    assert.equal(parseRows('Rows: O-A,\n').problem, 'malformed');
  });

  test('an id in backticks is malformed', () => {
    assert.equal(parseRows('Rows: `O-A`\n').problem, 'malformed');
  });

  test('a space-separated list is malformed', () => {
    assert.equal(parseRows('Rows: O-A O-B\n').problem, 'malformed');
  });

  test('`Rows:` with nothing after it is malformed, not missing', () => {
    const v = parseRows('Rows:\n');
    assert.equal(v.problem, 'malformed');
    assert.match(v.why, /names nothing/);
  });
});

// ── C6 ───────────────────────────────────────────────────────────────────────
describe('C6 — the CLI: lost wiring is exit 2, a bad body is exit 1', () => {
  test('green control: a valid body on a base without the guard exits 0', () => {
    const { root, sha } = baseRepo();
    const r = run(root, { PR_BODY: PR_TEXT, PR_CREATED_AT: LATER, BASE_SHA: sha });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}PR rows — body line 1 names 1 row\(s\): O-CLOSURE-AUDIT-NEVER-WRITES-BACK/);
  });

  test('PR_BODY unset exits 2 and names the variable', () => {
    const { root, sha } = baseRepo();
    const r = run(root, { PR_BODY: undefined, PR_CREATED_AT: LATER, BASE_SHA: sha });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — PR_BODY is not set/);
  });

  test('PR_BODY empty exits 1 with a FAIL line', () => {
    const { root, sha } = baseRepo();
    const r = run(root, { PR_BODY: '', PR_CREATED_AT: LATER, BASE_SHA: sha });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL the pull request body has no `Rows:` line/);
    assert.match(r.out, /::error title=This PR body has no valid Rows: line::/);
  });

  test('a duplicated line exits 1', () => {
    const { root, sha } = baseRepo();
    const r = run(root, { PR_BODY: 'Rows: O-A\nRows: O-B\n', PR_CREATED_AT: LATER, BASE_SHA: sha });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL the pull request body has 2 `Rows:` lines \(lines 1, 2\)/);
  });

  test('BASE_SHA unset exits 2', () => {
    const { root } = baseRepo();
    const r = run(root, { PR_BODY: PR_TEXT, PR_CREATED_AT: LATER, BASE_SHA: undefined });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — BASE_SHA is not set/);
  });

  test('PR_CREATED_AT unset exits 2', () => {
    const { root, sha } = baseRepo();
    const r = run(root, { PR_BODY: PR_TEXT, PR_CREATED_AT: undefined, BASE_SHA: sha });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — PR_CREATED_AT is not set/);
  });

  test('a BASE_SHA the history does not hold exits 2 (the base git read failed)', () => {
    const { root } = baseRepo();
    const r = run(root, { PR_BODY: PR_TEXT, PR_CREATED_AT: LATER, BASE_SHA: 'f'.repeat(40) });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — `git log -1 --diff-filter=A --format=%cI f{40} -- tooling\/ci\/assert-pr-rows\.mjs` failed/);
  });

  test('a shallow clone exits 2, since its boundary commit would read as the one that added the guard', () => {
    const { root } = baseRepo('2026-10-01T00:00:00Z');
    const shallow = scratch('shallow');
    const r0 = spawnSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(root).href, shallow], { encoding: 'utf8', env: baseEnv() });
    assert.equal(r0.status, 0, r0.stderr);
    assert.equal(git(shallow, ['rev-parse', '--is-shallow-repository']), 'true');
    const r = run(shallow, { PR_BODY: PR_TEXT, PR_CREATED_AT: LATER, BASE_SHA: git(shallow, ['rev-parse', 'HEAD']) });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — `git -C .* rev-parse --is-shallow-repository` answered `true`/);
  });
});

// ── C7 ───────────────────────────────────────────────────────────────────────
describe('C7 — the grandfather rule, read from the base\'s history', () => {
  const LANDED = '2026-10-01T12:00:00Z';

  test('green control: a valid body on a base that carries the guard exits 0', () => {
    const { root, sha } = baseRepo(LANDED);
    const r = run(root, { PR_BODY: PR_TEXT, PR_CREATED_AT: '2026-09-30T00:00:00Z', BASE_SHA: sha });
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /::warning/);
  });

  test('a PR opened BEFORE the guard landed is warned with the line to add, and exits 0', () => {
    const { root, sha } = baseRepo(LANDED);
    const r = run(root, { PR_BODY: 'no line here\n', PR_CREATED_AT: '2026-09-30T00:00:00Z', BASE_SHA: sha });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /::warning title=This PR body has no valid Rows: line::the pull request body has no `Rows:` line\./);
    assert.match(r.out, /"Rows: O-ROW-ID\[, O-ROW-ID…\]" or "Rows: none — <why no row moves, at least 10 characters>"/);
    // The guard prints git's `%cI` answer as git gave it, and git's spelling of a UTC
    // offset varies by build: 2.54.0.windows.1 prints `Z` where the drafting sandbox's
    // git printed `+00:00`. So the expected text is git's own answer for this commit,
    // held to the instant LANDED names in either spelling.
    const landed = git(root, ['log', '-1', '--diff-filter=A', '--format=%cI', sha, '--', GUARD_REL]);
    assert.ok(['2026-10-01T12:00:00+00:00', '2026-10-01T12:00:00Z'].includes(landed), `git gave ${landed} for a commit dated ${LANDED}`);
    assert.ok(r.out.includes(`before tooling/ci/assert-pr-rows.mjs landed on its base (${landed})`), r.out);
  });

  test('a PR opened AFTER the guard landed exits 1', () => {
    const { root, sha } = baseRepo(LANDED);
    const r = run(root, { PR_BODY: 'no line here\n', PR_CREATED_AT: '2026-10-02T00:00:00Z', BASE_SHA: sha });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL the pull request body has no `Rows:` line/);
  });

  test('a base without the guard (the PR that adds it) is not grandfathered, however early the PR', () => {
    const { root, sha } = baseRepo();
    const r = run(root, { PR_BODY: 'no line here\n', PR_CREATED_AT: '2020-01-01T00:00:00Z', BASE_SHA: sha });
    assert.equal(r.code, 1, r.out);
  });
});

// ── C8 ───────────────────────────────────────────────────────────────────────
describe('C8 — the PR template', () => {
  const template = () => readFileSync(TEMPLATE, 'utf8');
  const PLACEHOLDER = /^Rows: <[^\n]*>$/m;

  test('green control: the template filled in passes, on the CLI too', () => {
    const src = template();
    assert.match(src, PLACEHOLDER, 'the template carries no `Rows: <…>` placeholder line');
    const filled = src.replace(PLACEHOLDER, 'Rows: O-CLOSURE-AUDIT-NEVER-WRITES-BACK');
    const v = parseRows(filled);
    assert.equal(v.ok, true, JSON.stringify(v));
    const { root, sha } = baseRepo();
    const r = run(root, { PR_BODY: filled, PR_CREATED_AT: LATER, BASE_SHA: sha });
    assert.equal(r.code, 0, r.out);
  });

  test('the template unedited is malformed, and the CLI exits 1', () => {
    const v = parseRows(template());
    assert.equal(v.ok, false);
    assert.equal(v.problem, 'malformed', JSON.stringify(v));
    const { root, sha } = baseRepo();
    const r = run(root, { PR_BODY: template(), PR_CREATED_AT: LATER, BASE_SHA: sha });
    assert.equal(r.code, 1, r.out);
  });
});

// ── the automated bodies ─────────────────────────────────────────────────────
// Two workflows open pull requests with no human writing the body, and one of
// them auto-merges: a body without the line would sit red with nobody reading it.
// The bodies are rebuilt from the workflow text: site-drift-repair's `printf`
// lines into pr-body.md, and each store-screenshots `--body "…"$'…'` argument.

/** site-drift-repair: the single-quoted `printf '%s\n…' '<text>'` lines of the
 *  block redirected into pr-body.md, in order. */
function siteDriftBody(src) {
  const at = src.indexOf('} > "${RUNNER_TEMP}/pr-body.md"');
  assert.ok(at > 0, 'site-drift-repair.yml no longer writes pr-body.md from a { … } block');
  const open = src.lastIndexOf('{\n', at);
  const parts = [];
  for (const line of src.slice(open, at).split('\n')) {
    const m = /^\s*printf '%s((?:\\n)+)'\s+'([^']*)'\s*$/.exec(line);
    if (m) parts.push(m[2] + '\n'.repeat(m[1].length / 2));
  }
  return parts;
}

/** store-screenshots: each `--body "<double-quoted>"` with an optional `$'<ansi-c>'`
 *  suffix, rendered as bash would with the run id substituted. */
function screenshotBodies(src) {
  const out = [];
  for (const m of src.matchAll(/--body "((?:[^"\\]|\\.)*)"(?:\$'((?:[^'\\]|\\.)*)')?/g)) {
    const dq = m[1].replace(/\\([\\"`$])/g, '$1').replaceAll('${{ github.run_id }}', '12345');
    const ansi = (m[2] ?? '').replace(/\\(n|t|\\|')/g, (_, c) => ({ n: '\n', t: '\t', '\\': '\\', "'": "'" })[c]);
    out.push(dq + ansi);
  }
  return out;
}

describe('the automated PR bodies carry a valid line', () => {
  test('site-drift-repair: green control, the body it writes names `none` with its reason', () => {
    const parts = siteDriftBody(readFileSync(SITE_DRIFT, 'utf8'));
    assert.ok(parts.length >= 6, `read ${parts.length} printf line(s); the body has at least six paragraphs`);
    const v = parseRows(parts.join(''));
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.kind, 'none');
    assert.equal(v.reason, 'automated site drift repair (generated sites/ only)');
  });

  test('site-drift-repair: the same body without its Rows printf is missing', () => {
    const parts = siteDriftBody(readFileSync(SITE_DRIFT, 'utf8')).filter((p) => !p.startsWith('Rows:'));
    assert.equal(parseRows(parts.join('')).problem, 'missing');
  });

  test('store-screenshots: green control, each of the four bodies names `none` with its reason', () => {
    const src = readFileSync(SCREENSHOTS, 'utf8');
    const bodies = screenshotBodies(src);
    assert.equal((src.match(/^\s*gh pr create \\$/gm) ?? []).length, 4, 'store-screenshots.yml no longer opens four pull requests');
    assert.equal(bodies.length, 4, `read ${bodies.length} --body argument(s), expected one per gh pr create`);
    const verdicts = bodies.map((b) => parseRows(b));
    assert.deepEqual(
      verdicts.map((v) => [v.ok, v.kind, v.reason]),
      [
        [true, 'none', 'automated store screenshot capture, reviewed by eye'],
        [true, 'none', 'automated store screenshot capture, reviewed by eye'],
        [true, 'none', 'automated store screenshot capture, reviewed by eye'],
        [true, 'none', 'automated store screenshot capture, reviewed by eye'],
      ],
    );
  });

  test('store-screenshots: a body whose line is appended as a literal \\n in the double quotes is missing', () => {
    const literal = screenshotBodies('--body "Captured by run 1.\\n\\nRows: none — automated store screenshot capture, reviewed by eye"')[0];
    assert.equal(literal.includes('\n'), false);
    assert.equal(parseRows(literal).problem, 'missing');
  });
});
