// ─────────────────────────────────────────────────────────────────────────────
// agent-docs.test.mjs — tooling/scripts/check-agent-docs.mjs must be able to
// fail, must be able NOT to, and must fail LOUDLY the day its limbs promote.
//
// 🔴 WHY THIS FILE EXISTS AT ALL, and it is the same reason its sibling
// selection-record.test.mjs exists. The guard landed on 2026-09-08 in commit
// 9b4cd308 and `git grep -n check-agent-docs` returned nothing but the baseline
// file it writes itself: no workflow, no hook, no `enforcement-index` row, no
// test. All five of its limbs are in `CONFIG.warnLimbs` with
// `promoteOn: 2026-09-22`, so on that date somebody moves a limb id out of that
// array and the guard starts FAILING BUILDS — a guard that has never run in CI.
//
// That is the sequence this corpus keeps paying for: a guard nobody wired is a
// guard nobody trusts on the day it first goes red, and the cheapest response to
// a red guard nobody trusts is to unwire it again. The repair is a CI step and a
// test, not a deletion, and the two have to land together — `assert-guard-coverage`
// requires that a workflow-invoked script outside `tooling/ci/` be EXERCISED by a
// test file (spawned or imported), or `guard-meta` goes red naming it.
//
// ⚠️ THE FIXTURE IS A REAL GIT REPOSITORY, and it has to be. The guard reads the
// INDEX and never the working directory — `git ls-files --cached -s` then
// `git cat-file --batch` — which is a deliberate choice recorded in its header
// (a concurrent writer's untracked file must not redden another writer's commit).
// A fixture that wrote files without committing them would be testing a program
// that does not exist. It also resolves its own root by walking `CONFIG.rootUp`
// from its own location and refuses a tree missing any of `CONFIG.sentinels`, so
// the copy under test lives at `<fixture>/tooling/scripts/`.
//
// ⚠️ AND THE FIXTURE IS BIG ON PURPOSE. `CONFIG.floors` demands 1000 tracked
// files, 800 text blobs and 200 directory chains before the guard will call any
// run evidence. A smaller fixture would exercise nothing but the COVERAGE LOST
// branch — which is case 5 below, and is worth exactly one case rather than all
// of them.
//
// THE CASE THAT MATTERS MOST is D1: an over-cap doc, read by the guard as
// shipped, exits 1 with `FAIL`; read by the guard with that limb id put BACK into
// `warnLimbs`, the same tree exits 0 with `WARN`. The five limbs were promoted
// together (O-PUBLIC-DOCS-HAND-WRITTEN-FACTS), and the demoted mutant is the
// guard as it stood before that, so the pair proves the promotion is what bites.
//
// Run:  node --test "tooling/ci/test/agent-docs.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spiedRun, racyOn } from './fixtures/fs-spy-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD_SRC = resolve(REPO, 'tooling', 'scripts', 'check-agent-docs.mjs');
const GUARD_REL = 'tooling/scripts/check-agent-docs.mjs';

/** The guard's own declared floors and limb ids, READ from the source rather than
 *  typed here. A fixture built below a floor would exercise the refusal branch
 *  while this file reported it as a finding, and a limb id typed twice is a limb
 *  id that drifts. */
function config() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const open = src.indexOf('const CONFIG = {');
  assert.notEqual(open, -1, 'check-agent-docs.mjs no longer declares `const CONFIG = {` — this file is reading the wrong thing');
  const close = src.indexOf('\n};', open);
  assert.notEqual(close, -1, 'the CONFIG object is not terminated by a line `};`');
  const json = src.slice(open + 'const CONFIG = '.length, close + 2);
  /* CONFIG is written as pure JSON on purpose (its own header says it is
     generated, never typed), so it parses without evaluating the guard. */
  return JSON.parse(json);
}
const CONFIG = config();
const FLOORS = CONFIG.floors;

let BASE, ROOT;

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

/** Run a guard file inside the fixture. The six redirecting git variables are
 *  stripped for the reason `repo-git.mjs` records at length: git EXPORTS them
 *  into every hook process and they BEAT `-C`, so a guard spawned from inside a
 *  commit would read the committing repository's index instead of this one's. */
