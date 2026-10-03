// ─────────────────────────────────────────────────────────────────────────────
// play-submission.test.mjs — tooling/release/submit-play.mjs must be able to
// FAIL, its publish gate must be able to REFUSE, and its upload path must
// actually speak the Google Play Developer API.
//
// [pipeline D-10] limb (i): "a submission script exists AND resolves to a step
// in a workflow". A script that exists and has stopped working satisfies the
// letter of that limb and none of its point, which is why the dry run is wired
// into ci.yml on every push as well as into the dispatch workflow — and why it
// has these tests.
//
// ── 🔴 WHAT REPLACED "THE MOST IMPORTANT CASE IN THIS FILE" ──────────────────
// Until 2026-08-09 the headline case here asserted that `--submit` REFUSED with
// a list of `UNVERIFIED:` facts, and this header said: "If somebody later
// implements `--submit`, this test failing is the correct signal — it means the
// refusal is gone and the UNVERIFIED list must have been REPLACED BY SOURCED
// FACTS, not deleted."
//
// That is what happened. Every endpoint, payload and auth detail was fetched
// from a primary source (see `PRIMARY_SOURCES` in the script) and the refusal
// was retired. The cases that asserted it are therefore GONE — not weakened —
// and what stands in their place is stronger than a refusal could be: the real
// transport, driven end to end against a local HTTP server that speaks the
// documented lifecycle back, with a token endpoint that CRYPTOGRAPHICALLY
// VERIFIES the RS256 assertion the script signs. A mocked function returning a
// canned object would prove the script calls itself correctly; this proves it
// composes a request Google's documentation says is the right one.
//
// ── THE PUBLISH GATE IS TESTED AS A GATE ─────────────────────────────────────
// [ADR 031:117-124] required "a GitHub environment with a required reviewer" and
// recorded the mechanism as UNBUILT. PG-1…PG-6 are that mechanism, and every one
// of them — PG-5b included — has a case here that proves it can REFUSE. PG-5
// because GitHub documents auto-creating a missing environment with NO
// protection rules, so `environment:` alone fails open. PG-5b because the
// environment's own deployment branch policy is the only thing that says WHICH
// REF may deploy — and until 2026-08-27 the fake GitHub below returned no
// `deployment_branch_policy` field at all, so every case landed on that limb's
// `refPolicy === undefined` NOT-DECIDED arm and the whole decision tree could be
// deleted with this suite still green.
//
// ⚠️ MUTATION-PROVEN FIRST, NOT FIXTURE-FIRST. CLAUDE.md: "A fixture passing is
// not a guard working — MUTATE THE REAL TREE", because a fixture you wrote
// encodes the same misunderstanding as the guard you wrote. The script was
// mutation-proven on 2026-08-01 against a scratch COPY of the real tree; the
// 2026-08-09 additions are proven against the REAL .github/workflows/
// submit-play.yml for the PG-4 parse (see "reads the REAL workflow").
//
// ⛔ WHAT THESE TESTS CANNOT PROVE, stated rather than implied:
//   · no .aab has ever been built on the owner's Windows box (java.nio
//     Selector.open() fails process-wide there; it builds in WSL and in CI). The
//     artifact half is exercised by .github/workflows/submit-play.yml.
//   · NO BUNDLE HAS EVER REACHED GOOGLE. The server below is a local one. What
//     only a real, owner-approved dispatch can prove is listed at the bottom of
//     this file.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { generateKeyPairSync, createVerify, createHash } from 'node:crypto';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'release', 'submit-play.mjs');

let TMP;
/** One RSA key pair for the whole file: the script signs the JWT assertion with
 *  the private half and the fake token endpoint verifies it with the public
 *  half. Generating it per test would add seconds and prove nothing extra. */
let KEYS;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-playsubmit-'));
  KEYS = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A value that must NEVER appear in output. A service-account key is a private
 *  key, and the failure paths are exactly where a naive implementation echoes
 *  the thing it could not parse. */
const SECRET = 'THIS-IS-A-PRIVATE-KEY-DO-NOT-PRINT';
const CONFIRM = 'SUBMIT-TO-PLAY';
const PACKAGE = 'com.nikatru.subscriptiontracker';

/** Distinct bytes per listing image, so a slot's sha256 sequence says which files it holds. */
const LISTING_PNGS = {
  'store-icon-512.png': 'icon-bytes',
  'feature-graphic.png': 'feature-bytes',
  'screenshots/01-home.png': 'phone-1',
  'screenshots/02-calendar.png': 'phone-2',
  'screenshots-tablet/01-home.png': 'tablet-1',
  'screenshots-tablet/02-calendar.png': 'tablet-2',
};
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const FILES = {
  'README.md': 'derivation map\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'A longer description.\n',
  'category.txt': 'Productivity\n',
  'privacy-policy-url.txt': 'https://nikatru.com/privacy.html\n',
  'support-url.txt': 'https://nikatru.com/contact.html\n',
  'screenshots/README.md': 'slot\n',
};

/** The real file's shape, reduced to the parts the script parses. Both the
 *  `releaseSigningEnv` map and the debug fallback are load-bearing: the script
 *  reads the ENV VAR NAMES out of this file rather than repeating them, so a
 *  rename here follows through instead of drifting. */
const gradle = ({ appId = PACKAGE, envMap = true, debugFallback = true } = {}) =>
  [
    'plugins { id("com.android.application") }',
    '',
    envMap
      ? [
          'val releaseSigningEnv = mapOf(',
          '    "storeFile" to "ANDROID_KEYSTORE_PATH",',
          '    "storePassword" to "ANDROID_KEYSTORE_PASSWORD",',
          '    "keyAlias" to "ANDROID_KEY_ALIAS",',
          '    "keyPassword" to "ANDROID_KEY_PASSWORD",',
          ')',
        ].join('\n')
      : 'val releaseSigningEnv = mapOf<String, String>()',
    '',
    'android {',
    appId === null ? '' : `    applicationId = "${appId}"`,
    '    buildTypes {',
    '        release {',
    debugFallback
      ? '            signingConfig = signingConfigs.getByName("debug")'
      : '            signingConfig = signingConfigs.getByName("release")',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');

/** The submission workflow, as PG-4 reads it: a job that runs `--submit`, which
 *  must declare `environment:` and must run assert-artifact-signed.mjs BEFORE
 *  the submit step. Each knob below removes exactly one of those properties, so
 *  every PG-4 limb has an input that makes it fire. */
const submitWorkflow = ({ environment = true, signature = true, signatureAfter = false } = {}) => {
  const sig = '      - name: signature\n        run: node tooling/ci/assert-artifact-signed.mjs apps/subscriptiontracker/build/app/outputs/bundle/release/app-release.aab\n';
  const sub = '      - name: submit\n        run: node tooling/release/submit-play.mjs --submit --app subscriptiontracker --confirm "$CONFIRM"\n';
  return [
    'name: fixture submission lane\n',
    'on:\n  workflow_dispatch:\n',
    'jobs:\n',
    '  dry-run:\n    runs-on: ubuntu-24.04\n    steps:\n',
    '      - name: dry run\n        run: node tooling/release/submit-play.mjs --dry-run --app subscriptiontracker\n',
    '  submit:\n    runs-on: ubuntu-24.04\n',
    environment ? '    environment: store-publish\n' : '',
    '    steps:\n',
    signature && !signatureAfter ? sig : '',
    sub,
    signature && signatureAfter ? sig : '',
  ].join('');
};

function tree({
  mutateRegister = null,
  fields = {},
  omitFiles = [],
  omitTree = false,
  withArtifact = false,
  artifactBytes = 1024,
  gradleOver = {},
  omitGradle = false,
  withKeyProperties = false,
  workflow = {},
  omitWorkflow = false,
  // --sync-listing: the register's graphicAssets + appConfigPaths, the app config and the PNGs.
  withListingAssets = false,
  releaseNotes = null,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    storeMetadataContract: {
      requiredFiles: Object.keys(FILES),
      urlFiles: ['privacy-policy-url.txt', 'support-url.txt'],
      perChannel: {
        'android-play': {
          maxChars: {
            'title.txt': { max: 30, source: 'support.google.com/.../9859152 (2026-07-29)' },
            'short-description.txt': { max: 80, source: 'support.google.com/.../9859152 (2026-07-29)' },
            'long-description.txt': { max: 4000, source: 'support.google.com/.../9859152 (2026-07-29)' },
          },
        },
      },
    },
    channels: [
      {
        id: 'android-play',
        kind: 'store',
        served: false,
        submittable: true,
        platforms: ['android'],
        artifactFormats: ['.aab'],
        storeMetadataDir: 'apps/{app}/store/android-play',
        ownerQueue: 'A-3',
        submission: {
          runbook: 'Private/runbooks/store-submission-android.md',
          workflow: '.github/workflows/submit-play.yml',
          job: 'dry-run',
          script: 'tooling/release/submit-play.mjs',
        },
      },
    ],
  };
  if (withListingAssets) {
    register.storeMetadataContract.appConfigPaths = ['apps/{app}/lib/core/config/app_config.dart', 'apps/{app}/lib/core/app_config.dart'];
    register.storeMetadataContract.perChannel['android-play'].graphicAssets = {
      assets: { 'feature-graphic.png': { width: 1024, height: 500 }, 'store-icon-512.png': { width: 512, height: 512 } },
      screenshots: { deviceTypeCoverage: { sets: { phone: { dir: 'screenshots' }, tablet: { dir: 'screenshots-tablet' } } } },
    };
  }
  if (mutateRegister) mutateRegister(register);

  write('catalog/apps.json', JSON.stringify([{ slug: 'subscriptiontracker', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' }], null, 2));
  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  if (!omitGradle) write('apps/subscriptiontracker/android/app/build.gradle.kts', gradle(gradleOver));
  if (withKeyProperties) write('apps/subscriptiontracker/android/key.properties', 'storeFile=x.jks\n');
  if (!omitWorkflow) write('.github/workflows/submit-play.yml', submitWorkflow(workflow));
  if (!omitTree) {
    for (const [rel, body] of Object.entries(FILES)) {
      if (omitFiles.includes(rel)) continue;
      write(`apps/subscriptiontracker/store/android-play/${rel}`, fields[rel] ?? body);
    }
  }
  if (withArtifact) write('apps/subscriptiontracker/build/app/outputs/bundle/release/app-release.aab', 'x'.repeat(artifactBytes));
  if (releaseNotes !== null) write('apps/subscriptiontracker/store/android-play/release-notes.txt', releaseNotes);
  if (withListingAssets) {
    const dir = 'apps/subscriptiontracker/store/android-play';
    for (const [rel, bytes] of Object.entries(LISTING_PNGS)) write(`${dir}/${rel}`, bytes);
    write('apps/subscriptiontracker/lib/core/app_config.dart', "class AppConfig {\n  static const String companyUrl = 'https://nikatru.com';\n  static const String supportEmail = 'support@nikatru.com';\n}\n");
  }
  return root;
}

/** Every environment variable the script reads, cleared. The developer running
 *  these tests may have any of them set — including, on a CI runner,
 *  GITHUB_ACTIONS and GITHUB_TOKEN, which PG-3 and PG-5 read. A test that
 *  inherits those passes on a runner and fails on a laptop for reasons that have
 *  nothing to do with the code.
 *
 *  🔴 GITHUB_REF JOINED THIS LIST ON 2026-08-27 AND IT WAS ALREADY BEING READ.
 *  PG-5b reads it. Its absence here was harmless only because the fake GitHub
 *  returned no `deployment_branch_policy`, so PG-5b stopped at its first arm
 *  before the ref mattered. The moment a case below gives the environment a
 *  policy, an inherited GITHUB_REF decides the outcome — which is a suite that
 *  behaves one way on a runner and another on a laptop, i.e. the exact thing
 *  this list exists to prevent. */
const CLEARED = [
  'ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD',
  'PLAY_SERVICE_ACCOUNT_JSON', 'PLAY_TRACK', 'ANDROID_SIGNING_POSTURE',
  'GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_API_URL', 'GITHUB_REF',
  'PLAY_API_BASE_URL', 'PLAY_OAUTH_TOKEN_URL',
];

const cleanEnv = (env) => {
  const base = { ...process.env };
  for (const k of CLEARED) delete base[k];
  return { ...base, ...env };
};

function run(root, { args = ['--dry-run', '--app', 'subscriptiontracker', '--allow-missing-artifact'], env = {} } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], { encoding: 'utf8', env: cleanEnv(env) });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 🔴 ASYNC, AND spawnSync WOULD DEADLOCK. The API server below lives in THIS
 *  process, so a synchronous child blocks the very event loop that has to answer
 *  its requests: the script waits forever for a reply the test cannot send while
 *  it is waiting for the script. Cost one debugging session on 2026-08-09, and
 *  it presents as a hung suite rather than a failure — so it is written down. */
function runAsync(root, { args, env = {} } = {}) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [SCRIPT, ...args, '--repo-root', root], { env: cleanEnv(env) });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => res({ code, out }));
  });
}

