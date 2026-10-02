// ─────────────────────────────────────────────────────────────────────────────
// e2e-legs.test.mjs — the leg-coverage guard must be able to FAIL.
//
// [pipeline N-6 / F-10] EVERY test below runs against a MUTATED COPY OF THE REAL
// TREE — the real register, the real app_test.dart, the real apps/subscriptiontracker/lib, the
// real e2e.yml — never a hand-written fixture. assert-seams-wired.mjs shipped
// with its caller check matching the function's own declaration and ALL SIX of
// its fixture tests passed against the broken version, because a fixture you
// write encodes the same misunderstanding as the guard you write. Only breaking
// the actual tree exposed it.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-e2e-legs.mjs');

const REGISTER = 'tooling/e2e-leg-register.json';
const SUITE = 'apps/subscriptiontracker/integration_test/app_test.dart';
const APP_LIB = 'apps/subscriptiontracker/lib';
const WORKFLOW = '.github/workflows/e2e.yml';
/** The E2E SURFACE the delete leg's blocker is now a predicate over: the named
 *  integration suite plus the nightly harness. It REPLACED a server-side pair
 *  (`no account route under services/subscriptiontracker-api` / `the platform route touches
 *  only PLATFORM_DB`) on 2026-08-04, when both went false — services/subscriptiontracker-api
 *  ships DELETE /v1/account behind an asymmetric-only boundary and the shared
 *  route relays to it. That server relation now lives in
 *  tooling/ci/assert-erasure-reach.mjs, with its own mutation tests. */
const E2E_HARNESS = 'tooling/e2e';
const WORKSPACE = 'pubspec.yaml';
const CHANNELS = 'tooling/channel-register.json';
const NATIVE_SUITE = 'apps/subscriptiontracker/integration_test/native_auth_proof_test.dart';

/** A real-tree copy carrying exactly what the guard reads. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-n6-legs-'));
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'apps/subscriptiontracker/integration_test'), { recursive: true });
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  cpSync(join(REPO, REGISTER), join(root, REGISTER));
  cpSync(join(REPO, SUITE), join(root, SUITE));
  cpSync(join(REPO, APP_LIB), join(root, APP_LIB), { recursive: true });
  cpSync(join(REPO, WORKFLOW), join(root, WORKFLOW));
  cpSync(join(REPO, E2E_HARNESS), join(root, E2E_HARNESS), { recursive: true });
  // 10b: the guard requires every app of the workspace set to carry its suite,
  // and reads the set from the root pubspec (tooling/ci/app-set.mjs).
  cpSync(join(REPO, WORKSPACE), join(root, WORKSPACE));
  // limb NATIVE (AB-E2E-02): the target catalog and the native suite.
  cpSync(join(REPO, CHANNELS), join(root, CHANNELS));
  cpSync(join(REPO, NATIVE_SUITE), join(root, NATIVE_SUITE));
  return root;
}

/** Adds `apps/<id>` to the copied workspace, with or without its suite. */
function addWorkspaceApp(root, id, { suite }) {
  const p = join(root, WORKSPACE);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^workspace:\n/m, () => `workspace:\n  - apps/${id}\n`));
  mkdirSync(join(root, 'apps', id, 'integration_test'), { recursive: true });
  if (suite) writeFileSync(join(root, 'apps', id, 'integration_test', 'app_test.dart'), 'void main() {}\n');
}

/** Stamps `apps/<id>` the way the brick does, as far as this guard reads it: the
 *  workspace entry, the brick's suite and the brick's providers (its paywall
 *  declaration), mustache left in place except the package name. */
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
function addStampedApp(root, id) {
  addWorkspaceApp(root, id, { suite: false });
  const put = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put(`apps/${id}/integration_test/app_test.dart`, readFileSync(join(REPO, BRICK_APP, 'integration_test/app_test.dart'), 'utf8').replaceAll('{{app_id.snakeCase()}}', id));
  put(`apps/${id}/lib/state/providers.dart`, readFileSync(join(REPO, BRICK_APP, 'lib/state/providers.dart'), 'utf8'));
}

