// ─────────────────────────────────────────────────────────────────────────────
// ads-declarations.test.mjs — assert-ads-declarations.mjs must be able to FAIL.
//
// [research/44 §3 V3] The advertising answer is decided by FORMAT — "House ads:
// My app renders a small ad banner, interstitial ad, ad wall, and/or widget" —
// while all three shipped advertising claims were keyed on PACKAGE TELLS. So the
// cases below are mostly about the two halves that a dependency walk cannot see:
// a widget that renders, and a config key that arms one.
//
// 🔴 MUTATED AGAINST THE REAL TREE FIRST, because a fixture passing is not a
// guard working — the fixtures encode the same understanding the guard does.
// Measured 2026-08-09 on this worktree:
//   · `class PromoBanner extends StatelessWidget` added to
//     packages/design_system/lib/src/widgets/ AND `"promo_target_app_id":
//     "lingo"` added to services/platform/src/app-config-data.json
//     → FOUR failures: containsAds, promotesOtherApps, adFormats ([] vs
//       [banner]) and the published privacy sentence. Both files restored, guard
//       back to exit 0 with DOMAIN EMPTY.
//   · 🔴 AND THE SECOND REAL-TREE MUTATION IS WHY THE RULE CHANGED. The same
//     widget on `HookConsumerWidget` — the standard flutter_hooks/Riverpod base
//     — was reported "PROMOTIONAL MACHINERY, NO SURFACE" and the guard EXITED 0.
//     The widget-shape rule was an enumerated prefix list, i.e. the very "a
//     named list is not exhaustive" defect this guard indicts in the three
//     declarations it checks. It is structural now (`…Widget`, `…State<…>`,
//     CustomPainter) and the same mutation fails with three findings; the tree
//     was restored and the guard is back to exit 0, 182 widget-shaped (was 180 —
//     the two CustomPainters were being missed as well).
//   · 🔴 AND THE THIRD REAL-TREE MEASUREMENT IS WHY THE RULE GREW AN OWNERSHIP
//     LIMB. 2026-08-10, on the branch that lands the SAME-APP upgrade card: the
//     guard fired `containsAds`, `adFormats [] vs [card]` and the privacy
//     sentence. The first two were WRONG — deriving the Play answer from the
//     token `promo` alone classified a card that promotes the app the user is
//     already in as advertising, and answering yes would put a "Contains ads"
//     badge on a listing that carries none (research/44 §3 V2: "A same-app
//     upgrade card matches none of the three triggers"). The third is CORRECT
//     and owner-gated, and still fires. Both directions were then measured on
//     the real tree with the ownership limb in place:
//       – `"promo_target_app_id": "lingo"` added to
//         services/platform/src/app-config-data.json → containsAds +
//         promotesOtherApps red ON TOP of the standing privacy finding, naming
//         the armed cross-app lever as the evidence. Restored.
//       – a `crossPromoTarget` const holding
//         `https://play.google.com/store/apps/details?id=com.nikatru.lingo`
//         added inside the REAL `_UpgradePromoCardState` and referenced by the
//         card's `key` → containsAds + promotesOtherApps + adFormats ([] vs
//         [card]) red, naming the listing URL that does not name the host app.
//         `flutter analyze` on the mutated file: NO ISSUES FOUND — so the red
//         is a caught mutation and not a compile error wearing its clothes,
//         which is the failure mode this repo has recorded three times.
//         Restored; the guard returns to the privacy finding alone.
// The fixtures below then cover the limbs a real-tree mutation cannot reach
// without breaking other guards (a narrowed root, a missing anchor, a Play
// vocabulary that lost the advertising purpose) and the cross-app shapes the
// one-app catalogue cannot express today.
//
// Run:  node --test "tooling/ci/test/ads-declarations.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-ads-declarations.mjs');

const SENTENCE =
  'We do not use advertising networks or advertising SDKs, we do not share data with data brokers, and no Nikatru app carries advertising.';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-ads-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/**
 * A minimal but COMPLETE tree: one app with a Play metadata tree, two Dart files
 * (one of them the required-coverage anchor), a served config payload, a
 * one-app catalogue, the claims register and the published page.
 *
 * Every override is a deep-merge-by-replacement of one document, so a case reads
 * as "the same tree, except this".
 */
