// ─────────────────────────────────────────────────────────────────────────────
// apple-provisioning.mjs — the ONE reading of "what does a declared Apple
// capability require, and does what Apple and the tree hold agree with it".
//
// O-STAMP-APPLE-PROVISIONING-MANUAL · the structure it keeps is [ADR 088].
//
// 🔴 NOT A GUARD. Pure functions: parsed register, plist text, profile bytes
// and API read-backs in; verdicts out. No filesystem, no network, no exit. Two
// callers share it so they cannot disagree about what a declared capability
// requires:
//
//   tooling/ci/assert-apple-entitlements.mjs  the tree half (ci.yml, no secret)
//   tooling/ops/provision-apple.mjs           the account half (the ASC key)
//
// Each caller carries its own COVERAGE LOST over what it read.
//
// WHY THE ACCOUNT HALF IS MOSTLY *DETECTION*. The App Store Connect API
// boundary was measured against the live account on 2026-09-16 ([ADR 088] §6)
// and the two capabilities an app needs most are the two it cannot write:
// grouping Sign in with Apple under the consent anchor (RELATED_APP_CONSENT is
// readable and refused on write) and DECLARED_AGE_RANGE (refused as a
// capabilityType). An ungrouped app hands the same person a DIFFERENT Apple
// identifier, the platform makes them a second account, and nothing anywhere
// goes red. So `judgeCapabilities` below never answers "settled" while either
// is absent, and it never proposes writing APPLE_ID_AUTH for an app: the only
// shape the API accepts, PRIMARY_APP_CONSENT, is the defect.
// ─────────────────────────────────────────────────────────────────────────────

export const REGISTER = 'tooling/apple-provisioning.json';

/** The two App Store profile kinds a stamped app ships. The member extension is
 *  load-bearing: tooling/ci/apple-signing.mjs decides the platform BY EXTENSION
 *  (`.provisionprofile` = macOS, anything else = iOS). */
export const PROFILE_KINDS = Object.freeze([
  Object.freeze({ profileType: 'IOS_APP_STORE', label: 'iOS', ext: 'mobileprovision' }),
  Object.freeze({ profileType: 'MAC_APP_STORE', label: 'macOS', ext: 'provisionprofile' }),
]);

/** The App ID platform a stamped app is created with. SubscriptionTracker's
 *  App ID reads back UNIVERSAL, and one App ID serves both profile kinds. */
export const BUNDLE_PLATFORM = 'UNIVERSAL';

const CAP_OPTION_SETTING = 'APPLE_ID_AUTH_APP_CONSENT';

/** ⏱ 2026-09-18 · O-STAMP-APPLE-MACOS-ENTITLEMENTS. The platforms an
 *  `entitlementKey` object names. Each side is a key or null. */
export const ENTITLEMENT_PLATFORMS = Object.freeze(['ios', 'macos']);

/** A macOS entitlements file as the macOS Xcode project's CODE_SIGN_ENTITLEMENTS
 *  names it: `Runner/<Name>.entitlements`, relative to apps/<slug>/macos. */
export const MACOS_ENTITLEMENTS_FILE = /^Runner\/[A-Za-z0-9_-]+\.entitlements$/;

/** A value a flat entitlements dict may carry — the same set `parseFlatDict` reads. */
const isEntitlementValue = (v) =>
  typeof v === 'boolean' ||
  typeof v === 'string' ||
  Number.isInteger(v) ||
  (Array.isArray(v) && v.every((s) => typeof s === 'string'));

/** Apple refuses a bundle-id name with special characters (measured). */
export function bundleIdNameProblem(name) {
  if (typeof name !== 'string' || name.trim() === '') return 'the App ID name is empty';
  if (!/^[A-Za-z0-9 ]+$/.test(name)) {
    return `the App ID name "${name}" carries a character other than letters, digits and spaces — Apple refuses it`;
  }
  return null;
}

