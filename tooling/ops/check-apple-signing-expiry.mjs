#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-apple-signing-expiry.mjs — the Apple signing certificates and App Store
// profiles, held against the dates App Store Connect itself reports.
//
// O-APPLE-SIGNING-EXPIRY-UNWATCHED. Four `expiring` rows in
// tooling/ops/register.json carry these dates:
//   expiring.cert.apple-distribution       certificateType DISTRIBUTION           leadDays 45
//   expiring.cert.apple-installer          certificateType MAC_INSTALLER_DISTRIBUTION  leadDays 45
//   expiring.profile.apple-appstore-ios    profileType IOS_APP_STORE              leadDays 30
//   expiring.profile.apple-appstore-macos  profileType MAC_APP_STORE              leadDays 30
// Each `expires` is WRITTEN BY THIS CHECKER FROM THE APP STORE CONNECT READ
// (`--write`), and tooling/ci/assert-ops-register.mjs grades it against its
// `leadDays` on every CI run and prints it. Before this file nothing in the tree
// read a certificate's or a profile's `expirationDate`; the only expiry check was
// tooling/ci/apple-signing.mjs, which fails a BUILD on a profile already expired,
// with no lead window at all.
//
// ── WHY IT IMPORTS `ascJwt` AND NOTHING ELSE FROM provision-apple.mjs ────────
// provision-apple.mjs's `ascClient` sends POST and DELETE behind `--apply`. This
// file runs with the App Store Connect key in its environment, from a scheduled
// workflow and a dispatched one, so it must hold NO code path that can send a
// non-GET to Apple: it signs its token with `ascJwt` and makes its own GETs.
// tooling/ci/test/apple-signing-expiry.test.mjs A16 fails the build if a
// non-GET method or `ascClient` ever appears in this file's code.
//
// ── WHY THE IDS COME FROM apple-provisioning.json AND ROWS ARE MATCHED BY TYPE ──
// The ids are `protected.certificates` and `protected.profiles` in
// tooling/apple-provisioning.json — the one declaration of the live Apple ids.
// Each id is read, and the TYPE Apple answers with decides its row; its position
// in the array never does. That is measured history, not tidiness:
// tooling/channel-register.json records that the profiles were re-minted TWICE on
// 2026-09-16 and that "the first pair went INVALID the moment the owner added
// Sign in with Apple … a provisioning profile EMBEDS the App ID's entitlements at
// the instant it is issued". A profile id changes, and a profile can turn INVALID
// long before its date — so a re-minted id, changed in that one declaration, is
// followed here with no register edit, and a profile whose `profileState` is not
// ACTIVE is a finding on the day Apple says so, before a build finds it.
//
// ── WHAT EACH EXIT MEANS (1 beats 2; a 2 is never lowered to a 0) ───────────
//   0 — every row was read and matches: the register's `expires` is the UTC date
//       of Apple's `expirationDate`, and every profile is ACTIVE.
//   1 — A FINDING. A row is missing, its date differs from Apple's, an id answered
//       404 (revoked or deleted), an answered type matches no row or two ids
//       match one row, or a profile is not ACTIVE. The remedy for a date or a
//       missing row: cut a branch from main, dispatch apple-expiry-write.yml on
//       it, open the pull request. A 404 or an INVALID profile is a re-mint.
//   2 — COULD NOT LOOK. A credential is missing, the key did not sign, Apple
//       answered 401/403, a read outlived the bounded retry (5xx, a timeout, a
//       dropped wire), or an answer came back in a shape this file cannot read.
//       Nothing about that row is known from this run, and that is never a pass.
//
// ── `--write` ────────────────────────────────────────────────────────────────
// Runs ONLY in .github/workflows/apple-expiry-write.yml (dispatch-only, never on
// main). It refuses when `CI` is unset (so never on a laptop) and when
// `GITHUB_REF_NAME` is `main`, both before any request. It is ALL OR NOTHING: if
// any row is NOT JUDGED or any resource is a finding a date cannot repair, it
// writes nothing. It rewrites `expires` and `expiryKnownAt` of an existing row
// whose date or read id changed, leaves a current row byte-identical (so a
// dispatch with nothing to change commits nothing), and creates an absent row
// from ROW_TEMPLATES after `expiring.store-enrolment.appstore`.
// 🔴 register.json DOES NOT ROUND-TRIP through JSON.stringify(_, null, 2) —
// measured 2026-09-24: the first differing byte is an irregular indent inside a
// `_readme`/`_why` string array. So the write EDITS TEXT, in place, and then proves the edit
// by parsing both files and requiring every value outside the edited rows to be
// equal. A whole-file re-serialisation would have rewritten lines it never meant
// to touch.
//
// ── THE CEILING ─────────────────────────────────────────────────────────────
// Every GET goes through fetchWithBoundedRetry (tooling/ops/bounded-retry.mjs)
// with `timeoutMs: 15_000`. The four reads run CONCURRENTLY, so the whole run is
// bounded by ONE read's wall ceiling (READ_WALL_CEILING_MS, 55 s) rather than
// four in a row. A run-wide AbortController is deliberately absent: the B8 limb
// of ops-bounded-retry.test.mjs refuses a second timer in any importer of the
// shared plan.
//
// Usage:  node tooling/ops/check-apple-signing-expiry.mjs [--write] [--root <dir>]
// Env:    APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_KEY_ID,
//         APP_STORE_CONNECT_PRIVATE_KEY (the .p8 key CONTENT; never printed)
//
// 🔴 `process.exit()` IS BANNED IN THIS FILE, as in its neighbours: after a
// fetch it aborts Node on Windows. `process.exitCode` only.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ascJwt } from './provision-apple.mjs';
import { CouldNotLook, fetchWithBoundedRetry } from './bounded-retry.mjs';

