#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-mail-auth-dns.mjs — [ADR 029] put machine mail on mail.nikatru.com and
// human mail on nikatru.com. A receiver believes either one only if the SPF,
// DKIM and DMARC records it looks up say so, and until this file nothing in the
// repository looked them up (row O-MAIL-AUTH-DNS-UNGUARDED). A DKIM key deleted
// in the DNS dashboard, or a DMARC record edited away, would leave every send
// reporting success while receivers filed the mail as spam — and no check here
// could have said so.
//
// This file reads its expectations from the register — `authRecords` in
// tooling/mail-transport.json — and types none of them. It asks two public DNS
// resolvers for each declared record and compares the answer with `expect`.
//
// ── WHY DoH TO PUBLIC RESOLVERS, AND NOT THE RUNNER'S OWN ───────────────────
// A runner's resolver lags the zone. Measured 2026-09-11 (check-wildcard-dns.mjs,
// its header): a fresh `wc-….nikatru.com` still answered from a GitHub runner at
// 17:42Z while 8.8.8.8 and 1.1.1.1 both returned NXDOMAIN. So the question goes
// over HTTPS to those same two operators — cloudflare-dns.com and dns.google.
// TWO, because one DoH outage must not turn this step red on every pull
// request: a resolver that did not answer is set aside, and the one that did
// decides.
//
// ── WHY NOT THE CLOUDFLARE ZONE API ─────────────────────────────────────────
// The zone API says what the zone HOLDS; a receiving server acts on what
// resolution RETURNS, and this step asks the second question because it is the
// one the mail depends on. It also needs no secret, so an expired token can
// never be the reason it says nothing.
//
// ── WHAT IS CHECKED, PER KIND (the register's `expect`, and nothing more) ────
//   spf    exactly one `v=spf1` TXT (RFC 7208 §4.5); its WHOLE term set exactly
//          the declared one: each declared `include`, unqualified or `+`, and the
//          declared `all`, last, each once. Every term is parsed into qualifier
//          (absent = `+`, §4.6.2), mechanism and value; a qualified include, any
//          other mechanism or modifier, a repeat or a missing include is RED, named.
//   dkim   one TXT at the selector, its character-strings joined with NOTHING
//          between (RFC 6376 §3.6.2.2); `v`, if present, is DKIM1; `k` (default
//          `rsa`, §3.6.1) is the declared one; `p` present, non-empty, base64.
//          🔴 THE KEY IS NOT PINNED: a provider rotates it, and a pinned key would
//          make a routine rotation a red on every pull request. Its LENGTH in
//          characters is printed; the key itself never is.
//   dmarc  exactly one record starting `v=DMARC1` (RFC 7489 §6.6.3); `p` and, if
//          declared, `rua` equal to the register's. Limb F of
//          assert-mail-transport-claims.mjs requires the dmarc row to declare `rua`.
//   mx     exactly one MX, naming the declared exchange at the declared preference.
//
// A declared `rail` must be one of the register's `rails[].id`.
//
// ── FAIL-CLOSED, AND WHAT EACH EXIT MEANS ───────────────────────────────────
//   0 — every declared record was read and says what the register declares. The
//       count line names both resolvers and how many records each answered.
//   1 — a record is RED: it is missing (NXDOMAIN, or no record of the type), or
//       it says something other than the register. The line names the record id
//       and the DNS name.
//   2 — a record is NOT JUDGED and none is RED: neither resolver answered, the
//       answer came back in a shape this file cannot read, the whole-run ceiling
//       passed, or the register's `authRecords` is missing, empty or malformed.
//       A SPLIT — one resolver says ok, the other RED — is NOT JUDGED too: it is
//       what a record mid-change looks like, and neither half is evidence alone.
//       Exit 2 is never a pass.
//
// ── THE HONEST COST OF THIS STEP ────────────────────────────────────────────
// It runs in ops-watch, and a red ops-watch run turns `ci-gate` red on every open
// pull request (assert-ops-register.mjs). So a record changed in the DNS without
// the same change to `authRecords` is an every-PR red until the register is
// fixed. That is deliberate: the register is the record of what the DNS must
// say, and a silent disagreement between them is the defect this row closes. The
// fix for a red here is in the register or in the DNS — never in this step.
//
// Every request goes through fetchWithBoundedRetry (tooling/ops/bounded-retry.mjs)
// with a 10 s per-request ceiling, under a 90 s ceiling for the whole run.
//
// Usage:  node tooling/ops/check-mail-auth-dns.mjs [--plan] [--root <repo root>]
//   --plan  reads and validates the register, prints the reads it WOULD make and
//           exits 0; it makes no request. assert-mail-transport-claims.mjs limb F
//           runs it with and without the register to prove the register is read.
//
// 🔴 `process.exit()` IS BANNED IN THIS FILE, as in its neighbours: called after
// a `fetch`, with output still buffered, the libuv assertion aborts the process
// on Windows. It sets `process.exitCode` and returns.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouldNotLook, fetchWithBoundedRetry, runDeadline } from './bounded-retry.mjs';