/** A crash is not a catch. Every failing case asserts a real complaint. */
const assertComplained = (out) => {
  assert.doesNotMatch(out, /TypeError|ReferenceError|node:internal/, out);
  assert.match(out, /^FAIL /m, out);
};

// ═════════════════════════════════════════════════════════════════════════════
// THE LOCAL API — one HTTP server that speaks Google's documented lifecycle and
// GitHub's environments endpoint, on loopback, so the script's REAL transport
// runs against it.
//
// 🔴 IT IS NOT A STUB OF THE SCRIPT'S FUNCTIONS, AND THE DIFFERENCE IS THE WHOLE
// VALUE. A stub proves the script calls its own helper. This proves the script
// composes a request the documentation says is correct: the token endpoint
// verifies the RS256 signature, checks `aud` is the literal Google requires, and
// rejects an assertion that lives longer than the documented hour; every Play
// endpoint refuses a request that does not carry the bearer token it issued.
// ═════════════════════════════════════════════════════════════════════════════
const TOKEN = 'ya29.test-access-token';
const EDIT_ID = 'edit-01HZ';
const VERSION_CODE = 4207;

async function api({
  tracks = ['production', 'beta', 'alpha', 'internal'],
  protectionRules = [{ id: 1, type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'globalonlinedeveloper', id: 55662283 } }] }],
  environmentExists = true,
  // PG-5b. `undefined` is not a value the environment response carries — it means
  // the FIELD IS ABSENT, which is the shape every case here had before
  // 2026-08-27 and the reason PG-5b's decision tree was dead code.
  deploymentBranchPolicy = undefined,
  branchPolicyRows = [],   // what the SECOND GET returns
  branchPoliciesStatus = 200,
  failAt = null,           // 'commit' | 'tracks.update' | 'validate'
  sha256Override = null,   // force a transit-corruption verdict
  omitSha256 = false,
  failDelete = false,
  offOriginSession = false,
  trackReleases = {},     // track -> releases[] as edits.tracks.list returns them
  details = { defaultLanguage: 'en-US' },
  listing = null,         // the live en-US listing; null answers 404
  images = {},            // imageType -> [{ sha256 }]; each is served at a loopback url for the backup
  imageUrlStatus = 200,   // what the image url answers — the backup refuses on anything else
  omitUploadSha = false,  // an upload answer with no sha256 is UNVERIFIED
} = {}) {
  const calls = [];
  const bodies = [];
  const state = { details: { ...details }, listing, images: { ...images } };
  /** Bytes behind each image url — the backup downloads them before anything is replaced. */
  const imageBytes = new Map();
  const served = (type, img, i) => {
    if (img.url) return img;
    const id = img.id ?? `seed-${type}-${i}`;
    if (!imageBytes.has(id)) imageBytes.set(id, Buffer.from(`live-bytes-${id}`));
    return { ...img, id, url: `http://127.0.0.1:${server.address().port}/img/${id}` };
  };
  const body = (req) =>
    new Promise((res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => res(Buffer.concat(chunks)));
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname);
    calls.push(`${req.method} ${path}`);
    const send = (status, obj, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(obj === null ? '' : JSON.stringify(obj));
    };
    const authed = () => (req.headers.authorization ?? '') === `Bearer ${TOKEN}`;

    // ── GitHub: GET /repos/{owner}/{repo}/environments/{name} ────────────────
    // …and PG-5b's SECOND GET, /deployment-branch-policies, which the script
    // makes only when the first response's MODE says a custom list exists.
    // 🔴 THE ORDER OF THESE TWO BRANCHES IS LOAD-BEARING: the environment path is
    // a strict PREFIX of the policies path, so putting the environment reply
    // first answers the policies GET with an environment body and PG-5b then
    // reports "no readable branch_policies list" — a NOT DECIDED that looks like
    // a working test.
    if (path.startsWith('/repos/')) {
      if (!environmentExists) return send(404, { message: 'Not Found' });
      if (path.endsWith('/deployment-branch-policies')) {
        if (branchPoliciesStatus !== 200) return send(branchPoliciesStatus, { message: 'no' });
        return send(200, { total_count: branchPolicyRows.length, branch_policies: branchPolicyRows });
      }
      const env = { name: 'store-publish', protection_rules: protectionRules };
      if (deploymentBranchPolicy !== undefined) env.deployment_branch_policy = deploymentBranchPolicy;
      return send(200, env);
    }

    // ── Google token endpoint (JWT-bearer grant) ─────────────────────────────
    if (path === '/token') {
      const form = new URLSearchParams((await body(req)).toString());
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        return send(400, { error: 'unsupported_grant_type', got: form.get('grant_type') });
      }
      const assertion = form.get('assertion') ?? '';
      const [h, c, s] = assertion.split('.');
      if (!h || !c || !s) return send(400, { error: 'invalid_grant', why: 'not a three-part JWT' });
      const header = JSON.parse(Buffer.from(h, 'base64url').toString());
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      if (header.alg !== 'RS256' || header.typ !== 'JWT') return send(400, { error: 'invalid_grant', why: 'header', header });
      // `aud` "is always https://oauth2.googleapis.com/token" — the REAL one,
      // never the loopback override. If the script ever signed for the override
      // it would be signing for whatever a rogue env var named.
      if (claims.aud !== 'https://oauth2.googleapis.com/token') return send(400, { error: 'invalid_grant', why: 'aud', aud: claims.aud });
      if (claims.scope !== 'https://www.googleapis.com/auth/androidpublisher') return send(400, { error: 'invalid_scope', scope: claims.scope });
      if (typeof claims.iss !== 'string' || !claims.iss.includes('@')) return send(400, { error: 'invalid_grant', why: 'iss' });
      if (!(claims.exp > claims.iat) || claims.exp - claims.iat > 3600) return send(400, { error: 'invalid_grant', why: 'exp > iat + 1h' });
      const v = createVerify('RSA-SHA256');
      v.update(`${h}.${c}`);
      if (!v.verify(KEYS.publicKey, Buffer.from(s, 'base64url'))) return send(401, { error: 'invalid_grant', why: 'signature' });
      return send(200, { access_token: TOKEN, token_type: 'Bearer', expires_in: 3600, scope: claims.scope });
    }

    // Image urls are public on Play (no bearer token); the backup fetches them.
    if (path.startsWith('/img/')) {
      const bytes = imageBytes.get(path.slice('/img/'.length));
      if (imageUrlStatus !== 200 || !bytes) return send(imageUrlStatus === 200 ? 404 : imageUrlStatus, { error: 'gone' });
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(bytes);
    }

    if (!authed()) return send(401, { error: { message: 'missing or wrong bearer token' } });

    const editsRoot = `/androidpublisher/v3/applications/${PACKAGE}/edits`;
    const uploadRoot = `/upload/androidpublisher/v3/applications/${PACKAGE}/edits`;

    if (req.method === 'POST' && path === editsRoot) {
      return send(200, { id: EDIT_ID, expiryTimeSeconds: String(Math.floor(Date.now() / 1000) + 3600) });
    }
    if (req.method === 'GET' && path === `${editsRoot}/${EDIT_ID}/tracks`) {
      return send(200, { kind: 'androidpublisher#tracksListResponse', tracks: tracks.map((t) => ({ track: t, releases: trackReleases[t] ?? [] })) });
    }
    const listingAt = `${editsRoot}/${EDIT_ID}/listings/en-US`;
    if (path === `${editsRoot}/${EDIT_ID}/details`) {
      if (req.method === 'GET') return send(200, state.details);
      if (req.method === 'PATCH') {
        const sent = JSON.parse((await body(req)).toString());
        bodies.push({ what: 'details', body: sent });
        state.details = { ...state.details, ...sent };
        return send(200, state.details);
      }
    }
    if (path === listingAt) {
      if (req.method === 'GET') return state.listing === null ? send(404, { error: { message: 'not found' } }) : send(200, state.listing);
      if (req.method === 'PUT') {
        const sent = JSON.parse((await body(req)).toString());
        bodies.push({ what: 'listing-put', body: sent });
        state.listing = sent;
        return send(200, sent);
      }
      if (req.method === 'PATCH') {
        const sent = JSON.parse((await body(req)).toString());
        bodies.push({ what: 'listing', body: sent });
        state.listing = { language: 'en-US', ...(state.listing ?? {}), ...sent };
        return send(200, state.listing);
      }
    }
    if (path.startsWith(`${listingAt}/`)) {
      const type = path.slice(listingAt.length + 1);
      if (req.method === 'GET') return send(200, { images: (state.images[type] ?? []).map((img, i) => served(type, img, i)) });
      if (req.method === 'DELETE') {
        state.images[type] = [];
        return send(200, { deleted: [] });
      }
    }
    if (req.method === 'POST' && path.startsWith(`${uploadRoot}/${EDIT_ID}/listings/en-US/`)) {
      if (url.searchParams.get('uploadType') !== 'media') return send(400, { error: 'expected uploadType=media' });
      const type = path.slice(`${uploadRoot}/${EDIT_ID}/listings/en-US/`.length);
      const bytes = await body(req);
      const img = { id: `up-${type}-${(state.images[type] ?? []).length}`, sha256: sha256(bytes) };
      imageBytes.set(img.id, bytes);
      (state.images[type] ??= []).push(img);
      return send(200, { image: omitUploadSha ? { id: img.id } : img });
    }
    if (req.method === 'POST' && path === `${uploadRoot}/${EDIT_ID}/bundles`) {
      if (url.searchParams.get('uploadType') !== 'resumable') return send(400, { error: 'expected uploadType=resumable' });
      if (req.headers['x-upload-content-length'] === undefined) return send(400, { error: 'missing X-Upload-Content-Length' });
      if (req.headers['x-upload-content-type'] === undefined) return send(400, { error: 'missing X-Upload-Content-Type' });
      const origin = offOriginSession ? 'http://127.0.0.2:9' : `http://127.0.0.1:${server.address().port}`;
      return send(200, {}, { location: `${origin}/upload-session/1` });
    }
    if (req.method === 'PUT' && path === '/upload-session/1') {
      const bytes = await body(req);
      const real = createHash('sha256').update(bytes).digest('hex');
      const out = { versionCode: VERSION_CODE, sha1: 'deadbeef' };
      if (!omitSha256) out.sha256 = sha256Override ?? real;
      return send(200, out);
    }
    if (req.method === 'PUT' && path.startsWith(`${editsRoot}/${EDIT_ID}/tracks/`)) {
      if (failAt === 'tracks.update') return send(400, { error: { message: 'track refused' } });
      const sent = JSON.parse((await body(req)).toString());
      bodies.push({ what: 'track', body: sent });
      return send(200, sent);
    }
    if (req.method === 'POST' && path === `${editsRoot}/${EDIT_ID}:validate`) {
      if (failAt === 'validate') return send(400, { error: { message: 'validation failed: listing incomplete' } });
      return send(200, { id: EDIT_ID });
    }
    if (req.method === 'POST' && path === `${editsRoot}/${EDIT_ID}:commit`) {
      if (failAt === 'commit') return send(409, { error: { message: 'changes are already in review' } });
      return send(200, { id: EDIT_ID });
    }
    if (req.method === 'DELETE' && path === `${editsRoot}/${EDIT_ID}`) {
      if (failDelete) return send(500, { error: { message: 'could not delete' } });
      return send(204, null);
    }
    return send(404, { error: { message: `no handler for ${req.method} ${path}` } });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, calls, bodies, state, close: () => new Promise((r) => server.close(r)) };
}

