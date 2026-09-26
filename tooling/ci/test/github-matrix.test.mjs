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
// 🔴 EXPECTATIONS ARE DERIVED FROM tooling/github-org.json, NEVER TYPED. The
// clean-listing fixture is BUILT from the registry at run time — the platform
// repos it declares, at the visibility it declares, plus every otherRepos line.
// A typed listing would go red the day an entry is added, for a reason having
// nothing to do with the behaviour under test; that is the failure a retired
// sibling suite's header recorded against a re-typed "1 of 1" that killed
// nineteen cases. (Re-keyed 2026-09-25 from the retired store matrix's `github`
// block, O-STORE-MATRIX-IS-A-DEAD-DECLARATION.)
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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname, resolve, delimiter } from 'node:path';
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
import { repoGit } from '../../scripts/repo-git.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-github-matrix.mjs');
const REGISTRY = join(REPO, 'tooling', 'github-org.json');
const DEAD_REPOS = join(REPO, 'tooling', 'dead-repos.json');

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
 *  As of 2026-08-21 the guard has exactly two, both in that form: tree-walk.mjs, text-reductions.mjs.
 *  🔴 2026-09-07 — THE NARROWNESS ABOVE CAME DUE, exactly as it was written down. The guard's two
 *  cross-repo `git` reads moved behind `../scripts/repo-git.mjs` (git exports GIT_DIR/GIT_INDEX_FILE
 *  into hooks and they beat `-C`), which is an import "naming a subdirectory" — the case this comment
 *  says is silently missed. It is no longer missed: entries are now TOOLING-RELATIVE (`ci/x.mjs`,
 *  `scripts/x.mjs`) and both plants below recreate that shape, so a sibling one directory over
 *  resolves in a planted tree exactly as it does in the real one. */
