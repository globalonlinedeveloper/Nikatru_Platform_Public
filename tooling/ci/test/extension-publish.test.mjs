// ─────────────────────────────────────────────────────────────────────────────
// extension-publish.test.mjs — the Chrome and Edge publishers poll to a terminal
// state, and the store seams can only ever point at this machine.
//
// SUBJECT: extensions/scripts/store-poll.mjs (the poll loop, the three store
// vocabularies, the loopback seam, the keepalive presence gate), driven pure;
// publish-edge.mjs and publish-cws.mjs, spawned against a loopback stub; and
// .github/ text, which sets no seam.
//
// 🔴 EVERY CASE IS WRITTEN OUT BY HAND (assert-no-loop-cases.mjs). A table of
// states looped into `test(` would report one case per row while hiding which
// row a regression broke; each state below is its own named case.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const POLL = join(REPO, 'extensions', 'scripts', 'store-poll.mjs');
const poll = () => import(pathToFileURL(POLL).href);

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — the vocabularies. Each documented state, then one the page never names.
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyEdgeOperation — Edge answers 200 for every status, so the status decides', () => {
  test('Edge Succeeded is succeeded', async () => {
    const { classifyEdgeOperation } = await poll();
    assert.equal(classifyEdgeOperation({ status: 'Succeeded' }).state, 'succeeded');
  });
  test('Edge InProgress is in-progress', async () => {
    const { classifyEdgeOperation } = await poll();
    assert.equal(classifyEdgeOperation({ status: 'InProgress' }).state, 'in-progress');
  });
  test('Edge Failed with HTTP 200 is failed', async () => {
    const { classifyEdgeOperation } = await poll();
    const c = classifyEdgeOperation({ status: 'Failed', errorCode: 'InvalidPackage', message: 'bad zip' }, 200);
    assert.equal(c.state, 'failed');
    assert.match(c.detail, /InvalidPackage/);
  });
  test('Edge body with no status (the unexpected-failure shape) is failed', async () => {
    const { classifyEdgeOperation } = await poll();
    assert.equal(classifyEdgeOperation({ message: 'An unexpected error occurred' }).state, 'failed');
  });
  test('Edge status the page does not name is failed', async () => {
    const { classifyEdgeOperation } = await poll();
    assert.equal(classifyEdgeOperation({ status: 'Queued' }).state, 'failed');
  });
  test('Edge status read answering 401 is failed, whatever the body says', async () => {
    const { classifyEdgeOperation } = await poll();
    assert.equal(classifyEdgeOperation({ status: 'Succeeded' }, 401).state, 'failed');
  });
});

describe('classifyCwsUpload — the v2 UploadState, off :upload or :fetchStatus', () => {
  test('CWS upload SUCCEEDED is succeeded', async () => {
    const { classifyCwsUpload } = await poll();
    assert.equal(classifyCwsUpload({ uploadState: 'SUCCEEDED' }).state, 'succeeded');
  });
  test('CWS upload IN_PROGRESS is in-progress', async () => {
    const { classifyCwsUpload } = await poll();
    assert.equal(classifyCwsUpload({ uploadState: 'IN_PROGRESS' }).state, 'in-progress');
  });
  test('CWS upload UPLOAD_IN_PROGRESS (the prose spelling) is in-progress', async () => {
    const { classifyCwsUpload } = await poll();
    assert.equal(classifyCwsUpload({ uploadState: 'UPLOAD_IN_PROGRESS' }).state, 'in-progress');
  });
  test('CWS upload FAILED with HTTP 200 is failed', async () => {
    const { classifyCwsUpload } = await poll();
    assert.equal(classifyCwsUpload({ uploadState: 'FAILED' }, 200).state, 'failed');
  });
  test('CWS upload NOT_FOUND is failed', async () => {
    const { classifyCwsUpload } = await poll();
    assert.equal(classifyCwsUpload({ uploadState: 'NOT_FOUND' }).state, 'failed');
  });
  test('CWS upload UPLOAD_STATE_UNSPECIFIED is failed', async () => {
    const { classifyCwsUpload } = await poll();
    assert.equal(classifyCwsUpload({ uploadState: 'UPLOAD_STATE_UNSPECIFIED' }).state, 'failed');
  });
  test('CWS fetchStatus lastAsyncUploadState SUCCEEDED is succeeded', async () => {
    const { classifyCwsUpload } = await poll();
    assert.equal(classifyCwsUpload({ lastAsyncUploadState: 'SUCCEEDED' }).state, 'succeeded');
  });
  test('CWS upload state the reference does not name is failed', async () => {
    const { classifyCwsUpload } = await poll();
    assert.equal(classifyCwsUpload({ uploadState: 'DONE' }).state, 'failed');
  });
});

