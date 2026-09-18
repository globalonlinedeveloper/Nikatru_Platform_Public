#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// provision-apple.mjs — the stamp follow-up for the Apple side of one app.
//
// O-STAMP-APPLE-PROVISIONING-MANUAL · the structure it keeps is [ADR 088].
//
//   node tooling/ops/provision-apple.mjs --app <slug>            DRY RUN (default)
//   node tooling/ops/provision-apple.mjs --app <slug> --apply    mutate the account
//   … --profiles-zip <path outside the repo>                     build + validate the
//                                                                profile-set container
//   … --files-only [--apply]                                     ⏱ 2026-09-18: step 5's
//        TREE half only — the iOS and macOS entitlements files against the register.
//        It returns before the credentials are even read, so it makes NO App Store
//        Connect request of any kind and cannot touch a protected resource.
//
// From the app's DECLARED capability list (tooling/apple-provisioning.json) it:
//   1. creates the App ID `com.nikatru.<slug>` if absent            (API-writable)
//   2. enables every API-writable declared capability               (API-writable)
//   3. READS BACK the portal-only ones — the Sign in with Apple GROUPING under
//      com.nikatru.platform and DECLARED_AGE_RANGE — and when one is absent
//      EXITS NON-ZERO NAMING THE EXACT PORTAL STEP. It never reports success
//      over a missing one: an ungrouped app gives the same person a different
//      Apple identifier and a second account, and nothing else goes red.
//   4. only once the capabilities are SETTLED, mints the two App Store profiles
//      (`Nikatru <App Name> <iOS|macOS> App Store`, the DISTRIBUTION
//      certificate for both), and re-mints one that reads INVALID or lacks a
//      declared key. 🔴 Adding a capability invalidates every profile of the
//      App ID (measured 2026-09-16), which is why step 4 waits for step 3: the
//      normal new-app flow is TWO runs around the one owner click.
//   5. compares the LIVE profile's entitlements with the declared list and with
//      ios/Runner/Runner.entitlements, and (with --apply) writes that file from
//      the list when it disagrees. ⏱ 2026-09-18: the macOS entitlements files
//      named in the register's `macosEntitlementFiles` are written the same way,
//      from their base sandbox keys plus the declared macOS keys. A file is
//      rewritten ONLY when its KEYS differ, so a hand comment in a file that
//      already agrees survives. The tree-only half of this comparison is
//      tooling/ci/assert-apple-entitlements.mjs, in ci.yml.
//   6. with --profiles-zip, builds the zip APPLE_PROVISIONING_PROFILES_BASE64
//      carries — every declared app's ACTIVE profiles — and re-reads it with
//      apple-signing.mjs `profileMembers` before saying anything about it. It
//      NEVER sets the secret; it prints what the owner would set.
//
// 🔴 SAFETY. The dry run refuses every non-GET request BEFORE it is sent, and
// prints the count of mutating requests (always 0). With --apply, anything
// named in the register's `protected` block — the consent anchor, the shipping
// app's App ID, its two profiles and both certificates — is refused before the
// request is sent, whatever the plan says. Certificates are never written.
//
// Credentials: APPLE_ASC_ISSUER_ID, APPLE_ASC_KEY_ID, APPLE_ASC_KEY_FILE (a path
// relative to the repo root), read from the environment or the local vault
// through verify-auth-providers.mjs's reader — not a second copy of it.
//
// Exit 0 = the account, the profiles and the tree agree with the declared list
//          and nothing needed doing (or everything that needed doing was done
//          and read back).
// Exit 1 = a finding: a change is pending (dry run), a portal step is missing,
//          a shape is wrong, a protected resource would have to change, or the
//          tree disagrees.
// Exit 2 = COVERAGE LOST — no credentials, the API was unreachable or refused a
//          read, or a read came back in a shape this script cannot judge.
//
// 🔴 NO process.exit() ANYWHERE: after a real fetch it aborts Windows Node 24
// (src\win\async.c assertion) with the wrong status. process.exitCode only.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createSign, createHash } from 'node:crypto';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cred } from './verify-auth-providers.mjs';
import { profileMembers, parseMobileProvision, exportOptionsPlist } from '../ci/apple-signing.mjs';
import {
  REGISTER,
  PROFILE_KINDS,
  BUNDLE_PLATFORM,
  validateRegister,
  expectedEntitlements,
  expectedMacosEntitlements,
  macosEntitlementFileNames,
  parseFlatDict,
  renderEntitlements,
  compareFileToDeclared,
  compareProfile,
  profileEntitlements,
  consentOption,
  judgeCapabilities,
  capabilityWriteBody,
  planProfiles,
  profileWriteBody,
  bundleIdNameProblem,
  zipStored,
} from '../ci/apple-provisioning.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.appstoreconnect.apple.com';

