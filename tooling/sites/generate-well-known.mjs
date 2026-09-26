#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-well-known.mjs — the PORTFOLIO-WIDE deep-link association files:
// `sites/nikatru/.well-known/apple-app-site-association` (AASA) and
// `sites/nikatru/.well-known/assetlinks.json`.
//
// [ADR 075] — every app moves from `<app>.nikatru.com` to `nikatru.com/<app>`.
// Derived from `catalog/apps.json` + `apps/<id>/app.yaml`; the apex is imported
// from `tooling/sites/apex.mjs` and never retyped.
//
// ── WHY THESE TWO FILES BECAME ONE FILE EACH, FOR EVERYTHING ─────────────────
// 🔴 BOTH ARE ORIGIN-SCOPED BY SPECIFICATION. iOS fetches
// `https://<domain>/.well-known/apple-app-site-association` and Android fetches
// `https://<domain>/.well-known/assetlinks.json` from the ORIGIN — neither
// protocol has any notion of a path-scoped association document. While every app
// had its own subdomain, each app had its own origin and therefore its own pair
// of files, and one app's mistake could only ever hurt that app. Since [ADR 075]
// there is ONE origin, so there is ONE AASA and ONE assetlinks.json for the
// whole portfolio, served by the apex.
//
// `sites/nikatru/functions/_middleware.js` already refuses to proxy
// `/.well-known/` (its `NEVER_PROXY` list) for exactly this reason: proxying it
// to an app would hand that one app the deep-link verification of every other
// app on the origin.
//
// 🔴 AND THAT IS THE WHOLE ARGUMENT FOR GENERATING THEM. A malformed entry for
// app #7 does not break app #7's universal links; it breaks the FILE, and the
// file is every app's. iOS caches a failed association aggressively and Android
// re-verifies on install, so the blast radius of one hand-edited comma is the
// portfolio, discovered on somebody else's device. Hand-editing is the failure
// mode; this generator plus `tooling/ci/assert-well-known-shape.mjs` is the fix.
//
// ── WHAT IT EMITS TODAY: NOTHING. MEASURED, NOT ASSUMED ──────────────────────
// Measured on this tree 2026-09-09:
//   · `catalog/apps.json` holds ONE row — `subscriptiontracker`, `platforms: ["web"]`, and
//     every `listings.*` key but `web` is null;
//   · `tooling/channel-register.json` has `served: true` on the `web` row ALONE
//     (11 of 12 rows are `served: false`, both mobile rows among them);
//   · no `.well-known` directory exists anywhere in the tree, and no file in it.
// So zero apps have a shipped mobile identity, and this generator writes NO FILE
// and says so.
//
// 🔴 AN EMPTY ASSOCIATION FILE IS NOT THE HARMLESS DEFAULT IT LOOKS LIKE.
// Apple does not fetch AASA from this origin directly: it fetches through its own
// CDN (`app-site-association.cdn-apple.com`), which caches what it gets. An empty
// `applinks.details` published today is a cached, authoritative "no app claims any
// path on nikatru.com" — and the first REAL file has to outlive that cache before
// a universal link works. Publishing nothing has no such cost: an absent file is
// a miss, not a negative answer with a TTL on it. The same argument holds more
// weakly for `assetlinks.json` (an empty array is a valid document meaning "no
// app is verified for this origin"), so both follow the same rule.
//
// The machinery therefore ships BEFORE the first file does, and the guard asserts
// the pair "zero qualifying apps AND zero well-known files" as a MEASUREMENT that
// goes red if either half moves alone. That is the idiom `sites/nikatru/_headers`
// already uses for its `/*.css` rule — "a class declared before its first file
// arrives" — applied to a file rather than to a header.
//
// ── QUALIFYING: PRESENCE **AND** IDENTITY, AND A MISMATCH IS A FINDING ───────
// An app qualifies for an AASA entry when BOTH halves are true:
//   PRESENCE  `platforms` contains `ios`, or `listings.appstore` is a non-null
//             URL — the app is actually published on that mobile channel;
//   IDENTITY  `apps/<id>/app.yaml` declares `mobile.ios.appleTeamId` and
//             `mobile.ios.bundleId` — the two halves of the `appID` AASA needs.
// Android is the same shape: `platforms` contains `android` / `listings.play`
// non-null, plus `mobile.android.packageName` and a non-empty
// `mobile.android.sha256CertFingerprints`.
//
// 🔴 NEITHER HALF IS INVENTED AND HALF AN APP IS A FINDING, NOT A SKIP. A team id
// is issued by Apple and a signing fingerprint is a property of a keystore; there
// is no derivation from anything in this repository, so an app with the presence
// and no identity is REFUSED (the run writes nothing and exits 1) rather than
// silently dropped — a silently dropped app is a universal link that fails for
// one product while every check stays green. An identity with no presence is
// refused for the mirror reason: it publishes deep-link authority for an app that
// is not shipped.
//
// ⚠️ `mobile:` IS NOT IN `tooling/app-yaml/schema/app.schema.json` TODAY, and the
// schema sets `additionalProperties: false`. That is not an oversight to route
// around here: the day an app really has a mobile identity, the schema gains the
// block (that file belongs to the app-yaml unit, not to this one) and this
// generator starts emitting without another edit. Until then the "no app
// qualifies" measurement above is true by construction as well as by count, which
// is the strongest form the claim can take.
//
// ── THE APPLE SIDE: PATH-SCOPED, AND THE EXCLUSION COMES FIRST ───────────────
// Each app gets ONE `details` entry scoping it to its own path — the component
// form `{"/": "/<slug>/*"}`, built from `appBaseHref()` so a rename moves both
// sides at once.
//
// 🔴 `/checkout-return` IS EXCLUDED FROM EVERY APP'S COMPONENTS. It is where
// Paddle sends a returning buyer (`apps/<id>/lib/state/money_providers.dart:71`,
// `CHECKOUT_RETURN_URL` default `https://nikatru.com/checkout-return`, stamped
// from the brick of the same path; `sites/nikatru/_headers` declares the
// extensionless request path). If a universal link ever captured it, a buyer who
// has just paid would be thrown into an app instead of the page that confirms the
// payment — the single worst URL on this origin to get wrong.
//
// It is written as an EXPLICIT excluded component placed BEFORE the including
// ones, because AASA component matching is FIRST MATCH WINS and an exclusion
// after an include is dead text. Stated honestly: with components as narrow as
// `/<slug>/*` the exclusion cannot fire today — `/checkout-return` is not under
// any app's path. It is here for the day somebody widens a component (`/*`, a
// marketing campaign path, a shared `/go/*`), which is precisely when nobody will
// be thinking about Paddle. The guard asserts its presence AND its position, so
// the protection cannot be reordered into a no-op.
// (An omitted `"?"` key matches ANY query string, so the exclusion also covers
// the `?…` form the rail appends — `packages/purchases/test/
// rail_config_url_shape_test.dart` carries that shape.)
//
// ⚠️ THE BARE `/<slug>` IS DELIBERATELY NOT CLAIMED, and it is a real gap rather
// than an oversight. `/<slug>/*` does not match `/<slug>`; the apex 301s the bare
// form to the slashed one, and a redirect does not re-enter universal-link
// matching, so a link to `nikatru.com/subscriptiontracker` opens in the browser. Claiming both
// would mean two components per app and a guard that cannot state a clean set
// equality. Whoever ships the first iOS app decides that trade with a real device
// in hand; this file will not pre-empt it silently.
//
// ⚠️ ONLY THE iOS 13+ FORM IS EMITTED — `appIDs` + `components`. The legacy
// `appID` + `paths` form (with its `applinks.apps: []` sibling) is what older
// systems read, and emitting both shapes is a decision with a device behind it,
// not a default. The guard grades exactly the form emitted here, so adding the
// legacy half is a change to two files that fail together.
//
// ── THE ANDROID SIDE: NO PATH SCOPING EXISTS. AT ALL. ────────────────────────
// 🔴 THIS IS A REAL ASYMMETRY WITH AASA AND IT WILL BE ASSUMED AWAY BY SOMEBODY
// READING THE APPLE HALF FIRST. `assetlinks.json` is a FLAT ARRAY of statements
// of the form "this origin delegates `common.handle_all_urls` to that app". There
// is no path field, no include list, no exclude list — Digital Asset Links binds
// a whole ORIGIN to an app, and Android's per-path narrowing lives in the app's
// own `<intent-filter>` `<data android:pathPrefix>` inside its manifest, which is
// not in this file and cannot be checked from this repository.
//
// Consequences, stated where they will be read rather than discovered:
//   · every verified Android app is verified for `nikatru.com/*`, including
//     `/checkout-return`, `/pricing`, `/privacy` and the dated legal archive. The
//     `/checkout-return` protection on the Apple side has NO ANDROID EQUIVALENT
//     HERE; the app's own intent filter is the only place to write it.
//   · adding an app to `assetlinks.json` is therefore a bigger act than adding
//     one to AASA. Read that as a reason to keep this file generated and
//     reviewed, not as a reason to relax the Apple side to match.
//
// ⚠️ THE FINGERPRINT IS THE **APP SIGNING** CERTIFICATE, NOT THE UPLOAD ONE.
// `tooling/channel-register.json`'s `android-play.signing.uploadCertificate.
// sha256` is the UPLOAD key — pinned there to catch a swapped keystore. Under
// Play App Signing, Google re-signs what is delivered to devices, so the
// certificate a device sees is the app signing key from the Play Console
// (Setup → App integrity → App signing key certificate). Publishing the upload
// fingerprint here yields a file that validates as JSON, passes every shape
// check, and silently fails verification on every device. That is why this
// generator reads the value from the app's own declaration and refuses to reach
// for the one this repository already happens to have.
//
// ── WHO RUNS IT ──────────────────────────────────────────────────────────────
// Like `generate-discovery.mjs`, the OUTPUT IS COMMITTED: `sites/nikatru` is
// deployed by Cloudflare's git integration with no build step, so bytes that
// exist only inside a CI job are bytes nobody serves. Nothing in `.github/`
// invokes this script today because it has nothing to write; the guard computes
// the SAME plan from the same sources and fails on any drift, so the day the
// first identity lands the choice is "run the generator" or "watch CI go red" —
// never "hand-maintain the file". Wiring it into the discovery-regeneration
// workflow is owed at that moment and belongs to that unit's owner.
//
// Usage:  node tooling/sites/generate-well-known.mjs [repoRoot]
// Exit 0 = the tree matches the plan (today: nothing to write, nothing written)
//      1 = the sources cannot be turned into a file that is safe to publish.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';
import { APEX_HOST, appBaseHref, publicAppUrl } from './apex.mjs';

