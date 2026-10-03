// ─────────────────────────────────────────────────────────────────────────────
// appstore-submission.test.mjs — tooling/release/submit-appstore.mjs must be
// able to FAIL, and --submit must refuse.
//
// [pipeline D-10] limb (i): "a submission script exists AND resolves to a step
// in a workflow". A script that exists and has stopped working satisfies the
// letter of that limb and none of its point — which is why the dry run is wired
// into ci.yml on every push as well as into submit-appstore.yml, and why it has
// these tests.
//
// ⚠️ THESE FIXTURES ARE THE SECOND LINE OF EVIDENCE, NOT THE FIRST. CLAUDE.md:
// "A fixture passing is not a guard working — MUTATE THE REAL TREE." The script
// was mutation-proven FIRST against a scratch COPY of the real repository
// (2026-08-01, 20 mutations across this script, submit-snap.mjs and
// assert-store-metadata.mjs): 19 caught, 1 printed by design, restore verified
// green before and after every case, and no case "caught" by a crash. That run
// corrected a bad MUTATION rather than a bad check — renaming a channel's `id`
// without renaming its `storeMetadataDir` orphans nothing, so the first version
// of the orphan case proved only that the harness was wrong.
//
// 🔴 THE MOST IMPORTANT CASE IN THIS FILE USED TO ASSERT A REFUSAL: `--submit`
// printed `UNVERIFIED:` for every App Store Connect API fact not fetched from a
// primary source. ⏱ 2026-10-03 (release lane apple-ready) the upload's facts were
// sourced (the Build Uploads resource, API 4.1, read that day; the JWT measured
// live), and the refusal became the gates: every case below that refuses does so
// BEFORE any check, and the upload is driven against a LOOPBACK server only.
//
// 🔴 NO APPLE BUILD IS EXERCISED HERE OR ANYWHERE LOCALLY. There is no Apple
// hardware on the development machine and no distribution certificate exists
// (no distribution certificate has been issued into the ACTIVE account, verified
// 2026-09-08), so unlike the Microsoft path — which validated a real
// 14.8 MiB .msix — there is NO recorded end-to-end proof over a real .ipa or
// .pkg, and there cannot be one until A-4 completes. Everything below is a
// fixture, and the artifact cases use a stand-in file of the right NAME, which
// proves the path handling and nothing about Apple packaging.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ascApiBase, uploadUrlProblem, uploadBuild } from '../../release/submit-appstore.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'release', 'submit-appstore.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-applesubmit-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const BUNDLE = 'com.nikatru.subscriptiontracker';
const APPLE_SOURCE = 'developer.apple.com/help/app-store-connect/reference/app-information/ — fetched 2026-07-29';

const FILES = {
  'README.md': 'derivation map\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'A longer description.\n',
  'category.txt': 'Productivity\n',
  'privacy-policy-url.txt': 'https://nikatru.com/privacy.html\n',
  'support-url.txt': 'https://nikatru.com/contact.html\n',
  'screenshots/README.md': 'slot\n',
  'subtitle.txt': 'Every subscription, one list\n',
  'keywords.txt': 'subscription,tracker\n',
  'promotional-text.txt': 'Know what renews.\n',
};

const ARTIFACT = {
  'ios-appstore': 'apps/subscriptiontracker/build/ios/ipa/subscriptiontracker.ipa',
  'macos-appstore': 'apps/subscriptiontracker/build/macos/pkg/subscriptiontracker.pkg',
};

const appleRow = (id, over = {}) => ({
  id,
  kind: 'store',
  served: false,
  submittable: true,
  platforms: [id === 'ios-appstore' ? 'ios' : 'macos'],
  artifactFormats: [id === 'ios-appstore' ? '.ipa' : '.pkg'],
  storeMetadataDir: `apps/{app}/store/${id}`,
  ownerQueue: 'A-4',
  // ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b): the row names WHERE Xcode declares the bundle id;
  // the value is tooling/apple-provisioning.json's (bundleIdOf) and the row no longer carries one.
  identity: {
    kind: 'apple-bundle-id',
    declaredIn: id === 'ios-appstore' ? 'apps/{app}/ios/Runner.xcodeproj/project.pbxproj' : 'apps/{app}/macos/Runner/Configs/AppInfo.xcconfig',
  },
  submission: { runbook: 'Private/runbooks/store-submission-apple.md' },
  // The Small Business Program gate --submit runs selects its channels by this rail.
  purchaseRail: { rail: 'apple-iap' },
  signing: { seam: { artifactGlob: id === 'ios-appstore' ? 'apps/*/build/ios/ipa/*.ipa' : 'apps/*/build/macos/pkg/*.pkg' } },
  ...over,
});

/** The App Store Connect record ids these fixtures issue. Fixture values, never app #1's real one. */
const RECORD_ID = '1234567890';
const ISSUED = { 'ios-appstore': { state: 'issued', recordId: RECORD_ID }, 'macos-appstore': { state: 'issued', recordId: RECORD_ID } };

/** apps/<id>/app.yaml carrying only the `stores` records (the reader reads nothing else). */
const storesYaml = (records) =>
  ['stores:', ...Object.entries(records).flatMap(([id, r]) => [
    `  ${id}:`,
    `    state: ${r.state}`,
    `    declaredOn: ${r.declaredOn ?? 'null'}`,
    ...(r.recordId === undefined ? [] : [`    recordId: "${r.recordId}"`]),
  ]), ''].join('\n');

