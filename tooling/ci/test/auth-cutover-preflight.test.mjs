// ─────────────────────────────────────────────────────────────────────────────
// auth-cutover-preflight.test.mjs — the switch preflight can PASS, FAIL and
// report COVERAGE LOST, and the exit rule is FAIL (1) > LOST (2) > 0.
//
// Every look is injected: a fixture repo tree, a routed fake `fetch`, a fake
// `gh` and a fake guard runner. No test reaches the network or the real repo
// settings. No test is declared inside a loop (assert-no-loop-cases.mjs).
//
// Run:  node --test tooling/ci/test/auth-cutover-preflight.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  checkCaptcha,
  checkConfigAgreement,
  checkCsp,
  checkGates,
  checkGoTrueUp,
  checkKeepAlive,
  checkKeys,
  checkKv,
  checkRedirects,
  checkSecretNames,
  checkTemplates,
  checkWebBuild,
  checkWorkersHealth,
  checkWorkerVars,
  cloudflareCreds,
  cutoverWorkers,
  gradeRun,
  jwksKvKey,
  keepAliveTargets,
  parseArgs,
  readTargetJwks,
  readWorkerVars,
  runPreflight,
  servedNativeChannels,
} from '../../ops/auth-cutover-preflight.mjs';
import { AUTH_MAIL_SOURCE_DIR } from '../../sites/gen-auth-mail.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'auth-cutover-preflight.mjs');

const TARGET = 'https://auth-api.example.test';
const HOSTED = 'https://abcdefghijklmnop.supabase.co';
const WEB = 'https://example.test/subscriptiontracker';
const ANON = 'anon-placeholder-CANARY-PF1';
const BREACHED = 'This password appeared in a data breach. Choose another.';
const ALLOW = 'https://example.test/subscriptiontracker/**,http://localhost:3000/**';
const SITE = 'https://example.test/subscriptiontracker';
const MAIL = {
  'confirm-signup.html': '<p>confirm {{ .ConfirmationURL }}</p>\n',
  'magic-link.html': '<p>magic {{ .ConfirmationURL }}</p>\n',
  'reset-password.html': '<p>reset {{ .ConfirmationURL }}</p>\n',
};
const MAIL_URL = {
  'confirm-signup.html': 'https://nikatru.com/auth-mail/confirm-signup.html',
  'magic-link.html': 'https://nikatru.com/auth-mail/magic-link.html',
  'reset-password.html': 'https://nikatru.com/auth-mail/reset-password.html',
};
const CHANNELS = [
  { id: 'web', surface: 'app', kind: 'web', platforms: ['web'], served: true },
  { id: 'android-play', surface: 'app', kind: 'store', platforms: ['android'], served: false },
  { id: 'chrome-webstore', surface: 'extension', kind: 'store', platforms: ['chrome'], served: true },
];
// `google: false` is what AuthProviders.configured declares today (and the fixture below).
const GOOD_SETTINGS = { external: { email: true, apple: true, google: false }, mailer_autoconfirm: false, disable_signup: false };
/** packages/auth_supabase/lib/src/auth_providers.dart, shaped as the real one: the
 *  words "apple: false" in a comment must not be what the parse reads. */
const providersDart = ({ apple = true, google = false } = {}) => [
  'class AuthProviders {',
  '  const AuthProviders({required this.apple, required this.google});',
  '  final bool apple;',
  '  final bool google;',
  '  /// Never ship google without apple; `apple: false` here is prose, not the flag.',
  '  static const AuthProviders configured = AuthProviders(',
  `    apple: ${apple},`,
  `    google: ${google},`,
  '  );',
  '}',
  '',
].join('\n');

// C9-C11. Obvious fakes: no real token, account id or namespace id is written here.
const CF_TOKEN = 'tok-FAKE-CANARY-CF1';
const CF_ACCOUNT = 'acct-FAKE-CANARY-CF2';
const CF_ENV = { CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT };
const CF = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}`;
const KV_NS = 'ns-FAKE-jwks-cache';
const KV_KEY = 'supabase_jwks';
const KV_VALUE = `${CF}/storage/kv/namespaces/${KV_NS}/values/${KV_KEY}`;
const PLATFORM_HEALTH = 'https://platform.example.test/v1/health';
const ST_HEALTH = 'https://subscriptiontracker-api.example.test/v1/health';
// Key material that must never reach a line: C10 prints kids and algorithms only.
const KEY_X = 'x-CANARY-KEYMATERIAL';
const TARGET_JWKS = { keys: [{ kty: 'EC', crv: 'P-256', alg: 'ES256', kid: 'k1', x: KEY_X, y: 'y1' }] };
const HOSTED_JWKS = { keys: [{ kty: 'EC', crv: 'P-256', alg: 'ES256', kid: 'hosted-k0', x: KEY_X, y: 'y0' }] };
/** A Worker's bindings whose SUPABASE_URL is `text` of `type` (null = no
 *  SUPABASE_URL binding; secret_text carries no text, as live). */
const bindings = (text, type = 'plain_text') => [
  { name: 'APP_ID', type: 'plain_text', text: 'platform' },
  ...(text === null ? [] : [type === 'secret_text' ? { name: 'SUPABASE_URL', type } : { name: 'SUPABASE_URL', type, text }]),
];
/** A Cloudflare script-settings answer: the NEWEST UPLOADED version's bindings,
 *  whether or not that version serves. C9 no longer reads it; the routes keep it
 *  so a read of it is a read of the wrong version, as live. */
const workerSettings = (text, type) => json({ success: true, errors: [], result: { bindings: bindings(text, type) } });
// Version ids, shaped as live (a uuid; the lines print the first 8 characters).
const V_ACTIVE = 'a1a1a1a1-0000-4000-8000-000000000001';
const V_NEWEST = 'b2b2b2b2-0000-4000-8000-000000000002';
const V_CANARY = 'c3c3c3c3-0000-4000-8000-000000000003';
/** `/deployments`: the active deployment first, with its versions and traffic
 *  share, then an older one; `served` is [[versionId, percentage], ...]. */
const deploymentsOf = (served = [[V_ACTIVE, 100]]) => json({
  success: true,
  errors: [],
  result: {
    deployments: [
      { id: 'd1d1d1d1-0000-4000-8000-000000000001', created_on: '2026-09-26T05:36:04Z', source: 'wrangler', strategy: 'percentage', versions: served.map(([version_id, percentage]) => ({ version_id, percentage })) },
      { id: 'd0d0d0d0-0000-4000-8000-000000000000', created_on: '2026-09-26T02:16:40Z', source: 'wrangler', strategy: 'percentage', versions: [{ version_id: 'e0e0e0e0-0000-4000-8000-000000000000', percentage: 100 }] },
    ],
  },
});
/** `/versions/<id>`: that version's bindings, under result.resources as live. */
const versionOf = (id, text, type) => json({ success: true, errors: [], result: { id, number: 7, metadata: { created_on: '2026-09-26T02:16:40Z', source: 'wrangler' }, resources: { bindings: bindings(text, type), script: { etag: 'e' } } } });
/** `/versions`: the newest uploaded version first. */
const versionsList = (...ids) => json({ success: true, errors: [], result: { items: ids.map((id, i) => ({ id, number: 9 - i, metadata: { created_on: `2026-09-26T06:2${6 - i}:36Z`, source: 'wrangler' } })) } });
/** The routes for one Worker whose active deployment serves V_ACTIVE with
 *  SUPABASE_URL `text` of `type`, and whose newest uploaded version is V_ACTIVE. */
const serving = (script, text, type) => ({
  [`${CF}/workers/scripts/${script}/settings`]: () => workerSettings(text, type),
  [`${CF}/workers/scripts/${script}/deployments`]: () => deploymentsOf(),
  [`${CF}/workers/scripts/${script}/versions/${V_ACTIVE}`]: () => versionOf(V_ACTIVE, text, type),
  [`${CF}/workers/scripts/${script}/versions`]: () => versionsList(V_ACTIVE, 'e0e0e0e0-0000-4000-8000-000000000000'),
});
/** A Worker after a rollback: the active deployment serves V_ACTIVE (`active`),
 *  and a NEWER upload V_NEWEST (`newest`) does not serve — /settings answers it. */
const rolledBack = (script, { active, newest }) => ({
  [`${CF}/workers/scripts/${script}/settings`]: () => workerSettings(newest),
  [`${CF}/workers/scripts/${script}/deployments`]: () => deploymentsOf(),
  [`${CF}/workers/scripts/${script}/versions/${V_ACTIVE}`]: () => versionOf(V_ACTIVE, active),
  [`${CF}/workers/scripts/${script}/versions/${V_NEWEST}`]: () => versionOf(V_NEWEST, newest),
  [`${CF}/workers/scripts/${script}/versions`]: () => versionsList(V_NEWEST, V_ACTIVE),
});
/** A /v1/health body: the jwks entry is an ARRAY entry of checks[], as live. */
const health = (status = 'ok', reason = null) => json({
  ok: status === 'ok',
  status,
  checks: [
    { name: 'platform_db', status: 'ok', reason: null, ageMs: 0 },
    { name: 'supabase_jwks', status, reason, ageMs: 0 },
  ],
});
const KV_ABSENT = () => json({ success: false, errors: [{ code: 10009, message: "get: 'key not found'" }], result: null }, 404);

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-preflight-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const put = (root, rel, text) => {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};

/** A fixture repo in the pre-switch shape, each part overridable (null = absent). */
function makeRoot({
  csp = `default-src 'self'; connect-src 'self' ${HOSTED} ${TARGET}; img-src 'self'`,
  recorded = HOSTED,
  vars = { SUPABASE_URL: HOSTED },
  channels = CHANNELS,
  arb = { passwordTooShort: 'Too short', passwordBreached: BREACHED },
  sources = MAIL,
  jwksCache = true,
  kvKeySource = `export const JWKS_KV_KEY = '${KV_KEY}';\n`,
  providers = providersDart(),
} = {}) {
  const root = join(TMP, `r${seq++}`);
  if (csp !== null) put(root, 'apps/subscriptiontracker/web/_headers', `# CSP: connect-src ${HOSTED}\n/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: ${csp}\n`);
  else mkdirSync(join(root, 'apps', 'subscriptiontracker'), { recursive: true });
  put(root, 'tooling/platform-register.json', JSON.stringify({ sharedValues: { values: recorded ? [{ at: 'vars.SUPABASE_URL', value: recorded }] : [] } }));
  // Both Workers bind JWKS_CACHE (or neither, `jwksCache: false`); platform has a
  // second custom domain whose first label is not its name, as live.
  const kv = jwksCache ? `  "kv_namespaces": [\n    // the JWKS cache\n    { "binding": "JWKS_CACHE", "id": "${KV_NS}" },\n  ],\n` : '';
  put(root, 'services/platform/wrangler.jsonc', `{\n  // the platform Worker\n  "name": "platform",\n  "vars": ${JSON.stringify(vars)},\n${kv}  "routes": [\n    { "pattern": "config.example.test", "custom_domain": true },\n    { "pattern": "platform.example.test", "custom_domain": true },\n  ],\n}\n`);
  put(root, 'services/subscriptiontracker-api/wrangler.jsonc', `{\n  "name": "subscriptiontracker-api",\n  "vars": ${JSON.stringify(vars)},\n${kv}  "routes": [{ "pattern": "subscriptiontracker-api.example.test", "custom_domain": true }],\n}\n`);
  if (kvKeySource !== null) put(root, 'services/_shared/src/auth.ts', kvKeySource);
  if (providers !== null) put(root, 'packages/auth_supabase/lib/src/auth_providers.dart', providers);
  if (channels) put(root, 'tooling/channel-register.json', JSON.stringify({ channels }));
  if (arb) put(root, 'apps/subscriptiontracker/lib/l10n/app_en.arb', JSON.stringify(arb));
  put(root, 'catalog/apps.json', JSON.stringify([{ slug: 'subscriptiontracker', url: WEB, listings: { web: WEB } }]));
  put(root, 'tooling/mail-transport.json', JSON.stringify({ supabaseAuth: { site_url: SITE, uri_allow_list: ALLOW } }));
  for (const [f, body] of Object.entries(sources)) put(root, `${AUTH_MAIL_SOURCE_DIR}/${f}`, body);
  return root;
}