/** The published catalogue — the set of apps that HAVE a path on the apex. The
 *  registry `generate-discovery.mjs` reads (`sites/_shared/_data/apps.json`) is
 *  the SITE's copy; this reads the catalogue itself, because an association file
 *  is a statement about the product set, not about the marketing site. */
export const CATALOG = 'catalog/apps.json';

/** Where the declarations live, one directory per catalogue slug. */
export const APPS_DIR = 'apps';

export const WELL_KNOWN_DIR = 'sites/nikatru/.well-known';

/** 🔴 NO FILE EXTENSION, AND IT IS NOT A TYPO. Apple fetches this exact name;
 *  `apple-app-site-association.json` is a 404 to iOS and one of the two most
 *  common ways a first association attempt fails. */
export const AASA_REL = `${WELL_KNOWN_DIR}/apple-app-site-association`;
export const ASSETLINKS_REL = `${WELL_KNOWN_DIR}/assetlinks.json`;

/** The one path no app may ever capture. Declared here once and IMPORTED by the
 *  guard rather than retyped — see the header for what it is and what capturing
 *  it would cost. The value is the path half of `CHECKOUT_RETURN_URL`
 *  (`apps/<id>/lib/state/money_providers.dart:71`). */
export const CHECKOUT_RETURN_PATH = '/checkout-return';