describe('classifyCwsSubmission — the v2 ItemState off :publish', () => {
  test('CWS publish PENDING_REVIEW is succeeded', async () => {
    const { classifyCwsSubmission } = await poll();
    assert.equal(classifyCwsSubmission({ state: 'PENDING_REVIEW' }).state, 'succeeded');
  });
  test('CWS publish STAGED is succeeded', async () => {
    const { classifyCwsSubmission } = await poll();
    assert.equal(classifyCwsSubmission({ state: 'STAGED' }).state, 'succeeded');
  });
  test('CWS publish PUBLISHED is succeeded', async () => {
    const { classifyCwsSubmission } = await poll();
    assert.equal(classifyCwsSubmission({ state: 'PUBLISHED' }).state, 'succeeded');
  });
  test('CWS publish PUBLISHED_TO_TESTERS is succeeded', async () => {
    const { classifyCwsSubmission } = await poll();
    assert.equal(classifyCwsSubmission({ state: 'PUBLISHED_TO_TESTERS' }).state, 'succeeded');
  });
  test('CWS publish REJECTED with HTTP 200 is failed', async () => {
    const { classifyCwsSubmission } = await poll();
    assert.equal(classifyCwsSubmission({ state: 'REJECTED' }, 200).state, 'failed');
  });
  test('CWS publish CANCELLED is failed', async () => {
    const { classifyCwsSubmission } = await poll();
    assert.equal(classifyCwsSubmission({ state: 'CANCELLED' }).state, 'failed');
  });
  test('CWS publish ITEM_STATE_UNSPECIFIED is failed', async () => {
    const { classifyCwsSubmission } = await poll();
    assert.equal(classifyCwsSubmission({ state: 'ITEM_STATE_UNSPECIFIED' }).state, 'failed');
  });
  test('CWS publish with no state is failed', async () => {
    const { classifyCwsSubmission } = await poll();
    assert.equal(classifyCwsSubmission({}).state, 'failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — the loop, on a fake clock.
// ─────────────────────────────────────────────────────────────────────────────
describe('pollToTerminal — a terminal state or the ceiling, never a guess', () => {
  test('pollToTerminal times out on a fake clock while the store stays in progress', async () => {
    const { pollToTerminal, classifyEdgeOperation } = await poll();
    let clock = 0;
    let reads = 0;
    const r = await pollToTerminal({
      read: async () => { reads += 1; return { httpStatus: 200, body: { status: 'InProgress' } }; },
      classify: classifyEdgeOperation,
      intervalMs: 10_000,
      ceilingMs: 60_000,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    });
    assert.equal(r.state, 'timed-out');
    assert.equal(reads, 7, `reads at 0, 10 … 60 s are 7; got ${reads}`);
    assert.equal(clock, 60_000, `the loop slept past its ceiling, or stopped short of it: ${clock}`);
    assert.match(r.detail, /after 7 read\(s\) over 60s/);
  });
  test('pollToTerminal stops at the first terminal state', async () => {
    const { pollToTerminal, classifyEdgeOperation } = await poll();
    const answers = [{ status: 'InProgress' }, { status: 'InProgress' }, { status: 'Succeeded' }];
    let clock = 0;
    const r = await pollToTerminal({
      read: async () => ({ httpStatus: 200, body: answers.shift() }),
      classify: classifyEdgeOperation,
      intervalMs: 10,
      ceilingMs: 1_000,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    });
    assert.equal(r.state, 'succeeded');
    assert.equal(r.reads, 3);
  });
  test('pollToTerminal returns failed on a Failed-with-200 without another read', async () => {
    const { pollToTerminal, classifyEdgeOperation } = await poll();
    let reads = 0;
    const r = await pollToTerminal({
      read: async () => { reads += 1; return { httpStatus: 200, body: { status: 'Failed' } }; },
      classify: classifyEdgeOperation,
      intervalMs: 10,
      ceilingMs: 1_000,
      sleep: async () => {},
      now: () => 0,
    });
    assert.equal(r.state, 'failed');
    assert.equal(reads, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — the seam.
// ─────────────────────────────────────────────────────────────────────────────
describe('loopbackBase — the real origin or loopback, no third value', () => {
  test('non-loopback refused: loopbackBase refuses https://example.invalid', async () => {
    const { loopbackBase } = await poll();
    const r = loopbackBase('EDGE_API_BASE_URL', 'https://api.addons.microsoftedge.microsoft.com', { EDGE_API_BASE_URL: 'https://example.invalid' });
    assert.ok(typeof r.error === 'string', JSON.stringify(r));
    assert.match(r.error, /neither https:\/\/api\.addons\.microsoftedge\.microsoft\.com nor loopback/);
  });
  test('loopbackBase accepts the canonical value, with no override', async () => {
    const { loopbackBase } = await poll();
    const r = loopbackBase('CWS_API_BASE_URL', 'https://chromewebstore.googleapis.com', { CWS_API_BASE_URL: 'https://chromewebstore.googleapis.com/' });
    assert.deepEqual(r, { base: 'https://chromewebstore.googleapis.com', override: false });
  });
  test('loopbackBase accepts http on 127.0.0.1 as an override', async () => {
    const { loopbackBase } = await poll();
    const r = loopbackBase('CWS_OAUTH_TOKEN_URL', 'https://oauth2.googleapis.com/token', { CWS_OAUTH_TOKEN_URL: 'http://127.0.0.1:4567/token' });
    assert.deepEqual(r, { base: 'http://127.0.0.1:4567/token', override: true });
  });
  test('loopbackBase refuses https on loopback (the rule is http on loopback, as githubApiBase)', async () => {
    const { loopbackBase } = await poll();
    const r = loopbackBase('AMO_API_BASE_URL', 'https://addons.mozilla.org', { AMO_API_BASE_URL: 'https://127.0.0.1:1' });
    assert.ok(typeof r.error === 'string', JSON.stringify(r));
  });
  test('pollTiming refuses STORE_POLL_CEILING_MS while no origin is overridden', async () => {
    const { pollTiming } = await poll();
    const r = pollTiming({ STORE_POLL_CEILING_MS: '500' }, false);
    assert.match(r.error ?? '', /STORE_POLL_CEILING_MS is set while no store origin is overridden/);
  });
  test('pollTiming honours both values under an override', async () => {
    const { pollTiming } = await poll();
    assert.deepEqual(pollTiming({ STORE_POLL_INTERVAL_MS: '50', STORE_POLL_CEILING_MS: '500' }, true), { intervalMs: 50, ceilingMs: 500 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — the real publishers, the real transport, a loopback stand-in for
// GitHub and both stores. Each publisher is spawned ASYNC so this process's stub
// can answer it; a run the stub cannot answer gets a 418, which no vocabulary
// names. Every credential below is a made-up fixture value.
// ─────────────────────────────────────────────────────────────────────────────
const EDGE_PRODUCT = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const CHROME_ITEM = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CWS_PUBLISHER = 'fixture-publisher';
const REPO_SLUG = 'fixture-owner/fixture-repo';
const GH_ENV = `GET /repos/${REPO_SLUG}/environments/store-publish`;
const REVIEWED = { status: 200, body: { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'fixture-owner' } }] }], can_admins_bypass: false } };
const NO_REVIEWER = { status: 200, body: { protection_rules: [], can_admins_bypass: true } };

const E = `/v1/products/${EDGE_PRODUCT}/submissions`;
const EDGE_UPLOAD = `POST ${E}/draft/package`;
const EDGE_UPLOAD_READ = `GET ${E}/draft/package/operations/up-op-1`;
const EDGE_PUBLISH = `POST ${E}`;
const EDGE_PUBLISH_READ = `GET ${E}/operations/pub-op-1`;
const edgeAccepts = () => ({
  [GH_ENV]: REVIEWED,
  [EDGE_UPLOAD]: { status: 202, headers: { location: `${E}/draft/package/operations/up-op-1` } },
  [EDGE_UPLOAD_READ]: [{ status: 200, body: { status: 'InProgress' } }, { status: 200, body: { status: 'Succeeded' } }],
  [EDGE_PUBLISH]: { status: 202, headers: { location: `${E}/operations/pub-op-1` } },
  [EDGE_PUBLISH_READ]: { status: 200, body: { status: 'Succeeded' } },
});

const C = `/v2/publishers/${CWS_PUBLISHER}/items/${CHROME_ITEM}`;
const CWS_TOKEN = 'POST /token';
const CWS_UPLOAD = `POST /upload${C}:upload`;
const CWS_UPLOAD_READ = `GET ${C}:fetchStatus`;
const CWS_PUBLISH = `POST ${C}:publish`;
const cwsAccepts = () => ({
  [GH_ENV]: REVIEWED,
  [CWS_TOKEN]: { status: 200, body: { access_token: 'fixture-access-token', expires_in: 3599, token_type: 'Bearer' } },
  [CWS_UPLOAD]: { status: 200, body: { uploadState: 'IN_PROGRESS' } },
  [CWS_UPLOAD_READ]: [{ status: 200, body: { lastAsyncUploadState: 'IN_PROGRESS' } }, { status: 200, body: { lastAsyncUploadState: 'SUCCEEDED' } }],
  [CWS_PUBLISH]: { status: 200, body: { state: 'PENDING_REVIEW' } },
});

/** Every name a publisher reads from its environment; the parent's own values
 *  never reach a case. */
const CLEARED = [
  'EDGE_API_BASE_URL', 'CWS_API_BASE_URL', 'CWS_OAUTH_TOKEN_URL', 'AMO_API_BASE_URL', 'GITHUB_API_URL',
  'STORE_POLL_INTERVAL_MS', 'STORE_POLL_CEILING_MS', 'OPS_REQUEST_TIMEOUT_MS',
  'EDGE_API_KEY', 'EDGE_CLIENT_ID', 'CWS_SERVICE_ACCOUNT_JSON', 'CWS_PUBLISHER_ID',
  'AMO_JWT_ISSUER', 'AMO_JWT_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN',
];

let TMP;
let TREE;
let ZIP;
let SA_JSON;

function write(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'ext-publish-'));
  TREE = join(TMP, 'tree');
  // Both rows ARMED and the tool LISTED on both, so each lane reaches `go`.
  const row = (id, key) => ({ id, kind: 'store', surface: 'extension', served: false, submittable: true, extensionStoreKey: key, lane: { workflow: '.github/workflows/extensions.yml', job: 'release' } });
  write(TREE, 'tooling/channel-register.json', JSON.stringify({ channels: [row('chrome-webstore', 'chrome'), row('edge-addons', 'edge')] }, null, 2));
  write(TREE, 'extensions/Extension/fullshot/tool.json', JSON.stringify({
    id: 'fullshot',
    storeMetadata: { stores: {
      chrome: { target: 'chromium', dir: 'store/chrome', served: false, listingId: CHROME_ITEM },
      edge: { target: 'chromium', dir: 'store/edge', served: false, listingId: EDGE_PRODUCT },
    } },
  }, null, 2));
  ZIP = join(TMP, 'dist', 'fullshot-chromium.zip');
  write(TMP, 'dist/fullshot-chromium.zip', 'fixture package bytes');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  SA_JSON = JSON.stringify({
    type: 'service_account',
    client_email: 'fixture@fixture-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
});
after(() => rmSync(TMP, { recursive: true, force: true }));

/** A loopback stand-in. `answers` maps "METHOD /path" to one answer, or to a list
 *  played in order whose last entry repeats. Every request is recorded in `seen`. */
async function stub(answers) {
  const seen = [];
  const played = new Map();
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const key = `${req.method} ${req.url}`;
      seen.push(key);
      let a = answers[key];
      if (Array.isArray(a)) {
        const n = played.get(key) ?? 0;
        played.set(key, n + 1);
        a = a[Math.min(n, a.length - 1)];
      }
      if (a === undefined) a = { status: 418, body: { stub: `no answer for ${key}` } };
      res.writeHead(a.status, { 'content-type': 'application/json', ...(a.headers ?? {}) });
      res.end(a.body === undefined ? '' : JSON.stringify(a.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

function envFor(s, extra) {
  const env = { ...process.env };
  for (const n of CLEARED) delete env[n];
  return {
    ...env,
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: REPO_SLUG,
    GITHUB_TOKEN: 'fixture-github-token',
    GITHUB_API_URL: s.base,
    STORE_POLL_INTERVAL_MS: '50',
    STORE_POLL_CEILING_MS: '500',
    ...extra,
  };
}
const edgeEnv = (s, extra = {}) => envFor(s, { EDGE_API_BASE_URL: s.base, EDGE_API_KEY: 'fixture-edge-key', EDGE_CLIENT_ID: 'fixture-edge-client', ...extra });
const cwsEnv = (s, extra = {}) => envFor(s, {
  CWS_API_BASE_URL: s.base,
  CWS_OAUTH_TOKEN_URL: `${s.base}/token`,
  CWS_SERVICE_ACCOUNT_JSON: SA_JSON,
  CWS_PUBLISHER_ID: CWS_PUBLISHER,
  ...extra,
});

function publish(script, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(REPO, 'extensions', 'scripts', script), '--tool', 'fullshot', '--zip', ZIP, '--repo-root', TREE], {
      cwd: REPO,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const guard = setTimeout(() => child.kill(), 60_000);
    child.on('close', (code) => { clearTimeout(guard); done({ code, out }); });
  });
}

describe('publish-edge.mjs against a loopback Edge — the status field decides', () => {
  test('Edge accepted: upload InProgress then Succeeded, publish Succeeded — SUBMITTED', async () => {
    const s = await stub(edgeAccepts());
    try {
      const r = await publish('publish-edge.mjs', edgeEnv(s));
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /publish-edge: SUBMITTED/);
      assert.match(r.out, /EDGE_API_BASE_URL override in effect/);
      assert.equal(s.seen.filter((k) => k === EDGE_UPLOAD_READ).length, 2, s.seen.join('\n'));
      assert.ok(s.seen.indexOf(EDGE_PUBLISH) > s.seen.lastIndexOf(EDGE_UPLOAD_READ), s.seen.join('\n'));
    } finally {
      await s.close();
    }
  });
  test('Edge upload Failed with HTTP 200 exits 1 and sends no publish POST', async () => {
    const s = await stub({ ...edgeAccepts(), [EDGE_UPLOAD_READ]: { status: 200, body: { status: 'Failed', errorCode: 'InvalidPackage', message: 'fixture' } } });
    try {
      const r = await publish('publish-edge.mjs', edgeEnv(s));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /upload operation ended Failed/);
      assert.doesNotMatch(r.out, /SUBMITTED/);
      assert.ok(!s.seen.includes(EDGE_PUBLISH), s.seen.join('\n'));
    } finally {
      await s.close();
    }
  });
  test('Edge publish Failed with HTTP 200 exits 1 and prints no SUBMITTED', async () => {
    const s = await stub({ ...edgeAccepts(), [EDGE_PUBLISH_READ]: { status: 200, body: { status: 'Failed', errorCode: 'CertificationFailed', message: 'fixture' } } });
    try {
      const r = await publish('publish-edge.mjs', edgeEnv(s));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /publish operation ended Failed/);
      assert.doesNotMatch(r.out, /SUBMITTED/);
    } finally {
      await s.close();
    }
  });
  test('Edge status read with no status field exits 1 and sends no publish POST', async () => {
    const s = await stub({ ...edgeAccepts(), [EDGE_UPLOAD_READ]: { status: 200, body: { message: 'An unexpected error occurred' } } });
    try {
      const r = await publish('publish-edge.mjs', edgeEnv(s));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /no documented status/);
      assert.ok(!s.seen.includes(EDGE_PUBLISH), s.seen.join('\n'));
    } finally {
      await s.close();
    }
  });
  test('Edge upload still InProgress at the ceiling exits 1 NOT CONFIRMED and sends no publish POST', async () => {
    const s = await stub({ ...edgeAccepts(), [EDGE_UPLOAD_READ]: { status: 200, body: { status: 'InProgress' } } });
    try {
      const r = await publish('publish-edge.mjs', edgeEnv(s));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /NOT CONFIRMED — the store may still be processing; do not re-upload the same version/);
      assert.ok(!s.seen.includes(EDGE_PUBLISH), s.seen.join('\n'));
    } finally {
      await s.close();
    }
  });
});

describe('publish-cws.mjs against a loopback Chrome Web Store — the state field decides', () => {
  test('CWS accepted: upload IN_PROGRESS, fetchStatus SUCCEEDED, publish PENDING_REVIEW — SUBMITTED with the state', async () => {
    const s = await stub(cwsAccepts());
    try {
      const r = await publish('publish-cws.mjs', cwsEnv(s));
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /publish-cws: SUBMITTED .*item state PENDING_REVIEW/);
      assert.match(r.out, /CWS_OAUTH_TOKEN_URL override in effect/);
      assert.equal(s.seen.filter((k) => k === CWS_UPLOAD_READ).length, 2, s.seen.join('\n'));
    } finally {
      await s.close();
    }
  });
  test('CWS upload FAILED with HTTP 200 exits 1 and sends no publish POST', async () => {
    const s = await stub({ ...cwsAccepts(), [CWS_UPLOAD]: { status: 200, body: { uploadState: 'FAILED', itemError: [{ error_code: 'PKG_INVALID' }] } } });
    try {
      const r = await publish('publish-cws.mjs', cwsEnv(s));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /upload ended FAILED/);
      assert.ok(!s.seen.includes(CWS_PUBLISH), s.seen.join('\n'));
    } finally {
      await s.close();
    }
  });
  test('CWS publish REJECTED with HTTP 200 exits 1 and prints no SUBMITTED', async () => {
    const s = await stub({ ...cwsAccepts(), [CWS_UPLOAD]: { status: 200, body: { uploadState: 'SUCCEEDED' } }, [CWS_PUBLISH]: { status: 200, body: { state: 'REJECTED' } } });
    try {
      const r = await publish('publish-cws.mjs', cwsEnv(s));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /did not take the submission: REJECTED/);
      assert.doesNotMatch(r.out, /SUBMITTED/);
    } finally {
      await s.close();
    }
  });
  test('CWS upload still IN_PROGRESS at the ceiling exits 1 NOT CONFIRMED and sends no publish POST', async () => {
    const s = await stub({ ...cwsAccepts(), [CWS_UPLOAD_READ]: { status: 200, body: { lastAsyncUploadState: 'IN_PROGRESS' } } });
    try {
      const r = await publish('publish-cws.mjs', cwsEnv(s));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /NOT CONFIRMED — the store may still be processing; do not re-upload the same version/);
      assert.ok(!s.seen.includes(CWS_PUBLISH), s.seen.join('\n'));
    } finally {
      await s.close();
    }
  });
});

describe('the gates a publisher passes before its first store request', () => {
  test('no-reviewer environment refused: Edge reads the environment and makes no store request', async () => {
    const s = await stub({ ...edgeAccepts(), [GH_ENV]: NO_REVIEWER });
    try {
      const r = await publish('publish-edge.mjs', edgeEnv(s));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /carries NO required reviewer/);
      assert.deepEqual(s.seen, [GH_ENV]);
    } finally {
      await s.close();
    }
  });
  test('non-loopback EDGE_API_BASE_URL refused before any request', async () => {
    // NO_REVIEWER as well: were the seam check ever gone, the environment read
    // would still stop the run before a store call, and `seen` would say so.
    const s = await stub({ ...edgeAccepts(), [GH_ENV]: NO_REVIEWER });
    try {
      const r = await publish('publish-edge.mjs', edgeEnv(s, { EDGE_API_BASE_URL: 'https://example.invalid' }));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /EDGE_API_BASE_URL points at https:\/\/example\.invalid, which is neither https:\/\/api\.addons\.microsoftedge\.microsoft\.com nor loopback/);
      assert.deepEqual(s.seen, []);
    } finally {
      await s.close();
    }
  });
  test('STORE_POLL_CEILING_MS without a store override refused before any request', async () => {
    const s = await stub({ ...cwsAccepts(), [GH_ENV]: NO_REVIEWER });
    try {
      const r = await publish('publish-cws.mjs', cwsEnv(s, { CWS_API_BASE_URL: '' }));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /STORE_POLL_CEILING_MS is set while no store origin is overridden/);
      assert.deepEqual(s.seen, []);
    } finally {
      await s.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — the seams are for tests only. A workflow that set one would point a
// real run at a stub, or stretch its poll; the loopback rule is the first stop,
// and this case is the second: no workflow or action text names a seam at all.
// ─────────────────────────────────────────────────────────────────────────────
const SEAM_NAMES = [
  'EDGE_API_BASE_URL',
  'CWS_API_BASE_URL',
  'CWS_OAUTH_TOKEN_URL',
  'AMO_API_BASE_URL',
  'STORE_POLL_INTERVAL_MS',
  'STORE_POLL_CEILING_MS',
];

describe('the store seams are set by no workflow', () => {
  test('no workflow or composite action names a store seam variable', () => {
    const files = [];
    const wf = join(REPO, '.github', 'workflows');
    for (const name of readdirSync(wf)) if (/\.ya?ml$/.test(name)) files.push(join(wf, name));
    const actions = join(REPO, '.github', 'actions');
    for (const dir of readdirSync(actions)) {
      for (const name of ['action.yml', 'action.yaml']) if (existsSync(join(actions, dir, name))) files.push(join(actions, dir, name));
    }
    // Not vacuous: the file that runs the publishers is among those read.
    assert.ok(files.some((f) => f.endsWith(join('workflows', 'extensions.yml'))), `extensions.yml not read; read ${files.length} file(s)`);
    const hits = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        for (const seam of SEAM_NAMES) if (line.includes(seam)) hits.push(`${f.slice(REPO.length + 1)}:${i + 1} names ${seam}`);
      });
    }
    assert.deepEqual(hits, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 6 — the keepalive: one presence gate, then one read-only probe per key.
// runKeepalive is driven with a fake fetch, so no case reaches any host.
// ─────────────────────────────────────────────────────────────────────────────
const KEEPALIVE = join(REPO, 'extensions', 'scripts', 'store-key-keepalive.mjs');
const keepalive = () => import(pathToFileURL(KEEPALIVE).href);
const AMO_ISSUER = 'user:00000:000';
const AMO_SECRET = 'fixture-amo-secret-not-a-real-one';
const AMO_KEYS = { AMO_JWT_ISSUER: AMO_ISSUER, AMO_JWT_SECRET: AMO_SECRET };
const EDGE_KEYS = { EDGE_CLIENT_ID: 'fixture-client', EDGE_API_KEY: 'fixture-api-key' };
const AMO_PROFILE = 'https://addons.mozilla.org/api/v5/accounts/profile/';
const EDGE_PROBE = `https://api.addons.microsoftedge.microsoft.com/v1/products/${EDGE_PRODUCT}/submissions/operations/00000000-0000-0000-0000-000000000000`;

let ARMED_TREE;
let UNARMED_TREE;

/** A fake fetch: `answers` maps a URL to an HTTP status; every call is recorded. */
function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const status = answers[url] ?? 418;
    return new Response(status === 404 ? 'Not Found' : '{}', { status });
  };
  return { calls, fetchImpl };
}
const noSleep = async () => {};

describe('keepaliveGate and store-key-keepalive — a present key is probed, armed or not', () => {
  before(() => {
    const row = (id, key, armed) => ({ id, kind: 'store', surface: 'extension', served: false, submittable: armed, extensionStoreKey: key, lane: { workflow: '.github/workflows/extensions.yml', job: 'release' } });
    const tool = JSON.stringify({ id: 'fullshot', storeMetadata: { stores: {
      chrome: { target: 'chromium', dir: 'store/chrome', served: false, listingId: CHROME_ITEM },
      edge: { target: 'chromium', dir: 'store/edge', served: false, listingId: EDGE_PRODUCT },
      firefox: { target: 'firefox', dir: 'store/firefox', served: false, listingId: 'fullshot@example.invalid' },
    } } }, null, 2);
    ARMED_TREE = join(TMP, 'ka-armed');
    UNARMED_TREE = join(TMP, 'ka-unarmed');
    for (const [root, armed] of [[ARMED_TREE, true], [UNARMED_TREE, false]]) {
      write(root, 'tooling/channel-register.json', JSON.stringify({ channels: [row('amo', 'firefox', armed), row('edge-addons', 'edge', armed), row('chrome-webstore', 'chrome', armed)] }, null, 2));
      write(root, 'extensions/Extension/fullshot/tool.json', tool);
    }
  });

  test('keepaliveGate probes a present key on an UNARMED row', async () => {
    const { keepaliveGate } = await poll();
    assert.equal(keepaliveGate('edge-addons', { ...EDGE_KEYS }, UNARMED_TREE).gate, 'probe');
  });
  test('keepaliveGate refuses an absent key on an ARMED row', async () => {
    const { keepaliveGate } = await poll();
    const g = keepaliveGate('amo', {}, ARMED_TREE);
    assert.equal(g.gate, 'refuse');
    assert.deepEqual(g.missing, ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET']);
  });
  test('keepaliveGate answers owner-step for an absent key on an unarmed row', async () => {
    const { keepaliveGate } = await poll();
    assert.equal(keepaliveGate('amo', {}, UNARMED_TREE).gate, 'owner-step');
  });
  test('keepaliveGate asks chrome-webstore for the service account alone, not the publisher id', async () => {
    const { keepaliveGate } = await poll();
    assert.equal(keepaliveGate('chrome-webstore', { CWS_SERVICE_ACCOUNT_JSON: SA_JSON }, ARMED_TREE).gate, 'probe');
  });

  test('absent: no request — no key on unarmed rows exits 0 and calls nothing', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({});
    const r = await runKeepalive({ env: {}, fetchImpl: f.fetchImpl, root: UNARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(f.calls, []);
    assert.match(r.lines.join('\n'), /AMO NOTHING TO CHECK/);
    assert.match(r.lines.join('\n'), /Edge NOTHING TO CHECK/);
  });
  test('absent keys on ARMED rows exit 1 and call nothing', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({});
    const r = await runKeepalive({ env: {}, fetchImpl: f.fetchImpl, root: ARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.deepEqual(f.calls, []);
    assert.match(r.lines.join('\n'), /the register ARMS amo/);
    assert.match(r.lines.join('\n'), /the register ARMS edge-addons/);
  });
  test('AMO 200 is alive, and the JWT is HS256 over iss, jti, iat and exp = iat + 60', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({ [AMO_PROFILE]: 200 });
    const r = await runKeepalive({ env: { ...AMO_KEYS }, fetchImpl: f.fetchImpl, root: UNARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(f.calls.map((c) => c.url), [AMO_PROFILE]);
    const token = f.calls[0].headers.authorization.replace(/^JWT /, '');
    const [head, payload, sig] = token.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(claims.iss, AMO_ISSUER);
    assert.equal(claims.exp - claims.iat, 60);
    assert.equal(typeof claims.jti, 'string');
    assert.equal(sig, createHmac('sha256', AMO_SECRET).update(`${head}.${payload}`).digest('base64url'));
    assert.doesNotMatch(r.lines.join('\n'), new RegExp(AMO_SECRET));
  });
  test('Edge 404 is alive: an authenticated answer about an operation that never existed', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({ [EDGE_PROBE]: 404 });
    const r = await runKeepalive({ env: { ...EDGE_KEYS }, fetchImpl: f.fetchImpl, root: UNARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(f.calls.map((c) => c.url), [EDGE_PROBE]);
    assert.equal(f.calls[0].headers.authorization, 'ApiKey fixture-api-key');
    assert.equal(f.calls[0].headers['x-clientid'], 'fixture-client');
    assert.match(r.lines.join('\n'), /Edge OK — the key authenticated: HTTP 404/);
  });
  test('rejected key exits 1: AMO answering 401', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({ [AMO_PROFILE]: 401 });
    const r = await runKeepalive({ env: { ...AMO_KEYS }, fetchImpl: f.fetchImpl, root: UNARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /AMO: the key was REJECTED — HTTP 401/);
    assert.match(r.lines.join('\n'), /store-key-keepalive: FAILED/);
  });
  test('rejected key exits 1: Edge answering 403', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({ [EDGE_PROBE]: 403 });
    const r = await runKeepalive({ env: { ...EDGE_KEYS }, fetchImpl: f.fetchImpl, root: UNARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /Edge: the key was REJECTED — HTTP 403/);
  });
  test('a status that is neither alive nor rejected (HTTP 400) exits 1 and prints it', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({ [AMO_PROFILE]: 400 });
    const r = await runKeepalive({ env: { ...AMO_KEYS }, fetchImpl: f.fetchImpl, root: UNARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /AMO: HTTP 400, which this probe does not read as alive or as rejected/);
  });
  test('could not look exits 1: a store answering 503 on every bounded attempt', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({ [EDGE_PROBE]: 503 });
    const r = await runKeepalive({ env: { ...EDGE_KEYS }, fetchImpl: f.fetchImpl, root: UNARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /Edge: could not look/);
    assert.ok(f.calls.length > 1, `the read was retried: ${f.calls.length} call(s)`);
  });
  test('a non-loopback AMO_API_BASE_URL is refused before any request', async () => {
    const { runKeepalive } = await keepalive();
    const f = fakeFetch({});
    const r = await runKeepalive({ env: { ...AMO_KEYS, AMO_API_BASE_URL: 'https://example.invalid' }, fetchImpl: f.fetchImpl, root: UNARMED_TREE, sleep: noSleep });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.deepEqual(f.calls, []);
  });
});