// One class for the lane, re-exported (bounded-retry.mjs, "ONE class").
export { CouldNotLook } from './bounded-retry.mjs';

export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASC_API = 'https://api.appstoreconnect.apple.com';
export const REGISTER_REL = 'tooling/ops/register.json';
export const PROVISIONING_REL = 'tooling/apple-provisioning.json';
/** The workflow `--write` runs in, by FILE NAME. This file reads no workflow, so
 *  it holds no workflow path literal (assert-workflow-readers.mjs R1). */
export const WRITE_WORKFLOW = 'apple-expiry-write.yml';
/** A new row is inserted after this one: the Apple membership row. */
export const INSERT_AFTER = 'expiring.store-enrolment.appstore';
/** The per-request ceiling passed to the shared plan. It equals the plan's own
 *  15 s, stated here so the number this file runs under is readable at the call. */
export const ASC_TIMEOUT_MS = 15_000;
export const CREDENTIALS = ['APP_STORE_CONNECT_ISSUER_ID', 'APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_PRIVATE_KEY'];

const REMEDY =
  'REMEDY: cut a branch from main, dispatch .github/workflows/apple-expiry-write.yml on it, and open the pull request it pushes to.';

/** The four rows, keyed by the TYPE App Store Connect answers with. `leadDays`:
 *  45 for a certificate (renewal is a new signing identity, then re-setting
 *  APPLE_DIST_CERT_P12_BASE64 / APPLE_INSTALLER_CERT_P12_BASE64 and the profile
 *  set), 30 for a profile (the register's own precedent). */