/** The catalogue slug shape — the same one `generate-discovery.mjs` grades a
 *  slug against, because the slug is a URL segment on the same origin. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The two mobile surfaces, as data: which catalogue platform names them, which
 *  `listings` key is theirs, and which file they end up in. Written once so the
 *  two halves of this generator cannot drift into two different definitions of
 *  "has a mobile presence". */
export const SURFACES = [
  { id: 'ios', platform: 'ios', listing: 'appstore', file: AASA_REL },
  { id: 'android', platform: 'android', listing: 'play', file: ASSETLINKS_REL },
];

const jsonFile = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Does this catalogue row claim a mobile channel? Either half counts: a store
 *  listing URL is a shipped app, and `platforms` is what the served-channel
 *  register gates. Both are catalogue fields, so this needs no other file. */
export function mobilePresence(row, surface) {
  const platforms = Array.isArray(row?.platforms) ? row.platforms : [];
  const listing = row?.listings?.[surface.listing];
  const reasons = [];
  if (platforms.includes(surface.platform)) reasons.push(`platforms contains "${surface.platform}"`);
  if (typeof listing === 'string' && listing.trim() !== '') reasons.push(`listings.${surface.listing} is ${listing}`);
  return reasons;
}

/** The identity halves, read from the declaration and NEVER derived. Returns
 *  `{ok, value, missing}` so the caller can tell "absent" from "half-written" —
 *  they are different findings with different fixes. */
