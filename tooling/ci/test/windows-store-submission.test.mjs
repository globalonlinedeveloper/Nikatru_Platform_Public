// ─────────────────────────────────────────────────────────────────────────────
// windows-store-submission.test.mjs — tooling/release/submit-windows-store.mjs
// must be able to FAIL, and --submit must refuse.
//
// [pipeline D-10] limb (i): "a submission script exists AND resolves to a step
// in a workflow". A script that exists and has stopped working satisfies the
// letter of that limb and none of its point, which is why the dry run is wired
// into ci.yml on every push as well as into the dispatch workflow — and why it
// has these tests.
//
// 🔴 THE MOST IMPORTANT CASE IN THIS FILE IS THE ONE THAT ASSERTS A REFUSAL.
// `--submit` prints `UNVERIFIED:` for every Partner Center API fact that was not
// fetched from a primary source, and exits 1 BEFORE running any check. A guessed
// endpoint does not fail on a laptop; it fails against a live store account,
// mid-submission. If somebody later implements `--submit`, this test failing is
// the correct signal — it means the refusal is gone and the UNVERIFIED list must
// have been replaced by sourced facts, not deleted.
//
// The real end-to-end proof is recorded and is not in this file: on 2026-08-01
// the dry run validated a REAL 14.8 MiB subly.msix produced by
// `flutter build windows --release` + `dart run msix:create`. Fixtures cannot
// prove that; only running it could.
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

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'release', 'submit-windows-store.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-mssubmit-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const SENTINEL = 'PARTNER-CENTER-PENDING';

const FILES = {
  'README.md': 'derivation map\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'A longer description.\n',
  'category.txt': 'Productivity\n',
  'privacy-policy-url.txt': 'https://nikatru.com/privacy.html\n',
  'support-url.txt': 'https://nikatru.com/contact.html\n',
  'screenshots/README.md': 'slot\n',
  'search-terms.txt': 'a\nb\n',
};

function tree({
  mutateRegister = null,
  fields = {},
  omitFiles = [],
  withArtifact = false,
  artifactBytes = 1024,
  pubspecOver = {},
  noMsixConfig = false,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    storeMetadataContract: {
      requiredFiles: ['README.md', 'title.txt', 'short-description.txt', 'long-description.txt', 'category.txt', 'privacy-policy-url.txt', 'support-url.txt', 'screenshots/README.md'],
      urlFiles: ['privacy-policy-url.txt', 'support-url.txt'],
      perChannel: { 'windows-store': { additionalFiles: ['search-terms.txt'], maxLines: { 'search-terms.txt': { max: 7, source: 'MS Store Policies v7.19 §10.1.3' } } } },
    },
    channels: [
      {
        id: 'windows-store',
        kind: 'store',
        served: false,
        submittable: true,
        platforms: ['windows'],
        artifactFormats: ['.msix'],
        storeMetadataDir: 'apps/{app}/store/windows-store',
        ownerQueue: 'A-2',
        packageIdentity: {
          notYetConfiguredSentinel: SENTINEL,
          identityName: SENTINEL,
          publisherDisplayName: SENTINEL,
          publisher: `CN=${SENTINEL}`,
        },
        submission: { runbook: 'company/runbooks/store-submission-windows.md' },
      },
    ],
  };
  if (mutateRegister) mutateRegister(register);

  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' }]));

  const cfg = {
    display_name: 'Subly',
    publisher_display_name: SENTINEL,
    identity_name: SENTINEL,
    publisher: `CN=${SENTINEL}`,
    store: 'true',
    build_windows: 'false',
    output_path: 'build/windows/msix',
    output_name: 'subly',
    ...pubspecOver,
  };
  write(
    'apps/subly/pubspec.yaml',
    noMsixConfig ? 'name: subly\n' : ['name: subly', '', 'msix_config:', ...Object.entries(cfg).map(([k, v]) => `  ${k}: ${v}`), ''].join('\n'),
  );

  for (const [rel, body] of Object.entries(FILES)) {
    if (omitFiles.includes(rel)) continue;
    write(`apps/subly/store/windows-store/${rel}`, fields[rel] ?? body);
  }
  if (withArtifact) write('apps/subly/build/windows/msix/subly.msix', 'x'.repeat(artifactBytes));
  return root;
}

