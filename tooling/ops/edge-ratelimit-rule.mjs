#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// edge-ratelimit-rule.mjs — THE ZONE'S PER-IP CREDENTIAL LIMIT IS WHAT THE REPO
// DECLARES, AND ONLY THE DEPLOY WRITES IT.
//
// ⏱ 2026-09-27 · LEAD RULING SHIELD-R3, row O-BOXES-UNSHIELDED-FROM-SPIKES.
// services/edge-shield keeps one GLOBAL cap per request class and never reads a
// client address. The per-IP limit on the credential endpoints (GlitchTip's
// login, GoTrue's sign-up/otp/recover/verify/magiclink/resend, and since
// 2026-10-01 its MFA factor and reauthenticate paths) is the nikatru.com zone's
// own rate-limiting rule instead, declared in tooling/edge-ratelimit-rule.json.
// That file says why each field is what it is — and why /auth/v1/token is not in
// it: the Free plan would count the refresh grant, whose 429 signs users out.
//
// TWO MODES, ONE COMPARISON:
//   (default)  READ the zone's `http_ratelimit` phase entrypoint and compare its
//              rules to the declared ones — ops-watch's weekly `edge-shield` job.
//   --apply    PUT the declared rules as the phase entrypoint's WHOLE rule list,
//              then re-read and compare — deploy-workers.yml's edge-shield job,
//              after merge. The PUT is all or nothing: a refused one leaves the
//              live rule exactly as it was.
// What is compared, per rule and in order: description, expression, action,
// enabled, and ratelimit.{characteristics, period, requests_per_period,
// mitigation_timeout}. Cloudflare's own fields (id, version, last_updated, ref)
// are not the repo's to declare and are ignored.
//
// 🔴 A DASHBOARD EDIT IS DRIFT, NOT A FIX. Before this file the rule was edited
// by hand and recorded in prose (nikatru/vendors/cloudflare.md), so the record
// and the zone could disagree with nothing noticing. Exit 1 names each field.
//
// FAIL-CLOSED: no token, a zone that does not resolve to exactly one, an API
// that refuses, a declared file that does not parse — exit 2, "could not look",
// never a pass. The token needs Zone → Zone WAF → Read for the comparison and
// Edit for --apply, on nikatru.com.
//
// Usage:  node tooling/ops/edge-ratelimit-rule.mjs [--apply] [--root <dir>]
//   env:  CLOUDFLARE_API_TOKEN
// Exit 0 = the live phase equals the declared rules. 1 = it differs, and how.
//      2 = COULD NOT LOOK (or could not write). 2 IS NOT A PASS.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouldNotLook, classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry } from './bounded-retry.mjs';

export const CF_API = 'https://api.cloudflare.com/client/v4';
export const RULE_FILE_REL = 'tooling/edge-ratelimit-rule.json';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const RULE_FIELDS = ['description', 'expression', 'action', 'enabled'];
const RATELIMIT_FIELDS = ['characteristics', 'period', 'requests_per_period', 'mitigation_timeout'];

/** The declared phase, or CouldNotLook. A rule missing a compared field is a
 *  broken declaration, never a field "not to compare". */
export function loadDeclared(root = ROOT) {
  const abs = join(root, ...RULE_FILE_REL.split('/'));
  if (!existsSync(abs)) throw new CouldNotLook(`${RULE_FILE_REL} is not there, so there is nothing to compare the zone with`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new CouldNotLook(`${RULE_FILE_REL} is not JSON (${err.message})`);
  }
  if (typeof doc?.zone !== 'string' || doc.zone === '') throw new CouldNotLook(`${RULE_FILE_REL} names no \`zone\``);
  if (doc?.phase !== 'http_ratelimit') throw new CouldNotLook(`${RULE_FILE_REL} \`phase\` is ${JSON.stringify(doc?.phase)}, not "http_ratelimit"`);
  if (!Array.isArray(doc?.rules) || doc.rules.length === 0) throw new CouldNotLook(`${RULE_FILE_REL} declares no rule`);
  doc.rules.forEach((r, i) => {
    for (const k of RULE_FIELDS) if (r?.[k] === undefined) throw new CouldNotLook(`${RULE_FILE_REL} rule ${i + 1} declares no \`${k}\``);
    for (const k of RATELIMIT_FIELDS) {
      if (r?.ratelimit?.[k] === undefined) throw new CouldNotLook(`${RULE_FILE_REL} rule ${i + 1} declares no \`ratelimit.${k}\``);
    }
  });
  return { zone: doc.zone, phase: doc.phase, rules: doc.rules };
}