export function mobileIdentity(decl, surfaceId) {
  const block = decl?.mobile?.[surfaceId];
  if (surfaceId === 'ios') {
    const teamId = block?.appleTeamId;
    const bundleId = block?.bundleId;
    const missing = [];
    if (typeof teamId !== 'string' || !/^[A-Z0-9]{10}$/.test(teamId)) missing.push('mobile.ios.appleTeamId (Apple issues a 10-character team id)');
    if (typeof bundleId !== 'string' || !/^[A-Za-z0-9.-]+$/.test(bundleId) || !bundleId.includes('.')) missing.push('mobile.ios.bundleId (the reverse-DNS bundle identifier)');
    return { ok: missing.length === 0, missing, value: { appID: `${teamId}.${bundleId}` } };
  }
  const packageName = block?.packageName;
  const fingerprints = block?.sha256CertFingerprints;
  const missing = [];
  if (typeof packageName !== 'string' || !packageName.includes('.')) missing.push('mobile.android.packageName (the applicationId)');
  if (!Array.isArray(fingerprints) || fingerprints.length === 0) {
    missing.push('mobile.android.sha256CertFingerprints (the APP SIGNING certificate, not the upload one — see this file\'s header)');
  } else {
    for (const fp of fingerprints) {
      if (typeof fp !== 'string' || !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp)) {
        missing.push(`mobile.android.sha256CertFingerprints: ${JSON.stringify(fp)} is not 32 colon-separated uppercase hex octets`);
      }
    }
  }
  return { ok: missing.length === 0, missing, value: { packageName, fingerprints } };
}

/** One AASA `details` entry: the exclusion FIRST, then this app's own path.
 *  Order is the assertion — AASA matches components in order and takes the first
 *  hit, so an exclusion written after an include is a comment. */
export function aasaDetail(slug, appID) {
  return {
    appIDs: [appID],
    components: [
      {
        '/': CHECKOUT_RETURN_PATH,
        exclude: true,
        comment: 'The Paddle return path. A buyer who has just paid must land on the confirmation page, never inside an app. Excluded FIRST because AASA takes the first matching component.',
      },
      {
        '/': `${appBaseHref(slug)}*`,
        comment: `Everything under ${publicAppUrl(slug)}/ — this app's own path on the shared apex, and nothing else.`,
      },
    ],
  };
}

/** One assetlinks statement. NO PATH SCOPING EXISTS — see the header; this
 *  delegates the WHOLE origin to the app named. */
