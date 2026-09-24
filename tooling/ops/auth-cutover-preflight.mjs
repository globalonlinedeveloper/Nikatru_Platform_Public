#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// auth-cutover-preflight.mjs — the graded, READ-ONLY checklist for switching auth
// from the hosted Supabase project to the self-hosted GoTrue on Box C.
//
//   node tooling/ops/auth-cutover-preflight.mjs --phase pre|post
//        [--target <url>] [--boxc-env <file>] [--attest apple-return-url]
//        [--window-start <iso>] [repoRoot]
//
//   --phase pre   hosted is still live, Box C is meant to be ready;
//   --phase post  Box C is meant to be everywhere.
//   --target      the Box C auth origin (default SELFHOSTED_SUPABASE_URL, else
//                 https://auth-api.nikatru.com).
//   --boxc-env    a KEY=VALUE dump of the GoTrue env. Only the keys C6 and C7
//                 need are read (selfhosted-auth.mjs); values are never printed.
//   --attest apple-return-url
//                 the owner has confirmed the Apple Services ID return URL. No
//                 API exposes it, so without this C14 stays LOST.
//   --window-start  post only: repo secrets must be updated after this instant.
//
// One line per check, `PASS | FAIL | LOST  C<n> <name>: <detail>`, then one
// summary line. The FIRST line names the check that decided the exit:
//   exit 1  any FAIL (a finding — do not switch);
//   exit 2  no FAIL, but some check could not look (COVERAGE LOST is not a pass);
//   exit 0  all fourteen PASS.
// A check whose input is absent (credential, token, attestation, env file) is
// LOST with the reason, never PASS. Credentials come from the ENVIRONMENT only
// (SELFHOSTED_SUPABASE_URL, SELFHOSTED_SUPABASE_ANON_KEY) and are printed as a
// name, a length and a short hash. It never writes: no user is created, no
// config is changed, nothing is deployed.
//
// The fourteen, and what each reuses (plan: research/session-2026-09-23/
// cutover-prep/public-prep-plan.md section 5):
//   C1  CSP              apps/*/web/_headers connect-src names the target; post: no hosted origin
//   C2  config agreement assert-platform-register.mjs (LIMB 5) spawned, then the
//                        recorded SUPABASE_URL: pre = hosted, post = the target
//   C3  GoTrue up        /auth/v1/health 200; /auth/v1/settings email on, Apple on,
//                        autoconfirm false, sign-up open
//   C4  keys             /auth/v1/.well-known/jwks.json carries an ES256 key
//   C5  captcha posture  channel-register.json served native channels + the live
//                        probe + vars.TURNSTILE_SITE_KEY presence (name only)
//   C6  redirect list    GOTRUE_URI_ALLOW_LIST / GOTRUE_SITE_URL vs mail-transport.json
//   C7  templates        the served mail templates, byte for byte (selfhosted-auth.mjs)
//   C8  secret names     repo secrets SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY exist
//   C9  live Worker vars Cloudflare script settings — needs a Cloudflare token
//   C10 KV               supabase_jwks — needs wrangler + a Cloudflare token
//   C11 Workers health   the health route's supabase_jwks reading — not read here yet
//   C12 keep-alive       services/platform keepAliveTargets resolution, mirrored
//   C13 web build        the deployed main.dart.js names the expected auth host
//   C14 gates            the deployed bundle carries the passwordBreached copy;
//                        the Apple return URL is attested
//
// C9, C10 and C11 have no reader here yet, so they are always LOST and the best
// result today is exit 2: the operator reads those three by hand (the LOST line
// names how) before the switch. Exit 0 needs those readers to land first.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';
import {
  compareServedTemplates,
  fingerprint,
  gradeSettings,
  readAuthSettings,
  readEnvFileKeys,
  SITE_URL_ENV,
  URI_ALLOW_LIST_ENV,
} from './selfhosted-auth.mjs';
import { AUTH_MAIL_TEMPLATES } from '../sites/gen-auth-mail.mjs';
import { listDir } from '../ci/tree-walk.mjs';
import { stripComments } from '../ci/assert-platform-register.mjs';

