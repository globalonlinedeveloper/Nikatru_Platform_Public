// ─────────────────────────────────────────────────────────────────────────────
// github-matrix.test.mjs — assert-github-matrix.mjs must be able to FAIL, to
// REFUSE, and to say "I did not look". Three different things, three exit codes,
// and the whole value of the guard is that they never collapse into each other.
//
// 🔴 WHY THIS FILE EXISTS AT ALL, AND WHY IT WAS MISSING. The guard landed on
// 2026-08-18 wired into no workflow, because no invocation available to a CI
// runner can make it exit 0 (it needs a `gh` authenticated against the ORG).
// assert-guard-coverage.mjs's R2 reported it as unreached — correctly — and the
// repair was NOT_CI_RUNNABLE, an exemption whose claim is re-run on every pass.
// But R2 is only half of [pipeline F-10]: an unwired guard still owes a RECORDED
// FAILING CASE, and being hard to run in CI is not a reason to have none. It had
// none. This is it.
//
// 🔴 THE SEAM IS `--gh-fixture`, AND IT IS THE ONLY HONEST WAY TO REACH THE
// FLOORS. The two limbs most worth testing — an EMPTY org listing and a
// TRUNCATED one — are exactly the two `gh` will never produce on demand, and
// they are the two that would otherwise pass VACUOUSLY: an empty listing agrees
// with every `existsOnGitHub: false`, orphans no repo, and prints ok having
// verified nothing. A lapsed token returns precisely that, successfully. So the
// fixture seam is not a convenience, it is the only input that can prove the
// floor fires.
//
// ⚠️ AND THE SEAM CARRIES ITS OWN SAFETY PROPERTY, WHICH IS ITSELF TESTED BELOW:
// a `--gh-fixture` run NEVER exits 0 — not on success, not on a clean fixture.
// A test seam able to produce the same exit code as a passing real run is a way
// to fake a passing real run. `T_CLEAN_NEVER_ZERO` is that case.
//
// 🔴 EXPECTATIONS ARE DERIVED FROM catalog/store-matrix.json, NEVER TYPED. The
// clean-listing fixture is BUILT from the registry at run time — the repos it
// declares as existing, at the visibility it declares, plus every outOfMatrix
// line. A typed listing would go red the day a row is added, for a reason having
// nothing to do with the behaviour under test; that is the failure copy-parity's
// own header records against a re-typed "1 of 1" that killed nineteen cases.
//
// Exit codes under test:  0 clean real run (unreachable here, by design)
//                         1 FINDINGS · 2 REFUSED / could not look
//                         3 --offline · 4 --gh-fixture (never a pass)
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// 2026-08-21: the LIMB 1b cases below assert on the guard's CODE, not on its prose — this file's
// subject is a defect that was prose satisfying a code rule, so a case that could itself be
// satisfied by a comment would be the same mistake one level up. The derivation of the guard's
// SIBLING IMPORTS — ONE derivation, `GUARD_SIBLINGS`, deliberately not two, so the plants cannot
// drift — reads the stripped source for the same reason: a commented-out or quoted `import`
// line in the guard would otherwise inject a phantom sibling and make copyFileSync throw ENOENT,
// which reads exactly like the case under test failing.
// ⚠️ THIS LINE FIRST IMPORTED A SECOND, SESSION-LOCAL STRIPPER MODULE, since DELETED and not named
// here because a comment naming a module that does not exist is worse than no comment.
// text-reductions.mjs is this corpus's one shared stripper and has been since 2026-08-02.
// `stripSourceComments` blanks comments only; `stripStringLiterals` is the separate composable tool,
// used below ONLY to prove what would break if the guard ever reached for it.
import { stripSourceComments, stripStringLiterals } from '../text-reductions.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-github-matrix.mjs');
const REGISTRY = join(REPO, 'catalog', 'store-matrix.json');

/** The guard's in-tree sibling imports, DERIVED from its source rather than typed. Two cases below
 *  plant a hermetic copy of the guard and need every one of these beside it, or node dies at MODULE
 *  RESOLUTION before a line of the guard runs.
 *
 *  🔴 IT READS THE STRIPPED SOURCE, and that is the same rule the cases themselves are about. Both
 *  derivations used to run over RAW guard text, so a commented-out or quoted `import` line would have
 *  injected a phantom sibling and made copyFileSync throw ENOENT — a failure that reads exactly like
 *  the case under test failing. Derived ONCE here rather than twice, so the two plants cannot drift.
 *  ⚠️ KNOWN NARROWNESS, stated rather than left to be discovered: this matches only a single-line
 *  `'./name.mjs'` with SINGLE quotes at the start of a line. A double-quoted import, or one naming a
 *  subdirectory, is silently missed and comes back as ERR_MODULE_NOT_FOUND in the planting cases.
 *  As of 2026-08-21 the guard has exactly two, both in that form: tree-walk.mjs, text-reductions.mjs. */