export function assetlinksStatement({ packageName, fingerprints }) {
  return {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: [...fingerprints],
    },
  };
}

/**
 * The whole plan, as bytes, without touching the disk. The guard calls this and
 * COMPARES; the CLI below calls it and WRITES. One derivation, two readers —
 * a second implementation in the guard is how the two stop agreeing.
 *
 * @returns {{files: Map<string,string>, catalog: object[], qualifying: object[],
 *            presence: object[], problems: string[], comparisons: number,
 *            catalogUsable: boolean}}
 */
export function planWellKnown(repoRoot) {
  const problems = [];
  const files = new Map();
  const presence = [];   // every (app, surface) pair that CLAIMS a mobile channel
  const qualifying = []; // …and also carries a usable identity
  let comparisons = 0;

  const catalogPath = join(repoRoot, ...CATALOG.split('/'));
  if (!existsSync(catalogPath)) {
    return { files, catalog: [], qualifying, presence, comparisons, catalogUsable: false,
      problems: [`${CATALOG} does not exist — there is no app set to write an association file about.`] };
  }
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch (e) {
    return { files, catalog: [], qualifying, presence, comparisons, catalogUsable: false,
      problems: [`${CATALOG} is not valid JSON — ${e.message}`] };
  }
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return { files, catalog: [], qualifying, presence, comparisons, catalogUsable: false,
      problems: [`${CATALOG} carries no entries, so "no app qualifies" would be true of an empty world rather than of this one.`] };
  }

  for (const row of catalog) {
    const slug = typeof row?.slug === 'string' ? row.slug : '';
    if (!SLUG_RE.test(slug)) {
      problems.push(`${CATALOG}: entry with slug ${JSON.stringify(row?.slug)} is not usable as a URL segment (expected ${SLUG_RE}), so no path component can be built for it.`);
      continue;
    }

    const declRel = `${APPS_DIR}/${slug}/app.yaml`;
    const declPath = join(repoRoot, ...declRel.split('/'));
    let decl = null;
    let declError = null;
    if (existsSync(declPath)) {
      try { decl = parseYaml(readFileSync(declPath, 'utf8')); }
      catch (e) { declError = String(e.message).split('\n')[0]; }
    }

    for (const surface of SURFACES) {
      comparisons++;
      const reasons = mobilePresence(row, surface);
      const identity = decl ? mobileIdentity(decl, surface.id) : { ok: false, missing: ['the declaration could not be read'], value: null };
      const hasIdentity = Boolean(decl) && identity.ok;

      if (reasons.length > 0) presence.push({ slug, surface: surface.id, reasons });

      if (reasons.length > 0 && !decl) {
        problems.push(
          `${slug} claims a ${surface.id} presence (${reasons.join('; ')}) but ${declRel} ` +
            `${declError ? `did not parse (${declError})` : 'does not exist'} — the identity it needs cannot be read, and this file must not guess one.`,
        );
        continue;
      }
      if (reasons.length > 0 && !identity.ok) {
        problems.push(
          `${slug} claims a ${surface.id} presence (${reasons.join('; ')}) but ${declRel} does not declare a usable identity: ` +
            `${identity.missing.join(', ')}. A shipped app silently missing from a portfolio-wide association file is a ` +
            'universal link that fails for one product while every check stays green — so this run writes nothing instead.',
        );
        continue;
      }
      if (reasons.length === 0 && hasIdentity) {
        problems.push(
          `${slug} declares a ${surface.id} identity in ${declRel} but claims no ${surface.id} presence in ${CATALOG} ` +
            `(no "${surface.platform}" in platforms, listings.${surface.listing} is null). Publishing it would hand deep-link ` +
            'authority on this origin to an app nobody ships. Declare both or neither.',
        );
        continue;
      }
      if (reasons.length > 0 && hasIdentity) qualifying.push({ slug, surface: surface.id, identity: identity.value });
    }
  }

  if (problems.length) return { files, catalog, qualifying, presence, problems, comparisons, catalogUsable: true };

  // ── THE EMPTY-FILE RULE ────────────────────────────────────────────────────
  // Zero qualifying apps on a surface ⇒ NO FILE for that surface. Not an empty
  // one: see the header — a cached empty AASA is an authoritative negative answer
  // with Apple's CDN TTL on it, and the first real file has to outlive it.
  const ios = qualifying.filter((q) => q.surface === 'ios');
  const android = qualifying.filter((q) => q.surface === 'android');

  if (ios.length > 0) {
    files.set(AASA_REL, jsonFile({ applinks: { details: ios.map((q) => aasaDetail(q.slug, q.identity.appID)) } }));
  }
  if (android.length > 0) {
    files.set(ASSETLINKS_REL, jsonFile(android.map((q) => assetlinksStatement(q.identity))));
  }

  return { files, catalog, qualifying, presence, problems, comparisons, catalogUsable: true };
}