/** `Nikatru <App Name> <iOS|macOS> App Store` — [ADR 088] §5. The name is
 *  load-bearing: xcodebuild resolves a profile BY NAME. `appName` is the
 *  catalogue name, which already begins with "Nikatru". */
export function profileName(appName, kind) {
  return `${appName} ${kind.label} App Store`;
}

// ── the register ────────────────────────────────────────────────────────────

/** Every way the register can be unusable. [] when it is sound. */
export function validateRegister(reg) {
  const p = [];
  if (!reg || typeof reg !== 'object') return ['the register is not an object'];
  if (typeof reg.anchor?.identifier !== 'string' || !reg.anchor.identifier) p.push('anchor.identifier is missing');
  for (const k of ['bundleIds', 'profiles', 'certificates']) {
    if (!Array.isArray(reg.protected?.[k])) p.push(`protected.${k} must be an array`);
  }
  const caps = reg.capabilities;
  if (!caps || typeof caps !== 'object' || Object.keys(caps).length === 0) {
    p.push('capabilities declares no vocabulary');
  } else {
    for (const [name, c] of Object.entries(caps)) {
      if (typeof c.apiWritable !== 'boolean') p.push(`capabilities.${name}.apiWritable must be a boolean`);
      // ⏱ 2026-09-18: null, a string (the SAME key on iOS and macOS), or one
      // key-or-null per platform. An object naming no key at all is refused —
      // that is `null` spelt the long way, and two spellings of "none" is how a
      // reader starts treating one of them as "some".
      const ek = c.entitlementKey;
      const ekOk =
        ek === null ||
        (typeof ek === 'string' && ek) ||
        (ek && typeof ek === 'object' && !Array.isArray(ek) &&
          Object.keys(ek).length === ENTITLEMENT_PLATFORMS.length &&
          ENTITLEMENT_PLATFORMS.every((pl) => ek[pl] === null || (typeof ek[pl] === 'string' && ek[pl])) &&
          ENTITLEMENT_PLATFORMS.some((pl) => typeof ek[pl] === 'string'));
      if (!ekOk) {
        p.push(`capabilities.${name}.entitlementKey must be null, a string, or { ios, macos } each a key or null (not both null)`);
      }
      const pk = c.profileKey;
      const pkOk =
        pk === null ||
        (typeof pk === 'string' && pk) ||
        (pk && typeof pk === 'object' && PROFILE_KINDS.every((k) => typeof pk[k.profileType] === 'string' && pk[k.profileType]) &&
          Object.keys(pk).every((t) => PROFILE_KINDS.some((k) => k.profileType === t)));
      if (!pkOk) p.push(`capabilities.${name}.profileKey must be null, a string, or one string per profile type`);
      if (c.apiWritable === false && !(typeof c.portalStep === 'string' && c.portalStep.includes('{identifier}'))) {
        p.push(`capabilities.${name} is not API-writable, so it must name its portal step (with {identifier})`);
      }
      if (c.entitlementKey && c.entitlementValue === undefined) {
        p.push(`capabilities.${name}.entitlementKey needs an entitlementValue`);
      }
    }
  }
  // ⏱ 2026-09-18 · O-STAMP-APPLE-MACOS-ENTITLEMENTS: the base sandbox keys of
  // each macOS entitlements file. At least one file, each named as the macOS
  // project names it, each a non-empty flat dict. A capability's macOS key may
  // not also be a BASE key: the two would be one key with two owners, and the
  // derivation would have to pick a winner nobody declared.
  const mef = reg.macosEntitlementFiles;
  if (!mef || typeof mef !== 'object' || Array.isArray(mef)) {
    p.push('macosEntitlementFiles is missing — the macOS entitlements files have nothing to be derived from');
  } else {
    const files = Object.keys(mef).filter((k) => !k.startsWith('_'));
    if (files.length === 0) p.push('macosEntitlementFiles names no file');
    const capMacKeys = new Set(
      Object.values(caps ?? {})
        .map((c) => entitlementKeyFor(c, 'macos'))
        .filter(Boolean),
    );
    for (const f of files) {
      if (!MACOS_ENTITLEMENTS_FILE.test(f)) p.push(`macosEntitlementFiles."${f}" is not a Runner/<Name>.entitlements path`);
      const base = mef[f];
      if (!base || typeof base !== 'object' || Array.isArray(base) || Object.keys(base).length === 0) {
        p.push(`macosEntitlementFiles."${f}" must be a non-empty dict of base keys`);
        continue;
      }
      for (const [k, v] of Object.entries(base)) {
        if (!isEntitlementValue(v)) p.push(`macosEntitlementFiles."${f}".${k} is not a value an entitlements dict can carry`);
        if (capMacKeys.has(k)) p.push(`macosEntitlementFiles."${f}".${k} is also a capability's macOS key — one key, two owners`);
      }
    }
  }

  const apps = reg.apps;
  if (!apps || typeof apps !== 'object') {
    p.push('apps is missing');
  } else {
    for (const [slug, a] of Object.entries(apps)) {
      // architecture §24: the identity is DERIVED from the slug, never spelt.
      if (a.bundleId !== `com.nikatru.${slug}`) {
        p.push(`apps.${slug}.bundleId is "${a.bundleId}", but the identity is derived: com.nikatru.${slug}`);
      }
      if (a.bundleId === reg.anchor?.identifier) p.push(`apps.${slug} IS the consent anchor, which ships no app`);
      if (!Array.isArray(a.capabilities) || a.capabilities.length === 0) {
        p.push(`apps.${slug}.capabilities is empty — declare the list, even if it is only IN_APP_PURCHASE`);
        continue;
      }
      if (new Set(a.capabilities).size !== a.capabilities.length) p.push(`apps.${slug}.capabilities repeats a name`);
      for (const c of a.capabilities) {
        if (!caps?.[c]) p.push(`apps.${slug} declares ${c}, which the vocabulary does not define`);
      }
      if (a.name !== undefined && bundleIdNameProblem(a.name)) p.push(`apps.${slug}.name: ${bundleIdNameProblem(a.name)}`);
    }
  }
  // O-APPLE-RESOURCE-IDS-IN-COMMENTS: the ids that were live once. Absent reads
  // as []. A retired id that is also live is one id in two states, and the
  // guard's id set would then carry it for the wrong reason.
  const retired = reg.retired ?? [];
  if (!Array.isArray(retired)) {
    p.push('retired must be an array of { id, kind, retiredOn, why }');
  } else {
    const live = new Set(liveResourceIds(reg));
    const seen = new Set();
    for (const [i, r] of retired.entries()) {
      const at = `retired[${i}]`;
      if (!r || typeof r !== 'object') { p.push(`${at} is not an object`); continue; }
      if (!RESOURCE_ID.test(r.id ?? '')) p.push(`${at}.id "${r.id}" is not an App Store Connect resource id`);
      if (!RETIRED_KINDS.includes(r.kind)) p.push(`${at}.kind must be one of ${RETIRED_KINDS.join(', ')}`);
      if (!(r.retiredOn === 'unknown' || /^\d{4}-\d{2}-\d{2}$/.test(r.retiredOn ?? ''))) {
        p.push(`${at}.retiredOn must be YYYY-MM-DD, or "unknown" when no record gives the day`);
      }
      if (typeof r.why !== 'string' || r.why.trim() === '') p.push(`${at}.why is empty — say what it was and what replaced it`);
      if (seen.has(r.id)) p.push(`${at}.id ${r.id} is retired twice`);
      if (live.has(r.id)) p.push(`${at}.id ${r.id} is retired AND still named live in this register`);
      seen.add(r.id);
    }
  }
  return p;
}