/** Everything a passing `--submit` needs, minus whatever a case overrides. */
const submitEnv = (origin, over = {}) => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'globalonlinedeveloper/Project_Cross_Platform_Apps',
  GITHUB_TOKEN: 'ghs-test',
  GITHUB_API_URL: origin,
  PLAY_API_BASE_URL: origin,
  PLAY_OAUTH_TOKEN_URL: `${origin}/token`,
  ANDROID_SIGNING_POSTURE: 'release-signed',
  ANDROID_KEYSTORE_PATH: 'x.jks',
  ANDROID_KEYSTORE_PASSWORD: SECRET,
  ANDROID_KEY_ALIAS: 'nikatru-upload',
  ANDROID_KEY_PASSWORD: SECRET,
  PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
    type: 'service_account',
    client_email: 'nikatru-free-api@nikatru-platform.iam.gserviceaccount.com',
    private_key: KEYS.privateKey,
  }),
  ...over,
});

const SUBMIT_ARGS = ['--submit', '--app', 'subscriptiontracker', '--confirm', CONFIRM];

/** Start the server, run the script against it, always close. */
async function submit(treeOpts = { withArtifact: true }, { apiOpts = {}, args = SUBMIT_ARGS, env = {} } = {}) {
  const srv = await api(apiOpts);
  try {
    return { ...(await runAsync(tree(treeOpts), { args, env: submitEnv(srv.origin, env) })), calls: srv.calls, bodies: srv.bodies, state: srv.state };
  } finally {
    await srv.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
describe('submit-play — the submission path is walkable', () => {
  // ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b): --app is required; there is no first-app default.
  test('--app is REQUIRED: a dry run without it is COVERAGE LOST (2), never the first app', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--repo-root', REPO], { encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 2, out);
    assert.match(out, /COVERAGE LOST — --app is required: submit-play submits ONE app/);
  });
  test('DRY RUN passes on a complete tree and says nothing was sent', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN OK — nothing was sent to Google/);
    assert.match(out, /metadata tree apps\/subscriptiontracker\/store\/android-play — 8 field\(s\) present and non-empty, 3 within a SOURCED Play limit/);
  });

  test('names the runbook the console-only steps live in', () => {
    const { out } = run(tree());
    assert.match(out, /Private\/runbooks\/store-submission-android\.md/);
  });

  // 🔴 THIS CASE USED TO ASSERT THE OPPOSITE, AND THAT IS THE POINT OF KEEPING IT.
  // It read: "the DRY RUN prints the 12-tester / 14-day gate even when everything
  // passes", on the reasoning that "a gap nobody sees becomes permanent". The
  // reasoning was right and the FACT was wrong: Google scopes that rule to
  // "personal accounts created after November 13, 2023" and NIKATRU is a verified
  // Organization account, so the script was printing a 14-day blocker that never
  // applied to it. A test that pins a stale fact keeps the fact alive.
  test('the DRY RUN states the 12-tester / 14-day rule does NOT gate this account', () => {
    const { out } = run(tree());
    assert.match(out, /12-tester \/ 14-continuous-day closed test does NOT gate this account/);
    assert.match(out, /ORGANIZATION account/);
  });

  test('the DRY RUN still names what IS outstanding — served:false and no D-9 record', () => {
    const { out } = run(tree());
    assert.match(out, /served: false/);
    assert.match(out, /\[10\]D-9 has no/);
  });

  test('refuses when neither --dry-run nor --submit is given', () => {
    const { code, out } = run(tree(), { args: ['--app', 'subscriptiontracker'] });
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run, --submit and --sync-listing is required/);
  });

  test('release notes over Play\'s 500-character limit FAIL the dry run', () => {
    const { code, out } = run(tree({ releaseNotes: `after-version-code: 0\n${'x'.repeat(501)}` }));
    assert.equal(code, 1, out);
    assert.match(out, /release-notes\.txt is 501 characters; Play caps release notes at 500/);
  });

  test('an EMPTY release-notes.txt FAILS rather than sending a blank', () => {
    const { code, out } = run(tree({ releaseNotes: 'after-version-code: 0\n  \n' }));
    assert.equal(code, 1, out);
    assert.match(out, /release-notes\.txt carries a header and no notes/);
  });

  // ⏱ 2026-10-01 (#1099 review, nit b): the notes say which release they are for.
  test('release notes with no after-version-code header FAIL — notes must name their release', () => {
    const { code, out } = run(tree({ releaseNotes: 'First release.\n' }));
    assert.equal(code, 1, out);
    assert.match(out, /does not open with "after-version-code: <N>"/);
  });

  const consumedAt = (n) => (r) => {
    r.channels[0].versionCodeHighWater = { consumed: { subscriptiontracker: { value: n } } };
  };

  test('STALE notes (written for an earlier release) only PRINT in the push-CI dry run with no bundle', () => {
    const { code, out } = run(tree({ releaseNotes: 'after-version-code: 1\nFirst release.\n', mutateRegister: consumedAt(6) }));
    assert.equal(code, 0, out);
    assert.match(out, /STALE RELEASE NOTES — .* after versionCode 1, and Play has consumed up to 6/);
  });

  test('STALE notes FAIL the lane dry run that holds a bundle — release 2 never re-ships release 1 notes', () => {
    const { code, out } = run(tree({ withArtifact: true, releaseNotes: 'after-version-code: 1\nFirst release.\n', mutateRegister: consumedAt(6) }), {
      args: ['--dry-run', '--app', 'subscriptiontracker'],
    });
    assert.equal(code, 1, out);
    assert.match(out, /FAIL STALE RELEASE NOTES/);
  });

  test('notes written for THIS release (header = the consumed mark) pass', () => {
    const { code, out } = run(tree({ releaseNotes: 'after-version-code: 6\nSecond release.\n', mutateRegister: consumedAt(6) }));
    assert.equal(code, 0, out);
    assert.match(out, /release notes .* for the release after versionCode 6/);
  });

  test('refuses when BOTH modes are given', () => {
    const { code, out } = run(tree(), { args: ['--dry-run', '--submit', '--app', 'subscriptiontracker'] });
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run, --submit and --sync-listing is required/);
  });

  // ── the listing ───────────────────────────────────────────────────────────
  test('FAILS when the metadata tree does not exist', () => {
    const { code, out } = run(tree({ omitTree: true }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /the store metadata tree apps\/subscriptiontracker\/store\/android-play does not exist/);
  });

  test('FAILS on a missing listing field', () => {
    const { code, out } = run(tree({ omitFiles: ['long-description.txt'] }));
    assert.equal(code, 1, out);
    assert.match(out, /long-description\.txt is missing/);
  });

  test('FAILS on an emptied listing field', () => {
    const { code, out } = run(tree({ fields: { 'category.txt': '  \n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /category\.txt is EMPTY/);
  });

  test('FAILS on a privacy-policy URL that is not a single absolute https URL', () => {
    const { code, out } = run(tree({ fields: { 'privacy-policy-url.txt': '/privacy.html\n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /is not a single absolute https URL/);
  });

  test('FAILS on an app name over Play’s sourced 30-character cap', () => {
    const { code, out } = run(tree({ fields: { 'title.txt': `${'A'.repeat(31)}\n` } }));
    assert.equal(code, 1, out);
    assert.match(out, /title\.txt is 31 characters; Play caps this field at 30/);
  });

  test('FAILS on a limit declared with no source rather than enforcing it', () => {
    const { code, out } = run(
      tree({ mutateRegister: (r) => { delete r.storeMetadataContract.perChannel['android-play'].maxChars['title.txt'].source; } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /maxChars\["title\.txt"\] for "android-play" declares max 30 with no `source`/);
  });

  test('COVERAGE LOST when requiredFiles is emptied', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => { r.storeMetadataContract.requiredFiles = []; } }));
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register declares no android-play row', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => { r.channels = []; } }));
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /declares no "android-play" channel/);
  });

  test('FAILS when the channel stops being submittable', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => { r.channels[0].submittable = false; } }));
    assert.equal(code, 1, out);
    assert.match(out, /is not marked `submittable`/);
  });

  // ── the package name: immutable after the first upload ────────────────────
  test('FAILS when applicationId is not the canonical com.nikatru.<app_id>', () => {
    const { code, out } = run(tree({ gradleOver: { appId: 'com.example.subscriptiontracker' } }));
    assert.equal(code, 1, out);
    assert.match(out, /Play binds the package name at the FIRST upload/);
  });

  test('COVERAGE LOST when the gradle file declares no applicationId at all', () => {
    const { code, out } = run(tree({ gradleOver: { appId: null } }));
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /declares no `applicationId`/);
  });

  test('FAILS when the gradle file is gone entirely', () => {
    const { code, out } = run(tree({ omitGradle: true }));
    assert.equal(code, 1, out);
    assert.match(out, /build\.gradle\.kts does not exist/);
  });

  // ── the signing posture ───────────────────────────────────────────────────
  // 🔴 The env var names are PARSED OUT OF THE GRADLE FILE, so deleting the
  // signing block is COVERAGE LOST rather than a silent "no keystore".
  test('COVERAGE LOST when the release-signing env map is removed from gradle', () => {
    const { code, out } = run(tree({ gradleOver: { envMap: false } }));
    assert.equal(code, 2, out); // COVERAGE LOST exits 2 since submit-common.mjs (2026-09-25); 1 is a finding
    assert.match(out, /declares no release-signing environment map/);
  });

  test('FAILS when the recorded debug fallback is removed', () => {
    const { code, out } = run(tree({ gradleOver: { debugFallback: false } }));
    assert.equal(code, 1, out);
    assert.match(out, /no longer names the debug signing config as the fallback/);
  });

  test('PRINTS the debug-fallback posture when no keystore is supplied', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /SIGNING POSTURE: DEBUG FALLBACK/);
    assert.match(out, /A debug-signed \.aab CANNOT be uploaded to Play/);
  });

  // The one state that must never fall back quietly: a debug-signed artifact
  // out of a run that looked like a signing run.
  test('FAILS when signing is HALF configured', () => {
    const { code, out } = run(tree(), { env: { ANDROID_KEYSTORE_PATH: 'x.jks', ANDROID_KEY_ALIAS: 'upload' } });
    assert.equal(code, 1, out);
    assert.match(out, /signing is HALF configured — 2 of 4/);
  });

  test('accepts a fully supplied keystore and never echoes a value', () => {
    const { code, out } = run(tree(), {
      env: {
        ANDROID_KEYSTORE_PATH: 'x.jks',
        ANDROID_KEYSTORE_PASSWORD: SECRET,
        ANDROID_KEY_ALIAS: 'upload',
        ANDROID_KEY_PASSWORD: SECRET,
      },
    });
    assert.equal(code, 0, out);
    assert.match(out, /signing posture — all 4 keystore variable\(s\) supplied/);
    assert.doesNotMatch(out, new RegExp(SECRET), 'the script printed a keystore password');
  });

  test('PRINTS that key.properties takes precedence, and never reads it', () => {
    const { code, out } = run(tree({ withKeyProperties: true }));
    assert.equal(code, 0, out);
    assert.match(out, /key\.properties is present/);
  });

  // ── the artifact ──────────────────────────────────────────────────────────
  test('FAILS when the .aab is absent and --allow-missing-artifact was NOT passed', () => {
    const { code, out } = run(tree(), { args: ['--dry-run', '--app', 'subscriptiontracker'] });
    assert.equal(code, 1, out);
    assert.match(out, /app-release\.aab does not exist/);
  });

  test('validates a real .aab when one is on disk', () => {
    const { code, out } = run(tree({ withArtifact: true }), { args: ['--dry-run', '--app', 'subscriptiontracker'] });
    assert.equal(code, 0, out);
    assert.match(out, /artifact apps\/subscriptiontracker\/build\/app\/outputs\/bundle\/release\/app-release\.aab/);
  });

  test('FAILS on a zero-byte .aab — it uploads and costs a version code', () => {
    const { code, out } = run(tree({ withArtifact: true, artifactBytes: 0 }), { args: ['--dry-run', '--app', 'subscriptiontracker'] });
    assert.equal(code, 1, out);
    assert.match(out, /is ZERO bytes/);
  });

  test('FAILS when the build output format is not one the channel accepts', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => { r.channels[0].artifactFormats = ['.apk']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /matches none of the formats channel "android-play" accepts/);
  });

  // ── the service account ───────────────────────────────────────────────────
  test('PRINTS which credential is absent, and does not fail', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /SERVICE ACCOUNT NOT CONFIGURED — PLAY_SERVICE_ACCOUNT_JSON is absent/);
  });

  test('accepts a well-formed service-account key without printing it', () => {
    const { code, out } = run(tree(), {
      env: { PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'a@b.iam.gserviceaccount.com', private_key: SECRET }) },
    });
    assert.equal(code, 0, out);
    assert.match(out, /service account — PLAY_SERVICE_ACCOUNT_JSON parses/);
    assert.doesNotMatch(out, new RegExp(SECRET), 'the script printed the private key');
  });

  // A truncated or badly-pasted secret otherwise surfaces mid-submission,
  // against a live account.
  test('FAILS on a malformed service-account secret WITHOUT echoing it', () => {
    const { code, out } = run(tree(), { env: { PLAY_SERVICE_ACCOUNT_JSON: `{"private_key":"${SECRET}` } });
    assert.equal(code, 1, out);
    assert.match(out, /is set but is not valid JSON/);
    assert.doesNotMatch(out, new RegExp(SECRET), 'the script echoed the malformed secret');
  });

  test('FAILS when a required service-account field is missing, naming only the KEY', () => {
    const { code, out } = run(tree(), {
      env: { PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', private_key: SECRET }) },
    });
    assert.equal(code, 1, out);
    assert.match(out, /is missing client_email/);
    assert.doesNotMatch(out, new RegExp(SECRET), 'the script printed the private key');
  });

  test('FAILS on an OAuth client secret handed in place of a service-account key', () => {
    const { code, out } = run(tree(), {
      env: { PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'authorized_user', client_email: 'a@b.c', private_key: SECRET }) },
    });
    assert.equal(code, 1, out);
    assert.match(out, /needs a service-account key/);
    assert.doesNotMatch(out, new RegExp(SECRET));
  });

  // 🔴 NOT an allowlist, on purpose: Play supports CUSTOM closed-test track
  // names, so validating against internal/alpha/beta/production would reject
  // correct input — the exact failure mode the D-5 limits table exists to stop.
  test('does NOT validate the track against a vocabulary', () => {
    const { code, out } = run(tree(), { env: { PLAY_TRACK: 'nikatru-closed-2026' } });
    assert.equal(code, 0, out);
    assert.match(out, /Play allows custom closed-test track names/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE PUBLISH GATE — every limb must be able to refuse. [ADR 031:117-124]
// ═════════════════════════════════════════════════════════════════════════════
describe('submit-play — the publish gate refuses', () => {
  const gated = { withArtifact: true };

  test('PG-1 · --submit with NO --confirm refuses, and names the dispatch input', () => {
    const { code, out } = run(tree(gated), { args: ['--submit', '--app', 'subscriptiontracker'] });
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /--submit requires --confirm SUBMIT-TO-PLAY/);
    assert.match(out, /submit-play\.yml passes it through from the `confirm` dispatch input/);
  });

  test('PG-1 · a NEARLY-right confirmation refuses too', () => {
    const { code, out } = run(tree(gated), { args: ['--submit', '--app', 'subscriptiontracker', '--confirm', 'submit-to-play'] });
    assert.equal(code, 1, out);
    assert.match(out, /--submit requires --confirm SUBMIT-TO-PLAY; got "submit-to-play"/);
  });

  test('PG-1 · the gate fires BEFORE any validation runs', () => {
    const { out } = run(tree(gated), { args: ['--submit', '--app', 'subscriptiontracker'] });
    assert.doesNotMatch(out, /^ok   metadata tree/m, out);
  });

  test('PG-2 · --submit refuses --allow-missing-artifact', () => {
    const { code, out } = run(tree(gated), {
      args: [...SUBMIT_ARGS, '--allow-missing-artifact'],
      env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r' },
    });
    assert.equal(code, 1, out);
    assert.match(out, /--allow-missing-artifact is a DRY-RUN flag and --submit refuses it/);
  });

  // 🔴 THE GATE ONLY EXISTS INSIDE GITHUB ACTIONS, so a submission anywhere else
  // has by construction not passed it.
  test('PG-3 · --submit refuses outside GitHub Actions', () => {
    const { code, out } = run(tree(gated), { args: SUBMIT_ARGS });
    assert.equal(code, 1, out);
    assert.match(out, /--submit runs only inside GitHub Actions/);
    assert.match(out, /the publish gate is a GitHub environment/);
  });

  test('PG-4 · refuses when the submit job has lost its `environment:` line', async () => {
    const { code, out } = await submit({ ...gated, workflow: { environment: false } });
    assert.equal(code, 1, out);
    assert.match(out, /runs `--submit` and declares no `environment:`/);
  });

  test('PG-4 · refuses when the lane no longer reads the .aab signature', async () => {
    const { code, out } = await submit({ ...gated, workflow: { signature: false } });
    assert.equal(code, 1, out);
    assert.match(out, /uploads a bundle and never runs assert-artifact-signed\.mjs/);
    assert.match(out, /Play accepts a given upload key\s+EXACTLY ONCE/);
  });

  test('PG-4 · refuses when the signature check moved AFTER the upload', async () => {
    const { code, out } = await submit({ ...gated, workflow: { signatureAfter: true } });
    assert.equal(code, 1, out);
    assert.match(out, /AFTER the/);
    assert.match(out, /A signature checked after the upload is a post-mortem/);
  });

  test('PG-4 · refuses when the submission workflow is gone', async () => {
    const { code, out } = await submit({ ...gated, omitWorkflow: true });
    assert.equal(code, 1, out);
    assert.match(out, /submission workflow .* does not exist/);
  });

  // 🔴 THE CASE THAT JUSTIFIES PG-5 EXISTING AT ALL. GitHub documents that a
  // workflow naming a missing environment CREATES it, with no protection rules,
  // and runs. `environment:` alone therefore fails OPEN.
  test('PG-5 · refuses when the store-publish environment does not exist', async () => {
    const { code, out } = await submit(gated, { apiOpts: { environmentExists: false } });
    assert.equal(code, 1, out);
    assert.match(out, /the "store-publish" environment does not exist/);
    assert.match(out, /referencing a missing environment CREATES it/);
  });

  test('PG-5 · refuses an environment with NO protection rules (the auto-created state)', async () => {
    const { code, out } = await submit(gated, { apiOpts: { protectionRules: [] } });
    assert.equal(code, 1, out);
    assert.match(out, /carries NO required reviewer/);
    assert.match(out, /protection_rules = \[\]/);
  });

  test('PG-5 · refuses a wait-timer-only environment — a delay is not an approval', async () => {
    const { code, out } = await submit(gated, { apiOpts: { protectionRules: [{ id: 9, type: 'wait_timer', wait_timer: 30 }] } });
    assert.equal(code, 1, out);
    assert.match(out, /carries NO required reviewer/);
  });

  test('PG-5 · refuses when GITHUB_TOKEN is absent — an unreadable gate is not a gate', async () => {
    const { code, out } = await submit(gated, { env: { GITHUB_TOKEN: '' } });
    assert.equal(code, 1, out);
    assert.match(out, /needs GITHUB_TOKEN to read the publish environment/);
  });

  // ── PG-5b · the environment's own deployment branch policy ────────────────
  // 🔴 EVERY CASE ABOVE LANDS ON THIS LIMB'S FIRST ARM. The fake GitHub returned
  // no `deployment_branch_policy` field, `refPolicy === undefined` is an `ok()`,
  // and so the entire decision tree below could be deleted with this file green
  // — measured 2026-08-27 by deleting it from a scratch copy of the script.
  // These cases give the environment a policy so the tree is actually walked.
  const ENV_GET = 'GET /repos/globalonlinedeveloper/Project_Cross_Platform_Apps/environments/store-publish';
  const POL_GET = `${ENV_GET}/deployment-branch-policies`;
  const CUSTOM = { protected_branches: false, custom_branch_policies: true };
  const MAIN_ROW = [{ name: 'main', type: 'branch' }];

  // 🔴 MEASURED 2026-08-27, BOTH PLATFORMS, BECAUSE THEY DISAGREE. PG-5b is the
  // only limb that refuses with TWO GitHub sockets still open, and `die()`
  // (tooling/release/submit-play.mjs:222) forces `process.exit(1)` rather than
  // setting `process.exitCode`. On Ubuntu (WSL2, node v22.22.1) that exits 1. On
  // this Windows host it prints the identical FAIL and then aborts inside libuv —
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c:94"
  // — and the child reports 0xC0000409 = 3221226505. CI is Linux, so the lane
  // sees 1; a developer on Windows sees the abort.
  // This maps ONLY that one value on ONLY win32. Every other code, including the
  // 0 a deleted limb produces, still fails the assertion.
  const WIN_LIBUV_ABORT = 3221226505;
  const refusalCode = (code) => (process.platform === 'win32' && code === WIN_LIBUV_ABORT ? 1 : code);

  // 🔴 THE REFUSAL, WITH ROWS OF THE REF'S OWN KIND PRESENT. Stated separately
  // from the tag case below because that one refuses over an EMPTY row list,
  // where `[].every(…)` is vacuously true — a refusal that fires only through an
  // empty list has not been shown to compare anything.
  test('PG-5b · refuses a branch the policy does not name, before one byte reaches Google', async () => {
    const { code, out, calls } = await submit(gated, {
      apiOpts: { deploymentBranchPolicy: CUSTOM, branchPolicyRows: MAIN_ROW },
      env: { GITHUB_REF: 'refs/heads/hotfix/rush' },
    });
    assert.equal(refusalCode(code), 1, out);
    assertComplained(out);
    assert.match(out, /is not named by "store-publish"'s own deployment branch policy/, out);
    assert.match(out, /No row of type "branch" names "hotfix\/rush" \(rows of that type: 1\)/, out);
    // Nothing after the two gate reads. A refusal that still uploaded would be a
    // receipt, not a gate.
    assert.deepEqual(calls, [ENV_GET, POL_GET]);
  });

  test('PG-5b · refuses a TAG against a policy whose only row is a BRANCH', async () => {
    const { code, out, calls } = await submit(gated, {
      apiOpts: { deploymentBranchPolicy: CUSTOM, branchPolicyRows: MAIN_ROW },
      env: { GITHUB_REF: 'refs/tags/v1.2.3' },
    });
    assert.equal(refusalCode(code), 1, out);
    assert.match(out, /No row of type "tag" names "v1\.2\.3" \(rows of that type: 0\)/, out);
    assert.deepEqual(calls, [ENV_GET, POL_GET]);
  });

  // 🔴 THE PERMIT ARM, AND WHY IT IS NOT JUST `code === 0`. Six of PG-5b's arms
  // exit 0 and print "PG-5b deployment branch policy —", so a case asserting the
  // exit code and that prefix passes on every one of them, including NOT DECIDED
  // and including the limb's total absence. Pinned instead: the permit sentence,
  // the absence of NOT DECIDED, and that the SECOND GET was made and was made
  // BEFORE the token — a policy consulted after the upload decides nothing.
  test('PG-5b · permits the branch the policy names, and reads the rows before minting a token', async () => {
    const { code, out, calls } = await submit(
      { withArtifact: true, artifactBytes: 5000 },
      {
        apiOpts: { deploymentBranchPolicy: CUSTOM, branchPolicyRows: MAIN_ROW },
        env: { GITHUB_REF: 'refs/heads/main' },
      },
    );
    assert.equal(code, 0, out);
    assert.match(out, /PG-5b deployment branch policy — "refs\/heads\/main" is named by "store-publish"'s policy/, out);
    assert.doesNotMatch(out, /PG-5b deployment branch policy — NOT DECIDED/, out);
    assert.deepEqual(calls.slice(0, 3), [ENV_GET, POL_GET, 'POST /token']);
  });

  // A row's `name` may be a glob and the script has no sourced model of that
  // matcher, so it prints what it read and declines to decide. NOT DECIDED must
  // never be reported as permitted, which is what the second assertion pins.
  test('PG-5b · a wildcard row is NOT DECIDED rather than refused or permitted', async () => {
    const { code, out } = await submit(
      { withArtifact: true, artifactBytes: 5000 },
      {
        apiOpts: { deploymentBranchPolicy: CUSTOM, branchPolicyRows: [{ name: 'release/*', type: 'branch' }] },
        env: { GITHUB_REF: 'refs/heads/main' },
      },
    );
    assert.equal(code, 0, out);
    assert.match(out, /NOT DECIDED: a row of type "branch" is not a literal name/, out);
    assert.doesNotMatch(out, /is named by "store-publish"'s policy/, out);
  });

  // `null` and a MISSING field mean opposite things and the script prints them
  // differently on purpose: null is "no policy, everything may deploy"; missing
  // is "this response is not the shape expected".
  test('PG-5b · a null policy permits every ref and costs no second GET', async () => {
    const { code, out, calls } = await submit(
      { withArtifact: true, artifactBytes: 5000 },
      { apiOpts: { deploymentBranchPolicy: null }, env: { GITHUB_REF: 'refs/heads/anything' } },
    );
    assert.equal(code, 0, out);
    assert.match(out, /has none, so every branch and tag may deploy/, out);
    assert.match(out, /deployment_branch_policy = null/, out);
    assert.ok(!calls.includes(POL_GET), calls.join('\n'));
  });

  test('PG-5b · an ABSENT policy field is NOT DECIDED and says the field was absent', async () => {
    const { code, out, calls } = await submit(
      { withArtifact: true, artifactBytes: 5000 },
      { env: { GITHUB_REF: 'refs/heads/main' } },
    );
    assert.equal(code, 0, out);
    assert.match(out, /NOT DECIDED: this response carried no `deployment_branch_policy` field at all/, out);
    assert.match(out, /deployment_branch_policy = undefined/, out);
    assert.ok(!calls.includes(POL_GET), calls.join('\n'));
  });

  test('PG-5b · a protected-branch policy is NOT DECIDED — that is a different endpoint', async () => {
    const { code, out, calls } = await submit(
      { withArtifact: true, artifactBytes: 5000 },
      {
        apiOpts: { deploymentBranchPolicy: { protected_branches: true, custom_branch_policies: false } },
        env: { GITHUB_REF: 'refs/heads/main' },
      },
    );
    assert.equal(code, 0, out);
    assert.match(out, /NOT DECIDED: the policy is by PROTECTED BRANCH/, out);
    assert.ok(!calls.includes(POL_GET), calls.join('\n'));
  });

  test('PG-5b · a policy shape naming neither mode is NOT DECIDED', async () => {
    const { code, out } = await submit(
      { withArtifact: true, artifactBytes: 5000 },
      {
        apiOpts: { deploymentBranchPolicy: { protected_branches: false, custom_branch_policies: false } },
        env: { GITHUB_REF: 'refs/heads/main' },
      },
    );
    assert.equal(code, 0, out);
    assert.match(out, /NOT DECIDED: the policy names neither protected branches nor a custom list/, out);
  });

  // 🔴 A ROW LIST THAT COULD NOT BE READ IS NOT AN EMPTY ROW LIST. An empty list
  // would refuse every ref; "could not read" must not, and must not permit either.
  test('PG-5b · an unreadable branch-policies response is NOT DECIDED, not a refusal', async () => {
    const { code, out, calls } = await submit(
      { withArtifact: true, artifactBytes: 5000 },
      {
        apiOpts: { deploymentBranchPolicy: CUSTOM, branchPoliciesStatus: 500 },
        env: { GITHUB_REF: 'refs/heads/main' },
      },
    );
    assert.equal(code, 0, out);
    assert.match(out, /NOT DECIDED: .*deployment-branch-policies returned no readable `branch_policies` list/, out);
    assert.ok(calls.includes(POL_GET), calls.join('\n'));
  });

  test('PG-5b · a ref that is neither a branch nor a tag is NOT DECIDED', async () => {
    const { code, out } = await submit(
      { withArtifact: true, artifactBytes: 5000 },
      {
        apiOpts: { deploymentBranchPolicy: CUSTOM, branchPolicyRows: MAIN_ROW },
        env: { GITHUB_REF: 'refs/pull/7/merge' },
      },
    );
    assert.equal(code, 0, out);
    assert.match(out, /NOT DECIDED: GITHUB_REF is neither a `refs\/heads\/` nor a `refs\/tags\/` ref/, out);
  });

  test('PG-6 · refuses the production track — ADR 031 class A', async () => {
    const { code, out } = await submit(gated, { args: [...SUBMIT_ARGS, '--track', 'production'] });
    assert.equal(code, 1, out);
    assert.match(out, /refuses the production track/);
    assert.match(out, /class A/);
  });

  // Google's own tracks page documents form-factor prefixes producing
  // "wear:production" — so a production track is not only the bare string.
  test('PG-6 · refuses a form-factor production track (wear:production)', async () => {
    const { code, out } = await submit(gated, { args: [...SUBMIT_ARGS, '--track', 'wear:production'] });
    assert.equal(code, 1, out);
    assert.match(out, /refuses the production track/);
  });

  test('PG-6 · refuses the production track with status completed, said explicitly', async () => {
    const { code, out } = await submit(gated, { args: [...SUBMIT_ARGS, '--track', 'production', '--status', 'completed'] });
    assert.equal(code, 1, out);
    assert.match(out, /refuses the production track \("production"\) with status "completed"/);
  });

  // ⏱ 2026-10-01 (#1099 review, nit c): the post-discovery production check is DEFENCE IN DEPTH —
  // PG-6 always fires first, so no input reaches it in the real script. It is tested the only honest
  // way: a copy of the script with PG-6 switched off must still refuse a non-draft production track,
  // before any upload. The rewrites are counted, so a script that changes shape fails here loudly.
  test('the post-discovery production check refuses on its OWN — PG-6 switched off in a copy', async () => {
    const ci = pathToFileURL(join(REPO, 'tooling', 'ci')).href + '/';
    const rel = pathToFileURL(join(REPO, 'tooling', 'release')).href + '/';
    const store = pathToFileURL(join(REPO, 'tooling', 'store')).href + '/';
    const swaps = [
      ["from '../ci/read-identity.mjs'", `from '${ci}read-identity.mjs'`],
      ["from '../ci/workflow-scan.mjs'", `from '${ci}workflow-scan.mjs'`],
      ["from './submit-common.mjs'", `from '${rel}submit-common.mjs'`],
      ["from '../store/listing-locales.mjs'", `from '${store}listing-locales.mjs'`],
      ["join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'assert-submission-safety.mjs')", JSON.stringify(join(REPO, 'tooling', 'ci', 'assert-submission-safety.mjs'))],
      ["if (isProductionTrack(requestedTrack) && releaseStatus !== 'draft') {", 'if (false) {'],
    ];
    let src = readFileSync(SCRIPT, 'utf8');
    for (const [from, to] of swaps) {
      assert.equal(src.split(from).length - 1, 1, `the copy needs exactly one ${from}`);
      src = src.replace(from, to);
    }
    const copy = join(TMP, `pg6-off-${seq++}.mjs`);
    writeFileSync(copy, src);
    const srv = await api({});
    try {
      const out = await new Promise((res) => {
        const p = spawn(process.execPath, [copy, ...SUBMIT_ARGS, '--track', 'production', '--repo-root', tree(gated)], {
          env: cleanEnv(submitEnv(srv.origin)),
        });
        let o = '';
        p.stdout.on('data', (d) => { o += d; });
        p.stderr.on('data', (d) => { o += d; });
        p.on('close', (code) => res({ code, o }));
      });
      assert.equal(out.code, 1, out.o);
      assert.doesNotMatch(out.o, /refuses the production track/, 'green control: PG-6 really is off in the copy');
      assert.match(out.o, /resolved track "production" is a production track\. \[ADR 031\] class A/);
      assert.equal(srv.calls.some((c) => c.includes('/bundles')), false, srv.calls.join('\n'));
    } finally {
      await srv.close();
    }
  });

  test('PG-6 · refuses a staged-rollout status — there is no userFraction flag at all', async () => {
    const { code, out } = await submit(gated, { args: [...SUBMIT_ARGS, '--status', 'inProgress'] });
    assert.equal(code, 1, out);
    assert.match(out, /--status "inProgress" is not one of draft, completed/);
    assert.match(out, /staged rollout percentage/);
  });

  // 🔴 THE TEST SEAM MUST NOT BE AN EXFILTRATION PATH. The process holds a
  // service-account private key and a signed release bundle; an unconstrained
  // base-URL override would send both anywhere one environment variable said.
  test('the loopback-only override refuses a non-loopback host', async () => {
    const { code, out } = await submit(gated, { env: { PLAY_API_BASE_URL: 'https://evil.example.com' } });
    assert.equal(code, 1, out);
    assert.match(out, /PLAY_API_BASE_URL points at https:\/\/evil\.example\.com, which is neither/);
    assert.match(out, /Loopback or the real value/);
  });

  test('--submit FAILS on a debug-signed posture rather than uploading a build proof', async () => {
    const { code, out } = await submit(gated, { env: { ANDROID_SIGNING_POSTURE: 'debug-signed-build-proof' } });
    assert.equal(code, 1, out);
    assert.match(out, /ANDROID_SIGNING_POSTURE is "debug-signed-build-proof" and --submit requires "release-signed"/);
  });

  test('--submit FAILS when the posture was never exported at all', async () => {
    const { code, out } = await submit(gated, { env: { ANDROID_SIGNING_POSTURE: '' } });
    assert.equal(code, 1, out);
    assert.match(out, /ANDROID_SIGNING_POSTURE is ""/);
  });

  // The dry run PRINTS an absent credential; a submission cannot authenticate
  // without one, so the same input is a hard stop here.
  test('--submit FAILS when the service account is absent (the dry run only prints)', async () => {
    const { code, out } = await submit(gated, { env: { PLAY_SERVICE_ACCOUNT_JSON: '' } });
    assert.equal(code, 1, out);
    assert.match(out, /--submit cannot mint an access token without it/);
  });

  test('--submit FAILS when the .aab is not on disk', async () => {
    const { code, out } = await submit({ withArtifact: false });
    assert.equal(code, 1, out);
    assert.match(out, /app-release\.aab does not exist/);
  });

  // ── the gate is read out of the REAL workflow, not only a fixture ──────────
  // 🔴 CLAUDE.md: "A fixture passing is not a guard working — MUTATE THE REAL
  // TREE", because a fixture encodes the same misunderstanding as the code. Every
  // PG-4 case above runs against YAML this file wrote. This one runs the PG-4
  // parse against .github/workflows/submit-play.yml as it actually is, so a real
  // edit that drops `environment:` or reorders the signature step is caught by
  // this suite and not only by a dispatch nobody runs.
  test('PG-4 reads the REAL .github/workflows/submit-play.yml and finds a gated submit job', async () => {
    const { parseWorkflow } = await import('../workflow-scan.mjs');
    const wf = parseWorkflow(REPO, '.github/workflows/submit-play.yml');
    assert.ok(wf, 'the real submission workflow is missing');
    const jobs = [...wf.jobs.values()].filter((j) => j.logical.some((l) => /submit-play\.mjs/.test(l.text) && /--submit\b/.test(l.text)));
    assert.equal(jobs.length, 1, 'exactly one job should run --submit');
    const job = jobs[0];
    assert.ok(job.lines.some((l) => /^ {4}environment: store-publish$/.test(l.text)), 'the submit job must declare environment: store-publish');
    const sub = job.logical.find((l) => /submit-play\.mjs/.test(l.text) && /--submit\b/.test(l.text));
    const sig = job.logical.find((l) => l.text.includes('assert-artifact-signed.mjs'));
    assert.ok(sig, 'the submit job must run assert-artifact-signed.mjs');
    assert.ok(sig.n < sub.n, `the signature check (line ${sig?.n}) must precede the upload (line ${sub?.n})`);
    assert.ok(job.needs.includes('dry-run'), 'the submit job must need the dry run');
    // Switch one: the dispatch input. Switch two is `environment:` above.
    assert.ok(job.jobIf && /inputs\.confirm == 'SUBMIT-TO-PLAY'/.test(job.jobIf.cond), `the submit job must be if-gated on the confirm input, got ${job.jobIf?.cond}`);
  });

  test('the REAL workflow never interpolates a dispatch input into a shell command', async () => {
    const { parseWorkflow } = await import('../workflow-scan.mjs');
    const wf = parseWorkflow(REPO, '.github/workflows/submit-play.yml');
    // Template injection: `${{ inputs.x }}` inside a `run:` is pasted in before
    // bash parses the line, so a crafted input becomes a command. Via `env:` it
    // stays data. zizmor says the same thing; this says it in the suite.
    for (const job of wf.jobs.values()) {
      for (const l of job.logical) {
        if (!/^\s*(-\s+)?run:/.test(l.text)) continue;
        assert.doesNotMatch(l.text, /\$\{\{\s*(inputs|github\.event\.inputs)\./, `${wf.rel}:${l.n} interpolates a dispatch input into a run: block`);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE EDIT LIFECYCLE — against a real HTTP server on loopback.
// ═════════════════════════════════════════════════════════════════════════════
describe('submit-play --submit — the Google Play Developer API edit lifecycle', () => {
  const gated = { withArtifact: true, artifactBytes: 5000 };

  test('walks insert → tracks.list → resumable upload → tracks.update → validate → commit', async () => {
    const { code, out, calls } = await submit(gated);
    assert.equal(code, 0, out);
    assert.match(out, /submit-play: SUBMITTED\./);
    assert.deepEqual(calls, [
      // 🔴 THE GATE READ IS FIRST, and pinning the ORDER is the point of using
      // deepEqual here rather than a set of `includes`. PG-5 must have answered
      // before one byte reaches Google — a gate consulted after the upload is a
      // receipt, not a control.
      'GET /repos/globalonlinedeveloper/Project_Cross_Platform_Apps/environments/store-publish',
      'POST /token',
      `POST /androidpublisher/v3/applications/${PACKAGE}/edits`,
      `GET /androidpublisher/v3/applications/${PACKAGE}/edits/${EDIT_ID}/tracks`,
      `POST /upload/androidpublisher/v3/applications/${PACKAGE}/edits/${EDIT_ID}/bundles`,
      'PUT /upload-session/1',
      `PUT /androidpublisher/v3/applications/${PACKAGE}/edits/${EDIT_ID}/tracks/internal`,
      `POST /androidpublisher/v3/applications/${PACKAGE}/edits/${EDIT_ID}:validate`,
      `POST /androidpublisher/v3/applications/${PACKAGE}/edits/${EDIT_ID}:commit`,
    ]);
    // The GitHub environment read happens before any of the above — PG-5 first,
    // token second. Its absence from `calls` would mean the gate was skipped.
    assert.match(out, /PG-5 publish gate — "store-publish" carries 1 required reviewer\(s\)/);
  });

  // The token endpoint verifies the RS256 signature with the matching public
  // key, checks `aud` is Google's literal, the scope string, and that the
  // assertion does not outlive the documented hour. Reaching COMMITTED means
  // every one of those held.
  test('the JWT assertion is really RS256-signed and carries the documented claims', async () => {
    const { code, out } = await submit(gated);
    assert.equal(code, 0, out);
    assert.match(out, /access token — the service-account assertion was accepted/);
  });

  test('never prints the bearer token, the assertion, or the private key', async () => {
    const { out } = await submit(gated);
    assert.doesNotMatch(out, new RegExp(TOKEN), 'the access token reached the log');
    assert.doesNotMatch(out, /BEGIN PRIVATE KEY/, 'the private key reached the log');
    assert.doesNotMatch(out, new RegExp(SECRET), 'a keystore password reached the log');
  });

  // 🔴 THE DEFAULT IS DISCOVERED, NOT DECLARED. Google's tracks page names the
  // internal testing track "qa"; the ecosystem uses "internal". The script ranks
  // both and takes whichever the API says this app HAS.
  test('with no --track it picks the LEAST-PUBLIC track the API offers', async () => {
    const { code, out } = await submit(gated);
    assert.equal(code, 0, out);
    assert.match(out, /track "internal" — the least-public track the API offers/);
  });

  test('…and picks "qa" when that is the name this account returns', async () => {
    const { code, out, calls } = await submit(gated, { apiOpts: { tracks: ['production', 'beta', 'alpha', 'qa'] } });
    assert.equal(code, 0, out);
    assert.match(out, /track "qa" — the least-public track the API offers/);
    assert.ok(calls.some((c) => c.endsWith('/tracks/qa')), calls.join('\n'));
  });

  test('…and never auto-selects production even when it is the only ranked track', async () => {
    const { code, out } = await submit(gated, { apiOpts: { tracks: ['production'] } });
    assert.equal(code, 1, out);
    assert.match(out, /no default track could be chosen/);
  });

  // Google publishes no ordering for custom closed-test names, so the script
  // refuses to invent one rather than guessing which is least public.
  test('refuses to auto-pick among CUSTOM closed-test track names', async () => {
    const { code, out } = await submit(gated, { apiOpts: { tracks: ['nikatru-closed-2026', 'friends-and-family'] } });
    assert.equal(code, 1, out);
    assert.match(out, /none of them is a name Google publishes an ordering for/);
    assert.match(out, /name one with --track/);
  });

  test('an explicit --track is used verbatim when the API confirms the app has it', async () => {
    const { code, out, calls } = await submit(gated, {
      apiOpts: { tracks: ['internal', 'nikatru-closed-2026'] },
      args: [...SUBMIT_ARGS, '--track', 'nikatru-closed-2026'],
    });
    assert.equal(code, 0, out);
    assert.match(out, /track "nikatru-closed-2026" — named explicitly/);
    assert.ok(calls.some((c) => c.endsWith('/tracks/nikatru-closed-2026')), calls.join('\n'));
  });

  test('a --track the app does not have is refused, and the real list is printed', async () => {
    const { code, out } = await submit(gated, { args: [...SUBMIT_ARGS, '--track', 'intrenal'] });
    assert.equal(code, 1, out);
    assert.match(out, /--track "intrenal" is not one of the tracks this app has/);
  });

  test('an empty tracks list is a permissions problem, not a track to invent', async () => {
    const { code, out } = await submit(gated, { apiOpts: { tracks: [] } });
    assert.equal(code, 1, out);
    assert.match(out, /returned ZERO tracks/);
  });

  // Bundle.sha256 is documented as "matching the output of the sha256sum
  // command", so the API hands back a checksum of what it received.
  test('the uploaded bundle is checksummed against the file on disk', async () => {
    const { code, out } = await submit(gated);
    assert.equal(code, 0, out);
    assert.match(out, /sha256 confirmed byte-for-byte/);
    assert.match(out, new RegExp(`versionCode ${VERSION_CODE}`));
  });

  test('a sha256 mismatch is a corrupted transfer and rolls the edit back', async () => {
    const { code, out, calls } = await submit(gated, { apiOpts: { sha256Override: 'f'.repeat(64) } });
    assert.equal(code, 1, out);
    assert.match(out, /The upload was corrupted in transit/);
    assert.ok(calls.includes(`DELETE /androidpublisher/v3/applications/${PACKAGE}/edits/${EDIT_ID}`), calls.join('\n'));
  });

  test('a missing sha256 is SAID to be unverified rather than assumed fine', async () => {
    const { code, out } = await submit(gated, { apiOpts: { omitSha256: true } });
    assert.equal(code, 0, out);
    assert.match(out, /the API returned no sha256 so the transfer is unverified/);
  });

  // 🔴 THE SESSION URI IS THE ONLY ATTACKER-INFLUENCEABLE URL IN THE LIFECYCLE,
  // and the very next request carries the whole bundle and the bearer token.
  test('an off-origin resumable session URI is refused before the bundle is sent', async () => {
    const { code, out, calls } = await submit(gated, { apiOpts: { offOriginSession: true } });
    assert.equal(code, 1, out);
    assert.match(out, /Refusing to send the bundle and the bearer token off-origin/);
    assert.ok(!calls.includes('PUT /upload-session/1'), calls.join('\n'));
  });

  // ── the rollback the retired refusal was afraid of not having ─────────────
  test('a failed COMMIT deletes the edit and says so', async () => {
    const { code, out, calls } = await submit(gated, { apiOpts: { failAt: 'commit' } });
    assert.equal(code, 1, out);
    assert.match(out, /HTTP 409/);
    assert.match(out, /ROLLED BACK — edit .* was DELETED/);
    assert.ok(calls.includes(`DELETE /androidpublisher/v3/applications/${PACKAGE}/edits/${EDIT_ID}`), calls.join('\n'));
  });

  test('a failed VALIDATE deletes the edit before anything is committed', async () => {
    const { code, out, calls } = await submit(gated, { apiOpts: { failAt: 'validate' } });
    assert.equal(code, 1, out);
    assert.match(out, /ROLLED BACK/);
    assert.ok(!calls.some((c) => c.endsWith(':commit')), calls.join('\n'));
  });

  test('a failed tracks.update deletes the edit', async () => {
    const { code, out, calls } = await submit(gated, { apiOpts: { failAt: 'tracks.update' } });
    assert.equal(code, 1, out);
    assert.match(out, /ROLLED BACK/);
    assert.ok(calls.includes(`DELETE /androidpublisher/v3/applications/${PACKAGE}/edits/${EDIT_ID}`), calls.join('\n'));
  });

  // A rollback that silently fails leaves the next run unable to open an edit,
  // so whether it happened is reported rather than assumed.
  test('a rollback that ITSELF fails is reported, not swallowed', async () => {
    const { code, out } = await submit(gated, { apiOpts: { failAt: 'commit', failDelete: true } });
    assert.equal(code, 1, out);
    assert.match(out, /ROLLBACK FAILED — edit .* could NOT be deleted/);
    assert.match(out, /single edit open at a/);
  });

  test('--status draft is passed through to the track release', async () => {
    const { code, out } = await submit(gated, { args: [...SUBMIT_ARGS, '--status', 'draft'] });
    assert.equal(code, 0, out);
    assert.match(out, /status draft/);
  });

  // ⏱ 2026-10-01: staging is not promoting. A DRAFT on production is not served to users, and
  // Play refuses any other status on a draft app — so this is the one way a first release is staged.
  test('PG-6 · STAGES a production release when --status is draft, and sends it as a draft', async () => {
    const { code, out, bodies } = await submit(gated, { args: [...SUBMIT_ARGS, '--track', 'production', '--status', 'draft'] });
    assert.equal(code, 0, out);
    const put = bodies.find((b) => b.what === 'track');
    assert.equal(put.body.track, 'production', out);
    assert.deepEqual(put.body.releases.map((r) => r.status), ['draft']);
    assert.match(out, /STAGED AS A DRAFT — uploaded, nothing sent for review/);
    assert.match(out, /record it as draft_staged, never in_review/);
    assert.doesNotMatch(out, /submit-play: SUBMITTED\./);
  });

  test('release notes: release-notes.txt rides on the release as its en-US notes', async () => {
    const { code, out, bodies } = await submit({ ...gated, releaseNotes: 'after-version-code: 0\nFirst release.\n' });
    assert.equal(code, 0, out);
    assert.deepEqual(bodies.find((b) => b.what === 'track').body.releases[0].releaseNotes, [{ language: 'en-US', text: 'First release.' }]);
  });

  test('release notes: STALE notes refuse --submit before any request', async () => {
    const { code, out, calls } = await submit({
      ...gated,
      releaseNotes: 'after-version-code: 1\nFirst release.\n',
      mutateRegister: (r) => {
        r.channels[0].versionCodeHighWater = { consumed: { subscriptiontracker: { value: 6 } } };
      },
    });
    assert.equal(code, 1, out);
    assert.match(out, /FAIL STALE RELEASE NOTES/);
    assert.equal(calls.some((c) => c.includes('/edits')), false, calls.join('\n'));
  });

  test('release notes: none are sent when the file is absent', async () => {
    const { code, out, bodies } = await submit(gated);
    assert.equal(code, 0, out);
    assert.equal(bodies.find((b) => b.what === 'track').body.releases[0].releaseNotes, undefined);
    assert.match(out, /NO RELEASE NOTES/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --sync-listing — the listing tree, pushed through an edit of its own (2026-10-01)
// ─────────────────────────────────────────────────────────────────────────────
describe('submit-play --sync-listing — the repo listing tree becomes the Play record', () => {
  const listed = { withListingAssets: true };
  const SYNC = ['--sync-listing', '--app', 'subscriptiontracker'];
  // Only what the mode needs: a service account and the loopback seam. No GitHub, no keystore.
  const syncEnv = (over = {}) => ({ GITHUB_ACTIONS: '', GITHUB_REPOSITORY: '', ANDROID_SIGNING_POSTURE: '', ...over });
  const WRITES = /^(PATCH|PUT|POST) .*(details|listings|:commit)/;

  test('--plan names every difference, writes nothing and discards its edit', async () => {
    const { code, out, calls } = await submit(listed, { args: [...SYNC, '--plan'], env: syncEnv() });
    assert.equal(code, 0, out);
    assert.match(out, /would change details: contactEmail null → "support@nikatru\.com", contactWebsite null → "https:\/\/nikatru\.com"/);
    assert.match(out, /would change listing en-US: title .*shortDescription .*fullDescription/);
    for (const t of ['icon', 'featureGraphic', 'phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots']) assert.match(out, new RegExp(`would change ${t}:`));
    assert.deepEqual(calls.filter((c) => WRITES.test(c) && !c.endsWith('/edits')), [], out);
    assert.ok(calls.some((c) => c.startsWith('DELETE ') && c.endsWith(`/edits/${EDIT_ID}`)), calls.join('\n'));
    assert.match(out, /LISTING PLAN — nothing was committed \(7 change\(s\)\)/);
  });

  test('pushes text, contact details and every image slot from the tree, then commits', async () => {
    const { code, out, bodies, state, calls } = await submit(listed, { args: SYNC, env: syncEnv() });
    assert.equal(code, 0, out);
    assert.deepEqual(bodies.find((b) => b.what === 'listing').body, {
      title: 'Subly',
      shortDescription: 'Track every subscription in one place',
      fullDescription: 'A longer description.',
    });
    assert.deepEqual(bodies.find((b) => b.what === 'details').body, { contactEmail: 'support@nikatru.com', contactWebsite: 'https://nikatru.com' });
    const sums = (type) => state.images[type].map((i) => i.sha256);
    assert.deepEqual(sums('icon'), [sha256('icon-bytes')]);
    assert.deepEqual(sums('featureGraphic'), [sha256('feature-bytes')]);
    assert.deepEqual(sums('phoneScreenshots'), [sha256('phone-1'), sha256('phone-2')]);
    assert.deepEqual(sums('sevenInchScreenshots'), [sha256('tablet-1'), sha256('tablet-2')]);
    assert.deepEqual(sums('tenInchScreenshots'), [sha256('tablet-1'), sha256('tablet-2')]);
    assert.ok(calls.some((c) => c.endsWith(':commit')), calls.join('\n'));
    assert.match(out, /LISTING SYNCED \(7 change\(s\)\)/);
  });

  // ⏱ 2026-10-01 (#1099 review, finding 4): only the declared fields are written, and what they
  // replace is kept on disk before the first write.
  test('PATCHes only the declared fields — a console-only promo video survives — and backs up what it replaces first', async () => {
    const liveListing = { language: 'en-US', title: 'Old title', shortDescription: 'Old short', fullDescription: 'Old full', video: 'https://www.youtube.com/watch?v=promo' };
    const { code, out, bodies, state, calls } = await submit(listed, {
      args: SYNC,
      env: syncEnv(),
      apiOpts: {
        details: { defaultLanguage: 'en-US', contactPhone: '+91 00000 00000' },
        listing: liveListing,
        images: { phoneScreenshots: [{ sha256: 'old-a' }, { sha256: 'old-b' }] },
      },
    });
    assert.equal(code, 0, out);
    assert.equal(bodies.some((b) => b.what === 'listing-put'), false, 'a PUT replaces the whole Listing; only PATCH is allowed');
    assert.deepEqual(Object.keys(bodies.find((b) => b.what === 'listing').body).sort(), ['fullDescription', 'shortDescription', 'title']);
    assert.equal(state.listing.video, 'https://www.youtube.com/watch?v=promo', 'the promo video the tree does not declare is untouched');
    assert.equal(state.details.contactPhone, '+91 00000 00000', 'an undeclared contact field is untouched');
    const backupAt = (out.match(/backup of the values about to be replaced — (.+listing\.json)/) ?? [])[1];
    assert.ok(backupAt, out);
    const backup = JSON.parse(readFileSync(backupAt, 'utf8'));
    assert.deepEqual(backup.listing, liveListing, 'the listing as Play held it, video included');
    assert.equal(backup.details.contactPhone, '+91 00000 00000');
    assert.deepEqual(backup.images.phoneScreenshots.map((i) => i.sha256), ['old-a', 'old-b']);
    const dir = dirname(backupAt);
    assert.equal(readFileSync(join(dir, 'phoneScreenshots-1.png'), 'utf8'), 'live-bytes-seed-phoneScreenshots-0', 'the replaced image BYTES are kept');
    // ordering: the backup was taken before the first write
    const firstWrite = calls.findIndex((c) => /^(PATCH|DELETE) .*(details|listings)|^POST \/upload\/.*\/listings\//.test(c));
    const imgFetch = calls.findIndex((c) => c.startsWith('GET /img/'));
    assert.ok(imgFetch !== -1 && imgFetch < firstWrite, calls.join('\n'));
  });

  test('a backup that cannot be completed writes NOTHING', async () => {
    const { code, out, calls } = await submit(listed, {
      args: SYNC,
      env: syncEnv(),
      apiOpts: { images: { phoneScreenshots: [{ sha256: 'old-a' }] }, imageUrlStatus: 410 },
    });
    assert.equal(code, 1, out);
    assert.match(out, /could not be kept\. Nothing was written/);
    assert.deepEqual(calls.filter((c) => WRITES.test(c) || c.startsWith('DELETE /androidpublisher') && c.includes('/listings/')), [], calls.join('\n'));
  });

  // The backup writes the bytes an image url answers, so the url's host is pinned (CodeQL
  // js/http-to-file-access, dispositioned by-design on exactly this pin).
  test('an image url off Play\'s image CDN is never fetched — the backup refuses and NOTHING is written', async () => {
    const { code, out, calls } = await submit(listed, {
      args: SYNC,
      env: syncEnv(),
      apiOpts: { images: { phoneScreenshots: [{ id: 'x', sha256: 'old-a', url: 'https://evil.example/x.png' }] } },
    });
    assert.equal(code, 1, out);
    assert.match(out, /not Play's image CDN \(https:\/\/lh3\.googleusercontent\.com\), so it was not fetched/);
    assert.deepEqual(calls.filter((c) => WRITES.test(c)), [], calls.join('\n'));
  });

  test('an image upload answered with NO sha256 is UNVERIFIED — a refusal, never a pass, and nothing is committed', async () => {
    const { code, out, calls } = await submit(listed, { args: SYNC, env: syncEnv(), apiOpts: { omitUploadSha: true } });
    assert.equal(code, 1, out);
    assert.match(out, /UNVERIFIED — icon/);
    assert.equal(calls.some((c) => c.endsWith(':commit')), false, calls.join('\n'));
  });

  test('a record already in sync writes nothing and commits nothing', async () => {
    const images = {
      icon: [{ sha256: sha256('icon-bytes') }],
      featureGraphic: [{ sha256: sha256('feature-bytes') }],
      phoneScreenshots: [{ sha256: sha256('phone-1') }, { sha256: sha256('phone-2') }],
      sevenInchScreenshots: [{ sha256: sha256('tablet-1') }, { sha256: sha256('tablet-2') }],
      tenInchScreenshots: [{ sha256: sha256('tablet-1') }, { sha256: sha256('tablet-2') }],
    };
    const { code, out, calls } = await submit(listed, {
      args: SYNC,
      env: syncEnv(),
      apiOpts: {
        details: { defaultLanguage: 'en-US', contactEmail: 'support@nikatru.com', contactWebsite: 'https://nikatru.com' },
        listing: { language: 'en-US', title: 'Subly', shortDescription: 'Track every subscription in one place', fullDescription: 'A longer description.' },
        images,
      },
    });
    assert.equal(code, 0, out);
    assert.deepEqual(calls.filter((c) => WRITES.test(c) && !c.endsWith('/edits')), [], out);
    assert.match(out, /ALREADY IN SYNC \(0 change\(s\)\)/);
  });

  test('only the changed slot is replaced — one moved screenshot re-sends the phone set alone', async () => {
    const { code, out, calls } = await submit(listed, {
      args: SYNC,
      env: syncEnv(),
      apiOpts: {
        details: { defaultLanguage: 'en-US', contactEmail: 'support@nikatru.com', contactWebsite: 'https://nikatru.com' },
        listing: { language: 'en-US', title: 'Subly', shortDescription: 'Track every subscription in one place', fullDescription: 'A longer description.' },
        images: {
          icon: [{ sha256: sha256('icon-bytes') }],
          featureGraphic: [{ sha256: sha256('feature-bytes') }],
          phoneScreenshots: [{ sha256: sha256('phone-2') }, { sha256: sha256('phone-1') }],
          sevenInchScreenshots: [{ sha256: sha256('tablet-1') }, { sha256: sha256('tablet-2') }],
          tenInchScreenshots: [{ sha256: sha256('tablet-1') }, { sha256: sha256('tablet-2') }],
        },
      },
    });
    assert.equal(code, 0, out);
    const uploads = calls.filter((c) => c.startsWith('POST /upload/') && c.includes('/listings/'));
    assert.equal(uploads.length, 2, uploads.join('\n'));
    assert.ok(uploads.every((c) => c.endsWith('/phoneScreenshots')), uploads.join('\n'));
  });

  test('REFUSES an app with a non-draft release beyond internal testing — that listing reaches users', async () => {
    const { code, out, calls } = await submit(listed, {
      args: SYNC,
      env: syncEnv(),
      apiOpts: { trackReleases: { beta: [{ status: 'completed', versionCodes: ['3'] }] } },
    });
    assert.equal(code, 1, out);
    assert.match(out, /beta:completed/);
    assert.match(out, /class A/);
    assert.deepEqual(calls.filter((c) => WRITES.test(c) && !c.endsWith('/edits')), [], out);
  });

  test('a completed INTERNAL release and a production DRAFT do not block it — neither reaches a user', async () => {
    const { code, out } = await submit(listed, {
      args: [...SYNC, '--plan'],
      env: syncEnv(),
      apiOpts: { trackReleases: { internal: [{ status: 'completed', versionCodes: ['1'] }], production: [{ status: 'draft', versionCodes: ['7'] }] } },
    });
    assert.equal(code, 0, out);
  });

  test('REFUSES a default language the tree is not written in', async () => {
    const { code, out } = await submit(listed, { args: SYNC, env: syncEnv(), apiOpts: { details: { defaultLanguage: 'de-DE' } } });
    assert.equal(code, 1, out);
    assert.match(out, /default language is "de-DE"/);
  });

  test('without a service account it stops before any request', async () => {
    const { code, out, calls } = await submit(listed, { args: SYNC, env: syncEnv({ PLAY_SERVICE_ACCOUNT_JSON: '' }) });
    assert.equal(code, 1, out);
    assert.match(out, /--sync-listing cannot mint an access token/);
    assert.deepEqual(calls, []);
  });

  test('a tablet set with no PNG is COVERAGE LOST (exit 2), never an empty slot pushed', async () => {
    const { code, out } = await submit(
      { ...listed, mutateRegister: (r) => { r.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.deviceTypeCoverage.sets.tablet.dir = 'nowhere'; } },
      { args: [...SYNC, '--plan'], env: syncEnv() },
    );
    assert.equal(code, 2, out);
    assert.match(out, /nowhere holds no \.png/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ WHAT ONLY A REAL, OWNER-APPROVED DISPATCH CAN PROVE — written here so the
// green above is not read as more than it is.
//   · that the `store-publish` environment actually PAUSES the job and records
//     an approval. Everything above proves the script refuses when the gate is
//     absent or empty; nothing here can make GitHub hold a job.
//   · that the service-account key in the repository secret authenticates
//     against the real token endpoint and is authorised on this Play app.
//   · which literal string that account's `edits.tracks.list` returns for the
//     internal testing track — "internal" or "qa". Both are handled; only a live
//     call says which one exists.
//   · that Play accepts `application/octet-stream` for an .aab, and that a
//     ~60 MiB resumable upload completes inside its timeouts.
//   · that the upload certificate Play binds on the FIRST upload is the one
//     pinned in tooling/channel-register.json. That is a one-way door and it can
//     only be walked once.
// ─────────────────────────────────────────────────────────────────────────────