export const ROW_TEMPLATES = [
  {
    id: 'expiring.cert.apple-distribution',
    resource: 'certificates',
    typeField: 'certificateType',
    type: 'DISTRIBUTION',
    leadDays: 45,
    what: 'The Apple DISTRIBUTION signing certificate: every iOS and macOS App Store build is signed with it, and both App Store profiles name it.',
    response:
      'Create a new DISTRIBUTION certificate before this date, re-set APPLE_DIST_CERT_P12_BASE64, re-mint the App Store profiles against it and re-set APPLE_PROVISIONING_PROFILES_BASE64, put the new ids in tooling/apple-provisioning.json, then cut a branch from main, dispatch apple-expiry-write.yml on it and open the pull request.',
  },
  {
    id: 'expiring.cert.apple-installer',
    resource: 'certificates',
    typeField: 'certificateType',
    type: 'MAC_INSTALLER_DISTRIBUTION',
    leadDays: 45,
    what: 'The Apple MAC_INSTALLER_DISTRIBUTION certificate: the macOS App Store package is signed with it.',
    response:
      'Create a new MAC_INSTALLER_DISTRIBUTION certificate before this date, re-set APPLE_INSTALLER_CERT_P12_BASE64, put the new id in tooling/apple-provisioning.json, then cut a branch from main, dispatch apple-expiry-write.yml on it and open the pull request.',
  },
  {
    id: 'expiring.profile.apple-appstore-ios',
    resource: 'profiles',
    typeField: 'profileType',
    type: 'IOS_APP_STORE',
    leadDays: 30,
    what: 'The iOS App Store provisioning profile the release lane signs with (profileType IOS_APP_STORE). A profile can also turn INVALID before its date — adding a capability to the App ID does it — and the checker reports that too.',
    response:
      'Re-mint the profile (tooling/ops/provision-apple.mjs), re-set APPLE_PROVISIONING_PROFILES_BASE64, put the new id in tooling/apple-provisioning.json, then cut a branch from main, dispatch apple-expiry-write.yml on it and open the pull request.',
  },
  {
    id: 'expiring.profile.apple-appstore-macos',
    resource: 'profiles',
    typeField: 'profileType',
    type: 'MAC_APP_STORE',
    leadDays: 30,
    what: 'The macOS App Store provisioning profile the release lane signs with (profileType MAC_APP_STORE). A profile can also turn INVALID before its date — adding a capability to the App ID does it — and the checker reports that too.',
    response:
      'Re-mint the profile (tooling/ops/provision-apple.mjs), re-set APPLE_PROVISIONING_PROFILES_BASE64, put the new id in tooling/apple-provisioning.json, then cut a branch from main, dispatch apple-expiry-write.yml on it and open the pull request.',
  },
];

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const ID_SHAPE = /^[A-Za-z0-9]{1,64}$/;

/** IMPURE (one file read). The ids to read, from `protected` in
 *  tooling/apple-provisioning.json. A missing or malformed block is COULD NOT
 *  LOOK: reading nothing would satisfy every row vacuously. */
export function readProtectedIds(root) {
  let reg;
  try {
    reg = JSON.parse(readFileSync(join(root, PROVISIONING_REL), 'utf8'));
  } catch (e) {
    throw new CouldNotLook(`${PROVISIONING_REL} could not be read as JSON (${e?.code ?? e?.name ?? 'error'}: ${e?.message ?? e})`);
  }
  const out = {};
  for (const key of ['certificates', 'profiles']) {
    const list = reg?.protected?.[key];
    if (!Array.isArray(list) || list.length === 0) {
      throw new CouldNotLook(`${PROVISIONING_REL} \`protected.${key}\` is not a non-empty array, so there is nothing to read`);
    }
    for (const id of list) {
      if (typeof id !== 'string' || !ID_SHAPE.test(id)) {
        throw new CouldNotLook(`${PROVISIONING_REL} \`protected.${key}\` holds ${JSON.stringify(id)}, which is not an App Store Connect id`);
      }
    }
    out[key] = [...list];
  }
  return out;
}

/**
 * ONE App Store Connect GET, on the shared bounded plan. Resolves to the parsed
 * body on 200 and to `null` on 404 (the id is revoked or deleted — an ANSWER,
 * graded by the caller as a finding). Every other non-2xx is COULD NOT LOOK, with
 * Apple's own body quoted; 429/5xx and a dropped wire are re-asked first.
 *
 * `doFetch`, `sleep` and `note` are the test seams (ops-bounded-retry.test.mjs
 * B10 drives this function through them).
 */