/** O-SECOND-APP-SIGNS-AS-THE-FIRST — the bundle id `slug` signs with, read off
 *  the register rather than derived again by the caller: validateRegister above
 *  is where `com.nikatru.<slug>` is decided, so a second derivation would be a
 *  second place for it to drift. Throws on an unusable register and on a slug
 *  with no row, naming the slug; it never answers with a guess. */
export function bundleIdOf(reg, slug) {
  const problems = validateRegister(reg);
  if (problems.length) throw new Error(`${REGISTER} is unusable, so it names no bundle id for "${slug}": ${problems.join('; ')}`);
  const row = Object.hasOwn(reg.apps, slug) ? reg.apps[slug] : undefined;
  if (!row) {
    throw new Error(
      `${REGISTER} declares no app "${slug}" (it declares: ${Object.keys(reg.apps).join(', ') || 'none'}), so there is no bundle id to sign "${slug}" with`,
    );
  }
  return row.bundleId;
}

/** An App Store Connect resource id: ten upper-case letters and digits. */
const RESOURCE_ID = /^[A-Z0-9]{10}$/;
const RETIRED_KINDS = Object.freeze(['bundleId', 'profile', 'certificate']);

/** The resource ids the register names as live: the anchor's App ID, every app's
 *  App ID, and the protected profiles and certificates. */