function envFile(lines) {
  const p = join(TMP, `env${seq++}.txt`);
  writeFileSync(p, `${lines.join('\n')}\n`);
  return p;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

/** A fetch routed by URL. `over` replaces a route; a route may be a Response factory. */
function fakeFetch(over = {}) {
  const routes = {
    [`${TARGET}/auth/v1/health`]: () => json({ name: 'GoTrue' }),
    [`${TARGET}/auth/v1/settings`]: () => json(GOOD_SETTINGS),
    [`${TARGET}/auth/v1/.well-known/jwks.json`]: () => json(TARGET_JWKS),
    [`${TARGET}/auth/v1/token?grant_type=password`]: () => json({ code: 400, error_code: 'captcha_failed' }, 400),
    [`${WEB}/main.dart.js`]: () => new Response(`var a="${HOSTED}";var b=${JSON.stringify(BREACHED)};`),
    [MAIL_URL['confirm-signup.html']]: () => new Response(MAIL['confirm-signup.html']),
    [MAIL_URL['magic-link.html']]: () => new Response(MAIL['magic-link.html']),
    [MAIL_URL['reset-password.html']]: () => new Response(MAIL['reset-password.html']),
    // The state read at 17:20Z on 2026-09-24: both Workers on the hosted origin,
    // plain_text, the newest upload the one serving; the JWKS key absent from KV;
    // both health readings ok.
    ...serving('platform', HOSTED),
    ...serving('subscriptiontracker-api', HOSTED),
    [KV_VALUE]: KV_ABSENT,
    [`${CF}/storage/kv/namespaces/${KV_NS}`]: () => json({ success: true, errors: [], result: { id: KV_NS, title: 'jwks-cache' } }),
    [PLATFORM_HEALTH]: () => health(),
    [ST_HEALTH]: () => health(),
    ...over,
  };
  const calls = [];
  const doFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {} });
    // The Cloudflare API answers only a bearer of the fake token, as live answers
    // only the operator's: a token sent any other way is refused.
    if (url.startsWith(CF) && init.headers?.Authorization !== `Bearer ${CF_TOKEN}`) {
      return json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403);
    }
    const r = routes[url];
    return r ? r(init) : new Response('no route', { status: 403 });
  };
  doFetch.calls = calls;
  return doFetch;
}

const SECRETS_OUT = 'SUPABASE_URL 2026-09-25T10:00:00Z\nSUPABASE_ANON_KEY 2026-09-25T10:00:00Z\nSUPABASE_SERVICE_ROLE_KEY 2026-09-25T10:00:00Z\nOTHER 2026-01-01T00:00:00Z\n';
/** A gh routed by the API path in argv[1]. */
function fakeGh({ variable = { status: 0, stdout: 'TURNSTILE_SITE_KEY\n', stderr: '' }, secrets = { status: 0, stdout: SECRETS_OUT, stderr: '' } } = {}) {
  return (args) => (String(args[1]).includes('/actions/variables/') ? variable : secrets);
}
const guardOk = () => ({ status: 0, firstLine: 'ok  platform register' });