export async function ascGet(path, jwt, { doFetch = fetch, sleep, note } = {}) {
  const res = await fetchWithBoundedRetry(
    ({ signal }) => doFetch(`${ASC_API}${path}`, { headers: { authorization: `Bearer ${jwt}`, accept: 'application/json' }, signal }),
    { describe: (s) => `GET ${path}: ${s}`, timeoutMs: ASC_TIMEOUT_MS, sleep, note },
  );
  let text;
  try {
    text = await res.text();
  } catch (e) {
    throw new CouldNotLook(`GET ${path} answered HTTP ${res.status} and then dropped mid-body (${e?.message ?? e})`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new CouldNotLook(`GET ${path} answered HTTP ${res.status}: ${String(text).slice(0, 600)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new CouldNotLook(`GET ${path} answered unparseable JSON: ${String(text).slice(0, 200)}`);
  }
}

/** IMPURE. Every protected id, read CONCURRENTLY (see "THE CEILING"). Each
 *  outcome is kept per id, so one unreadable id never hides the others. */
export async function readAll(ids, jwt, opts = {}) {
  const asks = [
    ...ids.certificates.map((id) => ({ resource: 'certificates', id })),
    ...ids.profiles.map((id) => ({ resource: 'profiles', id })),
  ];
  return Promise.all(
    asks.map(async ({ resource, id }) => {
      const path = `/v1/${resource}/${encodeURIComponent(id)}`;
      try {
        const body = await ascGet(path, jwt, opts);
        return body === null ? { resource, id, path, status: 'not-found' } : { resource, id, path, status: 'ok', body };
      } catch (e) {
        if (e instanceof CouldNotLook) return { resource, id, path, status: 'could-not-look', reason: e.message };
        throw e;
      }
    }),
  );
}

/** PURE. The UTC date part of an ISO instant, or null when it is not one. */
export function utcDate(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * PURE. The reads, matched to ROW_TEMPLATES by the TYPE Apple answered with.
 * Returns `{ rows: Map<rowId, entry>, findings, lost }`: a finding is exit 1, a
 * lost read is exit 2. A template no read claimed is a finding only when every
 * read was made; with a read lost, it is NOT JUDGED rather than accused.
 */
export function mapResources(reads, templates = ROW_TEMPLATES) {
  const rows = new Map();
  const findings = [];
  const lost = [];
  const claims = new Map();
  for (const r of reads) {
    if (r.status === 'could-not-look') {
      lost.push(`${r.resource} ${r.id} — COULD NOT LOOK: ${r.reason}`);
      continue;
    }
    if (r.status === 'not-found') {
      findings.push(`${r.resource} ${r.id} answered 404 — revoked or deleted in App Store Connect, while ${PROVISIONING_REL} still declares it. That is a re-mint: replace the id there, then dispatch the write.`);
      continue;
    }
    const data = r.body?.data;
    const attrs = data?.attributes;
    const tpl0 = templates.find((t) => t.resource === r.resource);
    const typeField = tpl0?.typeField;
    if (!data || typeof data !== 'object' || data.id !== r.id || !attrs || typeof attrs !== 'object' || !typeField) {
      lost.push(`${r.resource} ${r.id} — COULD NOT LOOK: the answer is not a \`data\` object for this id with \`attributes\``);
      continue;
    }
    const type = attrs[typeField];
    const expires = utcDate(attrs.expirationDate);
    if (!nonEmpty(type) || expires === null) {
      lost.push(`${r.resource} ${r.id} — COULD NOT LOOK: \`${typeField}\` ${JSON.stringify(type ?? null)} or \`expirationDate\` ${JSON.stringify(attrs.expirationDate ?? null)} is not readable`);
      continue;
    }
    const tpl = templates.find((t) => t.resource === r.resource && t.type === type);
    if (!tpl) {
      findings.push(`${r.resource} ${r.id} answered ${typeField} ${type}, which no row claims (${templates.filter((t) => t.resource === r.resource).map((t) => t.type).join(' · ')}). ${PROVISIONING_REL} declares an id this file has no row for.`);
      continue;
    }
    const state = r.resource === 'profiles' ? (nonEmpty(attrs.profileState) ? attrs.profileState : null) : 'n/a';
    if (state === null) {
      lost.push(`${r.resource} ${r.id} — COULD NOT LOOK: \`profileState\` ${JSON.stringify(attrs.profileState ?? null)} is not readable`);
      continue;
    }
    if (!claims.has(tpl.id)) claims.set(tpl.id, []);
    claims.get(tpl.id).push({ template: tpl, ascId: r.id, type, expires, raw: attrs.expirationDate, state, resource: r.resource });
  }
  for (const [rowId, list] of claims) {
    if (list.length > 1) {
      findings.push(`${rowId} — ${list.length} ids answered ${list[0].type} (${list.map((x) => x.ascId).join(', ')}); exactly one may. ${PROVISIONING_REL} declares a second id of one type.`);
      continue;
    }
    const e = list[0];
    if (e.resource === 'profiles' && e.state !== 'ACTIVE') {
      findings.push(`${rowId} · ${e.ascId} · ${e.type} · profileState ${e.state} — Apple no longer honours this profile, whatever its date. That is a re-mint (tooling/ops/provision-apple.mjs), then the write.`);
    }
    rows.set(rowId, e);
  }
  for (const t of templates) {
    if (rows.has(t.id) || claims.has(t.id)) continue;
    if (lost.length) lost.push(`${t.id} — NOT JUDGED: no read that was made answered ${t.type}, and ${lost.length} read(s) above were lost`);
    else findings.push(`${t.id} — no id in ${PROVISIONING_REL} \`protected.${t.resource}\` answered ${t.typeField} ${t.type}`);
  }
  return { rows, findings, lost };
}

