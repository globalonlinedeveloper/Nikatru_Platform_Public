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
/** Where the first-run prompt lives in both roots — limb 4's subject. */
const SUBLY_APP = `${SUBLY}/lib/app.dart`;
const BRICK_APP = `${BRICK}/lib/app.dart`;

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
    // removes this call. `lib/app.dart`'s first-run `_ConsentPrompt` still
    // supplies seams-wired's caller, so that guard stays at exit 0 on this exact
    // tree. (Until 2026-08-10 the caller named here was consent_prompt.dart's
    // dialog-shaped ConsentGate — deleted that day, and the argument is
    // unchanged because app.dart's prompt inherited its exact role.)
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

describe('the first-run prompt is scrollable — limb 4', () => {
  test('🔴 REMOVING THE SUBLY PROMPT\'S SCROLL VIEW FAILS', () => {
    // The real defect this limb was written for, reproduced on a copy of the
    // real tree: measured at 360×640 @2.0 the prompt overflowed by 644 px (en)
    // and 1180 px (ta) and laid "Allow" out at y 1140→1220 on a 640-tall
    // screen — a first-run modal nobody could answer.
    withTree(
      (root) => edit(root, SUBLY_APP, (s) => s.replace('child: SingleChildScrollView(', 'child: SizedBox(')),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /_ConsentPrompt .* renders consentPrivacy with NO scroll view/);
        assert.match(r.stderr, /360×640 with text scale 2\.0/);
      },
    );
  });

  test('🔴 AND FROM THE BRICK FAILS TOO — app #2 must not be born with it', () => {
    withTree(
      (root) => edit(root, BRICK_APP, (s) => s.replace('child: SingleChildScrollView(', 'child: SizedBox(')),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /renders consentPrivacy with NO scroll view/);
      },
    );
  });

  test('🔴 A SCROLL VIEW IN A DIFFERENT CLASS IN THE SAME FILE DOES NOT SATISFY IT', () => {
    // THE CASE THAT PROVES THE LIMB IS NOT A FILE-WIDE GREP. `lib/app.dart`
    // holds several widgets; a matcher over the file would have been satisfied
    // by any of their scroll views while the prompt itself had none — the
    // "assertion that cannot fail" this repository keeps paying for. Here the
    // prompt loses its scroll view and a NEIGHBOURING class gains one in the
    // same file, and the guard must still fail.
    withTree(
      (root) =>
        edit(root, SUBLY_APP, (s) =>
          s
            .replace('child: SingleChildScrollView(', 'child: SizedBox(')
            .replace(
              'class _NotificationTapGate extends ConsumerStatefulWidget {',
              'class _Decoy extends StatelessWidget {\n' +
                '  const _Decoy();\n' +
                '  @override\n' +
                '  Widget build(BuildContext context) => const SingleChildScrollView(child: SizedBox());\n' +
                '}\n\n' +
                'class _NotificationTapGate extends ConsumerStatefulWidget {',
            ),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /_ConsentPrompt .* renders consentPrivacy with NO scroll view/);
      },
    );
  });

  test('a tree where NO widget renders the sentence is COVERAGE LOST, not a pass', () => {
    // The scan losing its subject and the app having no defect print
    // identically unless this is asserted.
    withTree(
      (root) => {
        edit(root, SUBLY_APP, (s) => s.replaceAll('l10n.consentPrivacy', 'l10n.consentBody'));
        edit(root, BRICK_APP, (s) => s.replaceAll('l10n.consentPrivacy', 'l10n.consentBody'));
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NOT ONE widget class renders consentPrivacy/);
      },
    );
  });

  test('the generated l10n accessors are NOT mistaken for the prompt', () => {
    // `AppLocalizations` declares `String get consentPrivacy;` inside a class,
    // so a naive class scan finds it, finds no scroll view, and fails every app
    // on a generated file. `Widget build(` is what separates a surface from an
    // accessor — this case is why that clause exists.
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stderr, /AppLocalizations/);
        assert.match(r.stdout, /first-run prompt: _ConsentPrompt scrollable/);
      },
    );
  });
});

describe('what this guard does NOT assert, said out loud', () => {
  test('the first-run grant surface is reported, never required', () => {
    // Deleting the GRANT path is a real defect — there would be no way to say
    // yes — but it is assert-seams-wired.mjs's defect, and duplicating it here
    // would be the redundant assertion this repo deletes.
    //
    // ⚠️ THIS CASE USED TO `rmSync(apps/subly/lib/features/consent)`, WHICH HAS
    // NOT EXISTED SINCE 2026-08-10. With `force: true` that is a silent no-op,
    // so the case was asserting exit 0 on an UNMUTATED tree — an assertion that
    // cannot fail, which this repo treats as worse than none because it inflates
    // apparent coverage. It now removes the grant call that really is there.
    withTree(
      (root) => edit(root, SUBLY_APP, (s) => s.replace('recordAnalyticsConsent(ref, granted: granted);', '')),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /caller\(s\) of recordAnalyticsConsent\( live OUTSIDE/);
      },
    );
  });

  test('👤 the missing policy link PRINTS and does not fail', () => {
    // Owner-gated work is reported, never reddened — the rule apple-signing.mjs
    // follows for OWNER_QUEUE A-4. And the note is DERIVED, so it stops by
    // itself the day the key is wired up: proven by wiring it up.
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /👤 OWNER apps\/subly — consentReadPolicy/);
      },
    );
    withTree(
      (root) => edit(root, SUBLY_APP, (s) => s.replace('l10n.consentPrivacy', 'l10n.consentReadPolicy + l10n.consentPrivacy')),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stdout, /👤 OWNER apps\/subly — consentReadPolicy/);
      },
    );
  });
});