describe('C1 CSP — the web connect-src names the auth origin', () => {
  test('pre PASS when connect-src names the target beside the hosted origin', () => {
    const r = checkCsp({ root: makeRoot(), phase: 'pre', target: TARGET });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('pre FAIL when connect-src does not name the target', () => {
    const r = checkCsp({ root: makeRoot({ csp: `default-src 'self'; connect-src 'self' ${HOSTED}` }), phase: 'pre', target: TARGET });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /connect-src does not name https:\/\/auth-api\.example\.test/);
  });

  test('post FAIL when connect-src still names a hosted origin, wss included', () => {
    const r = checkCsp({ root: makeRoot({ csp: `connect-src 'self' ${TARGET} wss://abcdefghijklmnop.supabase.co` }), phase: 'post', target: TARGET });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /still names the hosted origin wss:\/\/abcdefghijklmnop\.supabase\.co/);
  });

  test('post PASS when only the target remains', () => {
    const r = checkCsp({ root: makeRoot({ csp: `connect-src 'self' ${TARGET}/` }), phase: 'post', target: TARGET });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('a CSP that lives only in a comment is no CSP — FAIL', () => {
    const root = makeRoot();
    put(root, 'apps/subscriptiontracker/web/_headers', `# Content-Security-Policy: connect-src ${TARGET}\n/*\n  X-Frame-Options: DENY\n`);
    const r = checkCsp({ root, phase: 'pre', target: TARGET });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /carries no Content-Security-Policy/);
  });

  test('no apps/*/web/_headers at all is LOST, not PASS', () => {
    const r = checkCsp({ root: makeRoot({ csp: null }), phase: 'pre', target: TARGET });
    assert.equal(r.verdict, 'LOST');
  });
});

describe('C2 config agreement — the spawned guard, then the recorded SUPABASE_URL', () => {
  test('pre PASS when the guard exits 0 and the record holds the hosted origin', () => {
    const r = checkConfigAgreement({ root: makeRoot(), phase: 'pre', target: TARGET, runGuard: guardOk });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('pre FAIL when the record already holds the target', () => {
    const r = checkConfigAgreement({ root: makeRoot({ recorded: TARGET }), phase: 'pre', target: TARGET, runGuard: guardOk });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /already hold the target/);
  });

  test('post PASS when the record holds the target; post FAIL when it still holds hosted', () => {
    assert.equal(checkConfigAgreement({ root: makeRoot({ recorded: TARGET }), phase: 'post', target: TARGET, runGuard: guardOk }).verdict, 'PASS');
    assert.equal(checkConfigAgreement({ root: makeRoot(), phase: 'post', target: TARGET, runGuard: guardOk }).verdict, 'FAIL');
  });

  test('the guard exit 1 is FAIL and names its first line', () => {
    const r = checkConfigAgreement({ root: makeRoot(), phase: 'pre', target: TARGET, runGuard: () => ({ status: 1, firstLine: 'x LIMB 5 disagrees' }) });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /exit 1 .*LIMB 5 disagrees/);
  });

  test('the guard exit 2 (or a timeout) is LOST', () => {
    assert.equal(checkConfigAgreement({ root: makeRoot(), phase: 'pre', target: TARGET, runGuard: () => ({ status: 2, firstLine: 'COVERAGE LOST' }) }).verdict, 'LOST');
    assert.equal(checkConfigAgreement({ root: makeRoot(), phase: 'pre', target: TARGET, runGuard: () => ({ status: 124, firstLine: '(no output)' }) }).verdict, 'LOST');
  });

  test('a record with no vars.SUPABASE_URL is LOST', () => {
    const r = checkConfigAgreement({ root: makeRoot({ recorded: null }), phase: 'pre', target: TARGET, runGuard: guardOk });
    assert.equal(r.verdict, 'LOST');
  });
});

describe('C12 keep-alive — the scheduled.ts resolution, mirrored', () => {
  test('keepAliveTargets: the comma list wins, trimmed, slash-normalised, deduped', () => {
    assert.deepEqual(keepAliveTargets({ SUPABASE_KEEPALIVE_URLS: ` ${HOSTED}/ , ${HOSTED},${TARGET}`, SUPABASE_URL: 'https://ignored.test' }), [HOSTED, TARGET]);
  });

  test('keepAliveTargets: an empty list falls back to SUPABASE_URL; nothing set is no target', () => {
    assert.deepEqual(keepAliveTargets({ SUPABASE_KEEPALIVE_URLS: '  ', SUPABASE_URL: `${HOSTED}//` }), [HOSTED]);
    assert.deepEqual(keepAliveTargets({}), []);
  });

  test('pre PASS on a JSONC config with comments and a trailing comma', () => {
    const r = checkKeepAlive({ root: makeRoot(), phase: 'pre', target: TARGET });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('FAIL when the keep-alive resolves to two targets', () => {
    const r = checkKeepAlive({ root: makeRoot({ vars: { SUPABASE_URL: HOSTED, SUPABASE_KEEPALIVE_URLS: `${HOSTED},${TARGET}` } }), phase: 'pre', target: TARGET });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /2 target\(s\)/);
  });

  test('post FAIL when the keep-alive still pings the hosted project', () => {
    const r = checkKeepAlive({ root: makeRoot(), phase: 'post', target: TARGET });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /pings https:\/\/abcdefghijklmnop\.supabase\.co, not the post origin/);
  });
});

describe('C5 captcha posture — served native channels, the live probe, the site-key variable', () => {
  test('servedNativeChannels lists served app channels that are not web, and nothing else', () => {
    const root = makeRoot({ channels: [...CHANNELS, { id: 'windows-direct', surface: 'app', kind: 'direct', platforms: ['windows'], served: true }] });
    assert.deepEqual(servedNativeChannels(root), ['windows-direct']);
  });

  test('captcha ON with a served native channel is FAIL', async () => {
    const root = makeRoot({ channels: [...CHANNELS, { id: 'windows-direct', surface: 'app', kind: 'direct', platforms: ['windows'], served: true }] });
    const r = await checkCaptcha({ root, target: TARGET, anonKey: ANON, doFetch: fakeFetch(), gh: fakeGh() });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /windows-direct/);
  });

  test('captcha ON with the TURNSTILE_SITE_KEY variable absent is FAIL', async () => {
    const gh = fakeGh({ variable: { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' } });
    const r = await checkCaptcha({ root: makeRoot(), target: TARGET, anonKey: ANON, doFetch: fakeFetch(), gh });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /TURNSTILE_SITE_KEY is ABSENT/);
  });

  test('captcha ON, no served native channel, variable present is PASS', async () => {
    const r = await checkCaptcha({ root: makeRoot(), target: TARGET, anonKey: ANON, doFetch: fakeFetch(), gh: fakeGh() });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('captcha OFF (invalid_credentials) is PASS whatever the channels', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/token?grant_type=password`]: () => json({ error_code: 'invalid_credentials' }, 400) });
    const r = await checkCaptcha({ root: makeRoot(), target: TARGET, anonKey: ANON, doFetch, gh: fakeGh() });
    assert.equal(r.verdict, 'PASS', r.detail);
    assert.match(r.detail, /captcha is OFF/);
  });

  test('no anon key is LOST and nothing is posted', async () => {
    const doFetch = fakeFetch();
    const r = await checkCaptcha({ root: makeRoot(), target: TARGET, anonKey: undefined, doFetch, gh: fakeGh() });
    assert.equal(r.verdict, 'LOST');
    assert.equal(doFetch.calls.length, 0);
  });

  test('an unrecognised probe answer is LOST', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/token?grant_type=password`]: () => json({ error_code: 'over_request_rate_limit' }, 400) });
    const r = await checkCaptcha({ root: makeRoot(), target: TARGET, anonKey: ANON, doFetch, gh: fakeGh() });
    assert.equal(r.verdict, 'LOST');
  });
});