/** Runs the stamp's e2e step over a tree copy, as post_gen does after mason. */
async function stampE2e(root) {
  const { planE2eEntries } = await import('../../kit/stamp-shared.mjs');
  const plan = planE2eEntries(root, { today: '2026-10-01' });
  assert.deepEqual(plan.lost, []);
  writeFileSync(join(root, REGISTER), plan.after);
  return plan;
}

/** Like withTree, for a mutation that awaits. */
async function withTreeAsync(mutate, fn) {
  const root = realTree();
  try {
    await mutate(root);
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const readReg = (root) => JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
const writeReg = (root, reg) => writeFileSync(join(root, REGISTER), JSON.stringify(reg, null, 2));

/** Mutate a real-tree copy, run the guard against it, hand back the result. */
function withTree(mutate, fn) {
  const root = realTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the real tree', () => {
  test('passes, and reports the honest 3-of-6', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /3 of 6 golden-path leg\(s\) claimed asserted and 3 proven/);
        assert.match(r.stdout, /equality holds/);
      },
    );
  });

  test('the three uncovered legs PRINT — a gap nobody sees is a gap nobody closes', () => {
    withTree(
      () => {},
      (r) => {
        assert.match(r.stdout, /3 of 6 golden-path leg\(s\) are NOT proven/);
        for (const id of ['purchase-sandbox', 'entitlement-flip', 'feature-unlock']) {
          assert.match(r.stdout, new RegExp(id));
        }
        // …and the leg that SHIPPED on 2026-08-08 is no longer among them. This
        // half of the assertion is the one that would have caught a promotion
        // that edited the status and left the leg uncovered.
        assert.doesNotMatch(r.stdout, /· account-delete-purges/);
      },
    );
  });

  test('the web-only cut is printed with its date and its could-not-establish', () => {
    withTree(
      () => {},
      (r) => {
        assert.match(r.stdout, /web only, by policy/);
        assert.match(r.stdout, /COULD-NOT-ESTABLISH/);
      },
    );
  });
});

describe('the equality — a claim the suite does not carry', () => {
  test('DELETING A LEG FROM THE REAL SUITE turns it red', () => {
    // The mutation that matters: the register still says two, the suite proves
    // one. This is the direction N-6 was failing in.
    withTree(
      (root) => {
        const p = join(root, SUITE);
        writeFileSync(p, readFileSync(p, 'utf8').replaceAll("shot('01-onboarding')", "shot('renamed')"));
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`anonymous` claims to be asserted/);
        assert.match(r.stderr, /01-onboarding/);
      },
    );
  });

  test('renaming the login key breaks the sign-in leg', () => {
    withTree(
      (root) => {
        const p = join(root, SUITE);
        writeFileSync(p, readFileSync(p, 'utf8').replaceAll('E2EKeys.loginSubmit', 'E2EKeys.somethingElse'));
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`sign-in` claims to be asserted/);
      },
    );
  });

  test('🔴 AN ANCHOR THAT SURVIVES ONLY IN A COMMENT DOES NOT COUNT', () => {
    // The load-bearing test. app_test.dart's own header already contains
    // `tap('Skip')` inside a comment describing the six-night outage, so a raw
    // includes() would resolve the onboarding leg against the PROSE ABOUT THE
    // BUG. Here the anchor is deleted from the code and re-inserted as a
    // comment; the guard must still go red.
    withTree(
      (root) => {
        const p = join(root, SUITE);
        const src = readFileSync(p, 'utf8').replaceAll("shot('01-onboarding')", 'shot("gone")');
        writeFileSync(p, `// shot('01-onboarding')\n${src}`);
      },
      (r) => {
        assert.equal(r.status, 1, 'a commented-out anchor was accepted as coverage');
        assert.match(r.stderr, /`anonymous` claims to be asserted/);
      },
    );
  });

  test('🔴 REMOVING THE DELETE CONTROL FROM THE SUITE TURNS LEG 6 RED', () => {
    // The mutation that matters for the leg promoted on 2026-08-08. The register
    // says the nightly walks an in-app account deletion; delete the key that
    // finds the control and the register is claiming a walk the suite no longer
    // takes. Same direction as the onboarding case above, on the newest claim —
    // which is the one nobody has watched break yet.
    withTree(
      (root) => {
        const p = join(root, SUITE);
        writeFileSync(
          p,
          readFileSync(p, 'utf8').replaceAll('E2EKeys.settingsDeleteAccount', 'E2EKeys.somethingElse'),
        );
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`account-delete-purges` claims to be asserted/);
        assert.match(r.stderr, /settingsDeleteAccount/);
      },
    );
  });

  test('🔴 AN ANCHOR THE REGISTER INVENTS, THAT IS NOT IN THE SUITE, IS REJECTED', () => {
    // The other side of the same equality, mutated from the REGISTER rather than
    // from the suite: a leg marked asserted whose anchor string simply is not in
    // the test source. Without this, "asserted" could be bought by writing a
    // convincing-looking anchor for a test nobody wrote — which is precisely the
    // "the record names an E2E" acceptance N-6 already had and that could not
    // fail.
    withTree(
      (root) => {
        const reg = readReg(root);
        reg.apps.subscriptiontracker.legs.find((l) => l.id === 'account-delete-purges').anchors = [
          "shot('20-account-deleted')",
          'E2EKeys.aKeyNobodyEverWrote',
        ];
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`account-delete-purges` claims to be asserted/);
        assert.match(r.stderr, /1 of its 2 anchor\(s\)/);
        assert.match(r.stderr, /aKeyNobodyEverWrote/);
      },
    );
  });

  test('an asserted leg with NO anchors is rejected, not counted', () => {
    withTree(
      (root) => {
        const reg = readReg(root);
        reg.apps.subscriptiontracker.legs.find((l) => l.id === 'anonymous').anchors = [];
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /marked asserted with no anchors/);
      },
    );
  });
});