const perChannelLimits = () => ({
  additionalFiles: ['subtitle.txt', 'keywords.txt', 'promotional-text.txt'],
  maxChars: {
    'title.txt': { max: 30, min: 2, source: APPLE_SOURCE },
    'subtitle.txt': { max: 30, source: APPLE_SOURCE },
  },
});

/** Build a fixture repo. Everything is valid unless a knob says otherwise. */
function tree({
  mutateRegister = null,
  fields = {},
  omitFiles = [],
  omitTree = false,
  withArtifact = false,
  artifactBytes = 1024,
  iosBundle = BUNDLE,
  macosBundle = BUNDLE,
  omitProject = false,
  extraPbxproj = '',
  apps = [{ slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' }],
  mutateApple = null,
  omitApple = false,
  records = ISSUED,
  omitAppYaml = false,
  enrolment = null,
  omitFees = false,
  workflow = (y) => y,
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
      perChannel: { 'ios-appstore': perChannelLimits(), 'macos-appstore': perChannelLimits() },
    },
    channels: [appleRow('ios-appstore'), appleRow('macos-appstore')],
  };
  if (mutateRegister) mutateRegister(register);

  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('catalog/apps.json', JSON.stringify(apps));
  // ⏱ 2026-10-03: --submit PG-4 reads the upload job's shape out of the REAL workflow, copied (and mutated) here.
  write('.github/workflows/submit-appstore.yml', workflow(readFileSync(join(REPO, '.github', 'workflows', 'submit-appstore.yml'), 'utf8')));
  // ⏱ 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP): the app's signing bundle id comes from the
  // REAL tooling/apple-provisioning.json, read at run time and never copied into this file (it names
  // App Store Connect resource ids, which no .mjs under tooling/ci may spell).
  if (!omitApple) {
    const apple = JSON.parse(readFileSync(join(REPO, 'tooling', 'apple-provisioning.json'), 'utf8'));
    if (mutateApple) mutateApple(apple);
    write('tooling/apple-provisioning.json', JSON.stringify(apple, null, 2));
  }

  if (!omitAppYaml) write('apps/subscriptiontracker/app.yaml', storesYaml(records));
  // The one cell the Small Business Program gate reads; `enrolment` is its value (the approval date, or null).
  if (!omitFees) {
    write(
      'tooling/catalog/fee-register.json',
      JSON.stringify({ cells: { 'apple-small-business-enrolment': { value: enrolment, asOf: '2026-09-29', verify: 'the owner reads App Store Connect' } } }),
    );
  }

  if (!omitProject) {
    // The iOS shape: a pbxproj carrying the app bundle AND the test bundles, so
    // the "drop the test bundles" logic is exercised rather than assumed.
    write(
      'apps/subscriptiontracker/ios/Runner.xcodeproj/project.pbxproj',
      [
        '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ' + iosBundle + ';',
        '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ' + iosBundle + '.RunnerTests;',
        extraPbxproj,
        '',
      ].join('\n'),
    );
    // The macOS shape: an xcconfig. Its pbxproj carries ONLY the test bundle,
    // which is why the register names the xcconfig — a reader that guessed would
    // compare against the test bundle and agree with itself.
    write('apps/subscriptiontracker/macos/Runner/Configs/AppInfo.xcconfig', `PRODUCT_NAME = subscriptiontracker\nPRODUCT_BUNDLE_IDENTIFIER = ${macosBundle}\n`);
    write('apps/subscriptiontracker/macos/Runner.xcodeproj/project.pbxproj', `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${macosBundle}.RunnerTests;\n`);
  }

  if (!omitTree) {
    for (const channelId of ['ios-appstore', 'macos-appstore']) {
      for (const [rel, body] of Object.entries(FILES)) {
        if (omitFiles.includes(rel)) continue;
        write(`apps/subscriptiontracker/store/${channelId}/${rel}`, fields[rel] ?? body);
      }
    }
  }
  if (withArtifact) {
    for (const rel of Object.values(ARTIFACT)) write(rel, 'x'.repeat(artifactBytes));
  }
  return root;
}

function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_STORE_CONNECT_ISSUER_ID: '',
      APP_STORE_CONNECT_KEY_ID: '',
      APP_STORE_CONNECT_PRIVATE_KEY: '',
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const ios = (root, extra = []) => run(root, ['--dry-run', '--channel', 'ios-appstore', '--app', 'subscriptiontracker', ...extra]);
const macos = (root, extra = []) => run(root, ['--dry-run', '--channel', 'macos-appstore', '--app', 'subscriptiontracker', ...extra]);

// ── --submit: the arguments, the lane, and a loopback App Store Connect ───────
const WORDS = { 'ios-appstore': 'UPLOAD-IOS-TO-TESTFLIGHT', 'macos-appstore': 'UPLOAD-MACOS-TO-TESTFLIGHT' };
const submitArgs = (channel, { shortVersion = '1.0.7', bundleVersion = '7' } = {}) => [
  '--submit', '--channel', channel, '--app', 'subscriptiontracker', '--confirm', WORDS[channel],
  '--bundle-short-version', shortVersion, '--bundle-version', bundleVersion,
];
/** Inside "GitHub Actions", with the GitHub API answered by `base` (a loopback server). */
const ghEnv = (base) => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'gh-test-token', GH_TOKEN: '', GITHUB_API_URL: base });
/** A throwaway P-256 key: the JWT is really signed, by a key that signs nothing anywhere else. */
const TEST_KEY = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const ascEnv = (base) => ({
  APP_STORE_CONNECT_ISSUER_ID: 'issuer-test',
  APP_STORE_CONNECT_KEY_ID: 'KEYTEST123',
  APP_STORE_CONNECT_PRIVATE_KEY: TEST_KEY,
  APP_STORE_CONNECT_API_BASE_URL: base,
  APPLE_RELEASE_TARGET: 'testflight',
  SUBMIT_APPSTORE_POLL_MS: '10',
  SUBMIT_APPSTORE_CEILING_MS: '5000',
});

