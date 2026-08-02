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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
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
  test('passes, and reports the honest 2-of-6', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /2 of 6 golden-path leg\(s\) claimed asserted and 2 proven/);
        assert.match(r.stdout, /equality holds/);
      },
    );
  });

  test('the four uncovered legs PRINT — a gap nobody sees is a gap nobody closes', () => {
    withTree(
      () => {},
      (r) => {
        assert.match(r.stdout, /4 of 6 golden-path leg\(s\) are NOT proven/);
        for (const id of ['purchase-sandbox', 'entitlement-flip', 'feature-unlock', 'account-delete-purges']) {
          assert.match(r.stdout, new RegExp(id));
        }
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
        const p = join(root, 'apps/subly/lib/state/providers.dart');
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

  test('🔴 WIRING A REAL deleteAccount CALL SITE KILLS THE DELETE-LEG EXCUSE', () => {
    withTree(
      (root) => {
        const p = join(root, 'apps/subly/lib/state/providers.dart');
        writeFileSync(p, `${readFileSync(p, 'utf8')}\n// added by the test\nvoid _wire(dynamic repo) { repo.deleteAccount(); }\n`);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`account-delete-purges` claims to be blocked/);
        assert.match(r.stderr, /has SHIPPED/);
      },
    );
  });

  test('the call-site predicate is NOT satisfied by the DECLARATION — the assert-seams-wired trap', () => {
    // `Future<void> deleteAccount() async` already exists in apps/subly/lib and
    // the delete leg is still correctly blocked on the real tree. Adding another
    // DECLARATION must not flip the blocker; only a `.deleteAccount(` CALL does.
    // Without the leading dot this test goes red, which is the whole check.
    withTree(
      (root) => {
        const p = join(root, 'apps/subly/lib/state/providers.dart');
        writeFileSync(p, `${readFileSync(p, 'utf8')}\nFuture<void> deleteAccount() async {}\n`);
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /account-delete-purges/);
      },
    );
  });

  test('a commented-out call site does not kill the excuse either', () => {
    withTree(
      (root) => {
        const p = join(root, 'apps/subly/lib/state/providers.dart');
        writeFileSync(p, `${readFileSync(p, 'utf8')}\n// repo.deleteAccount();\n`);
      },
      (r) => assert.equal(r.status, 0, r.stderr),
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
      for (const p of [REGISTER, SUITE, WORKFLOW, join(APP_LIB, 'state/providers.dart')]) {
        assert.ok(existsSync(join(root, p)), `${p} missing from the tree copy`);
        assert.equal(readFileSync(join(root, p), 'utf8'), readFileSync(join(REPO, p), 'utf8'), `${p} differs from the real tree`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
