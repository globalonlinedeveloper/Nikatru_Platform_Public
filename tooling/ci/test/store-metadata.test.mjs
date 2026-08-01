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
// `msix_config:` block from apps/subly/pubspec.yaml exited 0, because the guard
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
  'screenshots/README.md': 'slot; dimensions UNVERIFIED\n',
  'search-terms.txt': 'a\nb\nc\n',
};

const storeRow = (over = {}) => ({
  id: 'windows-store',
  name: 'Microsoft Store',
  platforms: ['windows'],
  kind: 'store',
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
  served: false,
  submittable: true,
  artifactFormats: ['.aab'],
  storeMetadataDir: 'apps/{app}/store/android-play',
  ownerQueue: 'A-3',
  ...over,
});

const contract = () => ({
  requiredFiles: [...REQUIRED],
  urlFiles: ['privacy-policy-url.txt', 'support-url.txt'],
  derivedFields: {
    _why: 'generated from the spec, checked rather than asserted',
    'title.txt': { source: 'apps.json', field: 'name' },
    'short-description.txt': { source: 'apps.json', field: 'tagline' },
    'privacy-policy-url.txt': { source: 'appConfig', field: 'privacyUrl' },
    'support-url.txt': { source: 'appConfig', field: 'contactUrl' },
  },
  appConfigPath: 'apps/{app}/lib/core/config/app_config.dart',
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

const pubspec = (over = {}) => {
  const cfg = {
    display_name: 'Subly',
    publisher_display_name: SENTINEL,
    identity_name: SENTINEL,
    publisher: `CN=${SENTINEL}`,
    store: 'true',
    ...over,
  };
  return ['name: subly', 'version: 1.0.0+1', '', 'msix_config:', ...Object.entries(cfg).map(([k, v]) => `  ${k}: ${v}`), ''].join('\n');
};

const appConfig = () =>
  [
    'class AppConfig {',
    "  static const String privacyUrl = 'https://nikatru.com/privacy.html';",
    "  static const String contactUrl = 'https://nikatru.com/contact.html';",
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
  apps = [{ slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] }],
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    storeMetadataContract: contract(),
    channels: [
      { id: 'web', name: 'Web', platforms: ['web'], kind: 'web', served: true, submittable: false, artifactFormats: ['static-bundle'], storeMetadataDir: null },
      storeRow(),
    ],
  };
  if (withPlay) register.channels.push(playRow());
  if (mutateRegister) mutateRegister(register);

  write('sites/_shared/_data/apps.json', JSON.stringify(apps, null, 2));
  if (!omitRegister) write('tooling/channel-register.json', JSON.stringify(register, null, 2));

  for (const app of apps) {
    write(`apps/${app.slug}/lib/core/config/app_config.dart`, appConfig());
    if (!omitPubspec) {
      write(`apps/${app.slug}/pubspec.yaml`, noMsixConfig ? 'name: subly\nversion: 1.0.0+1\n' : pubspec(pubspecOver));
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
    assert.equal(code, 1, out);
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
  test('PRINTS, and does not fail, when a DEFERRED store row has no tree', () => {
    const { code, out } = run(
      tree({
        mutateRegister: (r) => r.channels.push(storeRow({ id: 'linux-snap', platforms: ['linux'], storeMetadataDir: 'apps/{app}/store/linux-snap', ownerQueue: 'A-6', packageIdentity: undefined })),
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /NO TREE \(deferred\): apps\/subly\/store\/linux-snap/);
    assert.match(out, /= 2 expected tree\(s\)/);
  });

  test('FAILS when a SERVED store row has no tree', () => {
    const { code, out } = run(
      tree({
        mutateRegister: (r) => r.channels.push(storeRow({ id: 'linux-snap', served: true, platforms: ['linux'], storeMetadataDir: 'apps/{app}/store/linux-snap', ownerQueue: 'A-6', packageIdentity: undefined })),
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /is SERVED and app "subly" carries no metadata tree/);
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
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*requiredFiles is missing or empty/);
  });

  test('COVERAGE LOST when storeMetadataContract is deleted outright', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => delete r.storeMetadataContract }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*declares no `storeMetadataContract`/);
  });

  test('COVERAGE LOST when no row is kind:"store" any more', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => r.channels.forEach((c) => (c.kind = 'direct')) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*ZERO `kind: "store"` channels/);
  });

  test('COVERAGE LOST when the register is absent', () => {
    const { code, out } = run(tree({ omitRegister: true }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — tooling\/channel-register\.json does not exist/);
  });

  test('COVERAGE LOST when apps.json carries no apps', () => {
    const { code, out } = run(tree({ apps: [] }));
    assert.equal(code, 1, out);
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
    assert.match(out, /declares no `msix_config:` block while app "subly" carries channel/);
  });

  // The other side of that asymmetry: an app that never had either is the
  // stamped-app case D-5 still owes brick work for, and prints.
  test('PRINTS for a stamped app with no tree and no msix_config, while the real app stays checked', () => {
    const root = tree({
      apps: [
        { slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] },
      ],
    });
    // Add a second app with a pubspec but no msix_config and no store tree.
    mkdirSync(join(root, 'apps', 'probe'), { recursive: true });
    writeFileSync(join(root, 'apps', 'probe', 'pubspec.yaml'), 'name: probe\nversion: 1.0.0+1\n');
    writeFileSync(
      join(root, 'sites', '_shared', '_data', 'apps.json'),
      JSON.stringify([
        { slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] },
        { slug: 'probe', name: 'Probe', tagline: 'A probe', platforms: ['web'] },
      ]),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /NO msix_config: apps\/probe\/pubspec\.yaml/);
    assert.match(out, /NO TREE \(deferred\): apps\/probe\/store\/windows-store/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `maxChars` — the SECOND limit kind, added with the Apple channels.
//
// `maxLines` counts entries (MS Store search terms); `maxChars` counts characters
// of the trimmed field, which is the shape Apple's App Name and Subtitle take.
// Those two are the ONLY Apple listing limits this repo has a primary source for
// — the keywords field, description and promotional text are all recorded as
// COULD-NOT-ESTABLISH in company/pipeline/10-distribution-store.md D-5 and carry
// no number anywhere.
//
// 🔴 THE THREE CASES THAT MATTER ARE THE LAST THREE. An invented limit fires on
// CORRECT input, so: exactly-at-the-limit must PASS, an undeclared field must be
// unconstrained at any length, and a limit whose citation was deleted must FAIL
// LOUDLY rather than be silently skipped — a skipped limit leaves the register
// claiming a constraint that does nothing.
// ─────────────────────────────────────────────────────────────────────────────
const APPLE_SOURCE = 'developer.apple.com/help/app-store-connect/reference/app-information/ — fetched 2026-07-29';

/** A minimal Apple-shaped fixture: one store row, maxChars, no packageIdentity. */
function appleTree({ mutateRegister = null, fields = {} } = {}) {
  const root = join(TMP, `a${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    storeMetadataContract: {
      requiredFiles: [...REQUIRED],
      urlFiles: ['privacy-policy-url.txt', 'support-url.txt'],
      derivedFields: {
        _why: 'generated from the spec',
        'short-description.txt': { source: 'apps.json', field: 'tagline' },
        'privacy-policy-url.txt': { source: 'appConfig', field: 'privacyUrl' },
        'support-url.txt': { source: 'appConfig', field: 'contactUrl' },
      },
      appConfigPath: 'apps/{app}/lib/core/config/app_config.dart',
      perChannel: {
        'ios-appstore': {
          additionalFiles: ['subtitle.txt', 'keywords.txt'],
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
        served: false,
        submittable: true,
        artifactFormats: ['.ipa'],
        storeMetadataDir: 'apps/{app}/store/ios-appstore',
        ownerQueue: 'A-4',
      },
    ],
  };
  if (mutateRegister) mutateRegister(register);

  const apps = [{ slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] }];
  write('sites/_shared/_data/apps.json', JSON.stringify(apps, null, 2));
  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('apps/subly/lib/core/config/app_config.dart', appConfig());
  write('apps/subly/pubspec.yaml', 'name: subly\nversion: 1.0.0+1\n');

  const body = { ...FIELD, 'subtitle.txt': 'Every subscription, one list\n', 'keywords.txt': 'subscription,tracker\n' };
  for (const rel of [...REQUIRED, 'subtitle.txt', 'keywords.txt']) {
    write(`apps/subly/store/ios-appstore/${rel}`, fields[rel] ?? body[rel]);
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
    rmSync(join(root, 'apps/subly/store/ios-appstore/subtitle.txt'), { force: true });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subtitle\.txt is missing/);
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
  test('PRINTS, and does not fail, when the deferred row has NO tree at all', () => {
    const { code, out } = run(tree({ withPlay: true, omitPlayTree: true }));
    assert.equal(code, 0, out);
    assert.match(out, /NO TREE \(deferred\): apps\/subly\/store\/android-play/);
    assert.match(out, /OWNER_QUEUE A-3/);
  });

  test('FAILS when a file is deleted from the android-play tree that EXISTS', () => {
    const { code, out } = run(tree({ withPlay: true, omitPlayFiles: ['title.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps\/subly\/store\/android-play\/title\.txt is missing/);
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
        apps: [{ slug: 'subly', name, tagline: 'Track every subscription in one place', platforms: ['web'] }],
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
        apps: [{ slug: 'subly', name: 'Subly', tagline, platforms: ['web'] }],
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
        apps: [{ slug: 'subly', name, tagline: 'Track every subscription in one place', platforms: ['web'] }],
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
        apps: [{ slug: 'subly', name, tagline: 'Track every subscription in one place', platforms: ['web'] }],
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
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE was evaluated/);
  });

  test('the summary line reports how many limits were actually measured', () => {
    const { code, out } = run(tree({ withPlay: true }));
    assert.equal(code, 0, out);
    assert.match(out, /4 measured against a SOURCED store limit/);
  });
});
