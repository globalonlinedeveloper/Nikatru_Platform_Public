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

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-github-matrix.mjs');
const REGISTRY = join(REPO, 'catalog', 'store-matrix.json');

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
      copyFileSync(join(CI_DIR, 'tree-walk.mjs'), join(base, 'tooling', 'ci', 'tree-walk.mjs'));
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
});
