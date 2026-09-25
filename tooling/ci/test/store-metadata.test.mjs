// ─────────────────────────────────────────────────────────────────────────────
// store-metadata.test.mjs — assert-store-metadata.mjs must be able to FAIL.
//
// [pipeline D-5] the store listing is generated from the spec, lives in the repo
// and is never hand-typed into a console as the only copy.
//
// ⚠️ THESE FIXTURES ARE THE SECOND LINE OF EVIDENCE, NOT THE FIRST. CLAUDE.md:
// "A fixture passing is not a guard working — MUTATE THE REAL TREE", because a
// fixture you wrote encodes the same misunderstanding as the guard you wrote.
// The guard was mutation-proven FIRST, against a scratch COPY of the real tree
// (2026-08-01, 19 mutations): 18 caught, 1 PRINTED by design, restore verified
// green before and after every case, and no case "caught" by a crash. That run
// found a real hole these fixtures would not have: deleting the whole
// `msix_config:` block from apps/subscriptiontracker/pubspec.yaml exited 0, because the guard
// treated "no packaging block" as the stamped-app case rather than as a
// regression on an app that already carries the channel's metadata tree. The
// asymmetry that fixed it is the same one the trees use — creating is
// owner-gated, KEEPING is not.
//
// Every case builds a fake tree and runs the real guard against it with the root
// passed as argv[2], so this exercises the real code with no stubbing.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { encodeRgba } from '../../store/png-codec.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-store-metadata.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-storemeta-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const SENTINEL = 'PARTNER-CENTER-PENDING';

const REQUIRED = [
  'README.md',
  'title.txt',
  'short-description.txt',
  'long-description.txt',
  'category.txt',
  'privacy-policy-url.txt',
  'support-url.txt',
  'screenshots/README.md',
];

/** Field contents that are VALID by construction — every failing case below
 *  changes exactly one of them, so a failure is attributable. */
const FIELD = {
  'README.md': 'how each field derives from the spec\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'A longer description.\n',
  'category.txt': 'Productivity\n',
  'privacy-policy-url.txt': 'https://nikatru.com/privacy.html\n',
  'support-url.txt': 'https://nikatru.com/contact.html\n',
  'terms-of-use-url.txt': 'https://nikatru.com/terms\n',
  'screenshots/README.md': 'slot; dimensions UNVERIFIED\n',
  'search-terms.txt': 'a\nb\nc\n',
};

/** `YYYY-MM-DD`, `n` days from now in UTC — the same clock the guard reads.
 *  Computed rather than hard-coded: a literal future date in a fixture is a test
 *  that passes until it silently stops, and this file would then be asserting
 *  the EXPIRED branch while claiming to assert the live one. */
const isoDaysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** A deferral that legitimately covers a missing tree: a real future date AND a
 *  written reason for THE TREE. `reason` is carried too, exactly as every real
 *  row carries one, to prove the guard does NOT accept it in place of the pair —
 *  that conflation is the hole this pair closes. */
const datedTreeDeferral = (over = {}) => ({
  reason: 'the first publish is manual and owner-gated.',
  treeDeferredUntil: isoDaysFromNow(30),
  treeDeferredWhy: 'no publisher account exists for this channel yet and the listing copy is not written.',
  ...over,
});

const storeRow = (over = {}) => ({
  id: 'windows-store',
  name: 'Microsoft Store',
  platforms: ['windows'],
  kind: 'store',
  surface: 'app',
  served: false,
  submittable: true,
  artifactFormats: ['.msix'],
  storeMetadataDir: 'apps/{app}/store/windows-store',
  ownerQueue: 'A-2',
  packageIdentity: {
    notYetConfiguredSentinel: SENTINEL,
    identityName: SENTINEL,
    publisherDisplayName: SENTINEL,
    publisher: `CN=${SENTINEL}`,
  },
  ...over,
});

/** The android-play row. No `packageIdentity`: Play's package name is the
 *  gradle `applicationId`, which is DERIVABLE (com.nikatru.<slug>) rather than
 *  assigned by a console, so there is nothing to hold a sentinel for. The
 *  release path checks it — tooling/release/submit-play.mjs. */
const playRow = (over = {}) => ({
  id: 'android-play',
  name: 'Google Play',
  platforms: ['android'],
  kind: 'store',
  surface: 'app',
  served: false,
  submittable: true,
  artifactFormats: ['.aab'],
  storeMetadataDir: 'apps/{app}/store/android-play',
  ownerQueue: 'A-3',
  ...over,
});

const contract = () => ({
  requiredFiles: [...REQUIRED],
  urlFiles: ['privacy-policy-url.txt', 'support-url.txt', 'terms-of-use-url.txt'],
  derivedFields: {
    _why: 'generated from the spec, checked rather than asserted',
    'title.txt': { source: 'apps.json', field: 'name', brickVar: 'short_name' },
    'short-description.txt': { source: 'apps.json', field: 'tagline', brickVar: 'description' },
    'privacy-policy-url.txt': { source: 'portfolioUrls', field: 'privacyUrl' },
    'support-url.txt': { source: 'portfolioUrls', field: 'supportUrl' },
    'terms-of-use-url.txt': { source: 'portfolioUrls', field: 'termsUrl', alsoStatedIn: 'long-description.txt' },
  },
  // termsUrl since 2026-09-24 (O-APPLE-LISTING-HAS-NO-EULA), as in the real
  // register. This fixture's windows-store row does not carry the file; the
  // Apple fixture below does.
  portfolioUrls: {
    privacyUrl: 'https://nikatru.com/privacy.html',
    supportUrl: 'https://nikatru.com/contact.html',
    termsUrl: 'https://nikatru.com/terms',
    agreesWithAppConfigConst: { privacyUrl: 'privacyUrl', termsUrl: 'termsUrl' },
  },
  // BOTH layouts, ordered. apps/subscriptiontracker keeps its config under lib/core/config/
  // and the brick stamps lib/core/ — a single template reached only the first,
  // which is how every app the factory produces fell through to a print.
  appConfigPaths: ['apps/{app}/lib/core/config/app_config.dart', 'apps/{app}/lib/core/app_config.dart'],
  perChannel: {
    'windows-store': {
      additionalFiles: ['search-terms.txt'],
      maxLines: { 'search-terms.txt': { max: 7, source: 'MS Store Policies v7.19 §10.1.3' } },
    },
    // Play's three published limits. Only consulted when a tree for this
    // channel actually exists, which is what `withPlay` below builds.
    'android-play': {
      maxChars: {
        'title.txt': { max: 30, source: 'support.google.com/.../9859152 (2026-07-29)' },
        'short-description.txt': { max: 80, source: 'support.google.com/.../9859152 (2026-07-29)' },
        'long-description.txt': { max: 4000, source: 'support.google.com/.../9859152 (2026-07-29)' },
      },
    },
  },
});

/** The linux-snap row. Linux SHOWS a notification and cannot SCHEDULE one,
 *  which is what makes it the REMINDER CLAIMS case a canNotify key would miss. */
const linuxRow = (over = {}) =>
  storeRow({ id: 'linux-snap', name: 'Snap Store', platforms: ['linux'], artifactFormats: ['.snap'], storeMetadataDir: 'apps/{app}/store/linux-snap', ownerQueue: 'A-6', packageIdentity: undefined, ...over });

/** tooling/capability-register.json, cut to what the REMINDER CLAIMS limb
 *  reads: the notifications capability's platformMatrix, as the real register
 *  declares it (assert-adapter-capabilities.mjs holds that to forPlatform). */
const capabilityRegister = () => ({
  capabilities: [
    {
      id: 'notifications',
      owner: 'packages/notifications',
      capabilityMatrix: {
        platformMatrix: {
          android: { canNotify: true, canSchedule: true },
          ios: { canNotify: true, canSchedule: true },
          macos: { canNotify: true, canSchedule: true },
          linux: { canNotify: true, canSchedule: false },
          windows: { canNotify: false, canSchedule: false },
          fuchsia: { canNotify: false, canSchedule: false },
          web: { canNotify: false, canSchedule: false },
        },
      },
    },
  ],
});

/** The first seven lines of the windows-store and linux-snap long-description
 *  as they stood at f46a6aa6 — line 7 is the reminder claim the row removes. */
const BASE_LEDE_WITH_CLAIM_AT_7 = [
  'Nikatru Subscription Tracker keeps every subscription you pay for in one',
  'list, so the renewal that would have surprised you next month is a thing you',
  'already knew about.',
  '',
  'Add each service once with its price and billing cycle. The app works out what',
  'you spend per month and per year, shows the next payment date for each one,',
  'and reminds you before a free trial turns into a charge.',
  '',
].join('\n');

const pubspec = (over = {}) => {
  const cfg = {
    display_name: 'Subly',
    publisher_display_name: SENTINEL,
    identity_name: SENTINEL,
    publisher: `CN=${SENTINEL}`,
    store: 'true',
    ...over,
  };
  return ['name: subscriptiontracker', 'version: 1.0.0+1', '', 'msix_config:', ...Object.entries(cfg).map(([k, v]) => `  ${k}: ${v}`), ''].join('\n');
};

const appConfig = () =>
  [
    'class AppConfig {',
    "  static const String privacyUrl = 'https://nikatru.com/privacy.html';",
    "  static const String contactUrl = 'https://nikatru.com/contact.html';",
    "  static const String termsUrl = 'https://nikatru.com/terms';",
    '}',
    '',
  ].join('\n');

/** What the BRICK stamps into a store tree. A derived field must be exactly the
 *  triple-stached var the register's `brickVar` names, or the register's
 *  portfolio URL — anything else is a listing typed once for fifty apps. */
const BRICK_FIELD = {
  ...FIELD,
  'title.txt': '{{{short_name}}}\n',
  'short-description.txt': '{{{description}}}\n',
  'search-terms.txt': '{{{short_name}}}\n{{app_id.paramCase()}}\n',
};

const BRAND_ASSETS_DART = [
  '// the generator, declared here and called from post_gen.dart',
  'List<String> writeStoreGraphics({',
  '  required Directory storeDir,',
  '}) {',
  '  return <String>[];',
  '}',
  '',
].join('\n');

const POST_GEN_DART = [
  "import 'brand_assets.dart';",
  'void run() {',
  '  _writeStoreGraphics();',
  '}',
  'void _writeStoreGraphics() {',
  "  final register = File('tooling/channel-register.json');",
  '  final written = writeStoreGraphics(storeDir: register);',
  '}',
  '',
].join('\n');