/** PURE. The compared fields of one rule, in one shape, whichever side it came from. */
export function shape(rule) {
  const out = {};
  for (const k of RULE_FIELDS) out[k] = k === 'enabled' ? rule?.enabled !== false : rule?.[k];
  out.ratelimit = {};
  for (const k of RATELIMIT_FIELDS) out.ratelimit[k] = rule?.ratelimit?.[k];
  return out;
}

/** PURE. The verdict, given the declared rules and the live phase's rules. */
export function judge(declared, live) {
  const lines = [];
  if (live.length !== declared.length) {
    lines.push(
      `✗ the zone's http_ratelimit phase holds ${live.length} rule(s) and ${RULE_FILE_REL} declares ${declared.length}. ` +
        'The declared file is the whole phase; a rule added or removed in the dashboard is drift.',
    );
  }
  const n = Math.min(live.length, declared.length);
  for (let i = 0; i < n; i++) {
    const want = shape(declared[i]);
    const got = shape(live[i]);
    for (const k of RULE_FIELDS) {
      if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) {
        lines.push(`✗ rule ${i + 1} \`${k}\`: live ${JSON.stringify(got[k])}, declared ${JSON.stringify(want[k])}`);
      }
    }
    for (const k of RATELIMIT_FIELDS) {
      if (JSON.stringify(got.ratelimit[k]) !== JSON.stringify(want.ratelimit[k])) {
        lines.push(`✗ rule ${i + 1} \`ratelimit.${k}\`: live ${JSON.stringify(got.ratelimit[k])}, declared ${JSON.stringify(want.ratelimit[k])}`);
      }
    }
  }
  if (lines.length === 0) {
    return {
      code: 0,
      lines: [`ok  edge rate-limit rule — the zone's http_ratelimit phase equals ${RULE_FILE_REL} (${declared.length} rule(s))`],
    };
  }
  lines.push(
    `  The per-IP limit on the credential endpoints is ${RULE_FILE_REL}, applied by deploy-workers.yml's edge-shield job. ` +
      'Redeploy it from main to restore the declared rule; if the live one is right, change the file in a PR instead.',
  );
  return { code: 1, lines };
}

/**
 * ONE Cloudflare call. A read is re-asked on the shared bounded plan
 * (tooling/ops/bounded-retry.mjs); the write is asked ONCE, inside the same
 * per-request ceiling — a PUT that timed out is re-read, never re-sent blind.
 * A 403, unparseable JSON and `success:false` are ANSWERS, never re-asked.
 */