/** The script, spawned WITHOUT blocking this process, so a server in it can answer. */
function runAsync(root, args, env = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT, ...args, '--repo-root', root], {
      env: { ...process.env, APP_STORE_CONNECT_ISSUER_ID: '', APP_STORE_CONNECT_KEY_ID: '', APP_STORE_CONNECT_PRIVATE_KEY: '', ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
}

/** One loopback server answering BOTH the GitHub environment read and the Build Uploads protocol. */
async function ascServer({ reviewers = [{ type: 'User', reviewer: { login: 'owner' } }], finalState = 'COMPLETE', partHost = null } = {}) {
  const seen = [];
  let polls = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      let body = null;
      try {
        body = raw.length ? JSON.parse(raw.toString('utf8')) : null;
      } catch {
        body = null;
      }
      const path = req.url.split('?')[0];
      seen.push({ method: req.method, path, headers: req.headers, body, size: raw.length });
      const send = (status, json) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(json === undefined ? '' : JSON.stringify(json));
      };
      if (req.method === 'GET' && path === '/repos/o/r/environments/store-publish') {
        return send(200, { name: 'store-publish', protection_rules: reviewers.length ? [{ type: 'required_reviewers', reviewers }] : [], can_admins_bypass: true });
      }
      if (req.method === 'POST' && path === '/v1/buildUploads') return send(201, { data: { type: 'buildUploads', id: 'BU1' } });
      if (req.method === 'POST' && path === '/v1/buildUploadFiles') {
        const host = partHost ?? base;
        return send(201, {
          data: {
            type: 'buildUploadFiles',
            id: 'BF1',
            attributes: {
              uploadOperations: [
                { method: 'PUT', url: `${host}/part/1`, offset: 0, length: 512, requestHeaders: [{ name: 'x-part', value: 'one' }] },
                { method: 'PUT', url: `${host}/part/2`, offset: 512, length: 512, requestHeaders: [{ name: 'x-part', value: 'two' }] },
              ],
            },
          },
        });
      }
      if (req.method === 'PUT' && path.startsWith('/part/')) return send(200, {});
      if (req.method === 'PATCH' && path === '/v1/buildUploadFiles/BF1') return send(200, { data: { type: 'buildUploadFiles', id: 'BF1', attributes: { uploaded: true } } });
      if (req.method === 'GET' && path === '/v1/buildUploads/BU1') {
        polls++;
        const state = polls < 2 ? 'PROCESSING' : finalState;
        const errors = state === 'FAILED' ? [{ code: 'ITMS-90000', description: 'bad binary' }] : [];
        return send(200, { data: { type: 'buildUploads', id: 'BU1', attributes: { state: { state, errors, warnings: [], infos: [] } } } });
      }
      return send(404, { errors: [{ code: 'NOT_FOUND', detail: `${req.method} ${path}` }] });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, close: () => server.close() };
}

