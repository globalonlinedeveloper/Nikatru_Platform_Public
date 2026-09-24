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
  checkRedirects,
  checkSecretNames,
  checkTemplates,
  checkWebBuild,
  gradeRun,
  keepAliveTargets,
  parseArgs,
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
const GOOD_SETTINGS = { external: { email: true, apple: true }, mailer_autoconfirm: false, disable_signup: false };

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
} = {}) {
  const root = join(TMP, `r${seq++}`);
  if (csp !== null) put(root, 'apps/subscriptiontracker/web/_headers', `# CSP: connect-src ${HOSTED}\n/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: ${csp}\n`);
  else mkdirSync(join(root, 'apps', 'subscriptiontracker'), { recursive: true });
  put(root, 'tooling/platform-register.json', JSON.stringify({ sharedValues: { values: recorded ? [{ at: 'vars.SUPABASE_URL', value: recorded }] : [] } }));
  put(root, 'services/platform/wrangler.jsonc', `{\n  // the platform Worker\n  "name": "platform",\n  "vars": ${JSON.stringify(vars)},\n}\n`);
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
    [`${TARGET}/auth/v1/.well-known/jwks.json`]: () => json({ keys: [{ kty: 'EC', crv: 'P-256', alg: 'ES256', kid: 'k1' }] }),
    [`${TARGET}/auth/v1/token?grant_type=password`]: () => json({ code: 400, error_code: 'captcha_failed' }, 400),
    [`${WEB}/main.dart.js`]: () => new Response(`var a="${HOSTED}";var b=${JSON.stringify(BREACHED)};`),
    [MAIL_URL['confirm-signup.html']]: () => new Response(MAIL['confirm-signup.html']),
    [MAIL_URL['magic-link.html']]: () => new Response(MAIL['magic-link.html']),
    [MAIL_URL['reset-password.html']]: () => new Response(MAIL['reset-password.html']),
    ...over,
  };
  const calls = [];
  const doFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {} });
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
  test('C3 PASS: health 200, email on, Apple on, autoconfirm false, sign-up open', async () => {
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch: fakeFetch() });
    assert.equal(r.verdict, 'PASS', r.detail);
  });

  test('C3 FAIL when Apple sign-in is off', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/settings`]: () => json({ ...GOOD_SETTINGS, external: { email: true, apple: false } }) });
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch });
    assert.equal(r.verdict, 'FAIL');
    assert.match(r.detail, /Apple sign-in is OFF/);
  });

  test('C3 FAIL when autoconfirm is on', async () => {
    const doFetch = fakeFetch({ [`${TARGET}/auth/v1/settings`]: () => json({ ...GOOD_SETTINGS, mailer_autoconfirm: true }) });
    const r = await checkGoTrueUp({ target: TARGET, anonKey: ANON, doFetch });
    assert.equal(r.verdict, 'FAIL');
  });

  test('C3 LOST without the anon key', async () => {
    const r = await checkGoTrueUp({ target: TARGET, anonKey: '', doFetch: fakeFetch() });
    assert.equal(r.verdict, 'LOST');
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
    assert.equal(checkSecretNames({ phase: 'pre', gh: fakeGh() }).verdict, 'PASS');
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
    env: { SELFHOSTED_SUPABASE_ANON_KEY: ANON },
    doFetch: fakeFetch(),
    gh: fakeGh(),
    runGuard: guardOk,
    ...over,
  });

  test('a ready pre state: eleven PASS, C9-C11 LOST, exit 2 — and the anon key never printed', async () => {
    const r = await full(makeRoot());
    const text = r.lines.join('\n');
    assert.equal(r.results.length, 14);
    assert.deepEqual(r.results.map((x) => x.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14']);
    assert.deepEqual(r.results.filter((x) => x.verdict !== 'PASS').map((x) => x.id), ['C9', 'C10', 'C11'], text);
    assert.equal(r.code, 2);
    assert.match(r.lines[0], /COVERAGE LOST first at C9 live Worker vars/);
    assert.match(r.lines.at(-1), /11 PASS · 0 FAIL · 3 LOST → exit 2/);
    assert.ok(!text.includes(ANON), 'the anon key must never be printed');
    assert.match(text, /SELFHOSTED_SUPABASE_ANON_KEY len=27 sha256:[0-9a-f]{8}/);
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
    assert.deepEqual(lost, ['C3', 'C5', 'C6', 'C9', 'C10', 'C11', 'C14']);
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