function tree(over = {}) {
  const root = join(TMP, `r${seq++}`);
  const {
    dart = {},
    dropDart = [],
    decl = {},
    dataSafety = {},
    contentRating = {},
    payload = {},
    registry = null,
    claimsRegister = {},
    // The published sentence's limb is OWNER-GATED and fires on any promotional
    // surface, same-app included — so a case about the PLAY answers turns it off
    // to read them alone. Turning it off is itself a declared answer
    // (`assertsAbsence: false` = "this page no longer promises absence"), not a
    // suppression: the guard requires the field to be a boolean either way.
    assertsAbsence = true,
    pageHtml = `<html><body><p><b>${SENTENCE}</b></p></body></html>`,
    additionalFiles = ['data-safety.json', 'content-rating.json', 'ads-declaration.json'],
    workspace = ['apps/app1', 'packages/core'],
  } = over;

  const files = {};
  files['pubspec.yaml'] = `name: workspace_root\nworkspace:\n${workspace.map((w) => `  - ${w}\n`).join('')}`;
  files['tooling/channel-register.json'] = json({
    channels: [{ id: 'android-play', storeMetadataDir: 'apps/{app}/store/android-play' }],
    storeMetadataContract: { perChannel: { 'android-play': { additionalFiles } } },
  });

  const baseDart = {
    'apps/app1/lib/home.dart':
      'import "x.dart";\nclass HomeScreen extends StatelessWidget {}\nclass CatchUpNudgeBanner extends ConsumerWidget {}\n',
    'packages/design_system/lib/paywall_gate.dart': 'class PaywallGate extends StatelessWidget {}\n',
  };
  for (const [rel, body] of Object.entries({ ...baseDart, ...dart })) {
    if (dropDart.includes(rel)) continue;
    files[rel] = body;
  }

  files['apps/app1/store/android-play/ads-declaration.json'] = json({
    app: 'app1',
    channel: 'android-play',
    console: { wordingStatus: 'UNVERIFIED', why: 'the form only renders inside the Play Console' },
    sources: {
      allowedHosts: ['support.google.com'],
      houseAdsTrigger: {
        url: 'https://support.google.com/googleplay/android-developer/answer/9859455',
        fetched: '2026-08-09',
        quote: 'House ads: My app renders a small ad banner, interstitial ad, ad wall, and/or widget',
      },
    },
    containsAds: false,
    adFormats: [],
    promotesOtherApps: false,
    derivation: 'format-tells',
    formatScan: {
      roots: ['apps/app1/lib', 'packages/design_system/lib'],
      minFiles: 2,
      requiredCoverage: [
        {
          file: 'packages/design_system/lib/paywall_gate.dart',
          symbol: 'PaywallGate',
          why: 'the positive control for the widget-declaration matcher',
        },
      ],
      configPayloads: ['services/platform/src/app-config-data.json'],
      appRegistry: 'catalog/apps.json',
    },
    crossChecks: {
      dataSafetyPurpose: {
        file: 'apps/app1/store/android-play/data-safety.json',
        purpose: 'Advertising or marketing',
        expectRows: 0,
        blockPointer: 'advertisingPurpose',
        why: 'the Data safety half of the same question',
      },
      contentRatingClaim: {
        file: 'apps/app1/store/android-play/content-rating.json',
        claimId: 'contains-ads',
        pointerField: 'formatCrossCheck',
        why: 'the IARC half of the same question',
      },
      policyPage: {
        register: 'tooling/legal/policy-claims.json',
        page: 'privacy.html',
        claim: SENTENCE,
        assertsAbsence,
        why: 'the published half of the same question',
      },
    },
    humanOwned: { affirmListingAssets: 'A human must confirm the screenshots promote no other app.' },
    notCovered: ['store listing assets'],
    ...decl,
  });

  files['apps/app1/store/android-play/data-safety.json'] = json({
    vocabulary: {
      purposes: ['App functionality', 'Analytics', 'Advertising or marketing', 'Account management'],
    },
    answers: [
      { category: 'Personal info', type: 'Email address', purposes: ['Account management'] },
      { category: 'App activity', type: 'App interactions', purposes: ['Analytics'] },
    ],
    advertisingPurpose: {
      purpose: 'Advertising or marketing',
      declaredOnRows: 0,
      basis: 'No data type is collected for advertising, and the zero is declared rather than merely true.',
    },
    ...dataSafety,
  });

  files['apps/app1/store/android-play/content-rating.json'] = json({
    claims: [
      {
        id: 'contains-ads',
        answer: false,
        derivation: 'dependency-tells',
        formatCrossCheck: {
          file: 'apps/app1/store/android-play/ads-declaration.json',
          guard: 'tooling/ci/assert-ads-declarations.mjs',
          why: 'the package tells cannot see a house ad',
        },
      },
    ],
    ...contentRating,
  });

  files['services/platform/src/app-config-data.json'] = json({
    defaults: { max_promos_per_week: 0, features: {} },
    apps: { app1: { features: { renewals: true } } },
    ...payload,
  });

  files['catalog/apps.json'] = json(registry ?? [{ slug: 'app1' }]);

  files['tooling/legal/policy-claims.json'] = json({
    siteRoot: 'sites/nikatru',
    pages: ['privacy.html'],
    claims: [
      {
        page: 'privacy.html',
        claim: SENTENCE,
        type: 'code',
        assert: { kind: 'absent', pattern: '(?im)^\\s*(google_mobile_ads|admob_flutter)\\s*:' },
      },
    ],
    ...claimsRegister,
  });

  files['sites/nikatru/privacy.html'] = pageHtml;

  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('the passing path', () => {
  test('a tree with no promotional surface passes and says the domain is EMPTY', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /DOMAIN EMPTY, AND THAT IS CURRENTLY TRUE/);
    assert.match(out, /assert-ads-declarations: ok/);
  });

  test('the zero is printed with the counts that make it evidence, not silence', () => {
    const { out } = run(tree());
    assert.match(out, /2 Dart file\(s\) walked/);
    assert.match(out, /1 anchor symbol\(s\) found/);
  });
});