export { CouldNotLook } from './bounded-retry.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTER_REL = 'tooling/mail-transport.json';

/** The two resolvers, by their DoH JSON endpoints. Constants of this file and
 *  never register rows: which records must exist is the register's question;
 *  whom to ask is this file's. */
export const RESOLVERS = Object.freeze([
  Object.freeze({
    host: 'cloudflare-dns.com',
    url: (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  }),
  Object.freeze({
    host: 'dns.google',
    url: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  }),
]);

/** The per-request ceiling handed to fetchWithBoundedRetry, which may only
 *  shorten its own 15 s. 10 s is judgement recorded as judgement, not a resolver
 *  SLA: every read, retries included, has to fit a 3-minute step with room. */
export const DOH_TIMEOUT_MS = 10_000;
/** The whole run. Every read runs at once, so the worst single read (three
 *  attempts at 10 s plus two clamped gaps, 40 s) sits well inside it. */
export const RUN_CEILING_MS = 90_000;

/** Which DNS type each kind is published as, and its numeric code in a DoH answer. */
export const KIND_TYPE = Object.freeze({ spf: 'TXT', dkim: 'TXT', dmarc: 'TXT', mx: 'MX' });
const TYPE_CODE = Object.freeze({ TXT: 16, MX: 15 });
/** The `expect` keys each kind reads. A key outside this set is REFUSED at load:
 *  an expectation nothing compares would read as checked while checking nothing. */
export const EXPECT_KEYS = Object.freeze({ spf: ['include', 'all'], dkim: ['k'], dmarc: ['p', 'rua'], mx: ['exchange', 'preference'] });
const RCODE = { 1: 'FORMERR', 2: 'SERVFAIL', 4: 'NOTIMP', 5: 'REFUSED' };
const HOSTNAME = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9])?)+$/;

const ok = (detail) => ({ state: 'ok', detail });
const red = (detail) => ({ state: 'red', detail });
const unjudged = (detail) => ({ state: 'unjudged', detail });

/** IMPURE (one file read). The register under `root`, parsed. */
export function readRegister(root) {
  const abs = join(root, ...REGISTER_REL.split('/'));
  if (!existsSync(abs)) throw new CouldNotLook(`${REGISTER_REL} does not exist under ${root}, so there is nothing to compare the DNS with`);
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new CouldNotLook(`${REGISTER_REL} could not be parsed (${e.message})`);
  }
}

/** PURE. The declared records, validated. Anything this file could not compare
 *  faithfully is refused here, before a single request, as COULD NOT LOOK. */