const GUARD_SIBLINGS = [
  ...stripSourceComments(readFileSync(GUARD, 'utf8'), '.mjs').matchAll(/^import\s.*?from\s+'\.(\.\/scripts)?\/([\w.-]+\.mjs)';/gm),
].map((m) => (m[1] ? `scripts/${m[2]}` : `ci/${m[2]}`));

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
const ORG = reg.org;
const dead = JSON.parse(readFileSync(DEAD_REPOS, 'utf8'));

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
  const pins = reg.renamePins?.observable ?? [];
  // ZERO observable pins became a legitimate state on 2026-08-19, when the only one this
  // workspace ever had (storefront-upstreams) was deleted with Nikatru_Storefront_Public.
  // An empty mechanism is still not allowed to be SILENT: if there are no pins the registry
  // must say why, in the same file, or this is a fixture builder quietly modelling nothing.
  if (pins.length === 0) {
    const declared = reg.renamePins?.observableEmpty20260819;
    assert.ok(
      typeof declared === 'string' && declared.length > 40,
      'the registry declares no observable rename pins AND gives no reason — an empty mechanism must be declared, not silent',
    );
  }
  // Every boundRemote the registry declares, so the report counts real subjects
  // rather than printing "0 of 0" over an array invented to be empty.
  const rows = [];
  for (const e of reg.platform) {
    if (typeof e.boundRemote === 'string') rows.push({ repo: e.boundRemote, category: 'fixture', path: 'catalog/vendor/apps.json', state: 'pinned' });
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
 * at the visibility it declares, plus every otherRepos line so none of them
 * reads as a STALE DECLARATION, plus every boundRemote so none reads as missing.
 * Nothing typed; add an entry to the registry and this follows it.
 */
function cleanListing() {
  const out = new Map();
  const put = (name, visibility) => {
    if (!out.has(name)) out.set(name, { name, visibility, isArchived: false });
  };
  for (const e of reg.platform) {
    put(e.repo, e.visibility);
    if (typeof e.boundRemote === 'string') put(e.boundRemote.split('/')[1], e.visibility);
  }
  for (const e of reg.otherRepos ?? []) put(e.repo, 'PRIVATE');
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
      for (const sib of GUARD_SIBLINGS) { const dest = join(base, 'tooling', sib); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(CI_DIR, '..', sib), dest); }
      writeFileSync(join(base, 'tooling', 'github-org.json'), readFileSync(REGISTRY, 'utf8'));
      writeFileSync(join(base, 'tooling', 'dead-repos.json'), readFileSync(DEAD_REPOS, 'utf8'));
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

  // ── O-EXIT2-CONVENTION-GAP: THE NETWORK LIMB WITH NO FIXTURE, AGAINST A STUBBED `gh` ─────────────
  // Every case above is --offline or --gh-fixture, so the no-flag path — the only one that can exit 0
  // — was never run under test. These put a FAKE `gh` first on PATH: a copy of this node binary that a
  // NODE_OPTIONS preload turns into a stub (it acts only when the process is NAMED gh, so the guard's
  // own node ignores it). No network, no credential: `cleanEnv()` has already removed GH_*/GITHUB_*.
  // An unreachable or unauthenticated GitHub must be exit 2 COVERAGE LOST — never 0, never 1.
  describe('the network limb against a stubbed gh: could-not-look is exit 2', () => {
    let BIN;
    let PRELOAD;
    before(() => {
      BIN = join(TMP, 'fake-gh-bin');
      mkdirSync(BIN, { recursive: true });
      const exe = join(BIN, process.platform === 'win32' ? 'gh.exe' : 'gh');
      copyFileSync(process.execPath, exe);
      chmodSync(exe, 0o755);
      PRELOAD = join(TMP, 'fake-gh-preload.cjs');
      writeFileSync(PRELOAD, [
        "const { basename } = require('node:path');",
        'const me = basename(process.execPath).toLowerCase();',
        "if (me === 'gh' || me === 'gh.exe') {",
        '  const mode = process.env.FAKE_GH_MODE;',
        "  if (mode === 'unauthenticated') {",
        "    console.error('To get started with GitHub CLI, please run:  gh auth login');",
        '    process.exit(4);',
        '  }',
        "  if (mode === 'hang') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);",
        "  process.stdout.write(require('node:fs').readFileSync(process.env.FAKE_GH_LISTING, 'utf8'));",
        '  process.exit(0);',
        '}',
        '',
      ].join('\n'));
    });
    const runStubbed = (mode, listing, extraEnv = {}) => {
      const env = cleanEnv();
      const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[pathKey] = `${BIN}${delimiter}${env[pathKey] ?? ''}`;
      env.NODE_OPTIONS = `--require "${PRELOAD.replace(/\\/g, '/')}"`;
      env.FAKE_GH_MODE = mode;
      env.FAKE_GH_LISTING = fixture(listing);
      Object.assign(env, extraEnv);
      return spawnSync(process.execPath, [GUARD, '--projects', ANCHOR], { encoding: 'utf8', env });
    };

    test('gh that answers but is NOT AUTHENTICATED is exit 2 COVERAGE LOST, naming gh repo list', () => {
      const r = runStubbed('unauthenticated', []);
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COVERAGE LOST — `gh repo list` could not look at GitHub/);
      assert.match(r.stderr, /gh auth login/);
    });

    test('gh that NEVER ANSWERS is killed at GH_LIST_TIMEOUT_MS and is exit 2, not a hang and not a finding', () => {
      const r = runStubbed('hang', [], { GH_LIST_TIMEOUT_MS: '1500' });
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COVERAGE LOST — `gh repo list` could not look at GitHub/);
      assert.match(r.stderr, /did not answer within/);
    });

    test('🔴 a CLEAN org listing with the local half comparing NOTHING is exit 2, not 0 (the overwritten exitCode)', () => {
      // Until 2026-09-19 the ✗ below set exitCode = 1 and the final process.exit(0) overwrote it.
      const r = runStubbed('list', cleanListing());
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /NOT ONE was compared against a checkout on disk/);
      assert.match(r.stderr, /COVERAGE LOST — the local limb compared NONE of the \d+ declared boundRemote checkout\(s\)/);
      assert.doesNotMatch(r.stdout, /ok — registry and org reconcile/);
    });

    test('a finding beside the local COVERAGE LOST is exit 1 — findings dominate', () => {
      const r = runStubbed('list', [...cleanListing(), { name: 'nikatru-undeclared-thing', visibility: 'PRIVATE', isArchived: false }]);
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /ORPHAN/);
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

    test('an otherRepos line naming a repo the org does not hold is a STALE DECLARATION', () => {
      const dropped = (reg.otherRepos ?? [])[0]?.repo;
      assert.ok(dropped, 'the registry declares no otherRepos entry — this case has no subject');
      const r = run('--gh-fixture', fixture(cleanListing().filter((x) => x.name !== dropped)));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /STALE DECLARATION — otherRepos names/);
      assert.match(r.stderr, new RegExp(dropped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    // 🔴 THE MUTATION IS DERIVED FROM WHAT THE REGISTRY ACTUALLY DECLARES. The
    // subject is the FIRST `platform` entry, whatever it is named, so these cases
    // keep working when an entry is added or renamed. Until 2026-09-25 they read a
    // store-slot row's `existsOnGitHub`; a platform entry is a repository the org
    // HOLDS, so "the registry declares it and the org does not" is now the stale
    // direction, and it is a finding for the same reason that field's was.
    const target = reg.platform[0] ? { name: reg.platform[0].repo, rec: reg.platform[0] } : null;

    test('a platform repo the org does not hold is a STALE DECLARATION and FAILS', () => {
      // A measured fact that has gone stale, and fixing it is a JSON edit nobody
      // needs permission for — which is exactly why it is red rather than an
      // owner action.
      assert.ok(target, 'the registry declares no platform entry at all — this case has no subject');
      const r = run('--gh-fixture', fixture(cleanListing().filter((x) => x.name !== target.name)));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /STALE DECLARATION — platform\[0\]/);
      assert.match(r.stderr, new RegExp(`does not hold "${target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    });

    test('a visibility that disagrees with GitHub FAILS', () => {
      // ⚠️ THE ENTRY'S OWN `visibility`, NOT ITS BOUND REMOTE'S. A boundRemote
      // whose visibility is wrong is an OWNER ACTION and leaves the exit code
      // alone — correctly, since only the owner can change a repo's visibility.
      // Written the lazy way first, this case ran against exit 4 and would have
      // recorded "the guard fails on visibility" while exercising the branch that
      // deliberately does not fail.
      assert.ok(target, 'the registry declares no platform entry at all — this case has no subject');
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

    // 🔴 A DEAD NAME IS NOT AN ACCOUNTING SURFACE. tooling/dead-repos.json records
    // names that died; the org holding one again is a RE-CLAIMED name (a live
    // Cloudflare Pages binding still resolves an old repository id), so it must be
    // LOUDER than a new orphan, never quieter.
    test('a DEAD name the org holds again is an ORPHAN that names its death record', () => {
      const deadName = dead.repos[0]?.name;
      assert.ok(deadName, 'tooling/dead-repos.json declares no dead repo — this case has no subject');
      const r = run('--gh-fixture', fixture([...cleanListing(), { name: deadName, visibility: 'PRIVATE', isArchived: false }]));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, new RegExp(`ORPHAN — org ${ORG} holds "${deadName}"`));
      assert.match(r.stderr, /records "[^"]+" as DEAD/);
      assert.match(r.stderr, /RE-CLAIMED name/);
    });

    test('a new orphan carries no death record — the dead-name note is not printed for every orphan', () => {
      const r = run('--gh-fixture', fixture([...cleanListing(), { name: 'nikatru-undeclared-thing', visibility: 'PRIVATE', isArchived: false }]));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /ORPHAN/);
      assert.doesNotMatch(r.stderr, /as DEAD/);
    });
  });

  // ── THE REGISTRY FILES ARE READ, NEVER GUESSED. Re-keyed 2026-09-25: the guard
  //    reads tooling/github-org.json and tooling/dead-repos.json, and a missing or
  //    malformed one is exit 2 — "I could not look", never an empty org. ─────────
  describe('the registry files are read, never guessed', () => {
    /** A hermetic copy of the guard with its siblings and the two registry files
     *  as given (`null` leaves a file out), so the refusal under test is the only
     *  thing that differs from the real tree. */
    const plantRegistry = ({ registry, deadRepos }) => {
      const base = join(TMP, `regplant-${seq++}`);
      mkdirSync(join(base, 'tooling', 'ci'), { recursive: true });
      const copy = join(base, 'tooling', 'ci', 'assert-github-matrix.mjs');
      writeFileSync(copy, readFileSync(GUARD, 'utf8'));
      for (const sib of GUARD_SIBLINGS) { const dest = join(base, 'tooling', sib); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(CI_DIR, '..', sib), dest); }
      if (registry !== null) writeFileSync(join(base, 'tooling', 'github-org.json'), registry);
      if (deadRepos !== null) writeFileSync(join(base, 'tooling', 'dead-repos.json'), deadRepos);
      return copy;
    };
    const realRegistry = () => readFileSync(REGISTRY, 'utf8');
    const realDead = () => readFileSync(DEAD_REPOS, 'utf8');

    test('the planted control: both files present reaches the report, so the refusals below are not the plant', () => {
      const copy = plantRegistry({ registry: realRegistry(), deadRepos: realDead() });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.equal(r.status, 3, `${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /tooling\/github-org\.json {2}vs {2}github\.com\//);
    });

    test('tooling/github-org.json absent is REGISTRY NOT FOUND, exit 2', () => {
      const copy = plantRegistry({ registry: null, deadRepos: realDead() });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /REGISTRY NOT FOUND/);
    });

    test('a registry with an empty `platform` is refused, exit 2', () => {
      const doc = JSON.parse(realRegistry());
      doc.platform = [];
      const copy = plantRegistry({ registry: JSON.stringify(doc), deadRepos: realDead() });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /no `platform` array, or it is empty/);
    });

    test('tooling/dead-repos.json absent is refused, exit 2 — a dead name would otherwise read as a new one', () => {
      const copy = plantRegistry({ registry: realRegistry(), deadRepos: null });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /DEAD-REPO LIST UNREADABLE/);
    });

    test('a platform entry with no `boundRemote` key is a FINDING — absent is not null', () => {
      const doc = JSON.parse(realRegistry());
      delete doc.platform[0].boundRemote;
      const copy = plantRegistry({ registry: JSON.stringify(doc), deadRepos: realDead() });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /`boundRemote` is absent/);
    });

    test('a repo declared both as platform and in otherRepos is a FINDING — accountingRule says EXACTLY ONE', () => {
      const doc = JSON.parse(realRegistry());
      doc.otherRepos = [...doc.otherRepos, { repo: doc.platform[0].repo, why: 'planted double declaration', measured: 'planted by this case' }];
      const copy = plantRegistry({ registry: JSON.stringify(doc), deadRepos: realDead() });
      const r = runRaw(copy, '--offline', '--projects', ANCHOR);
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /accountingRule says EXACTLY ONE/);
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
      const copy = join(base, 'tooling', 'ci', 'assert-github-matrix.mjs');
      writeFileSync(copy, readFileSync(GUARD, 'utf8'));
      for (const sib of SIBLINGS) { const dest = join(base, 'tooling', sib); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(CI_DIR, '..', sib), dest); }
      writeFileSync(join(base, 'tooling', 'github-org.json'), readFileSync(REGISTRY, 'utf8'));
      writeFileSync(join(base, 'tooling', 'dead-repos.json'), readFileSync(DEAD_REPOS, 'utf8'));
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
        const p = join(CI_DIR, '..', sib);
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
          '// TODO: read `github.org` from tooling/github-org.json instead of hardcoding this.',
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
      // blanking composed in, the querier count went 1 -> 0 and the one real
      // querier of that day (a store-slot guard, retired 2026-09-25) stopped
      // containing the org literal, because one argv carried both facts at once.
      // The limb would go blind and still print a green count.
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
      // ⏱ 2026-09-25 — RE-AIMED, NOT DELETED. This read the store-slot guard, the one real querier
      // on the tree until it was retired with the store matrix (O-STORE-MATRIX-IS-A-DEAD-DECLARATION).
      // The property is about a querier's SHAPE, so it is measured on the two queriers that remain
      // to be read: this guard's own argv (the limb skips SELF, but its code is the real shape), and
      // the org-spelling probe the middle-branch case above plants, for the org-literal half.
      const selfRaw = readFileSync(GUARD, 'utf8');
      const selfBare = stripStringLiterals(stripSourceComments(selfRaw, '.mjs'));
      assert.match(stripSourceComments(selfRaw, '.mjs'), /['"]repo['"]\s*,\s*['"]list['"]/, 'assert-github-matrix.mjs is a real querier: its argv must survive the comment strip');
      assert.doesNotMatch(selfBare, /['"]repo['"]\s*,\s*['"]list['"]/, 'blanking strings would hide a real querier');
      const agrees = `import { execFileSync } from 'node:child_process';\nexport const list = () => execFileSync('gh', ['repo', 'list', '${ORG}', '--json', 'name']);\n`;
      const agreesBare = stripStringLiterals(stripSourceComments(agrees, '.mjs'));
      assert.ok(stripSourceComments(agrees, '.mjs').includes(ORG), 'the comment strip alone must keep an argv copy of the org literal');
      assert.ok(!agreesBare.includes(ORG), 'blanking strings would also hide its copy of the org literal');
    });
  });
});