const GUARD_SIBLINGS = [
  ...stripSourceComments(readFileSync(GUARD, 'utf8'), '.mjs').matchAll(/^import\s.*?from\s+'\.\/([\w.-]+\.mjs)';/gm),
].map((m) => m[1]);

/** The environment the guard must not inherit. `gh` reads GH_TOKEN/GITHUB_TOKEN,
 *  and a machine that happens to be authenticated would send the no-flag cases
 *  down the network path — a suite whose verdict depends on the credentials of
 *  the box it ran on is not a suite. Every case below is offline or fixture-fed;
 *  this makes that structural rather than hopeful. */
const cleanEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(GH_|GITHUB_)/.test(k)) delete env[k];
  return env;
};

/* ⚠️ DECLARED HERE, ABOVE THE HOOK THAT READS THEM, AND THAT IS LOAD-BEARING.
 * node:test runs a root-level `before` in a context where a `const` further down
 * this file is still in its temporal dead zone. `buildAnchor` reads `reg`, so
 * with these four lines in their original position the hook threw
 * `Cannot access 'reg' before initialization` and every case in the file reported
 * `cancelledByParent` — 24 red with no assertion having run. Measured, not
 * theorised. Keep them above `before`. */
const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const ORG = reg.github.org;
const privateDirOf = (s) => String(s.publicDir).replace(/_Public$/, '_Private');
const dirOf = (s, side) => (side === 'public' ? s.publicDir : privateDirOf(s));

/** 🔴 THE ANCHOR IS CONSTRUCTED HERE, NOT INHERITED FROM THE BOX.
 *
 *  The guard locates the store tree by walking UP for the ancestor holding both
 *  `Projects/` and `nikatru/`, and refuses (exit 2, ANCHOR NOT FOUND) when there
 *  is none. That refusal is correct and is asserted below — but it also means
 *  that on a CI runner, which clones ONE repository into /home/runner/work, the
 *  guard dies at the anchor before it parses a fixture or reaches an exit rule,
 *  and EVERY case in this file goes red for a reason that has nothing to do with
 *  the behaviour under test. MEASURED: run 32148776220, 14 of 14 cases here.
 *
 *  This file's own header already refuses to let the credentials of the box
 *  decide the verdict. The FILESYSTEM LAYOUT of the box is the same defect, and
 *  it was left in. `--projects` closes it: the anchor becomes a directory this
 *  suite creates, so every case runs identically on a workstation and a runner.
 *
 *  ⚠️ IT IS AN ANCHOR, NOT A PASS. The directory is EMPTY, so LIMB 2 finds no
 *  slot directory and says so as a NOTE about a limb that did not run; it cannot
 *  turn a finding green, and exit 0 still requires the GitHub limb to have run
 *  against the real org, which nothing here can do. `the anchor walk is NOT
 *  disarmed by the flag` below is what keeps that honest. */
let TMP;
let ANCHOR;
let seq = 0;

const run = (...argv) =>
  spawnSync(process.execPath, [GUARD, ...argv, '--projects', ANCHOR], { encoding: 'utf8', env: cleanEnv() });

/** The guard with NOTHING added — the only way to assert what the seam itself
 *  does, and what it deliberately does not do. */
const runRaw = (guardPath, ...argv) =>
  spawnSync(process.execPath, [guardPath, ...argv], { encoding: 'utf8', env: cleanEnv() });

/**
 * 🔴 THE FIXTURE TREE IS BUILT FROM THE REGISTRY, NOT TYPED.
 *
 * An EMPTY anchor is not enough, and finding that out is the point of writing it
 * down. `renamePins.observable` declares files in SIBLING repositories, and the
 * guard REFUSES (exit 2) when a declared `repoDir` is missing from an anchor that
 * resolved — deliberately, with the reasoning written in its own margin: "a thin
 * checkout cannot reach this line: it fails the anchor first."
 *
 * That reasoning was TRUE while walking up was the only way to get an anchor. The
 * `--projects` seam makes it false — an explicit anchor resolves while the
 * siblings are absent — so the probe is now strict enough to reject its own
 * fixtures. The fix belongs in the FIXTURE, not in the probe: weakening the probe
 * to excuse a missing sibling would delete a real refusal (a WRONG PATH in the
 * registry) to make a test pass, and that refusal is the more valuable of the two.
 *
 * So the tree is CONSTRUCTED to satisfy the declarations, and it is constructed BY
 * READING THEM — add a `renamePins.observable` entry and this follows it, instead
 * of going red for a reason that has nothing to do with the case under test.
 */
