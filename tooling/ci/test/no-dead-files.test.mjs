// ─────────────────────────────────────────────────────────────────────────────
// no-dead-files.test.mjs — tooling/scripts/assert-no-dead-files.mjs must be able
// to FAIL, and the four ways it fails must be four different ways.
//
// 🔴 WHY THIS FILE EXISTS, AND WHY IT IS NOT A FIXTURE SUITE.
// `assert-guard-coverage.mjs:717-751` derives its subject set from the workflows:
// the moment ci.yml's `No dead tracked files` step landed, this guard acquired a
// requirement for a test file naming it. The cheapest way to satisfy that check
// is a single `test('…', () => assert.ok(true))` — measured 2026-08-17, it goes
// GREEN and the ratchet records it. That is an assertion that cannot fail, which
// this repo deletes on sight, and it would have bought a coverage line over
// nothing.
//
// So every case below MUTATES A REAL-TREE COPY. Not a hand-built fixture:
// `assert-seams-wired.mjs` shipped with its caller check matching the function's
// own declaration, and ALL SIX of its fixture tests passed against the broken
// version, because a fixture you write encodes the same misunderstanding as the
// guard you write. The scoping pass for this very guard made the same error one
// scale up — it emptied every subject tree at once, which made two guards refuse
// for the wrong reason and hid a real defect inside the "proven safe" column.
//
// ── THE COPY, AND WHY IT IS THE WORKING TREE RATHER THAN `git archive HEAD` ───
// The guard resolves its own root as `resolve(HERE,'..','..')`, so a copy laid
// out at `<tmp>/tooling/scripts/assert-no-dead-files.mjs` makes `<tmp>` the root
// and needs no argument the guard does not have. `git archive HEAD` would have
// been one command, and it answers about the LAST COMMIT — so a session editing
// the guard would be testing the previous version of it while believing
// otherwise. The copy is built from `git ls-files` + the working-tree bodies,
// which is exactly the pair the guard itself reads.
//
// ── 🔴 THE TRAP THIS FILE IS ITSELF INSIDE ───────────────────────────────────
// This test file is COPIED INTO THE TREE IT MUTATES, and the guard counts prose
// in any tracked file as a reference. So a path literal written here is a real
// reference there:
//
//   · the throwaway path in `unreachable()` must NOT appear literally in any
//     tracked file, or `unique-name` resolves it from THIS FILE and the negative
//     test quietly stops being negative. It is a random UUID for that reason,
//     composed at run time and never written down.
//   · the waived and canary victims are READ OUT OF THE GUARD'S OWN SOURCE
//     rather than named here. Naming one would attach a `path-reference` to it
//     on the real tree and print a permanent stale-permission note on every CI
//     run — the test degrading the thing it tests. It also means the table can
//     change without this file rotting.
//
// ── THE POSITIVE CONTROL IS NOT OPTIONAL ─────────────────────────────────────
// `assert-seams-wired`'s lesson has a second half: a compile error looks exactly
// like a caught mutation. Four "it failed!" results prove nothing unless the
// UNMUTATED copy is known to pass, so `the copy is a faithful subject` runs
// first and pins the copy's verdict AND its path count to the real tree's.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD_REL = 'tooling/scripts/assert-no-dead-files.mjs';
const GUARD = join(REPO, GUARD_REL);

/** `git -c core.longpaths=true` throughout: the mason brick templates under
 *  tooling/bricks/ exceed 260 characters and CLAUDE.md records that the repo
 *  only works with this set. The temp root is SHORTER than the repo root here,
 *  so the copy itself is safe, but `git add` still has to index those names. */