// ── ADDED 2026-09-07 — THE SLOT READS MUST NOT INHERIT THE CALLER'S GIT ──────
// This guard reads `remote get-url origin` and `git grep` in the SLOT checkouts —
// other repositories, none of them the process's own cwd. Git exports GIT_DIR and
// GIT_INDEX_FILE into every hook process and they BEAT `-C`, so under such an
// environment every row would reconcile against THIS checkout's remote while
// printing the slot's name: a confident wrong answer, which is worse than none.
// Measured this day on tooling/scripts/assert-public-citations.mjs — 567 files of
// the private corpus while pointed at this tree's 2022.
test('the slot remote and grep reads go through repo-git.mjs, and the environment cannot redirect them', () => {
  const src = readFileSync(GUARD, 'utf8');
  assert.match(src, /from '\.\.\/scripts\/repo-git\.mjs'/, 'the guard no longer imports the helper — its slot reads depend on the caller environment again');
  assert.doesNotMatch(src, /execFileSync\(\s*'git',\s*\[\s*'-C'/, 'a raw `git -C` spawn is back in this guard; -C does not select a repository when GIT_DIR is exported');

  // MUTANT — the matcher must be able to see the shape it forbids, or it forbids nothing.
  const withRaw = src + "\nexecFileSync('git', ['-C', abs, 'remote', 'get-url', 'origin']);\n";
  assert.match(withRaw, /execFileSync\(\s*'git',\s*\[\s*'-C'/, 'the matcher cannot see a raw `git -C` spawn and is asserting nothing');

  // And the behaviour, not just the shape.
  const base = mkdtempSync(join(tmpdir(), 'github-matrix-gitenv-'));
  try {
    const mk = (dir, url) => {
      mkdirSync(dir, { recursive: true });
      const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
      g('init', '-q');
      g('config', 'user.email', 'f@e.test');
      g('config', 'user.name', 'f');
      g('remote', 'add', 'origin', url);
      writeFileSync(join(dir, 'f.txt'), 'x\n');
      g('add', '-A');
      g('commit', '-q', '-m', 'f', '--no-gpg-sign');
      return dir;
    };
    const slot = mk(join(base, 'slot'), 'https://github.com/example/slot.git');
    const other = mk(join(base, 'other'), 'https://github.com/example/other.git');
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
    process.env.GIT_DIR = join(other, '.git');
    process.env.GIT_INDEX_FILE = join(other, '.git', 'index');
    try {
      assert.match(repoGit(slot, 'remote', 'get-url', 'origin').trim(), /example\/slot\.git$/, 'the helper reported the remote of the repository the ENVIRONMENT named, not the slot it was given');
      const raw = spawnSync('git', ['-C', slot, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
      assert.match(raw.stdout.trim(), /example\/other\.git$/, 'the unguarded control did not read the other repository, so this case does not reproduce the defect');
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