class CoverageLost extends Error {}

/** Read a file ONCE; ENOENT is the only "absent" answer. An existsSync-then-read
 *  pair can see a file vanish between the two (CodeQL js/file-system-race). */
function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// ── the client ──────────────────────────────────────────────────────────────

/** ES256 JWT for the App Store Connect API. `ieee-p1363` is load-bearing: a
 *  DER-encoded signature is rejected. */
export function ascJwt({ issuerId, keyId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const b64u = (x) => Buffer.from(x).toString('base64url');
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: issuerId, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const signer = createSign('SHA256');
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${b64u(signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }))}`;
}

/**
 * A client that COUNTS what it sends and refuses what it must not.
 *   dryRun     → every non-GET throws before fetch.
 *   protectedIds → any non-GET whose path names one, or whose body names one
 *                  that is not a certificate, throws before fetch.
 */
export function ascClient({ jwt, dryRun, protectedIds = new Set(), protectedCertificates = new Set(), fetchImpl = fetch }) {
  const counts = { GET: 0, mutating: 0, refused: 0 };
  async function call(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (method !== 'GET') {
      if (dryRun) {
        counts.refused++;
        throw new Error(`dry run: refused ${method} ${path} before sending it`);
      }
      // The PATH is checked against every protected id. The BODY is checked
      // against all but the certificates: a new profile must NAME the
      // distribution certificate in its relationships, which reads it and does
      // not touch it (the first live mint was refused here for exactly that).
      const bodyText = payload ?? '';
      for (const id of protectedIds) {
        if (path.includes(id) || (!protectedCertificates.has(id) && bodyText.includes(id))) {
          counts.refused++;
          throw new Error(`PROTECTED: refused ${method} ${path} — it names ${id}`);
        }
      }
      counts.mutating++;
    } else counts.GET++;
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${jwt}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: payload } : {}),
      });
    } catch (e) {
      throw new CoverageLost(`${method} ${path} was unreachable: ${e.message}`);
    }
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, json };
  }
  async function read(path) {
    const out = [];
    let next = path;
    while (next) {
      const r = await call('GET', next);
      if (r.status !== 200) throw new CoverageLost(`GET ${next} answered ${r.status}: ${errText(r.json)}`);
      const data = r.json?.data;
      if (Array.isArray(data)) out.push(...data);
      else return data;
      const link = r.json?.links?.next;
      next = link ? link.slice(API.length) : null;
    }
    return out;
  }
  return { call, read, counts };
}

const errText = (j) => (j?.errors ?? []).map((e) => `${e.code ?? ''} ${e.detail ?? e.title ?? ''}`.trim()).join('; ') || 'no error body';

function credentials() {
  const issuerId = cred('APPLE_ASC_ISSUER_ID');
  const keyId = cred('APPLE_ASC_KEY_ID');
  const keyFile = cred('APPLE_ASC_KEY_FILE');
  if (!issuerId || !keyId || !keyFile) return null;
  const privateKey = readOrNull(isAbsolute(keyFile) ? keyFile : join(ROOT, keyFile));
  if (!privateKey) return null;
  return { issuerId, keyId, privateKey };
}

// ── the tree · ⏱ 2026-09-18 · O-STAMP-APPLE-MACOS-ENTITLEMENTS ────────────────

/**
 * ONE entitlements file brought to its derived set. Compared first and written
 * ONLY on a real KEY difference, so a hand comment in a file whose keys already
 * agree survives — the iOS file's [ADR 082] note and the macOS files'
 * network.client history both live in comments. Returns the entries the file
 * carries after the call, or null when it could not be read (never rewritten
 * over: an unread file is not known to be wrong). The iOS messages are the ones
 * step 5 printed before this was extracted, word for word.
 */
export function syncEntitlementsFile({ abs, label, expected, apply, pending, findings, written = [], log = console.log }) {
  const keys = `[${[...expected.keys()].join(', ')}]`;
  const short = label.split('/').pop();
  const text = readOrNull(abs);
  let entries;
  let diff;
  if (text !== null) {
    const parsed = parseFlatDict(text);
    if (!parsed.ok) {
      findings.push(`${label} is unreadable (${parsed.reason}) — not rewritten over`);
      return null;
    }
    entries = parsed.entries;
    diff = compareFileToDeclared(parsed.entries, expected);
  } else {
    entries = new Map();
    diff = expected.size ? [`does not exist and must carry ${keys}`] : [];
  }
  if (diff.length === 0) {
    log(`  ok   ${short} carries exactly ${keys} — not rewritten`);
    return entries;
  }
  if (!apply) {
    for (const d of diff) pending.push(`would write ${short}: it ${d}`);
    return entries;
  }
  writeFileSync(abs, renderEntitlements(expected));
  written.push(label);
  log(`  wrote ${label} ${keys} — review and commit it`);
  return expected;
}

/** Every macOS entitlements file the register names, for one app. */
export function syncMacosEntitlementFiles({ reg, slug, appDir, apply, pending, findings, written = [], log = console.log }) {
  if (!existsSync(join(appDir, 'macos', 'Runner'))) {
    pending.push(`apps/${slug}/macos/Runner does not exist — run the platform create step first; macOS entitlements not written`);
    return;
  }
  for (const f of macosEntitlementFileNames(reg)) {
    syncEntitlementsFile({
      abs: join(appDir, 'macos', ...f.split('/')),
      label: `apps/${slug}/macos/${f}`,
      expected: expectedMacosEntitlements(reg, slug, f),
      apply,
      pending,
      findings,
      written,
      log,
    });
  }
}

// ── arguments ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { apply: false, filesOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--apply') a.apply = true;
    else if (k === '--files-only') a.filesOnly = true;
    else if (k === '--app') a.app = argv[++i];
    else if (k === '--profiles-zip') a.zip = argv[++i];
    else if (k === '--register') a.register = argv[++i];
    else throw new CoverageLost(`unknown argument ${k}`);
  }
  if (!a.app) throw new CoverageLost('usage: provision-apple.mjs --app <slug> [--apply] [--profiles-zip <path>] [--files-only]');
  if (a.filesOnly && a.zip) throw new CoverageLost('--files-only reads no profile, so it cannot build --profiles-zip');
  return a;
}

function appName(reg, slug) {
  if (reg.apps[slug].name) return reg.apps[slug].name;
  const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog', 'apps.json'), 'utf8'));
  const row = catalog.find((r) => r.slug === slug);
  if (!row?.name) throw new CoverageLost(`catalog/apps.json has no name for ${slug}, and the register row declares none`);
  return row.name;
}

// ── the run ─────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registerPath = args.register ? resolve(args.register) : join(ROOT, REGISTER);
  const reg = JSON.parse(readFileSync(registerPath, 'utf8'));
  const bad = validateRegister(reg);
  if (bad.length) {
    for (const p of bad) console.error(`✗ ${REGISTER}: ${p}`);
    return 1;
  }
  const slug = args.app;
  const row = reg.apps[slug];
  if (!row) {
    console.error(`✗ ${REGISTER} declares no app "${slug}". Declare its capability list first.`);
    return 1;
  }

  // ⏱ 2026-09-18 · --files-only: step 5's TREE half and nothing else. It returns
  // HERE, before `credentials()` is called, so no App Store Connect request can be
  // built, let alone sent — the safe way to write the entitlements files for an app
  // whose App ID and profiles are protected.
  if (args.filesOnly) {
    const pending = [];
    const findings = [];
    const written = [];
    const appDir = join(ROOT, 'apps', slug);
    console.log(`provision-apple --files-only — ${slug}: the entitlements files against ${REGISTER}. No App Store Connect request is made.`);
    if (!existsSync(join(appDir, 'ios', 'Runner'))) {
      pending.push(`apps/${slug}/ios/Runner does not exist — run the platform create step first; Runner.entitlements not written`);
    } else {
      syncEntitlementsFile({
        abs: join(appDir, 'ios', 'Runner', 'Runner.entitlements'),
        label: `apps/${slug}/ios/Runner/Runner.entitlements`,
        expected: expectedEntitlements(reg, slug),
        apply: args.apply,
        pending,
        findings,
        written,
      });
    }
    syncMacosEntitlementFiles({ reg, slug, appDir, apply: args.apply, pending, findings, written });
    for (const p of pending) console.log(`  pending  ${p}`);
    for (const f of findings) console.error(`✗ ${f}`);
    if (findings.length) return 1;
    if (pending.length) {
      console.log(`\nprovision-apple --files-only — ${pending.length} file change(s) pending for ${slug}. ${args.apply ? '' : 'Re-run with --apply to write them.'}`);
      return 1;
    }
    if (written.length) {
      console.log(`\nprovision-apple --files-only — ${slug}: wrote ${written.length} file(s) from the declared list; each now agrees. Review and commit them.`);
      return 0;
    }
    console.log(`\nprovision-apple --files-only — ${slug}: every entitlements file agrees with the declared list. No change.`);
    return 0;
  }

  const name = appName(reg, slug);
  const nameProblem = bundleIdNameProblem(name);
  if (nameProblem) {
    console.error(`✗ ${nameProblem}`);
    return 1;
  }
  const creds = credentials();
  if (!creds) {
    console.error('✗ COVERAGE LOST — APPLE_ASC_ISSUER_ID / APPLE_ASC_KEY_ID / APPLE_ASC_KEY_FILE are not all readable. I could not look.');
    return 2;
  }

  const protectedIds = new Set([
    ...reg.protected.profiles,
    ...reg.protected.certificates,
    ...[reg.anchor.resourceId, ...Object.values(reg.apps).filter((x) => reg.protected.bundleIds.includes(x.bundleId)).map((x) => x.resourceId)].filter(Boolean),
    ...reg.protected.bundleIds,
  ]);
  const api = ascClient({ jwt: ascJwt(creds), dryRun: !args.apply, protectedIds, protectedCertificates: new Set(reg.protected.certificates) });
  const mode = args.apply ? 'APPLY' : 'DRY RUN';
  console.log(`provision-apple — ${slug} (${row.bundleId}) — ${mode}`);
  console.log(`  declared: [${row.capabilities.join(', ')}]`);
  const findings = [];
  const pending = [];

  // ── the team: every App ID, and which of them is a consent primary ──
  const readTeam = async () => {
    const all = (await api.read('/v1/bundleIds?limit=200')).filter((b) => b.attributes?.platform !== 'SERVICES');
    const caps = new Map();
    for (const b of all) caps.set(b.id, (await api.read(`/v1/bundleIds/${b.id}/bundleIdCapabilities`)).map((c) => c.attributes));
    const primaries = all
      .filter((b) => caps.get(b.id).some((c) => c.capabilityType === 'APPLE_ID_AUTH' && consentOption(c.settings) === 'PRIMARY_APP_CONSENT'))
      .map((b) => b.attributes.identifier);
    return { all, caps, primaries };
  };
  let team = await readTeam();
  const anchor = team.all.find((b) => b.attributes.identifier === reg.anchor.identifier);
  if (!anchor) {
    console.error(`✗ the consent anchor ${reg.anchor.identifier} does not exist in the team. Nothing can be grouped under it.`);
    return 1;
  }
  if (reg.anchor.resourceId && anchor.id !== reg.anchor.resourceId) {
    findings.push(`the anchor ${reg.anchor.identifier} is resource ${anchor.id}, the register says ${reg.anchor.resourceId}`);
  }
  if (!team.primaries.includes(reg.anchor.identifier)) {
    findings.push(`the anchor ${reg.anchor.identifier} does not read APPLE_ID_AUTH(PRIMARY_APP_CONSENT)`);
  }
  console.log(`  team: ${team.all.length} App ID(s); consent primaries [${team.primaries.join(', ')}]`);

  // ── 1. the App ID ──
  let bundle = team.all.find((b) => b.attributes.identifier === row.bundleId);
  if (!bundle) {
    if (!args.apply) {
      pending.push(`would create App ID ${row.bundleId} ("${name}", ${BUNDLE_PLATFORM})`);
    } else {
      const r = await api.call('POST', '/v1/bundleIds', {
        data: { type: 'bundleIds', attributes: { identifier: row.bundleId, name, platform: BUNDLE_PLATFORM } },
      });
      if (r.status !== 201) throw new CoverageLost(`POST /v1/bundleIds answered ${r.status}: ${errText(r.json)}`);
      console.log(`  created App ID ${row.bundleId} → ${r.json.data.id}`);
      team = await readTeam();
      bundle = team.all.find((b) => b.attributes.identifier === row.bundleId);
      if (!bundle) throw new CoverageLost(`${row.bundleId} was created and does not read back`);
    }
  } else {
    console.log(`  App ID ${row.bundleId} exists → ${bundle.id} (${bundle.attributes.platform})`);
    if (row.resourceId && row.resourceId !== bundle.id) findings.push(`${row.bundleId} is resource ${bundle.id}, the register says ${row.resourceId}`);
  }

  // ── 2 + 3. capabilities ──
  let verdict = judgeCapabilities({ reg, slug, live: bundle ? team.caps.get(bundle.id) : [], primaries: team.primaries });
  if (verdict.toEnable.length) {
    if (!args.apply || !bundle) {
      for (const c of verdict.toEnable) pending.push(`would enable ${c} on ${row.bundleId}`);
    } else {
      for (const c of verdict.toEnable) {
        const r = await api.call('POST', '/v1/bundleIdCapabilities', capabilityWriteBody(reg, bundle.id, c));
        if (r.status !== 201) {
          findings.push(`POST /v1/bundleIdCapabilities ${c} answered ${r.status}: ${errText(r.json)}`);
          continue;
        }
        console.log(`  enabled ${c}`);
      }
      team = await readTeam();
      verdict = judgeCapabilities({ reg, slug, live: team.caps.get(bundle.id), primaries: team.primaries });
      for (const c of verdict.toEnable) findings.push(`${c} was enabled and does not read back`);
    }
  }
  for (const c of verdict.present) console.log(`  ok   ${c} reads back as declared`);
  for (const w of verdict.wrong) findings.push(w);
  const portal = verdict.portal;
  for (const p of portal) {
    findings.push(`🔴 PORTAL STEP MISSING — ${p.capability} is absent on ${row.bundleId} and the API cannot write it.\n       ${p.step}\n       Then run this command again: profiles are minted only after this step, because the step invalidates them.`);
  }

  // ── 4. profiles ──
  const readProfiles = async () => {
    if (!bundle) return [];
    return (await api.read(`/v1/bundleIds/${bundle.id}/profiles?limit=200`)).map((p) => {
      const bytes = Buffer.from(p.attributes.profileContent ?? '', 'base64');
      const ent = bytes.length && bytes[0] === 0x30 ? profileEntitlements(bytes) : { ok: false, reason: 'no DER profileContent' };
      return { id: p.id, ...p.attributes, bytes, entries: ent.ok ? ent.entries : null, entReason: ent.ok ? null : ent.reason };
    });
  };
  let profiles = await readProfiles();
  let plan = planProfiles({ reg, slug, appName: name, settled: verdict.settled && !!bundle, profiles });
  const needsMint = plan.some((x) => x.action === 'mint' || x.action === 'remint');
  let certificateId = null;
  if (needsMint || args.apply) {
    const certs = await api.read('/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200');
    if (certs.length !== 1) {
      console.error(`✗ COVERAGE LOST — the team has ${certs.length} DISTRIBUTION certificate(s); exactly one is required to mint without guessing.`);
      return 2;
    }
    certificateId = certs[0].id;
  }
  if (needsMint && args.apply) {
    for (const step of plan) {
      if (step.action !== 'mint' && step.action !== 'remint') continue;
      if (step.action === 'remint') {
        const d = await api.call('DELETE', `/v1/profiles/${step.id}`);
        if (d.status !== 204) {
          findings.push(`DELETE /v1/profiles/${step.id} answered ${d.status}: ${errText(d.json)}`);
          continue;
        }
        console.log(`  deleted stale profile ${step.id} (${step.why})`);
      }
      const r = await api.call('POST', '/v1/profiles', profileWriteBody({ name: step.name, profileType: step.kind.profileType, bundleResourceId: bundle.id, certificateId }));
      if (r.status !== 201) {
        findings.push(`POST /v1/profiles "${step.name}" answered ${r.status}: ${errText(r.json)}`);
        continue;
      }
      console.log(`  minted "${step.name}" → ${r.json.data.id}`);
    }
    profiles = await readProfiles();
    plan = planProfiles({ reg, slug, appName: name, settled: verdict.settled, profiles });
  }
  for (const step of plan) {
    const line = `${step.kind.label} "${step.name}"${step.id ? ` (${step.id})` : ''}: ${step.why}`;
    if (step.action === 'keep') console.log(`  ok   profile ${line}`);
    else if (step.action === 'deferred') pending.push(`profile deferred — ${line}`);
    else if (step.action === 'refused') findings.push(`profile REFUSED — ${line}`);
    else if (args.apply) findings.push(`profile still needs ${step.action} after the apply — ${line}`);
    else pending.push(`would ${step.action} profile — ${line}`);
  }

  // ── 5. the tree, and the live profile against it ──
  const expected = expectedEntitlements(reg, slug);
  const appDir = join(ROOT, 'apps', slug);
  const entFile = join(appDir, 'ios', 'Runner', 'Runner.entitlements');
  let fileEntries = null;
  if (!existsSync(join(appDir, 'ios', 'Runner'))) {
    pending.push(`apps/${slug}/ios/Runner does not exist — run the platform create step first; Runner.entitlements not written`);
  } else {
    // Extracted 2026-09-18 into `syncEntitlementsFile`, messages unchanged, so the
    // macOS files and --files-only go through the same compare-then-write.
    fileEntries = syncEntitlementsFile({
      abs: entFile,
      label: `apps/${slug}/ios/Runner/Runner.entitlements`,
      expected,
      apply: args.apply,
      pending,
      findings,
    });
    const pbx = join(appDir, 'ios', 'Runner.xcodeproj', 'project.pbxproj');
    if (expected.size && !(readOrNull(pbx) ?? '').includes('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;')) {
      findings.push(`apps/${slug}/ios/Runner.xcodeproj never sets CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements — the file is inert until it does`);
    }
  }
  syncMacosEntitlementFiles({ reg, slug, appDir, apply: args.apply, pending, findings });
  for (const step of plan.filter((x) => x.action === 'keep')) {
    const prof = profiles.find((x) => x.id === step.id);
    // Runner.entitlements is the iOS target's file; the macOS profile is held
    // to the declared list only.
    const file = step.kind.profileType === 'IOS_APP_STORE' ? fileEntries : null;
    for (const p of compareProfile({ reg, slug, profileType: step.kind.profileType, profileEntries: prof.entries, fileEntries: file })) {
      findings.push(`live ${step.kind.label} profile ${prof.id} ${p}`);
    }
  }
  for (const p of profiles) {
    if (!plan.some((x) => x.id === p.id)) console.log(`  note profile ${p.id} "${p.name}" (${p.profileType}, ${p.profileState}) is not one this script manages — left alone`);
  }

  // ── 6. the profile-set container ──
  if (args.zip) {
    const zipProblems = await buildZip({ reg, api, out: args.zip, registerPath });
    findings.push(...zipProblems);
  }

  // ── verdict ──
  console.log('');
  for (const p of pending) console.log(`  pending  ${p}`);
  for (const f of findings) console.error(`✗ ${f}`);
  console.log(`\n  requests: ${api.counts.GET} GET, ${api.counts.mutating} mutating, ${api.counts.refused} refused before sending`);
  if (findings.length) return 1;
  if (pending.length) {
    console.log(`\nprovision-apple — ${pending.length} change(s) pending for ${slug}. ${args.apply ? '' : 'Re-run with --apply to make the API-writable ones.'}`);
    return 1;
  }
  console.log(`\nprovision-apple — ${slug}: the App ID, its profiles and every entitlements file agree with the declared list. No change.`);
  return 0;
}

async function buildZip({ reg, api, out, registerPath }) {
  const target = resolve(out);
  const rel = relative(ROOT, target);
  if (!rel.startsWith('..') && !isAbsolute(rel)) return [`--profiles-zip ${out} is inside the repository; write it somewhere that cannot be committed`];
  const problems = [];
  const entries = [];
  const expect = [];
  const team = (await api.read('/v1/bundleIds?limit=200')).filter((b) => b.attributes?.platform !== 'SERVICES');
  for (const [slug, row] of Object.entries(reg.apps)) {
    const b = team.find((x) => x.attributes.identifier === row.bundleId);
    if (!b) {
      problems.push(`profile set: ${row.bundleId} has no App ID, so the set cannot include ${slug}`);
      continue;
    }
    const name = appName(reg, slug);
    const profs = await api.read(`/v1/bundleIds/${b.id}/profiles?limit=200`);
    for (const kind of PROFILE_KINDS) {
      const want = `${name} ${kind.label} App Store`;
      const p = profs.find((x) => x.attributes.name === want && x.attributes.profileType === kind.profileType && x.attributes.profileState === 'ACTIVE');
      if (!p) {
        problems.push(`profile set: no ACTIVE "${want}" — the set would ship without it`);
        continue;
      }
      entries.push({ name: `${slug}.${kind.ext}`, bytes: Buffer.from(p.attributes.profileContent, 'base64') });
      expect.push({ member: `${slug}.${kind.ext}`, name: want, bundleId: row.bundleId, id: p.id });
    }
  }
  if (problems.length) return problems;
  const zip = zipStored(entries);
  // Re-read with the EXACT function the release lane uses.
  const { kind, members } = profileMembers(zip);
  if (kind !== 'zip' || !members || members.length !== entries.length) {
    return [`profile set: apple-signing.mjs profileMembers read ${kind} with ${members?.length ?? 'no'} member(s), expected a zip of ${entries.length}`];
  }
  const parsed = [];
  for (const e of expect) {
    const m = members.find((x) => x.name === e.member);
    const pm = m && parseMobileProvision(m.bytes);
    if (!pm) problems.push(`profile set: ${e.member} does not parse as a profile`);
    else if (pm.bundleId !== e.bundleId || pm.name !== e.name) problems.push(`profile set: ${e.member} reads ${pm.name} / ${pm.bundleId}, expected ${e.name} / ${e.bundleId}`);
    else parsed.push({ ...pm, member: e.member });
  }
  if (problems.length) return problems;
  const ios = parsed.filter((p) => !p.member.endsWith('.provisionprofile'));
  const teamId = ios[0]?.teamIds?.[0];
  try {
    exportOptionsPlist({ teamId, profiles: ios });
  } catch (e) {
    return [`profile set: exportOptionsPlist refused it — ${e.message}`];
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, zip);
  const sha = createHash('sha256').update(zip).digest('hex').slice(0, 12);
  console.log(`\n  profile set → ${target} (${zip.length} bytes, sha256 ${sha}…), validated by apple-signing.mjs profileMembers:`);
  for (const e of expect) console.log(`    ${e.member}  "${e.name}"  ${e.id}`);
  console.log('  NOT SET. The owner would base64 this file into the APPLE_PROVISIONING_PROFILES_BASE64 repository secret.');
  console.log(`  (register: ${relative(ROOT, registerPath) || registerPath})`);
  return [];
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await main();
  } catch (e) {
    if (e instanceof CoverageLost) {
      console.error(`✗ COVERAGE LOST — ${e.message}`);
      process.exitCode = 2;
    } else if (/^(PROTECTED|dry run):/.test(e.message)) {
      console.error(`✗ ${e.message}`);
      process.exitCode = 1;
    } else {
      console.error(`✗ ${e.stack ?? e.message}`);
      process.exitCode = 1;
    }
  }
}