function buildAnchor(root) {
  mkdirSync(root, { recursive: true });
  const pins = reg.github?.renamePins?.observable ?? [];
  // ZERO observable pins became a legitimate state on 2026-08-19, when the only one this
  // workspace ever had (storefront-upstreams) was deleted with Nikatru_Storefront_Public.
  // An empty mechanism is still not allowed to be SILENT: if there are no pins the registry
  // must say why, in the same file, or this is a fixture builder quietly modelling nothing.
  if (pins.length === 0) {
    const declared = reg.github?.renamePins?.observableEmpty20260819;
    assert.ok(
      typeof declared === 'string' && declared.length > 40,
      'the registry declares no observable rename pins AND gives no reason — an empty mechanism must be declared, not silent',
    );
  }
  // Every boundRemote the registry declares, so the report counts real subjects
  // rather than printing "0 of 0" over an array invented to be empty.
  const rows = [];
  for (const s of reg.slots) {
    for (const side of ['public', 'private']) {
      const bound = s.repos?.[side]?.boundRemote;
      if (typeof bound === 'string') rows.push({ repo: bound, category: 'fixture', path: 'catalog/vendor/apps.json', state: 'pinned' });
    }
  }
  for (const e of pins) {
    const fileAbs = join(root, ...String(e.repoDir).split('/'), ...String(e.path).split('/'));
    mkdirSync(dirname(fileAbs), { recursive: true });
    writeFileSync(fileAbs, `${JSON.stringify(rows, null, 2)}
`);
  }
  return root;
}

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-ghm-'));
  ANCHOR = buildAnchor(join(TMP, 'anchor-projects'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Write a `gh repo list --json name,visibility,isArchived` payload to disk and
 *  return its path. Takes the parsed value, so a non-array can be written too —
 *  that is one of the cases. */
const fixture = (value) => {
  const p = join(TMP, `gh-${seq++}.json`);
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return p;
};

/**
 * THE CLEAN LISTING, DERIVED. Exactly the repos the registry says the org holds,
 * at the visibility it declares, plus every outOfMatrix line so none of them
 * reads as a STALE DECLARATION, plus every boundRemote so none reads as missing.
 * Nothing typed; add a row to the registry and this follows it.
 */
function cleanListing() {
  const out = new Map();
  const put = (name, visibility) => {
    if (!out.has(name)) out.set(name, { name, visibility, isArchived: false });
  };
  for (const s of reg.slots) {
    for (const side of ['public', 'private']) {
      const rec = s.repos?.[side];
      if (!rec) continue;
      const name = dirOf(s, side);
      if (rec.existsOnGitHub === true) put(name, rec.visibility ?? (side === 'public' ? 'PUBLIC' : 'PRIVATE'));
      if (typeof rec.boundRemote === 'string') {
        const bound = rec.boundRemote.split('/')[1];
        put(bound, side === 'public' ? 'PUBLIC' : 'PRIVATE');
      }
    }
  }
  for (const e of reg.github.outOfMatrix ?? []) put(e.repo, 'PRIVATE');
  return [...out.values()];
}

describe('assert-github-matrix', () => {
  // ── "I did not look" is its own colour, and it is never green ──────────────
  describe('--offline: non-zero on purpose', () => {
    test('--offline exits 3 and says the org was not verified', () => {
      const r = run('--offline');
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stderr, /--offline\. The GitHub limb did not run/);
      assert.match(r.stderr, /NON-ZERO ON PURPOSE/);
    });

    test('--offline PRINTS the skipped limb rather than passing over it in silence', () => {
      const r = run('--offline');
      assert.match(r.stdout, /NOT CHECKED HERE/);
      assert.match(r.stdout, /GitHub limb SKIPPED/);
      assert.match(r.stdout, /github limb DID NOT RUN/);
    });

    test('--offline is the mode a CI runner would have, and it CANNOT be a pass', () => {
      // This is the property NOT_CI_RUNNABLE in assert-guard-coverage.mjs re-runs
      // on every invocation. If this ever exits 0, that exemption must fail, and
      // this case is what would have said so first.
      assert.notEqual(run('--offline').status, 0);
    });
  });

  // ── argv handling: a typo must never silently run a different check ────────
  describe('argument handling refuses rather than guessing', () => {
    test('an unrecognised flag exits 2 and names it', () => {
      const r = run('--ofline');
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /unrecognised argument\(s\): --ofline/);
      assert.match(r.stderr, /Refusing rather than running a different check/);
    });

    test('--gh-fixture with no path exits 2 instead of running the network limb', () => {
      const r = run('--gh-fixture');
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /--gh-fixture needs a file path/);
    });

    test('--help is not a check having passed', () => {
      const r = run('--help');
      assert.equal(r.status, 2, r.stdout);
    });

    test('a --gh-fixture path that does not exist exits 2, never 0', () => {
      const r = run('--gh-fixture', join(TMP, 'no-such-file.json'));
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /does not exist/);
    });
  });

  // ── THE ANCHOR SEAM. It is new, so it owes its own failing cases. ─────────
  describe('--projects names the anchor, and cannot stand in for one', () => {
    test('the override is PRINTED in capitals, so a log cannot miss it', () => {
      const r = run('--offline');
      assert.match(r.stdout, /--projects OVERRIDE IN USE/);
      assert.match(r.stdout, /this is NOT the anchored tree/);
    });

    test('a --projects path that does not exist is REFUSED, not read as "no tree here"', () => {
      const r = runRaw(GUARD, '--offline', '--projects', join(TMP, 'definitely-not-here'));
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /which does not exist/);
    });

    test('--projects with no path exits 2 instead of running against a guess', () => {
      const r = runRaw(GUARD, '--projects');
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /--projects needs a directory path/);
    });

    test('🔴 the anchor walk is NOT disarmed by the flag existing', () => {
      // Plant a copy where no ancestor holds Projects/ + nikatru/ — the shape of
      // a CI checkout — and invoke it with NO override. It must still refuse.
      // Without this case, adding the flag could have quietly turned the
      // locator's refusal into a default, which is how a check becomes a skip.
      const base = join(TMP, `noanchor-${seq++}`);
      mkdirSync(join(base, 'tooling', 'ci'), { recursive: true });
      mkdirSync(join(base, 'catalog'), { recursive: true });
      const copy = join(base, 'tooling', 'ci', 'assert-github-matrix.mjs');
      writeFileSync(copy, readFileSync(GUARD, 'utf8'));
      // 2026-08-18: the guard now imports `listDir` from ./tree-walk.mjs, so the planted copy needs
      // its sibling or node fails at MODULE RESOLUTION — exit 1, before a line of the guard runs.
      // That would have looked like this case still failing the guard while proving nothing about the
      // anchor. Copying the helper keeps the subject under test the ANCHOR WALK, which is what this
      // case is for. Same repair as guards-refuse-empty.test.mjs:236 and release-durable.test.mjs:100.
      // 2026-08-21: AND IT HAPPENED AGAIN, exactly as recorded above — the guard gained a second
      // relative import and this case went red with ERR_MODULE_NOT_FOUND, status 1 where 2 was
      // expected, saying nothing whatever about the anchor. The list is now DERIVED from the guard's
      // own relative imports rather than typed, so the next sibling does not cost a third red run.
      for (const sib of GUARD_SIBLINGS) copyFileSync(join(CI_DIR, sib), join(base, 'tooling', 'ci', sib));
      writeFileSync(join(base, 'catalog', 'store-matrix.json'), readFileSync(REGISTRY, 'utf8'));
      const r = runRaw(copy, '--offline');
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /ANCHOR NOT FOUND/);
      assert.match(r.stderr, /Walked:/);
    });
  });

  // ── THE FLOORS. The two listings `gh` will never hand over on request, and
  //    the two that would otherwise pass vacuously. ────────────────────────────
  describe('the vacuous-listing floors fire', () => {
    test('an EMPTY listing is COVERAGE LOST, not a clean org', () => {
      // A token whose scope has lapsed returns [] successfully. Every assertion
      // downstream agrees with it, so without this floor the guard prints ok
      // having verified nothing — the single most repeated defect in this repo.
      const r = run('--gh-fixture', fixture([]));
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /returned ZERO repositories/);
      assert.match(r.stderr, /would pass vacuously/);
    });

    test('a listing AT the --limit is refused as possibly truncated', () => {
      // "No orphans" is a claim about the WHOLE org and a truncated listing
      // cannot support it.
      const many = Array.from({ length: 1000 }, (_, i) => ({ name: `filler-${i}`, visibility: 'PRIVATE', isArchived: false }));
      const r = run('--gh-fixture', fixture(many));
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /at or above the --limit/);
    });

    test('output that is not a JSON array is refused', () => {
      const r = run('--gh-fixture', fixture({ repos: [] }));
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /did not return a JSON array/);
    });

    test('unparseable output is refused, naming it as coverage lost', () => {
      const r = run('--gh-fixture', fixture('{ not json'));
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /cannot parse/);
    });

    // 🔴 THE LOCAL HALF COMPARING NOTHING WAS A PASS UNTIL 2026-08-20, AND IT
    // HAD BEEN COMPARING NOTHING SINCE THE 2026-08-19 FLATTENING. The slot path
    // was resolved as Projects/<store>/<target>/<type>/<dir>, a tree that no
    // longer exists, so all four sides reported "slot directory NOT PRESENT",
    // were skipped, and the guard printed `ok — registry and org reconcile` on
    // the GitHub half alone. `localCompared` was printed and read by nothing.
    test('slot directories absent from the anchor: the LOCAL half compared nothing, and that is NOT a pass', () => {
      const bare = join(TMP, `bare-anchor-${seq++}`);
      mkdirSync(bare, { recursive: true });
      const r = spawnSync(
        process.execPath,
        [GUARD, '--gh-fixture', fixture(cleanListing()), '--projects', bare],
        { encoding: 'utf8', env: cleanEnv() },
      );
      assert.notEqual(r.status, 0, r.stdout);
      assert.match(`${r.stdout}${r.stderr}`, /NOT ONE was compared against a checkout on disk/);
    });
  });

  // ── FINDINGS: the reconciliation itself must be able to go red ─────────────
  describe('real reconciliation failures exit 1', () => {
    test('a repo the registry accounts for NOWHERE is an ORPHAN and FAILS', () => {
      const r = run('--gh-fixture', fixture([...cleanListing(), { name: 'nikatru-undeclared-thing', visibility: 'PRIVATE', isArchived: false }]));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /ORPHAN/);
      assert.match(r.stderr, /nikatru-undeclared-thing/);
      assert.match(r.stderr, new RegExp(`org ${ORG}`));
    });

    test('an outOfMatrix line naming a repo the org does not hold is a STALE DECLARATION', () => {
      const dropped = (reg.github.outOfMatrix ?? [])[0]?.repo;
      assert.ok(dropped, 'the registry declares no outOfMatrix entry — this case has no subject');
      const r = run('--gh-fixture', fixture(cleanListing().filter((x) => x.name !== dropped)));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /STALE DECLARATION/);
      assert.match(r.stderr, new RegExp(dropped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    // 🔴 THE MUTATION IS DERIVED FROM WHAT THE REGISTRY ACTUALLY DECLARES, AND
    // THE DIRECTION IS NOT ASSUMED. Today every slot row says
    // `existsOnGitHub: false` with `visibility: null` — the thirty store repos
    // are intended, not built — so "the registry says true and the org says
    // false" HAS NO SUBJECT in this tree, and a case written that way asserts
    // nothing while looking thorough. Both cases below contradict whatever the
    // row says, in whichever direction has a subject, so they keep working when
    // the first store repo is created and the declaration flips.
    const target = (() => {
      for (const s of reg.slots) {
        for (const side of ['public', 'private']) {
          if (s.repos?.[side]) return { name: dirOf(s, side), rec: s.repos[side], side };
        }
      }
      return null;
    })();

    test('a measured existsOnGitHub that CONTRADICTS the org FAILS', () => {
      // Either direction is a measured field that has gone stale, and fixing it
      // is a JSON edit nobody needs permission for — which is exactly why it is
      // red rather than an owner action.
      assert.ok(target, 'the registry declares no slot side at all — this case has no subject');
      const declared = target.rec.existsOnGitHub === true;
      const listing = declared
        ? cleanListing().filter((x) => x.name !== target.name)
        : [...cleanListing(), { name: target.name, visibility: 'PRIVATE', isArchived: false }];
      const r = run('--gh-fixture', fixture(listing));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, new RegExp(`existsOnGitHub says ${declared}, GitHub says ${!declared}`));
      assert.match(r.stderr, new RegExp(target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    test('a visibility that disagrees with GitHub FAILS', () => {
      // ⚠️ IT MUST BE AN INTENDED NAME, NOT WHICHEVER ROW SORTS FIRST. A
      // boundRemote whose visibility is wrong is an OWNER ACTION and leaves the
      // exit code alone — correctly, since only the owner can change a repo's
      // visibility. Written the lazy way first, this case ran against exit 4 and
      // would have recorded "the guard fails on visibility" while exercising the
      // branch that deliberately does not fail.
      assert.ok(target, 'the registry declares no slot side at all — this case has no subject');
      const declaredVis = target.rec.visibility ?? null;
      const actualVis = declaredVis === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
      const listing = [
        ...cleanListing().filter((x) => x.name !== target.name),
        { name: target.name, visibility: actualVis, isArchived: false },
      ];
      const r = run('--gh-fixture', fixture(listing));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, new RegExp(`visibility says ${JSON.stringify(declaredVis)}, GitHub says "${actualVis}"`));
    });
  });

  // ── THE CONTROL. Without a case where the reconciliation is CLEAN, every red
  //    result above is equally consistent with a guard that refuses everything
  //    it is ever shown. ───────────────────────────────────────────────────────
  describe('the clean control, and the seam that still cannot pass', () => {
    test('a listing derived FROM the registry produces no findings', () => {
      const r = run('--gh-fixture', fixture(cleanListing()));
      assert.notEqual(r.status, 1, `expected no findings, got:\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /FINDING\(S\)/);
    });

    test('T_CLEAN_NEVER_ZERO — a clean fixture run exits 4, NEVER 0', () => {
      // The seam's safety property. A test seam that can produce the same exit
      // code as a passing real run is a way to fake a passing real run.
      const r = run('--gh-fixture', fixture(cleanListing()));
      assert.equal(r.status, 4, r.stdout + r.stderr);
      assert.match(r.stderr, /the org was NOT looked at/);
      assert.match(r.stderr, /structurally incapable of exiting 0/);
    });

    test('a fixture run says so IN CAPITALS, so a log cannot mistake it for a real one', () => {
      const r = run('--gh-fixture', fixture(cleanListing()));
      assert.match(r.stdout, /--gh-fixture IN USE/);
      assert.match(r.stdout, /THIS RUN DID NOT TALK TO GITHUB/);
    });

    test('findings DOMINATE the fixture exit code — 1 is the more actionable number', () => {
      const r = run('--gh-fixture', fixture([...cleanListing(), { name: 'nikatru-undeclared-thing', visibility: 'PRIVATE', isArchived: false }]));
      assert.equal(r.status, 1, r.stdout);
    });
  });

  // ── The structure limb runs offline and is the one that fails ─────────────
  describe('the guard is READ-ONLY, and that is checked rather than promised', () => {
    test('it holds no GitHub write verb', () => {
      // `gh repo list` is the only GitHub call this file is allowed to make. A
      // create/rename/delete appearing here would be a change of kind, not of
      // degree — the whole matrix work is under a standing "CREATE NO REPOS".
      const src = readFileSync(GUARD, 'utf8');
      for (const verb of ['repo create', 'repo rename', 'repo delete', 'repo edit']) {
        assert.ok(!src.includes(verb), `assert-github-matrix.mjs must not contain \`${verb}\``);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LIMB 1b — PROSE ABOUT `gh repo list` IS NOT AN EXECUTION OF IT.
  //
  // 🔴 THE DEFECT THESE CASES RECORD. Until 2026-08-21 the org-literal limb
  // matched its three tests — GH_LIST, READS_REGISTRY, the ORG literal — against
  // RAW source, so a COMMENT could satisfy any of them. Re-measured on the settled
  // live tree 2026-08-21: 152 files scanned, 6 matched GH_LIST raw, 1 after
  // stripping comments. Five of the six were prose, all five carrying one shared
  // paragraph. The count printed at the foot of that limb was therefore inflated
  // AND could not fall while that paragraph stood, so "nothing queries GitHub any
  // more" — the one signal the count exists to give — could never be observed.
  // ⚠️ An earlier pass of this comment read 153/7; both were taken while an
  // untracked, since-deleted second stripper module sat in tooling/ci. Kept as a
  // record that the number moved, and why.
  //
  // ⚠️ AND THE OTHER HALF OF THAT PASS IS WITHDRAWN. It also claimed the raw read
  // had manufactured a LIVE red. The one finding it cited was against that same
  // untracked module, so the red was self-inflicted and the committed tree never
  // had it: re-simulating the raw branch over today's tree gives 6 duplicated-org
  // notes and ZERO findings. The unfallable count is the whole live defect.
  //
  // ⚠️ WHY THESE CASES ARE PLANTED RATHER THAN RUN AGAINST THIS REPO. A case
  // asserting "the live tree has exactly one querier" goes red the day someone
  // adds a script, for a reason having nothing to do with the behaviour under
  // test — the same failure this file's own header records against a re-typed
  // "1 of 1". The subject here is the CLASSIFIER, so the tree it classifies is
  // constructed: three files it must scan and probes whose contents are the
  // whole input.
  //
  // ⚠️ AND THE PRICE OF THAT: THE PROBE BODIES SPELL THE ARGV CONTIGUOUSLY INSIDE
  // STRING LITERALS, so THIS FILE is itself a post-strip GH_LIST match (measured
  // 2026-08-21: true raw and true stripped — strings pass through verbatim, which
  // is exactly the property the limb needs). CHECKED, because it once broke a
  // sibling suite: nothing that exists today reads this file that way. The guard's
  // own scan is ONE level deep over tooling/ci and takes `f.isFile()`, so
  // tooling/ci/test/ is never in its range; and the one real-tree assertion that
  // did reach in here — a `git ls-files 'tooling/ci/*.mjs'` pathspec whose `*`
  // CROSSES `/` — lived in a test file that has since been deleted. Measured now:
  // that pathspec returns 288 paths, 144 of them under test/, against 144 for
  // `:(glob)tooling/ci/*.mjs`. So the cost today is zero and the liability is
  // latent: any future sweep pinning the stripped querier set must use the `:(glob)`
  // form, or expect this file in its results. The repair is never to blank strings.
  //
  // 🔴 AND THEY ASSERT ON THE TEXT, NOT ON THE EXIT CODE ALONE. A planted tree
  // has no slot directories, so the COVERAGE LOST floor is also firing in every
  // case below; `--offline` exits 3 either way and a case reading only `status`
  // would pass for the wrong reason and keep passing if this limb were deleted
  // outright. Every case pins the finding text and the printed querier count.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('the org-literal limb counts CODE, not comments about code', () => {
    /** The guard's in-tree imports — the ONE derivation at the top of this file, not a second copy
     *  of it. A typed list is a red run away from every new sibling, and the counts below depend on
     *  exactly which files land in the planted tooling/ci. As of 2026-08-21: tree-walk.mjs,
     *  text-reductions.mjs. */
    const SIBLINGS = GUARD_SIBLINGS;

    /** Plant a hermetic tooling/ci: the guard, the siblings it imports, and
     *  the probes. Anything absent from `probes` is absent from the scan, so the
     *  printed counts are fully determined here.
     *
     *  ⚠️ THE SIBLINGS ARE COPIED, AND THAT IS LOAD-BEARING. A planted copy whose
     *  imports do not resolve dies at MODULE RESOLUTION — exit 1, before a line
     *  of the guard runs — which reads exactly like the case under test failing.
     *  That already happened once here with tree-walk.mjs — the dated comment and the copy loop, which
 *  this file's own 2026-08-21 edits pushed down ~27 lines from where an earlier draft of this
 *  sentence cited them. They are found by searching for GUARD_SIBLINGS, not by line number: a
 *  pointer into a file other people edit is correct only until someone inserts above it, and
 *  nothing recomputes it. The guard
     *  gained a second relative import on 2026-08-21 — `./text-reductions.mjs` —
     *  and it is copied for the same reason, not as a courtesy. */
    const plant = (probes) => {
      const base = join(TMP, `ghlimb-${seq++}`);
      mkdirSync(join(base, 'tooling', 'ci'), { recursive: true });
      mkdirSync(join(base, 'catalog'), { recursive: true });
      const copy = join(base, 'tooling', 'ci', 'assert-github-matrix.mjs');
      writeFileSync(copy, readFileSync(GUARD, 'utf8'));
      for (const sib of SIBLINGS) copyFileSync(join(CI_DIR, sib), join(base, 'tooling', 'ci', sib));
      writeFileSync(join(base, 'catalog', 'store-matrix.json'), readFileSync(REGISTRY, 'utf8'));
      for (const [name, body] of Object.entries(probes)) {
        writeFileSync(join(base, 'tooling', 'ci', name), `${body}\n`);
      }
      return copy;
    };
    const limbLine = (r) => {
      const m = `${r.stdout}`.match(/org-literal limb: (\d+) tooling script\(s\) scanned, (\d+) of them query/);
      assert.ok(m, `the org-literal limb printed no count at all:\n${r.stdout}`);
      return { scanned: Number(m[1]), queriers: Number(m[2]) };
    };
    /** The siblings every plant carries, which the guard scans like any other
     *  .mjs. Neither queries GitHub in CODE today — measured 2026-08-21, neither
     *  tree-walk.mjs nor text-reductions.mjs matches GH_LIST even RAW — so they
     *  contribute to `scanned` and not to `queriers`.
     *  🔴 That second half is not assumed. If a sibling ever grew a real `gh`
     *  call every querier count below would be off by one and the reason would be
     *  invisible, so it is measured here, once, with the shared stripper. */
    const CARRIED = SIBLINGS.length;
    test('the carried siblings are scanned but query nothing — the baseline the counts rest on', () => {
      assert.ok(CARRIED >= 2, `expected the guard to import its siblings relatively, derived: ${SIBLINGS.join(', ')}`);
      for (const sib of SIBLINGS) {
        const p = join(CI_DIR, sib);
        const stripped = stripSourceComments(readFileSync(p, 'utf8'), '.mjs');
        assert.doesNotMatch(
          stripped,
          /gh\s+repo\s+list|['"]repo['"]\s*,\s*['"]list['"]/,
          `${sib} is planted into every fixture below; a real \`gh repo list\` in it would silently shift every querier count`,
        );
      }
    });

    // ── THE NEGATIVE HALF. This is the case the fix exists for. ─────────────
    test('🔴 a file whose ONLY `gh repo list` is inside a COMMENT is not a querier, and does not fail', () => {
      const copy = plant({
        'probe-prose.mjs': [
          '// This module talks to nothing. To confirm a repo name by hand, run `gh repo list`',
          '// against the org and read the output yourself — never trust a name typed in a doc.',
          'export const answer = 42;',
        ].join('\n'),
      });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      // The classification, which is the subject.
      assert.deepEqual(limbLine(r), { scanned: CARRIED + 1, queriers: 0 });
      // And the finding it must NOT have manufactured. Before 2026-08-21 this
      // probe — no `gh`, no child_process, no org literal — was reported as a
      // second copy of the org name that had DISAGREED with the registry.
      assert.doesNotMatch(r.stderr, /DISAGREED/, r.stderr);
      assert.doesNotMatch(r.stderr, /probe-prose\.mjs/, r.stderr);
      assert.notEqual(r.status, 1, `${r.stdout}${r.stderr}`);
    });

    // ── AND THE HALF THAT MUST STILL BITE. Without it, the case above is
    //    equally consistent with a limb that was simply switched off. ────────
    test('🔴 a file that REALLY shells out, with no org and no registry read, still FAILS', () => {
      const copy = plant({
        'probe-real.mjs': [
          "import { execFileSync } from 'node:child_process';",
          "export const list = () => execFileSync('gh', ['repo', 'list', 'some-other-org', '--json', 'name']);",
        ].join('\n'),
      });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.deepEqual(limbLine(r), { scanned: CARRIED + 1, queriers: 1 });
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /probe-real\.mjs queries `gh repo list`/);
      assert.match(r.stderr, /the two copies of the org name have DISAGREED/);
    });

    test('both probes at once: the prose one is invisible, the real one is the whole count', () => {
      // Together in one tree, because "0 when alone" and "1 when alone" are also
      // consistent with a limb that counts files rather than reading them.
      const copy = plant({
        'probe-prose.mjs': '// see `gh repo list` for how to check this by hand\nexport const a = 1;',
        'probe-real.mjs': [
          "import { execFileSync } from 'node:child_process';",
          "export const list = () => execFileSync('gh', ['repo', 'list', 'some-other-org']);",
        ].join('\n'),
      });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.deepEqual(limbLine(r), { scanned: CARRIED + 2, queriers: 1 });
      assert.match(r.stderr, /probe-real\.mjs/);
      assert.doesNotMatch(r.stderr, /probe-prose\.mjs/, r.stderr);
    });

    test('a real querier that SPELLS the org is a NOTE, not a finding — the branch still works', () => {
      // The middle branch. If stripping had broken the ORG test the file would
      // fall through to `fail` instead, and the two cases above cannot tell the
      // difference between "notes correctly" and "never reaches this line".
      const copy = plant({
        'probe-agrees.mjs': [
          "import { execFileSync } from 'node:child_process';",
          `export const list = () => execFileSync('gh', ['repo', 'list', '${ORG}', '--json', 'name']);`,
        ].join('\n'),
      });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.deepEqual(limbLine(r), { scanned: CARRIED + 1, queriers: 1 });
      assert.notEqual(r.status, 1, `${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /org name is DUPLICATED as a literal in tooling\/ci\/probe-agrees\.mjs/);
    });

    test('an ORG spelled only in a COMMENT does not excuse a real querier', () => {
      // The same defect from the other side: before the strip, a file could
      // satisfy "spells the declared org exactly" with a sentence mentioning it.
      const copy = plant({
        'probe-orgprose.mjs': [
          "import { execFileSync } from 'node:child_process';",
          `// The org is ${ORG}; this hardcoding is a known second copy of that fact.`,
          "export const list = () => execFileSync('gh', ['repo', 'list', 'some-other-org']);",
        ].join('\n'),
      });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.deepEqual(limbLine(r), { scanned: CARRIED + 1, queriers: 1 });
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /probe-orgprose\.mjs queries `gh repo list`/);
    });

    test('a `github.org` read that is only a COMMENT does not excuse a real querier either', () => {
      const copy = plant({
        'probe-regprose.mjs': [
          "import { execFileSync } from 'node:child_process';",
          '// TODO: read `github.org` from catalog/store-matrix.json instead of hardcoding this.',
          "export const list = () => execFileSync('gh', ['repo', 'list', 'some-other-org']);",
        ].join('\n'),
      });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.deepEqual(limbLine(r), { scanned: CARRIED + 1, queriers: 1 });
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /probe-regprose\.mjs queries `gh repo list`/);
    });

    // ── 🔴 THE KNOB THAT WOULD DELETE THIS LIMB SILENTLY. ───────────────────
    test('the strip must NOT blank string literals — the only real querier lives in an argv', () => {
      // Composing `stripStringLiterals` on top of the comment strip looks like a
      // tightening and is the opposite: every real invocation of this command —
      // the shell form inside a quoted command string, and the `['repo','list',…]`
      // argv — is a STRING. Measured on the live tree 2026-08-21: with the string
      // blanking composed in, the querier count goes 1 -> 0 and
      // assert-store-matrix.mjs stops containing the org literal, because :642 is
      // one execFileSync argv carrying both facts at once. The limb would go blind
      // and still print a green count.
      // This case is about the guard's SOURCE because the mistake would be made
      // there, and nothing downstream of it can fail loudly enough to say so.
      // 🔴 AND IT READS THE GUARD'S CODE, NOT ITS COMMENTS. The guard's margin
      // ARGUES against blanking literals at length and names the function while
      // doing it, so a raw `doesNotMatch(/stripStringLiterals/)` would go red
      // against the very prose explaining why — prose satisfying a code rule, one
      // level up, which is the defect this whole block is about.
      const src = stripSourceComments(readFileSync(GUARD, 'utf8'), '.mjs');
      assert.match(src, /stripSourceComments\(raw, '\.mjs'\)/, 'the org-literal limb must route its read through the shared stripper');
      assert.doesNotMatch(src, /stripStringLiterals/, 'this guard must never compose the string-literal blanker onto that read');
      // And the property that makes that non-negotiable, measured rather than asserted in prose.
      const store = readFileSync(join(CI_DIR, 'assert-store-matrix.mjs'), 'utf8');
      const bare = stripStringLiterals(stripSourceComments(store, '.mjs'));
      assert.match(store, /['"]repo['"]\s*,\s*['"]list['"]/, 'assert-store-matrix.mjs is the real querier this limb exists to see');
      assert.doesNotMatch(bare, /['"]repo['"]\s*,\s*['"]list['"]/, 'blanking strings would hide the one real querier');
      assert.ok(!bare.includes(ORG), 'blanking strings would also hide its copy of the org literal');
    });
  });
});