describe('a blocked leg`s excuse is itself checked', () => {
  test('🔴 SWITCHING THE PAYWALL ON KILLS THE EXCUSE FOR THREE LEGS AT ONCE', () => {
    // The blocker predicate reads apps/subscriptiontracker's own PaywallConfig declaration.
    // The day somebody flips it to true, "blocked by the money rail" stops being
    // true and the guard says so — that is what stops the excuse outliving the
    // rail.
    withTree(
      (root) => {
        // `state/providers.dart` until 2026-09-04: the spine was split into
        // per-capability files behind that barrel and `kAppDefaultConfig` — the
        // declaration this mutation flips — went to `providers/config.dart`.
        // The guard itself reads the whole `lib` tree, so IT never stopped
        // seeing the declaration; only this mutation had to follow it.
        const p = join(root, 'apps/subscriptiontracker/lib/state/providers/config.dart');
        writeFileSync(p, readFileSync(p, 'utf8').replace('PaywallConfig(enabled: false)', 'PaywallConfig(enabled: true)'));
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /that blocker has SHIPPED/);
        for (const id of ['purchase-sandbox', 'entitlement-flip', 'feature-unlock']) {
          assert.match(r.stderr, new RegExp(`\`${id}\` claims to be blocked`));
        }
      },
    );
  });

  // 🔄 THE DELETE LEG'S EXCUSE HAS DIED THREE TIMES, AND THE THIRD DEATH IS THE
  // LEG SHIPPING.
  //   v1 "apps/subscriptiontracker has no delete-account call site" — [ADR 027] shipped the control.
  //   v2 "no deployed route erases apps/subscriptiontracker own database" — services/subscriptiontracker-api
  //      shipped DELETE /v1/account and the shared route began relaying to it.
  //   v3 "no e2e step exercises the erasure route against the deployed API" —
  //      2026-08-08: app_test.dart deletes a real account from inside the running
  //      app and tooling/e2e/verify_purged.mjs re-reads both stores afterwards.
  //
  // So the leg is `asserted` now and the v3 predicate is not consulted on a
  // passing run. The tests below keep it honest anyway, because the register is
  // one edit away from consulting it again — and a shipped leg quietly demoted
  // back to "blocked" is the regression these three catch.
  //
  // ⚠️ EVERY ONE OF THEM DEMOTES THE LEG FIRST. A test that asserted exit 0
  // against the register as it stands would be asserting nothing about this
  // predicate at all, which is the assertion-that-cannot-fail this repo deletes.

  /** Put leg 6 back on its dead excuse — the shape of a bad-faith (or careless)
   *  demotion, and the only input under which the v3 predicate still runs. */
  const demoteDeleteLeg = (root) => {
    const reg = readReg(root);
    const leg = reg.apps.subscriptiontracker.legs.find((l) => l.id === 'account-delete-purges');
    leg.status = 'blocked';
    leg.blockedBy = '[7] no e2e step exercises the erasure route against the deployed API';
    delete leg.anchors;
    writeReg(root, reg);
  };

  /** Turn every REAL mention of the erasure route in the E2E surface into a
   *  comment, and prove the mutation actually hit something. Without the count
   *  assertion this helper would silently become a no-op the day the route is
   *  spelled differently, and the two tests using it would pass over an
   *  unmutated tree — the fixture-that-encodes-the-same-belief failure. */
  const commentOutTheRoute = (root) => {
    let hits = 0;
    const files = [join(root, SUITE), ...readdirSync(join(root, E2E_HARNESS)).map((f) => join(root, E2E_HARNESS, f))];
    for (const p of files) {
      if (!/\.(mjs|js|ts|dart)$/.test(p)) continue;
      const src = readFileSync(p, 'utf8');
      if (!src.includes('/v1/account')) continue;
      hits += 1;
      writeFileSync(p, `${src.replaceAll('/v1/account', '/v1/redacted')}\n// DELETE /v1/account\n`);
    }
    assert.ok(hits > 0, 'no file in the E2E surface named /v1/account — this mutation tested nothing');
  };

  test('🔴 THE DEAD EXCUSE CANNOT BE PUT BACK — demoting the leg fails the build', () => {
    withTree(demoteDeleteLeg, (r) => {
      assert.equal(r.status, 1, 'a shipped leg was demoted back onto a dead excuse and the build stayed green');
      assert.match(r.stderr, /`account-delete-purges` claims to be blocked/);
      assert.match(r.stderr, /has SHIPPED/);
    });
  });

  test('a COMMENT mentioning the route does not resurrect the excuse', () => {
    // The comment-strip trap, fourth occurrence in this repo. With the real call
    // removed and only prose about it left, the excuse IS true again — so the
    // guard must accept the demotion. If it did not, a harness that merely
    // NARRATES an erasure step would read as one that performs it.
    withTree(
      (root) => {
        demoteDeleteLeg(root);
        commentOutTheRoute(root);
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /account-delete-purges/);
      },
    );
  });

  test('an unrelated new harness script does not kill the excuse', () => {
    // A guard that fired on any new file would be noise, and noise is what gets a
    // guard switched off.
    withTree(
      (root) => {
        demoteDeleteLeg(root);
        commentOutTheRoute(root);
        writeFileSync(join(root, E2E_HARNESS, 'unrelated.mjs'), 'export default 1;\n');
      },
      (r) => assert.equal(r.status, 0, r.stderr),
    );
  });

  test('🔴 A DELETE STEP ANYWHERE IN THE HARNESS KILLS IT AGAIN', () => {
    // …and one real call site is enough, from any file in the surface. This is
    // the v3 predicate's positive direction, re-proved on top of the neutralised
    // tree so it cannot pass on the route that is already there.
    withTree(
      (root) => {
        demoteDeleteLeg(root);
        commentOutTheRoute(root);
        writeFileSync(join(root, E2E_HARNESS, 'erase_user.mjs'), "await fetch(api + '/v1/account');\n");
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`account-delete-purges` claims to be blocked/);
        assert.match(r.stderr, /has SHIPPED/);
      },
    );
  });

  test('COVERAGE LOST when the e2e harness cannot be read at all', () => {
    // Over a missing harness the predicate answers "still blocked" for reasons
    // that have nothing to do with erasure, and the excuse would outlive the
    // nightly being deleted.
    withTree(
      (root) => rmSync(join(root, E2E_HARNESS), { recursive: true, force: true }),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
      },
    );
  });

  test('a blocked leg with no blockedBy is rejected', () => {
    withTree(
      (root) => {
        const reg = readReg(root);
        delete reg.apps.subscriptiontracker.legs.find((l) => l.id === 'feature-unlock').blockedBy;
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /BLOCKED with no `blockedBy`/);
      },
    );
  });

  test('a blocker with no predicate is rejected — a sentence is not a check', () => {
    withTree(
      (root) => {
        const reg = readReg(root);
        reg.apps.subscriptiontracker.legs.find((l) => l.id === 'feature-unlock').blockedBy = 'because reasons';
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no predicate in BLOCKERS_STILL_REAL/);
      },
    );
  });

  test('an unknown status is rejected — a third state is a third place to hide', () => {
    withTree(
      (root) => {
        const reg = readReg(root);
        reg.apps.subscriptiontracker.legs.find((l) => l.id === 'feature-unlock').status = 'probably-fine';
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /unknown status/);
      },
    );
  });
});

