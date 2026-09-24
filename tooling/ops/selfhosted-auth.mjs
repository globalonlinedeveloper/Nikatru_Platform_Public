// ─────────────────────────────────────────────────────────────────────────────
// selfhosted-auth.mjs — the READ-ONLY looks at a self-hosted GoTrue (Box C) that
// more than one ops reader needs. No CLI, no exit code: it returns verdicts and
// the caller decides what they mean for its run.
//
// Callers:
//   · verify-supabase-templates.mjs --selfhosted — the drift detector's mode for
//     after the switch, when the Management API `GET /v1/projects/{ref}/config/auth`
//     no longer describes the server that sends the mail;
//   · auth-cutover-preflight.mjs — the switch checklist (C3, C6, C7).
// One copy of "how a served template is compared" and "how the Box C env dump is
// read", so the two readers cannot grade the same server two ways.
//
// ── THE THREE LOOKS, AND WHAT EACH CAN AND CANNOT SEE ────────────────────────
//   (a) the served templates — GoTrue FETCHES each body from the URL in its
//       GOTRUE_MAILER_TEMPLATES_* env, so the bytes at that URL are the bytes a
//       user receives. Fetched here and compared byte for byte with the repo's
//       DR source (docs/platform/supabase/email-templates/). A 404/410 is a
//       FINDING (the server would fall back to its default body); anything else
//       that is not an answer is COULD NOT LOOK.
//   (b) `GET <url>/auth/v1/settings` with the anon key — the only config a
//       self-hosted GoTrue exposes remotely: the external providers, the email
//       provider, `mailer_autoconfirm`, `disable_signup`.
//   (c) SMTP, subjects, template URLs, site URL and redirect allow list are NOT
//       remotely observable. They are read ONLY from an env dump the operator
//       hands over (`--boxc-env <file>`, KEY=VALUE lines). Only the keys named
//       below are read; every other line is skipped unread. A value is never
//       returned to a printer: callers print names, lengths and short hashes.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';
import { AUTH_MAIL_SOURCE_DIR, AUTH_MAIL_TEMPLATES } from '../sites/gen-auth-mail.mjs';

/** `len=N sha256:abcd1234` — enough to tell two values apart, never the value. */
export function fingerprint(value) {
  const s = String(value ?? '');
  return `len=${s.length} sha256:${createHash('sha256').update(s).digest('hex').slice(0, 8)}`;
}

/** The register's `supabaseAuth` SMTP fields and the GoTrue env variable each is
 *  set by on a self-hosted server. `smtp_pass` is not here on purpose: the
 *  register carries no secret, so only its PRESENCE is checked (below). */
export const SMTP_ENV = Object.freeze({
  smtp_host: 'GOTRUE_SMTP_HOST',
  smtp_port: 'GOTRUE_SMTP_PORT',
  smtp_user: 'GOTRUE_SMTP_USER',
  smtp_admin_email: 'GOTRUE_SMTP_ADMIN_EMAIL',
  smtp_sender_name: 'GOTRUE_SMTP_SENDER_NAME',
});
export const SMTP_PASS_ENV = 'GOTRUE_SMTP_PASS';
/** The register's subject key → the GoTrue env variable that sets it. */
export const SUBJECT_ENV = Object.freeze(
  Object.fromEntries(AUTH_MAIL_TEMPLATES.map((t) => [t.subjectKey, `GOTRUE_MAILER_SUBJECTS_${t.subjectKey.toUpperCase()}`])),
);
export const SITE_URL_ENV = 'GOTRUE_SITE_URL';
export const URI_ALLOW_LIST_ENV = 'GOTRUE_URI_ALLOW_LIST';

/** Every key the env-dump reader may look at. Nothing else is read. */
export const BOXC_ENV_KEYS = Object.freeze([
  ...Object.values(SMTP_ENV),
  SMTP_PASS_ENV,
  ...Object.values(SUBJECT_ENV),
  ...AUTH_MAIL_TEMPLATES.map((t) => t.gotrueEnv),
  SITE_URL_ENV,
  URI_ALLOW_LIST_ENV,
]);

/**
 * Read ONLY `keys` from a KEY=VALUE env dump. A docker `.env` spells the GoTrue
 * variables without the prefix (`SMTP_HOST`); the container env spells them with
 * it (`GOTRUE_SMTP_HOST`). Both are accepted; the prefixed spelling wins.
 * Returns `{ values, missing }`, or `{ error }` when the file cannot be read.
 * The values are for comparison only — never print one.
 */