describe('C3 / C4 — GoTrue up, and its signing keys', () => {
  test('C3 PASS: health 200, email on, Apple on, apple and google as declared, autoconfirm false, sign-up open', async () => {
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch: fakeFetch(), root: makeRoot() });
    assert.equal(r.verdict, 'PASS', r.detail);
    assert.match(r.detail, /apple and google as AuthProviders\.configured declares \(apple true, google false\)/);
  });

  test('C3 FAIL when Apple sign-in is off', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/settings`]: () => json({ ...GOOD_SETTINGS, external: { email: true, apple: false, google: false } }) });
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch, root: makeRoot() });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /Apple sign-in is OFF/);
  });

  test('C3 FAIL when autoconfirm is on', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/settings`]: () => json({ ...GOOD_SETTINGS, mailer_autoconfirm: true }) });
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch, root: makeRoot() });
    assert.equal(r.verdict, 'FAIL');
  });

  test('C3 LOST without the anon key', async () => {
    const r = await checkGoTrueUp({ target: TARGET, anonKey: '', doFetch: fakeFetch(), root: makeRoot() });
    assert.equal(r.verdict, 'LOST');
  });

  // ── C3's declaration leg (row O-CUTOVER-PREFLIGHT-SKIPS-GOOGLE): Box C's
  // external.apple / external.google against AuthProviders.configured, the
  // judgement ops-watch applies to Box C from the switch on.
  test('C3 FAIL when Box C answers google ON and the app declares it OFF — named, DECLARED DISABLED', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/settings`]: () => json({ ...GOOD_SETTINGS, external: { email: true, apple: true, google: true } }) });
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch, root: makeRoot() });
    assert.equal(r.verdict, 'FAIL', r.detail);
    assert.match(r.detail, /google: DECLARED DISABLED, but the server says ENABLED/);
  });

  test('C3 LOST when Box C carries no boolean external.google — the declaration cannot be checked', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/settings`]: () => json({ ...GOOD_SETTINGS, external: { email: true, apple: true } }) });
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch, root: makeRoot() });
    assert.equal(r.verdict, 'LOST', r.detail);
    assert.match(r.detail, /the live settings response has no boolean `external\.google`/);
  });

  test('C3 FAIL when the root declares google ON and Box C answers it OFF — DECLARED ENABLED', async () => {
    const root = makeRoot({ providers: providersDart({ apple: true, google: true }) });
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch: fakeFetch(), root });
    assert.equal(r.verdict, 'FAIL', r.detail);
    assert.match(r.detail, /google: DECLARED ENABLED, but the server says disabled/);
  });

  test('C3 LOST when the root declaration does not parse — never read as agreement', async () => {
    const root = makeRoot({ providers: 'class AuthProviders {\n  static const AuthProviders configured = AuthProviders.fromEnvironment();\n}\n' });
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch: fakeFetch(), root });
    assert.equal(r.verdict, 'LOST', r.detail);
    assert.match(r.detail, /AuthProviders\.configured could not be parsed out of packages\/auth_supabase\/lib\/src\/auth_providers\.dart/);
  });

  test('C3 LOST when the root has no auth_providers.dart — a read error is a reason, not a crash', async () => {
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch: fakeFetch(), root: makeRoot({ providers: null }) });
    assert.equal(r.verdict, 'LOST', r.detail);
    assert.match(r.detail, /packages\/auth_supabase\/lib\/src\/auth_providers\.dart could not be read \(ENOENT\)/);
  });

  test('C3 LOST without a root — the module never falls back to its own tree', async () => {
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch: fakeFetch() });
    assert.equal(r.verdict, 'LOST', r.detail);
    assert.match(r.detail, /no repo root was given, so AuthProviders\.configured was not read/);
  });

  test('C4 PASS with an ES256 key; FAIL when the JWKS holds only RS256', async () => {
    assert.equal((await checkKeys({ target: TARGET, anonKey: ANON, doFetch: fakeFetch() })).verdict, 'PASS');
    const rs = fakeFetch({ [`${TARGET}/auth/v1/.well-known/jwks.json`]: () => json({ keys: [{ kty: 'RSA', alg: 'RS256', kid: 'r' }] }) });
    const r = await checkKeys({ target: TARGET, anonKey: ANON, doFetch: rs });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /none ES256/);
  });

  test('C4 LOST when the JWKS route answers 403', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/.well-known/jwks.json`]: () => new Response('no', { status: 403 }) });
    assert.equal((await checkKeys({ target: TARGET, anonKey: ANON, doFetch })).verdict, 'LOST');
  });
});

describe('C6 / C7 — the redirect list and the served templates', () => {
  test('C6 PASS when the allow list is the same set in another order and the site URL matches', () => {
    const env = { values: { GOTRUE_URI_ALLOW_LIST: 'http://localhost:3000/**, https://example.test/subscriptiontracker/**', GOTRUE_SITE_URL: `${SITE}/` }, missing: [] };
    const r = checkRedirects({ root: makeRoot(), env });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('C6 FAIL when a recorded redirect is missing from the server', () => {
    const env = { values: { GOTRUE_URI_ALLOW_LIST: 'http://localhost:3000/**', GOTRUE_SITE_URL: SITE }, missing: [] };
    const r = checkRedirects({ root: makeRoot(), env });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /1 recorded entr\(ies\) missing/);
  });

  test('C6 LOST without an env dump, and LOST when the dump lacks the key', () => {
    assert.equal(checkRedirects({ root: makeRoot(), env: null }).verdict, 'LOST');
    assert.equal(checkRedirects({ root: makeRoot(), env: { values: { GOTRUE_SITE_URL: SITE }, missing: [] } }).verdict, 'LOST');
  });

  test('C7 PASS when all three served templates equal their sources', async () => {
    const r = await checkTemplates({ root: makeRoot(), env: null, doFetch: fakeFetch() });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('C7 FAIL when one served template differs', async () => {
    const doFetch = fakeFetch({ [MAIL_URL['magic-link.html']]: () => new Response('<p>stale</p>\n') });
    const r = await checkTemplates({ root: makeRoot(), env: null, doFetch });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /magic-link\.html FAIL/);
  });

  test('C7 reads the URL the env dump configures, not the planned one', async () => {
    const other = 'https://mirror.example.test/confirm.html';
    const doFetch = fakeFetch({ [other]: () => new Response(MAIL['confirm-signup.html']) });
    const env = { values: { GOTRUE_MAILER_TEMPLATES_CONFIRMATION: other }, missing: [] };
    const r = await checkTemplates({ root: makeRoot(), env, doFetch });
    assert.equal(r.verdict, 'PASS', r.detail);
    assert.ok(doFetch.calls.some((c) => c.url === other));
  });
});

describe('C8 secret names — names only, and post needs a window', () => {
  test('pre PASS when all three repo secrets exist', () => {
    const r = checkSecretNames({ phase: 'pre', gh: fakeGh() });
    assert.equal(r.verdict, 'PASS');
    // CRD-4: the PASS text said these names were C9's input; C9 reads only each
    // Worker's SUPABASE_URL binding through the Cloudflare API.
    assert.match(r.detail, /C9 reads none of these: it reads only each Worker's SUPABASE_URL binding/);
  });

  test('FAIL when a repo secret is absent', () => {
    const gh = fakeGh({ secrets: { status: 0, stdout: 'SUPABASE_URL 2026-09-25T10:00:00Z\n', stderr: '' } });
    const r = checkSecretNames({ phase: 'pre', gh });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY/);
  });

  test('post LOST without --window-start; post FAIL when a secret predates it', () => {
    assert.equal(checkSecretNames({ phase: 'post', gh: fakeGh() }).verdict, 'LOST');
    const r = checkSecretNames({ phase: 'post', windowStart: '2026-09-26T00:00:00Z', gh: fakeGh() });
    assert.equal(r.verdict, 'FAIL');
  });

  test('a gh failure is LOST', () => {
    assert.equal(checkSecretNames({ phase: 'pre', gh: fakeGh({ secrets: { status: 1, stdout: '', stderr: 'boom' } }) }).verdict, 'LOST');
  });
});

// ── C9 / C10 / C11 ──────────────────────────────────────────────────────────
/** Every text a check produced, for the never-printed assertions. */
const said = (r) => `${r.verdict} ${r.detail}`;
const assertNothingSecret = (text) => {
  assert.ok(!text.includes(CF_TOKEN), 'the Cloudflare token must never be printed');
  assert.ok(!text.includes(CF_ACCOUNT), 'the Cloudflare account id must never be printed');
  assert.ok(!text.includes(KEY_X), 'JWKS key material must never be printed');
};
const cfCalls = (calls) => calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/'));

/** C9 as runPreflight chains it: the active deployment's read, then the grade. */
async function c9({ root = makeRoot(), phase = 'pre', over = {}, env = CF_ENV } = {}) {
  const doFetch = fakeFetch(over);
  const fleet = cutoverWorkers(root);
  const reads = await readWorkerVars({ workers: fleet.workers, cf: cloudflareCreds(env), doFetch });
  return { ...checkWorkerVars({ root, phase, target: TARGET, fleet, reads }), calls: doFetch.calls };
}

/** C10 as runPreflight chains it: the target JWKS read once, then the KV read. */
async function c10({ root = makeRoot(), phase = 'pre', over = {}, env = CF_ENV } = {}) {
  const doFetch = fakeFetch(over);
  const jwks = await readTargetJwks({ target: TARGET, anonKey: ANON, doFetch });
  const r = await checkKv({ phase, fleet: cutoverWorkers(root), kvKey: jwksKvKey(root), cf: cloudflareCreds(env), jwks, doFetch });
  return { ...r, calls: doFetch.calls };
}

/** C11 as runPreflight chains it: C9's active-deployment read, then each health route. */
async function c11({ root = makeRoot(), phase = 'pre', over = {}, env = CF_ENV } = {}) {
  const doFetch = fakeFetch(over);
  const fleet = cutoverWorkers(root);
  const reads = await readWorkerVars({ workers: fleet.workers, cf: cloudflareCreds(env), doFetch });
  return { ...await checkWorkersHealth({ phase, target: TARGET, fleet, reads, doFetch }), calls: doFetch.calls };
}

const bothServing = (text, type) => ({ ...serving('platform', text, type), ...serving('subscriptiontracker-api', text, type) });
const bothRolledBack = (states) => ({ ...rolledBack('platform', states), ...rolledBack('subscriptiontracker-api', states) });

describe('C9-C11 inputs — the Workers, the namespace and the key are derived, never listed', () => {
  test('every config that binds JWKS_CACHE, by name, with the custom domain named after it', () => {
    assert.deepEqual(cutoverWorkers(makeRoot()).workers, [
      { config: 'services/platform/wrangler.jsonc', script: 'platform', namespace: KV_NS, host: 'platform.example.test' },
      { config: 'services/subscriptiontracker-api/wrangler.jsonc', script: 'subscriptiontracker-api', namespace: KV_NS, host: 'subscriptiontracker-api.example.test' },
    ]);
    assert.equal(jwksKvKey(makeRoot()), KV_KEY);
  });

  test('the REAL tree derives the two Workers the switch moves, their public hosts and the KV key', () => {
    const real = cutoverWorkers(REPO);
    assert.equal(real.lost, undefined, real.lost);
    assert.deepEqual(real.workers.map((w) => [w.script, w.host]), [
      ['platform', 'platform.nikatru.com'],
      ['subscriptiontracker-api', 'subscriptiontracker-api.nikatru.com'],
    ]);
    assert.equal(new Set(real.workers.map((w) => w.namespace)).size, 1, 'both Workers bind ONE JWKS_CACHE namespace');
    assert.equal(jwksKvKey(REPO), 'supabase_jwks');
  });

  test('no config binding JWKS_CACHE is LOST for all three, never PASS', async () => {
    const root = makeRoot({ jwksCache: false });
    assert.match(cutoverWorkers(root).lost, /no services\/\*\/wrangler\.jsonc binds JWKS_CACHE/);
    const fleet = cutoverWorkers(root);
    assert.equal(checkWorkerVars({ root, phase: 'pre', target: TARGET, fleet, reads: [] }).verdict, 'LOST');
    assert.equal((await checkKv({ phase: 'pre', fleet, kvKey: KV_KEY, cf: cloudflareCreds(CF_ENV), doFetch: fakeFetch() })).verdict, 'LOST');
    assert.equal((await checkWorkersHealth({ phase: 'pre', target: TARGET, fleet, doFetch: fakeFetch() })).verdict, 'LOST');
  });

  test('cloudflareCreds names whichever of the two is absent, from the environment only', () => {
    assert.match(cloudflareCreds({}).lost, /CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not in the environment/);
    assert.match(cloudflareCreds({ CLOUDFLARE_API_TOKEN: CF_TOKEN }).lost, /^CLOUDFLARE_ACCOUNT_ID is not in the environment$/);
    assert.deepEqual(cloudflareCreds(CF_ENV), { token: CF_TOKEN, account: CF_ACCOUNT });
  });
});

describe('C9 live Worker vars — SUPABASE_URL as each Worker ACTIVE deployment serves it', () => {
  const settingsCalls = (calls) => calls.filter((c) => c.url.endsWith('/settings'));

  test('pre PASS: both Workers serve the hosted origin C2 reads, as plain_text, read from the active deployment, the token in the header', async () => {
    const r = await c9();
    assert.equal(r.verdict, 'PASS', r.detail);
    assert.match(r.detail, /plain_text https:\/\/abcdefghijklmnop\.supabase\.co \(the pre origin\) on platform, subscriptiontracker-api, read from each ACTIVE deployment: platform a1a1a1a1 \(100%\), subscriptiontracker-api a1a1a1a1 \(100%\)/);
    // Per Worker: /deployments, /versions/<the serving id>, /versions (the newest).
    assert.deepEqual(cfCalls(r.calls).map((c) => c.url.slice(CF.length)), [
      '/workers/scripts/platform/deployments',
      `/workers/scripts/platform/versions/${V_ACTIVE}`,
      '/workers/scripts/platform/versions',
      '/workers/scripts/subscriptiontracker-api/deployments',
      `/workers/scripts/subscriptiontracker-api/versions/${V_ACTIVE}`,
      '/workers/scripts/subscriptiontracker-api/versions',
    ]);
    assert.ok(cfCalls(r.calls).every((c) => c.headers.Authorization === `Bearer ${CF_TOKEN}`));
    // The newest upload is the one serving: nothing to name.
    assert.doesNotMatch(r.detail, /newest UPLOADED/);
    assertNothingSecret(said(r));
  });

  test('post PASS when both Workers serve the target', async () => {
    const r = await c9({ phase: 'post', over: bothServing(`${TARGET}/`) });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('pre FAIL when one Worker serves another origin, and it names that Worker and the version', async () => {
    const r = await c9({ over: serving('subscriptiontracker-api', 'https://other.example.test') });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /subscriptiontracker-api: SUPABASE_URL is https:\/\/other\.example\.test, not the pre origin https:\/\/abcdefghijklmnop\.supabase\.co \(active version a1a1a1a1 \(100%\)\)/);
    assert.match(r.detail, /platform: plain_text/);
  });

  test('FAIL on a secret_text binding, and on a missing one — the design says plain_text', async () => {
    const secret = await c9({ over: serving('platform', HOSTED, 'secret_text') });
    assert.equal(secret.verdict, 'FAIL');
    assert.match(secret.detail, /platform: SUPABASE_URL is secret_text, whose value is never returned — the design says plain_text/);
    const missing = await c9({ over: serving('platform', null) });
    assert.equal(missing.verdict, 'FAIL');
    assert.match(missing.detail, /platform: no SUPABASE_URL binding — the design says plain_text/);
  });

  test('pre FAIL when the active deployment splits traffic and one serving version holds another origin — that version is named', async () => {
    const r = await c9({
      over: {
        [`${CF}/workers/scripts/platform/deployments`]: () => deploymentsOf([[V_ACTIVE, 90], [V_CANARY, 10]]),
        [`${CF}/workers/scripts/platform/versions/${V_CANARY}`]: () => versionOf(V_CANARY, TARGET),
        [`${CF}/workers/scripts/platform/versions`]: () => versionsList(V_CANARY, V_ACTIVE),
      },
    });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /platform: version a1a1a1a1 \(90%\) plain_text https:\/\/abcdefghijklmnop\.supabase\.co, version c3c3c3c3 \(10%\) SUPABASE_URL is https:\/\/auth-api\.example\.test, not the pre origin/);
    // The newest upload serves 10%: it is one that serves, so it is not named apart.
    assert.doesNotMatch(r.detail, /newest UPLOADED/);
  });

  test('LOST without the token, with the reason — and no Cloudflare call is made', async () => {
    const r = await c9({ env: { CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT } });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /platform: CLOUDFLARE_API_TOKEN is not in the environment/);
    assert.equal(cfCalls(r.calls).length, 0);
  });

  test('LOST when Cloudflare refuses the token (HTTP 403), quoting its error code, never the account id', async () => {
    const r = await c9({ env: { CLOUDFLARE_API_TOKEN: 'tok-FAKE-REVOKED', CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT } });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /GET \/accounts\/<account>\/workers\/scripts\/platform\/deployments answered HTTP 403 \(10000 Authentication error\)/);
    assertNothingSecret(said(r));
  });

  test('LOST on a network error, and a message that carries the URL is scrubbed of the account id', { timeout: 30_000 }, async () => {
    const r = await c9({ over: { [`${CF}/workers/scripts/platform/deployments`]: () => { throw new TypeError(`fetch failed: ${CF}/workers/scripts/platform/deployments`); } } });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /platform: GET \/accounts\/<account>\/workers\/scripts\/platform\/deployments failed/);
    assert.match(r.detail, /the same on all 3 attempt\(s\)/);
    assertNothingSecret(said(r));
  });

  test('LOST, never PASS, when any of the three reads cannot say what serves or what was uploaded last', async () => {
    const noList = await c9({ over: { [`${CF}/workers/scripts/platform/deployments`]: () => json({ success: true, errors: [], result: {} }) } });
    assert.equal(noList.verdict, 'LOST');
    assert.match(noList.detail, /platform: GET \/accounts\/<account>\/workers\/scripts\/platform\/deployments: no result\.deployments\[\] in a successful answer/);
    const none = await c9({ over: { [`${CF}/workers/scripts/platform/deployments`]: () => json({ success: true, errors: [], result: { deployments: [] } }) } });
    assert.equal(none.verdict, 'LOST');
    assert.match(none.detail, /platform: .*no deployment is listed/);
    const noShare = await c9({ over: { [`${CF}/workers/scripts/platform/deployments`]: () => deploymentsOf([[V_ACTIVE, 0]]) } });
    assert.equal(noShare.verdict, 'LOST');
    assert.match(noShare.detail, /the active deployment d1d1d1d1 names no version with a traffic share/);
    const version = await c9({ over: { [`${CF}/workers/scripts/platform/versions/${V_ACTIVE}`]: () => json({ success: false, errors: [{ code: 10007, message: 'version not found' }] }, 404) } });
    assert.equal(version.verdict, 'LOST');
    assert.match(version.detail, /platform: GET \/accounts\/<account>\/workers\/scripts\/platform\/versions\/a1a1a1a1-0000-4000-8000-000000000001 answered HTTP 404 \(10007 version not found\)/);
    const newest = await c9({ over: { [`${CF}/workers/scripts/subscriptiontracker-api/versions`]: () => json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403) } });
    assert.equal(newest.verdict, 'LOST');
    assert.match(newest.detail, /subscriptiontracker-api: the newest uploaded version could not be read: GET \/accounts\/<account>\/workers\/scripts\/subscriptiontracker-api\/versions answered HTTP 403/);
    assertNothingSecret([noList, none, noShare, version, newest].map(said).join('\n'));
  });

  test('🔴 RED CONTROL — after a rollback, /settings answers the newest UPLOAD (the target) while the active deployment serves hosted: pre PASS on what serves, and both ids are named', async () => {
    // The live state of 2026-09-26 05:45-06:26Z: C13.5 read /settings and refused
    // at C9 while both Workers served hosted. Restoring that read turns this red.
    const r = await c9({ over: bothRolledBack({ active: HOSTED, newest: TARGET }) });
    assert.equal(r.verdict, 'PASS', r.detail);
    assert.match(r.detail, /plain_text https:\/\/abcdefghijklmnop\.supabase\.co \(the pre origin\) on platform, subscriptiontracker-api, read from each ACTIVE deployment: platform a1a1a1a1 \(100%\), subscriptiontracker-api a1a1a1a1 \(100%\)/);
    assert.match(r.detail, /platform: the newest UPLOADED version b2b2b2b2, uploaded 2026-09-26T06:26:36Z is NOT the active a1a1a1a1 \(100%\) — the next `wrangler deploy` keeps its secret_text bindings, not the active one's/);
    assert.match(r.detail, /subscriptiontracker-api: the newest UPLOADED version b2b2b2b2/);
    assert.equal(settingsCalls(r.calls).length, 0, 'C9 must not read /settings: it answers the newest upload, not what serves');
    assert.equal(r.calls.filter((c) => c.url.endsWith(`/versions/${V_NEWEST}`)).length, 0, 'the newest upload is named, never graded');
    assertNothingSecret(said(r));
  });

  test('post FAIL in the same rolled-back state: the switch is not what serves, whatever the newest upload holds', async () => {
    const r = await c9({ phase: 'post', over: bothRolledBack({ active: HOSTED, newest: TARGET }) });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /platform: SUPABASE_URL is https:\/\/abcdefghijklmnop\.supabase\.co, not the post origin https:\/\/auth-api\.example\.test \(active version a1a1a1a1 \(100%\)\)/);
    assert.match(r.detail, /platform: the newest UPLOADED version b2b2b2b2, uploaded 2026-09-26T06:26:36Z is NOT the active a1a1a1a1/);
  });

  test('🔴 RED CONTROL — post, the active version stubbed to serve the HOSTED origin, turns C9 red', async () => {
    const green = await c9({ phase: 'post', over: bothServing(TARGET) });
    assert.equal(green.verdict, 'PASS', `green control: ${green.detail}`);
    const red = await c9({ phase: 'post', over: bothServing(HOSTED) });
    assert.equal(red.verdict, 'FAIL');
    assert.match(red.detail, /platform: SUPABASE_URL is https:\/\/abcdefghijklmnop\.supabase\.co, not the post origin https:\/\/auth-api\.example\.test/);
  });
});

describe('C10 KV — the cached JWKS in JWKS_CACHE, kids and algorithms only', () => {
  test('absent (404 in a namespace that exists) is PASS in pre and in post — the cache fills lazily', async () => {
    const pre = await c10();
    assert.equal(pre.verdict, 'PASS', pre.detail);
    assert.match(pre.detail, /supabase_jwks is absent from namespace ns-FAKE-jwks-cache \(HTTP 404; the namespace exists\)/);
    assert.equal((await c10({ phase: 'post' })).verdict, 'PASS');
  });

  test('pre PASS whatever kids are cached, naming kids and algorithms, never key material', async () => {
    const r = await c10({ over: { [KV_VALUE]: () => new Response(JSON.stringify(HOSTED_JWKS)) } });
    assert.equal(r.verdict, 'PASS', r.detail);
    assert.match(r.detail, /caches 1 key\(s\): hosted-k0 ES256/);
    assertNothingSecret(said(r));
  });

  test('post PASS when every cached kid is one the target serves', async () => {
    const r = await c10({ phase: 'post', over: { [KV_VALUE]: () => new Response(JSON.stringify(TARGET_JWKS)) } });
    assert.equal(r.verdict, 'PASS', r.detail);
    assert.match(r.detail, /every kid cached in supabase_jwks .* is served by the target: k1 ES256/);
  });

  test('post FAIL when a kid the target does not serve is cached beside one it does, and only that kid is named', async () => {
    const mixed = { keys: [...TARGET_JWKS.keys, ...HOSTED_JWKS.keys] };
    const r = await c10({ phase: 'post', over: { [KV_VALUE]: () => new Response(JSON.stringify(mixed)) } });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /still caches kid\(s\) the target does not serve: hosted-k0 ES256 — the Workers keep accepting/);
    assert.doesNotMatch(r.detail, /serve: k1/);
    assertNothingSecret(said(r));
  });

  test('LOST without the account id, with the reason — and no Cloudflare call is made', async () => {
    const r = await c10({ env: { CLOUDFLARE_API_TOKEN: CF_TOKEN } });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /the supabase_jwks key in JWKS_CACHE: CLOUDFLARE_ACCOUNT_ID is not in the environment/);
    assert.equal(cfCalls(r.calls).length, 0);
  });

  test('LOST, not absent, when the 404 comes with a namespace that cannot be confirmed', async () => {
    const r = await c10({ over: { [`${CF}/storage/kv/namespaces/${KV_NS}`]: () => json({ success: false, errors: [{ code: 10013, message: 'namespace not found' }] }, 404) } });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /answered HTTP 404, and the namespace could not be confirmed: .*HTTP 404 \(10013 namespace not found\)/);
  });

  test('post LOST when the target JWKS (C4 read) could not be read; a cached value that is not a JWKS is LOST', async () => {
    const noTarget = await c10({ phase: 'post', over: { [`${TARGET}/auth/v1/.well-known/jwks.json`]: () => new Response('no', { status: 403 }) } });
    assert.equal(noTarget.verdict, 'LOST');
    assert.match(noTarget.detail, /post compares the cached kids with the target's JWKS, and that read failed: .*HTTP 403/);
    const garbage = await c10({ over: { [KV_VALUE]: () => new Response('<html>') } });
    assert.equal(garbage.verdict, 'LOST');
    assert.match(garbage.detail, /is not JSON/);
  });

  test('LOST when services/_shared/src/auth.ts declares no JWKS_KV_KEY', async () => {
    const r = await c10({ root: makeRoot({ kvKeySource: 'export const OTHER_KEY = 1;\n' }) });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /declares no JWKS_KV_KEY/);
  });

  test('🔴 RED CONTROL — post, the KV stubbed to return the HOSTED JWKS, turns C10 red', async () => {
    const green = await c10({ phase: 'post', over: { [KV_VALUE]: () => new Response(JSON.stringify(TARGET_JWKS)) } });
    assert.equal(green.verdict, 'PASS', `green control: ${green.detail}`);
    const red = await c10({ phase: 'post', over: { [KV_VALUE]: () => new Response(JSON.stringify(HOSTED_JWKS)) } });
    assert.equal(red.verdict, 'FAIL');
    assert.match(red.detail, /hosted-k0 ES256/);
  });
});

describe('C11 Workers health — the checks[] entry supabase_jwks on each Worker host', () => {
  test('pre PASS: both hosts answer supabase_jwks ok, and no token is needed', async () => {
    const r = await c11({ env: {} });
    assert.equal(r.verdict, 'PASS', r.detail);
    assert.match(r.detail, /platform\.example\.test supabase_jwks ok, ageMs 0; subscriptiontracker-api\.example\.test supabase_jwks ok, ageMs 0/);
    assert.deepEqual(r.calls.map((c) => c.url).filter((u) => u.endsWith('/v1/health')), [PLATFORM_HEALTH, ST_HEALTH]);
  });

  test('FAIL on any other status, quoting the reason', async () => {
    const r = await c11({ over: { [ST_HEALTH]: () => health('degraded', 'jwks_unavailable') } });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /subscriptiontracker-api\.example\.test supabase_jwks is "degraded" \(reason "jwks_unavailable", ageMs 0\)/);
  });

  test('LOST when checks[] has no supabase_jwks entry — a top-level field of that name is not the entry', async () => {
    const body = { ok: true, status: 'ok', supabase_jwks: 'ok', checks: [{ name: 'platform_db', status: 'ok', reason: null, ageMs: 0 }] };
    const r = await c11({ over: { [PLATFORM_HEALTH]: () => json(body) } });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /platform\.example\.test\/v1\/health: checks\[\] has no supabase_jwks entry/);
  });

  test('LOST on a network error (a host that does not resolve), with the reason', { timeout: 30_000 }, async () => {
    const r = await c11({ over: { [PLATFORM_HEALTH]: () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } } });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /GET https:\/\/platform\.example\.test\/v1\/health failed/);
  });

  test('LOST when a Worker config has no custom domain named after it — no host is guessed', async () => {
    const root = makeRoot();
    put(root, 'services/subscriptiontracker-api/wrangler.jsonc', `{ "name": "subscriptiontracker-api", "kv_namespaces": [{ "binding": "JWKS_CACHE", "id": "${KV_NS}" }], "routes": [{ "pattern": "api.example.test", "custom_domain": true }] }\n`);
    const r = await c11({ root });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /subscriptiontracker-api: services\/subscriptiontracker-api\/wrangler\.jsonc has no custom-domain route whose first label is subscriptiontracker-api/);
  });

  test('post LOST when C9 could not read which origin a Worker holds — the route names none', async () => {
    const r = await c11({ phase: 'post', env: {} });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /the route names no origin and C9 could not read which SUPABASE_URL platform holds \(CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not in the environment\)/);
  });

  test('post LOST when the active deployment splits traffic across versions whose origins differ — the ok is not attributed to either', async () => {
    const r = await c11({
      phase: 'post',
      over: {
        ...bothServing(TARGET),
        [`${CF}/workers/scripts/platform/deployments`]: () => deploymentsOf([[V_ACTIVE, 50], [V_CANARY, 50]]),
        [`${CF}/workers/scripts/platform/versions/${V_CANARY}`]: () => versionOf(V_CANARY, HOSTED),
      },
    });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /C9 could not read which SUPABASE_URL platform holds \(the active deployment d1d1d1d1 splits traffic across versions whose SUPABASE_URL differs\)/);
    assert.match(r.detail, /subscriptiontracker-api\.example\.test supabase_jwks ok, ageMs 0, and C9 read subscriptiontracker-api as holding the target/);
  });

  test('🔴 RED CONTROL — post, the active version stubbed to serve the HOSTED origin, turns the same ok readings red', async () => {
    const green = await c11({ phase: 'post', over: bothServing(TARGET) });
    assert.equal(green.verdict, 'PASS', `green control: ${green.detail}`);
    const red = await c11({ phase: 'post', over: bothServing(HOSTED) });
    assert.equal(red.verdict, 'FAIL');
    assert.match(red.detail, /platform\.example\.test supabase_jwks ok, ageMs 0, but C9 read platform as holding https:\/\/abcdefghijklmnop\.supabase\.co, not the target/);
  });
});

describe('C13 / C14 — the deployed bundle and the gates', () => {
  const bundle = { url: `${WEB}/main.dart.js`, text: `var a="${HOSTED}";var b=${JSON.stringify(BREACHED)};` };

  test('C13 pre PASS when the bundle names the hosted origin; post FAIL on the same bundle', () => {
    assert.equal(checkWebBuild({ root: makeRoot(), phase: 'pre', target: TARGET, bundle }).verdict, 'PASS');
    assert.equal(checkWebBuild({ root: makeRoot(), phase: 'post', target: TARGET, bundle }).verdict, 'FAIL');
  });

  test('C13 LOST when the bundle could not be fetched', () => {
    assert.equal(checkWebBuild({ root: makeRoot(), phase: 'pre', target: TARGET, bundle: { lost: 'HTTP 403' } }).verdict, 'LOST');
  });

  test('C14 FAIL when the arb has no passwordBreached copy', () => {
    const r = checkGates({ root: makeRoot({ arb: { passwordTooShort: 'Too short' } }), bundle, attest: ['apple-return-url'] });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /has no passwordBreached copy/);
  });

  test('C14 PASS when the bundle carries the copy and the Apple return URL is attested', () => {
    const r = checkGates({ root: makeRoot(), bundle, attest: ['apple-return-url'] });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('C14 FAIL when the bundle lacks the copy', () => {
    const r = checkGates({ root: makeRoot(), bundle: { url: bundle.url, text: 'var a=1;' }, attest: ['apple-return-url'] });
    assert.equal(r.verdict, 'FAIL');
  });

  test('C14 LOST without the attestation — never PASS', () => {
    const r = checkGates({ root: makeRoot(), bundle, attest: [] });
    assert.equal(r.verdict, 'LOST');
    assert.match(r.detail, /--attest apple-return-url/);
  });
});

describe('the exit rule — FAIL (1) outranks LOST (2); the head line names the decider', () => {
  const row = (id, verdict) => ({ id, name: `check ${id}`, verdict, detail: '' });

  test('all PASS is exit 0 and READY', () => {
    const g = gradeRun([row('C1', 'PASS'), row('C2', 'PASS')], 'pre');
    assert.equal(g.code, 0);
    assert.match(g.head, /READY — all 2 checks PASS/);
  });

  test('a LOST with no FAIL is exit 2 and names the first LOST', () => {
    const g = gradeRun([row('C1', 'PASS'), row('C4', 'LOST'), row('C9', 'LOST')], 'pre');
    assert.equal(g.code, 2);
    assert.match(g.head, /COVERAGE LOST first at C4 check C4/);
  });

  test('a FAIL after a LOST is still exit 1 and names the FAIL', () => {
    const g = gradeRun([row('C3', 'LOST'), row('C7', 'FAIL')], 'post');
    assert.equal(g.code, 1);
    assert.match(g.head, /--phase post: REFUSED by C7 check C7 \(FAIL\)/);
    assert.match(g.summary, /0 PASS · 1 FAIL · 1 LOST → exit 1/);
  });
});

describe('runPreflight — all fourteen, end to end on a fixture', () => {
  const full = (root, over = {}) => runPreflight({
    root,
    phase: 'pre',
    target: TARGET,
    boxcEnvFile: envFile([`GOTRUE_SITE_URL=${SITE}`, `GOTRUE_URI_ALLOW_LIST="${ALLOW}"`]),
    attest: ['apple-return-url'],
    env: { SELFHOSTED_SUPABASE_ANON_KEY: ANON, ...CF_ENV },
    doFetch: fakeFetch(),
    gh: fakeGh(),
    runGuard: guardOk,
    ...over,
  });

  test('a ready pre state with a Cloudflare token (the state read at 17:20Z): all fourteen PASS, exit 0 — no credential printed', async () => {
    const r = await full(makeRoot());
    const text = r.lines.join('\n');
    assert.equal(r.results.length, 14);
    assert.deepEqual(r.results.map((x) => x.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14']);
    assert.deepEqual(r.results.filter((x) => x.verdict !== 'PASS').map((x) => x.id), [], text);
    assert.equal(r.code, 0);
    assert.match(r.lines[0], /--phase pre: READY — all 14 checks PASS/);
    assert.match(r.lines.at(-1), /14 PASS · 0 FAIL · 0 LOST → exit 0/);
    assert.ok(!text.includes(ANON), 'the anon key must never be printed');
    assertNothingSecret(text);
    assert.match(text, /SELFHOSTED_SUPABASE_ANON_KEY len=27 sha256:[0-9a-f]{8}/);
    assert.match(text, /CLOUDFLARE_API_TOKEN set · CLOUDFLARE_ACCOUNT_ID len=20 sha256:[0-9a-f]{8}/);
    // Not even a fingerprint of the token: CodeQL js/insufficient-password-hash.
    assert.doesNotMatch(text, /CLOUDFLARE_API_TOKEN len=/);
  });

  test('the same state without a Cloudflare token: C9 and C10 LOST with the reason, C11 still read, exit 2', async () => {
    const r = await full(makeRoot(), { env: { SELFHOSTED_SUPABASE_ANON_KEY: ANON } });
    assert.deepEqual(r.results.filter((x) => x.verdict !== 'PASS').map((x) => x.id), ['C9', 'C10'], r.lines.join('\n'));
    assert.equal(r.code, 2);
    assert.match(r.lines[0], /COVERAGE LOST first at C9 live Worker vars/);
    assert.match(r.lines.find((l) => l.startsWith('LOST  C9')), /CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not in the environment/);
    assert.match(r.lines.at(-1), /12 PASS · 0 FAIL · 2 LOST → exit 2/);
    assert.match(r.lines.join('\n'), /CLOUDFLARE_API_TOKEN NOT SET · CLOUDFLARE_ACCOUNT_ID NOT SET/);
  });

  test('after a rollback (the Phase 5 read-back, C13.5): pre reads what SERVES — all fourteen PASS, exit 0 — and the C9 line names the newest upload that does not', async () => {
    const r = await full(makeRoot(), { doFetch: fakeFetch(bothRolledBack({ active: HOSTED, newest: TARGET })) });
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.match(r.lines[0], /--phase pre: READY — all 14 checks PASS/);
    const c9line = r.lines.find((l) => l.startsWith('PASS  C9'));
    assert.match(c9line, /read from each ACTIVE deployment: platform a1a1a1a1 \(100%\), subscriptiontracker-api a1a1a1a1 \(100%\)/);
    assert.match(c9line, /platform: the newest UPLOADED version b2b2b2b2, uploaded 2026-09-26T06:26:36Z is NOT the active a1a1a1a1 \(100%\)/);
    assertNothingSecret(r.lines.join('\n'));
  });

  test('C4 and C10 share ONE read of the target JWKS', async () => {
    const doFetch = fakeFetch({ [KV_VALUE]: () => new Response(JSON.stringify(TARGET_JWKS)) });
    const r = await full(makeRoot(), { phase: 'post', doFetch });
    assert.equal(r.results.find((x) => x.id === 'C10').verdict, 'PASS', r.lines.join('\n'));
    assert.equal(doFetch.calls.filter((c) => c.url === `${TARGET}/auth/v1/.well-known/jwks.json`).length, 1);
  });

  test('🔴 RED CONTROL end to end — post against the hosted state: C9, C10 and C11 all FAIL, exit 1', async () => {
    const doFetch = fakeFetch({ [KV_VALUE]: () => new Response(JSON.stringify(HOSTED_JWKS)) });
    const r = await full(makeRoot(), { phase: 'post', doFetch });
    const byId = Object.fromEntries(r.results.map((x) => [x.id, x.verdict]));
    assert.deepEqual([byId.C9, byId.C10, byId.C11], ['FAIL', 'FAIL', 'FAIL'], r.lines.join('\n'));
    assert.equal(r.code, 1);
    assertNothingSecret(r.lines.join('\n'));
  });

  test('C3 reads the declaration of the root it was given: Box C google ON against the fixture OFF refuses at C3, exit 1', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/settings`]: () => json({ ...GOOD_SETTINGS, external: { email: true, apple: true, google: true } }) });
    const r = await full(makeRoot(), { doFetch });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.match(r.lines[0], /--phase pre: REFUSED by C3 GoTrue up \(FAIL\)/);
    assert.match(r.lines.find((l) => l.startsWith('FAIL  C3')), /google: DECLARED DISABLED/);
  });

  test('one FAIL refuses the switch with exit 1 and names it first', async () => {
    const r = await full(makeRoot({ csp: `connect-src 'self' ${HOSTED}` }));
    assert.equal(r.code, 1);
    assert.match(r.lines[0], /--phase pre: REFUSED by C1 CSP \(FAIL\)/);
    assert.match(r.lines.find((l) => l.startsWith('FAIL  C1')), /does not name/);
  });

  test('no credentials, no env dump, no attestation: those checks are LOST, none PASS', async () => {
    const r = await full(makeRoot(), { env: {}, boxcEnvFile: undefined, attest: [] });
    const lost = r.results.filter((x) => x.verdict === 'LOST').map((x) => x.id);
    // C11 needs no credential: the health routes are public.
    assert.deepEqual(lost, ['C3', 'C5', 'C6', 'C9', 'C10', 'C14']);
    assert.equal(r.code, 2);
  });

  test('a missing env dump file is LOST for C6, with the reason', async () => {
    const r = await full(makeRoot(), { boxcEnvFile: join(TMP, 'no-such-env.txt') });
    const c6 = r.results.find((x) => x.id === 'C6');
    assert.equal(c6.verdict, 'LOST');
    assert.match(c6.detail, /does not exist/);
  });
});