export function loadDeclaration(reg) {
  const block = reg?.authRecords;
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    throw new CouldNotLook(`${REGISTER_REL} has no \`authRecords\` object, so there is nothing to compare the DNS with`);
  }
  if (!Array.isArray(block.records) || block.records.length === 0) {
    throw new CouldNotLook(
      `${REGISTER_REL} \`authRecords.records\` is empty or not an array. A run over zero records prints the same ` +
        'clean count as a run over six, so it is refused rather than passed.',
    );
  }
  const rails = Array.isArray(reg.rails) ? reg.rails.map((r) => r?.id).filter((id) => typeof id === 'string') : [];
  const seen = new Set();
  return block.records.map((row, i) => {
    const at = `authRecords.records[${i}]`;
    if (typeof row?.id !== 'string' || row.id === '') throw new CouldNotLook(`${at} has no \`id\``);
    if (seen.has(row.id)) throw new CouldNotLook(`${at}: the id \`${row.id}\` is declared twice`);
    seen.add(row.id);
    if (!Object.hasOwn(KIND_TYPE, row.kind)) {
      throw new CouldNotLook(`${row.id}: kind ${JSON.stringify(row.kind)} is not one of ${Object.keys(KIND_TYPE).join(', ')}`);
    }
    if (typeof row.name !== 'string' || !HOSTNAME.test(row.name)) {
      throw new CouldNotLook(`${row.id}: name ${JSON.stringify(row.name)} is not a lower-case DNS name without a trailing dot`);
    }
    const e = row.expect;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new CouldNotLook(`${row.id}: \`expect\` is not an object`);
    const extra = Object.keys(e).filter((k) => !EXPECT_KEYS[row.kind].includes(k));
    if (extra.length > 0) {
      throw new CouldNotLook(
        `${row.id}: \`expect\` carries ${extra.join(', ')}, which the ${row.kind} check does not read. ` +
          'An expectation nothing compares is refused, never ignored.',
      );
    }
    const bad = (why) => new CouldNotLook(`${row.id}: \`expect\` ${why}`);
    if (row.kind === 'spf') {
      if (!Array.isArray(e.include) || e.include.some((x) => typeof x !== 'string' || x === '')) throw bad('.include must be an array of domain names');
      if (typeof e.all !== 'string' || !/^[~?+-]?all$/.test(e.all)) throw bad('.all must be an SPF `all` term, e.g. "~all"');
    } else if (row.kind === 'dkim') {
      if (typeof e.k !== 'string' || e.k === '') throw bad('.k must name the key type, e.g. "rsa"');
    } else if (row.kind === 'dmarc') {
      if (!['none', 'quarantine', 'reject'].includes(e.p)) throw bad('.p must be none, quarantine or reject');
      if (e.rua !== undefined && (typeof e.rua !== 'string' || e.rua === '')) throw bad('.rua, when declared, must be a non-empty string');
    } else if (row.kind === 'mx') {
      if (typeof e.exchange !== 'string' || !HOSTNAME.test(e.exchange)) throw bad('.exchange must be a lower-case host name without a trailing dot');
      if (!Number.isInteger(e.preference) || e.preference < 0) throw bad('.preference must be a non-negative integer');
    }
    // A record authenticates one of the register's own rails; a rail no
    // `rails[].id` names is a record nobody sends through.
    if (!rails.includes(row.rail)) {
      throw new CouldNotLook(`${row.id}: rail ${JSON.stringify(row.rail)} is not one of the register's rails (${rails.join(', ') || 'none declared'})`);
    }
    return { id: row.id, rail: row.rail, kind: row.kind, name: row.name, type: KIND_TYPE[row.kind], expect: e };
  });
}

/** PURE. One TXT answer's value. A DoH JSON answer carries TXT `data` in one of
 *  two shapes: quoted character-strings separated by spaces (cloudflare-dns.com),
 *  or the value already joined and unquoted (dns.google). The strings of one
 *  record are joined with NOTHING between them (RFC 7208 §3.3, RFC 6376
 *  §3.6.2.2): a 2048-bit DKIM key does not fit one 255-byte string, and a space
 *  at the join would sit inside the key. */
export function txtValue(data) {
  const s = String(data ?? '');
  if (!s.startsWith('"')) return s;
  const parts = [];
  for (const m of s.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    parts.push(m[1].replace(/\\(\d{3}|.)/g, (_, c) => (c.length === 3 ? String.fromCharCode(Number(c)) : c)));
  }
  return parts.join('');
}

/** PURE. An RFC 6376 §3.2 tag list (DKIM and DMARC share the grammar), or null
 *  when it is not one — a duplicated tag included. */