function liveResourceIds(reg) {
  return [
    reg.anchor?.resourceId,
    ...Object.values(reg.apps ?? {}).map((a) => a?.resourceId),
    ...(Array.isArray(reg.protected?.profiles) ? reg.protected.profiles : []),
    ...(Array.isArray(reg.protected?.certificates) ? reg.protected.certificates : []),
  ].filter((id) => typeof id === 'string' && id);
}

/** O-APPLE-RESOURCE-IDS-IN-COMMENTS — every App Store Connect resource id this
 *  register names, live or retired, as the set assert-apple-entitlements refuses
 *  as a literal in any .mjs under tooling/ci. The register is the one tracked home of
 *  these ids; a comment that restates one is stale the day it is re-minted.
 *  Bundle IDENTIFIERS (com.nikatru.*) are names, not resource ids, and are not
 *  in the set. The team id is not either: the register does not carry it, and
 *  it is public in every signed binary's application-identifier. */
export function appleResourceIds(reg) {
  const retired = Array.isArray(reg?.retired) ? reg.retired.map((r) => r?.id) : [];
  return new Set([...liveResourceIds(reg ?? {}), ...retired].filter((id) => typeof id === 'string' && id));
}

/** The entitlement key a capability puts into the app's OWN entitlements file on
 *  `platform` ('ios' | 'macos'), or null. A string is the same key on both; an
 *  object names one per platform — ⏱ 2026-09-18, because DECLARED_AGE_RANGE's
 *  only consumer is iOS-only and macOS must not carry the key. Mirrors
 *  `profileKeyFor`, which already did this for profile types. */
export function entitlementKeyFor(vocab, platform) {
  const ek = vocab?.entitlementKey;
  if (!ek) return null;
  return typeof ek === 'string' ? ek : ek[platform] ?? null;
}

/** The keys an app's ios/Runner/Runner.entitlements must carry, derived. */
export function expectedEntitlements(reg, slug) {
  const out = new Map();
  for (const c of reg.apps[slug].capabilities) {
    const v = reg.capabilities[c];
    const key = entitlementKeyFor(v, 'ios');
    if (key) out.set(key, v.entitlementValue);
  }
  return out;
}

/** The macOS entitlements files the register governs, as the macOS Xcode
 *  project names them (`Runner/<Name>.entitlements`), in declared order. */
export function macosEntitlementFileNames(reg) {
  return Object.keys(reg.macosEntitlementFiles ?? {}).filter((k) => !k.startsWith('_'));
}

/** ⏱ 2026-09-18 · O-STAMP-APPLE-MACOS-ENTITLEMENTS. The keys one macOS
 *  entitlements file must carry: its declared BASE sandbox keys, in order, then
 *  the macOS key of every capability the app declares. `validateRegister`
 *  refuses a key owned by both, so the union never has to pick a winner. */