export function readEnvFileKeys(file, keys = BOXC_ENV_KEYS) {
  if (!file) return { error: 'no env file was given' };
  if (!existsSync(file)) return { error: `the env file ${file} does not exist` };
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { error: `the env file ${file} could not be read (${e.code ?? e.message})` };
  }
  const want = new Map();
  for (const k of keys) {
    want.set(k, k);
    if (k.startsWith('GOTRUE_')) want.set(k.slice('GOTRUE_'.length), k);
  }
  const values = {};
  const fromBare = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m || !want.has(m[1])) continue;
    const canonical = want.get(m[1]);
    const bare = m[1] !== canonical;
    if (bare && canonical in values && !fromBare[canonical]) continue; // the prefixed spelling wins
    let v = line.slice(line.indexOf('=') + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    values[canonical] = v;
    fromBare[canonical] = bare;
  }
  return { values, missing: keys.filter((k) => !(k in values)) };
}

/**
 * (a) Fetch each served template and compare it byte for byte with its DR source.
 * Returns one `{ name, verdict: 'PASS'|'FAIL'|'LOST', detail }` per template.
 * `urlFor(t)` lets a caller point at the URLs a server is actually configured
 * with (from the env dump) instead of the planned ones.
 */
export async function compareServedTemplates({ repoRoot, doFetch = globalThis.fetch, urlFor = (t) => t.url }) {
  const results = [];
  for (const t of AUTH_MAIL_TEMPLATES) {
    const name = t.file;
    const url = urlFor(t);
    const src = join(repoRoot, ...AUTH_MAIL_SOURCE_DIR.split('/'), t.file);
    if (!existsSync(src)) {
      results.push({ name, verdict: 'LOST', detail: `the repo source ${AUTH_MAIL_SOURCE_DIR}/${t.file} is missing — nothing to compare against` });
      continue;
    }
    const want = readFileSync(src);
    let res;
    try {
      res = await fetchWithBoundedRetry(({ signal }) => doFetch(url, { redirect: 'follow', signal }), {
        describe: (why) => `GET ${url}: ${why}`,
      });
    } catch (e) {
      results.push({ name, verdict: 'LOST', detail: `could not fetch ${url} (${e?.message ?? e})` });
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      results.push({ name, verdict: 'FAIL', detail: `${url} answered HTTP ${res.status} — GoTrue would fall back to its default body` });
      continue;
    }
    if (!res.ok) {
      results.push({ name, verdict: 'LOST', detail: `${url} answered HTTP ${res.status} — nothing was compared` });
      continue;
    }
    let got;
    try {
      got = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      results.push({ name, verdict: 'LOST', detail: `${url} body could not be read (${e?.message ?? e})` });
      continue;
    }
    const via = res.redirected && res.url ? ` (after a redirect to ${res.url})` : '';
    if (got.equals(want)) {
      const sha = createHash('sha256').update(want).digest('hex').slice(0, 8);
      results.push({ name, verdict: 'PASS', detail: `${url}${via} == repo source, ${want.length} B, sha256:${sha}` });
    } else {
      results.push({
        name,
        verdict: 'FAIL',
        detail:
          `${url}${via} DIFFERS from ${AUTH_MAIL_SOURCE_DIR}/${t.file} ` +
          `(served ${got.length} B vs source ${want.length} B) — deploy the apex site or re-run gen-auth-mail.mjs`,
      });
    }
  }
  return results;
}

/**
 * (b) `GET <url>/auth/v1/settings` with the anon key. Returns `{ settings }` or
 * `{ lost }` (a reason). The key goes in two headers and nowhere else.
 */
export async function readAuthSettings({ url, anonKey, doFetch = globalThis.fetch }) {
  if (!url) return { lost: 'no auth URL was given' };
  if (!anonKey) return { lost: 'no anon key was given' };
  const base = String(url).replace(/\/$/, '');
  let res;
  try {
    res = await fetchWithBoundedRetry(
      ({ signal }) =>
        doFetch(`${base}/auth/v1/settings`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
          signal,
        }),
      { describe: (why) => `GET ${base}/auth/v1/settings: ${why}` },
    );
  } catch (e) {
    return { lost: `GET ${base}/auth/v1/settings failed (${e?.message ?? e})` };
  }
  if (!res.ok) return { lost: `GET ${base}/auth/v1/settings answered HTTP ${res.status}` };
  try {
    const settings = await res.json();
    if (!settings || typeof settings !== 'object') return { lost: 'the settings body is not an object' };
    return { settings };
  } catch (e) {
    return { lost: `the settings body is not JSON (${e?.message ?? e})` };
  }
}