describe('(A) the promotional COMPONENT — the half no dependency walk can see', () => {
  test('🔴 a promo widget with no SDK, no dependency and no permission fails', () => {
    const { code, out } = run(
      tree({ dart: { 'packages/design_system/lib/promo.dart': 'class PromoBanner extends StatelessWidget {}\n' } }),
    );
    assert.equal(code, 1);
    assert.match(out, /answers `containsAds: false` and the shipped tree renders a promotional surface/);
    assert.match(out, /PromoBanner/);
  });

  test('the format is derived from the component name and compared to adFormats', () => {
    const { code, out } = run(
      tree({ dart: { 'packages/design_system/lib/promo.dart': 'class AdInterstitial extends StatelessWidget {}\n' } }),
    );
    assert.equal(code, 1);
    assert.match(out, /declares adFormats \[\(none\)\] and the scan derived \[interstitial\]/);
  });

  test('a Widget-returning builder function counts as a surface too', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'Widget buildSponsoredTile() => const Text("x");\n' } }),
    );
    assert.equal(code, 1);
    assert.match(out, /buildSponsoredTile/);
  });

  // 🔴 THE CALIBRATION CASE. A rule keyed on "banner" would fire on the real
  // tree's CatchUpNudgeBanner on day one and be switched off within a week.
  test('CatchUpNudgeBanner does NOT fire — a banner is not an ad', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /CatchUpNudgeBanner.*advertising token/);
  });

  test('`ad` cannot fire on adapter/header/read — tokens are whole words', () => {
    const { code, out } = run(
      tree({
        dart: {
          'apps/app1/lib/x.dart':
            'class AdapterPane extends StatelessWidget {}\nclass ReadHeader extends StatelessWidget {}\n',
        },
      }),
    );
    assert.equal(code, 0, out);
  });

  test('a promo name in a COMMENT does not fire — the source is reduced first', () => {
    const { code, out } = run(
      tree({
        dart: {
          'apps/app1/lib/x.dart':
            '// class PromoBanner extends StatelessWidget — the shape rung 3 will add\nclass Plain extends StatelessWidget {}\n',
        },
      }),
    );
    assert.equal(code, 0, out);
  });

  test('a promo name in a STRING does not fire either', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'const label = "class PromoBanner extends StatelessWidget";\n' } }),
    );
    assert.equal(code, 0, out);
  });

  // 🔴 THE REGRESSION THAT ALMOST SHIPPED. The widget-shape rule was an
  // ENUMERATED PREFIX LIST (`Stateless|Stateful|Consumer|…`) — the exact "a named
  // list is not exhaustive" defect this guard indicts in the three declarations
  // it checks. Measured on the REAL tree 2026-08-09: `class PromoBanner extends
  // HookConsumerWidget` was reported as "PROMOTIONAL MACHINERY, NO SURFACE" and
  // the guard exited 0. A house ad would have shipped under the one check written
  // to stop it. The rule is structural now; these are its recorded failing cases.
  test('🔴 a promo widget on a base the old prefix list never enumerated still fires', () => {
    const { code, out } = run(
      tree({ dart: { 'packages/design_system/lib/promo.dart': 'class PromoBanner extends HookConsumerWidget {}\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /the shipped tree renders a promotional surface/);
    assert.match(out, /PromoBanner \(HookConsumerWidget\)/);
    assert.doesNotMatch(out, /PROMOTIONAL MACHINERY, NO SURFACE — PromoBanner/);
  });

  test('🔴 a bare HookWidget promo surface fires too — any `…Widget` base renders', () => {
    const { code, out } = run(
      tree({ dart: { 'packages/design_system/lib/promo.dart': 'class SponsoredSlot extends HookWidget {}\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /SponsoredSlot \(HookWidget\)/);
  });

  // A CustomPainter is a SURFACE, not machinery — it paints pixels, and its name
  // is the one that breaks the `…Widget` convention. Asserted through the
  // same-app print rather than through `containsAds`, because this painter
  // promotes nobody in particular: the surface question and the ownership
  // question are separate, and pinning this case to the Play answer is what made
  // the guard over-broad in the first place.
  test('🔴 a CustomPainter promo surface is a SURFACE, not machinery', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'class PromoPainter extends CustomPainter {}\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /SAME-APP PROMOTIONAL SURFACE, NO PLAY TRIGGER — PromoPainter \(CustomPainter\)/);
    assert.doesNotMatch(out, /PROMOTIONAL MACHINERY, NO SURFACE — PromoPainter/);
    // …and it is a surface for the limb that matters: the published sentence.
    assert.match(out, /The sentence is now FALSE as published/);
  });

  test('🔴 an ADVERTISING-named CustomPainter is a Play trigger as well as a surface', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'class SponsoredPainter extends CustomPainter {}\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /SponsoredPainter \(CustomPainter\) in apps\/app1\/lib\/x\.dart — advertising vocabulary "sponsored"/);
  });

  // The other direction, so the structural rule is not just "fires on more
  // things". A `…State` base counts only WITH a generic parameter, which is what
  // makes it a StatefulWidget companion rather than a domain class.
  test('a promo DOMAIN class on a non-generic `…State` base is machinery, not a surface', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'class PromoState extends AppState {}\n' } }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /PROMOTIONAL MACHINERY, NO SURFACE — PromoState/);
  });

  test('a `ConsumerState<…>` companion IS a surface — the generic is what distinguishes it', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'class PromoCardState extends ConsumerState<PromoCard> {}\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /PromoCardState/);
  });

  // Rung 2 of the ladder is `PromoGate` — a pure decision primitive with no UI.
  // Failing on it would make the frequency governor unshippable ahead of the
  // widget it governs, which is the wrong incentive and not what Play asks.
  test('promotional MACHINERY that renders nothing prints, and does not fail', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/promo_gate.dart': 'class PromoGate extends Object {}\n' } }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /PROMOTIONAL MACHINERY, NO SURFACE/);
  });
});