export async function cf(method, path, token, { body, doFetch = fetch, sleep, note, allow404 = false } = {}) {
  return readWithBoundedRetry(
    async (_attempt, { signal }) => {
      let res;
      try {
        res = await doFetch(`${CF_API}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        });
      } catch (err) {
        throw classifyThrown(err, `the Cloudflare API could not be reached (${err.message})`);
      }
      if (allow404 && res.status === 404) return null;
      if (!res.ok) {
        const line = `the Cloudflare API answered HTTP ${res.status} for ${method} ${path}`;
        throw method === 'GET' && isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
      }
      let parsed;
      try {
        parsed = await res.json();
      } catch (err) {
        throw classifyThrown(err, `the Cloudflare API answer for ${method} ${path} was not JSON (${err.message})`);
      }
      if (parsed?.success !== true) {
        throw new CouldNotLook(`the Cloudflare API refused ${method} ${path}: ${JSON.stringify(parsed?.errors ?? []).slice(0, 300)}`);
      }
      return parsed.result;
    },
    { sleep, note, attempts: method === 'GET' ? undefined : 1 },
  );
}

/** IMPURE. The one zone id for `zone`, or CouldNotLook. */
export async function zoneId(zone, token, opts = {}) {
  const list = await cf('GET', `/zones?name=${encodeURIComponent(zone)}`, token, opts);
  if (!Array.isArray(list) || list.length !== 1 || typeof list[0]?.id !== 'string') {
    throw new CouldNotLook(`\`/zones?name=${zone}\` resolved to ${Array.isArray(list) ? list.length : 'no'} zone(s); exactly one is required`);
  }
  return list[0].id;
}

/** IMPURE. The live phase's rules. No entrypoint yet (404) is an EMPTY phase, which judge() reports. */
export async function readLive(id, phase, token, opts = {}) {
  const result = await cf('GET', `/zones/${id}/rulesets/phases/${phase}/entrypoint`, token, { ...opts, allow404: true });
  if (result === null) return [];
  if (!Array.isArray(result?.rules ?? [])) throw new CouldNotLook(`the ${phase} entrypoint came back without a \`rules\` array`);
  return result.rules ?? [];
}

/** The declared rule as the API takes it: exactly the compared fields. */
export function toApi(rule) {
  const s = shape(rule);
  return { description: s.description, expression: s.expression, action: s.action, enabled: s.enabled, ratelimit: s.ratelimit };
}

/** The whole run; returns the exit code. `fetchImpl` is the test seam — no test reaches the network. */
export async function run({ root = ROOT, apply = false, env = process.env, fetchImpl = globalThis.fetch, sleep } = {}) {
  const mode = apply ? 'apply + compare' : 'compare';
  console.log(`edge-ratelimit-rule — ${mode}: the zone's per-IP credential limit against ${RULE_FILE_REL}   (LEAD RULING SHIELD-R3)`);
  const lost = (why) => {
    console.error(`✗ COULD NOT ${apply ? 'APPLY' : 'LOOK'} — ${why}`);
    console.error('    Nothing about the zone rule is known from this run. That is exit 2, never a pass.');
    return 2;
  };
  let declared;
  try {
    declared = loadDeclared(root);
  } catch (err) {
    return lost(err.message);
  }
  const token = env.CLOUDFLARE_API_TOKEN ?? '';
  if (token === '') return lost('CLOUDFLARE_API_TOKEN is not in the environment, so the zone was not read.');
  const opts = { doFetch: fetchImpl, sleep };
  try {
    const id = await zoneId(declared.zone, token, opts);
    if (apply) {
      await cf('PUT', `/zones/${id}/rulesets/phases/${declared.phase}/entrypoint`, token, {
        ...opts,
        body: { rules: declared.rules.map(toApi) },
      });
      console.log(`  applied ${declared.rules.length} rule(s) to ${declared.zone} ${declared.phase}; re-reading to compare`);
    }
    const live = await readLive(id, declared.phase, token, opts);
    const v = judge(declared.rules, live);
    for (const line of v.lines) (v.code === 0 ? console.log : console.error)(line);
    return v.code;
  } catch (err) {
    return lost(err instanceof CouldNotLook ? err.message : `${err.name}: ${err.message}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const KNOWN = new Set(['--apply', '--root']);
  const unknown = args.filter((a, i) => a.startsWith('-') && !KNOWN.has(a) && args[i - 1] !== '--root');
  if (unknown.length) {
    console.error(`edge-ratelimit-rule: unknown flag(s) ${unknown.join(' ')}. Known: --apply --root <dir>`);
    process.exitCode = 2;
  } else {
    const at = args.indexOf('--root');
    // The exit code is SET, never forced: process.exit() with the HTTPS socket
    // still open surfaces on Windows as a libuv assertion (check-turnstile-hosts.mjs).
    process.exitCode = await run({ root: at >= 0 ? resolve(args[at + 1] ?? '') : ROOT, apply: args.includes('--apply') });
  }
}
