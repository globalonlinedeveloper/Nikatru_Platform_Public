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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, renameSync } from 'node:fs';
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
/** Where a promotional card would land — limbs 5 and 6's subject. Also the file
 *  that really calls `CatchUpNudge().decide(`, which those limbs must NOT
 *  claim. */
const SUBLY_HOME = `${SUBLY}/lib/features/home/home_screen.dart`;
const BRICK_HOME = `${BRICK}/lib/features/home/home_screen.dart`;

/** core's purpose declarations — the notice check's subject. */
const CORE_CONSENT = 'packages/core/lib/src/analytics/consent.dart';
/** The pinned notice the promo artifacts cite — DERIVED from the app's own
 *  constant, exactly as the guard derives it. Hardcoding the date here would
 *  turn an owner publishing a new policy into a red test in a file that has
 *  nothing to say about which policy is current. */
const POLICY = `sites/nikatru/legal/${
  readFileSync(join(REPO, SUBLY_RAIL), 'utf8').match(/kPrivacyPolicyVersion\s*=\s*'([^']+)'/)[1]
}/en/privacy.html`;

/** A real-tree copy carrying exactly what the guard reads: the workspace list,
 *  both roots' lib/ trees, core's consent purposes and the published notice.
 *  Nothing else is read, so nothing else is copied. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-withdrawal-'));
  cpSync(join(REPO, 'pubspec.yaml'), join(root, 'pubspec.yaml'));
  for (const r of [BRICK, SUBLY]) {
    mkdirSync(join(root, r), { recursive: true });
    cpSync(join(REPO, r, 'lib'), join(root, r, 'lib'), { recursive: true });
  }
  for (const f of [CORE_CONSENT, POLICY]) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(REPO, f), join(root, f));
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
          const src = readFileSync(join(REPO, rel), 'utf8');
          assert.ok(src.includes('recordAnalyticsConsent('), `${rel} must really carry the withdrawal call`);
          assert.ok(src.includes('recordPromoObjection('), `${rel} must really carry the Art 21 objection call`);
        }
      },
    );
  });

  test('and it reports the objection rail in both roots', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /Art 21 objection — 2 root\(s\) carry the promo rail/);
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
        // BOTH writers, because a root that declares the promo one and not the
        // analytics one is its own (correct) coverage failure — see the case
        // two tests below. This mutation is about "no rails at all".
        for (const rel of [SUBLY_RAIL, BRICK_RAIL]) {
          edit(root, rel, (s) => s.replaceAll('recordAnalyticsConsent', 'recordSomethingElse').replaceAll('recordPromoObjection', 'recordSomethingElser'));
        }
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /not one of the 2 root\(s\) was judged to carry an analytics consent rail/);
      },
    );
  });

  test('a rail in only ONE root is COVERAGE LOST — the brick and a real app are both required', () => {
    withTree(
      (root) => edit(root, BRICK_RAIL, (s) => s.replaceAll('recordAnalyticsConsent', 'recordSomethingElse').replaceAll('recordPromoObjection', 'recordSomethingElser')),
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

// ─────────────────────────────────────────────────────────────────────────────
// THE Art 21 OBJECTION ROW — research/44 rung 4. Same three limbs, same
// mutations, against the same real tree. It is a SEPARATE describe rather than
// extra assertions on the cases above because the two rows fail independently:
// an app can ship a perfect analytics toggle and no way to stop offers, which is
// exactly the state every app was in before this rung landed.
// ─────────────────────────────────────────────────────────────────────────────
describe('the stop-offers row — the promo twin of all three limbs', () => {
  test('🔴 DELETING THE SUBLY OBJECTION ROW FAILS', () => {
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('recordPromoObjection(', '_noopObjection(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /apps\/subly: declares recordPromoObjection and there is NO call to it/);
        assert.match(r.stderr, /the card can never be the way back/);
      },
    );
  });

  test('🔴 AND FROM THE BRICK FAILS TOO — every app the factory stamps inherits it', () => {
    withTree(
      (root) => edit(root, BRICK_SETTINGS, (s) => s.replaceAll('recordPromoObjection(', '_noopObjection(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NO call to it in lib\/features\/settings/);
      },
    );
  });

  test('🔴 COMMENTING THE CALL OUT FAILS — comments are blanked before any match', () => {
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replace('recordPromoObjection(ref,', '_x( // recordPromoObjection(ref,')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NO call to it in lib\/features\/settings/);
      },
    );
  });

  test('🔴 A DECLARATION IN THE SETTINGS TREE DOES NOT SATISFY THE CALL CHECK', () => {
    withTree(
      (root) => {
        edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('recordPromoObjection(', '_noopObjection('));
        edit(root, SUBLY_SETTINGS, (s) => `${s}\nFuture<void> recordPromoObjection(\n  WidgetRef ref, {\n  required bool objected,\n}) async {}\n`);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /DECLARES recordPromoObjection/);
      },
    );
  });

  test('🔴 A ROW THAT CAN ONLY STOP FAILS — Art 21 needs the way back', () => {
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replace('recordPromoObjection(ref, objected: objected)', 'recordPromoObjection(ref, objected: true)')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /passes `objected: true`/);
        assert.match(r.stderr, /a duty to stay objected/);
      },
    );
  });

  test('🔴 A CONTROL THAT CANNOT RENDER ITS OWN STATE FAILS', () => {
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.split('promoObjectedProvider').join('kNeverObjected')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never reads promoObjectedProvider/);
      },
    );
  });
});

describe('REQUIRED_COVERAGE for the objection rail', () => {
  test('🔴 HALF AN ADOPTION IS COVERAGE LOST — the brick alone leaves the shipped app without it', () => {
    withTree(
      (root) => edit(root, BRICK_RAIL, (s) => s.replaceAll('recordPromoObjection', 'recordSomethingElse')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /exactly ONE root carries the Art 21 objection rail/);
      },
    );
  });

  test('🔴 A ROOT WITH A PROMO RAIL AND NO ANALYTICS RAIL IS COVERAGE LOST, NOT A PASS', () => {
    // Every limb hangs off the analytics derivation, so such a root would be
    // skipped entirely and its objection row would go unchecked while the guard
    // printed a reassuring note. That is a hole in the SCAN.
    withTree(
      (root) => edit(root, BRICK_RAIL, (s) => s.replaceAll('recordAnalyticsConsent', 'recordSomethingElse')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /declares recordPromoObjection but NOT recordAnalyticsConsent/);
      },
    );
  });

  test('a tree that has NOT adopted rung 4 passes and says so — the guard is silent, not blind', () => {
    // The check that this guard does not become a build-blocker for every app
    // and template that has no promo surface at all.
    withTree(
      (root) => {
        for (const rel of [SUBLY_RAIL, BRICK_RAIL]) edit(root, rel, (s) => s.replaceAll('recordPromoObjection', 'recordSomethingElse'));
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /no root declares recordPromoObjection, so none owes a stop-offers control/);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMBS 5 + 6 — THE PROMOTIONAL CREATIVE CANNOT BYPASS THE RAIL OR THE FRAME.
//
// 🔬 THE MUTATION IS NOT INVENTED. It is a transcription of the sibling rung-3
// increment as it was actually written (`scratchpad/patches/
// r3-promocard-surface-v2.patch`): a `promoGateProvider`, a `.decide(` spanning
// three lines off `ref.watch(...)`, and a card rendered with no `PromoSurface`
// anywhere in the file. The invariant it violates was, at that moment, a
// sentence in a doc comment claiming to be *"the only sanctioned way"* — and a
// claim with no assertion under it is the shape [pipeline C-6] is about. These
// cases exist so that sentence stops being the enforcement.
//
// 🔴 REWRITTEN 2026-08-10, AND THE REASON IS THE THING THESE CASES ASKED FOR.
// This block was authored against a tree whose home screens had NOT yet been
// wired through `PromoObjection`/`PromoSurface`: its header said "the real tree
// names no promo gate at all, so limbs 5 and 6 are SILENT on it today", and
// every case APPENDED its mutation to the real `home_screen.dart`. The D2
// signature landed the wiring the guard was demanding, so both premises are now
// false — the real tree decides a promotion in BOTH roots, correctly.
//
// Appending then measured the wrong thing: limb 6 is a claim about a FILE ("this
// file decides a promotion and never names PromoSurface"), so a bypass appended
// to a file that already names the frame satisfies limb 6 and the negative case
// silently stopped covering half of what it claimed. The mutations therefore go
// into a NEW file under the app's lib/ tree, which is also the realistic
// regression: the next chip adds its own promotional widget in its own file.
//
// The baseline for "silent, not blind" moved with it — a tree with no promo gate
// has to be MADE, by removing the wiring, rather than found.
// ─────────────────────────────────────────────────────────────────────────────
describe('the promotional creative — limbs 5 and 6', () => {
  /** The sibling chip's shape, verbatim in structure: a provider-held gate, a
   *  multi-line `.decide(`, and no frame. */
  const BYPASS = `
class _UpgradePromoCard extends ConsumerWidget {
  const _UpgradePromoCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.PromoGateDecision decision = ref
        .watch(promoGateProvider)
        .decide(
          ref.watch(promoCardStateProvider).valueOrNull ?? const core.PromoGateState(),
          now: DateTime.now(),
          featureEnabled: true,
          hasContent: true,
        );
    if (decision.verdict != core.PromoGateVerdict.show) return const SizedBox.shrink();
    return const Text('upgrade');
  }
}
`;

  /** The same card, through the rail and inside the frame. */
  const SANCTIONED = `
class _UpgradePromoCard extends ConsumerWidget {
  const _UpgradePromoCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.PromoGateDecision decision = core.PromoObjection(ref.watch(railProvider)).decide(
          ref.watch(promoGateProvider),
          const core.PromoGateState(),
          now: DateTime.now(),
          featureEnabled: true,
          hasContent: true,
        );
    return PromoSurface(
      show: decision.verdict == core.PromoGateVerdict.show,
      objected: ref.watch(promoObjectedProvider),
      onObjectionChanged: (bool o) => recordPromoObjection(ref, objected: o),
      child: const Text('upgrade'),
    );
  }
}
`;

  /** The mutations land in their OWN file, never appended to a home screen that
   *  already carries the sanctioned shape — see the block header. `addFile` is
   *  the whole difference between testing limb 6 and testing nothing. */
  const NEW_CARD = (root, rel) => `${root}/lib/features/home/${rel}`;
  const addFile = (root, r, rel, body) => {
    writeFileSync(join(root, NEW_CARD(r, rel)), body);
  };

  /** Make a tree that promotes nothing.
   *
   *  🔴 IT HAS TO BE THE WHOLE TOKEN, IN EVERY lib FILE, because the
   *  classifier is `/promogate/i` over a file's text — and `promoGateProvider`
   *  is DECLARED in `state/providers.dart`, not only used in the home screen.
   *  Editing the home screens alone leaves the gate named, which puts the guard
   *  in "a gate is named and nothing decides" — COVERAGE LOST, which is a
   *  different case with its own test above. Renaming the token everywhere is
   *  the only faithful model of an app that simply has no promo gate.
   *
   *  The `.decide(` calls survive the rename and are then classified as
   *  non-promo, which is exactly the world this case is about. */
  const walkDart = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkDart(p, out);
      else if (e.name.endsWith('.dart')) out.push(p);
    }
    return out;
  };
  const unwire = (root) => {
    let renamed = 0;
    for (const r of [SUBLY, BRICK]) {
      for (const p of walkDart(join(root, r, 'lib'))) {
        const src = readFileSync(p, 'utf8');
        if (!/promogate/i.test(src)) continue;
        writeFileSync(p, src.replace(/promogate/gi, 'QuietGate'));
        renamed++;
      }
    }
    // The premise, asserted: if nothing carried the token, this helper would be
    // a no-op and the case below would pass against the unmutated tree — an
    // assertion that cannot fail.
    assert.ok(renamed >= 2, `expected the promo gate to be named in both roots, renamed it in ${renamed} file(s)`);
  };

  test('🔴 THE SIBLING CHIP\'S ACTUAL SHAPE FAILS — both limbs, one mutation', () => {
    withTree(
      (root) => addFile(root, SUBLY, 'promo_bypass.dart', BYPASS),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /reaches PromoGate\.decide WITHOUT PromoObjection/);
        assert.match(r.stderr, /decides a promotion and never names PromoSurface/);
        assert.match(r.stderr, /both halves report healthy/);
        // …and it names the NEW file, not the correctly-wired home screen —
        // otherwise this case would pass off the real tree's own call site as
        // the defect it introduced.
        assert.match(r.stderr, /promo_bypass\.dart/);
      },
    );
  });

  test('🔴 AND IN THE BRICK — every app the factory stamps would inherit the bypass', () => {
    withTree(
      (root) => addFile(root, BRICK, 'promo_bypass.dart', BYPASS),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /reaches PromoGate\.decide WITHOUT PromoObjection/);
        assert.match(r.stderr, /promo_bypass\.dart/);
      },
    );
  });

  test('🔴 THROUGH THE RAIL BUT OUTSIDE THE FRAME STILL FAILS — limb 6 alone', () => {
    // The half-fix that would otherwise look like a fix: the objection reaches
    // the gate, and the card that renders still carries neither the promotional
    // label nor the on-card control.
    withTree(
      (root) => addFile(root, SUBLY, 'promo_unframed.dart', SANCTIONED.replace(/PromoSurface/g, 'Card')),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /never names PromoSurface/);
        assert.match(r.stderr, /promo_unframed\.dart/);
        assert.doesNotMatch(r.stderr, /WITHOUT PromoObjection/);
      },
    );
  });

  test('the sanctioned shape PASSES — the limbs are satisfiable, not merely strict', () => {
    // An assertion nothing can satisfy is a guard people delete. This is the
    // positive case, and it is also the fix the two failing cases above are
    // asking for, written out.
    //
    // 3 = the two the real tree already carries (one per root, landed by the D2
    // signature) plus this one. The baseline 2 is asserted by `the real tree`
    // block above, so the arithmetic is anchored in one place: if the wiring is
    // ever removed, that case reddens first and this number is not the clue.
    withTree(
      (root) => addFile(root, SUBLY, 'promo_extra.dart', SANCTIONED),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /2 root\(s\) decide a promotion, 3 call site\(s\), every one through PromoObjection/);
      },
    );
  });

  test('a NON-promo `.decide(` is not classified — ReviewGate and CatchUpNudge are not this guard\'s', () => {
    // `apps/subly/lib/features/home/home_screen.dart` really does call
    // `const core.CatchUpNudge().decide(` — if the classifier keyed on the
    // METHOD NAME this guard would fail an unrelated seam. The home screen also
    // carries a real promo decision, so this is the discriminating case: two
    // `.decide(` calls in ONE file, exactly one of them counted.
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /2 call site\(s\), every one through PromoObjection/);
        assert.doesNotMatch(r.stderr, /CatchUpNudge/);
        // The premise, asserted rather than assumed: if the nudge ever stopped
        // living in that file, "it was not counted" would be true for the wrong
        // reason and this case would prove nothing.
        assert.ok(
          readFileSync(join(REPO, SUBLY_HOME), 'utf8').includes('CatchUpNudge().decide('),
          `${SUBLY_HOME} must really carry a non-promo .decide( for this case to discriminate`,
        );
      },
    );
  });

  test('🔴 A PROMO GATE WITH NO CLASSIFIED `.decide(` IS COVERAGE LOST, NOT A PASS', () => {
    // The classifier silently ceasing to match and the tree being clean print
    // identically. Mutation: the gate stays NAMED everywhere (so the limbs
    // engage) and every promo `.decide(` is renamed away, which is exactly what
    // a rename of `PromoGate.decide` would do to this scan.
    withTree(
      (root) => {
        for (const home of [SUBLY_HOME, BRICK_HOME]) {
          edit(root, home, (s) => s.replace(/\.decide\(\n(\s*)ref\.watch\(promoGateProvider\)/, '.judge(\n$1ref.watch(promoGateProvider)'));
        }
      },
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /NOT ONE `\.decide\(` was classified as one/);
      },
    );
  });

  test('a tree with no promo gate PASSES and says so — silent, not blind', () => {
    // The tree that promotes nothing has to be MADE now that both roots
    // promote. Every remaining `.decide(` is a CatchUpNudge, so the limbs must
    // go quiet rather than fire — silence here is the assertion.
    withTree(unwire, (r) => {
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /no root names a promo gate, so none can bypass PromoObjection or PromoSurface/);
    });
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

  test('👤 the notice that does not describe the basis PRINTS, and CLEARS ITSELF', () => {
    // Owner-gated: publishing legal copy is ADR 031 class B, and a guard that
    // reddens CI on work only the owner can do is a guard people switch off.
    // The value of the line is that it is DERIVED from three trees — core's
    // bases, the app's pinned version, the published words — so it disappears
    // on the day the notice is fixed and appears on the day a purpose is added.
    // Both halves are proven, because a note that could not clear would just be
    // a permanent banner nobody reads.
    //
    // 🔴 THE TWO HALVES SWAPPED PLACES ON 2026-08-10, AND THAT IS THE NOTE
    // DOING ITS JOB. This case used to read the real tree and assert the line
    // PRINTS; the owner then published privacy.html §3, which states the
    // legitimate-interest basis and the objection right, and the archived
    // snapshot the guard pins went with it. So the real tree is now the CLEARED
    // half, and the printing half is what has to be manufactured — by taking
    // the words back out of the pinned notice. Neither half was deleted: a
    // "clears itself" claim proven only in the direction the tree happens to be
    // in is a claim about today, not about the mechanism.
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stdout, /👤 OWNER the pinned notice/);
        // ⚠️ "NO NOTE" IS NOT SELF-EVIDENTLY GOOD NEWS, and the count that used
        // to be asserted here only exists INSIDE the note — so it cannot be
        // read in the cleared direction. The two facts it guarded are covered,
        // each by a case that can fail on its own: the second half below
        // manufactures the note by taking the words out of the notice, and
        // `an extractor that stops finding the purposes SAYS SO` covers a
        // silent extractor. What must never happen is this half standing
        // alone — a `doesNotMatch` on an unmutated tree is satisfied equally by
        // a working guard and a guard that printed nothing at all.
      },
    );
    withTree(
      (root) =>
        edit(root, POLICY, (s) =>
          // Strip the two phrases §3 was signed to carry. Anything that removes
          // them is the same edit a rewrite-without-review would make.
          s.replace(/legitimate interest/g, 'interest').replace(/right to object/g, 'preference'),
        ),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /👤 OWNER the pinned notice .*privacy\.html describes neither/);
      },
    );
  });

  test('👤 an extractor that stops finding the purposes SAYS SO', () => {
    // The failure this repository keeps paying for: a check that silently
    // stopped checking. Zero legitimate-interest purposes and an extractor that
    // lost its grip print identically unless asked apart — so the guard asks.
    withTree(
      (root) => edit(root, CORE_CONSENT, (s) => s.replace("ConsentPurpose(\n    'promo',", "ConsentPurpose(\n    PROMO_ID,")),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /NAMES ConsentBasis\.legitimateInterest and the purpose extractor matched none/);
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

// ─────────────────────────────────────────────────────────────────────────────
// THE WITHDRAWAL CONTROL MOVED INTO THE CHASSIS PACKAGE — [ADR 067] decision 2
//
// [ADR 066] step 4 empties a settings screen into
// `package:nikatru_chassis_screens` and leaves an adapter at the same path. The
// `recordAnalyticsConsent(` call, its `granted:` toggle and the state read all
// go with the body — and read at the adapter alone this guard reports that
// there is nowhere in the app to turn analytics off. That is a DPDP §6(3) claim
// made about a compliant tree, which is exactly as bad as missing a real one.
//
// 🔴 AND THE EXTENSION SHIPPED WITH NO TEST AT ALL. On 2026-09-05 this guard
// gained the resolver and this file gained nothing, and an independent review
// then measured what that cost, on the real tree, in three steps:
//   1. `recordAnalyticsConsent(` deleted from apps/subly's settings screen
//      → EXIT 1, "NO call to recordAnalyticsConsent( in lib/features/settings.
//        There is nowhere in this app for a user to turn analytics back OFF."
//   2. ONE line added — an import of a chassis file NOTHING in the adapter
//      references — with that file holding a never-rendered free function whose
//      body says the words → SAME TREE, EXIT 0, "1 withdrawal call site(s)".
//   3. The same mutated tree under origin/main's copy of the guard: EXIT 1.
// A DPDP control was silenced by an unused import. DW3 is that case.
// ─────────────────────────────────────────────────────────────────────────────
describe('a withdrawal control that moved into the chassis package', () => {
  const CHASSIS_REL = 'packages/chassis_screens/lib/settings_body.dart';
  const IMPORT = "import 'package:nikatru_chassis_screens/settings_body.dart';\n";

  /** The package file the adapter delegates to. `carries` false leaves it
   *  holding nothing but its class, so the delegation is real and the control
   *  genuinely is nowhere. */
  const packageBody = (carries) =>
    'class SettingsBody {\n' +
    '  void withdraw(WidgetRef ref) {\n' +
    (carries
      ? '    recordAnalyticsConsent(\n      ref,\n' +
        '      granted: ref.read(analyticsConsentProvider) != core.ConsentStatus.granted,\n    );\n'
      : '    return;\n') +
    '  }\n}\n';

  /** Delete every withdrawal call from apps/subly's settings screen, and
   *  optionally hand the behaviour to a chassis file. `used` decides whether the
   *  adapter actually references what it imports — which is the whole question. */
  const moved = ({ inPackage = true, used = true, onDisk = true } = {}) => (root) => {
    edit(root, SUBLY_SETTINGS, (s) => {
      const stripped = s.split('recordAnalyticsConsent(').join('noopConsent(');
      return IMPORT + stripped + (used ? '\nWidget shell(BuildContext c) => const SettingsBody();\n' : '');
    });
    if (onDisk) {
      const p = join(root, CHASSIS_REL);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, packageBody(inPackage));
    }
  };

  // ── GREEN CONTROL 1: the tree is untouched and a delegation is merely ADDED.
  // The resolver runs, reads the package file, and the guard still passes — so
  // every red below is about the mutation and not about the resolver refusing.
  test('DW0 · an honest delegation is followed and REPORTED, and the run stays green', () => {
    withTree(
      (root) => {
        edit(root, SUBLY_SETTINGS, (s) => IMPORT + s + '\nWidget shell(BuildContext c) => const SettingsBody();\n');
        const p = join(root, CHASSIS_REL);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, packageBody(false));
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /limbs 1-3 also read 1 chassis file\(s\) the settings tree delegates to/);
      },
    );
  });

  // ── GREEN CONTROL 2: the control itself moves, and is found where it landed.
  test('DW1 · the control moves into the package and the app is still compliant', () => {
    withTree(moved({ inPackage: true }), (r) => {
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /apps\/subly — 1 withdrawal call site\(s\)/);
    });
  });

  // ── THE FINDING THE GUARD EXISTS FOR, THROUGH A DELEGATION.
  test('DW2 · 🔴 the control is in NEITHER file — the DPDP finding still fires', () => {
    withTree(moved({ inPackage: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /NO call to recordAnalyticsConsent\(/);
      assert.match(r.stdout + r.stderr, /nowhere in this app for a user to turn analytics back OFF/);
    });
  });

  // ── 🔴 THE EXPLOIT, REPRODUCED. Step 2 of the review's three steps: the
  // control is deleted, the package says the words, and NOTHING references the
  // import. This must stay EXIT 1.
  test('DW3 · 🔴 an UNUSED chassis import does not stand in for the deleted control', () => {
    withTree(moved({ inPackage: true, used: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /never references anything it declares \(SettingsBody\)/);
      assert.match(r.stdout + r.stderr, /a reference is evidence/);
    });
  });

  // ── COVERAGE LOST: a delegation that resolves to nothing is not "no
  // delegation", which is the silent-pass shape.
  test('DW4 · 🔴 a delegation to a file that is not on disk is COVERAGE LOST', () => {
    withTree(moved({ onDisk: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /chassis delegation could not be followed/);
      assert.match(r.stdout + r.stderr, /that file is not on disk/);
    });
  });
});