describe('(B) the served CONFIG payload', () => {
  test('a disarmed lever prints and does not fail — a cap before its sender', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /DISARMED LEVER — services\/platform\/src\/app-config-data\.json defaults\.max_promos_per_week = 0/);
  });

  test('🔴 ARMING that same lever fails', () => {
    const { code, out } = run(tree({ payload: { defaults: { max_promos_per_week: 3 } } }));
    assert.equal(code, 1);
    assert.match(out, /an ARMED promotional lever/);
  });

  test('🔴 a cross-app promo KEY fails promotesOtherApps', () => {
    const { code, out } = run(
      tree({ payload: { apps: { app1: { promo_target_app_id: 'other' } } } }),
    );
    assert.equal(code, 1);
    assert.match(out, /`promotesOtherApps: false` and the scan derived true/);
  });

  test('🔴 a payload VALUE naming another registered app fails, once app #2 exists', () => {
    const { code, out } = run(
      tree({
        registry: [{ slug: 'app1' }, { slug: 'app2' }],
        payload: { apps: { app1: { copy: { upsell: 'app2' } } } },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /names app "app2" while the host is "app1"/);
  });

  test('an app naming ITSELF is not a cross-app reference', () => {
    const { code, out } = run(
      tree({
        registry: [{ slug: 'app1' }, { slug: 'app2' }],
        payload: { apps: { app1: { copy: { self: 'app1' } } } },
      }),
    );
    assert.equal(code, 0, out);
  });

  test('the one-app catalogue declares its own constant-false limb out loud', () => {
    const { out } = run(tree());
    assert.match(out, /CROSS-APP VALUE LIMB IS CONSTANT-FALSE TODAY/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (C) WHO DOES IT PROMOTE — the limb that decides the PLAY answers.
//
// 🔴 THE RECORDED DEFECT THIS FAMILY EXISTS FOR. Until 2026-08-10 the guard
// derived `containsAds` from the token `promo` in ANY component name, so the
// same-app upgrade card [ADR 040] locked as v1 — the one deliberately built to
// carry NO ads label — was classified as advertising. research/44 §3 V2 is
// explicit: "A same-app upgrade card matches none of the three triggers (it
// promotes *this* app, not 'my other apps') and carries no ads label." An
// overstated sworn declaration is inaccurate in the same way an understated one
// is; it just puts the badge on instead of leaving it off.
//
// Two properties are pinned here in opposite directions, and both are needed —
// a rule that only ever fired less would be as wrong as the one it replaced:
//   · a SAME-APP surface must not move the Play answers;
//   · a CROSS-APP one, an ADVERTISING-named one and an AD-SHAPED one must.
// ─────────────────────────────────────────────────────────────────────────────
describe('(C) same-app vs cross-app — the ownership limb', () => {
  // The shipped shape, reduced: a card that promotes the app the user is in and
  // navigates to that app's own paywall route.
  const sameAppCard = {
    'apps/app1/lib/promo.dart':
      'class UpgradePromoCard extends StatelessWidget {\n' +
      '  Widget build(BuildContext c) => Btn(onTap: () => c.go("/paywall"), manage: () => c.go("/manage-plan"));\n' +
      '}\n',
  };

  test('🔴 THE REGRESSION: a same-app upgrade card leaves every Play answer alone', () => {
    const { code, out } = run(tree({ dart: sameAppCard, assertsAbsence: false }));
    assert.equal(code, 0, out);
    assert.match(out, /SAME-APP PROMOTIONAL SURFACE, NO PLAY TRIGGER — UpgradePromoCard/);
    assert.match(out, /navigates to the in-app route "\/paywall"/);
  });

  test('the same-app print carries the D3 deferral, so nobody reads it as the badge decision', () => {
    const { out } = run(tree({ dart: sameAppCard, assertsAbsence: false }));
    assert.match(out, /D3 — whether a CROSS-APP surface carries the badge — is deliberately DEFERRED, not defaulted/);
    assert.match(out, /ADR 040/);
  });

  // The state this repository is actually in on the branch that ships the card:
  // ONE finding, and it is the owner's.
  test('🔴 the same card still falsifies the published sentence — and that is the ONLY finding', () => {
    const { code, out } = run(tree({ dart: sameAppCard }));
    assert.equal(code, 1, out);
    assert.match(out, /The sentence is now FALSE as published/);
    assert.doesNotMatch(out, /answers `containsAds: false`/);
    assert.doesNotMatch(out, /declares adFormats/);
    assert.doesNotMatch(out, /answers `promotesOtherApps: false` and the scan derived true/);
    assert.equal(out.split('\nFAIL ').length - 1, 1, out);
  });

  test('🔴 a CROSS-APP name — Google\'s own "More Apps" words — trips both Play answers', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'class MoreAppsPanel extends StatelessWidget {}\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /answers `containsAds: false`/);
    assert.match(out, /cross-app \(more\+apps\)/);
    assert.match(out, /`promotesOtherApps: false` and the scan derived true/);
  });

  test('🔴 a promo card whose COPY names another registered app is cross-app', () => {
    const { code, out } = run(
      tree({
        registry: [{ slug: 'app1' }, { slug: 'app2' }],
        dart: {
          'apps/app1/lib/promo.dart':
            'class PromoCard extends StatelessWidget {\n  static const t = "Try app2, our new one";\n}\n',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /names the registered app "app2"/);
    assert.match(out, /answers `containsAds: false`/);
  });

  test('🔴 a promo card linking to another registered app\'s DOMAIN is cross-app', () => {
    const { code, out } = run(
      tree({
        registry: [
          { slug: 'app1', url: 'https://app1.example.com' },
          { slug: 'lingo', url: 'https://learn.example.com' },
        ],
        dart: {
          'apps/app1/lib/promo.dart':
            'class PromoCard extends StatelessWidget {\n  static const t = "https://learn.example.com/pro";\n}\n',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /links to another registered app's domain learn\.example\.com/);
  });

  // 🔴 THE HALF THAT CAN FIRE WITH ONE APP IN THE CATALOGUE. The slug and domain
  // limbs are constant-false until app #2 exists (the guard prints exactly that);
  // a store-listing URL naming somebody else is checkable today, which is what
  // keeps the cross-app limb from being unfalsifiable for the whole of v1.
  test('🔴 a store-listing URL that does not name the host is cross-app, with ONE app registered', () => {
    const { code, out } = run(
      tree({
        dart: {
          'apps/app1/lib/promo.dart':
            'class PromoCard extends StatelessWidget {\n' +
            '  static const t = "https://play.google.com/store/apps/details?id=com.nikatru.lingo";\n' +
            '}\n',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /links to a store listing that does not name the host app "app1"/);
    assert.match(out, /answers `containsAds: false`/);
  });

  test('the HOST\'s own listing is not a cross-app tell — a rate-us link is not a house ad', () => {
    const { code, out } = run(
      tree({
        assertsAbsence: false,
        dart: {
          'apps/app1/lib/promo.dart':
            'class PromoCard extends StatelessWidget {\n' +
            '  static const t = "https://play.google.com/store/apps/details?id=com.nikatru.app1";\n' +
            '}\n',
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /links to the HOST app's own store listing/);
  });

  test('a `{{app_id}}` listing URL in the BRICK is the host, not another app', () => {
    const { code, out } = run(
      tree({
        assertsAbsence: false,
        dart: {
          'apps/app1/lib/promo.dart':
            'class PromoCard extends StatelessWidget {\n' +
            '  static const t = "https://play.google.com/store/apps/details?id=com.nikatru.{{app_id}}";\n' +
            '}\n',
        },
      }),
    );
    assert.equal(code, 0, out);
  });

  // ADVERTISING vocabulary, not PROMOTION vocabulary: triggers 1-2 are ads
  // whoever they sell for and say nothing about "other apps".
  test('🔴 an ad-NAMED surface trips even when everything in it points at the host', () => {
    const { code, out } = run(
      tree({
        dart: {
          'apps/app1/lib/x.dart':
            'class AdSlot extends StatelessWidget {\n  Widget build(BuildContext c) => Btn(onTap: () => c.go("/paywall"));\n}\n',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /advertising vocabulary "ad"/);
  });

  test('🔴 an AD SHAPE trips — banner, interstitial and wall are the formats Google names', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'class PromoBanner extends StatelessWidget {}\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /an ad-shaped format "banner"/);
  });

  test('a `card` is a format, not an ad shape — the complement of the case above', () => {
    const { code, out } = run(
      tree({ assertsAbsence: false, dart: { 'apps/app1/lib/x.dart': 'class PromoCard extends StatelessWidget {}\n' } }),
    );
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ad-shaped format/);
  });

  test('adFormats is derived from the AD surfaces only — a same-app card contributes no format', () => {
    const { code, out } = run(
      tree({
        dart: {
          'apps/app1/lib/promo.dart':
            'class UpgradePromoCard extends StatelessWidget {}\nclass MoreAppsBanner extends StatelessWidget {}\n',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /declares adFormats \[\(none\)\] and the scan derived \[banner\]/);
    assert.doesNotMatch(out, /derived \[banner, card\]/);
  });

  // 🔴 ATTRIBUTION, AND IT IS NOT THE FILE. The literal that decides ownership
  // must be inside the promotional declaration itself — a `Widget build(…)`
  // method matches as a declaration in its own right, so a naive "next match"
  // span ends a widget class AT ITS OWN BUILD METHOD and loses the route it
  // navigates to. Measured on the real tree before the brace-matched span landed.
  test('another app named in a DIFFERENT declaration in the same file is not this card\'s tell', () => {
    const { code, out } = run(
      tree({
        assertsAbsence: false,
        registry: [{ slug: 'app1' }, { slug: 'app2' }],
        dart: {
          'apps/app1/lib/promo.dart':
            'class Footer extends StatelessWidget {\n  static const credit = "app2";\n}\n' +
            'class PromoCard extends StatelessWidget {\n' +
            '  Widget build(BuildContext c) => Btn(onTap: () => c.go("/paywall"));\n' +
            '}\n',
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /SAME-APP PROMOTIONAL SURFACE, NO PLAY TRIGGER — PromoCard/);
  });

  test('the route INSIDE the build method is still attributed to the card', () => {
    const { out } = run(tree({ dart: sameAppCard, assertsAbsence: false }));
    assert.match(out, /UpgradePromoCard[^⬜]*navigates to the in-app route "\/manage-plan"/);
  });

  test('an armed SAME-APP lever is a promotional touch, not a Play ads trigger', () => {
    const { code, out } = run(tree({ assertsAbsence: false, payload: { defaults: { max_promos_per_week: 3 } } }));
    assert.equal(code, 0, out);
  });

  test('🔴 an armed ADVERTISING-named lever IS a Play ads trigger', () => {
    const { code, out } = run(tree({ assertsAbsence: false, payload: { defaults: { ads_enabled: true } } }));
    assert.equal(code, 1, out);
    assert.match(out, /an ARMED advertising lever/);
  });

  test('the missing positive control is PRINTED, not papered over', () => {
    const { out } = run(tree({ dart: sameAppCard, assertsAbsence: false }));
    assert.match(out, /NO POSITIVE CONTROL FOR THE CROSS-APP LIMB EXISTS IN THIS TREE/);
  });
});

describe('the four claims are compared to ONE derivation', () => {
  test('🔴 a data-safety row acquiring the advertising purpose fails', () => {
    const { code, out } = run(
      tree({
        dataSafety: {
          answers: [{ category: 'App activity', type: 'App interactions', purposes: ['Analytics', 'Advertising or marketing'] }],
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /answer row\(s\) carrying the purpose "Advertising or marketing"/);
    assert.match(out, /One of the two declarations to Google is false/);
  });

  test('🔴 an undeclared advertising-purpose zero fails — nobody is accountable for it', () => {
    const { code, out } = run(tree({ dataSafety: { advertisingPurpose: undefined } }));
    assert.equal(code, 1);
    assert.match(out, /carries no `advertisingPurpose` block/);
  });

  test('🔴 a declared count that disagrees with the rows fails', () => {
    const { code, out } = run(
      tree({
        dataSafety: {
          advertisingPurpose: { purpose: 'Advertising or marketing', declaredOnRows: 2, basis: 'a basis long enough to be a real one' },
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /declaredOnRows says 2 and 0 answer row\(s\) actually carry/);
  });

  test('🔴 the IARC contains-ads claim disagreeing fails', () => {
    const { code, out } = run(
      tree({
        contentRating: {
          claims: [
            {
              id: 'contains-ads',
              answer: true,
              derivation: 'dependency-tells',
              formatCrossCheck: { file: 'apps/app1/store/android-play/ads-declaration.json' },
            },
          ],
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /the same sentence sworn to two authorities/);
  });

  test('🔴 an IARC claim with no pointer at the format half fails', () => {
    const { code, out } = run(
      tree({ contentRating: { claims: [{ id: 'contains-ads', answer: false, derivation: 'dependency-tells' }] } }),
    );
    assert.equal(code, 1);
    assert.match(out, /carries no `formatCrossCheck.file`/);
  });

  test('🔴 the published sentence disappearing from the page fails', () => {
    const { code, out } = run(tree({ pageHtml: '<html><body><p><b>Something else entirely.</b></p></body></html>' }));
    assert.equal(code, 1);
    assert.match(out, /no longer emphasises the sentence/);
  });

  // NOT an empty register — that is COVERAGE LOST (the pin would range over
  // nothing). This is the realistic shape: the register still has rows, and the
  // advertising one is gone.
  test('🔴 the register losing the advertising row fails', () => {
    const { code, out } = run(
      tree({ claimsRegister: { claims: [{ page: 'privacy.html', claim: 'We are a sole proprietorship.', type: 'descriptive' }] } }),
    );
    assert.equal(code, 1);
    assert.match(out, /has NO row on privacy\.html for the sentence/);
  });

  test('COVERAGE LOST when the register has no rows at all — the pin would range over nothing', () => {
    const { code, out } = run(tree({ claimsRegister: { claims: [] } }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no `claims` rows/);
  });

  test('🔴 the register row downgraded from an `absent` assertion fails', () => {
    const { code, out } = run(
      tree({ claimsRegister: { claims: [{ page: 'privacy.html', claim: SENTENCE, type: 'descriptive' }] } }),
    );
    assert.equal(code, 1);
    assert.match(out, /this declaration rests on it being an `absent` assertion/);
  });

  // The owner gate: the sentence is not merely inconsistent, it becomes FALSE.
  test('🔴 a promo surface makes the published sentence false, and the message says whose signature that needs', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/promo.dart': 'class PromoCard extends StatelessWidget {}\n' } }),
    );
    assert.equal(code, 1);
    assert.match(out, /The sentence is now FALSE as published/);
    assert.match(out, /\[ADR 031\] class B owner work|owner gate on the whole cross-promotion programme/);
  });

  test('an OVERSTATED declaration fails too — a badge on a listing that carries no ads', () => {
    const { code, out } = run(tree({ decl: { containsAds: true } }));
    assert.equal(code, 1);
    assert.match(out, /An overstated declaration is still an inaccurate one/);
  });
});

describe('the guard knows when it is not looking', () => {
  test('COVERAGE LOST when the anchor file is not under any declared root', () => {
    const { code, out } = run(
      tree({
        decl: {
          formatScan: {
            roots: ['apps/app1/lib'],
            minFiles: 1,
            requiredCoverage: [{ file: 'packages/design_system/lib/paywall_gate.dart', symbol: 'PaywallGate', why: 'control' }],
            configPayloads: ['services/platform/src/app-config-data.json'],
            appRegistry: 'catalog/apps.json',
          },
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /under none of the declared roots/);
  });

  test('COVERAGE LOST when the matcher can no longer find an anchor symbol', () => {
    const { code, out } = run(
      tree({ dart: { 'packages/design_system/lib/paywall_gate.dart': 'class Renamed extends StatelessWidget {}\n' } }),
    );
    assert.equal(code, 1);
    assert.match(out, /expects the matcher to find `PaywallGate`/);
  });

  test('COVERAGE LOST when the walk reads fewer files than the declared floor', () => {
    const { code, out } = run(tree({ decl: { formatScan: { roots: ['apps/app1/lib', 'packages/design_system/lib'], minFiles: 50, requiredCoverage: [{ file: 'packages/design_system/lib/paywall_gate.dart', symbol: 'PaywallGate', why: 'control' }], configPayloads: ['services/platform/src/app-config-data.json'], appRegistry: 'catalog/apps.json' } } }));
    assert.equal(code, 1);
    assert.match(out, /floors it at 50/);
  });

  test('COVERAGE LOST when a declared root does not exist', () => {
    const { code, out } = run(tree({ dropDart: ['packages/design_system/lib/paywall_gate.dart'] }));
    assert.equal(code, 1);
    assert.match(out, /director\(ies\) that do not exist/);
  });

  test('COVERAGE LOST when the register stops requiring the declaration to exist', () => {
    const { code, out } = run(tree({ additionalFiles: ['data-safety.json', 'content-rating.json'] }));
    assert.equal(code, 1);
    assert.match(out, /does not list "ads-declaration\.json"/);
  });

  test('COVERAGE LOST when the Play vocabulary no longer carries the advertising purpose', () => {
    const { code, out } = run(tree({ dataSafety: { vocabulary: { purposes: ['Analytics'] } } }));
    assert.equal(code, 1);
    assert.match(out, /vocabulary\.purposes does not contain "Advertising or marketing"/);
  });

  test('COVERAGE LOST when no config payload is declared', () => {
    const { code, out } = run(
      tree({
        decl: {
          formatScan: {
            roots: ['apps/app1/lib', 'packages/design_system/lib'],
            minFiles: 2,
            requiredCoverage: [{ file: 'packages/design_system/lib/paywall_gate.dart', symbol: 'PaywallGate', why: 'control' }],
            configPayloads: [],
            appRegistry: 'catalog/apps.json',
          },
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /formatScan\.configPayloads is empty/);
  });

  test('COVERAGE LOST when the app catalogue yields no slug', () => {
    const { code, out } = run(tree({ registry: [] }));
    assert.equal(code, 1);
    assert.match(out, /yielded ZERO app slugs/);
  });

  test('COVERAGE LOST when no app in the workspace carries a Play tree', () => {
    const { code, out } = run(tree({ workspace: ['apps/other'] }));
    assert.equal(code, 1);
    assert.match(out, /carries a "android-play" store metadata tree/);
  });

  test('COVERAGE LOST when the declaration cites no source at all', () => {
    const { code, out } = run(tree({ decl: { sources: { allowedHosts: ['support.google.com'] } } }));
    assert.equal(code, 1);
    assert.match(out, /ZERO usable citations/);
  });

  // A GOOD citation is kept alongside the bad one on purpose: with only the bad
  // one the guard COVERAGE LOSTs on "zero usable citations" and exits before the
  // host limb is reported, so the case would prove the wrong thing.
  test('a citation from a host that neither wrote nor enforces the rule fails', () => {
    const { code, out } = run(
      tree({
        decl: {
          sources: {
            allowedHosts: ['support.google.com'],
            houseAdsTrigger: {
              url: 'https://support.google.com/googleplay/android-developer/answer/9859455',
              fetched: '2026-08-09',
              quote: 'House ads: My app renders a small ad banner, interstitial ad, ad wall, and/or widget',
            },
            blogPost: { url: 'https://example.com/post', fetched: '2026-08-09', quote: 'trust me' },
          },
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /which is not in sources\.allowedHosts/);
  });
});