export function expectedMacosEntitlements(reg, slug, file) {
  const base = reg.macosEntitlementFiles?.[file];
  if (!base) throw new Error(`macosEntitlementFiles declares no "${file}"`);
  const out = new Map(Object.entries(base));
  for (const c of reg.apps[slug].capabilities) {
    const v = reg.capabilities[c];
    const key = entitlementKeyFor(v, 'macos');
    if (key) out.set(key, v.entitlementValue);
  }
  return out;
}

/** The entitlement key a capability puts into a profile of `profileType`, or
 *  null. A string means the same key on both platforms (measured for the two
 *  real capabilities); an object names one per profile type, because Apple
 *  spells some keys differently on macOS — push is `aps-environment` on iOS
 *  and `com.apple.developer.aps-environment` on macOS (measured 2026-09-16 on
 *  a throwaway App ID). */
export function profileKeyFor(vocab, profileType) {
  const pk = vocab.profileKey;
  if (!pk) return null;
  return typeof pk === 'string' ? pk : pk[profileType] ?? null;
}

/** The entitlement keys a correctly provisioned App Store profile carries. */
export function expectedProfileKeys(reg, slug, profileType) {
  return reg.apps[slug].capabilities.map((c) => profileKeyFor(reg.capabilities[c], profileType)).filter(Boolean);
}

// ── plists ──────────────────────────────────────────────────────────────────

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Parse ONE flat plist `<dict>` — the shape both an entitlements file and a
 * profile's Entitlements dict have. Values: true, false, string, integer and
 * arrays of strings. Anything else (a nested dict, data, a real) is REFUSED
 * with `ok: false` rather than skipped: a key silently dropped is a key the
 * comparison cannot see, and it would report agreement over it.
 *
 * `text` may be a whole plist file; comments are removed first, because
 * Runner.entitlements carries one that names the very key it explains.
 */
export function parseFlatDict(text) {
  // Stripped to a fixed point, then REFUSED if an opener survives: one pass can
  // leave a comment behind (CodeQL js/incomplete-multi-character-sanitization).
  // This is a parser, not a sanitiser, so the honest answer to a shape it cannot
  // read is ok: false.
  let src = String(text);
  for (let prev = null; prev !== src; ) {
    prev = src;
    src = src.replace(/<!--[\s\S]*?-->/g, '');
  }
  if (src.includes('<!--')) return { ok: false, reason: 'an unterminated or nested XML comment' };
  const open = src.indexOf('<dict>');
  const selfClosed = src.search(/<dict\s*\/>/);
  if (open === -1) {
    if (selfClosed !== -1) return { ok: true, entries: new Map() };
    return { ok: false, reason: 'no <dict> found' };
  }
  const close = src.indexOf('</dict>', open);
  if (close === -1) return { ok: false, reason: 'the <dict> is never closed' };
  const body = src.slice(open + '<dict>'.length, close);
  if (body.includes('<dict')) return { ok: false, reason: 'a nested <dict> — this reader handles flat dicts only' };
  const entries = new Map();
  const re = /<key>([^<]*)<\/key>\s*(<true\s*\/>|<false\s*\/>|<string>([^<]*)<\/string>|<string\s*\/>|<integer>(-?\d+)<\/integer>|<array>([\s\S]*?)<\/array>|<array\s*\/>)/g;
  for (const m of body.matchAll(re)) {
    const key = unescapeXml(m[1]);
    let value;
    if (m[2].startsWith('<true')) value = true;
    else if (m[2].startsWith('<false')) value = false;
    else if (m[2].startsWith('<string>')) value = unescapeXml(m[3]);
    else if (m[2].startsWith('<string')) value = '';
    else if (m[2].startsWith('<integer>')) value = Number(m[4]);
    else if (m[2].startsWith('<array>')) {
      const inner = m[5];
      const items = [...inner.matchAll(/<string>([^<]*)<\/string>/g)].map((x) => unescapeXml(x[1]));
      if (inner.replace(/<string>[^<]*<\/string>/g, '').trim() !== '') {
        return { ok: false, reason: `key ${key}: an array holding something other than strings` };
      }
      value = items;
    } else value = [];
    if (entries.has(key)) return { ok: false, reason: `key ${key} appears twice` };
    entries.set(key, value);
  }
  // Everything that is not a recognised pair must be whitespace, or a value
  // type this reader does not know was silently skipped.
  const leftover = body.replace(re, '').trim();
  if (leftover !== '') return { ok: false, reason: `unreadable content in the dict: ${leftover.slice(0, 60)}` };
  return { ok: true, entries };
}