/**
 * Grade the settings against the register's `supabaseAuth` record: the email
 * provider (`external_email_enabled`) and `mailer_autoconfirm`, each only when the
 * record names it. Returns `[{ name, verdict, detail }]`.
 */
export function gradeSettings(settings, expectedAuth = {}) {
  const out = [];
  const email = settings?.external?.email;
  if (Object.prototype.hasOwnProperty.call(expectedAuth, 'external_email_enabled')) {
    if (typeof email !== 'boolean') out.push({ name: 'external.email', verdict: 'LOST', detail: 'the settings response has no boolean external.email' });
    else if (email === expectedAuth.external_email_enabled) out.push({ name: 'external.email', verdict: 'PASS', detail: `${email}, as recorded` });
    else out.push({ name: 'external.email', verdict: 'FAIL', detail: `register says ${expectedAuth.external_email_enabled}, live says ${email}` });
  }
  if (Object.prototype.hasOwnProperty.call(expectedAuth, 'mailer_autoconfirm')) {
    const ac = settings?.mailer_autoconfirm;
    if (typeof ac !== 'boolean') out.push({ name: 'mailer_autoconfirm', verdict: 'LOST', detail: 'the settings response has no boolean mailer_autoconfirm' });
    else if (ac === expectedAuth.mailer_autoconfirm) out.push({ name: 'mailer_autoconfirm', verdict: 'PASS', detail: `${ac}, as recorded` });
    else out.push({ name: 'mailer_autoconfirm', verdict: 'FAIL', detail: `register says ${expectedAuth.mailer_autoconfirm}, live says ${ac}` });
  }
  return out;
}

/**
 * (c) Compare an env dump's SMTP fields, subjects and template URLs with the
 * register. Values are compared and NEVER put in a detail: a mismatch names the
 * register's (public) value and the env value's fingerprint.
 */
export function gradeEnv(values, expectedAuth = {}) {
  const out = [];
  const cmp = (name, envKey, want) => {
    if (!(envKey in values)) {
      out.push({ name, verdict: 'LOST', detail: `${envKey} is not in the env dump` });
    } else if (String(values[envKey]) === String(want)) {
      out.push({ name, verdict: 'PASS', detail: `${envKey} equals the record (${fingerprint(values[envKey])})` });
    } else {
      out.push({ name, verdict: 'FAIL', detail: `${envKey} differs from the record ${JSON.stringify(want)} (env ${fingerprint(values[envKey])})` });
    }
  };
  for (const [field, envKey] of Object.entries(SMTP_ENV)) {
    if (Object.prototype.hasOwnProperty.call(expectedAuth, field)) cmp(field, envKey, expectedAuth[field]);
  }
  if (!(SMTP_PASS_ENV in values)) out.push({ name: 'smtp_pass', verdict: 'LOST', detail: `${SMTP_PASS_ENV} is not in the env dump` });
  else if (values[SMTP_PASS_ENV] === '') out.push({ name: 'smtp_pass', verdict: 'FAIL', detail: `${SMTP_PASS_ENV} is EMPTY — custom SMTP cannot authenticate` });
  else out.push({ name: 'smtp_pass', verdict: 'PASS', detail: `${SMTP_PASS_ENV} is set (${fingerprint(values[SMTP_PASS_ENV])})` });

  const subjects = expectedAuth.subjects;
  if (!subjects || typeof subjects !== 'object') {
    out.push({ name: 'subjects', verdict: 'LOST', detail: 'the register has no supabaseAuth.subjects to compare with' });
  } else {
    for (const [key, envKey] of Object.entries(SUBJECT_ENV)) cmp(`subject ${key}`, envKey, subjects[key]);
  }
  for (const t of AUTH_MAIL_TEMPLATES) cmp(`template URL ${t.file}`, t.gotrueEnv, t.url);
  return out;
}