export const BOXC_DEFAULT_TARGET = 'https://auth-api.nikatru.com';
export const REPO_SLUG = 'globalonlinedeveloper/Nikatru_Platform_Public';
export const REQUIRED_REPO_SECRETS = Object.freeze(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
const HOSTED_ORIGIN = /^https:\/\/[a-z0-9]+\.supabase\.co$/;
const HOSTED_IN_TEXT = /https:\/\/[a-z0-9]+\.supabase\.co/;
// A CSP source for the hosted project: https or wss, a project ref or a wildcard.
const HOSTED_CSP_TOKEN = /^(?:https|wss):\/\/(?:\*|[a-z0-9]+)\.supabase\.co$/;
const APPLE_ATTESTATION = 'apple-return-url';

const trimSlash = (s) => String(s ?? '').trim().replace(/\/+$/, '');
const readJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));
function readJsonc(abs) {
  return JSON.parse(stripComments(readFileSync(abs, 'utf8')).replace(/,(\s*[}\]])/g, '$1'));
}
const verdictOf = (legs) => (legs.some((l) => l === 'FAIL') ? 'FAIL' : legs.some((l) => l === 'LOST') ? 'LOST' : 'PASS');

/** The recorded SUPABASE_URL (platform-register sharedValues), or null. */
function recordedSupabaseUrl(root) {
  const p = join(root, 'tooling', 'platform-register.json');
  if (!existsSync(p)) return null;
  const hit = (readJson(p).sharedValues?.values ?? []).find((v) => v?.at === 'vars.SUPABASE_URL');
  return hit ? trimSlash(hit.value) : null;
}

/** The auth origin the given phase expects the configs to hold. */
function expectedAuthOrigin(root, phase, target) {
  if (phase === 'post') return target;
  const rec = recordedSupabaseUrl(root);
  return rec && HOSTED_ORIGIN.test(rec) ? rec : null;
}

// ── C1 ───────────────────────────────────────────────────────────────────────
export function checkCsp({ root, phase, target }) {
  const apps = join(root, 'apps');
  if (!existsSync(apps)) return { verdict: 'LOST', detail: 'no apps/ directory — nothing to read' };
  const files = listDir(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `apps/${e.name}/web/_headers`)
    .filter((rel) => existsSync(join(root, ...rel.split('/'))));
  if (files.length === 0) return { verdict: 'LOST', detail: 'no apps/*/web/_headers file — no CSP to read' };
  const problems = [];
  for (const rel of files) {
    const lines = readFileSync(join(root, ...rel.split('/')), 'utf8').split(/\r?\n/);
    const csp = lines.filter((l) => !l.trim().startsWith('#')).map((l) => l.match(/^\s*Content-Security-Policy:\s*(.*)$/i)).find(Boolean);
    if (!csp) { problems.push(`${rel} carries no Content-Security-Policy`); continue; }
    const connect = csp[1].split(';').map((d) => d.trim().split(/\s+/)).find((t) => t[0] === 'connect-src');
    if (!connect) { problems.push(`${rel} CSP has no connect-src`); continue; }
    if (!connect.map(trimSlash).includes(target)) problems.push(`${rel} connect-src does not name ${target}`);
    const hosted = connect.filter((t) => HOSTED_CSP_TOKEN.test(trimSlash(t)));
    if (phase === 'post' && hosted.length) problems.push(`${rel} connect-src still names the hosted origin ${hosted.join(' ')}`);
  }
  if (problems.length) return { verdict: 'FAIL', detail: problems.join('; ') };
  return { verdict: 'PASS', detail: `${files.length} _headers file(s): connect-src names ${target}${phase === 'post' ? ' and no hosted origin' : ''}` };
}