export function tagList(text) {
  const tags = {};
  for (const raw of String(text).split(';')) {
    const spec = raw.trim();
    if (spec === '') continue;
    const eq = spec.indexOf('=');
    if (eq <= 0) return null;
    const name = spec.slice(0, eq).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || Object.hasOwn(tags, name)) return null;
    tags[name] = spec.slice(eq + 1).trim();
  }
  return tags;
}

/** PURE. One SPF term (RFC 7208 §4.6.1), lower-cased: a modifier `name=value`
 *  (§6), or a mechanism with its qualifier, where an absent qualifier is `+`
 *  (§4.6.2). `key` is the term with its qualifier made explicit, so `include:x`
 *  and `+include:x` are one term and a second copy of it is a repeat. */
function spfTerm(text) {
  const raw = String(text).toLowerCase();
  const mod = raw.match(/^([a-z][a-z0-9_.-]*)=(.*)$/);
  if (mod) return { raw, key: raw, modifier: true, qualifier: '', mechanism: mod[1], value: mod[2] };
  const m = raw.match(/^([+?~-]?)([a-z][a-z0-9]*)(.*)$/);
  const qualifier = m?.[1] || '+';
  const mechanism = m?.[2] ?? '';
  const rest = m?.[3] ?? raw;
  return { raw, key: `${qualifier}${raw.replace(/^[+?~-]/, '')}`, modifier: false, qualifier, mechanism, value: rest.replace(/^:/, '') };
}

/** The WHOLE term set is the declaration, order aside except that `all` comes
 *  last: the declared includes, each unqualified or `+`, and the declared `all`,
 *  each once. Every other term is RED and named — a qualified include, any other
 *  mechanism (ip4 ip6 a mx exists ptr) or modifier (redirect= exp= or unknown),
 *  a repeat, a missing include, a changed `all`. An added term authorises one
 *  more sender, or sends the check somewhere else, which is a change as much as a
 *  removed one. */
function judgeSpf(record, values) {
  const spf = values.filter((v) => /^v=spf1(\s|$)/i.test(v.trim()));
  if (spf.length === 0) return red(`no \`v=spf1\` record among ${values.length} TXT record(s)`);
  if (spf.length > 1) return red(`${spf.length} \`v=spf1\` records — RFC 7208 §4.5 makes that a permerror, which a receiver reads as no SPF at all`);
  const text = spf[0].trim();
  const terms = text.split(/\s+/).slice(1).map(spfTerm);
  const declared = record.expect.include.map((d) => d.toLowerCase());
  const wantAll = spfTerm(record.expect.all);
  const allAt = terms.findIndex((t) => !t.modifier && t.mechanism === 'all');
  const present = new Set();
  const seen = new Set();
  const found = [];
  terms.forEach((t, i) => {
    if (seen.has(t.key)) return void found.push(`repeats the term \`${t.raw}\``);
    seen.add(t.key);
    if (!t.modifier && t.mechanism === 'include' && t.qualifier !== '+') {
      found.push(`has an include with qualifier \`${t.qualifier}\`: \`${t.raw}\``);
    } else if (!t.modifier && t.mechanism === 'include' && declared.includes(t.value)) {
      present.add(t.value);
    } else if (i !== allAt) {
      found.push(`has an undeclared term \`${t.raw}\``);
    }
  });
  const missing = declared.filter((d) => !present.has(d));
  if (missing.length > 0) found.unshift(`does not include ${missing.join(', ')}`);
  if (allAt < 0) {
    found.push(`ends in no \`all\` term, where the register declares ${record.expect.all}`);
  } else {
    const all = terms[allAt];
    if (all.qualifier !== wantAll.qualifier) found.push(`ends in ${all.raw}, where the register declares ${record.expect.all}`);
    if (allAt !== terms.length - 1) found.push(`has terms after \`${all.raw}\`, which RFC 7208 §5.1 never evaluates`);
  }
  if (found.length > 0) return red(`\`${text}\` ${found.join('; ')}`);
  return ok(`\`${text}\``);
}

