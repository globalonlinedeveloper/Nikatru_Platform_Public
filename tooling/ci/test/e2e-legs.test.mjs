// ─────────────────────────────────────────────────────────────────────────────
// e2e-legs.test.mjs — the leg-coverage guard must be able to FAIL.
//
// [pipeline N-6 / F-10] EVERY test below runs against a MUTATED COPY OF THE REAL
// TREE — the real register, the real app_test.dart, the real apps/subly/lib, the
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
const SUITE = 'apps/subly/integration_test/app_test.dart';
const APP_LIB = 'apps/subly/lib';
const WORKFLOW = '.github/workflows/e2e.yml';
/** The E2E SURFACE the delete leg's blocker is now a predicate over: the named
 *  integration suite plus the nightly harness. It REPLACED a server-side pair
 *  (`no account route under services/subly-api` / `the platform route touches
 *  only PLATFORM_DB`) on 2026-08-04, when both went false — services/subly-api
 *  ships DELETE /v1/account behind an asymmetric-only boundary and the shared
 *  route relays to it. That server relation now lives in
 *  tooling/ci/assert-erasure-reach.mjs, with its own mutation tests. */
const E2E_HARNESS = 'tooling/e2e';

/** A real-tree copy carrying exactly what the guard reads. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-n6-legs-'));
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'apps/subly/integration_test'), { recursive: true });
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  cpSync(join(REPO, REGISTER), join(root, REGISTER));
  cpSync(join(REPO, SUITE), join(root, SUITE));
  cpSync(join(REPO, APP_LIB), join(root, APP_LIB), { recursive: true });
  cpSync(join(REPO, WORKFLOW), join(root, WORKFLOW));
  cpSync(join(REPO, E2E_HARNESS), join(root, E2E_HARNESS), { recursive: true });
  return root;
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
        reg.legs.find((l) => l.id === 'account-delete-purges').anchors = [
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
        reg.legs.find((l) => l.id === 'anonymous').anchors = [];
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
    // The blocker predicate reads apps/subly's own PaywallConfig declaration.
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
        const p = join(root, 'apps/subly/lib/state/providers/config.dart');
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
  //   v1 "apps/subly has no delete-account call site" — [ADR 027] shipped the control.
  //   v2 "no deployed route erases apps/subly own database" — services/subly-api
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
    const leg = reg.legs.find((l) => l.id === 'account-delete-purges');
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
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
      },
    );
  });

  test('a blocked leg with no blockedBy is rejected', () => {
    withTree(
      (root) => {
        const reg = readReg(root);
        delete reg.legs.find((l) => l.id === 'feature-unlock').blockedBy;
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
        reg.legs.find((l) => l.id === 'feature-unlock').blockedBy = 'because reasons';
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
        reg.legs.find((l) => l.id === 'feature-unlock').status = 'probably-fine';
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
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST.*does not exist/s);
      },
    );
  });

  test('register unparseable -> COVERAGE LOST', () => {
    withTree(
      (root) => writeFileSync(join(root, REGISTER), '{ not json'),
      (r) => {
        assert.equal(r.status, 1);
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
        reg.legs = reg.legs.filter((l) => l.id !== 'feature-unlock');
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /missing: feature-unlock/);
      },
    );
  });

  test('inventing an extra leg is COVERAGE LOST too', () => {
    withTree(
      (root) => {
        const reg = readReg(root);
        reg.legs.push({ id: 'vibes', status: 'asserted', anchors: ['void main('] });
        writeReg(root, reg);
      },
      (r) => {
        assert.equal(r.status, 1);
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
        assert.equal(r.status, 1);
        assert.match(r.stderr, /the named E2E apps\/subly\/integration_test\/app_test\.dart does not exist/);
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
        assert.equal(r.status, 1);
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
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not name/);
      },
    );
  });

  test('a missing workflow is COVERAGE LOST', () => {
    withTree(
      (root) => rmSync(join(root, WORKFLOW)),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /which does not exist/);
      },
    );
  });

  test('🔴 AN EMPTY APP TREE IS COVERAGE LOST — a predicate over nothing answers "still blocked"', () => {
    // Every blocker predicate reads apps/subly/lib. Over an empty string they
    // all cheerfully report "still blocked", which is a scan over nothing
    // printing ok — this repo's single most repeated failure.
    withTree(
      (root) => {
        rmSync(join(root, APP_LIB), { recursive: true, force: true });
        mkdirSync(join(root, APP_LIB), { recursive: true });
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no Dart source was read/);
      },
    );
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