// ── C2 ───────────────────────────────────────────────────────────────────────
export function checkConfigAgreement({ root, phase, target, runGuard }) {
  const g = runGuard(root);
  if (g.status === 1) return { verdict: 'FAIL', detail: `assert-platform-register.mjs exit 1 — the wrangler configs disagree with the register: ${g.firstLine}` };
  if (g.status !== 0) return { verdict: 'LOST', detail: `assert-platform-register.mjs exit ${g.status} — the three configs were not compared: ${g.firstLine}` };
  const rec = recordedSupabaseUrl(root);
  if (!rec) return { verdict: 'LOST', detail: 'tooling/platform-register.json records no vars.SUPABASE_URL' };
  if (phase === 'pre') {
    if (rec === target) return { verdict: 'FAIL', detail: `the configs already hold the target ${target} — that is the post state, not pre` };
    if (!HOSTED_ORIGIN.test(rec)) return { verdict: 'FAIL', detail: `the configs hold ${rec}, which is neither hosted nor the target` };
    return { verdict: 'PASS', detail: `all three wrangler configs agree on the hosted origin ${rec} (guard exit 0)` };
  }
  if (rec !== target) return { verdict: 'FAIL', detail: `the configs hold ${rec}, not the target ${target}` };
  return { verdict: 'PASS', detail: `all three wrangler configs agree on the target ${target} (guard exit 0)` };
}

// ── C3 / C4 ──────────────────────────────────────────────────────────────────
async function get(doFetch, url, headers = {}) {
  return fetchWithBoundedRetry(({ signal }) => doFetch(url, { headers, signal }), { describe: (why) => `GET ${url}: ${why}` });
}

export async function checkGoTrueUp({ target, anonKey, doFetch }) {
  if (!anonKey) return { verdict: 'LOST', detail: 'SELFHOSTED_SUPABASE_ANON_KEY is not in the environment' };
  let health;
  try {
    health = await get(doFetch, `${target}/auth/v1/health`, { apikey: anonKey });
  } catch (e) {
    return { verdict: 'LOST', detail: `GET /auth/v1/health failed (${e?.message ?? e})` };
  }
  if (health.status >= 500 || health.status === 404) return { verdict: 'FAIL', detail: `GET /auth/v1/health answered HTTP ${health.status}` };
  if (!health.ok) return { verdict: 'LOST', detail: `GET /auth/v1/health answered HTTP ${health.status}` };
  const read = await readAuthSettings({ url: target, anonKey, doFetch });
  if (read.lost) return { verdict: 'LOST', detail: read.lost };
  const s = read.settings;
  const graded = gradeSettings(s, { external_email_enabled: true, mailer_autoconfirm: false });
  const legs = graded.map((g) => g.verdict);
  const notes = graded.filter((g) => g.verdict !== 'PASS').map((g) => `${g.name}: ${g.detail}`);
  if (typeof s?.external?.apple !== 'boolean') { legs.push('LOST'); notes.push('no boolean external.apple'); }
  else if (!s.external.apple) { legs.push('FAIL'); notes.push('Apple sign-in is OFF'); }
  if (typeof s?.disable_signup !== 'boolean') { legs.push('LOST'); notes.push('no boolean disable_signup'); }
  else if (s.disable_signup) { legs.push('FAIL'); notes.push('sign-up is DISABLED'); }
  const verdict = verdictOf(legs);
  return { verdict, detail: verdict === 'PASS' ? 'health 200; email on, Apple on, autoconfirm false, sign-up open' : notes.join('; ') };
}

export async function checkKeys({ target, anonKey, doFetch }) {
  const url = `${target}/auth/v1/.well-known/jwks.json`;
  let res;
  try {
    res = await get(doFetch, url, anonKey ? { apikey: anonKey } : {});
  } catch (e) {
    return { verdict: 'LOST', detail: `GET ${url} failed (${e?.message ?? e})` };
  }
  if (!res.ok) return { verdict: res.status === 404 ? 'FAIL' : 'LOST', detail: `GET ${url} answered HTTP ${res.status}` };
  let body;
  try { body = await res.json(); } catch { return { verdict: 'LOST', detail: 'the JWKS body is not JSON' }; }
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  const es = keys.filter((k) => k?.alg === 'ES256' || (k?.kty === 'EC' && k?.crv === 'P-256'));
  if (es.length === 0) return { verdict: 'FAIL', detail: `the JWKS holds ${keys.length} key(s), none ES256` };
  return { verdict: 'PASS', detail: `${es.length} ES256 key(s) (kid ${es.map((k) => k.kid ?? '?').join(', ')}); issuer by token needs a throwaway user and is not minted here` };
}

