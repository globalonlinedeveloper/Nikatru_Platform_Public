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
// The fixtures below then cover the limbs a real-tree mutation cannot reach
// without breaking other guards (a narrowed root, a missing anchor, a Play
// vocabulary that lost the advertising purpose).
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
      appRegistry: 'sites/_shared/_data/apps.json',
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
        assertsAbsence: true,
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

  files['sites/_shared/_data/apps.json'] = json(registry ?? [{ slug: 'app1' }]);

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

  test('🔴 a CustomPainter promo surface fires — it paints pixels, its name just breaks the convention', () => {
    const { code, out } = run(
      tree({ dart: { 'apps/app1/lib/x.dart': 'class PromoPainter extends CustomPainter {}\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /PromoPainter \(CustomPainter\)/);
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
            appRegistry: 'sites/_shared/_data/apps.json',
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
    const { code, out } = run(tree({ decl: { formatScan: { roots: ['apps/app1/lib', 'packages/design_system/lib'], minFiles: 50, requiredCoverage: [{ file: 'packages/design_system/lib/paywall_gate.dart', symbol: 'PaywallGate', why: 'control' }], configPayloads: ['services/platform/src/app-config-data.json'], appRegistry: 'sites/_shared/_data/apps.json' } } }));
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
            appRegistry: 'sites/_shared/_data/apps.json',
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