function run(file = 'check-agent-docs.mjs', ...argv) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(ROOT, 'tooling', 'scripts', file), ...argv], { cwd: ROOT, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** The guard with one limb id put BACK into `warnLimbs` — the promotion undone,
 *  which is the guard as it stood before O-PUBLIC-DOCS-HAND-WRITTEN-FACTS. The
 *  shipped guard declares the array empty; a guard that stopped declaring it
 *  would leave this file no mutant to build, so that is asserted, not assumed. */
function writeDemotedMutant(limb) {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const from = '  "warnLimbs": [],';
  assert.ok(src.includes(from), 'check-agent-docs.mjs no longer declares an empty `"warnLimbs": [],` — this file cannot build its demoted mutant');
  assert.ok(CONFIG.warnLimbs.length === 0, `warnLimbs is not empty (${CONFIG.warnLimbs.join(', ')}), so a limb has been demoted again`);
  const mutant = src.replace(from, `  "warnLimbs": ["${limb}"],`);
  assert.notEqual(mutant, src, 'the mutation changed nothing');
  writeFileSync(join(ROOT, 'tooling', 'scripts', `mutant-demoted-${limb}.mjs`), mutant, 'utf8');
}

/** The root AGENTS.md byte cap, READ from the guard rather than typed here — it
 *  was cut 12288 -> 8192 on 2026-09-08 and a number typed in two places is a
 *  number that drifts. The regex is anchored on the isRoot branch of `capFor`. */
function rootAgentsCaps() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const m = src.match(/isRoot \? \{ lines: (\d+), bytes: (\d+) \* 1024 \}/);
  assert.ok(m, 'check-agent-docs.mjs no longer declares the root AGENTS.md cap in the shape this file reads');
  return { lines: Number(m[1]), bytes: Number(m[2]) * 1024 };
}
const ROOT_AGENTS_CAP = rootAgentsCaps();

/** The START-HERE.md caps, read the same way and for the same reason. */
function startHereCaps() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const m = src.match(/path === 'START-HERE\.md'\) return \{ lines: (\d+), bytes: (\d+) \* 1024 \}/);
  assert.ok(m, 'check-agent-docs.mjs no longer declares a START-HERE.md cap');
  return { lines: Number(m[1]), bytes: Number(m[2]) * 1024 };
}
const START_HERE_CAP = startHereCaps();

/** A root AGENTS.md over the BYTE cap and UNDER the line cap, so a case using it
 *  produces exactly ONE finding. Written few-long-lines rather than
 *  many-short-lines on purpose: `capFor` grades AGENTS.md on lines AND bytes, and
 *  a doc that breaks both records TWO findings for one limb+path — which would
 *  make the counts in the baseline case read as a bug rather than as two real
 *  findings. `lines` therefore stays under the LINE cap while the width carries
 *  it over the BYTE cap, both read off the guard. */
function overByteCap(lines = ROOT_AGENTS_CAP.lines - 10) {
  const width = Math.ceil(ROOT_AGENTS_CAP.bytes / lines) + 20;
  return `# ${'x'.repeat(width)}\n`.repeat(lines);
}

/** Stage a tracked file for one case and take it out again. TRACKED, because the
 *  guard's subject is the index: an untracked file is invisible to it by design. */