/** A crash is not a catch. */
const assertComplained = (out) => {
  assert.doesNotMatch(out, /TypeError|ReferenceError|node:internal/, out);
  assert.match(out, /^FAIL /m, out);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('submit-appstore — both Apple channels are walkable, and --submit uploads only behind every gate', () => {
  test('--dry-run PASSES for iOS over a complete tree and an artifact, and sends nothing', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN OK — nothing was sent to Apple/);
    assert.match(out, /artifact apps\/subscriptiontracker\/build\/ios\/ipa\/subscriptiontracker\.ipa/);
    assert.match(out, /bundle identifier com\.nikatru\.subscriptiontracker/);
  });

  test('--dry-run PASSES for macOS, reading the xcconfig and not the pbxproj', () => {
    const { code, out } = macos(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /artifact apps\/subscriptiontracker\/build\/macos\/pkg\/subscriptiontracker\.pkg/);
    assert.match(out, /AppInfo\.xcconfig agree/);
  });

  // ⏱ 2026-10-03 (release lane apple-ready): --submit no longer refuses by design — it UPLOADS for
  // TestFlight processing behind PG-1…PG-5. These cases hold every gate to refusing BEFORE any check,
  // and the upload to its sourced protocol, against a loopback server (never App Store Connect).
  test('--submit without the store\'s own typed word REFUSES, before running a single check (PG-1)', () => {
    const { code, out } = run(tree({ withArtifact: true, enrolment: '2026-09-28' }), ['--submit', '--channel', 'ios-appstore', '--app', 'subscriptiontracker']);
    assert.equal(code, 1, out);
    assert.match(out, /--submit --channel ios-appstore requires --confirm UPLOAD-IOS-TO-TESTFLIGHT; got ""/);
    assert.doesNotMatch(out, /metadata tree .* field\(s\) present/);
  });

  test('the iOS word does not open the macOS upload: every store takes its own word', () => {
    const { code, out } = run(tree({ withArtifact: true, enrolment: '2026-09-28' }), ['--submit', '--channel', 'macos-appstore', '--app', 'subscriptiontracker', '--confirm', 'UPLOAD-IOS-TO-TESTFLIGHT']);
    assert.equal(code, 1, out);
    assert.match(out, /requires --confirm UPLOAD-MACOS-TO-TESTFLIGHT; got "UPLOAD-IOS-TO-TESTFLIGHT"/);
  });

  // #1072 review: the Small Business Program gate guarded only a CI publish job. --submit runs it first.
  test('RED CONTROL: a refusing Small Business Program gate EXITS --submit before anything after it runs', () => {
    const { code, out } = run(tree(), ['--submit', '--channel', 'ios-appstore', '--app', 'subscriptiontracker', '--confirm', 'UPLOAD-IOS-TO-TESTFLIGHT']);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL the Small Business Program gate REFUSED this submission \(node tooling\/ci\/assert-small-business-program\.mjs --for-submission=ios-appstore --real-submission exited 1\)/);
    assert.match(out, /REFUSED {2}a real ios-appstore submission: .*owner step A-18/);
    // #1088 review: the gate stops the run itself; it does not lean on a gate below it.
    assert.match(out, /submit-appstore: FAILED — nothing was submitted\./);
    assert.doesNotMatch(out, /requires --confirm|PG-4/);
  });

  test('GREEN CONTROL: with an approval date recorded the gate passes, and the next gate is what stops a laptop run', () => {
    const { code, out } = run(tree({ withArtifact: true, enrolment: '2026-09-28' }), [...submitArgs('macos-appstore')], { GITHUB_ACTIONS: '', GITHUB_REPOSITORY: '' });
    assert.equal(code, 1, out);
    assert.match(out, /ok {3}the Small Business Program gate passed \(node tooling\/ci\/assert-small-business-program\.mjs --for-submission=macos-appstore --real-submission\)/);
    assert.match(out, /--submit runs only inside GitHub Actions/);
  });

  test("--submit with no fee register is COVERAGE LOST (exit 2), not a refusal's 1", () => {
    const { code, out } = run(tree({ omitFees: true }), ['--submit', '--channel', 'ios-appstore', '--app', 'subscriptiontracker']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/catalog\/fee-register\.json does not exist/);
  });

  test('--allow-missing-artifact is a dry-run flag, and --submit refuses it (PG-2)', () => {
    const { code, out } = run(tree({ enrolment: '2026-09-28' }), [...submitArgs('ios-appstore'), '--allow-missing-artifact']);
    assert.equal(code, 1, out);
    assert.match(out, /--allow-missing-artifact is a DRY-RUN flag and --submit refuses it/);
  });

  test('a release target other than testflight REFUSES: an App Review submission is the owner\'s (PG-2b)', () => {
    const { code, out } = run(tree({ withArtifact: true, enrolment: '2026-09-28' }), submitArgs('ios-appstore'), { APPLE_RELEASE_TARGET: 'app-review' });
    assert.equal(code, 1, out);
    assert.match(out, /APPLE_RELEASE_TARGET is "app-review"; this script uploads for TestFlight processing and nothing else/);
  });

  test('a version string App Store Connect would not take REFUSES before the upload (PG-2c)', () => {
    const { code, out } = run(tree({ withArtifact: true, enrolment: '2026-09-28' }), submitArgs('ios-appstore', { shortVersion: '1.0.0.7' }));
    assert.equal(code, 1, out);
    assert.match(out, /--bundle-short-version is "1\.0\.0\.7"; it is one to three period-separated integers/);
  });

  test('PG-4: an upload job with no `environment:` REFUSES — the gate IS the environment', () => {
    const root = tree({ withArtifact: true, enrolment: '2026-09-28', workflow: (y) => y.replace('    environment: store-publish\n', '') });
    const { code, out } = run(root, submitArgs('ios-appstore'), ghEnv('http://127.0.0.1:9'));
    assert.equal(code, 1, out);
    assert.match(out, /job "submit" runs `--submit` and declares no `environment:`/);
  });

  test('PG-4: an upload job that reads the signature AFTER the upload REFUSES', () => {
    const root = tree({
      withArtifact: true,
      enrolment: '2026-09-28',
      // Only the upload job's copy is removed: the dry-run job proves the bytes it built, too.
      workflow: (y) => {
        const i = y.indexOf('\n  submit:\n');
        return y.slice(0, i) + y.slice(i).replace(/node tooling\/ci\/assert-artifact-signed-apple\.mjs/g, 'echo skipped');
      },
    });
    const { code, out } = run(root, submitArgs('ios-appstore'), ghEnv('http://127.0.0.1:9'));
    assert.equal(code, 1, out);
    assert.match(out, /uploads and never runs assert-artifact-signed-apple\.mjs/);
  });

  test('PG-5: an environment with no required reviewer REFUSES (environment: alone fails open)', async () => {
    const srv = await ascServer({ reviewers: [] });
    try {
      const { code, out } = await runAsync(tree({ withArtifact: true, enrolment: '2026-09-28' }), submitArgs('ios-appstore'), { ...ghEnv(srv.base), ...ascEnv(srv.base) });
      assert.equal(code, 1, out);
      assert.match(out, /carries NO required reviewer/);
      assert.equal(srv.seen.filter((r) => r.path.startsWith('/v1/')).length, 0, 'nothing reached App Store Connect');
    } finally {
      srv.close();
    }
  });

  test('THE UPLOAD: every gate passes, the parts tile the file, the commit and the read-back follow, and nothing goes for review', async () => {
    const srv = await ascServer({});
    try {
      const { code, out } = await runAsync(tree({ withArtifact: true, enrolment: '2026-09-28' }), submitArgs('ios-appstore'), { ...ghEnv(srv.base), ...ascEnv(srv.base) });
      assert.equal(code, 0, out);
      assert.match(out, /PG-4 lane shape — .*submit-appstore\.yml gates the upload job on an environment/);
      assert.match(out, /PG-5 publish gate — "store-publish" carries 1 required reviewer/);
      assert.match(out, /build upload BU1 created — IOS 1\.0\.7 \(7\) on App Store Connect record 1234567890/);
      assert.match(out, /2 upload operation\(s\) sent — 1024 bytes of subscriptiontracker\.ipa/);
      assert.match(out, /submit-appstore: UPLOADED — ios-appstore 1\.0\.7 \(7\), build upload BU1, state COMPLETE/);
      assert.match(out, /NOTHING WAS SUBMITTED FOR REVIEW/);
      const created = srv.seen.find((r) => r.method === 'POST' && r.path === '/v1/buildUploads');
      assert.deepEqual(created.body.data.attributes, { cfBundleShortVersionString: '1.0.7', cfBundleVersion: '7', platform: 'IOS' });
      assert.equal(created.body.data.relationships.app.data.id, RECORD_ID);
      const file = srv.seen.find((r) => r.method === 'POST' && r.path === '/v1/buildUploadFiles');
      assert.deepEqual(file.body.data.attributes, { assetType: 'ASSET', fileName: 'subscriptiontracker.ipa', fileSize: 1024, uti: 'com.apple.ipa' });
      const parts = srv.seen.filter((r) => r.method === 'PUT');
      assert.deepEqual(parts.map((p) => p.size), [512, 512]);
      assert.equal(parts[0].headers['x-part'], 'one', 'each operation\'s own requestHeaders are sent');
      assert.ok(srv.seen.some((r) => r.method === 'PATCH' && r.body?.data?.attributes?.uploaded === true));
      assert.ok(srv.seen.filter((r) => r.path.startsWith('/v1/')).every((r) => /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(r.headers.authorization)), 'every API call carries a JWT');
      assert.ok(!srv.seen.some((r) => /reviewSubmissions|appStoreVersionSubmissions|appStoreVersions/.test(r.path)), 'no review endpoint is ever called');
      assert.doesNotMatch(out, /BEGIN PRIVATE KEY/);
    } finally {
      srv.close();
    }
  });

  test('a build App Store Connect FAILS is exit 1, naming its errors', async () => {
    const srv = await ascServer({ finalState: 'FAILED' });
    try {
      const { code, out } = await runAsync(tree({ withArtifact: true, enrolment: '2026-09-28' }), submitArgs('macos-appstore'), { ...ghEnv(srv.base), ...ascEnv(srv.base) });
      assert.equal(code, 1, out);
      assert.match(out, /App Store Connect FAILED build upload BU1: ITMS-90000 bad binary/);
      assert.match(out, /submit-appstore: FAILED — App Store Connect did not accept the build/);
      assert.equal(srv.seen.find((r) => r.path === '/v1/buildUploadFiles' && r.method === 'POST').body.data.attributes.uti, 'com.apple.pkg');
    } finally {
      srv.close();
    }
  });

  test('a reservation naming a host outside the seam is refused BEFORE one byte is sent', async () => {
    const srv = await ascServer({ partHost: 'http://127.0.0.2:1' });
    try {
      const { code, out } = await runAsync(tree({ withArtifact: true, enrolment: '2026-09-28' }), submitArgs('ios-appstore'), { ...ghEnv(srv.base), ...ascEnv(srv.base) });
      assert.equal(code, 1, out);
      assert.match(out, /is not the loopback seam's origin/);
      assert.equal(srv.seen.filter((r) => r.method === 'PUT').length, 0);
    } finally {
      srv.close();
    }
  });

  test('APP_STORE_CONNECT_API_BASE_URL is loopback or the real origin — any other host refuses', () => {
    assert.match(ascApiBase({ APP_STORE_CONNECT_API_BASE_URL: 'https://evil.example' }).error, /neither https:\/\/api\.appstoreconnect\.apple\.com nor loopback/);
    assert.deepEqual(ascApiBase({}), { base: 'https://api.appstoreconnect.apple.com', loopback: false });
    const real = ascApiBase({});
    assert.equal(uploadUrlProblem('https://store-1.object-storage.apple.com/x', real), null);
    assert.match(uploadUrlProblem('https://apple.com.evil.example/x', real), /not an https host under apple\.com/);
    assert.match(uploadUrlProblem('http://upload.apple.com/x', real), /not an https host under apple\.com/);
  });

  test('parts that do not tile the file are refused before any is sent', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(init.method);
      if (String(url).endsWith('/v1/buildUploads')) return new Response(JSON.stringify({ data: { id: 'BU' } }), { status: 201 });
      return new Response(JSON.stringify({ data: { id: 'BF', attributes: { uploadOperations: [{ method: 'PUT', url: 'https://u.apple.com/1', offset: 0, length: 10 }, { method: 'PUT', url: 'https://u.apple.com/2', offset: 12, length: 4 }] } } }), { status: 201 });
    };
    const r = await uploadBuild({ api: { base: 'https://api.appstoreconnect.apple.com', loopback: false }, token: () => 't', appRecordId: '1', platform: 'IOS', shortVersion: '1.0.1', bundleVersion: '1', bytes: Buffer.alloc(16), fileName: 'a.ipa', uti: 'com.apple.ipa', fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1), /must tile the 16-byte file from 0 with no gap or overlap/);
    assert.deepEqual(calls, ['POST', 'POST'], 'no PUT was sent');
  });

  // ── the mode and the channel both have to be said out loud ────────────────
  test('FAILS when neither --dry-run nor --submit is given', () => {
    const { code, out } = run(tree(), ['--channel', 'ios-appstore']);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when both --dry-run and --submit are given', () => {
    const { code, out } = run(tree(), ['--dry-run', '--submit', '--channel', 'ios-appstore']);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when no --channel is given — it must not default to one of two records', () => {
    const { code, out } = run(tree(), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /--channel must be one of: ios-appstore, macos-appstore/);
  });

  test('FAILS on a --channel that is not an Apple store row', () => {
    const { code, out } = run(tree(), ['--dry-run', '--channel', 'windows-store']);
    assert.equal(code, 1, out);
    assert.match(out, /--channel must be one of/);
  });

  // ── the listing ───────────────────────────────────────────────────────────
  test('FAILS when a listing field is missing', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitFiles: ['title.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /title\.txt is missing/);
  });

  test('FAILS when an Apple-only field is missing', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitFiles: ['subtitle.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subtitle\.txt is missing/);
  });

  test('FAILS when a listing field is emptied', () => {
    const { code, out } = macos(tree({ withArtifact: true, fields: { 'category.txt': '  \n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /category\.txt is EMPTY/);
  });

  test('FAILS when the whole metadata tree is gone', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitTree: true }));
    assert.equal(code, 1, out);
    assert.match(out, /the store metadata tree apps\/subscriptiontracker\/store\/ios-appstore does not exist/);
  });

  test('FAILS when a URL field is not an absolute https URL', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'support-url.txt': '/contact.html\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /not a single absolute https URL/);
  });

  // ── the two SOURCED Apple limits, and the citation discipline ─────────────
  test('FAILS on a 31-character subtitle, citing the page it came from', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'subtitle.txt': `${'x'.repeat(31)}\n` } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subtitle\.txt is 31 characters; the limit is 30/);
    assert.match(out, /app-store-connect\/reference\/app-information/);
  });

  test('PASSES on exactly 30 characters — the limit is not off by one', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'subtitle.txt': `${'x'.repeat(30)}\n` } }));
    assert.equal(code, 0, out);
  });

  test('FAILS below the sourced minimum of 2 characters', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'title.txt': 'S\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /title\.txt is 1 characters; the minimum is 2/);
  });

  // 🔴 A LIMIT WITHOUT A CITATION IS NOT ENFORCED, AND NOT SILENTLY SKIPPED.
  test('FAILS when a declared limit has no `source` — an unsourced number is not enforceable', () => {
    const { code, out } = ios(
      tree({
        withArtifact: true,
        mutateRegister: (r) => delete r.storeMetadataContract.perChannel['ios-appstore'].maxChars['subtitle.txt'].source,
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares a ios-appstore character limit for subtitle\.txt with NO `source`/);
  });

  test('enforces NOTHING on a field with no declared limit — keywords carry no number', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'keywords.txt': `${'k'.repeat(5000)}\n` } }));
    assert.equal(code, 0, out);
  });

  // ── the bundle identifier: one declaration, two readers ───────────────────
  test('FAILS when the iOS project builds a different bundle id from tooling/apple-provisioning.json', () => {
    const { code, out } = ios(tree({ withArtifact: true, iosBundle: 'com.someoneelse.subscriptiontracker' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /bundle identifier DISAGREES/);
  });

  test('FAILS when the macOS xcconfig builds a different bundle id from tooling/apple-provisioning.json', () => {
    const { code, out } = macos(tree({ withArtifact: true, macosBundle: 'com.someoneelse.subscriptiontracker' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /bundle identifier DISAGREES/);
  });

  // 🔴 the case that makes `declaredIn` load-bearing rather than decorative
  test('does NOT mistake the RunnerTests bundle for the app bundle', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /RunnerTests/);
  });

  test('FAILS when the project declares TWO different app bundle ids', () => {
    const { code, out } = ios(tree({ withArtifact: true, extraPbxproj: '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.nikatru.other;' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares 2 DIFFERENT app bundle identifiers/);
  });

  test('FAILS when the file that declares the bundle id does not exist', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitProject: true }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /does not exist, so channel "ios-appstore"'s bundle identifier cannot be compared/);
  });

  test('COVERAGE LOST when the project file carries no bundle id at all', () => {
    const root = tree({ withArtifact: true });
    writeFileSync(join(root, 'apps/subscriptiontracker/ios/Runner.xcodeproj/project.pbxproj'), '// nothing here\n');
    const { code, out } = ios(root);
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /COVERAGE LOST — .*contains ZERO `PRODUCT_BUNDLE_IDENTIFIER` assignments/);
  });

  test('COVERAGE LOST when the row declares no identity.declaredIn — no file to compare', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => delete r.channels.find((c) => c.id === 'ios-appstore').identity }));
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /COVERAGE LOST — .*declares no `identity\.declaredIn`/);
  });

  test('a bundleIdentifier left on the row is NOT read: the value is bundleIdOf\'s (9b)', () => {
    // assert-store-identity refuses the key on the register; this path must not fall back to it.
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.channels.find((c) => c.id === 'ios-appstore').bundleIdentifier = { value: 'com.someoneelse.app' }) }));
    assert.equal(code, 0, out);
    assert.match(out, /bundle identifier com\.nikatru\.subscriptiontracker — tooling\/apple-provisioning\.json and /);
    assert.doesNotMatch(out, /someoneelse/);
  });

  // ── the artifact ──────────────────────────────────────────────────────────
  test('FAILS when the artifact is absent and --allow-missing-artifact was NOT passed', () => {
    const { code, out } = ios(tree());
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subscriptiontracker\.ipa does not exist/);
  });

  test('PASSES with --allow-missing-artifact, and SAYS the package was not validated', () => {
    const { code, out } = ios(tree(), ['--allow-missing-artifact']);
    assert.equal(code, 0, out);
    assert.match(out, /NO SIGNED ARTIFACT/);
    // RE-PINNED 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP): the certificate was issued on
    // 2026-09-09, so "no distribution certificate" was the stale reason. The measured one:
    // unsigned by choice until the signing seam lands in the lane, and --submit refuses.
    // RE-PINNED 2026-10-01 (review AA-18): the lane now signs in-lane and never passes the flag.
    assert.match(out, /The submit-appstore\.yml lane never passes this flag: it signs and packages first/);
    assert.doesNotMatch(out, /builds unsigned by choice/, 'the 2026-09-26 reason is gone with the unsigned lane');
    assert.doesNotMatch(out, /needs a distribution certificate|returned an EMPTY set/, 'the stale reason is gone');
    assert.doesNotMatch(out, /OWNER_QUEUE A-4 gates/, 'A-4 closed 2026-08-31');
  });

  // THE RED CONTROL of review AA-18: the lane's own dry run, with the artifact missing, FAILS.
  test('the absent-artifact refusal gives the measured reason, not the stale one', () => {
    const { code, out } = ios(tree());
    assert.equal(code, 1, out);
    assert.match(out, /submit-appstore\.yml signs and packages it immediately before running this dry run/);
    assert.doesNotMatch(out, /builds unsigned by choice/);
    assert.doesNotMatch(out, /cannot be produced without a distribution certificate/);
  });

  test('FAILS on a zero-byte artifact', () => {
    const { code, out } = ios(tree({ withArtifact: true, artifactBytes: 0 }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /ZERO bytes/);
  });

  test('FAILS when the channel stops accepting the format the path produces', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.channels.find((c) => c.id === 'ios-appstore').artifactFormats = ['.zip']) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /matches none of the formats channel "ios-appstore" accepts/);
  });

  // ⏱ ADDED 2026-09-25 (O-APPLE-PROVER-SKIPS-THE-PKG): the artifact path is the
  // row's signing.seam.artifactGlob, read through apple-signing.mjs's appleArtifactPath.
  test('the artifact path follows the row\'s artifactGlob — the old Release/ glob misses the .pkg bp writes', () => {
    const { code, out } = macos(
      tree({
        withArtifact: true,
        mutateRegister: (r) => (r.channels.find((c) => c.id === 'macos-appstore').signing.seam.artifactGlob = 'apps/*/build/macos/Build/Products/Release/*.pkg'),
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /apps\/subscriptiontracker\/build\/macos\/Build\/Products\/Release\/subscriptiontracker\.pkg/);
  });

  test('FAILS COVERAGE LOST when the row declares no artifactGlob', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => delete r.channels.find((c) => c.id === 'ios-appstore').signing }));
    assert.equal(code, 2, out);
    assertComplained(out);
    assert.match(out, /COVERAGE LOST — channel "ios-appstore" gives no artifact path: channel "ios-appstore" declares no signing\.seam\.artifactGlob/);
  });

  // ── credentials and floors: printed, never failed, never read ─────────────
  test('PRINTS which credentials are absent and never their values', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /CREDENTIALS NOT CONFIGURED — 3 of 3 absent/);
    assert.doesNotMatch(out, /APP_STORE_CONNECT_APP_ID/, 'the record id is the app\'s own, never a secret (9b)');
    assert.match(out, /APP_STORE_CONNECT_PRIVATE_KEY/);
  });

  test('reports credentials as present without printing them', () => {
    const secret = 'THIS-MUST-NEVER-BE-PRINTED';
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run', '--channel', 'ios-appstore', '--app', 'subscriptiontracker'], {
      APP_STORE_CONNECT_ISSUER_ID: 'i',
      APP_STORE_CONNECT_KEY_ID: 'k',
      APP_STORE_CONNECT_PRIVATE_KEY: secret,
    });
    assert.equal(code, 0, out);
    assert.match(out, /credentials — all 3 environment variable\(s\) present/);
    assert.doesNotMatch(out, new RegExp(secret));
  });

  // 🔴 the sourced floor that is NOT met, printed on every run
  test('PRINTS the unpinned Xcode 26 floor, with its source and its date', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /XCODE FLOOR NOT PINNED/);
    assert.match(out, /must be built with Xcode 26 or later/);
    assert.match(out, /arm64-only/);
  });

  test('stops printing the Xcode gap once tooling/versions.json pins one', () => {
    const root = tree({ withArtifact: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling/versions.json'), JSON.stringify({ xcode: '26.0' }));
    const { code, out } = ios(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /XCODE FLOOR NOT PINNED/);
  });

  // ── the register is the single declaration ────────────────────────────────
  test('COVERAGE LOST when the register declares no such channel', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.channels = r.channels.filter((c) => c.id !== 'ios-appstore')) }));
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /COVERAGE LOST — .*declares no "ios-appstore" channel/);
  });

  test('COVERAGE LOST when storeMetadataContract.requiredFiles is emptied', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.storeMetadataContract.requiredFiles = []) }));
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /COVERAGE LOST — .*requiredFiles/);
  });

  // ── the app's own record (O-STORE-RECORDS-ARE-ONE-PER-CHANNEL, 9b; RC6) ─────
  // `--app` is required, and every Apple fact this path reads is the app's: the bundle id from
  // tooling/apple-provisioning.json (bundleIdOf) and the App Store Connect record from its own
  // apps/<id>/app.yaml `stores`. The channel row carries neither, so a second app is graded
  // against its own record and never against the first app's.
  const FIRST = { slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' };
  const SECOND = { slug: 'secondapp', name: 'Second', tagline: 'A second app', platforms: ['web'], status: 'live' };
  const withSecond = (apple) => {
    apple.apps.secondapp = { bundleId: 'com.nikatru.secondapp', capabilities: ['IN_APP_PURCHASE'] };
  };
  /** A second app, complete: its own Xcode project, listing, artifact and record. */
  const secondApp = ({ pbxBundle = 'com.nikatru.secondapp', recordId = '2222222222' } = {}) => {
    const root = tree({ withArtifact: true, apps: [FIRST, SECOND], mutateApple: withSecond });
    const put = (rel, body) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    };
    put('apps/secondapp/ios/Runner.xcodeproj/project.pbxproj', `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${pbxBundle};\n`);
    for (const [rel, body] of Object.entries(FILES)) put(`apps/secondapp/store/ios-appstore/${rel}`, body);
    put('apps/secondapp/build/ios/ipa/secondapp.ipa', 'x'.repeat(1024));
    put('apps/secondapp/app.yaml', storesYaml({ 'ios-appstore': { state: 'issued', recordId }, 'macos-appstore': { state: 'issued', recordId } }));
    return root;
  };

  test('RC6 · --app is REQUIRED: a run without it is COVERAGE LOST (2), never the first app', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run', '--channel', 'ios-appstore']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — --app is required/);
    assert.doesNotMatch(out, /metadata tree/, 'nothing is graded for an app nobody named');
  });

  test('the App Store Connect record is read from the app\'s own app.yaml, never a secret', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /App Store Connect record 1234567890 — apps\/subscriptiontracker\/app\.yaml stores\.ios-appstore \(issued/);
  });

  test('a second app is graded against ITS OWN bundle id and record, and passes', () => {
    const { code, out } = run(secondApp(), ['--dry-run', '--channel', 'ios-appstore', '--app', 'secondapp']);
    assert.equal(code, 0, out);
    assert.match(out, /bundle identifier com\.nikatru\.secondapp — tooling\/apple-provisioning\.json and apps\/secondapp\/ios/);
    assert.match(out, /App Store Connect record 2222222222 — apps\/secondapp\/app\.yaml/);
    assert.doesNotMatch(out, /1234567890/, 'the first app\'s record is not this app\'s');
  });

  test('a second app whose Xcode project still carries app #1\'s bundle id FAILS', () => {
    const { code, out } = run(secondApp({ pbxBundle: BUNDLE }), ['--dry-run', '--channel', 'ios-appstore', '--app', 'secondapp']);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /bundle identifier DISAGREES for app "secondapp"/);
  });

  test('a pending record PRINTS the owner step on a dry run and exits 0', () => {
    const { code, out } = ios(tree({ withArtifact: true, records: { 'ios-appstore': { state: 'pending' }, 'macos-appstore': { state: 'pending' } } }));
    assert.equal(code, 0, out);
    assert.match(out, /APP STORE RECORD PENDING — apps\/subscriptiontracker\/app\.yaml stores\.ios-appstore is state: pending/);
  });

  test('an issued record with no recordId FAILS, naming the field', () => {
    const { code, out } = ios(tree({ withArtifact: true, records: { 'ios-appstore': { state: 'issued' }, 'macos-appstore': ISSUED['macos-appstore'] } }));
    assert.equal(code, 1, out);
    assert.match(out, /stores\.ios-appstore is state: issued and lacks recordId/);
  });

  test('an app with no declaration FAILS: it has no record to submit to', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitAppYaml: true }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/subscriptiontracker\/app\.yaml does not exist, so app "subscriptiontracker" has no ios-appstore record/);
  });

  test('an app the Apple register does not declare is refused, naming the app', () => {
    const root = tree({ withArtifact: true, apps: [FIRST, SECOND] });
    const { code, out } = run(root, ['--dry-run', '--channel', 'ios-appstore', '--app', 'secondapp']);
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares no app "secondapp"/);
  });

  test('COVERAGE LOST when tooling/apple-provisioning.json is absent — no bundle id to compare the project to', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitApple: true }));
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /COVERAGE LOST — tooling\/apple-provisioning\.json does not exist/);
  });

  test('FAILS when the channel stops being submittable', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.channels.find((c) => c.id === 'ios-appstore').submittable = false) }));
    assert.equal(code, 1, out);
    assert.match(out, /is not marked `submittable`/);
  });
});