describe('coverage self-checks', () => {
  test('register deleted -> COVERAGE LOST', () => {
    withTree(
      (root) => rmSync(join(root, REGISTER)),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST.*does not exist/s);
      },
    );
  });

  test('register unparseable -> COVERAGE LOST', () => {
    withTree(
      (root) => writeFileSync(join(root, REGISTER), '{ not json'),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /could not be parsed/);
      },
    );
  });

  test('🔴 TRIMMING A LEG IS COVERAGE LOST, NOT A SMALLER PASS', () => {
    // The four uncovered legs are exactly the ones it would be convenient to
    // delete. A floor would have allowed it; an exact set does not.
    withTree(
      (root) => {
        const reg = readReg(root);
        reg.apps.subscriptiontracker.legs = reg.apps.subscriptiontracker.legs.filter((l) => l.id !== 'feature-unlock');
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /missing: feature-unlock/);
      },
    );
  });

  test('inventing an extra leg is COVERAGE LOST too', () => {
    withTree(
      (root) => {
        const reg = readReg(root);
        reg.apps.subscriptiontracker.legs.push({ id: 'vibes', status: 'asserted', anchors: ['void main('] });
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /unexpected: vibes/);
      },
    );
  });

  test('🔴 THE NAMED SUITE MISSING GETS ITS OWN MESSAGE, not an anchor failure', () => {
    // Negative-tested deliberately: an agent found a limb elsewhere in this repo
    // whose test passed for the wrong reason — a missing file already failing
    // through a JSON.parse catch while the test matched only /COVERAGE LOST/.
    // So this asserts the SPECIFIC sentence, and that no anchor message appears.
    withTree(
      (root) => rmSync(join(root, SUITE)),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /the named E2E apps\/subscriptiontracker\/integration_test\/app_test\.dart does not exist/);
        assert.doesNotMatch(r.stderr, /claims to be asserted/);
      },
    );
  });

  test('a suite gutted to comments is COVERAGE LOST, not a register problem', () => {
    withTree(
      (root) => {
        const p = join(root, SUITE);
        writeFileSync(p, readFileSync(p, 'utf8').split('\n').map((l) => `// ${l}`).join('\n'));
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /declares no `testWidgets\(`/);
      },
    );
  });

  test('the workflow no longer naming the suite is COVERAGE LOST', () => {
    withTree(
      (root) => {
        const p = join(root, WORKFLOW);
        writeFileSync(p, readFileSync(p, 'utf8').replaceAll('integration_test/app_test.dart', 'integration_test/other.dart'));
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /does not name/);
      },
    );
  });

  test('a missing workflow is COVERAGE LOST', () => {
    withTree(
      (root) => rmSync(join(root, WORKFLOW)),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /which does not exist/);
      },
    );
  });

  test('🔴 AN EMPTY APP TREE IS COVERAGE LOST — a predicate over nothing answers "still blocked"', () => {
    // Every blocker predicate reads apps/subscriptiontracker/lib. Over an empty string they
    // all cheerfully report "still blocked", which is a scan over nothing
    // printing ok — this repo's single most repeated failure.
    withTree(
      (root) => {
        rmSync(join(root, APP_LIB), { recursive: true, force: true });
        mkdirSync(join(root, APP_LIB), { recursive: true });
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /no Dart source was read/);
      },
    );
  });

  // ── 10b: every app of the workspace set carries integration_test/app_test.dart ──
  // ⏱ 2026-10-01 (rv2-newproduct-005): …and an `apps.<id>` entry. This case was
  // GREEN until today: a second app's suite existed and nothing graded a leg of it.
  test('a second workspace app WITH its suite but NO apps.<id> entry is exit 1, naming the app', () => {
    withTree(
      (root) => addWorkspaceApp(root, 'second', { suite: true }),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /\[apps\/second\] is in the workspace app set and tooling\/e2e-leg-register\.json has no `apps\.second` entry/);
        assert.match(r.stderr, /node tooling\/kit\/stamp-shared\.mjs/);
      },
    );
  });

  test('RC6 — a second workspace app WITHOUT app_test.dart is exit 1, naming the file', () => {
    withTree(
      (root) => addWorkspaceApp(root, 'second', { suite: false }),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /apps\/second\/integration_test\/app_test\.dart is missing/);
      },
    );
  });

  test('an empty workspace app set is COVERAGE LOST (2)', () => {
    withTree(
      (root) => writeFileSync(join(root, WORKSPACE), 'name: fixture_workspace\nworkspace:\n  - packages/core\n'),
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /assert-e2e-legs: .*declares no `workspace:` entry under apps\//);
      },
    );
  });

  // ── every E2E_ define a suite reads, e2e.yml passes (ST-T2 rider, LEAD RULING 34)
  // MEASURED on the real tree before the rider: exit 1, naming the brick's
  // suite and E2E_APP_ID; with the define on the flutter drive line, exit 0.
  describe('E2E_ defines the suites read are passed by the lane', () => {
    const BRICK_SUITE = 'tooling/bricks/app/__brick__/apps/{{app_id}}/integration_test/app_test.dart';
    const withBrickSuite = (root) => {
      mkdirSync(join(root, dirname(BRICK_SUITE)), { recursive: true });
      cpSync(join(REPO, BRICK_SUITE), join(root, BRICK_SUITE));
    };

    test('PASSES on the real workflow and the real brick suite', () => {
      withTree(withBrickSuite, (r) => {
        assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
        assert.match(r.stdout, /E2E_ define\(s\) the suites read, every one passed by \.github\/workflows\/e2e\.yml/);
      });
    });

    test('FAILS when flutter drive stops passing E2E_APP_ID, and names the reader', () => {
      withTree(
        (root) => {
          withBrickSuite(root);
          const w = join(root, WORKFLOW);
          const before = readFileSync(w, 'utf8');
          const after = before.replace(/ \\\n\s*--dart-define=E2E_APP_ID="\$E2E_APP_ID"/, '');
          assert.notEqual(after, before, 'the mutation must remove the define — a no-op mutation proves nothing');
          writeFileSync(w, after);
        },
        (r) => {
          assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
          assert.match(r.stderr, /integration_test\/app_test\.dart read\(s\) --dart-define E2E_APP_ID, and \.github\/workflows\/e2e\.yml never passes it/);
        },
      );
    });

    test('FAILS when the app suite starts reading an E2E_ define nobody passes', () => {
      withTree(
        (root) => {
          const f = join(root, SUITE);
          writeFileSync(f, `${readFileSync(f, 'utf8')}\nconst String _probe = String.fromEnvironment('E2E_NOBODY_PASSES');\n`);
        },
        (r) => {
          assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
          assert.match(r.stderr, /read\(s\) --dart-define E2E_NOBODY_PASSES/);
        },
      );
    });
  });

  test('the tree copy the other tests mutate really is the real one', () => {
    // Guards the harness itself: if realTree() ever stopped copying the real
    // files, every mutation above would be mutating a stub and passing for the
    // wrong reason.
    const root = realTree();
    try {
      for (const p of [
        REGISTER,
        SUITE,
        WORKFLOW,
        join(APP_LIB, 'state/providers.dart'),
        // The file the paywall mutation above actually edits. Without it this
        // self-check covered the barrel and not the declaration, which is the
        // gap that let that mutation silently become a no-op.
        join(APP_LIB, 'state/providers/config.dart'),
      ]) {
        assert.ok(existsSync(join(root, p)), `${p} missing from the tree copy`);
        assert.equal(readFileSync(join(root, p), 'utf8'), readFileSync(join(REPO, p), 'utf8'), `${p} differs from the real tree`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ⏱ 2026-09-29 · AB-E2E-02 — limb NATIVE. Every case mutates the REAL tree copy.
describe('limb NATIVE — every native catalog target has a leg or a declared equivalent', () => {
  const edit = (root, f) => { const reg = readReg(root); f(reg); writeReg(root, reg); };
  const wf = (root, f) => { const p = join(root, WORKFLOW); writeFileSync(p, f(readFileSync(p, 'utf8'))); };

  test('the real tree grades five native targets and prints them', () => {
    withTree(() => {}, (r) => {
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /native targets \(android, ios, linux, macos, windows\): 5 run/);
    });
  });

  // 🔴 THE RED CONTROL THE FINDING NAMES — on the base register (no
  // nativeTargets) this is the state the guard used to pass with exit 0.
  test('🔴 no nativeTargets at all: COVERAGE LOST, exit 2', () => {
    withTree((root) => edit(root, (reg) => { delete reg.nativeTargets; }), (r) => {
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /neither a leg nor a declared equivalent/);
    });
  });

  test('🔴 one target missing one leg (ios sign-in): exit 2, naming it', () => {
    withTree((root) => edit(root, (reg) => { delete reg.nativeTargets.targets.ios['sign-in']; }), (r) => {
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /ios: sign-in/);
    });
  });

  test('🔴 a target the catalog gains is ungraded until declared: exit 2', () => {
    withTree((root) => {
      const p = join(root, CHANNELS);
      const c = JSON.parse(readFileSync(p, 'utf8'));
      c.channels.push({ id: 'fuchsia-store', surface: 'app', platforms: ['fuchsia'] });
      writeFileSync(p, JSON.stringify(c));
    }, (r) => {
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /fuchsia: anonymous, sign-in, account-delete-purges/);
    });
  });

  test('🔴 a declared leg whose job can only start on an undeclared cron is never run: exit 1', () => {
    withTree((root) => wf(root, (y) => y.replace("- cron: '43 4 * * 0'", "- cron: '44 4 * * 0'")), (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /never run/);
    });
  });

  test('🔴 the native job gone from the workflow: exit 1', () => {
    withTree((root) => edit(root, (reg) => { reg.nativeTargets.job = 'native-gone'; }), (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /has no job `native-gone`/);
    });
  });

  test('🔴 a target dropped from the job matrix: exit 1', () => {
    withTree((root) => wf(root, (y) => y.replace(/\n {10}- windows\n/, '\n')), (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /does not list windows in its matrix/);
    });
  });

  test('🔴 the job no longer runs the native-auth-proof drive: exit 1', () => {
    withTree((root) => wf(root, (y) => y.replaceAll('node tooling/e2e/native_auth_proof.mjs', 'node tooling/e2e/other.mjs')), (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /does not run `node tooling\/e2e\/native_auth_proof\.mjs`/);
    });
  });

  test('🔴 an equivalent to a web leg that is not asserted: exit 1', () => {
    withTree((root) => edit(root, (reg) => { reg.nativeTargets.equivalents['account-delete-purges'].provenBy = 'hope'; }), (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /provenBy: "web"/);
    });
  });

  test('🔴 a native anchor that stopped resolving (the sign-in step deleted): exit 1', () => {
    withTree((root) => {
      const p = join(root, NATIVE_SUITE);
      writeFileSync(p, readFileSync(p, 'utf8').replace("debugPrint('NK_PROOF step=sign-in outcome=ok');", ''));
    }, (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /native leg "sign-in"/);
    });
  });

  // AB-O1-05 — the offline read, anchored in both suites.
  test('🔴 the offline read removed from the native suite: exit 1', () => {
    withTree((root) => {
      const p = join(root, NATIVE_SUITE);
      writeFileSync(p, readFileSync(p, 'utf8').replace('await expectListSurvivesOffline(seeded);', ''));
    }, (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /offlineRead/);
    });
  });

  test('🔴 the offline read removed from the web suite: exit 1', () => {
    withTree((root) => {
      const p = join(root, SUITE);
      writeFileSync(p, readFileSync(p, 'utf8').replace('expectListSurvivesOffline(subNameB)', 'Future<void>.value()'));
    }, (r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /offlineRead/);
    });
  });
});