/**
 * Build a fixture repo. Everything is valid unless a knob says otherwise.
 * `mutateRegister(register)` breaks exactly one thing.
 */
function tree({
  mutateRegister = null,
  omitRegister = false,
  mutateCapabilities = null,
  fields = {},
  omitFiles = [],
  extraDirs = [],
  omitTree = false,
  omitPubspec = false,
  pubspecOver = {},
  noMsixConfig = false,
  withPlay = false,
  playFields = {},
  omitPlayFiles = [],
  omitPlayTree = false,
  withLinux = false,
  linuxFields = {},
  brickFields = {},
  omitBrickFiles = [],
  omitBrickTree = false,
  brandAssetsDart = BRAND_ASSETS_DART,
  postGenDart = POST_GEN_DART,
  apps = [{ slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] }],
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    // ⚠️ REQUIRED IN THE FIXTURE. This guard reads
    // `surfaces.<surface>.storeMetadataGradedBy` to decide which store rows are
    // its domain — the extension surface's listing trees are graded by
    // extensions/scripts/check-store-metadata.mjs — so a fixture without the
    // block is COVERAGE LOST, which a case below asserts deliberately.
    surfaces: {
      app: {
        what: 'a Flutter application delivered to a device',
        platforms: ['android', 'ios', 'linux', 'macos', 'web', 'windows'],
        platformsSource: "Flutter's own target names",
        storeMetadataGradedBy: 'tooling/ci/assert-store-metadata.mjs',
      },
      extension: {
        what: 'a browser extension shipped from extensions/',
        platforms: ['chrome', 'edge', 'firefox'],
        platformsSource: 'the browser names',
        storeMetadataGradedBy: 'extensions/scripts/check-store-metadata.mjs',
      },
    },
    storeMetadataContract: contract(),
    channels: [
      { id: 'web', name: 'Web', platforms: ['web'], kind: 'web', surface: 'app', served: true, submittable: false, artifactFormats: ['static-bundle'], storeMetadataDir: null },
      storeRow(),
    ],
  };
  if (withPlay) register.channels.push(playRow());
  if (withLinux) register.channels.push(linuxRow());
  if (mutateRegister) mutateRegister(register);

  // The REMINDER CLAIMS limb reads which platforms can schedule from here.
  const capabilities = capabilityRegister();
  if (mutateCapabilities) mutateCapabilities(capabilities);

  write('catalog/apps.json', JSON.stringify(apps, null, 2));
  if (!omitRegister) write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('tooling/capability-register.json', JSON.stringify(capabilities, null, 2));

  for (const app of apps) {
    write(`apps/${app.slug}/lib/core/config/app_config.dart`, appConfig());
    if (!omitPubspec) {
      write(`apps/${app.slug}/pubspec.yaml`, noMsixConfig ? 'name: subscriptiontracker\nversion: 1.0.0+1\n' : pubspec(pubspecOver));
    }
    if (omitTree) continue;
    for (const rel of [...REQUIRED, 'search-terms.txt']) {
      if (omitFiles.includes(rel)) continue;
      write(`apps/${app.slug}/store/windows-store/${rel}`, fields[rel] ?? FIELD[rel]);
    }
    for (const d of extraDirs) write(`apps/${app.slug}/store/${d}/README.md`, 'orphan\n');
    if (withPlay && !omitPlayTree) {
      for (const rel of REQUIRED) {
        if (omitPlayFiles.includes(rel)) continue;
        write(`apps/${app.slug}/store/android-play/${rel}`, playFields[rel] ?? FIELD[rel]);
      }
    }
    if (withLinux) {
      for (const rel of REQUIRED) write(`apps/${app.slug}/store/linux-snap/${rel}`, linuxFields[rel] ?? FIELD[rel]);
    }
  }

  // ── THE FACTORY. Every store row the register declares must have a template
  // tree under the brick, or a stamped app's listing has to be hand-typed —
  // which is the observation that makes D-5 false and the one the guard could
  // not see until 2026-08-06.
  write('tooling/bricks/app/hooks/brand_assets.dart', brandAssetsDart);
  write('tooling/bricks/app/hooks/post_gen.dart', postGenDart);
  write('tooling/bricks/app/__brick__/apps/{{app_id}}/lib/core/app_config.dart', appConfig());
  if (!omitBrickTree) {
    for (const row of register.channels.filter((c) => c.kind === 'store' && typeof c.storeMetadataDir === 'string')) {
      const dir = `tooling/bricks/app/__brick__/${row.storeMetadataDir.replace('{app}', '{{app_id}}')}`;
      const extra = register.storeMetadataContract?.perChannel?.[row.id]?.additionalFiles ?? [];
      for (const rel of [...(register.storeMetadataContract?.requiredFiles ?? []), ...extra]) {
        if (omitBrickFiles.includes(`${row.id}/${rel}`)) continue;
        write(`${dir}/${rel}`, brickFields[`${row.id}/${rel}`] ?? brickFields[rel] ?? BRICK_FIELD[rel] ?? 'stamped\n');
      }
    }
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A crash is not a catch. Every failing case asserts a real complaint. */
const assertComplained = (out) => {
  assert.doesNotMatch(out, /TypeError|ReferenceError|node:internal/, out);
  assert.match(out, /^FAIL /m, out);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-store-metadata — the listing exists, is complete, and is derived', () => {
  test('PASSES on a complete, spec-derived tree', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /assert-store-metadata: ok/);
    assert.match(out, /REQUIRED_COVERAGE — 1 store channel\(s\) × 1 app\(s\) = 1 expected tree\(s\)/);
  });

  // ── the recorded failing case from D-5's replacement acceptance ────────────
  test('FAILS when one metadata file is deleted from a tree that exists', () => {
    const { code, out } = run(tree({ omitFiles: ['title.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /title\.txt is missing/);
  });

  test('FAILS when a required field is emptied to whitespace', () => {
    const { code, out } = run(tree({ fields: { 'category.txt': '   \n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /category\.txt is EMPTY/);
  });

  test('COVERAGE LOST when every expected tree is gone', () => {
    const { code, out } = run(tree({ omitTree: true }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — 1 store metadata tree\(s\) are expected and NONE exists/);
  });

  // ── "generated from the spec" is CHECKED, not asserted in a README ─────────
  test('FAILS when a listing field forks from its apps.json spec source', () => {
    const { code, out } = run(tree({ fields: { 'title.txt': 'Subly Pro\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /has forked from its spec source/);
  });

  test('FAILS when a URL field forks from its app_config.dart spec source', () => {
    const { code, out } = run(tree({ fields: { 'support-url.txt': 'https://example.com/help\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /support-url\.txt has forked from its spec source/);
  });

  test('FAILS when a URL field is not an absolute https URL (MS policy 10.5.1)', () => {
    const { code, out } = run(tree({ fields: { 'privacy-policy-url.txt': '/privacy.html\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /not a single absolute https URL/);
  });

  // ── the ONE sourced numeric limit ─────────────────────────────────────────
  test('FAILS on an 8th search term, and cites the policy it comes from', () => {
    const { code, out } = run(tree({ fields: { 'search-terms.txt': 'a\nb\nc\nd\ne\nf\ng\nh\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /has 8 entries and the limit is 7/);
    assert.match(out, /10\.1\.3/);
  });

  test('PASSES on exactly 7 search terms — the limit is not off by one', () => {
    const { code, out } = run(tree({ fields: { 'search-terms.txt': 'a\nb\nc\nd\ne\nf\ng\n' } }));
    assert.equal(code, 0, out);
  });

  // ── REQUIRED_COVERAGE is a RELATIONSHIP: it grows with the register ────────
  // ⏳ AND A DEFERRED ROW WITH NO TREE IS A PROMISE WITH A DATE ON IT. The five
  // cases below are one limb: the print is available only while the row carries
  // `deferral.treeDeferredUntil` (a real future date) AND `treeDeferredWhy`.
  // MEASURED 2026-09-20: without that pair this branch printed unconditionally,
  // and apps/subscriptiontracker/store/apps-gov-in/ did not exist at all while
  // that channel's verified publisher profile was expiring.
  const deferredNoTree = (over = {}) =>
    storeRow({ id: 'linux-snap', platforms: ['linux'], storeMetadataDir: 'apps/{app}/store/linux-snap', ownerQueue: 'A-6', packageIdentity: undefined, ...over });

  test('PRINTS, and does not fail, when a DEFERRED store row with a DATED tree deferral has no tree', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => r.channels.push(deferredNoTree({ deferral: datedTreeDeferral() })) }));
    assert.equal(code, 0, out);
    assert.match(out, /NO TREE \(deferred until \d{4}-\d{2}-\d{2}\): apps\/subscriptiontracker\/store\/linux-snap/);
    assert.match(out, /no publisher account exists for this channel yet/);
    assert.match(out, /= 2 expected tree\(s\)/);
  });

  test('FAILS when a DEFERRED store row has no tree and no `deferral` block at all', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => r.channels.push(deferredNoTree()) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps\/subscriptiontracker\/store\/linux-snap — and the row declares no `deferral` block at all/);
  });

  // 🔴 THE CONFLATION THE PAIR EXISTS TO STOP. Every real row already carries a
  // `deferral.reason`, and every one of them is about the PUBLISH. A publish
  // deferral is not a reason eight text files cannot exist in a repository.
  test('FAILS when the row carries only `deferral.reason` — a publish deferral is not a tree deferral', () => {
    const { code, out } = run(
      tree({ mutateRegister: (r) => r.channels.push(deferredNoTree({ deferral: { reason: '[ADR 015] §2 — native Linux is deferred until there is revenue.', alsoBlockedBy: null } })) }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /carries no `treeDeferredUntil`/);
  });

  test('FAILS when the deferral is dated but carries no reason for the TREE', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => r.channels.push(deferredNoTree({ deferral: datedTreeDeferral({ treeDeferredWhy: '  ' }) })) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /`deferral\.treeDeferredWhy` is missing or empty/);
  });

  test('FAILS when the tree deferral date has PASSED — the deferral ran out and the tree never arrived', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => r.channels.push(deferredNoTree({ deferral: datedTreeDeferral({ treeDeferredUntil: isoDaysFromNow(-1) }) })) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /which has PASSED/);
  });

  // A shape that is not a date cannot expire, so it is an exemption spelled
  // like a deadline. `2026-02-31` matches YYYY-MM-DD and is not a day.
  test('FAILS when `treeDeferredUntil` matches the shape but is not a real calendar date', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => r.channels.push(deferredNoTree({ deferral: datedTreeDeferral({ treeDeferredUntil: '2026-02-31' }) })) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /is not a real calendar date/);
  });

  // The boundary, asserted rather than left to a reader: the named day is still
  // covered and the guard reds the day AFTER. Reading "until X" as "expired on
  // X" would shorten every deferral by a day — the guard editing a decision
  // instead of enforcing one.
  test('PRINTS on the LAST day the deferral covers — the date itself is not yet expired', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => r.channels.push(deferredNoTree({ deferral: datedTreeDeferral({ treeDeferredUntil: isoDaysFromNow(0) }) })) }));
    assert.equal(code, 0, out);
    assert.match(out, /NO TREE \(deferred until \d{4}-\d{2}-\d{2}\)/);
  });

  test('FAILS when a SERVED store row has no tree', () => {
    const { code, out } = run(
      tree({
        mutateRegister: (r) => r.channels.push(storeRow({ id: 'linux-snap', served: true, platforms: ['linux'], storeMetadataDir: 'apps/{app}/store/linux-snap', ownerQueue: 'A-6', packageIdentity: undefined })),
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /is SERVED and app "subscriptiontracker" carries no metadata tree/);
  });

  test('FAILS when a store row contributes NO expected tree (no storeMetadataDir)', () => {
    const { code, out } = run(
      tree({ mutateRegister: (r) => r.channels.push(storeRow({ id: 'linux-snap', platforms: ['linux'], storeMetadataDir: null, packageIdentity: undefined })) }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /contributes ZERO expected metadata trees/);
  });

  test('FAILS on an ORPHAN tree no register row declares', () => {
    const { code, out } = run(tree({ extraDirs: ['legacy-store'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /is a store metadata tree that no `kind: "store"` row/);
  });

  // ── the contract itself cannot be quietly emptied ─────────────────────────
  test('COVERAGE LOST when storeMetadataContract.requiredFiles is emptied', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => (r.storeMetadataContract.requiredFiles = []) }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*requiredFiles is missing or empty/);
  });

  test('COVERAGE LOST when storeMetadataContract is deleted outright', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => delete r.storeMetadataContract }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*declares no `storeMetadataContract`/);
  });

  // ── THE SURFACE SCOPE, 2026-09-05 ────────────────────────────────────────
  // The expected product is { kind:"store" rows OF THIS SURFACE } x { apps }, and
  // "of this surface" is DECLARED in the register rather than guessed: each
  // surface names its `storeMetadataGradedBy` and this file takes the rows that
  // name IT. These cases hold the three properties that makes that a domain
  // rather than a shrink — the block is required, a row handed to another grader
  // is PRINTED with the grader's name, and it does not enter the app product.
  test('an extension-surface store row does NOT demand apps/<app>/store/<store>', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        r.channels.push({
          id: 'chrome-webstore',
          name: 'Chrome Web Store',
          surface: 'extension',
          platforms: ['chrome'],
          kind: 'store',
          served: false,
          submittable: false,
          artifactFormats: ['.zip'],
          storeMetadataDir: 'extensions/Extension/{tool}/store/chrome',
          extensionStoreKey: 'chrome',
        });
      },
    }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /store\/chrome-webstore/);
  });

  test('and it is PRINTED with the guard that does grade it — a handover, not a disappearance', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        r.channels.push({
          id: 'amo',
          name: 'Firefox Add-ons',
          surface: 'extension',
          platforms: ['firefox'],
          kind: 'store',
          served: false,
          submittable: false,
          artifactFormats: ['.zip'],
          storeMetadataDir: 'extensions/Extension/{tool}/store/firefox',
          extensionStoreKey: 'firefox',
        });
      },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /NOT THIS GUARD'S DOMAIN: channel "amo"/);
    assert.match(out, /extensions\/scripts\/check-store-metadata\.mjs/);
  });

  test('COVERAGE LOST when the surfaces block is deleted — the filter would match nothing', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => delete r.surfaces }));
    assert.equal(code, 2, out);
    assert.match(out, /declares no `surfaces` block/);
  });

  test('COVERAGE LOST when no surface names THIS guard as its grader', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => { r.surfaces.app.storeMetadataGradedBy = 'tooling/ci/assert-something-else.mjs'; },
    }));
    assert.equal(code, 2, out);
    assert.match(out, /as `storeMetadataGradedBy` for NO surface/);
  });

  test('COVERAGE LOST when every store row belongs to another grader', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => { for (const c of r.channels) if (c.kind === 'store') c.surface = 'extension'; },
    }));
    assert.equal(code, 2, out);
    assert.match(out, /ZERO `kind: "store"` channels on the surface\(s\) this guard grades/);
  });

  test('COVERAGE LOST when no row is kind:"store" any more', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => r.channels.forEach((c) => (c.kind = 'direct')) }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*ZERO `kind: "store"` channels/);
  });

  test('COVERAGE LOST when the register is absent', () => {
    const { code, out } = run(tree({ omitRegister: true }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/channel-register\.json does not exist/);
  });

  test('COVERAGE LOST when apps.json carries no apps', () => {
    const { code, out } = run(tree({ apps: [] }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── the MSIX package identity: one declaration, two readers ───────────────
  test('PRINTS when the whole identity is still the not-yet-configured sentinel', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /PACKAGE IDENTITY NOT YET CONFIGURED/);
  });

  test('FAILS when the register and the pubspec declare DIFFERENT identities', () => {
    const { code, out } = run(tree({ pubspecOver: { identity_name: 'Nikatru.Subly' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /package identity DISAGREES/);
  });

  test('FAILS when the identity is HALF configured on both sides', () => {
    const { code, out } = run(
      tree({
        mutateRegister: (r) => (r.channels.find((c) => c.id === 'windows-store').packageIdentity.identityName = 'Nikatru.Subly'),
        pubspecOver: { identity_name: 'Nikatru.Subly' },
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /HALF configured/);
  });

  test('PASSES when every identity field is real and both sides agree', () => {
    const real = { identityName: 'Nikatru.Subly', publisherDisplayName: 'Nikatru', publisher: 'CN=NIKATRU' };
    const { code, out } = run(
      tree({
        mutateRegister: (r) => Object.assign(r.channels.find((c) => c.id === 'windows-store').packageIdentity, real),
        pubspecOver: { identity_name: real.identityName, publisher_display_name: real.publisherDisplayName, publisher: real.publisher },
      }),
    );
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /PACKAGE IDENTITY NOT YET CONFIGURED/);
  });

  test('FAILS when a packageIdentity field is dropped from the register', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => delete r.channels.find((c) => c.id === 'windows-store').packageIdentity.publisher }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /packageIdentity\.publisher is missing or empty/);
  });

  test('FAILS when packageIdentity declares no not-yet-configured sentinel', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => delete r.channels.find((c) => c.id === 'windows-store').packageIdentity.notYetConfiguredSentinel }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /no `notYetConfiguredSentinel`/);
  });

  // 🔴 THE HOLE THE REAL-TREE MUTATION FOUND AND THESE FIXTURES WOULD NOT HAVE.
  test('FAILS when msix_config is deleted from an app that CARRIES the channel tree', () => {
    const { code, out } = run(tree({ noMsixConfig: true }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares no `msix_config:` block while app "subscriptiontracker" carries channel/);
  });

  // The other side of that asymmetry: an app that never had either is the
  // stamped-app case D-5 still owes brick work for, and prints.
  test('PRINTS for a stamped app with no tree and no msix_config, while the real app stays checked', () => {
    const root = tree({
      // The stamped app has no tree for this channel, so the row must carry a
      // DATED tree deferral or the missing tree is a FAIL — see the deferral
      // cases above. The msix_config print is what this case is about.
      mutateRegister: (r) => {
        r.channels.find((c) => c.id === 'windows-store').deferral = datedTreeDeferral();
      },
      apps: [
        { slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] },
      ],
    });
    // Add a second app with a pubspec but no msix_config and no store tree.
    mkdirSync(join(root, 'apps', 'probe'), { recursive: true });
    writeFileSync(join(root, 'apps', 'probe', 'pubspec.yaml'), 'name: probe\nversion: 1.0.0+1\n');
    writeFileSync(
      join(root, 'catalog', 'apps.json'),
      JSON.stringify([
        { slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] },
        { slug: 'probe', name: 'Probe', tagline: 'A probe', platforms: ['web'] },
      ]),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /NO msix_config: apps\/probe\/pubspec\.yaml/);
    assert.match(out, /NO TREE \(deferred until \d{4}-\d{2}-\d{2}\): apps\/probe\/store\/windows-store/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `maxChars` — the SECOND limit kind, added with the Apple channels.
//
// `maxLines` counts entries (MS Store search terms); `maxChars` counts characters
// of the trimmed field, which is the shape Apple's App Name and Subtitle take.
// Those two are the ONLY Apple listing limits this repo has a primary source for
// — the keywords field, description and promotional text are all recorded as
// COULD-NOT-ESTABLISH in Private/requirements/ledger.json’s [10]D-5 entry (was
// pipeline/10-distribution-store.md, folded into that JSON spec 2026-08-15) and carry
// no number anywhere.
//
// 🔴 THE THREE CASES THAT MATTER ARE THE LAST THREE. An invented limit fires on
// CORRECT input, so: exactly-at-the-limit must PASS, an undeclared field must be
// unconstrained at any length, and a limit whose citation was deleted must FAIL
// LOUDLY rather than be silently skipped — a skipped limit leaves the register
// claiming a constraint that does nothing.
// ─────────────────────────────────────────────────────────────────────────────
const APPLE_SOURCE = 'developer.apple.com/help/app-store-connect/reference/app-information/ — fetched 2026-07-29';

/** The Apple long description states the Terms of Use URL, as the register's
 *  derivedFields["terms-of-use-url.txt"].alsoStatedIn requires (2026-09-24). */
const APPLE_LONG_DESCRIPTION = 'A longer description.\nTerms of use: https://nikatru.com/terms\n';

/** A minimal Apple-shaped fixture: one store row, maxChars, no packageIdentity. */
function appleTree({ mutateRegister = null, fields = {} } = {}) {
  const root = join(TMP, `a${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    // ⚠️ REQUIRED IN THE FIXTURE. This guard reads
    // `surfaces.<surface>.storeMetadataGradedBy` to decide which store rows are
    // its domain — the extension surface's listing trees are graded by
    // extensions/scripts/check-store-metadata.mjs — so a fixture without the
    // block is COVERAGE LOST, which a case below asserts deliberately.
    surfaces: {
      app: {
        what: 'a Flutter application delivered to a device',
        platforms: ['android', 'ios', 'linux', 'macos', 'web', 'windows'],
        platformsSource: "Flutter's own target names",
        storeMetadataGradedBy: 'tooling/ci/assert-store-metadata.mjs',
      },
      extension: {
        what: 'a browser extension shipped from extensions/',
        platforms: ['chrome', 'edge', 'firefox'],
        platformsSource: 'the browser names',
        storeMetadataGradedBy: 'extensions/scripts/check-store-metadata.mjs',
      },
    },
    storeMetadataContract: {
      requiredFiles: [...REQUIRED],
      urlFiles: ['privacy-policy-url.txt', 'support-url.txt', 'terms-of-use-url.txt'],
      derivedFields: {
        _why: 'generated from the spec',
        'short-description.txt': { source: 'apps.json', field: 'tagline', brickVar: 'description' },
        'privacy-policy-url.txt': { source: 'portfolioUrls', field: 'privacyUrl' },
        'support-url.txt': { source: 'portfolioUrls', field: 'supportUrl' },
        'terms-of-use-url.txt': { source: 'portfolioUrls', field: 'termsUrl', alsoStatedIn: 'long-description.txt' },
      },
      portfolioUrls: {
        privacyUrl: 'https://nikatru.com/privacy.html',
        supportUrl: 'https://nikatru.com/contact.html',
        termsUrl: 'https://nikatru.com/terms',
        agreesWithAppConfigConst: { privacyUrl: 'privacyUrl', termsUrl: 'termsUrl' },
      },
      appConfigPaths: ['apps/{app}/lib/core/config/app_config.dart', 'apps/{app}/lib/core/app_config.dart'],
      perChannel: {
        'ios-appstore': {
          // terms-of-use-url.txt: the Apple listings' Terms of Use URL, as in the
          // real register since 2026-09-24 (O-APPLE-LISTING-HAS-NO-EULA).
          additionalFiles: ['subtitle.txt', 'keywords.txt', 'terms-of-use-url.txt'],
          maxChars: {
            'title.txt': { max: 30, min: 2, source: APPLE_SOURCE },
            'subtitle.txt': { max: 30, source: APPLE_SOURCE },
          },
        },
      },
    },
    channels: [
      {
        id: 'ios-appstore',
        name: 'Apple App Store (iOS)',
        platforms: ['ios'],
        kind: 'store',
        surface: 'app',
        served: false,
        submittable: true,
        artifactFormats: ['.ipa'],
        storeMetadataDir: 'apps/{app}/store/ios-appstore',
        ownerQueue: 'A-4',
      },
    ],
  };
  if (mutateRegister) mutateRegister(register);

  const apps = [{ slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] }];
  write('catalog/apps.json', JSON.stringify(apps, null, 2));
  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('tooling/capability-register.json', JSON.stringify(capabilityRegister(), null, 2));
  write('apps/subscriptiontracker/lib/core/config/app_config.dart', appConfig());
  write('apps/subscriptiontracker/pubspec.yaml', 'name: subscriptiontracker\nversion: 1.0.0+1\n');

  const body = {
    ...FIELD,
    'long-description.txt': APPLE_LONG_DESCRIPTION,
    'subtitle.txt': 'Every subscription, one list\n',
    'keywords.txt': 'subscription,tracker\n',
  };
  for (const rel of [...REQUIRED, 'subtitle.txt', 'keywords.txt', 'terms-of-use-url.txt']) {
    write(`apps/subscriptiontracker/store/ios-appstore/${rel}`, fields[rel] ?? body[rel]);
  }
  // The FACTORY half, so these limit cases exercise the limits rather than
  // tripping over an absent brick. `fields` deliberately does NOT reach here:
  // every case in this describe is about a per-app value, and stamping the same
  // over-long string into the template would make the limb under test ambiguous.
  write('tooling/bricks/app/hooks/brand_assets.dart', BRAND_ASSETS_DART);
  write('tooling/bricks/app/hooks/post_gen.dart', POST_GEN_DART);
  write('tooling/bricks/app/__brick__/apps/{{app_id}}/lib/core/app_config.dart', appConfig());
  const brick = { ...BRICK_FIELD, 'long-description.txt': APPLE_LONG_DESCRIPTION };
  for (const row of register.channels.filter((c) => c.kind === 'store' && typeof c.storeMetadataDir === 'string')) {
    const dir = `tooling/bricks/app/__brick__/${row.storeMetadataDir.replace('{app}', '{{app_id}}')}`;
    const extra = register.storeMetadataContract?.perChannel?.[row.id]?.additionalFiles ?? [];
    for (const rel of [...(register.storeMetadataContract?.requiredFiles ?? []), ...extra]) {
      write(`${dir}/${rel}`, brick[rel] ?? body[rel] ?? 'stamped\n');
    }
  }
  return root;
}

describe('assert-store-metadata — maxChars, the Apple limit kind', () => {
  test('PASSES on a complete Apple tree within both sourced limits', () => {
    const { code, out } = run(appleTree());
    assert.equal(code, 0, out);
    assert.match(out, /assert-store-metadata: ok/);
  });

  test('FAILS on a 31-character subtitle, and cites the page it came from', () => {
    const { code, out } = run(appleTree({ fields: { 'subtitle.txt': `${'x'.repeat(31)}\n` } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subtitle\.txt is 31 characters and the limit is 30/);
    assert.match(out, /app-store-connect\/reference\/app-information/);
  });

  test('FAILS below the sourced minimum of 2 characters', () => {
    const { code, out } = run(appleTree({ fields: { 'title.txt': 'S\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /title\.txt is 1 characters and the minimum is 2/);
  });

  // 🔴 exactly-at-the-limit must PASS. This is the case a made-up "120 chars"
  // failed once, rejecting this repo's own 129-character fixture.
  test('PASSES on exactly 30 characters — the limit is not off by one', () => {
    const { code, out } = run(appleTree({ fields: { 'subtitle.txt': `${'x'.repeat(30)}\n` } }));
    assert.equal(code, 0, out);
  });

  // 🔴 the trailing newline is a text-file convention, not a listing character.
  test('does not count the trailing newline against the limit', () => {
    const { code, out } = run(appleTree({ fields: { 'subtitle.txt': `${'x'.repeat(30)}\n\n` } }));
    assert.equal(code, 0, out);
  });

  test('constrains NOTHING on a field with no declared limit — keywords carry no number', () => {
    const { code, out } = run(appleTree({ fields: { 'keywords.txt': `${'k'.repeat(5000)}\n` } }));
    assert.equal(code, 0, out);
  });

  // 🔴 A LIMIT WITHOUT A CITATION IS NOT ENFORCED, AND NOT SILENTLY SKIPPED.
  test('FAILS when a declared limit has no `source`', () => {
    const { code, out } = run(appleTree({ mutateRegister: (r) => delete r.storeMetadataContract.perChannel['ios-appstore'].maxChars['subtitle.txt'].source }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares a numeric limit with NO `source`/);
  });

  test('FAILS when a maxLines limit has its `source` deleted too — both kinds, one rule', () => {
    const { code, out } = run(
      tree({
        mutateRegister: (r) => delete r.storeMetadataContract.perChannel['windows-store'].maxLines['search-terms.txt'].source,
        fields: { 'search-terms.txt': 'a\nb\n' },
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares a numeric limit with NO `source`/);
  });

  test('FAILS when an Apple-only additionalFile is deleted', () => {
    const root = appleTree();
    rmSync(join(root, 'apps/subscriptiontracker/store/ios-appstore/subtitle.txt'), { force: true });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subtitle\.txt is missing/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// terms-of-use-url.txt — the Apple listings' Terms of Use URL
// (O-APPLE-LISTING-HAS-NO-EULA, 2026-09-24).
//
// The guard gained no code for it: the file reaches every limb through the
// register (ios-appstore `additionalFiles`, `urlFiles`, `derivedFields` from
// `portfolioUrls.termsUrl`, and `agreesWithAppConfigConst.termsUrl`). These
// cases prove each limb reaches it. R1 was also run on the REAL tree: moving
// apps/subscriptiontracker/store/ios-appstore/terms-of-use-url.txt away exits 1
// naming it. On the base commit the file did not exist and the guard exited 0
// without a word about terms. The pre-change guard CODE exits 1 on this tree as
// well, which is the point: the requirement is register data, not guard code.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-store-metadata — terms-of-use-url.txt on the Apple listings', () => {
  test('R1: FAILS when ios-appstore carries no terms-of-use-url.txt, and names it', () => {
    const root = appleTree();
    rmSync(join(root, 'apps/subscriptiontracker/store/ios-appstore/terms-of-use-url.txt'), { force: true });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps\/subscriptiontracker\/store\/ios-appstore\/terms-of-use-url\.txt is missing/);
  });

  test('R2: FAILS when the terms URL has forked from portfolioUrls.termsUrl', () => {
    const { code, out } = run(appleTree({ fields: { 'terms-of-use-url.txt': 'https://nikatru.com/terms-old\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /terms-of-use-url\.txt has forked from its spec source/);
    assert.match(out, /portfolioUrls:termsUrl says "https:\/\/nikatru\.com\/terms"/);
  });

  test('R3: FAILS when an app_config termsUrl disagrees with portfolioUrls.termsUrl', () => {
    const root = appleTree();
    writeFileSync(
      join(root, 'apps/subscriptiontracker/lib/core/config/app_config.dart'),
      [
        'class AppConfig {',
        "  static const String privacyUrl = 'https://nikatru.com/privacy.html';",
        "  static const String termsUrl = 'https://nikatru.com/terms-of-service';",
        '}',
        '',
      ].join('\n'),
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /compiles `termsUrl = "https:\/\/nikatru\.com\/terms-of-service"`/);
    assert.match(out, /portfolioUrls\.termsUrl publishes "https:\/\/nikatru\.com\/terms"/);
  });

  test("FAILS when the brick's Apple terms-of-use-url.txt is not portfolioUrls.termsUrl", () => {
    const root = appleTree();
    writeFileSync(join(root, 'tooling/bricks/app/__brick__/apps/{{app_id}}/store/ios-appstore/terms-of-use-url.txt'), 'https://nikatru.com/eula\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /ios-appstore\/terms-of-use-url\.txt reads "https:\/\/nikatru\.com\/eula"/);
    assert.match(out, /portfolioUrls\.termsUrl says "https:\/\/nikatru\.com\/terms"/);
  });

  // ── alsoStatedIn: the long description must STATE the URL (R6) ────────────
  // On the real tree, dropping the line from the ios-appstore long description
  // exits 1 on this guard and 0 on the pre-change one.
  test('R6: FAILS when the Apple long description drops its `Terms of use:` line', () => {
    const { code, out } = run(appleTree({ fields: { 'long-description.txt': 'A longer description.\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps\/subscriptiontracker\/store\/ios-appstore\/long-description\.txt does not state "https:\/\/nikatru\.com\/terms"/);
  });

  test('R6: a LONGER url that merely contains the terms URL does not count', () => {
    const { code, out } = run(appleTree({ fields: { 'long-description.txt': 'A longer description.\nTerms of use: https://nikatru.com/terms-old\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /ios-appstore\/long-description\.txt does not state "https:\/\/nikatru\.com\/terms"/);
  });

  // The token rule must not fire on CORRECT input: a URL that ends a sentence.
  test('R6: PASSES when the URL ends a sentence with a full stop', () => {
    const { code, out } = run(appleTree({ fields: { 'long-description.txt': 'A longer description.\nRead the terms at https://nikatru.com/terms.\n' } }));
    assert.equal(code, 0, out);
    assert.match(out, /2 derived value\(s\) found stated verbatim/);
  });

  test("R6: FAILS when the brick's Apple long description does not state the URL", () => {
    const root = appleTree();
    writeFileSync(join(root, 'tooling/bricks/app/__brick__/apps/{{app_id}}/store/ios-appstore/long-description.txt'), 'A longer description.\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /__brick__\/apps\/\{\{app_id\}\}\/store\/ios-appstore\/long-description\.txt does not state "https:\/\/nikatru\.com\/terms"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The android-play half of D-5. The guard is GENERIC over `kind: "store"` rows,
// so the coverage relationship picked this channel up the moment the register
// declared it — these cases prove that rather than assume it, and pin the one
// thing that is genuinely new: SOURCED CHARACTER LIMITS.
//
// ⚠️ MUTATION-PROVEN FIRST, against a scratch COPY of the real tree (2026-08-01,
// 25 mutations across this guard, assert-channel-register.mjs and
// tooling/release/submit-play.mjs): 23 FAIL, 2 PRINT by design, restore
// re-verified green before and after every case, no case "caught" by a crash.
// These fixtures are the regression net, not the evidence.
describe('assert-store-metadata — android-play (Google Play)', () => {
  test('PASSES with two store trees and counts BOTH channels in the relationship', () => {
    const { code, out } = run(tree({ withPlay: true }));
    assert.equal(code, 0, out);
    assert.match(out, /REQUIRED_COVERAGE — 2 store channel\(s\) × 1 app\(s\) = 2 expected tree\(s\); 2 present and complete/);
  });

  // 🔴 THE ASYMMETRY, BOTH HALVES. Creating a tree is owner-gated; KEEPING one
  // is not. "PRINT everything" is how an owner-gated exemption eats the check.
  // ⏳ AND THE PRINT HALF IS ITSELF DATED NOW: `ownerQueue` is a pointer into a
  // repository CI cannot open, so quoting it never said when the tree was due.
  test('PRINTS, and does not fail, when the deferred row has NO tree and a DATED tree deferral', () => {
    const { code, out } = run(
      tree({
        withPlay: true,
        omitPlayTree: true,
        mutateRegister: (r) => {
          r.channels.find((c) => c.id === 'android-play').deferral = datedTreeDeferral();
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /NO TREE \(deferred until \d{4}-\d{2}-\d{2}\): apps\/subscriptiontracker\/store\/android-play/);
    assert.match(out, /this print becomes a FAIL/);
  });

  test('FAILS when the deferred android-play row has NO tree and no dated deferral', () => {
    const { code, out } = run(tree({ withPlay: true, omitPlayTree: true }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /channel "android-play" is deferred and app "subscriptiontracker" carries no metadata tree/);
  });

  test('FAILS when a file is deleted from the android-play tree that EXISTS', () => {
    const { code, out } = run(tree({ withPlay: true, omitPlayFiles: ['title.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps\/subscriptiontracker\/store\/android-play\/title\.txt is missing/);
  });

  test('FAILS when the android-play screenshot slot README is deleted', () => {
    const { code, out } = run(tree({ withPlay: true, omitPlayFiles: ['screenshots/README.md'] }));
    assert.equal(code, 1, out);
    assert.match(out, /android-play\/screenshots\/README\.md is missing/);
  });

  test('FAILS when an android-play field is emptied', () => {
    const { code, out } = run(tree({ withPlay: true, playFields: { 'category.txt': '   \n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /android-play\/category\.txt is EMPTY/);
  });

  test('FAILS when android-play title.txt forks from apps.json name', () => {
    const { code, out } = run(tree({ withPlay: true, playFields: { 'title.txt': 'Sublyx\n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /android-play\/title\.txt has forked from its spec source/);
  });

  // ── the sourced character limits ───────────────────────────────────────────
  test('FAILS on an app name over Play’s 30-character cap', () => {
    const name = 'A'.repeat(31);
    const { code, out } = run(
      tree({
        withPlay: true,
        playFields: { 'title.txt': `${name}\n` },
        fields: { 'title.txt': `${name}\n` },
        apps: [{ slug: 'subscriptiontracker', name, tagline: 'Track every subscription in one place', platforms: ['web'] }],
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /android-play\/title\.txt is 31 characters and the limit is 30/);
  });

  test('FAILS on a short description over 80 characters', () => {
    const tagline = 'b'.repeat(81);
    const { code, out } = run(
      tree({
        withPlay: true,
        playFields: { 'short-description.txt': `${tagline}\n` },
        fields: { 'short-description.txt': `${tagline}\n` },
        apps: [{ slug: 'subscriptiontracker', name: 'Subly', tagline, platforms: ['web'] }],
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /short-description\.txt is 81 characters and the limit is 80/);
  });

  test('FAILS on a full description over 4000 characters', () => {
    const { code, out } = run(tree({ withPlay: true, playFields: { 'long-description.txt': `${'c'.repeat(4001)}\n` } }));
    assert.equal(code, 1, out);
    assert.match(out, /long-description\.txt is 4001 characters and the limit is 4000/);
  });

  test('PASSES at exactly the limit — an off-by-one here rejects correct copy', () => {
    const name = 'A'.repeat(30);
    const { code, out } = run(
      tree({
        withPlay: true,
        playFields: { 'title.txt': `${name}\n` },
        fields: { 'title.txt': `${name}\n` },
        apps: [{ slug: 'subscriptiontracker', name, tagline: 'Track every subscription in one place', platforms: ['web'] }],
      }),
    );
    assert.equal(code, 0, out);
  });

  // Counting UTF-16 units would score this 60 and reject copy Google accepts.
  test('counts CODE POINTS, not UTF-16 units — 30 astral characters PASS', () => {
    const name = '\u{1F600}'.repeat(30);
    const { code, out } = run(
      tree({
        withPlay: true,
        playFields: { 'title.txt': `${name}\n` },
        fields: { 'title.txt': `${name}\n` },
        apps: [{ slug: 'subscriptiontracker', name, tagline: 'Track every subscription in one place', platforms: ['web'] }],
      }),
    );
    assert.equal(code, 0, out);
  });

  // 🔴 A limit nobody can trace is a remembered number, and a remembered number
  // fires on CORRECT input. This is the negative test for that rule.
  test('FAILS on a declared limit with no `source` rather than enforcing it', () => {
    const { code, out } = run(
      tree({
        withPlay: true,
        mutateRegister: (r) => {
          delete r.storeMetadataContract.perChannel['android-play'].maxChars['title.txt'].source;
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /maxChars\["title.txt"\] declares a numeric limit with NO `source`/);
  });

  test('COVERAGE LOST when limits are declared for a present tree and none is evaluated', () => {
    const { code, out } = run(
      tree({
        withPlay: true,
        mutateRegister: (r) => {
          const per = r.storeMetadataContract.perChannel;
          per['android-play'].maxChars = { 'nope.txt': { max: 30, source: 'x' } };
          delete per['windows-store'].maxLines;
        },
      }),
    );
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE was evaluated/);
  });

  test('the summary line reports how many limits were actually measured', () => {
    const { code, out } = run(tree({ withPlay: true }));
    assert.equal(code, 0, out);
    assert.match(out, /4 measured against a SOURCED store limit/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FACTORY. Everything above this line has a hand-made directory for its
// subject, and that is how D-5 passed for months while the brick emitted no
// `store/` tree at all: `find tooling/bricks/app -ipath "*store*"` returned ZERO
// files on `main` @ 26c2303 while the guard printed "5 present and complete".
//
// ⚠️ AGAIN: these fixtures are the SECOND line of evidence. Every case below was
// first proven against the REAL tree on 2026-08-06 — the brick's windows-store
// templates deleted (RED), a derived template replaced with a literal (RED),
// with a double stache (RED), with the wrong var (RED), a required template
// deleted (RED), the register's portfolio URL changed (RED, and it reached BOTH
// app_config layouts plus the brick's), and the real `writeStoreGraphics` call
// gutted. THAT LAST ONE FOUND TWO HOLES IN THIS GUARD, and no fixture would
// have: the bare pattern matched post_gen's own `_writeStoreGraphics` wrapper,
// and after that was fixed it matched the mutation's own `// writeStoreGraphics(`
// COMMENT. Both are cases below.
// ─────────────────────────────────────────────────────────────────────────────
const withGraphics = (r) => {
  r.storeMetadataContract.perChannel['windows-store'].additionalFiles = ['search-terms.txt'];
  r.storeMetadataContract.perChannel['windows-store'].graphicAssets = {
    assets: { 'feature-graphic.png': { width: 1024, height: 500, alpha: false, source: 'support.google.com/... (2026-08-04)' } },
  };
};

describe('assert-store-metadata — THE FACTORY: a stamped app gets a listing nobody typed', () => {
  test('PASSES when the brick emits every declared channel, and says so in its coverage line', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /REQUIRED_COVERAGE \(THE FACTORY\) — 1 store channel\(s\) → 1 brick template tree\(s\)/);
    assert.match(out, /4 field\(s\) proven GENERATED from a spec var rather than typed/);
  });

  // The coverage requirement GROWS with the register, exactly as the per-app one
  // does: add a store channel and the factory owes a template tree for it. There
  // is no constant anybody can lower.
  test('a SECOND declared store channel raises what the factory owes', () => {
    const { code, out } = run(tree({ withPlay: true }));
    assert.equal(code, 0, out);
    assert.match(out, /REQUIRED_COVERAGE \(THE FACTORY\) — 2 store channel\(s\) → 2 brick template tree\(s\)/);
  });

  // 🔴 THE DECISIVE CASE. This is the state `main` was in, and the old guard
  // exited 0 on it.
  test('FAILS when the brick emits NO store tree for a declared channel', () => {
    const { code, out } = run(tree({ omitBrickTree: true }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /THE BRICK EMITS NO STORE LISTING for channel "windows-store"/);
  });

  test('FAILS when one template is missing from the brick tree', () => {
    const { code, out } = run(tree({ omitBrickFiles: ['windows-store/long-description.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /long-description\.txt is missing from the brick/);
  });

  test('FAILS on an EMPTY template — every stamped app would get a blank field', () => {
    const { code, out } = run(tree({ brickFields: { 'windows-store/category.txt': '   \n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /is an EMPTY template/);
  });

  // ── the headline: GENERATED, not typed ─────────────────────────────────────
  test('FAILS when a derived field is a hand-typed literal in the template', () => {
    const { code, out } = run(tree({ brickFields: { 'windows-store/title.txt': 'Subly\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /is not generated: it reads "Subly"/);
  });

  test('FAILS on a DOUBLE stache — mason HTML-escapes it and a store title is text', () => {
    const { code, out } = run(tree({ brickFields: { 'windows-store/title.txt': '{{short_name}}\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /must be exactly `\{\{\{short_name\}\}\}`/);
  });

  test('FAILS when the template interpolates the WRONG var', () => {
    const { code, out } = run(tree({ brickFields: { 'windows-store/title.txt': '{{{display_name}}}\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /interpolates `\{\{\{display_name\}\}\}` but/);
  });

  test('FAILS when the register names no brickVar — nothing then says WHICH var is right', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => delete r.storeMetadataContract.derivedFields['title.txt'].brickVar }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /names no `brickVar`/);
  });

  test('FAILS when the brick stamps a URL the register does not publish', () => {
    const { code, out } = run(tree({ brickFields: { 'windows-store/support-url.txt': 'https://nikatru.com/help.html\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /portfolioUrls\.supportUrl says/);
  });

  // ⚠️ THERE IS NO `COVERAGE LOST` CASE FOR THIS LIMB, AND THAT IS THE POINT.
  // Its domain cannot become silently empty: a channel with no brick tree is a
  // FAIL naming the channel, and a missing template is a FAIL naming the file.
  // Two backstops were written and then DELETED because neither could be reached
  // without one of those FAILs firing first — and COVERAGE LOST exits, so the
  // only thing they could ever have done is replace a precise message with a
  // vague one. The case that would have exercised them is the one above:
  // `omitBrickTree` produces a named failure, not a silent zero.

  // ── the graphics the brick cannot template ────────────────────────────────
  test('FAILS when the generator is declared and post_gen never calls it', () => {
    const { code, out } = run(
      tree({ mutateRegister: withGraphics, postGenDart: 'void run() {\n  _writeBrandAssets();\n}\n' }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /never calls `writeStoreGraphics`/);
  });

  // 🔴 FOUND BY MUTATING THE REAL TREE, NOT BY WRITING THIS TEST. post_gen owns a
  // PRIVATE WRAPPER named `_writeStoreGraphics`, whose name contains the pattern.
  // With a bare match, gutting the real call inside that wrapper left the guard
  // green — the same shape as the 2026-07-26 seams defect, where a caller check
  // was satisfied by the function's own declaration.
  test('the private `_writeStoreGraphics` wrapper does NOT satisfy the caller check', () => {
    const { code, out } = run(
      tree({
        mutateRegister: withGraphics,
        postGenDart: 'void run() {\n  _writeStoreGraphics();\n}\nvoid _writeStoreGraphics() {\n  final x = 1;\n}\n',
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /never calls `writeStoreGraphics`/);
  });

  // 🔴 THE SECOND HOLE THE SAME MUTATION FOUND. Commenting the call out is the
  // most likely way it disappears, and a text scan reads a comment as code —
  // this repository's oldest guard defect (`grep '"r2_buckets"'` matching the
  // comment explaining why there is no r2_buckets).
  test('a COMMENTED-OUT call does not satisfy the caller check', () => {
    const { code, out } = run(
      tree({
        mutateRegister: withGraphics,
        postGenDart: 'void run() {\n  final written = <String>[]; // writeStoreGraphics(\n}\n',
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /never calls `writeStoreGraphics`/);
  });

  test('FAILS when the generator itself is gone from brand_assets.dart', () => {
    const { code, out } = run(tree({ mutateRegister: withGraphics, brandAssetsDart: '// nothing here\n' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares no `writeStoreGraphics`/);
  });

  test('FAILS when the stamp hard-codes the dimensions instead of reading the register', () => {
    const { code, out } = run(
      tree({
        mutateRegister: withGraphics,
        postGenDart: 'void run() {\n  writeStoreGraphics(width: 1024, height: 500);\n}\n',
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /does not read tooling\/channel-register\.json/);
  });

  // ── the URLs still tied to the code that ships them ───────────────────────
  test('FAILS when an app_config disagrees with the register it publishes from', () => {
    const root = tree();
    writeFileSync(
      join(root, 'apps/subscriptiontracker/lib/core/config/app_config.dart'),
      "class AppConfig {\n  static const String privacyUrl = 'https://nikatru.com/policy.html';\n}\n",
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /compiles `privacyUrl = "https:\/\/nikatru\.com\/policy\.html"`/);
  });

  test('COVERAGE LOST when the named app_config constant exists nowhere', () => {
    const { code, out } = run(
      tree({ mutateRegister: (r) => (r.storeMetadataContract.portfolioUrls.agreesWithAppConfigConst = { privacyUrl: 'renamedAway' }) }),
    );
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE app_config in this tree declares any of them/);
  });

  test('COVERAGE LOST when appConfigPaths is emptied', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => (r.storeMetadataContract.appConfigPaths = []) }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /appConfigPaths is missing, empty/);
  });

  test('COVERAGE LOST when portfolioUrls is deleted outright', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => delete r.storeMetadataContract.portfolioUrls }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no `storeMetadataContract\.portfolioUrls`/);
  });

  test('an UNRESOLVABLE derivation source FAILS rather than printing a gap', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => (r.storeMetadataContract.derivedFields['title.txt'] = { source: 'vibes', field: 'name' }) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /which this guard cannot resolve/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A STORE'S OWN FORM RULES — apps.gov.in (contracts/store/vocabulary.js
// STORE_FORM_RULES, read out of the upload form's script on 2026-09-22).
// Every case below breaks exactly ONE rule of a listing the portal would accept,
// on the app tree or on the brick, and asserts the complaint that names it.
// ─────────────────────────────────────────────────────────────────────────────

const AGI = 'apps-gov-in';

/** A real PNG of the given size (the guard reads the IHDR); `padTo` appends bytes
 *  after IEND, which changes the byte size and nothing the header says. */
const png = (width, height, padTo = 0) => {
  const buf = encodeRgba({ width, height, rgba: Buffer.alloc(width * height * 4, 0xff) }, { opaque: true });
  return padTo > buf.length ? Buffer.concat([buf, Buffer.alloc(padTo - buf.length)]) : buf;
};

/** The smallest JPEG header the guard can measure: SOI, then a baseline SOF0. */
const jpegHeader = (width, height) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);

const agiRow = (rail = 'none') => ({
  id: AGI,
  name: 'apps.gov.in',
  platforms: ['android'],
  kind: 'store',
  surface: 'app',
  served: false,
  submittable: true,
  artifactFormats: ['.apk'],
  storeMetadataDir: 'apps/{app}/store/apps-gov-in',
  ownerQueue: 'A-9',
  // The money answers on the upload form are read off this, never typed
  // ([ADR 094] item 5). `rail: null` drops the key, for the case where the row
  // carries no rail at all.
  ...(rail === null ? {} : { purchaseRail: { rail, why: 'the fixture says so', forbids: ['play-billing', 'apple-iap'], forbidsWhy: 'the fixture says so', source: 'the fixture' } }),
});

const agiIconDecl = (over = {}) => ({ required: true, width: 512, height: 512, format: 'png', maxBytes: 204799, source: 'the form script', ...over });

const STEP3_IDS = [
  'developed-in-india',
  'personal-data',
  'ad-services',
  'financial-transactions',
  'suitable-for-children',
  'location',
  'camera',
  'contacts-call-logs',
  'microphone',
  'storage',
  'user-authentication',
];

/** A form-answers.json the guard accepts. `mutate(fa)` breaks one thing. */
const formAnswers = (mutate = null) => {
  const fa = {
    channel: AGI,
    step1: {
      appName: { from: 'title.txt' },
      minimumPlatform: { sdk: 24, label: 'Nougat 7.0' },
      stateUt: { answer: 'All State' },
      category: { from: 'category.txt' },
      developedBy: { from: 'developed-by.txt' },
      supportEmail: 'OWNER FILLS',
      supportPhone: 'OWNER FILLS',
      description: { from: 'long-description.txt' },
    },
    step2: {
      appIcon: { from: 'store-icon-512.png' },
      screenshots: { from: 'screenshots' },
      paymentGateway: { answer: 'No', why: 'derived from purchaseRail.rail "none": no build of this channel opens a checkout' },
    },
    step3: STEP3_IDS.map((id, i) => ({ q: i + 1, id, question: `question ${i + 1}`, answer: i === 1 ? 'Yes' : 'No', evidence: 'the file that shows it' })),
  };
  if (mutate) mutate(fa);
  return `${JSON.stringify(fa, null, 2)}\n`;
};

const FOUR_SHOTS = () => ({ '01-a.png': png(155, 290), '02-b.png': png(155, 290), '03-c.png': png(155, 290), '04-d.png': png(155, 290) });

/**
 * The base fixture plus an apps-gov-in row, its brick tree (icon omitted, as the
 * real brick omits it: post_gen writes it) and a complete apps-gov-in app tree.
 */
function agiTree({
  status = 'live',
  shots = FOUR_SHOTS(),
  icon = png(512, 512),
  category = 'Others\n',
  answers = formAnswers(),
  brickCategory = 'Others\n',
  brickAnswers = formAnswers(),
  iconDecl = agiIconDecl(),
  rail = 'none',
  listing = {},
} = {}) {
  const root = tree({
    apps: [{ slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status }],
    // form-answers.json is NOT in additionalFiles, as in the real register: a
    // .json there is a sworn declaration to assert-sworn-store-files.mjs.
    mutateRegister: (r) => {
      r.channels.push(agiRow(rail));
      r.storeMetadataContract.perChannel[AGI] = {
        additionalFiles: ['developed-by.txt', 'store-icon-512.png'],
        graphicAssets: { assets: { 'store-icon-512.png': iconDecl } },
      };
    },
    brickFields: { [`${AGI}/category.txt`]: brickCategory, [`${AGI}/developed-by.txt`]: 'Nikatru\n' },
    omitBrickFiles: [`${AGI}/store-icon-512.png`],
  });
  if (brickAnswers !== null) writeFileSync(join(root, 'tooling/bricks/app/__brick__/apps/{{app_id}}/store', AGI, 'form-answers.json'), brickAnswers);
  const dir = join(root, 'apps/subscriptiontracker/store', AGI);
  const put = (rel, body) => {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  for (const rel of REQUIRED) put(rel, rel === 'category.txt' ? category : (listing[rel] ?? FIELD[rel]));
  put('developed-by.txt', 'Nikatru\n');
  if (answers !== null) put('form-answers.json', answers);
  if (icon) put('store-icon-512.png', icon);
  for (const [name, body] of Object.entries(shots)) put(`screenshots/${name}`, body);
  return root;
}

describe("a store's own form rules — apps.gov.in", () => {
  test('a listing the portal accepts passes, and the form rules are counted', () => {
    const { code, out } = run(agiTree());
    assert.equal(code, 0, out);
    assert.match(out, /\d+ store form rule\(s\) checked against the store's own upload form/);
  });

  // ── the money answers and the age answer are DERIVED ([ADR 094] item 5) ────
  // The form asks whether the app takes money and names the gateway. Before
  // these, any string with a sentence beside it passed: a rail change in
  // tooling/channel-register.json left the form saying "No" and nothing went red.

  test('FAILS "No" on the payment gateway when the row declares a rail that sells', () => {
    const { code, out } = run(agiTree({ rail: 'razorpay' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step2\.paymentGateway\.answer is "No".*purchaseRail\.rail: "razorpay".*this channel now sells/s);
  });

  test('FAILS a gateway answer that names a rail other than the row’s', () => {
    const answers = formAnswers((fa) => (fa.step2.paymentGateway = { answer: 'Paddle', why: 'the web checkout' }));
    const { code, out } = run(agiTree({ rail: 'razorpay', answers, brickAnswers: answers }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /neither it nor its `why` names "razorpay"/);
  });

  test('a selling rail passes when the gateway is named and question 4 is Yes', () => {
    const answers = formAnswers((fa) => {
      fa.step2.paymentGateway = { answer: 'Razorpay', why: 'derived from purchaseRail.rail "razorpay"' };
      fa.step3[3].answer = 'Yes';
    });
    const { code, out } = run(agiTree({ rail: 'razorpay', answers, brickAnswers: answers }));
    assert.equal(code, 0, out);
  });

  test('FAILS "Yes" on financial transactions while the rail is none', () => {
    const answers = formAnswers((fa) => (fa.step3[3].answer = 'Yes'));
    const { code, out } = run(agiTree({ answers, brickAnswers: answers }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step3 "financial-transactions" answers "Yes".*purchaseRail\.rail: "none".*so the form's question 4 is "No"/s);
  });

  test('FAILS a form whose payment gateway answer is missing entirely', () => {
    const answers = formAnswers((fa) => delete fa.step2.paymentGateway);
    const { code, out } = run(agiTree({ answers, brickAnswers: answers }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step2\.paymentGateway\.answer is null/);
  });

  test('FAILS when the row carries no purchaseRail to derive the money answers from', () => {
    const { code, out } = run(agiTree({ rail: null }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares no `purchaseRail\.rail`.*two hand-written answers about money/s);
  });

  test('FAILS "Yes" to suitable-for-children — the age floor is 18', () => {
    const answers = formAnswers((fa) => (fa.step3[4].answer = 'Yes'));
    const { code, out } = run(agiTree({ answers, brickAnswers: answers }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step3 "suitable-for-children" answers "Yes"\. No Nikatru app targets children/);
  });

  // ── the listing text names no price and no lifetime plan ([ADR 093]) ───────

  test('FAILS a listing that names a rupee price', () => {
    const { code, out } = run(agiTree({ listing: { 'long-description.txt': 'Pro is ₹499 a year.\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /long-description\.txt names a price \("₹499"\)/);
  });

  test('FAILS a listing that names a dollar price', () => {
    const { code, out } = run(agiTree({ listing: { 'short-description.txt': 'Pro for $4.99 a month\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /short-description\.txt names a price \("\$4\.99"\)/);
  });

  test('FAILS a listing that names the lifetime plan', () => {
    const { code, out } = run(agiTree({ listing: { 'long-description.txt': 'A lifetime plan is available.\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /long-description\.txt names the lifetime plan/);
  });

  test('a listing that counts days and apps is not read as a price', () => {
    const { code, out } = run(agiTree({ listing: { 'long-description.txt': 'Reminds you 7 days ahead, across 3 devices. Version 1.0.101.\n' } }));
    assert.equal(code, 0, out);
  });

  test('a jpg screenshot is measured from its own start-of-frame header', () => {
    const shots = FOUR_SHOTS();
    delete shots['04-d.png'];
    shots['04-d.jpg'] = jpegHeader(155, 290);
    const { code, out } = run(agiTree({ shots }));
    assert.equal(code, 0, out);
  });

  test('FAILS a category that is not one of the form’s 23', () => {
    const { code, out } = run(agiTree({ category: 'Productivity\n' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps-gov-in\/category\.txt reads "Productivity", which is not one of the 23 categories/);
  });

  test('FAILS three screenshots — the form takes 4 to 8', () => {
    const shots = FOUR_SHOTS();
    delete shots['04-d.png'];
    const { code, out } = run(agiTree({ shots }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /holds 3 screenshot\(s\); the apps-gov-in form takes 4 to 8/);
  });

  test('FAILS nine screenshots — the form takes 4 to 8', () => {
    const shots = FOUR_SHOTS();
    for (const n of ['05-e', '06-f', '07-g', '08-h', '09-i']) shots[`${n}.png`] = png(155, 290);
    const { code, out } = run(agiTree({ shots }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /holds 9 screenshot\(s\); the apps-gov-in form takes 4 to 8/);
  });

  test('FAILS a screenshot one pixel off the exact 155x290', () => {
    const shots = FOUR_SHOTS();
    shots['02-b.png'] = png(156, 290);
    const { code, out } = run(agiTree({ shots }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /02-b\.png is 156x290; the apps-gov-in form refuses any screenshot that is not exactly 155x290/);
  });

  test('FAILS a screenshot over 1,048,576 bytes', () => {
    const shots = FOUR_SHOTS();
    shots['03-c.png'] = png(155, 290, 1048577);
    const { code, out } = run(agiTree({ shots }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /03-c\.png is 1048577 bytes; the apps-gov-in form takes at most 1048576 per screenshot/);
  });

  test('FAILS a screenshot in a format the form does not take', () => {
    const shots = FOUR_SHOTS();
    delete shots['04-d.png'];
    shots['04-d.webp'] = png(155, 290);
    const { code, out } = run(agiTree({ shots }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /04-d\.webp is not a png or jpg file/);
  });

  test('FAILS a screenshot whose header cannot be read', () => {
    const shots = FOUR_SHOTS();
    shots['01-a.png'] = Buffer.from('not an image at all, only text\n');
    const { code, out } = run(agiTree({ shots }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /01-a\.png has no readable PNG or JPEG header/);
  });

  test('FAILS zero screenshots on a LIVE app', () => {
    const { code, out } = run(agiTree({ shots: {} }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /holds no screenshots; the apps-gov-in form refuses an upload with fewer than 4\. App "subscriptiontracker" is live/);
  });

  test('PRINTS zero screenshots on a PREVIEW app, which is what a fresh stamp is', () => {
    const { code, out } = run(agiTree({ shots: {}, status: 'preview' }));
    assert.equal(code, 0, out);
    assert.match(out, /NO SCREENSHOTS YET/);
  });

  test('FAILS a missing store-icon-512.png', () => {
    const { code, out } = run(agiTree({ icon: null }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /store-icon-512\.png is missing; the apps-gov-in form requires an app icon/);
  });

  test('FAILS an icon that is not exactly 512x512', () => {
    const { code, out } = run(agiTree({ icon: png(500, 500) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /store-icon-512\.png is 500x500; the apps-gov-in form takes exactly 512x512/);
  });

  test('FAILS an icon of 204,800 bytes — the form takes one UNDER that', () => {
    const { code, out } = run(agiTree({ icon: png(512, 512, 204800) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /store-icon-512\.png is 204800 bytes; the apps-gov-in form takes an icon under 204800/);
  });

  test('FAILS a register icon declaration that disagrees with the form', () => {
    const { code, out } = run(agiTree({ iconDecl: agiIconDecl({ maxBytes: 204800 }) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /graphicAssets\.assets\["store-icon-512\.png"\] must declare 512x512 and maxBytes 204799/);
  });

  test('FAILS a missing form-answers.json on the app', () => {
    const { code, out } = run(agiTree({ answers: null }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps\/subscriptiontracker\/store\/apps-gov-in\/form-answers\.json is missing/);
  });

  test('BRICK: FAILS a missing stamped form-answers.json', () => {
    const { code, out } = run(agiTree({ brickAnswers: null }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /__brick__\/apps\/\{\{app_id\}\}\/store\/apps-gov-in\/form-answers\.json is missing/);
  });

  test('FAILS a form-answers.json that does not parse', () => {
    const { code, out } = run(agiTree({ answers: '{ "channel": "apps-gov-in", \n' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps\/subscriptiontracker\/store\/apps-gov-in\/form-answers\.json does not parse/);
  });

  test('FAILS form answers that name another channel', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.channel = 'android-play')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /says channel "android-play"; it sits in the "apps-gov-in" tree/);
  });

  test('FAILS a minimum platform whose label is not the form’s label for that SDK', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.step1.minimumPlatform.label = 'Nougat 7.1')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /says SDK 24 is "Nougat 7\.1"; the form lists SDK 24 as "Nougat 7\.0"/);
  });

  test('FAILS a minimum platform SDK the form does not list', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.step1.minimumPlatform = { sdk: 31, label: 'Android 12' })) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /minimumPlatform\.sdk is 31; the form's list names only SDK 21, 22/);
  });

  test('FAILS a missing state / union territory answer', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => delete fa.step1.stateUt) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step1\.stateUt\.answer is missing/);
  });

  test('FAILS a support phone written into the repo, and names the 12-character cap', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.step1.supportPhone = '+91 00000 00000')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step1\.supportPhone must read "OWNER FILLS".*It is also 15 characters, and the form takes at most 12/);
  });

  test('FAILS a support email written into the repo', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.step1.supportEmail = 'someone@example.com')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step1\.supportEmail must read "OWNER FILLS"/);
  });

  test('FAILS an answer filled from a listing file that does not exist', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.step1.developedBy.from = 'developer.txt')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step1\.developedBy is filled from "developer\.txt", and .*apps-gov-in\/developer\.txt does not exist/);
  });

  test('FAILS a step 3 with ten answers — the form asks eleven', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => fa.step3.pop()) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step3 holds 10 answer\(s\); the form's step 3 asks 11 questions/);
  });

  test('FAILS a step 3 out of the form’s order', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => ([fa.step3[0].q, fa.step3[1].q] = [2, 1])) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step3\[0\] is question 2; the list is in the form's order, 1 to 11/);
  });

  test('FAILS a step 3 id given twice', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.step3[2].id = fa.step3[1].id)) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step3\[2\] has a missing or repeated id "personal-data"/);
  });

  test('FAILS a step 3 answer that is not Yes or No', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.step3[6].answer = 'Maybe')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step3 "camera" answers "Maybe"; the form takes Yes or No/);
  });

  test('FAILS a step 3 answer with no evidence', () => {
    const { code, out } = run(agiTree({ answers: formAnswers((fa) => (fa.step3[9].evidence = '  ')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /step3 "storage" gives no evidence/);
  });

  test('BRICK: FAILS a category.txt that is not the listingCategory the renderer writes', () => {
    const { code, out } = run(agiTree({ brickCategory: 'Productivity\n' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /__brick__\/apps\/\{\{app_id\}\}\/store\/apps-gov-in\/category\.txt stamps "Productivity"; it must stamp exactly "Others"/);
  });

  test('BRICK: FAILS a category.txt that is a mustache variable', () => {
    const { code, out } = run(agiTree({ brickCategory: '{{category}}\n' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /category\.txt stamps "\{\{category\}\}"; it must stamp exactly "Others"/);
  });

  test('BRICK: FAILS a stamped form-answers.json that does not parse', () => {
    const { code, out } = run(agiTree({ brickAnswers: 'stamped\n' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /__brick__\/apps\/\{\{app_id\}\}\/store\/apps-gov-in\/form-answers\.json does not parse/);
  });

  test('BRICK: FAILS a stamped support phone', () => {
    const { code, out } = run(agiTree({ brickAnswers: formAnswers((fa) => (fa.step1.supportPhone = '0000000000')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /__brick__\/.*form-answers\.json step1\.supportPhone must read "OWNER FILLS"/);
  });

  test('BRICK: FAILS a stamped answer filled from a file the brick does not stamp', () => {
    const { code, out } = run(agiTree({ brickAnswers: formAnswers((fa) => (fa.step1.developedBy.from = 'developer.txt')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /__brick__\/.*form-answers\.json step1\.developedBy is filled from "developer\.txt"/);
  });

  test('BRICK: FAILS a stamped step 3 with a wrong answer count', () => {
    const { code, out } = run(agiTree({ brickAnswers: formAnswers((fa) => fa.step3.pop()) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /__brick__\/.*form-answers\.json step3 holds 10 answer\(s\)/);
  });

  test('BRICK: FAILS a stamped minimum platform label that is not the form’s', () => {
    const { code, out } = run(agiTree({ brickAnswers: formAnswers((fa) => (fa.step1.minimumPlatform.label = 'Nougat')) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /__brick__\/.*form-answers\.json step1\.minimumPlatform says SDK 24 is "Nougat"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REMINDER CLAIMS — O-RENEWAL-REMINDERS-OFF-ON-DESKTOP. A listing may promise a
// reminder only on a channel whose every platform can schedule one, read from
// tooling/capability-register.json's notifications platformMatrix.
//
// Proven on the REAL tree first (2026-09-25), each mutation restored after:
// windows-store long-description :7 restored → 1 (BASE guard 0); the same line
// in linux-snap → 1 (BASE 0); search term "renewal reminder" → 1 (BASE 0);
// "Reminders" in the brick's windows-store template → 1 (BASE 0);
// platformMatrix deleted → 2; linux.canSchedule flipped to true in the
// register → 0 here, and assert-adapter-capabilities limb 8 → 1.
// ─────────────────────────────────────────────────────────────────────────────
const onlyFails = (out) => out.split('\n').filter((l) => l.startsWith('FAIL '));

describe('assert-store-metadata — REMINDER CLAIMS follow canSchedule', () => {
  test('R1 · FAILS when the windows-store long-description promises a reminder at :7', () => {
    const { code, out } = run(tree({ fields: { 'long-description.txt': BASE_LEDE_WITH_CLAIM_AT_7 } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /REMINDER CLAIM — apps\/subscriptiontracker\/store\/windows-store\/long-description\.txt:7 reads "and reminds you before a free trial turns into a charge\."/);
    assert.match(out, /a listing may promise a reminder only on a channel whose every platform can schedule one/);
    assert.equal(onlyFails(out).length, 1, out);
  });

  // The case that separates canSchedule from canNotify: linux SHOWS a
  // notification, so a canNotify key passes this line.
  test('R2 · FAILS the same line on linux-snap, which can notify but cannot schedule', () => {
    const { code, out } = run(tree({ withLinux: true, linuxFields: { 'long-description.txt': BASE_LEDE_WITH_CLAIM_AT_7 } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /REMINDER CLAIM — apps\/subscriptiontracker\/store\/linux-snap\/long-description\.txt:7 reads "and reminds you/);
    assert.match(out, /Channel "linux-snap" runs on linux, where .* says canSchedule: false/);
    assert.equal(onlyFails(out).length, 1, out);
  });

  test('R3 · FAILS a reminder in the Windows search terms', () => {
    const { code, out } = run(tree({ fields: { 'search-terms.txt': 'subscription tracker\nrecurring payments\nrenewal reminder\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /REMINDER CLAIM — apps\/subscriptiontracker\/store\/windows-store\/search-terms\.txt:3 reads "renewal reminder"/);
    assert.equal(onlyFails(out).length, 1, out);
  });

  // The brick is scanned too, so a stamped app cannot inherit the promise.
  test('R4 · FAILS "Reminders" in the brick windows-store template', () => {
    const { code, out } = run(tree({ brickFields: { 'windows-store/long-description.txt': 'WHAT YOU GET\n- Reminders before a renewal.\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /REMINDER CLAIM — tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/store\/windows-store\/long-description\.txt:2 reads "- Reminders before a renewal\." \(matched "Remind"\)/);
    assert.equal(onlyFails(out).length, 1, out);
  });

  test('R5 · COVERAGE LOST when the notifications platformMatrix is deleted', () => {
    const { code, out } = run(tree({ mutateCapabilities: (c) => delete c.capabilities[0].capabilityMatrix.platformMatrix }));
    assert.equal(code, 2, `no matrix is not a pass and not a finding:\n${out}`);
    assert.match(out, /COVERAGE LOST — tooling\/capability-register\.json capability "notifications" capabilityMatrix\.platformMatrix is missing/);
  });

  test('COVERAGE LOST when a store row runs on a platform the matrix does not declare', () => {
    const { code, out } = run(tree({ mutateCapabilities: (c) => delete c.capabilities[0].capabilityMatrix.platformMatrix.windows }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — channel "windows-store" runs on platform "windows", and .* has no boolean "windows"\.canSchedule/);
  });

  // Every platform of an empty list "can schedule", so an empty list would let
  // the row promise anything.
  test('COVERAGE LOST when a store row declares no platforms', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => (r.channels.find((c) => c.id === 'windows-store').platforms = []) }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — channel "windows-store" declares no `platforms`/);
  });

  // A channel that CAN schedule keeps its reminder copy: the limb grades the
  // promise against the capability, it does not ban the word.
  test('a deliverable row (android-play) keeps its reminder claim and PASSES', () => {
    const { code, out } = run(tree({ withPlay: true, playFields: { 'long-description.txt': 'Reminders before a renewal or the end of a free trial.\n' } }));
    assert.equal(code, 0, out);
    assert.match(out, /ok {3}REMINDER CLAIMS — 2 store row\(s\), 1 not deliverable \(windows-store\), 2 tree\(s\), 14 file\(s\) scanned, 0 claims/);
  });

  // The backstop: trees that exist and yield no .txt mean the scan read nothing.
  test('COVERAGE LOST when the not-deliverable trees hold no .txt at all', () => {
    const { code, out } = run(tree({
      mutateRegister: (r) => {
        r.storeMetadataContract.requiredFiles = ['README.md', 'screenshots/README.md'];
        r.storeMetadataContract.derivedFields = { _why: 'none in this fixture' };
        r.storeMetadataContract.perChannel = {};
      },
      omitFiles: ['title.txt', 'short-description.txt', 'long-description.txt', 'category.txt', 'privacy-policy-url.txt', 'support-url.txt', 'search-terms.txt'],
    }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — 1 channel\(s\) cannot schedule a reminder \(windows-store\), and their 2 tree\(s\) yielded ZERO \.txt files/);
  });
});