// ── C5 ───────────────────────────────────────────────────────────────────────
/** The served app channels that are not the web channel: each would need a
 *  captcha token a native build cannot mint (ADR 084). */
export function servedNativeChannels(root) {
  const p = join(root, 'tooling', 'channel-register.json');
  if (!existsSync(p)) return null;
  return (readJson(p).channels ?? [])
    .filter((c) => c?.surface === 'app' && c?.served === true && !(Array.isArray(c.platforms) && c.platforms.length === 1 && c.platforms[0] === 'web'))
    .map((c) => c.id);
}

async function probeCaptcha({ target, anonKey, doFetch }) {
  if (!anonKey) return { lost: 'SELFHOSTED_SUPABASE_ANON_KEY is not in the environment, so the captcha posture was not probed' };
  const url = `${target}/auth/v1/token?grant_type=password`;
  // An address nobody has and no captcha token: nothing is created on this route.
  const body = JSON.stringify({ email: `auth-cutover-preflight+${Date.now()}@nikatru.com`, password: `Pf${Date.now()}x` });
  let res;
  try {
    res = await fetchWithBoundedRetry(
      ({ signal }) => doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body, signal }),
      { describe: (why) => `POST ${url}: ${why}` },
    );
  } catch (e) {
    return { lost: `the captcha probe failed (${e?.message ?? e})` };
  }
  let json = {};
  try { json = await res.json(); } catch { /* the code below grades an unreadable body as unknown */ }
  const code = json?.error_code ?? json?.code ?? json?.error ?? '';
  if (code === 'captcha_failed') return { on: true };
  if (res.status === 400 && (code === 'invalid_credentials' || code === 'invalid_grant')) return { on: false };
  return { lost: `the captcha probe answered HTTP ${res.status} ${JSON.stringify(String(code))} — neither captcha_failed nor invalid_credentials` };
}

export async function checkCaptcha({ root, target, anonKey, doFetch, gh }) {
  const natives = servedNativeChannels(root);
  if (natives === null) return { verdict: 'LOST', detail: 'tooling/channel-register.json is missing — the served channels were not read' };
  const repoLeg = natives.length ? `served native channel(s): ${natives.join(', ')}` : 'no native channel is served';
  const probe = await probeCaptcha({ target, anonKey, doFetch });
  if (probe.lost) return { verdict: 'LOST', detail: `${probe.lost}; repo leg: ${repoLeg}` };
  if (!probe.on) return { verdict: 'PASS', detail: `captcha is OFF on ${target}; repo leg: ${repoLeg}` };
  const problems = [];
  if (natives.length) problems.push(`captcha is ON and ${repoLeg} — a native build cannot mint a Turnstile token (ADR 084)`);
  const v = gh(['api', `repos/${REPO_SLUG}/actions/variables/TURNSTILE_SITE_KEY`, '--jq', '.name']);
  if (v.status !== 0 && /HTTP 404/.test(v.stderr ?? '')) problems.push('captcha is ON and the repo variable TURNSTILE_SITE_KEY is ABSENT — the web build ships without a site key');
  else if (v.status !== 0) return { verdict: problems.length ? 'FAIL' : 'LOST', detail: [...problems, `the TURNSTILE_SITE_KEY variable could not be read (gh exit ${v.status})`].join('; ') };
  if (problems.length) return { verdict: 'FAIL', detail: problems.join('; ') };
  return { verdict: 'PASS', detail: `captcha is ON; ${repoLeg}; vars.TURNSTILE_SITE_KEY present` };
}