/** Every file that actually exists under the well-known directory, as repo-
 *  relative paths. Used by both the CLI and the guard: the plan's file set and
 *  this one are the two halves of the measured pair. */
export function wellKnownOnDisk(repoRoot) {
  const abs = join(repoRoot, ...WELL_KNOWN_DIR.split('/'));
  if (!existsSync(abs)) return [];
  const out = [];
  const walk = (dirAbs, rel) => {
    for (const entry of listDir(dirAbs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dirAbs, entry.name), childRel);
      else if (entry.isFile()) out.push(`${WELL_KNOWN_DIR}/${childRel}`);
    }
  };
  walk(abs, '');
  return out.sort();
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const { files, catalog, qualifying, presence, problems } = planWellKnown(root);

  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s) — no association file was written:`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('');
    console.error(`  One AASA and one assetlinks.json serve EVERY app on ${APEX_HOST}. A file written from a`);
    console.error('  half-declared app breaks deep links for all of them, so a half-declared app stops the run.');
    process.exit(1);
  }

  let written = 0;
  for (const [rel, contents] of files) {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    // 🔴 READ, DO NOT `existsSync` THEN READ. The check-then-act form is a
    // time-of-check/time-of-use race (CodeQL js/file-system-race): between the
    // two calls the file can appear, vanish or change, and on this repository's
    // own machinery that is not hypothetical — a CI job regenerates a surface
    // on disk while a local generator may be running. Attempting the read
    // and treating its failure as "absent" collapses the two calls into one, so
    // there is no window to lose.
    let current = null;
    try {
      current = readFileSync(abs, 'utf8');
    } catch {
      current = null; // absent, or unreadable — either way it must be written
    }
    if (current !== contents) {
      writeFileSync(abs, contents);
      written++;
      console.log(`    wrote ${rel}`);
    }
  }

  // A file this plan does not own is reported rather than deleted: deleting is a
  // destructive act on a directory a future unit (webcredentials, appclips,
  // security.txt) will legitimately share. Naming it is enough — the guard reds
  // on the same finding independently.
  const stray = wellKnownOnDisk(root).filter((rel) => !files.has(rel));
  for (const rel of stray) {
    console.error(`✗ ${rel} exists and this generator does not own it. Association files are GENERATED; a hand-written one is`);
    console.error('  the exact failure this unit exists to prevent. Delete it, or teach this generator to produce it.');
  }

  console.log(
    `ok  well-known — ${catalog.length} catalogue app(s), ${presence.length} mobile presence claim(s), ` +
      `${qualifying.length} qualifying (ios+android), ${files.size} file(s) planned, ${written} written, ` +
      `${stray.length} unowned file(s) under ${WELL_KNOWN_DIR}/`,
  );
  if (files.size === 0) {
    console.log(
      '    NOTHING TO DECLARE, SO NOTHING IS PUBLISHED: an empty AASA is cached by Apple\'s CDN as an ' +
        'authoritative "no app claims this origin", which the first real file then has to outlive.',
    );
  }
  process.exit(stray.length ? 1 : 0);
}