/** The Entitlements dict of a provisioning profile (CMS/DER bytes; the plist
 *  inside is stored as plain text, as apple-signing.mjs parseMobileProvision
 *  also relies on). */
export function profileEntitlements(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('latin1') : String(bytes);
  const at = text.indexOf('<key>Entitlements</key>');
  if (at === -1) return { ok: false, reason: 'the profile carries no Entitlements key' };
  const open = text.indexOf('<dict>', at);
  const close = text.indexOf('</dict>', open);
  if (open === -1 || close === -1) return { ok: false, reason: 'the Entitlements dict is unreadable' };
  return parseFlatDict(text.slice(open, close + '</dict>'.length));
}

const canon = (v) => JSON.stringify(v);

/** Render a Runner.entitlements for `entries` (a Map, in declared order). */
export function renderEntitlements(entries) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<!-- WRITTEN by tooling/ops/provision-apple.mjs from tooling/apple-provisioning.json.',
    '\t     Change the declared capability list there, not this file: assert-apple-entitlements',
    '\t     fails when the two disagree. -->',
  ];
  for (const [k, v] of entries) {
    lines.push(`\t<key>${escapeXml(k)}</key>`);
    if (v === true) lines.push('\t<true/>');
    else if (v === false) lines.push('\t<false/>');
    else if (typeof v === 'number') lines.push(`\t<integer>${v}</integer>`);
    else if (Array.isArray(v)) {
      lines.push('\t<array>');
      for (const s of v) lines.push(`\t\t<string>${escapeXml(s)}</string>`);
      lines.push('\t</array>');
    } else lines.push(`\t<string>${escapeXml(String(v))}</string>`);
  }
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}

/** Runner.entitlements against the derived set, BOTH directions. */
export function compareFileToDeclared(fileEntries, expected) {
  const p = [];
  for (const [k, v] of expected) {
    if (!fileEntries.has(k)) p.push(`declares no ${k}, which the capability list requires`);
    else if (canon(fileEntries.get(k)) !== canon(v)) {
      p.push(`${k} is ${canon(fileEntries.get(k))}, the capability list requires ${canon(v)}`);
    }
  }
  for (const k of fileEntries.keys()) {
    if (!expected.has(k)) p.push(`carries ${k}, which no declared capability requires — declare it or remove it`);
  }
  return p;
}

/**
 * The LIVE profile against the declared list and against Runner.entitlements.
 *   · every declared capability with a profileKey must be in the profile;
 *   · no vocabulary profileKey may be in the profile undeclared (the App ID
 *     carries a capability the register does not know about);
 *   · every key Runner.entitlements carries must be in the profile, or the
 *     signed build is rejected at distribution.
 */
export function compareProfile({ reg, slug, profileType, profileEntries, fileEntries }) {
  const p = [];
  const declared = new Set(reg.apps[slug].capabilities);
  for (const [name, c] of Object.entries(reg.capabilities)) {
    const key = profileKeyFor(c, profileType);
    if (!key) continue;
    const has = profileEntries.has(key);
    if (declared.has(name) && !has) p.push(`lacks ${key}, which declared capability ${name} puts there — the profile predates the capability; re-mint it`);
    if (!declared.has(name) && has) p.push(`carries ${key} (${name}), which the capability list does not declare`);
  }
  for (const k of fileEntries?.keys() ?? []) {
    if (!profileEntries.has(k)) p.push(`lacks ${k}, which Runner.entitlements carries — a build signed with it is rejected`);
  }
  return p;
}