function withTracked(rel, body, fn) {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  git(ROOT, 'add', '--', rel);
  try {
    assert.ok(git(ROOT, 'ls-files', '--', rel).includes(rel), 'the file is not in the fixture index, so the guard will never see it');
    return fn();
  } finally {
    git(ROOT, 'rm', '-q', '-f', '--cached', '--', rel);
    rmSync(abs, { force: true });
  }
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-agentdocs-'));
  ROOT = join(BASE, 'Fixture_Public');

  /* The three sentinels the guard refuses without, and a root AGENTS.md that is
     comfortably UNDER every cap so the clean case is genuinely clean. */
  mkdirSync(join(ROOT, 'apps'), { recursive: true });
  mkdirSync(join(ROOT, 'tooling', 'scripts'), { recursive: true });
  writeFileSync(join(ROOT, 'AGENTS.md'), '# fixture agents card\n\nSmall on purpose.\n');
  writeFileSync(join(ROOT, 'apps', 'placeholder.md'), 'fixture app tree\n');

  /* Enough tree to clear every floor: directory chains for `budgetChecked`,
     `.md` blobs for `bomScanned`, and files for `trackedFiles`. Derived from the
     floors read out of the guard, never from numbers typed here. */
  const dirs = Math.max(FLOORS.budgetChecked + 10, 1);
  const perDir = Math.max(Math.ceil((FLOORS.trackedFiles + 20) / dirs), Math.ceil((FLOORS.bomScanned + 20) / dirs), 1);
  let written = 0;
  for (let d = 0; d < dirs; d += 1) {
    const dir = join(ROOT, 'filler', `d-${d}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < perDir; i += 1) { writeFileSync(join(dir, `f-${i}.md`), `filler ${d}/${i}\n`); written += 1; }
  }

  git(ROOT, 'init', '-q');
  git(ROOT, 'config', 'user.email', 'fixture@example.test');
  git(ROOT, 'config', 'user.name', 'fixture');
  git(ROOT, 'config', 'commit.gpgsign', 'false');
  git(ROOT, 'add', '-A');
  git(ROOT, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* Copied in AFTER the commit and left UNTRACKED — the guard's subject is the
     index, so an untracked copy is not part of its own subject. */
  cpSync(GUARD_SRC, join(ROOT, 'tooling', 'scripts', 'check-agent-docs.mjs'));
  writeDemotedMutant('A-SIZE');

  assert.ok(written >= FLOORS.trackedFiles, `the fixture wrote ${written} filler file(s), below the guard's own trackedFiles floor of ${FLOORS.trackedFiles}`);
});

after(() => { rmSync(BASE, { recursive: true, force: true }); });

test('a clean tree over every floor is exit 0, and says what it measured', () => {
  const r = run();
  assert.equal(r.code, 0, `a clean fixture must pass: ${r.out}`);
  assert.match(r.out, /ok {2}no new finding/);
  /* The counts are printed, not implied — a guard that says "ok" without saying
     what it read is the vacuous pass this corpus refuses. */
  assert.match(r.out, /scanned: \d+ tracked file\(s\), \d+ instruction doc\(s\), \d+ text blob\(s\), \d+ directory chain\(s\)/);
});

test('limb A-SIZE bites: an over-cap root AGENTS.md is reported', () => {
  const before = run();
  assert.equal(before.code, 0, `green control first, or the case below proves nothing: ${before.out}`);
  assert.doesNotMatch(before.out, /A-SIZE/);

  const abs = join(ROOT, 'AGENTS.md');
  const keep = readFileSync(abs, 'utf8');
  writeFileSync(abs, overByteCap());
  git(ROOT, 'add', '--', 'AGENTS.md');
  try {
    const r = run();
    assert.equal(r.code, 1, `an over-cap doc on a promoted limb must exit 1: ${r.out}`);
    assert.match(r.out, /FAIL A-SIZE AGENTS\.md/, `the over-cap doc must be named: ${r.out}`);
    assert.match(r.out, new RegExp(`cap ${ROOT_AGENTS_CAP.bytes}`), `the finding must state the cap it broke: ${r.out}`);
    assert.equal((r.out.match(/A-SIZE AGENTS\.md/g) ?? []).length, 1, `one over-cap dimension must produce exactly one finding, or the baseline counts below are measuring the wrong thing: ${r.out}`);
  } finally {
    writeFileSync(abs, keep);
    git(ROOT, 'add', '--', 'AGENTS.md');
  }
  const after = run();
  assert.equal(after.code, 0, `restored, the fixture must be green again: ${after.out}`);
});

test('D1 — THE PROMOTION: a doc over its cap exits 1, and the same tree on the demoted guard exits 0', () => {
  const abs = join(ROOT, 'AGENTS.md');
  const keep = readFileSync(abs, 'utf8');
  writeFileSync(abs, overByteCap());
  git(ROOT, 'add', '--', 'AGENTS.md');
  try {
    /* As shipped: every limb is promoted, so the finding fails the run. */
    const failed = run();
    assert.equal(failed.code, 1, `a doc over its cap must exit 1 on the guard as shipped: ${failed.out}`);
    assert.match(failed.out, /FAIL A-SIZE AGENTS\.md/);
    assert.match(failed.out, /new finding\(s\) on a promoted limb/);

    /* Demoted — the limb id put back into warnLimbs, which is the guard before the
       promotion. The finding is the same finding; only the verdict moves, so the
       exit 1 above is the promotion's doing and nothing else's. */
    const warn = run('mutant-demoted-A-SIZE.mjs');
    assert.equal(warn.code, 0, `the same tree with A-SIZE demoted must exit 0 by design: ${warn.out}`);
    assert.match(warn.out, /WARN A-SIZE AGENTS\.md/);
    assert.match(warn.out, /still a WARNING, so this run exits 0 by design/);
  } finally {
    writeFileSync(abs, keep);
    git(ROOT, 'add', '--', 'AGENTS.md');
  }
  assert.equal(run().code, 0, 'the fixture must be green again after the case');
});

test('the START-HERE.md cap bites, and it is a SEPARATE cap from AGENTS.md', () => {
  /* Added 2026-09-08 with the card itself. `gen-start-here.mjs --check` already
     refuses a HAND edit; it cannot refuse a card that grew legitimately through
     the generator, and a 30 KiB generated card is exactly as expensive to read as
     a 30 KiB typed one. So the size question is asked here, of the index, by the
     same limb that asks it of AGENTS.md.

     GREEN CONTROL FIRST, and it matters more than usual: the fixture has no
     START-HERE.md at all, so a `capFor` that did not match the path would produce
     the same silence as a cap that was never broken. */
  const before = run();
  assert.equal(before.code, 0, `green control first, or the case below proves nothing: ${before.out}`);
  assert.doesNotMatch(before.out, /START-HERE/);

  const lines = START_HERE_CAP.lines - 10;
  const width = Math.ceil(START_HERE_CAP.bytes / lines) + 20;
  withTracked('START-HERE.md', `# ${'x'.repeat(width)}\n`.repeat(lines), () => {
    const r = run();
    /* The cap FAILS a build, not only prints. */
    assert.equal(r.code, 1, `the START-HERE.md cap must be able to FAIL, not only warn: ${r.out}`);
    assert.match(r.out, /FAIL A-SIZE START-HERE\.md/, `the over-cap card must be named: ${r.out}`);
    assert.match(r.out, new RegExp(`cap ${START_HERE_CAP.bytes}`), `the finding must state the cap it broke: ${r.out}`);
    assert.equal((r.out.match(/A-SIZE START-HERE\.md/g) ?? []).length, 1, `one over-cap dimension must produce exactly one finding: ${r.out}`);
  });
  assert.equal(run().code, 0, 'the fixture must be green again after the case');
});

test('a START-HERE.md UNDER the cap is not a finding — the cap is a ceiling, not a shape check', () => {
  withTracked('START-HERE.md', `# START HERE\n\n${'small on purpose. '.repeat(20)}\n`, () => {
    const r = run();
    assert.equal(r.code, 0, `an under-cap card must be clean: ${r.out}`);
    assert.doesNotMatch(r.out, /A-SIZE START-HERE/, `an under-cap card must produce no finding: ${r.out}`);
  });
});

test('the generator is WIRED too — a workflow runs gen-start-here.mjs --check', () => {
  /* Same defect, same repair as the case at the foot of this file. A generated
     card whose `--check` runs nowhere is a card that can be hand-edited and stay
     hand-edited, which is the failure mode the generator exists to prevent. */
  const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(
    ci.includes('tooling/scripts/gen-start-here.mjs') && ci.includes('--check'),
    'no workflow runs `gen-start-here.mjs --check`, so START-HERE.md can drift from the tree it claims to measure',
  );
});

test('limb A-BOM bites: a UTF-8 BOM on a tracked text blob is reported', () => {
  assert.equal(run().code, 0, 'green control first');
  withTracked('filler/bommed.md', '﻿# a doc with a byte order mark\n', () => {
    const r = run();
    assert.equal(r.code, 1, `a BOM on a promoted limb must exit 1: ${r.out}`);
    assert.match(r.out, /FAIL A-BOM filler\/bommed\.md/, `the BOM'd file must be named: ${r.out}`);
  });
  assert.equal(run().code, 0, 'the fixture must be green again after the case');
});

test('--write-baseline writes the baseline without a separate look at its path first (CodeQL #271)', () => {
  const bp = join(ROOT, '.agentdocs.baseline.json');
  let had = null;
  try { had = readFileSync(bp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  try {
    const { code, text, verdict } = spiedRun([join(ROOT, 'tooling', 'scripts', 'check-agent-docs.mjs'), '--write-baseline'], { cwd: ROOT, under: ROOT, env });
    assert.equal(code, 0, text);
    assert.ok(verdict.uses.some((u) => u.endsWith('/.agentdocs.baseline.json')), 'the baseline was never written');
    assert.deepEqual(racyOn(verdict, '/.agentdocs.baseline.json'), []);
  } finally {
    if (had === null) rmSync(bp, { force: true });
    else writeFileSync(bp, had);
  }
});

test('a tree under the floors is COVERAGE LOST — exit 2, never a pass', () => {
  const thin = join(BASE, 'Thin_Public');
  mkdirSync(join(thin, 'apps'), { recursive: true });
  mkdirSync(join(thin, 'tooling', 'scripts'), { recursive: true });
  writeFileSync(join(thin, 'AGENTS.md'), '# tiny\n');
  git(thin, 'init', '-q');
  git(thin, 'config', 'user.email', 'fixture@example.test');
  git(thin, 'config', 'user.name', 'fixture');
  git(thin, 'config', 'commit.gpgsign', 'false');
  git(thin, 'add', '-A');
  git(thin, 'commit', '-q', '-m', 'thin', '--no-gpg-sign');
  cpSync(GUARD_SRC, join(thin, 'tooling', 'scripts', 'check-agent-docs.mjs'));

  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(thin, 'tooling', 'scripts', 'check-agent-docs.mjs')], { cwd: thin, env, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 2, `a tree with no subject in it must REFUSE, not pass: ${out}`);
  assert.match(out, /COVERAGE LOST/);
  assert.match(out, /trackedFiles \d+ < \d+/, `the refusal must name the floor it missed and by how much: ${out}`);
});

test('the baseline freezes a finding, and freezing is per limb+path rather than per message', () => {
  const abs = join(ROOT, 'AGENTS.md');
  const keep = readFileSync(abs, 'utf8');
  writeFileSync(abs, overByteCap());
  git(ROOT, 'add', '--', 'AGENTS.md');
  try {
    /* Freeze it, then GROW the same file. The finding's message changes; its
       limb+path key does not; and the run stays green. That asymmetry is the
       whole design of the baseline, and a test that only froze and re-ran would
       not have measured it. */
    const wrote = run('check-agent-docs.mjs', '--write-baseline');
    assert.equal(wrote.code, 0, `--write-baseline must succeed: ${wrote.out}`);
    assert.match(wrote.out, /wrote .*\.agentdocs\.baseline\.json with 1 frozen finding\(s\)/);

    writeFileSync(abs, overByteCap(170));
    git(ROOT, 'add', '--', 'AGENTS.md');
    const r = run();
    assert.equal(r.code, 0, `a baselined finding must not fail the run: ${r.out}`);
    assert.match(r.out, /BASELINE A-SIZE AGENTS\.md/);
    assert.doesNotMatch(r.out, /(WARN|FAIL) A-SIZE/, 'a frozen finding must not also be reported as new');
    /* `r` is the guard as shipped, with A-SIZE promoted: a frozen finding stays
       frozen on a promoted limb, or the baseline would be a warning-only courtesy
       rather than the record it claims to be. */
  } finally {
    rmSync(join(ROOT, '.agentdocs.baseline.json'), { force: true });
    writeFileSync(abs, keep);
    git(ROOT, 'add', '--', 'AGENTS.md');
  }
  assert.equal(run().code, 0, 'the fixture must be green again after the case');
});

test('the guard is WIRED — a workflow actually invokes it', () => {
  /* The defect this whole file was written for. On 2026-09-08 this assertion
     would have failed: the guard existed and nothing ran it. Reading the
     workflows rather than a register, because the register is DERIVED from
     them — asking the derived artefact would be asking the same source twice. */
  const wf = join(REPO, '.github', 'workflows');
  const hits = [];
  for (const f of ['ci.yml']) {
    const p = join(wf, f);
    if (!existsSync(p)) continue;
    if (readFileSync(p, 'utf8').includes(GUARD_REL)) hits.push(f);
  }
  assert.ok(hits.length > 0, `no workflow invokes ${GUARD_REL}. A guard nobody runs is a guard that is not enforcing anything, and its promoted limbs would fail nothing.`);
});

test('the fixture guard file is the committed one, byte for byte', () => {
  assert.equal(
    readFileSync(join(ROOT, 'tooling', 'scripts', 'check-agent-docs.mjs'), 'utf8'),
    readFileSync(GUARD_SRC, 'utf8'),
    'the copy under test has drifted from the guard in the tree, so every case above is about a file nothing ships',
  );
});