// ⏱ 2026-10-01 · rv2-newproduct-005 (O-BRICK-STAMPS-NO-E2E-SUITE). The six legs
// are graded PER APP, each against its own suite. Before this, a second
// `apps.<id>` entry made this guard COVERAGE LOST, and without one a stamped
// app's legs were asserted against no suite. Each case is the real tree plus a
// brick-stamped `apps/probe`, the app the brick's CI probe stamps.
describe('per app — a stamped app is graded against its OWN suite', () => {
  test('the stamp writes the probe\'s entry: green, and the ok line grades both apps', async () => {
    await withTreeAsync(
      async (root) => {
        addStampedApp(root, 'probe');
        const plan = await stampE2e(root);
        assert.deepEqual(plan.added, ['probe']);
        assert.equal(readReg(root).apps.probe.userTables, undefined, 'the stamp invented backend tables');
      },
      (r) => {
        assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
        assert.match(r.stdout, /\[apps\/subscriptiontracker\] 3 of 6 golden-path leg\(s\) claimed asserted and 3 proven/);
        assert.match(r.stdout, /\[apps\/probe\] 2 of 6 golden-path leg\(s\) claimed asserted and 2 proven by apps\/probe\/integration_test\/app_test\.dart/);
        assert.match(r.stdout, /account-delete-purges — \[7\] apps\/probe\/integration_test\/app_test\.dart walks no account deletion/);
        assert.match(r.stdout, /apps\.<id> entry \(apps=2\)/);
      },
    );
  });

  // 🔴 THE RED CONTROL THE FINDING NAMES.
  test('🔴 the probe\'s entry with one anchor removed from ITS app_test.dart is red, naming apps/probe', async () => {
    await withTreeAsync(
      async (root) => {
        addStampedApp(root, 'probe');
        await stampE2e(root);
        const p = join(root, 'apps/probe/integration_test/app_test.dart');
        const before = readFileSync(p, 'utf8');
        const after = before.replace('expect(find.byType(HomeScreen), findsWidgets);', '');
        assert.notEqual(after, before);
        writeFileSync(p, after);
      },
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(
          r.stderr,
          /\[apps\/probe\] `sign-in` claims to be asserted, but 1 of its 2 anchor\(s\) no longer resolve in apps\/probe\/integration_test\/app_test\.dart/,
        );
        assert.doesNotMatch(r.stderr, /\[apps\/subscriptiontracker\]/);
      },
    );
  });

  test('🔴 a blocker is evaluated over THAT app: the probe switching its paywall on kills only ITS excuse', async () => {
    await withTreeAsync(
      async (root) => {
        addStampedApp(root, 'probe');
        await stampE2e(root);
        const p = join(root, 'apps/probe/lib/state/providers.dart');
        const before = readFileSync(p, 'utf8');
        const after = before.replace('PaywallConfig(enabled: false)', 'PaywallConfig(enabled: true)');
        assert.notEqual(after, before);
        writeFileSync(p, after);
      },
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /\[apps\/probe\] `purchase-sandbox` claims to be blocked by "\[5\] apps\/probe sells nothing", but that blocker has SHIPPED/);
        assert.doesNotMatch(r.stderr, /\[apps\/subscriptiontracker\] `purchase-sandbox`/);
      },
    );
  });

  test('🔴 a leg credited to another app\'s blocker has no predicate: exit 1', async () => {
    await withTreeAsync(
      async (root) => {
        addStampedApp(root, 'probe');
        await stampE2e(root);
        const reg = readReg(root);
        reg.apps.probe.legs.find((l) => l.id === 'feature-unlock').blockedBy = '[5] apps/subscriptiontracker sells nothing';
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /\[apps\/probe\] `feature-unlock` claims to be blocked by "\[5\] apps\/subscriptiontracker sells nothing", which has no predicate/);
      },
    );
  });

  test('a top-level `legs` list again is COVERAGE LOST (2)', () => {
    withTree(
      (root) => {
        const reg = readReg(root);
        reg.legs = reg.apps.subscriptiontracker.legs;
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /still carries a top-level `legs`/);
      },
    );
  });

  test('the stamp is idempotent: a second run over a stamped tree adds nothing', async () => {
    const root = realTree();
    try {
      addStampedApp(root, 'probe');
      await stampE2e(root);
      const { planE2eEntries } = await import('../../kit/stamp-shared.mjs');
      const again = planE2eEntries(root);
      assert.deepEqual(again.added, []);
      assert.equal(again.after, again.before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
