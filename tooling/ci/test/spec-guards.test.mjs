// ─────────────────────────────────────────────────────────────────────────────
// spec-guards.test.mjs — the pre-commit runner's GUARDS table must still name
// every guard it claims to run, and the newest entry must actually be in it.
//
// 🔴 WHY THIS FILE EXISTS. `tooling/scripts/spec-guards.mjs` is the ONLY thing
// that runs the private corpus's guards: their subject is gitignored, so no CI
// job can read it and no CI job can notice one going missing from the table. The
// failure that produced this test is on record — `assert-platform-state.mjs` was
// written, documented in two READMEs, and wired into NOTHING for a day, so a
// mutated state file committed clean. A guard that is written and not wired is a
// guard nobody runs, and the absence is invisible from both sides: the guard
// still passes when invoked by hand, and the runner still prints "ok" over the
// set it does know about.
//
// ⚠️ THIS TEST DELIBERATELY DOES NOT SPAWN THE RUNNER. `spec-guards.mjs` exits 2
// when the private corpus is absent, and it is absent by construction in CI and
// in every fresh clone — so a test that ran it would be red in CI forever, which
// gets a suite deleted rather than fixed. What is checkable everywhere is the
// TABLE, which is source in this repo. The runner's own behaviour is proven by
// the pre-commit probe recorded with the change that added the entry: a mutated
// `platform-state` file made the commit exit 1, and reverting it made the same
// commit exit 0.
//
// ── EVERY CASE CARRIES ITS OWN MUTANT ────────────────────────────────────────
// A test that only reads the real source and finds what it expects is an
// assertion nobody has watched fail. So each case below runs the SAME predicate
// twice: once over the real file (must pass) and once over a mutated copy of its
// text with the subject removed (must fail). If a future edit makes the predicate
// unable to fail, the mutant half goes red and says so.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // tooling/ci/test -> repo root
const RUNNER = resolve(REPO, 'tooling', 'scripts', 'spec-guards.mjs');
const SOURCE = readFileSync(RUNNER, 'utf8');

/* The table is read as source text rather than imported, because importing the
   runner RUNS it — it resolves the workspace anchor and exits at module scope. */
function guardsTable(src) {
  const start = src.indexOf('const GUARDS = [');
  assert.notEqual(start, -1, 'spec-guards.mjs no longer declares `const GUARDS = [` — this test is reading the wrong thing');
  const end = src.indexOf('\n];', start);
  assert.notEqual(end, -1, 'the GUARDS array is not terminated by a line starting `];` — parse assumption broken');
  return src.slice(start, end);
}

/* Each row is `{ name: '<guard>', speed: '<fast|slow>', needsPrivate: <bool>,` on
   one line, which is the shape every entry in the file uses today. Parsing that
   shape rather than eval-ing keeps the test free of the runner's side effects. */
function rowsOf(table) {
  const rows = [];
  const re = /\{\s*name:\s*'([^']+)',\s*speed:\s*'([^']+)',\s*needsPrivate:\s*(true|false),/g;
  let m;
  while ((m = re.exec(table)) !== null) rows.push({ name: m[1], speed: m[2], needsPrivate: m[3] === 'true' });
  return rows;
}

/* The mutant: the entry's own row line, deleted. Nothing else is touched, so a
   failure here means the predicate ranged over the row and not over the file. */
function withoutRow(src, name) {
  const line = src.split('\n').find((l) => l.includes(`{ name: '${name}'`));
  assert.ok(line, `cannot build the mutant — no row line for ${name}`);
  return src.split('\n').filter((l) => l !== line).join('\n');
}

test('the runner still declares a parseable GUARDS table', () => {
  const rows = rowsOf(guardsTable(SOURCE));
  assert.ok(rows.length >= 9, `expected at least 9 guard rows, parsed ${rows.length} — the row shape changed and every case below is reading nothing`);
});

test('assert-platform-state is wired into the runner, and the check can fail', () => {
  const NAME = 'assert-platform-state';

  const rows = rowsOf(guardsTable(SOURCE));
  const row = rows.find((r) => r.name === NAME);
  assert.ok(row, `${NAME} is not in the GUARDS table — the guard exists and nothing runs it`);
  assert.equal(row.needsPrivate, true, `${NAME}'s subject is the private corpus, so needsPrivate must be true`);
  assert.equal(row.speed, 'fast', `${NAME} is a schema validation over eight files; it belongs in the pre-commit set`);

  // MUTANT — the same predicate over a copy with the row deleted MUST fail.
  const mutantRows = rowsOf(guardsTable(withoutRow(SOURCE, NAME)));
  assert.equal(mutantRows.find((r) => r.name === NAME), undefined, 'the mutant still finds the row — this assertion cannot fail and is worse than none');
});

test('the runner names the guard by a corpus-relative path that a locate() candidate can join', () => {
  const NAME = 'assert-platform-state';
  const table = guardsTable(SOURCE);
  const at = table.indexOf(`{ name: '${NAME}'`);
  assert.notEqual(at, -1, `${NAME} row not found`);
  const entry = table.slice(at, at + 400);
  assert.match(
    entry,
    /rel:\s*\[\s*'requirements\/tooling\/assert-platform-state\.mjs'/,
    'the rel candidate must be corpus-relative and un-prefixed; `locate()` joins it onto the resolved corpus root, and an absolute or repo-relative spelling resolves nowhere',
  );

  // MUTANT — a rel list that no longer names the guard must be caught.
  const mutant = entry.replace('requirements/tooling/assert-platform-state.mjs', 'requirements/tooling/does-not-exist.mjs');
  assert.doesNotMatch(mutant, /rel:\s*\[\s*'requirements\/tooling\/assert-platform-state\.mjs'/, 'the mutant still matches — the pattern is not reading the rel list');
});