// ── C6 ───────────────────────────────────────────────────────────────────────
export function checkRedirects({ root, env }) {
  if (!env) return { verdict: 'LOST', detail: 'GOTRUE_URI_ALLOW_LIST and GOTRUE_SITE_URL are not remotely observable — pass --boxc-env <file>' };
  if (env.error) return { verdict: 'LOST', detail: env.error };
  const p = join(root, 'tooling', 'mail-transport.json');
  if (!existsSync(p)) return { verdict: 'LOST', detail: 'tooling/mail-transport.json is missing' };
  const auth = readJson(p).supabaseAuth ?? {};
  const legs = [];
  const notes = [];
  const set = (s) => new Set(String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  if (!(URI_ALLOW_LIST_ENV in env.values)) { legs.push('LOST'); notes.push(`${URI_ALLOW_LIST_ENV} is not in the env dump`); }
  else {
    const want = set(auth.uri_allow_list);
    const got = set(env.values[URI_ALLOW_LIST_ENV]);
    const missing = [...want].filter((u) => !got.has(u));
    const extra = [...got].filter((u) => !want.has(u));
    if (missing.length || extra.length) { legs.push('FAIL'); notes.push(`allow list differs: ${missing.length} recorded entr(ies) missing (${missing.join(' ')}), ${extra.length} unrecorded`); }
    else { legs.push('PASS'); notes.push(`allow list ${want.size} entr(ies) equal`); }
  }
  if (!(SITE_URL_ENV in env.values)) { legs.push('LOST'); notes.push(`${SITE_URL_ENV} is not in the env dump`); }
  else if (trimSlash(env.values[SITE_URL_ENV]) !== trimSlash(auth.site_url)) { legs.push('FAIL'); notes.push(`${SITE_URL_ENV} differs from the record ${JSON.stringify(auth.site_url)} (env ${fingerprint(env.values[SITE_URL_ENV])})`); }
  else { legs.push('PASS'); notes.push('site URL equal'); }
  return { verdict: verdictOf(legs), detail: notes.join('; ') };
}

// ── C7 ───────────────────────────────────────────────────────────────────────
export async function checkTemplates({ root, env, doFetch }) {
  const urlFor = (t) => (env?.values?.[t.gotrueEnv] ? env.values[t.gotrueEnv] : t.url);
  const results = await compareServedTemplates({ repoRoot: root, doFetch, urlFor });
  const verdict = verdictOf(results.map((r) => r.verdict));
  const bad = results.filter((r) => r.verdict !== 'PASS');
  return {
    verdict,
    detail: verdict === 'PASS'
      ? `${results.length}/${AUTH_MAIL_TEMPLATES.length} served templates equal their repo source byte for byte`
      : bad.map((r) => `${r.name} ${r.verdict}: ${r.detail}`).join('; '),
  };
}

// ── C8 ───────────────────────────────────────────────────────────────────────
export function checkSecretNames({ phase, windowStart, gh }) {
  const r = gh(['api', `repos/${REPO_SLUG}/actions/secrets`, '--paginate', '--jq', '.secrets[] | .name + " " + .updated_at']);
  if (r.status !== 0) return { verdict: 'LOST', detail: `the repo secret names could not be listed (gh exit ${r.status})` };
  const rows = new Map(String(r.stdout ?? '').split(/\r?\n/).filter(Boolean).map((l) => l.split(' ')));
  const missing = REQUIRED_REPO_SECRETS.filter((n) => !rows.has(n));
  if (missing.length) return { verdict: 'FAIL', detail: `repo secret(s) ABSENT: ${missing.join(', ')}` };
  if (phase === 'post') {
    if (!windowStart) return { verdict: 'LOST', detail: `${REQUIRED_REPO_SECRETS.join(', ')} exist; post needs --window-start <iso> to prove they were rotated` };
    const stale = REQUIRED_REPO_SECRETS.filter((n) => !(Date.parse(rows.get(n)) > Date.parse(windowStart)));
    if (stale.length) return { verdict: 'FAIL', detail: `not updated after ${windowStart}: ${stale.join(', ')}` };
  }
  return { verdict: 'PASS', detail: `${REQUIRED_REPO_SECRETS.join(', ')} exist (names only)${phase === 'post' ? `, all updated after ${windowStart}` : ''}; the platform Worker's secret names are C9's input` };
}

// ── C12 ──────────────────────────────────────────────────────────────────────
/** services/platform/src/scheduled.ts `keepAliveTargets`, mirrored: the comma list
 *  when set, else the single SUPABASE_URL; trimmed, slash-normalised, deduped. */
export function keepAliveTargets(vars = {}) {
  const configured = String(vars.SUPABASE_KEEPALIVE_URLS ?? '').trim();
  const raw = configured.length > 0 ? configured.split(',') : [vars.SUPABASE_URL ?? ''];
  return [...new Set(raw.map((s) => String(s).trim().replace(/\/+$/, '')).filter((s) => s.length > 0))];
}

export function checkKeepAlive({ root, phase, target }) {
  const p = join(root, 'services', 'platform', 'wrangler.jsonc');
  if (!existsSync(p)) return { verdict: 'LOST', detail: 'services/platform/wrangler.jsonc is missing' };
  let cfg;
  try { cfg = readJsonc(p); } catch (e) { return { verdict: 'LOST', detail: `services/platform/wrangler.jsonc could not be parsed (${e.message})` }; }
  const want = expectedAuthOrigin(root, phase, target);
  if (!want) return { verdict: 'LOST', detail: 'pre expects the hosted origin, and platform-register.json records no hosted vars.SUPABASE_URL' };
  const got = keepAliveTargets(cfg.vars ?? {});
  if (got.length !== 1) return { verdict: 'FAIL', detail: `the keep-alive resolves to ${got.length} target(s) (${got.join(' ') || 'none'}), not exactly one` };
  if (got[0] !== want) return { verdict: 'FAIL', detail: `the keep-alive pings ${got[0]}, not the ${phase} origin ${want}` };
  return { verdict: 'PASS', detail: `the keep-alive resolves to exactly ${want}` };
}

// ── C13 / C14 (one fetch of the deployed bundle) ─────────────────────────────
export function webAppUrl(root) {
  const p = join(root, 'catalog', 'apps.json');
  if (!existsSync(p)) return null;
  const apps = readJson(p);
  const hit = (Array.isArray(apps) ? apps : []).find((a) => a?.listings?.web);
  return hit ? trimSlash(hit.listings.web) : null;
}

export function breachedCopy(root) {
  const p = join(root, 'apps', 'subscriptiontracker', 'lib', 'l10n', 'app_en.arb');
  if (!existsSync(p)) return null;
  const v = readJson(p).passwordBreached;
  return typeof v === 'string' && v.length ? v : null;
}

async function fetchBundle({ root, doFetch }) {
  const web = webAppUrl(root);
  if (!web) return { lost: 'catalog/apps.json names no web listing' };
  const url = `${web}/main.dart.js`;
  let res;
  try {
    res = await get(doFetch, url);
  } catch (e) {
    return { lost: `GET ${url} failed (${e?.message ?? e})` };
  }
  if (!res.ok) return { lost: `GET ${url} answered HTTP ${res.status}` };
  try { return { url, text: await res.text() }; } catch (e) { return { lost: `${url} body could not be read (${e?.message ?? e})` }; }
}

export function checkWebBuild({ root, phase, target, bundle }) {
  if (bundle.lost) return { verdict: 'LOST', detail: bundle.lost };
  const want = expectedAuthOrigin(root, phase, target);
  if (!want) return { verdict: 'LOST', detail: 'pre expects the hosted origin, and platform-register.json records no hosted vars.SUPABASE_URL' };
  if (!bundle.text.includes(want)) return { verdict: 'FAIL', detail: `${bundle.url} does not name the ${phase} auth origin ${want}` };
  if (phase === 'post' && HOSTED_IN_TEXT.test(bundle.text)) return { verdict: 'FAIL', detail: `${bundle.url} names ${want} but still carries a hosted origin` };
  return { verdict: 'PASS', detail: `${bundle.url} names ${want}` };
}

export function checkGates({ root, bundle, attest }) {
  const legs = [];
  const notes = [];
  const copy = breachedCopy(root);
  if (!copy) { legs.push('FAIL'); notes.push('apps/subscriptiontracker/lib/l10n/app_en.arb has no passwordBreached copy — the row 14 gate has not landed'); }
  else if (bundle.lost) { legs.push('LOST'); notes.push(`passwordBreached copy not looked for: ${bundle.lost}`); }
  else if (bundle.text.includes(copy) || bundle.text.includes(JSON.stringify(copy).slice(1, -1))) { legs.push('PASS'); notes.push('the deployed bundle carries the passwordBreached copy'); }
  else { legs.push('FAIL'); notes.push(`${bundle.url} does not carry the passwordBreached copy — deploy the web app before switching`); }
  if (attest.includes(APPLE_ATTESTATION)) { legs.push('PASS'); notes.push('Apple Services ID return URL attested by the operator'); }
  else { legs.push('LOST'); notes.push(`the Apple Services ID return URL is not observable — pass --attest ${APPLE_ATTESTATION} once the owner has confirmed it`); }
  return { verdict: verdictOf(legs), detail: notes.join('; ') };
}

// ── the run ──────────────────────────────────────────────────────────────────
const NEEDS_CLOUDFLARE = 'needs a Cloudflare API token and account id, which this preflight does not hold';

/**
 * Run all fourteen checks. Returns `{ code, lines, results }`. Every outside
 * look goes through an injectable dependency so the test suite touches no
 * network: `doFetch` (fetch), `gh` (argv → {status, stdout, stderr}) and
 * `runGuard` (root → {status, firstLine}).
 */
export async function runPreflight({
  root,
  phase,
  target,
  boxcEnvFile,
  attest = [],
  windowStart,
  env = process.env,
  doFetch = globalThis.fetch,
  gh = defaultGh,
  runGuard = defaultRunGuard,
}) {
  // The auth origin is not a credential: C1 requires it in a public CSP header.
  const tgt = trimSlash(target || env.SELFHOSTED_SUPABASE_URL || BOXC_DEFAULT_TARGET);
  const targetFrom = target ? '--target' : env.SELFHOSTED_SUPABASE_URL ? 'SELFHOSTED_SUPABASE_URL' : 'default';
  const anonKey = env.SELFHOSTED_SUPABASE_ANON_KEY;
  const boxEnv = boxcEnvFile ? readEnvFileKeys(boxcEnvFile) : null;
  const bundle = await fetchBundle({ root, doFetch });
  const results = [
    ['C1', 'CSP', checkCsp({ root, phase, target: tgt })],
    ['C2', 'config agreement', checkConfigAgreement({ root, phase, target: tgt, runGuard })],
    ['C3', 'GoTrue up', await checkGoTrueUp({ target: tgt, anonKey, doFetch })],
    ['C4', 'keys and issuer', await checkKeys({ target: tgt, anonKey, doFetch })],
    ['C5', 'captcha posture', await checkCaptcha({ root, target: tgt, anonKey, doFetch, gh })],
    ['C6', 'redirect allow list', checkRedirects({ root, env: boxEnv })],
    ['C7', 'templates', await checkTemplates({ root, env: boxEnv && !boxEnv.error ? boxEnv : null, doFetch })],
    ['C8', 'secret names', checkSecretNames({ phase, windowStart, gh })],
    ['C9', 'live Worker vars', { verdict: 'LOST', detail: `SUPABASE_URL on the platform and subscriptiontracker-api Workers ${NEEDS_CLOUDFLARE}` }],
    ['C10', 'KV', { verdict: 'LOST', detail: `the supabase_jwks key in JWKS_CACHE ${NEEDS_CLOUDFLARE} (wrangler kv key get, read only)` }],
    ['C11', 'Workers health', { verdict: 'LOST', detail: 'the supabase_jwks field of each Worker health route (https://subscriptiontracker-api.nikatru.com/v1/health) is not read here yet — read it by hand after the Worker deploy' }],
    ['C12', 'keep-alive', checkKeepAlive({ root, phase, target: tgt })],
    ['C13', 'web build', checkWebBuild({ root, phase, target: tgt, bundle })],
    ['C14', 'gates', checkGates({ root, bundle, attest })],
  ].map(([id, name, r]) => ({ id, name, ...r }));

  const { code, head, summary } = gradeRun(results, phase);
  const lines = [
    head,
    `target ${tgt} (from ${targetFrom}) · SELFHOSTED_SUPABASE_ANON_KEY ${anonKey ? fingerprint(anonKey) : 'NOT SET'} · env dump ${boxcEnvFile ? 'given' : 'none'} · attest ${attest.length ? attest.join(',') : 'none'}`,
    ...results.map((r) => `${r.verdict.padEnd(4)}  ${r.id} ${r.name}: ${r.detail}`),
    summary,
  ];
  return { code, lines, results };
}

/** The exit rule: any FAIL → 1, else any LOST → 2, else 0. The head line names
 *  the first check that decided it. */
export function gradeRun(results, phase) {
  const fails = results.filter((r) => r.verdict === 'FAIL');
  const losts = results.filter((r) => r.verdict === 'LOST');
  const code = fails.length ? 1 : losts.length ? 2 : 0;
  const decider = fails[0] ?? losts[0];
  const head = code === 1 ? `auth-cutover-preflight --phase ${phase}: REFUSED by ${decider.id} ${decider.name} (FAIL)`
    : code === 2 ? `auth-cutover-preflight --phase ${phase}: COVERAGE LOST first at ${decider.id} ${decider.name}`
    : `auth-cutover-preflight --phase ${phase}: READY — all ${results.length} checks PASS`;
  const summary = `summary: ${results.length - fails.length - losts.length} PASS · ${fails.length} FAIL · ${losts.length} LOST → exit ${code}`;
  return { code, head, summary };
}

function defaultGh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 30_000 });
  return { status: r.status ?? 124, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function defaultRunGuard(root) {
  const guard = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'assert-platform-register.mjs');
  const r = spawnSync(process.execPath, [guard, root], { encoding: 'utf8', timeout: 120_000 });
  const firstLine = `${r.stderr ?? ''}${r.stdout ?? ''}`.split(/\r?\n/).find((l) => l.trim()) ?? '(no output)';
  return { status: r.status ?? 124, firstLine: firstLine.trim().slice(0, 240) };
}

