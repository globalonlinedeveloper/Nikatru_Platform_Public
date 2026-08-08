// ─────────────────────────────────────────────────────────────────────────────
// consent-withdrawal-surface.test.mjs — the negative cases for
// assert-consent-withdrawal-surface.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture —
// and in this guard's family that is not a stylistic preference. The guard this
// one supplements, assert-seams-wired.mjs, shipped with its caller check
// matching the function's own DECLARATION: deleting every real caller still
// passed, ALL SIX OF ITS FIXTURE TESTS WERE GREEN, and only mutating the real
// brick exposed it. A fixture you write encodes the same misunderstanding as
// the guard you write.
//
// 🔬 THE BASELINE CASE IS ITSELF A MEASUREMENT. Before the brick's settings
// screen gained a withdrawal row, this guard failed on the BRICK and passed on
// apps/subly — that asymmetry is what it was written to report, and it is
// recorded in the first case below so a future reader can tell a fixed defect
// from a defect that was never there.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-consent-withdrawal-surface.mjs');

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const SUBLY = 'apps/subly';
const BRICK_SETTINGS = `${BRICK}/lib/features/settings/settings_screen.dart`;
const SUBLY_SETTINGS = `${SUBLY}/lib/features/settings/settings_screen.dart`;
const SUBLY_RAIL = `${SUBLY}/lib/state/analytics_providers.dart`;
const BRICK_RAIL = `${BRICK}/lib/state/providers.dart`;

/** A real-tree copy carrying exactly what the guard reads: the workspace list
 *  and both roots' lib/ trees. Nothing else is read, so nothing else is copied. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-withdrawal-'));
  cpSync(join(REPO, 'pubspec.yaml'), join(root, 'pubspec.yaml'));
  for (const r of [BRICK, SUBLY]) {
    mkdirSync(join(root, r), { recursive: true });
    cpSync(join(REPO, r, 'lib'), join(root, r, 'lib'), { recursive: true });
  }
  return root;
}

function withTree(mutate, fn) {
  const root = realTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const edit = (root, rel, fn) => {
  const p = join(root, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};

describe('the real tree', () => {
  test('passes, and names both roots', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /2 of 2 root\(s\) carry an analytics rail/);
        assert.match(r.stdout, /apps\/subly/);
      },
    );
  });

  test('the copy the other tests mutate really carries the rows', () => {
    // Without this, every "deletion caught" below could be an artefact of a
    // stand-in rather than evidence about the screens that ship.
    withTree(
      () => {},
      () => {
        for (const rel of [SUBLY_SETTINGS, BRICK_SETTINGS]) {
          assert.ok(
            readFileSync(join(REPO, rel), 'utf8').includes('recordAnalyticsConsent('),
            `${rel} must really carry the withdrawal call`,
          );
        }
      },
    );
  });
});

describe('the row itself — limb 1', () => {
  test('🔴 DELETING THE SUBLY SETTINGS ROW FAILS, AND assert-seams-wired WOULD NOT', () => {
    // The measured P2.6b risk: a wholesale apply of the stamped settings screen
    // removes this call. consent_prompt.dart still supplies seams-wired's
    // caller, so that guard stays at exit 0 on this exact tree.
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('recordAnalyticsConsent(', '_noopConsent(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /apps\/subly: NO call to recordAnalyticsConsent\(/);
        assert.match(r.stderr, /assert-seams-wired\.mjs stays GREEN on this exact tree/);
      },
    );
  });

  test('🔴 AND FROM THE BRICK FAILS TOO — the template is app #2 through #50', () => {
    withTree(
      (root) => edit(root, BRICK_SETTINGS, (s) => s.replaceAll('recordAnalyticsConsent(', '_noopConsent(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NO call to recordAnalyticsConsent\(/);
      },
    );
  });

  test('🔴 COMMENTING THE CALL OUT FAILS — the one edit a raw grep cannot see', () => {
    // assert-seams-wired.mjs matched RAW source until 2026-08-02 and a single
    // `//` left it printing ok for a seam with no caller at all.
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replace('() => recordAnalyticsConsent(', '() => _x( // recordAnalyticsConsent(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NO call to recordAnalyticsConsent\(/);
      },
    );
  });

  test('🔴 A DECLARATION IN THE SETTINGS TREE DOES NOT SATISFY THE CALL CHECK', () => {
    withTree(
      (root) => {
        edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('recordAnalyticsConsent(', '_noopConsent('));
        edit(root, SUBLY_SETTINGS, (s) => `${s}\nFuture<void> recordAnalyticsConsent(\n  WidgetRef ref, {\n  required bool granted,\n}) async {}\n`);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /DECLARES recordAnalyticsConsent/);
      },
    );
  });
});

describe('withdrawal-CAPABLE — limb 2', () => {
  test('🔴 A ROW THAT CAN ONLY GRANT FAILS, THOUGH LIMB 1 IS SATISFIED', () => {
    withTree(
      (root) =>
        edit(root, SUBLY_SETTINGS, (s) =>
          s.replace(
            /granted:\s*\n?\s*ref\.read\(analyticsConsentProvider\) !=\s*\n?\s*core\.ConsentStatus\.granted,/m,
            'granted: true,',
          ),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /passes `granted: true`/);
      },
    );
  });
});

describe('state-reflecting — limb 3', () => {
  test('a control that never reads the current value fails', () => {
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.split('analyticsConsentProvider').join('kAlwaysOn')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never reads analyticsConsentProvider/);
      },
    );
  });
});

describe('REQUIRED_COVERAGE — the scan must know when it has stopped scanning', () => {
  test('🔴 A MOVED SETTINGS DIRECTORY IS COVERAGE LOST, NOT A MISSING ROW', () => {
    // "No withdrawal row found" and "the directory I read is gone" are the same
    // output from a text matcher and completely different facts.
    withTree(
      (root) => renameSync(join(root, SUBLY, 'lib/features/settings'), join(root, SUBLY, 'lib/features/prefs')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /NO lib\/features\/settings directory/);
      },
    );
  });

  test('🔴 NO CONSENT RAIL ANYWHERE IS COVERAGE LOST — every limb is gated on that judgement', () => {
    withTree(
      (root) => {
        for (const rel of [SUBLY_RAIL, BRICK_RAIL]) edit(root, rel, (s) => s.replaceAll('recordAnalyticsConsent', 'recordSomethingElse'));
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /not one of the 2 root\(s\) was judged to carry an analytics consent rail/);
      },
    );
  });

  test('a rail in only ONE root is COVERAGE LOST — the brick and a real app are both required', () => {
    withTree(
      (root) => edit(root, BRICK_RAIL, (s) => s.replaceAll('recordAnalyticsConsent', 'recordSomethingElse')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /only 1 root\(s\) carry a consent rail/);
      },
    );
  });

  test('a root pubspec with no workspace block is COVERAGE LOST', () => {
    withTree(
      (root) => edit(root, 'pubspec.yaml', (s) => s.replace(/^workspace:$/m, 'workspace_disabled:')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no readable `workspace:` block/);
      },
    );
  });
});

describe('what this guard does NOT assert, said out loud', () => {
  test('the first-run grant surface is reported, never required', () => {
    // Deleting consent_prompt.dart is a real defect — there would be no way to
    // GRANT — but it is assert-seams-wired.mjs's defect, and duplicating it here
    // would be the redundant assertion this repo deletes.
    withTree(
      (root) => rmSync(join(root, SUBLY, 'lib/features/consent'), { recursive: true, force: true }),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /caller\(s\) of recordAnalyticsConsent\( live OUTSIDE/);
      },
    );
  });
});