// ── the App ID ──────────────────────────────────────────────────────────────

/** The consent option an APPLE_ID_AUTH read-back carries, or null. */
export function consentOption(settings) {
  if (!Array.isArray(settings)) return null;
  const s = settings.find((x) => x?.key === CAP_OPTION_SETTING);
  const opts = s?.options;
  if (!Array.isArray(opts) || opts.length !== 1) return null;
  return opts[0]?.key ?? null;
}

/**
 * Judge an app's LIVE capabilities against its declared list.
 *
 * @param live       [{capabilityType, settings}] — GET …/bundleIdCapabilities
 * @param primaries  identifiers of every App ID in the team whose APPLE_ID_AUTH
 *                   reads PRIMARY_APP_CONSENT. The API does not say WHICH
 *                   primary a RELATED App ID points at, so "grouped under the
 *                   anchor" is proven as: RELATED, and the anchor is the team's
 *                   ONLY primary.
 * @returns { toEnable, portal, wrong, present, settled }
 *   toEnable  API-writable capabilities to POST
 *   portal    [{capability, step}] — absent, portal-only
 *   wrong     [string] — present but in a shape that is a defect
 *   settled   true only when nothing above is non-empty
 */
export function judgeCapabilities({ reg, slug, live, primaries }) {
  const identifier = reg.apps[slug].bundleId;
  const byType = new Map((live ?? []).map((c) => [c.capabilityType, c]));
  const toEnable = [];
  const portal = [];
  const wrong = [];
  const present = [];
  const step = (name) => reg.capabilities[name].portalStep.replaceAll('{identifier}', identifier);
  for (const name of reg.apps[slug].capabilities) {
    const vocab = reg.capabilities[name];
    const got = byType.get(name);
    if (!got) {
      if (vocab.apiWritable) toEnable.push(name);
      else portal.push({ capability: name, step: step(name) });
      continue;
    }
    if (name === 'APPLE_ID_AUTH') {
      const opt = consentOption(got.settings);
      if (opt === 'PRIMARY_APP_CONSENT') {
        wrong.push(
          `APPLE_ID_AUTH reads PRIMARY_APP_CONSENT: ${identifier} is its OWN consent anchor, so every user it shares with ` +
            `another app gets a different Apple identifier and a second account. Fix in the portal: ${step(name)}`,
        );
        continue;
      }
      if (opt !== vocab.readBack) {
        wrong.push(`APPLE_ID_AUTH reads ${canon(got.settings)}, not ${vocab.readBack}. ${step(name)}`);
        continue;
      }
      const others = (primaries ?? []).filter((x) => x !== reg.anchor.identifier);
      if (!(primaries ?? []).includes(reg.anchor.identifier) || others.length) {
        wrong.push(
          `APPLE_ID_AUTH reads ${vocab.readBack}, but the team's primaries are [${(primaries ?? []).join(', ')}] rather than ` +
            `exactly [${reg.anchor.identifier}] — the API does not say which primary this App ID is grouped under, so the ` +
            'grouping cannot be proven. Resolve the extra primary in the portal first.',
        );
        continue;
      }
    }
    present.push(name);
  }
  for (const c of live ?? []) {
    if (!reg.apps[slug].capabilities.includes(c.capabilityType)) {
      wrong.push(
        `the App ID carries ${c.capabilityType}, which the capability list does not declare — declare it in ` +
          `${REGISTER} or remove it in the portal (this script never removes a capability)`,
      );
    }
  }
  return { toEnable, portal, wrong, present, settled: toEnable.length + portal.length + wrong.length === 0 };
}