function judgeDkim(record, values) {
  if (values.length > 1) return red(`${values.length} TXT records at the selector, and a verifier may pick any one of them`);
  const tags = tagList(values[0]);
  if (tags === null) return red('the TXT record is not a DKIM tag=value list');
  if (tags.v !== undefined && tags.v !== 'DKIM1') return red(`v=${tags.v}, where a DKIM key record says v=DKIM1`);
  // RFC 6376 §3.6.1: `k=` is optional and defaults to rsa. Resend publishes only `p=`.
  const k = tags.k ?? 'rsa';
  if (k !== record.expect.k) return red(`k=${k}, where the register declares k=${record.expect.k}`);
  if (tags.p === undefined) return red('the record has no p= tag, so there is no key to verify a signature with');
  // Whitespace inside p= is folding white space and not part of the key (RFC 6376 §3.6.1).
  const p = tags.p.replace(/\s+/g, '');
  if (p === '') return red('p= is EMPTY — the key is REVOKED (RFC 6376 §3.6.1), so every signature by this selector fails');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(p)) return red(`p= is not base64 (${p.length} chars)`);
  return ok(`key present, ${p.length} chars, k=${k}${tags.k === undefined ? ' (the default)' : ''}`);
}

function judgeDmarc(record, values) {
  const dm = values.filter((v) => /^v=DMARC1\s*(;|$)/.test(v.trim()));
  if (dm.length === 0) return red(`no record starts \`v=DMARC1\` among ${values.length} TXT record(s), and a receiver discards any that does not (RFC 7489 §6.6.3)`);
  if (dm.length > 1) return red(`${dm.length} DMARC records — RFC 7489 §6.6.3: with more than one, NO policy is applied`);
  const tags = tagList(dm[0]);
  if (tags === null) return red('the DMARC record is not a tag=value list');
  const p = String(tags.p ?? '').toLowerCase();
  if (p !== record.expect.p) return red(`p=${tags.p ?? '(absent)'}, where the register declares p=${record.expect.p}`);
  if (record.expect.rua !== undefined && tags.rua !== record.expect.rua) {
    return red(`rua=${tags.rua ?? '(absent)'}, where the register declares rua=${record.expect.rua}`);
  }
  return ok(`p=${p}${tags.rua !== undefined ? `, rua=${tags.rua}` : ''}`);
}

function judgeMx(record, rr) {
  const mx = rr.map((a) => {
    const m = String(a.data ?? '').trim().match(/^(\d+)\s+(\S+?)\.?$/);
    return m ? { preference: Number(m[1]), exchange: m[2].toLowerCase() } : null;
  });
  if (mx.some((x) => x === null)) return unjudged('an MX answer came back in a shape this file cannot read');
  const hit = mx.find((x) => x.exchange === record.expect.exchange);
  const held = mx.map((x) => `${x.preference} ${x.exchange}`).join(', ');
  if (!hit) return red(`no MX names ${record.expect.exchange}; the name holds ${held}`);
  // The register declares ONE exchange. A second one receives the bounces too, so
  // it is a change the register is edited for, never a pass.
  if (mx.length > 1) return red(`${mx.length} MX records (${held}), where the register declares one`);
  if (hit.preference !== record.expect.preference) {
    return red(`${hit.exchange} is at preference ${hit.preference}, where the register declares ${record.expect.preference}`);
  }
  return ok(`${hit.preference} ${hit.exchange}`);
}

/** PURE. One resolver's DoH JSON answer, judged against one declared record. */
export function judgeAnswer(record, body) {
  if (!body || typeof body !== 'object' || !Number.isInteger(body.Status)) {
    return unjudged('the answer carried no DNS Status, so it says nothing about the record');
  }
  if (body.Status === 3) return red('the name does not exist (NXDOMAIN)');
  if (body.Status !== 0) {
    return unjudged(`the resolver answered DNS status ${body.Status} (${RCODE[body.Status] ?? 'unknown'}), which is not an answer about the record`);
  }
  if (body.Answer !== undefined && !Array.isArray(body.Answer)) return unjudged('`Answer` came back as something other than a list');
  const rr = (body.Answer ?? []).filter((a) => a?.type === TYPE_CODE[record.type]);
  if (rr.length === 0) return red(`the name exists and holds no ${record.type} record`);
  if (record.kind === 'mx') return judgeMx(record, rr);
  const values = rr.map((a) => txtValue(a.data));
  if (record.kind === 'spf') return judgeSpf(record, values);
  if (record.kind === 'dkim') return judgeDkim(record, values);
  return judgeDmarc(record, values);
}