/** PURE. The row line every judged row prints. */
const rowLine = (e) => `${e.template.id} · ${e.ascId} · ${e.type} · expires ${e.expires} · ${e.state === 'n/a' ? 'no state (a certificate carries none)' : e.state}`;

/**
 * PURE. The register's rows against what Apple answered. Returns
 * `{ code, ok, bad, notJudged }` — `ok` and `bad` are lines, one per row.
 */
export function judgeRows({ register, mapped, templates = ROW_TEMPLATES }) {
  const rowsById = new Map((register?.rows ?? []).map((r) => [r?.id, r]));
  const ok = [];
  const bad = [...mapped.findings];
  for (const t of templates) {
    const e = mapped.rows.get(t.id);
    if (!e) continue;
    const row = rowsById.get(t.id);
    if (!row) bad.push(`${rowLine(e)} — NO ROW \`${t.id}\` in ${REGISTER_REL}. ${REMEDY}`);
    else if (row.expires !== e.expires) bad.push(`${rowLine(e)} — ${REGISTER_REL} says \`expires: ${JSON.stringify(row.expires ?? null)}\`, App Store Connect says ${e.expires}. ${REMEDY}`);
    else ok.push(rowLine(e));
  }
  const notJudged = [...mapped.lost];
  return { code: bad.length ? 1 : notJudged.length ? 2 : 0, ok, bad, notJudged };
}

/** PURE. The full row for a template, in the register's `expiring` shape. */
export function buildRow(t, e, stamp) {
  return {
    id: t.id,
    kind: 'expiring',
    what: t.what,
    detector: `tooling/ops/check-apple-signing-expiry.mjs compares \`expires\` with App Store Connect and exits 1 on a differing date, a missing row, a 404 or a profile that is not ACTIVE; tooling/ci/assert-ops-register.mjs grades \`expires\` against \`leadDays\` on every CI run and prints it.`,
    response: t.response,
    cadence: '180d',
    expires: e.expires,
    leadDays: t.leadDays,
    mechanism: {
      substrate: 'external-registry',
      anchor: PROVISIONING_REL,
      record: `App Store Connect \`GET v1/${t.resource}/{id}\` -> \`attributes.expirationDate\`${t.resource === 'profiles' ? ' and `attributes.profileState`' : ''}, for the id in ${PROVISIONING_REL} \`protected.${t.resource}\` that answers ${t.typeField} ${t.type}`,
      failingValue: `\`expires\` inside ${t.leadDays} days or past; the register's date differing from Apple's; the id answering 404${t.resource === 'profiles' ? '; `profileState` other than ACTIVE' : ''}`,
      readBy: `tooling/ops/check-apple-signing-expiry.mjs (with --write only from .github/workflows/${WRITE_WORKFLOW}, dispatch-only and never on main); tooling/ci/assert-ops-register.mjs, which grades and prints the date`,
    },
    accessProviders: ['apple'],
    ownerGated: false,
    source: 'verified',
    expiryKnownAt: knownAt(t, e, stamp),
  };
}