function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], {
    encoding: 'utf8',
    env: { ...process.env, MS_STORE_TENANT_ID: '', MS_STORE_CLIENT_ID: '', MS_STORE_CLIENT_SECRET: '', MS_STORE_PRODUCT_ID: '', ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('submit-windows-store — the submission path is walkable, and --submit refuses', () => {
  test('--dry-run PASSES over a complete tree and a real artifact, and sends nothing', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run', '--app', 'subly']);
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN OK — nothing was sent to Microsoft/);
    assert.match(out, /artifact apps\/subly\/build\/windows\/msix\/subly\.msix/);
  });

  // 🔴 the refusal, and it must be BEFORE any validation
  test('--submit REFUSES with UNVERIFIED, before running a single check', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--submit', '--app', 'subly']);
    assert.equal(code, 1, out);
    assert.match(out, /--submit is NOT IMPLEMENTED, and refusing is the implementation/);
    assert.match(out, /UNVERIFIED: the Microsoft Store submission API base URL/);
    assert.match(out, /Nothing was validated/);
    // Nothing was validated means nothing was printed about the tree either.
    assert.doesNotMatch(out, /metadata tree .* field\(s\) present/);
  });

  test('FAILS when neither --dry-run nor --submit is given', () => {
    const { code, out } = run(tree(), []);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when both --dry-run and --submit are given', () => {
    const { code, out } = run(tree(), ['--dry-run', '--submit']);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when a listing field is missing', () => {
    const { code, out } = run(tree({ withArtifact: true, omitFiles: ['title.txt'] }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /title\.txt is missing/);
  });

  test('FAILS when a listing field is emptied', () => {
    const { code, out } = run(tree({ withArtifact: true, fields: { 'category.txt': '  \n' } }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /category\.txt is EMPTY/);
  });

  test('FAILS on more than 7 search terms, citing the policy', () => {
    const { code, out } = run(tree({ withArtifact: true, fields: { 'search-terms.txt': 'a\nb\nc\nd\ne\nf\ng\nh\n' } }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /has 8 entries; the limit is 7/);
    assert.match(out, /10\.1\.3/);
  });

  test('FAILS when the .msix is absent and --allow-missing-artifact was NOT passed', () => {
    const { code, out } = run(tree(), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /subly\.msix does not exist/);
  });

  test('PASSES with --allow-missing-artifact, and SAYS the package was not validated', () => {
    const { code, out } = run(tree(), ['--dry-run', '--allow-missing-artifact']);
    assert.equal(code, 0, out);
    assert.match(out, /NO PACKAGED ARTIFACT/);
    assert.match(out, /the package was not/);
  });

  test('FAILS on a zero-byte .msix', () => {
    const { code, out } = run(tree({ withArtifact: true, artifactBytes: 0 }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /ZERO bytes/);
  });

  test('FAILS when the register and the pubspec disagree about the package identity', () => {
    const { code, out } = run(tree({ withArtifact: true, pubspecOver: { identity_name: 'Nikatru.Subly' } }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /package identity DISAGREES/);
  });

  test('FAILS when msix_config.store is not true — the Store re-signs, we hold no key', () => {
    const { code, out } = run(tree({ withArtifact: true, pubspecOver: { store: 'false' } }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /msix_config\.store is "false", not true/);
  });

  test('FAILS when the pubspec has no msix_config block at all', () => {
    const { code, out } = run(tree({ withArtifact: true, noMsixConfig: true }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /declares no `msix_config:` block/);
  });

  test('PRINTS the identity gap while every field is the sentinel, and still exits 0', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /PACKAGE IDENTITY NOT YET CONFIGURED/);
  });

  test('PRINTS which credentials are absent and never their values', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /CREDENTIALS NOT CONFIGURED — 4 of 4 absent/);
  });

  test('reports credentials as present without printing them', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run'], {
      MS_STORE_TENANT_ID: 'tenant-secret-value',
      MS_STORE_CLIENT_ID: 'client-secret-value',
      MS_STORE_CLIENT_SECRET: 'the-actual-secret',
      MS_STORE_PRODUCT_ID: 'product-secret-value',
    });
    assert.equal(code, 0, out);
    assert.match(out, /credentials — all 4 environment variable\(s\) present/);
    assert.doesNotMatch(out, /the-actual-secret/);
  });

  test('COVERAGE LOST when storeMetadataContract.requiredFiles is emptied', () => {
    const { code, out } = run(tree({ withArtifact: true, mutateRegister: (r) => (r.storeMetadataContract.requiredFiles = []) }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register declares no windows-store row', () => {
    const { code, out } = run(tree({ withArtifact: true, mutateRegister: (r) => (r.channels = []) }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*declares no "windows-store" channel/);
  });

  test('FAILS when the channel stops being submittable', () => {
    const { code, out } = run(tree({ withArtifact: true, mutateRegister: (r) => (r.channels[0].submittable = false) }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /is not marked `submittable`/);
  });

  test('FAILS when the packaging output format is not one the channel accepts', () => {
    const { code, out } = run(tree({ withArtifact: true, mutateRegister: (r) => (r.channels[0].artifactFormats = ['.appx']) }), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /matches none of the formats channel "windows-store" accepts/);
  });
});