/** PURE. The resolvers' observations of ONE record, combined. A resolver that
 *  did not answer is set aside; the ones that answered must agree. A SPLIT —
 *  one ok, one RED — is NOT JUDGED: it is what a record mid-change looks like,
 *  and neither half is evidence alone. */
export function combine(observations) {
  const answered = observations.filter((o) => o.state === 'ok' || o.state === 'red');
  if (answered.length === 0) return { state: 'unjudged', split: false };
  if (new Set(answered.map((o) => o.state)).size > 1) return { state: 'unjudged', split: true };
  return { state: answered[0].state, split: false };
}

/**
 * ONE DoH read, on the shared bounded plan. The body is read INSIDE the attempt,
 * so a connection that drops mid-body is the wire dropping and is re-asked, not
 * an empty answer. A non-2xx that is not transient, or a body that is not JSON,
 * is an ANSWER about the resolver and ends as COULD NOT LOOK on first sight.
 *
 * `doFetch`, `sleep` and `note` are test seams; `signal` is the whole-run ceiling.
 */
export async function doh(resolver, name, type, { doFetch = fetch, sleep, note, signal } = {}) {
  const url = resolver.url(name, type);
  const res = await fetchWithBoundedRetry(
    async ({ signal: attempt }) => {
      const r = await doFetch(url, { headers: { accept: 'application/dns-json' }, signal: attempt });
      const text = await r.text();
      return { status: r.status, ok: r.ok, headers: r.headers, text };
    },
    { describe: (what) => `${resolver.host} ${name} ${type}: ${what}`, timeoutMs: DOH_TIMEOUT_MS, signal, sleep, note },
  );
  if (!res.ok) throw new CouldNotLook(`${resolver.host} ${name} ${type}: answered HTTP ${res.status}: ${String(res.text).slice(0, 200)}`);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new CouldNotLook(`${resolver.host} ${name} ${type}: answered a body that is not JSON: ${String(res.text).slice(0, 200)}`);
  }
}

/** IMPURE. Every declared record asked of every resolver, all at once. Never
 *  throws: a read that failed is that resolver's NOT JUDGED for that record. */
export async function readAll(records, { resolvers = RESOLVERS, doFetch, sleep, note, signal } = {}) {
  return Promise.all(
    records.map(async (record) => {
      const observations = await Promise.all(
        resolvers.map(async (resolver) => {
          try {
            const body = await doh(resolver, record.name, record.type, { doFetch, sleep, note, signal });
            return { resolver: resolver.host, ...judgeAnswer(record, body) };
          } catch (e) {
            const why = e instanceof CouldNotLook ? e.message : `${e?.name ?? 'Error'}: ${e?.message ?? e}`;
            return { resolver: resolver.host, state: 'unjudged', detail: why };
          }
        }),
      );
      return { record, observations, ...combine(observations) };
    }),
  );
}

/** PURE. The run's verdict: 1 if any record is RED, else 2 if any is NOT
 *  JUDGED, else 0. Zero records is 2: nothing was judged. */