/** PURE. Where and when the date was read — rewritten on every write. */
function knownAt(t, e, stamp) {
  return (
    `App Store Connect \`GET v1/${t.resource}/${e.ascId}\` -> \`attributes.expirationDate\` ${e.raw}` +
    `${t.resource === 'profiles' ? `, profileState ${e.state}` : ''}; read by tooling/ops/check-apple-signing-expiry.mjs --write in ${stamp.runRef} at ${stamp.readAt}. ` +
    `Written by the checker from the App Store Connect read; the next dispatch of ${WRITE_WORKFLOW} rewrites it.`
  );
}

/** PURE. The text span `[start, end)` of the JSON object that holds `"id": "<id>"`
 *  at its own level, found by bracket matching that steps over strings. */
function objectSpan(text, id) {
  const needle = `"id": ${JSON.stringify(id)}`;
  const at = text.indexOf(needle);
  if (at === -1) return null;
  if (text.indexOf(needle, at + needle.length) !== -1) {
    throw new CouldNotLook(`${REGISTER_REL} names ${needle} more than once, so which object is the row would be a guess`);
  }
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    const c = text[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  // `id` is the FIRST key of every row this file touches, so only whitespace may
  // sit between the brace and it — which also means no string was stepped over.
  if (start === -1 || text.slice(start + 1, at).trim() !== '') {
    throw new CouldNotLook(`${needle} is not the first key of an object in ${REGISTER_REL}, so its row cannot be located`);
  }
  depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      for (i += 1; i < text.length && text[i] !== '"'; i += text[i] === '\\' ? 2 : 1);
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  throw new CouldNotLook(`the object holding ${needle} in ${REGISTER_REL} never closes`);
}

/** Replace exactly one match of `re` inside `[span.start, span.end)`. */
function replaceOnce(text, span, re, value, what) {
  const inner = text.slice(span.start, span.end);
  const hits = [...inner.matchAll(re)];
  if (hits.length !== 1) throw new CouldNotLook(`${what}: found ${hits.length} match(es) where exactly one is required`);
  const m = hits[0];
  const at = span.start + m.index;
  return { text: text.slice(0, at) + value + text.slice(at + m[0].length), delta: value.length - m[0].length };
}

/**
 * PURE. The register TEXT with every judged row's `expires` and `expiryKnownAt`
 * rewritten, and every absent row created after INSERT_AFTER (in template
 * order). Text is edited in place — register.json does not round-trip through
 * JSON.stringify — and the result is PROVEN: both texts are parsed, and every
 * value outside the rows this call touched must be equal. Returns
 * `{ text, changed, created }`.
 */
export function writeRows(text, mapped, stamp, templates = ROW_TEMPLATES) {
  const before = JSON.parse(text);
  const expected = JSON.parse(text);
  let out = text;
  const changed = [];
  const created = [];
  let prevId = INSERT_AFTER;
  for (const t of templates) {
    const e = mapped.rows.get(t.id);
    if (!e) throw new CouldNotLook(`${t.id} was not judged, so nothing may be written (all or nothing)`);
    const existing = (before.rows ?? []).find((r) => r?.id === t.id);
    // A row whose date and whose read id already agree is LEFT BYTE-IDENTICAL, so
    // a dispatch with nothing to change leaves no diff and commits nothing.
    const current = existing && existing.expires === e.expires && String(existing.expiryKnownAt ?? '').includes(`GET v1/${t.resource}/${e.ascId}\``);
    if (current) {
      prevId = t.id;
      continue;
    }
    if (existing) {
      const span = objectSpan(out, t.id);
      const r1 = replaceOnce(out, span, /"expires": (?:null|"[^"\\]*")/g, `"expires": ${JSON.stringify(e.expires)}`, `${t.id} \`expires\``);
      const span2 = { start: span.start, end: span.end + r1.delta };
      const r2 = replaceOnce(r1.text, span2, /"expiryKnownAt": "(?:[^"\\]|\\.)*"/g, `"expiryKnownAt": ${JSON.stringify(knownAt(t, e, stamp))}`, `${t.id} \`expiryKnownAt\``);
      out = r2.text;
      const row = expected.rows.find((r) => r?.id === t.id);
      row.expires = e.expires;
      row.expiryKnownAt = knownAt(t, e, stamp);
      changed.push(t.id);
    } else {
      const span = objectSpan(out, prevId);
      if (!span) throw new CouldNotLook(`${REGISTER_REL} has no row \`${prevId}\` to insert ${t.id} after`);
      const lineStart = out.lastIndexOf('\n', span.start) + 1;
      const indent = out.slice(lineStart, span.start);
      if (!/^[ ]*$/.test(indent)) throw new CouldNotLook(`the row \`${prevId}\` does not start its own line, so its indentation cannot be copied`);
      const row = buildRow(t, e, stamp);
      const body = JSON.stringify(row, null, 2).split('\n').join(`\n${indent}`);
      out = `${out.slice(0, span.end)},\n${indent}${body}${out.slice(span.end)}`;
      const at = expected.rows.findIndex((r) => r?.id === prevId);
      expected.rows.splice(at + 1, 0, row);
      created.push(t.id);
    }
    prevId = t.id;
  }
  let after;
  try {
    after = JSON.parse(out);
  } catch (e) {
    throw new CouldNotLook(`the edited ${REGISTER_REL} does not parse (${e.message}); nothing was written`);
  }
  if (JSON.stringify(after) !== JSON.stringify(expected)) {
    throw new CouldNotLook(`the text edit of ${REGISTER_REL} changed something besides the rows it was asked to write; nothing was written`);
  }
  return { text: out, changed, created };
}

/** The key as a PEM. A secret pasted with literal `\n` escapes and no real
 *  newline is unfolded; nothing else is touched. Never printed. */
function pemOf(raw) {
  return raw.includes('\\n') && !raw.includes('\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function parseArgs(argv) {
  const args = { write: false, root: null, bad: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--write') args.write = true;
    else if (argv[i] === '--root' && nonEmpty(argv[i + 1])) args.root = resolve(argv[(i += 1)]);
    else args.bad = `unknown or incomplete argument ${JSON.stringify(argv[i])}`;
  }
  return args;
}

/**
 * The whole run, with every outside input injected: `env`, `doFetch`, `sleep`,
 * `now` (ms), and the two print sinks. Resolves to the exit code.
 */
export async function run(argv, { env = process.env, doFetch = fetch, sleep, note, now = () => Date.now(), log = console.log, error = console.error } = {}) {
  const args = parseArgs(argv);
  if (args.bad) {
    error(`✗ COULD NOT LOOK — ${args.bad}. Usage: check-apple-signing-expiry.mjs [--write] [--root <dir>]`);
    return 2;
  }
  const root = args.root ?? DEFAULT_ROOT;
  log(`check-apple-signing-expiry — the Apple signing certificates and App Store profiles against App Store Connect (${args.write ? '--write' : 'check'})`);
  if (args.write) {
    if (!nonEmpty(env.CI)) {
      error(`✗ REFUSED — --write runs only inside CI, from ${WRITE_WORKFLOW}; \`CI\` is not set, so this is not that run. Nothing was read and nothing was written.`);
      return 2;
    }
    if (env.GITHUB_REF_NAME === 'main') {
      error(`✗ REFUSED — --write never runs on main. Cut a branch from main and dispatch ${WRITE_WORKFLOW} on it. Nothing was read and nothing was written.`);
      return 2;
    }
  }
  const missing = CREDENTIALS.filter((k) => !nonEmpty(env[k]));
  if (missing.length) {
    error(`✗ COULD NOT LOOK — ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in the environment, so App Store Connect was not read.`);
    error('    Nothing about any certificate or profile is known from this run. That is exit 2, never a pass.');
    return 2;
  }
  let ids;
  let registerText;
  let register;
  try {
    ids = readProtectedIds(root);
    registerText = readFileSync(join(root, REGISTER_REL), 'utf8');
    register = JSON.parse(registerText);
  } catch (e) {
    error(`✗ COULD NOT LOOK — ${e instanceof CouldNotLook ? e.message : `${REGISTER_REL}: ${e.message}`}`);
    return 2;
  }
  let jwt;
  try {
    jwt = ascJwt({
      issuerId: env.APP_STORE_CONNECT_ISSUER_ID,
      keyId: env.APP_STORE_CONNECT_KEY_ID,
      privateKey: pemOf(env.APP_STORE_CONNECT_PRIVATE_KEY),
      now: Math.floor(now() / 1000),
    });
  } catch (e) {
    error(`✗ COULD NOT LOOK — APP_STORE_CONNECT_PRIVATE_KEY did not sign a token (${e?.code ?? e?.name ?? 'error'}). The key is not printed.`);
    return 2;
  }
  const reads = await readAll(ids, jwt, { doFetch, sleep, note });
  const mapped = mapResources(reads);
  const verdict = judgeRows({ register, mapped });
  const report = (v) => {
    for (const l of v.ok) log(`ok  ${l}`);
    for (const l of v.bad) error(`✗ ${l}`);
    for (const l of v.notJudged) error(`✗ ${l}`);
  };
  if (!args.write) {
    report(verdict);
    log(`check-apple-signing-expiry — ${verdict.ok.length} row(s) match App Store Connect · ${verdict.bad.length} finding(s) · ${verdict.notJudged.length} NOT JUDGED · exit ${verdict.code}`);
    return verdict.code;
  }
  // ── --write: ALL OR NOTHING ──
  if (mapped.findings.length || mapped.lost.length) {
    for (const l of mapped.findings) error(`✗ ${l}`);
    for (const l of mapped.lost) error(`✗ ${l}`);
    error(`✗ NOTHING WRITTEN — ${mapped.findings.length} finding(s) a date cannot repair and ${mapped.lost.length} read(s) NOT JUDGED. A partial write would record some rows as read and leave the rest to look covered.`);
    return mapped.findings.length ? 1 : 2;
  }
  const stamp = {
    runRef: nonEmpty(env.GITHUB_RUN_ID) ? `apple-expiry-write.yml run ${env.GITHUB_RUN_ID}` : 'a run with no GITHUB_RUN_ID',
    readAt: new Date(now()).toISOString(),
  };
  let written;
  try {
    written = writeRows(registerText, mapped, stamp);
  } catch (e) {
    error(`✗ NOTHING WRITTEN — ${e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`}`);
    return 2;
  }
  writeFileSync(join(root, REGISTER_REL), written.text);
  const after = judgeRows({ register: JSON.parse(written.text), mapped });
  report(after);
  log(`check-apple-signing-expiry — wrote ${REGISTER_REL}: ${written.created.length} row(s) created (${written.created.join(', ') || 'none'}), ${written.changed.length} rewritten (${written.changed.join(', ') || 'none'}) · exit ${after.code}`);
  return after.code;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (e) {
    console.error(`✗ COULD NOT LOOK — ${e instanceof CouldNotLook ? e.message : `${e?.name}: ${e?.message}`}`);
    process.exitCode = 2;
  }
}