const git = (cwd, args) =>
  spawnSync('git', ['-c', 'core.longpaths=true', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

const runGuard = (root) => {
  const r = spawnSync(process.execPath, [join(root, GUARD_REL)], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** Every `path: '…'` inside a named array literal in the guard's source. This is
 *  how the victims below are chosen without writing a real path into this file.
 *  It is deliberately brittle in ONE direction: if the guard stops declaring its
 *  tables this way the slice comes back empty and the `before` hook throws,
 *  which is a loud stop rather than a suite that silently tests nothing. */
function pathsIn(source, arrayName) {
  const start = source.indexOf(`const ${arrayName} = [`);
  assert.notEqual(start, -1, `${arrayName} not found in ${GUARD_REL} — this test can no longer choose a victim`);
  const end = source.indexOf('\n];', start);
  assert.notEqual(end, -1, `${arrayName} is not terminated in ${GUARD_REL}`);
  const block = source.slice(start, end);
  return [...block.matchAll(/^\s*path: '([^']+)',$/gm)].map((m) => m[1]);
}

let TMP;
let COPY;
let realVerdict;
let waivedVictim;
let canaryVictim;

before(() => {
  const src = readFileSync(GUARD, 'utf8');

  // A waived path whose row is a plain waiver, and a path a NEGATIVE canary
  // names. They must be different files or the two mutations below would be one.
  const waived = pathsIn(src, 'EXEMPTIONS');
  const canaries = pathsIn(src, 'CANARIES');
  assert.ok(waived.length > 0, 'EXEMPTIONS declares no rows, so the dangling-waiver limb has no subject');
  assert.ok(canaries.length > 0, 'CANARIES declares no rows, so the canary limb has no subject');
  waivedVictim = waived.find((p) => existsSync(join(REPO, p)));
  canaryVictim = canaries.find((p) => existsSync(join(REPO, p)) && !waived.includes(p));
  assert.ok(waivedVictim, 'no waived path is on disk');
  assert.ok(canaryVictim, 'no canary path is on disk');

  realVerdict = runGuard(REPO);

  TMP = mkdtempSync(join(tmpdir(), 'nikatru-dead-'));
  COPY = join(TMP, 't');
  mkdirSync(COPY, { recursive: true });

  // The subject is the MANIFEST, same as the guard's own doctrine: a disk walk
  // would descend into build/, node_modules/ and any nested agent checkout, none
  // of which this repo publishes. Paths in the index but not on disk (a staged
  // deletion) are skipped — they are not copyable, and the guard treats them as
  // subjects that resolve on what other files say, which the copy reproduces.
  const ls = git(REPO, ['ls-files', '-z']);
  assert.equal(ls.status, 0, `git ls-files failed in ${REPO}: ${ls.stderr}`);
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const from = join(REPO, rel);
    if (!existsSync(from)) continue;
    const to = join(COPY, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }

  assert.equal(git(COPY, ['init', '-q']).status, 0, 'git init failed in the copy');
  // `-f` is load-bearing. The copy carries the repo's own .gitignore, and in a
  // FRESH repo an ignore rule wins over a path that is merely present — so a
  // tracked-but-ignored file (git tracks those fine upstream) would silently
  // drop out of the copy's manifest and shrink the subject.
  assert.equal(git(COPY, ['add', '-A', '-f']).status, 0, 'git add failed in the copy');
});

after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** Run one mutation against the copy and put the copy back afterwards, so the
 *  cases stay independent and order-free. */
function mutate(apply, undo) {
  apply();
  try {
    return runGuard(COPY);
  } finally {
    undo();
  }
}

const stage = (rel) => assert.equal(git(COPY, ['add', '-f', '--', rel]).status, 0, `git add ${rel} failed`);
const unstage = (rel) => assert.equal(git(COPY, ['rm', '-q', '--cached', '--', rel]).status, 0, `git rm --cached ${rel} failed`);

describe('the copy is a faithful subject — the positive control every mutation below rests on', () => {
  test('🔴 the UNMUTATED copy passes, and agrees with the real tree path-for-path', () => {
    const { code, out } = runGuard(COPY);
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no dead tracked files/);

    // Without this, "the mutation failed" could mean the harness is broken —
    // a missing file, a bad copy, git refusing an ignored path — and four green
    // failures would prove nothing at all.
    const count = (t) => Number((t.match(/(\d+) path\(s\) checked/) ?? [])[1]);
    assert.equal(realVerdict.code, 0, `the REAL tree is not green, so the copy cannot be compared to it:\n${realVerdict.out}`);
    assert.equal(count(out), count(realVerdict.out), `copy saw ${count(out)} path(s), real tree ${count(realVerdict.out)}`);
  });
});

describe('a NEW tracked file nothing reaches is a finding — the case the guard exists for', () => {
  test('🔴 exit 1, and it names the path', () => {
    // Directly under tooling/: not inside any RUNNER_WALKS root (only
    // tooling/bricks/ and tooling/content_pipeline/examples/ are conceded), not
    // a TOOL_CONVENTION basename, and a UUID no tracked file writes — so no
    // resolver can reach it and no waiver covers it. The name is composed here
    // and never appears as a literal, because this file is copied INTO the tree
    // and a literal would resolve it by `unique-name` from this very line.
    const rel = `tooling/${randomUUID()}.txt`;
    const abs = join(COPY, rel);
    const { code, out } = mutate(
      () => {
        writeFileSync(abs, 'throwaway\n');
        stage(rel);
      },
      () => {
        unstage(rel);
        rmSync(abs, { force: true });
      },
    );
    assert.equal(code, 1, out);
    assert.match(out, /no resolver reaches it and no exemption waives it/);
    assert.ok(out.includes(rel), `the finding does not name ${rel}:\n${out}`);
  });

  test('and the same file inside a conceded runner tree is NOT a finding — the guard is not a file counter', () => {
    // The mirror image, and it is what stops the case above from passing for the
    // trivial reason that any new file fails. `sites/*` is walked wholesale by
    // the Cloudflare deploy, so a member of it needs no reference at all.
    const rel = `sites/nikatru/${randomUUID()}.txt`;
    const abs = join(COPY, rel);
    const { code, out } = mutate(
      () => {
        writeFileSync(abs, 'throwaway\n');
        stage(rel);
      },
      () => {
        unstage(rel);
        rmSync(abs, { force: true });
      },
    );
    assert.equal(code, 0, out);
  });
});

describe('a waiver must not outlive the thing it waived', () => {
  test('🔴 deleting a WAIVED file without deleting its row is exit 1, not a quiet pass', () => {
    const abs = join(COPY, waivedVictim);
    const { code, out } = mutate(
      () => {
        unstage(waivedVictim);
        rmSync(abs, { force: true });
      },
      () => {
        mkdirSync(dirname(abs), { recursive: true });
        copyFileSync(join(REPO, waivedVictim), abs);
        stage(waivedVictim);
      },
    );
    assert.equal(code, 1, out);
    assert.match(out, /which is neither tracked nor on disk/);
    assert.ok(out.includes(waivedVictim), `the finding does not name ${waivedVictim}:\n${out}`);
  });
});

describe('the floors — a scan that stopped scanning must refuse, not report clean', () => {
  test('🔴 losing a CANARY subject is COVERAGE LOST (exit 2), a different verdict from a finding', () => {
    // Exit 2 rather than 1 is the whole point: "a limb of the scan changed
    // behaviour" is not the same claim as "this tree has a dead file", and the
    // guard's own exit table distinguishes them.
    const abs = join(COPY, canaryVictim);
    const { code, out } = mutate(
      () => {
        unstage(canaryVictim);
        rmSync(abs, { force: true });
      },
      () => {
        mkdirSync(dirname(abs), { recursive: true });
        copyFileSync(join(REPO, canaryVictim), abs);
        stage(canaryVictim);
      },
    );
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /canary\(ies\) failed/);
  });

  test('🔴 an EMPTY manifest is COVERAGE LOST, not "no dead files found"', () => {
    // The vacuous pass this guard exists to eliminate, applied to itself: a
    // guard pointed at nothing finds nothing wrong. F1 is the floor that makes
    // "clean" mean something, and the input that fails it is a repo holding
    // only the guard.
    const bare = join(TMP, 'bare');
    mkdirSync(join(bare, 'tooling', 'scripts'), { recursive: true });
    copyFileSync(GUARD, join(bare, GUARD_REL));
    assert.equal(git(bare, ['init', '-q']).status, 0, 'git init failed in the bare root');
    assert.equal(git(bare, ['add', '-A', '-f']).status, 0, 'git add failed in the bare root');
    const { code, out } = runGuard(bare);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /returned \d+ path\(s\); the floor is \d+/);
  });
});

describe('the CI wiring itself', () => {
  test('🔴 a workflow really invokes it — the guard is a merge gate, not a hand-run tool', () => {
    // The reason its self-waiver row could be deleted. If the ci.yml step is
    // ever removed, the guard becomes unreachable in its own scan and reports
    // ITSELF as dead — but that failure would be cryptic, so the wiring is
    // asserted here in the terms a reader can act on.
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    assert.ok(
      wf.includes(`node ${GUARD_REL}`),
      'ci.yml no longer runs assert-no-dead-files.mjs — restore the step, or re-add its EXEMPTIONS row in the same change',
    );
  });
});