export function judgeRun(results, resolvers = RESOLVERS) {
  if (!Array.isArray(results) || results.length === 0) {
    return { code: 2, lines: ['⬜ NOT JUDGED — no record was read, so nothing about the mail-auth DNS is known from this run. That is exit 2, never a pass.'] };
  }
  const lines = [];
  let nOk = 0;
  let nRed = 0;
  let nUnjudged = 0;
  const answeredBy = new Map(resolvers.map((r) => [r.host, 0]));
  for (const { record, observations, state, split } of results) {
    for (const o of observations) if (o.state !== 'unjudged') answeredBy.set(o.resolver, (answeredBy.get(o.resolver) ?? 0) + 1);
    const head = `${record.id}  ${record.name} ${record.type}`;
    const each = observations.map((o) => `${o.resolver}: ${o.state === 'ok' ? 'ok' : o.state === 'red' ? 'RED' : 'did not answer'} — ${o.detail}`);
    if (state === 'ok') {
      nOk += 1;
      const by = observations.filter((o) => o.state === 'ok');
      const silent = observations.filter((o) => o.state === 'unjudged');
      lines.push(`ok  ${head} — ${by[0].detail} · ${by.map((o) => o.resolver).join(', ')}`);
      for (const o of silent) lines.push(`      (${o.resolver} did not answer, so ${by.map((x) => x.resolver).join(', ')} decided: ${o.detail})`);
    } else if (state === 'red') {
      nRed += 1;
      lines.push(`✗ ${head} — RED: ${[...new Set(observations.filter((o) => o.state === 'red').map((o) => o.detail))].join(' / ')}`);
      for (const line of each) lines.push(`      ${line}`);
    } else {
      nUnjudged += 1;
      lines.push(`⬜ NOT JUDGED${split ? ' (SPLIT — the resolvers disagree)' : ''}  ${head}`);
      for (const line of each) lines.push(`      ${line}`);
    }
  }
  const counts = [...answeredBy].map(([host, n]) => `${host} (${n}/${results.length} answered)`).join(' and ');
  lines.push(`${results.length} record(s): ${nOk} ok · ${nRed} RED · ${nUnjudged} NOT JUDGED — read over DoH from ${counts}`);
  const code = nRed > 0 ? 1 : nUnjudged > 0 ? 2 : 0;
  if (code === 1) {
    lines.push(
      'A record above no longer says what tooling/mail-transport.json `authRecords` declares. If the DNS was changed on',
      'purpose, change the register to match in the same hour: until then this step turns ci-gate red on every open',
      'pull request. If it was not, mail is leaving without the authentication receivers check, and the DNS is the fix.',
    );
  } else if (code === 2) {
    lines.push(
      'NOT JUDGED is never a pass. A SPLIT is what a record mid-change looks like and settles within its TTL; a split',
      'that persists across runs is a question for the zone. A resolver that did not answer is an outage of that resolver.',
    );
  }
  return { code, lines };
}

async function main(argv) {
  const plan = argv.includes('--plan');
  const rootAt = argv.indexOf('--root');
  const root = rootAt >= 0 && argv[rootAt + 1] ? resolve(argv[rootAt + 1]) : REPO_ROOT;
  console.log(`check-mail-auth-dns — the mail-auth DNS records ${REGISTER_REL} declares, read over DoH   ([ADR 029])`);
  let records;
  try {
    records = loadDeclaration(readRegister(root));
  } catch (e) {
    console.error(`✗ COULD NOT LOOK — ${e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`}`);
    console.error('    No record was read. That is exit 2, never a pass.');
    process.exitCode = 2;
    return;
  }
  if (plan) {
    for (const r of records) console.log(`plan  ${r.id}  ${r.name} ${r.type}  → ${RESOLVERS.map((x) => x.host).join(', ')}`);
    console.log(`${records.length} record(s) × ${RESOLVERS.length} resolver(s) = ${records.length * RESOLVERS.length} DoH read(s) planned; --plan makes none of them`);
    process.exitCode = 0;
    return;
  }
  const deadline = runDeadline(RUN_CEILING_MS);
  let results;
  try {
    results = await readAll(records, { signal: deadline.signal, note: (line) => console.log(`      … ${line}`) });
  } finally {
    deadline.cancel();
  }
  const v = judgeRun(results);
  for (const line of v.lines) (v.code === 0 ? console.log : console.error)(line);
  process.exitCode = v.code;
}

if (process.argv[1] && process.argv[1].endsWith('check-mail-auth-dns.mjs')) {
  await main(process.argv.slice(2));
}