describe('the CLI — usage errors are exit 2 before any look', () => {
  test('parseArgs refuses a phase that is not pre or post, and an unknown attestation', () => {
    assert.match(parseArgs(['--phase', 'mid']).error, /--phase must be pre or post/);
    assert.match(parseArgs(['--phase', 'pre', '--attest', 'anything']).error, /--attest knows only apple-return-url/);
    assert.match(parseArgs(['--phase']).error, /needs a value/);
  });

  test('parseArgs carries every value flag', () => {
    const o = parseArgs(['--phase', 'post', '--target', TARGET, '--boxc-env', 'e.txt', '--attest', 'apple-return-url', '--window-start', '2026-09-25T00:00:00Z', 'rootdir']);
    assert.equal(o.phase, 'post');
    assert.equal(o.target, TARGET);
    assert.equal(o.boxcEnvFile, 'e.txt');
    assert.deepEqual(o.attest, ['apple-return-url']);
    assert.equal(o.windowStart, '2026-09-25T00:00:00Z');
    assert.equal(o.root, resolve('rootdir'));
  });

  test('the CLI exits 2 with the usage on a bad phase', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--phase', 'mid'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /usage: node tooling\/ops\/auth-cutover-preflight\.mjs --phase pre\|post/);
    assert.equal(r.stdout, '');
  });
});