/** The ONLY capability write this module will build. APPLE_ID_AUTH is refused
 *  outright for an app: PRIMARY_APP_CONSENT is the one shape the API accepts
 *  and it is the defect ([ADR 088] §2). */
export function capabilityWriteBody(reg, bundleResourceId, name) {
  const vocab = reg.capabilities[name];
  if (!vocab?.apiWritable) throw new Error(`refusing to write ${name}: the register marks it portal-only`);
  if (name === 'APPLE_ID_AUTH') throw new Error('refusing to write APPLE_ID_AUTH for an app: the API accepts only PRIMARY_APP_CONSENT');
  return {
    data: {
      type: 'bundleIdCapabilities',
      attributes: { capabilityType: name },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundleResourceId } } },
    },
  };
}

// ── profiles ────────────────────────────────────────────────────────────────

/**
 * What to do about each App Store profile kind.
 *
 * @param profiles [{id, name, profileType, profileState, entries|null}]
 *                 — every profile the App ID has, entitlements parsed.
 * @returns [{kind, action, name, id?, why}] with action ∈
 *   keep · mint · remint · deferred · refused
 *
 * 🔴 ADDING A CAPABILITY INVALIDATES EVERY PROFILE OF THAT App ID (measured
 * 2026-09-16), so nothing is minted until the capabilities are SETTLED; a
 * profile that reads INVALID, or lacks a declared key, is re-minted — unless it
 * is protected, in which case the answer is `refused` and the caller exits
 * non-zero rather than breaking the release lane's secret.
 */
export function planProfiles({ reg, slug, appName, settled, profiles }) {
  const out = [];
  for (const kind of PROFILE_KINDS) {
    const want = expectedProfileKeys(reg, slug, kind.profileType);
    const name = profileName(appName, kind);
    const same = (profiles ?? []).filter((x) => x.profileType === kind.profileType && x.name === name);
    const good = same.find((x) => x.profileState === 'ACTIVE' && x.entries && want.every((k) => x.entries.has(k)));
    if (good) {
      out.push({ kind, action: 'keep', name, id: good.id, why: 'ACTIVE and carries every declared key' });
      continue;
    }
    if (!settled) {
      out.push({ kind, action: 'deferred', name, id: same[0]?.id, why: 'the capabilities are not settled — a profile minted now is invalidated by the portal step' });
      continue;
    }
    if (same.length === 0) {
      out.push({ kind, action: 'mint', name, why: 'no profile of this name exists' });
      continue;
    }
    const stale = same[0];
    const why =
      stale.profileState !== 'ACTIVE'
        ? `it reads ${stale.profileState}`
        : `it lacks ${want.filter((k) => !stale.entries?.has(k)).join(', ') || 'a readable Entitlements dict'}`;
    if (reg.protected.profiles.includes(stale.id)) {
      out.push({ kind, action: 'refused', name, id: stale.id, why: `${why}, and ${stale.id} is PROTECTED (baked into APPLE_PROVISIONING_PROFILES_BASE64) — re-mint it by hand and re-set the secret` });
    } else {
      out.push({ kind, action: 'remint', name, id: stale.id, why });
    }
  }
  return out;
}

export function profileWriteBody({ name, profileType, bundleResourceId, certificateId }) {
  return {
    data: {
      type: 'profiles',
      attributes: { name, profileType },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleResourceId } },
        certificates: { data: [{ type: 'certificates', id: certificateId }] },
      },
    },
  };
}

// ── the profile-set container ───────────────────────────────────────────────

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A STORED (method 0) zip of `[{name, bytes}]` — the container
 *  APPLE_PROVISIONING_PROFILES_BASE64 carries. The caller must re-read it with
 *  apple-signing.mjs `profileMembers` before trusting it. */
export function zipStored(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.bytes.length, 18);
    local.writeUInt32LE(e.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, e.bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.bytes.length, 20);
    central.writeUInt32LE(e.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + e.bytes.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