/** Parse argv. Returns `{ error }` for a usage mistake. */
export function parseArgs(argv) {
  const VALUE_FLAGS = new Set(['--phase', '--target', '--boxc-env', '--attest', '--window-start']);
  const opts = { attest: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      i += 1;
      if (a === '--phase') opts.phase = v;
      else if (a === '--target') opts.target = v;
      else if (a === '--boxc-env') opts.boxcEnvFile = v;
      else if (a === '--attest') opts.attest.push(v);
      else if (a === '--window-start') opts.windowStart = v;
    } else if (a.startsWith('--')) return { error: `unknown flag ${a}` };
    else positional.push(a);
  }
  if (opts.phase !== 'pre' && opts.phase !== 'post') return { error: '--phase must be pre or post' };
  if (opts.attest.some((x) => x !== APPLE_ATTESTATION)) return { error: `--attest knows only ${APPLE_ATTESTATION}` };
  opts.root = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  return opts;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`auth-cutover-preflight: ${opts.error}`);
    console.error('usage: node tooling/ops/auth-cutover-preflight.mjs --phase pre|post [--target <url>] [--boxc-env <file>] [--attest apple-return-url] [--window-start <iso>] [repoRoot]');
    process.exitCode = 2;
  } else {
    const { code, lines } = await runPreflight(opts);
    for (const l of lines) console.log(l);
    process.exitCode = code;
  }
}
