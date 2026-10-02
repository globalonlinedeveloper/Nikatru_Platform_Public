#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render.mjs — apps/<id>/app.yaml is the source; the catalogue and the listing
// copy are RENDERINGS.
//
//     apps/<id>/app.yaml ──(this script)──▶ catalog/apps.json
//                                        ├▶ apps/<id>/store/<channel>/title.txt
//                                        ├▶ …/short-description.txt
//                                        ├▶ …/category.txt
//                                        ├▶ …/privacy-policy-url.txt
//                                        ├▶ …/support-url.txt
//                                        └▶ …/terms-of-use-url.txt (declaring channels)
//
// Each channel gets only the rendered fields it DECLARES: the register's
// `storeMetadataContract.requiredFiles` plus that channel's own
// `perChannel.<id>.additionalFiles`. See `channelListingFiles` below.
//
// and, when the declaration carries a `shortName`, the FIVE OS-level icon-label
// fields this script owns — CFBundleDisplayName (iOS + macOS), android:label,
// msix_config.display_name and the PWA manifest `short_name`. Those are SURGICAL
// renderings into files this script does not otherwise own; see
// ICON_LABEL_TARGETS below for the anchor rule that makes that safe.
// ⏱ 2026-09-25 — FOUR now: msix_config.display_name is rendered from `name`,
// the Store title, by MSIX_TITLE_TARGET (O-MSIX-IDENTITY-UNGRADED), and the
// Start-menu label is written into the packaged manifest by
// tooling/store/msix-visual-name.mjs. The counts in the comments below are the
// ones measured when the list was written.
//
// and, into both Apple Info.plists, the TWO keys App Store review reads from the
// bundle: LSApplicationCategoryType (from `category`, through the vocabulary's
// APPLE_CATEGORY_UTI) and ITSAppUsesNonExemptEncryption (from
// `exportCompliance.usesNonExemptEncryption`, a legal answer). Those are UPSERTS,
// not replace-only, because `flutter create` writes neither; see
// PLIST_KEY_TARGETS below (O-APPLE-PLIST-KEYS-UNRENDERED).
//
// and, into the pubspec's `msix_config`, the MSIX `identity_name` — from the
// app's OWN record, `stores.windows-store.identityName`, never from the channel
// row (O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1)); see MSIX_IDENTITY_TARGET below.
//
// ⛔ THE SIXTH OS-LEVEL LABEL — the .desktop `Name=` — IS NOT WRITTEN HERE, and
// that is not an omission. `tooling/store/render-linux-icons.mjs` derives that
// whole file, all nine lines of it, and assert-launcher-icons.mjs limb 7
// re-derives and compares it. It reads the same `shortName`. Patching one line
// of a file another generator owns entirely would be two owners of one fact —
// which is the thing every generator in this repository exists to prevent.
//
// ── WHAT THIS FIXES, IN THE GUARD'S OWN WORDS ────────────────────────────────
// `assert-store-metadata.mjs` opens with "[pipeline D-5] Store listing metadata
// is GENERATED from the spec and lives in the repo", and its own header then
// records that every subject it had was `apps/subscriptiontracker/store/`, "which a human
// wrote by hand". The guard was real, running and green while pointing one
// artifact away from the behaviour the requirement names. This script is the
// generator that sentence has been describing.
//
// ── THE BYTES ARE THE CONTRACT, AND TWO POSITIVE CONTROLS READ THEM ──────────
// 🔴 `catalog/apps.json` IS COMPARED BYTE FOR BYTE by tests that run on the real
// tree (TRAPS ci-31): `generate-apps-data.test.mjs` regenerates the site feed
// from it and asserts byte equality with the committed feed, and the site lane
// deletes and regenerates that feed and runs `git diff --exit-code`. So this
// renderer reproduces the catalogue's HAND-WRITTEN house style exactly — two
// space indent, an array of scalars inline as `[a, b]` — and NOT
// `JSON.stringify(x, null, 2)`, which expands `"platforms": ["web"]` to three
// lines and turns a 410-byte file into a different one. The same encoder,
// character for character, is `_encodeCatalogue` in
// tooling/bricks/app/hooks/post_gen.dart and `serialise` in
// tooling/sites/generate-apps-data.mjs; all three exist because Dart writes the
// file at stamp time, Node renders it here, and Node reads it there.
//
// ⚠️ The obvious one-liner for the inline case — `JSON.stringify(v).replace(/,/g,
// ', ')` — is WRONG and its wrongness is invisible on today's data: it rewrites
// commas inside string values too, so `["a,b"]` becomes `["a, b"]`. Encoding each
// element and joining is comma-safe by construction.
//
// ── THE LISTING FILES CARRY NO "GENERATED" HEADER, AND CANNOT ────────────────
// `title.txt` IS the title a store shows. A `# DO NOT EDIT` line in it would be
// submitted to Google Play as part of the app's name. There is no comment syntax
// available in a file whose entire content is the value, so `--check` is the only
// thing standing between a hand edit and a store console — exactly the position
// `generate-apps-data.mjs` records for the site feed, which is JSON and has the
// same problem for the same reason.
//
// ── WHAT IT DELIBERATELY DOES NOT WRITE ──────────────────────────────────────
// ⛔ The four SWORN declarations — android-play/{data-safety,content-rating,
// ads-declaration}.json and ios-appstore/privacy-manifest.json. Those are
// statements about Subly's real code, each answer carrying its own citation, and
// [ADR 037]'s rule is that "a sworn declaration regenerated by a template is a
// statement nobody made". assert-sworn-store-files.mjs limb 7 is the tripwire and
// this script never opens those paths.
// ⛔ The EDITORIAL files — long-description.txt, keywords.txt, subtitle.txt,
// promotional-text.txt, search-terms.txt, snap-name.txt, license.txt. They are
// reviewed prose about what an app actually does; a renderer would replace them
// with filler true of no app in particular.
//
// Usage:  node tooling/app-yaml/render.mjs [root] [--check]
//         (default) writes every rendering whose bytes differ
//         --check   renders in memory and DIFFS; exit 1 NAMING each stale file
// Exit 0 = the tree matches the declarations. 1 = it does not (or a declaration
// is invalid). 2 = COVERAGE LOST — see the refusals in `plan`.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, YamlError } from './yaml.mjs';
import { validate } from './schema-validate.mjs';
import { publicAppUrl } from '../sites/apex.mjs';
import { APPLE_CATEGORY_UTI, renderedListingFiles, STORE_FORM_RULES } from '../../contracts/store/vocabulary.js';
import { BUNDLES_REGISTER, readBundles } from '../catalog/read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const APPS_DIR = 'apps';
export const CATALOGUE = 'catalog/apps.json';
export const REGISTER = 'tooling/channel-register.json';
export const APP_SCHEMA_PATH = join(HERE, 'schema', 'app.schema.json');

/** The listing files this script owns. Everything else under a channel tree is
 *  sworn or editorial — see the header.
 *
 *  🔴 DERIVED FROM contracts/store/vocabulary.js, NOT TYPED HERE. Until
 *  2026-09-20 this was a hand-typed array of five names, and it was the THIRD
 *  independent spelling of one listing vocabulary in this repository — beside
 *  tooling/channel-register.json's `storeMetadataContract.requiredFiles` and
 *  extensions/scripts/check-store-metadata.mjs's REQUIRED_PER_STORE. The three
 *  already disagreed about whether `README.md` is a listing file. The contract
 *  is now the one declaration and the `rendered` column of its table is what
 *  this array is; tooling/ci/assert-store-vocabulary.mjs compares them BY VALUE
 *  and fails on a restated literal. */
export const RENDERED_LISTING_FILES = renderedListingFiles();

/** The rendered listing files ONE channel's tree carries: RENDERED_LISTING_FILES
 *  filtered to the register's `requiredFiles` plus that channel's own
 *  `perChannel.<id>.additionalFiles`, in vocabulary order.
 *
 *  ⏱ 2026-09-24 (O-APPLE-LISTING-HAS-NO-EULA). Until then the loop below wrote
 *  EVERY rendered file into EVERY channel directory. That was harmless while all
 *  five rendered fields were required everywhere. `terms-of-use-url.txt` is the
 *  first rendered field only some channels carry (the two Apple rows), and the
 *  unfiltered loop wrote it into all six trees. The set assert-store-metadata.mjs
 *  requires of a tree is the set this renders into it. */
export function channelListingFiles(contract, channelId) {
  const declared = new Set([
    ...(Array.isArray(contract?.requiredFiles) ? contract.requiredFiles : []),
    ...(Array.isArray(contract?.perChannel?.[channelId]?.additionalFiles) ? contract.perChannel[channelId].additionalFiles : []),
  ]);
  return RENDERED_LISTING_FILES.filter((f) => declared.has(f));
}

/** The category a channel's category.txt carries. The app's own app.yaml
 *  `category`, unless the channel's store has its own form rules (contracts/store/
 *  vocabulary.js STORE_FORM_RULES), which name the one `listingCategory` every
 *  app lists under there. Added 2026-09-22 for apps.gov.in, whose form has no
 *  "Productivity" (O-APPS-GOV-IN-CHANNEL-APK); why it ignores the app's own
 *  category is written beside `listingCategory`. The app brick stamps the same
 *  literal, so a stamp and its first render agree. A channel with no form rules
 *  is unchanged: the app's value, verbatim. */
export function channelCategory(channelId, category) {
  const rules = STORE_FORM_RULES[channelId];
  return rules ? rules.listingCategory : category;
}

/** [ADR 085] A: where the RevenueCat routing map is rendered, and the module. */
export const REVENUECAT_APP_IDS_DIR = 'services/platform/src/lib/mor';
export const REVENUECAT_APP_IDS_MODULE = `${REVENUECAT_APP_IDS_DIR}/revenuecat-app-ids.ts`;

/** The module's bytes. Sorted, so the rendering is deterministic. */
export function renderRevenueCatAppIds(routes) {
  const rows = [...routes.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    '// GENERATED by tooling/app-yaml/render.mjs from apps/*/app.yaml `billing.mobileIap.revenuecatAppIds`.',
    '// Do not edit: assert-app-yaml.mjs re-renders this file and fails on any difference.',
    '//',
    '// [ADR 085] decision A (owner, 2026-09-15, "RevenueCat app id per app"): a RevenueCat',
    '// webhook event is routed to the NIKATRU app that declares its `event.app_id`; an id',
    '// no app declares is refused, never guessed. Keys are RevenueCat app ids, values',
    '// are NIKATRU app ids. An empty map means no app has declared mobile IAP yet, so',
    '// every RevenueCat event is refused on decision A.',
    'export const REVENUECAT_APP_IDS: Readonly<Record<string, string>> = {',
    ...rows.map(([rc, app]) => `  ${JSON.stringify(rc)}: ${JSON.stringify(app)},`),
    '};',
    '',
  ].join('\n');
}

/**
 * ⏱ 2026-09-27 · O-IAP-BUNDLE-SALE-UNLOCKS-ONE-APP — the store SKU map, rendered
 * beside the routing map, from 12a's `billing.mobileIap.storeProducts` (kind
 * `app`) and catalog/bundles.json `storeProducts` (kind `bundle`).
 */
export const STORE_SKUS_MODULE = `${REVENUECAT_APP_IDS_DIR}/store-skus.ts`;

/** A bundle SKU's plan. Subscriptions only: lifetime is never sold in-app (design-money §2). */
export const BUNDLE_STORE_PLANS = ['bundle-monthly', 'bundle-yearly'];
/** The store rails a bundle SKU is listed on, as tooling/channel-register.json spells them. */
export const BUNDLE_STORE_RAILS = ['apple-iap', 'play-billing'];
/** Migration 0018's term set. */
export const SKU_TERMS = ['subscription', 'one_time'];
/**
 * A bundle STORE SKU's term. Every in-app plan is a subscription ([ADR 078]
 * §11.1; [ADR 093] §2 sells no lifetime in-app), so its grant rolls to the
 * current sellable version ([ADR 099] §3). A `one_time` store SKU would freeze a
 * paying subscriber's bundle at its pin: refused until an ADR sells one.
 */
export const BUNDLE_STORE_TERMS = ['subscription'];
/** The store product id shape, the same rule app.yaml's schema puts on `storeProducts[].productId`. */
const STORE_PRODUCT_ID = /^[a-z0-9][a-z0-9_.]*$/;

/** The module's bytes. Sorted by (app, productId), so the rendering is deterministic. */
export function renderStoreSkus(skus) {
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const rows = [...skus].sort((a, b) => cmp(a.app, b.app) || cmp(a.productId, b.productId));
  return [
    '// GENERATED by tooling/app-yaml/render.mjs from apps/*/app.yaml `billing.mobileIap.storeProducts`',
    '// (kind `app`) and catalog/bundles.json `storeProducts` (kind `bundle`).',
    '// Do not edit: `render.mjs --check` re-renders this file and fails on any difference.',
    '//',
    '// O-IAP-BUNDLE-SALE-UNLOCKS-ONE-APP: src/lib/mor/grant.ts looks a RevenueCat event\'s',
    '// `product_id` up here, under the app the event was routed to ([ADR 085] A). A `bundle` SKU',
    '// is written to bundle_grants through upsertBundleGrant; an `app` SKU, and a SKU this map',
    '// does not hold, keep the single-app path through store.ts. `store` is null for an app SKU',
    '// (12a lists one id per plan on both stores) and names the rail for a bundle SKU.',
    'export interface StoreSku {',
    '  readonly app: string;',
    '  readonly productId: string;',
    "  readonly kind: 'app' | 'bundle';",
    '  readonly plan: string;',
    "  readonly term: 'subscription' | 'one_time';",
    '  readonly store: string | null;',
    '  readonly featureSet: string | null;',
    '  readonly version: number | null;',
    '}',
    '',
    'export const STORE_SKUS: readonly StoreSku[] = [',
    ...rows.map(
      (s) =>
        `  { app: ${JSON.stringify(s.app)}, productId: ${JSON.stringify(s.productId)}, kind: ${JSON.stringify(s.kind)}, ` +
        `plan: ${JSON.stringify(s.plan)}, term: ${JSON.stringify(s.term)}, store: ${JSON.stringify(s.store)}, ` +
        `featureSet: ${JSON.stringify(s.featureSet)}, version: ${JSON.stringify(s.version)} },`,
    ),
    '];',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* The icon label — `shortName`                                       */
//
// ── WHY A SECOND NAME AT ALL ─────────────────────────────────────────────────
// A store title and a home-screen label are two different fields with two
// different readers. The store title is read once, in a search result, with a
// whole row to itself; the icon label is read every day, under a 60-pixel mark,
// and every OS truncates it — iOS around 12-13 glyphs, Android around 11-14. A
// portfolio brand that is correct in the store ("Nikatru Subscription Tracker")
// is an ellipsis on a phone, and shipping the SAME string to both is how a
// launcher ends up showing four apps all reading "Nikatru Subs…".
//
// 🔴 IT IS RENDERED, NOT AUTHORED, AND THAT IS THE ENTIRE POINT. These fields
// sit in five different file formats across five platform directories.
// Hand-maintained, they are six chances for one of them to keep the old brand
// through a rename — which is precisely the class of defect a rename produces,
// because five of the six are files nobody opens between `flutter create` and a
// store submission. `--check` is what makes a hand edit to any of them fail.
//
// ⚠️ SURGICAL, NOT WHOLESALE. Every other rendering in this file is a file whose
// ENTIRE content this script owns. These six are not: an Info.plist, an
// AndroidManifest and a pubspec are mostly things this script knows nothing
// about. So each target names an ANCHOR — a regex with the value between two
// captured groups — and the rendering is the current file with that one span
// replaced. A target whose anchor is not found is COVERAGE LOST, never a skip:
// it means the renderer believes it owns a field that has moved, and a silent
// skip there is exactly how the old brand would survive.
//
// Each value is escaped for ITS OWN language. The same lesson
// `tooling/bricks/app/hooks/pre_gen.dart` records for mason: one string, five
// destinations, and a raw `&` that is ordinary text in JSON is a malformed
// document in an Info.plist and a scalar-quoting decision in YAML.

/** JSON string BODY (no surrounding quotes) — the anchor supplies them. */
const jsonBody = (s) => JSON.stringify(s).slice(1, -1);
/** XML text and double-quoted attribute values. `'` needs no escape in either. */
export const xmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A YAML scalar. Plain when the value cannot be mistaken for anything else,
 *  double-quoted otherwise — JSON's escapes are a strict subset of YAML's. */
const yamlScalar = (s) => (/^[A-Za-z0-9][A-Za-z0-9 ._-]*[A-Za-z0-9.]$/.test(s) ? s : JSON.stringify(s));

/**
 * The six OS-level label fields, in the order a person would check them.
 *
 * `in` names the file, relative to `apps/<id>/`; a `dir`+`ext` pair instead
 * means every matching file in that directory (the .desktop entry is named
 * after the application id, which this script does not own).
 * `re` MUST capture exactly two groups — everything before the value and
 * everything after it — so the replacement can never widen its own span.
 */
export const ICON_LABEL_TARGETS = [
  {
    field: 'PWA short_name',
    in: 'web/manifest.json',
    re: /("short_name"\s*:\s*")(?:[^"\\]|\\.)*(")/,
    encode: jsonBody,
  },
  {
    field: 'android:label',
    in: 'android/app/src/main/AndroidManifest.xml',
    re: /(android:label=")[^"]*(")/,
    encode: xmlText,
  },
  {
    field: 'CFBundleDisplayName (iOS)',
    in: 'ios/Runner/Info.plist',
    re: /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    encode: xmlText,
  },
  {
    field: 'CFBundleDisplayName (macOS)',
    in: 'macos/Runner/Info.plist',
    re: /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    encode: xmlText,
  },
];

/**
 * ⏱ 2026-09-25 — O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1). The MSIX
 * Package/Identity/Name an app packages, rendered from ITS OWN record,
 * `stores.windows-store.identityName` in apps/<id>/app.yaml. It used to be
 * copied from the ONE identity on the windows-store channel row, by the brick
 * at stamp time, so a second app packaged the first app's identity and every
 * guard agreed with it.
 *
 * The same surgical rule as ICON_LABEL_TARGETS, with the span BOUNDED BY THE
 * BLOCK: the lines between `msix_config:` and `identity_name:` must all be
 * indented, blank or comments, so a key of the same name under a later
 * top-level block is never the one rewritten (tooling/ci/read-identity.mjs
 * readMsixIdentityName records paying for that once). A pubspec with no
 * `msix_config:` is an app not packaged for the Microsoft Store and is skipped;
 * the brick appends the block AFTER its render, on the same sentinel the record
 * carries.
 *
 * A line of the span is `[ \t#]` and the rest of it, or a bare `\r`, or
 * nothing, then its `\n`. It used to be `(?:[ \t#][^\n]*)?\r?\n`, where
 * `[^\n]*` and `\r?` could each take an indented CRLF line's `\r`, so n such
 * lines with no identity_name after them backtracked 2^n ways (CodeQL
 * js/redos). The text matched and both groups are unchanged.
 */
export const MSIX_IDENTITY_TARGET = {
  field: 'msix_config.identity_name (Package/Identity/@Name)',
  in: 'pubspec.yaml',
  applies: /^msix_config:/m,
  re: /(^msix_config:[^\n]*\n(?:(?:[ \t#][^\n]*|\r)?\n)*? {2}identity_name: )[^\r\n]*(\r?)$/m,
  encode: yamlScalar,
};

/**
 * ⏱ 2026-09-28 — ST-R4 (O-RENEWAL-REMINDERS-OFF-ON-DESKTOP). The Windows toast
 * activator, from `windows.toastActivatorClsid` (not a console id, so not in
 * the `stores` record), written twice:
 *
 *  · into the pubspec's msix_config as a `toast_activator:` block (UPSERTED:
 *    the brick's block and a hand-written one both lack it until the first
 *    render), so the packaged AppxManifest declares the COM activator;
 *  · into WINDOWS_IDENTITY_DART, a file this script owns whole, so the running
 *    app hands flutter_local_notifications the SAME CLSID. Two copies typed by
 *    hand are how a toast gets posted under one activator and launched by
 *    another — the tap then starts nothing.
 *
 * The AUMID is `<packageFamilyName>!<Application Id>`, the id msix writes
 * (the pubspec `name` without underscores). Before Partner Center issues the
 * family name it is `NIKATRU.<Application Id>` — an unpackaged dev run needs
 * some AUMID, and a sentinel inside one would read as a real identity.
 */
export const TOAST_ACTIVATOR_ARGUMENTS = '-ToastActivated';
export const WINDOWS_IDENTITY_DART = 'lib/core/windows_notification_identity.g.dart';
export const MSIX_TOAST_TARGET = {
  field: 'msix_config.toast_activator.clsid',
  in: 'pubspec.yaml',
  applies: /^msix_config:/m,
  // The same block-bounded span as MSIX_IDENTITY_TARGET, anchored on the
  // identity_name LINE the block is required to carry.
  anchor: /(^msix_config:[^\n]*\n(?:(?:[ \t#][^\n]*|\r)?\n)*? {2}identity_name: [^\r\n]*(\r?)\n)/m,
  existing: /(^msix_config:[^\n]*\n(?:(?:[ \t#][^\n]*|\r)?\n)*? {2}toast_activator:\r?\n {4}clsid: )[^\r\n]*(\r?\n {4}arguments: )[^\r\n]*(\r?\n {4}display_name: )[^\r\n]*/m,
};

/** The Dart file for one app: its identity, or `null` where it declares no
 *  windows-store record (no Windows notifications, and the adapter says so). */
export function renderWindowsIdentityDart(identity) {
  const head = [
    '// GENERATED by tooling/app-yaml/render.mjs from app.yaml',
    '// (stores.windows-store). Do not edit; change app.yaml and re-render.',
    '',
    "import 'package:nikatru_notifications/nikatru_notifications.dart'",
    '    show WindowsNotificationIdentity;',
    '',
    "/// This app's Windows toast identity (ST-R4). Null = no Windows notifications.",
  ];
  if (!identity) {
    return [...head, 'const WindowsNotificationIdentity? kWindowsNotificationIdentity = null;', ''].join('\n');
  }
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;
  // One constant per value, so every line is one the formatter leaves alone:
  // a long AUMID inside the constructor call re-flows the whole declaration.
  return [
    ...head,
    'const WindowsNotificationIdentity? kWindowsNotificationIdentity =',
    '    WindowsNotificationIdentity(',
    '      appName: _appName,',
    '      appUserModelId: _appUserModelId,',
    '      toastActivatorClsid: _toastActivatorClsid,',
    '    );',
    '',
    constLine('_appName', q(identity.appName)),
    constLine('_appUserModelId', q(identity.appUserModelId)),
    constLine('_toastActivatorClsid', q(identity.clsid)),
    '',
  ].join('\n');
}

/** A `const String` the way `dart format` lays it out: one line when it fits
 *  in 80 columns, else the literal on its own indented line. The stamped probe
 *  is format-gated, and its short sentinel AUMID fits where app #1's does not. */
function constLine(name, literal) {
  const one = `const String ${name} = ${literal};`;
  return one.length <= 80 ? one : `const String ${name} =\n    ${literal};`;
}

/** The AUMID msix gives the app: `<family name>!<Application Id>`. */
export function windowsAppUserModelId(record, pubspecName) {
  const appId = String(pubspecName).replace(/_/g, '');
  const pfn = record?.packageFamilyName;
  return typeof pfn === 'string' && pfn.includes('_') ? `${pfn}!${appId}` : `NIKATRU.${appId}`;
}

/** The Apple category UTI a portfolio category word maps to, through the
 *  vocabulary's APPLE_CATEGORY_UTI. An unmapped word is an authoring error
 *  (`problem`, exit 1): the plist would otherwise carry no category, or a
 *  guessed one. An EMPTY map is `lost` (exit 2), because then every word is
 *  unmapped and the refusal would be about the map, not about the app. `map` is
 *  a parameter so the empty case can be exercised without editing the contract. */
export function appleCategoryUti(category, map = APPLE_CATEGORY_UTI) {
  if (!map || Object.keys(map).length === 0) {
    return { lost: 'contracts/store/vocabulary.js APPLE_CATEGORY_UTI is empty, so no category can be written into LSApplicationCategoryType.' };
  }
  if (!Object.hasOwn(map, category)) {
    return {
      problem:
        `category "${category}" has no Apple category UTI in contracts/store/vocabulary.js APPLE_CATEGORY_UTI ` +
        `(it maps ${Object.keys(map).map((k) => `"${k}"`).join(', ')}). Add the word with its public.app-category.* UTI ` +
        'from Apple\'s LSApplicationCategoryType list, then regenerate vocabulary.json.',
    };
  }
  return { uti: map[category] };
}

/**
 * The two Info.plist keys App Store review reads from the bundle, in both Apple
 * plists (O-APPLE-PLIST-KEYS-UNRENDERED).
 *
 * `value(doc, t)` returns `{ type: 'string' | 'bool', v }`, or `{ problem }` /
 * `{ lost }` when the declaration cannot be resolved. It is called ONLY for a
 * target file that exists, so an app with no Apple target is never asked to
 * map its category.
 *
 * 🔴 AN UPSERT, NOT REPLACE-ONLY. ICON_LABEL_TARGETS replaces a value inside a
 * key `flutter create` always writes. `flutter create` writes neither of these,
 * so a missing key is INSERTED before the root `</dict>`; a present key has its
 * whole value element replaced, type included, so flipping the declaration is
 * `<false/>` to `<true/>` and nothing else. A file with no root `</dict>` /
 * `</plist>` close is COVERAGE LOST whether or not the key is present: without
 * that check, a rewritten file that still carried the key would render to its
 * own bytes and pass.
 */
export const PLIST_KEY_TARGETS = [
  {
    key: 'LSApplicationCategoryType',
    in: 'ios/Runner/Info.plist',
    channel: 'ios-appstore',
    value: (doc, t) => plistCategory(doc, t),
  },
  {
    key: 'ITSAppUsesNonExemptEncryption',
    in: 'ios/Runner/Info.plist',
    value: (doc) => ({ type: 'bool', v: doc.exportCompliance.usesNonExemptEncryption }),
  },
  {
    key: 'LSApplicationCategoryType',
    in: 'macos/Runner/Info.plist',
    channel: 'macos-appstore',
    value: (doc, t) => plistCategory(doc, t),
  },
  {
    key: 'ITSAppUsesNonExemptEncryption',
    in: 'macos/Runner/Info.plist',
    value: (doc) => ({ type: 'bool', v: doc.exportCompliance.usesNonExemptEncryption }),
  },
];

/** The category the channel's own category.txt carries (channelCategory), as a UTI. */
function plistCategory(doc, t) {
  const r = appleCategoryUti(channelCategory(t.channel, doc.category));
  return r.uti ? { type: 'string', v: r.uti } : r;
}

/** One plist value element. The element name IS the type, so it is rendered whole. */
const plistValue = ({ type, v }) => (type === 'bool' ? (v ? '<true/>' : '<false/>') : `<string>${xmlText(String(v))}</string>`);

/** The root dictionary's close: the one place a missing key is inserted. */
const PLIST_ROOT_CLOSE = /(\r?\n)(<\/dict>\r?\n<\/plist>\s*)$/;

/**
 * ⏱ 2026-09-25 — `msix_config.display_name` LEFT the list above
 * (O-MSIX-IDENTITY-UNGRADED). `msix` writes that one value into BOTH
 * `Properties/DisplayName` — the name the Store lists the package under, which
 * Partner Center requires to be a name reserved for the product — and
 * `uap:VisualElements/@DisplayName`, the Start-menu label. Rendered from
 * `shortName`, the package carried the label as its Store title. It is now
 * rendered from `name`, the same value this script writes into
 * store/windows-store/title.txt, and the label reaches VisualElements through
 * tooling/store/msix-visual-name.mjs in the packaging step, which reads
 * `shortName` through readDeclaration below.
 */
export const MSIX_TITLE_TARGET = Object.freeze({
  field: 'msix_config.display_name (Properties/DisplayName, the Store title)',
  in: 'pubspec.yaml',
  // Every app has a pubspec; only an app packaged for the Microsoft Store has
  // an `msix_config:` block in it. `applies` is the difference between "this
  // platform is not configured" (skip) and "the field this renderer owns has
  // moved" (COVERAGE LOST) — without it a freshly stamped app, whose pubspec
  // carries no msix_config at all, would fail the renderer on its first run.
  applies: /^msix_config:/m,
  re: /(^msix_config:[\s\S]*?^ {2}display_name: )[^\r\n]*(\r?)$/m,
  encode: yamlScalar,
});

/** The one reader of `apps/<id>/app.yaml`: plan() below reads every declaration
 *  through it, and so do the .msix tools. Throws on a file that does not parse. */
export function readDeclaration(root, id) {
  return parseYaml(readFileSync(join(root, APPS_DIR, id, 'app.yaml'), 'utf8'));
}

/** The catalogue row's key order. Locked, because the row is the published record
 *  and the bytes are compared by two positive controls: a row whose keys arrive
 *  in whatever order the reader happened to produce is a file that reformats
 *  itself the first time a different tool writes it. */
const ROW_ORDER = ['slug', 'name', 'tagline', 'url', 'origin', 'api', 'listings', 'platforms', 'markets', 'audience', 'status'];

/* ------------------------------------------------------------------ */
/* Serialisation — the catalogue's hand-written house style           */

export function serialise(value, indent = '') {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((el) => el === null || typeof el !== 'object')) {
      return `[${value.map((el) => JSON.stringify(el)).join(', ')}]`;
    }
    return `[\n${value.map((el) => `${indent}  ${serialise(el, `${indent}  `)}`).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const inner = keys.map((k) => `${indent}  ${JSON.stringify(k)}: ${serialise(value[k], `${indent}  `)}`).join(',\n');
    return `{\n${inner}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/* ------------------------------------------------------------------ */
/* Plan                                                               */

const read = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

/**
 * Read every declaration and compute every rendering. Nothing is written here.
 *
 * Returns `{ declarations, files, problems, lost }`, where `files` is a Map of
 * repository-relative path -> exact bytes, `problems` is a list of authoring
 * errors (exit 1) and `lost` is a list of coverage failures (exit 2).
 *
 * 🔴 THE COVERAGE REFUSALS, AND WHY EACH IS 2 RATHER THAN 0. Every one of them
 * describes a run that compared NOTHING and would otherwise print ok:
 *   · no apps/ directory                 — the source set is empty
 *   · zero app.yaml files                — nothing declares, so nothing renders
 *   · the channel register is unreadable — the storefront key set and the store
 *                                          directories both come from it, so
 *                                          `listings` would silently lose keys
 *                                          and no listing file would be rendered
 *   · a declaration exists and yields
 *     zero listing files                 — the store trees moved out from under
 *                                          the renderer and the only thing left
 *                                          being checked is the catalogue
 */
export function plan(root) {
  const problems = [];
  const lost = [];
  const files = new Map();
  const declarations = [];

  const appsAbs = join(root, APPS_DIR);
  if (!isDir(appsAbs)) {
    lost.push(`${APPS_DIR}/ does not exist, so this run had no declaration to render from.`);
    return { declarations, files, problems, lost };
  }

  const registerRaw = read(root, REGISTER);
  if (registerRaw === null) {
    lost.push(`${REGISTER} is missing. It is the ONE declaration of which storefronts exist and where each channel's listing tree lives; without it the rendered \`listings\` block would silently lose keys and no listing file would be written at all.`);
    return { declarations, files, problems, lost };
  }
  let register;
  try {
    register = JSON.parse(registerRaw);
  } catch (e) {
    lost.push(`${REGISTER} is not valid JSON (${e.message}); the storefront key set cannot be derived.`);
    return { declarations, files, problems, lost };
  }
  const channels = Array.isArray(register.channels) ? register.channels : [];
  const storefronts = channels.filter((c) => c && typeof c.storefrontKey === 'string' && c.storefrontKey !== '');
  if (storefronts.length === 0) {
    lost.push(`${REGISTER} names no \`storefrontKey\`. An empty \`listings\` block advertises nothing and satisfies nothing.`);
    return { declarations, files, problems, lost };
  }
  const storeRows = channels.filter((c) => c && c.kind === 'store' && typeof c.storeMetadataDir === 'string' && c.storeMetadataDir.includes('{app}'));
  if (storeRows.length === 0) {
    lost.push(`${REGISTER} declares zero \`kind: "store"\` rows with a \`storeMetadataDir\`. Every listing file below is written into one of those directories, so the listing half of this renderer would cover nothing.`);
    return { declarations, files, problems, lost };
  }
  const listingContract = register.storeMetadataContract;
  if (!Array.isArray(listingContract?.requiredFiles) || listingContract.requiredFiles.length === 0) {
    lost.push(`${REGISTER} carries no \`storeMetadataContract.requiredFiles\`. With \`perChannel.<id>.additionalFiles\` it is the set of listing files a channel's tree carries, and this renderer writes a rendered field only into a channel that declares it. Without it no tree would get any required field.`);
    return { declarations, files, problems, lost };
  }

  const schema = JSON.parse(readFileSync(APP_SCHEMA_PATH, 'utf8'));

  const ids = listDirs(appsAbs).filter((id) => existsSync(join(appsAbs, id, 'app.yaml'))).sort();
  if (ids.length === 0) {
    lost.push(`no ${APPS_DIR}/<id>/app.yaml exists. Zero declarations render zero bytes and every comparison below would pass over an empty set.`);
    return { declarations, files, problems, lost };
  }

  for (const id of ids) {
    const rel = `${APPS_DIR}/${id}/app.yaml`;
    let doc;
    try {
      doc = readDeclaration(root, id);
    } catch (e) {
      problems.push(`${rel}: ${e instanceof YamlError ? e.message : String(e)}`);
      continue;
    }
    const bad = validate(doc, schema, rel);
    if (bad.length) {
      for (const b of bad) problems.push(b);
      continue;
    }
    if (doc.id !== id) {
      problems.push(`${rel}: declares id "${doc.id}" but lives in ${APPS_DIR}/${id}/. The directory name is the app id everywhere else in this tree.`);
      continue;
    }
    const declared = doc.listings ?? {};
    if (Object.hasOwn(declared, 'web')) {
      problems.push(`${rel}: \`listings.web\` is DERIVED from hosts.web and must not be written. Two spellings of one fact is what assert-catalog-contract.mjs fails a row for.`);
      continue;
    }
    const unknown = Object.keys(declared).filter((k) => !storefronts.some((c) => c.storefrontKey === k));
    if (unknown.length) {
      problems.push(`${rel}: \`listings\` names ${unknown.map((u) => `"${u}"`).join(', ')}, which ${REGISTER} does not declare as a storefrontKey.`);
      continue;
    }
    declarations.push({ id, rel, doc });
  }
  if (declarations.length === 0) {
    if (problems.length === 0) lost.push('every declaration was skipped without a recorded problem — this run graded nothing.');
    return { declarations, files, problems, lost };
  }

  // ── the catalogue ─────────────────────────────────────────────────────────
  const rows = declarations.map(({ doc }) => {
    /* 🔴 THE PUBLIC ADDRESS IS A PATH ON THE APEX, NOT A SUBDOMAIN [ADR 075].
     *
     * It was `https://${doc.hosts.web}` until 2026-09-09. The owner's decision
     * and its measured premise: Paddle approves a DOMAIN and says of a
     * subdomain "you will need to have that subdomain approved separately",
     * and its overlay enforces at init AGAINST THE PAGE ORIGIN — so on
     * `<id>.nikatru.com` in-app checkout could not open at all. Razorpay needs
     * a support ticket per sub-domain against a ceiling of one main site plus
     * five. Neither conditions anything on a PATH. So one apex approval, held
     * once, covers app #51.
     *
     * `publicAppUrl` is imported, never retyped — the apex is declared exactly
     * once (tooling/sites/apex.mjs) and `doc.id` is interpolated, never a
     * literal, because the app has already been renamed once and a rename must
     * move both sides of every comparison in the same run. */
    const url = publicAppUrl(doc.id);

    /* WHERE THE BYTES COME FROM, as distinct from where they are addressed.
     * The apex router (sites/nikatru/functions/_middleware.js) reads this to
     * know what to fetch: `pagesOrigin`, which is outside the nikatru.com
     * zone, so the Redirect Rule retiring the subdomain cannot catch the
     * router's own subrequest.
     *
     * ⏱ 2026-09-27 (O-PRODUCT-RECORD-UNBUILT, G-a): THERE IS NO FALLBACK. This
     * used to read `pagesOrigin || web`, "to keep a freshly-stamped app
     * routable before its Pages project has been named", and the brick derived
     * `web` as `<id>.nikatru.com`, a host that has served nothing since the
     * wildcard was deleted: the fallback routed app #2 to NXDOMAIN. The schema
     * now REQUIRES `pagesOrigin` (validated just above, so a declaration
     * without it is exit 1 naming the file and the field), and the value comes
     * from Cloudflare at project creation: `tooling/web/pages-origin.mjs
     * --apply <id>` prints it, and the brick's `pages_origin` input writes it. */
    const origin = `https://${doc.hosts.pagesOrigin}`;
    const declared = doc.listings ?? {};
    const listings = {};
    for (const c of storefronts) {
      listings[c.storefrontKey] = c.kind === 'web' ? url : (declared[c.storefrontKey] ?? null);
    }
    const row = {
      slug: doc.id,
      name: doc.name,
      tagline: doc.tagline,
      url,
      origin,
      api: doc.hosts.api ? `https://${doc.hosts.api}` : '',
      listings,
      platforms: doc.platforms,
      markets: doc.markets,
      audience: doc.audience,
      status: doc.status,
    };
    const ordered = {};
    for (const k of ROW_ORDER) if (row[k] !== undefined) ordered[k] = row[k];
    return ordered;
  });
  files.set(CATALOGUE, `${serialise(rows)}\n`);

  // ── the listing copy ──────────────────────────────────────────────────────
  // Written ONLY into a channel directory that already exists. Creating one is
  // the stamp's job and, for the four channels with no publisher account, an
  // owner-gated decision — assert-store-metadata.mjs PRINTS a missing tree on a
  // deferred row and FAILS an incomplete one, and a renderer that conjured trees
  // would turn that owner-gated print into a commitment nobody made.
  let listingFiles = 0;
  for (const { id, doc } of declarations) {
    for (const c of storeRows) {
      const dir = c.storeMetadataDir.replace('{app}', id);
      if (!isDir(join(root, dir))) continue;
      const values = {
        'title.txt': doc.name,
        'short-description.txt': doc.tagline,
        'category.txt': channelCategory(c.id, doc.category),
        'privacy-policy-url.txt': doc.legal.privacyPolicyUrl,
        'support-url.txt': doc.legal.supportUrl,
        'terms-of-use-url.txt': doc.legal.termsUrl,
      };
      // 🔴 EVERY rendered name needs a value, whichever channel is being
      // written. A vocabulary row marked `rendered` with no entry above used to
      // be written as the string `undefined`, into every tree, with exit 0.
      for (const f of RENDERED_LISTING_FILES) {
        if (typeof values[f] !== 'string') {
          throw new Error(
            `render.mjs: contracts/store/vocabulary.js marks "${f}" rendered, and this renderer has no value for it (${APPS_DIR}/${id}/app.yaml, channel "${c.id}"). ` +
              'Add its source to the `values` map in tooling/app-yaml/render.mjs, or mark the field `rendered: false`. Nothing was written.',
          );
        }
      }
      for (const f of channelListingFiles(listingContract, c.id)) {
        files.set(`${dir}/${f}`, `${values[f]}\n`);
        listingFiles += 1;
      }
    }
  }
  if (listingFiles === 0) {
    lost.push(
      `${declarations.length} declaration(s) rendered ZERO listing files: not one of the ${storeRows.length} store directories ` +
        `${REGISTER} declares exists under any of them. The listing half of this renderer covered nothing, and the catalogue ` +
        'alone is not what [10]D-5 is about.',
    );
  }

  // ── the icon label ────────────────────────────────────────────────────────
  // Only for a declaration that HAS a `shortName`; the field is optional in the
  // schema so an older declaration still parses. A target file that is not on
  // disk is a platform this app was never stamped for and is skipped silently —
  // a target file that IS on disk and no longer carries its anchor is COVERAGE
  // LOST, because that is the renderer having lost a field it believes it owns.
  let labelApps = 0;
  let labelFields = 0;
  for (const { id, doc } of declarations) {
    if (typeof doc.shortName !== 'string' || doc.shortName === '') continue;
    labelApps += 1;
    let fieldsHere = 0;
    for (const t of ICON_LABEL_TARGETS) {
      const rels = t.in
        ? [`${APPS_DIR}/${id}/${t.in}`]
        : (isDir(join(root, APPS_DIR, id, t.dir))
            ? readdirSync(join(root, APPS_DIR, id, t.dir))
                .filter((f) => f.endsWith(t.ext))
                .sort()
                .map((f) => `${APPS_DIR}/${id}/${t.dir}/${f}`)
            : []);
      for (const rel of rels) {
        // A file this loop has already rewritten (two targets can share a file)
        // is read back out of the plan, never off disk.
        const current = files.get(rel) ?? read(root, rel);
        if (current === null) continue;
        if (t.applies && !t.applies.test(current)) continue;
        if (!t.re.test(current)) {
          lost.push(
            `${rel} exists but carries no ${t.field} anchor this renderer can find. \`shortName\` is DECLARED in ` +
              `${APPS_DIR}/${id}/app.yaml, so this file is one of the six an operating system reads the app's name from — ` +
              'and a rendering that quietly skipped it is how a retired brand survives a rename in the one place a user looks ' +
              'at every day. Restore the field, or remove this target and say here why the platform no longer has one.',
          );
          continue;
        }
        files.set(rel, current.replace(t.re, (_m, pre, post) => `${pre}${t.encode(doc.shortName)}${post}`));
        fieldsHere += 1;
        labelFields += 1;
      }
    }
    if (fieldsHere === 0) {
      lost.push(
        `${APPS_DIR}/${id}/app.yaml declares \`shortName: ${doc.shortName}\` and NOT ONE of the ${ICON_LABEL_TARGETS.length} icon-label ` +
          'targets exists under it. The label reaches no operating system, so the declaration is a string this repository ' +
          'renders nowhere — which reads exactly like a rendered one.',
      );
    }
  }
  if (labelApps > 0 && labelFields === 0) {
    lost.push(`${labelApps} declaration(s) carry a \`shortName\` and zero icon-label fields were rendered from any of them.`);
  }

  // ── the MSIX identity name (O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1)) ───────
  // Only for a declaration that carries the record; the schema has already
  // required both of its fields. A pubspec that is not on disk, or carries no
  // `msix_config:`, is an app not packaged for the Microsoft Store and is
  // skipped. A block that no longer carries `identity_name:` is COVERAGE LOST:
  // the renderer has lost a field it owns, and `msix` would package whatever the
  // block says instead.
  {
    const t = MSIX_IDENTITY_TARGET;
    for (const { id, doc } of declarations) {
      const record = doc?.stores?.['windows-store'];
      if (!record || typeof record.identityName !== 'string') continue;
      const rel = `${APPS_DIR}/${id}/${t.in}`;
      const current = files.get(rel) ?? read(root, rel);
      if (current === null || !t.applies.test(current)) continue;
      if (!t.re.test(current)) {
        lost.push(
          `${rel} carries an \`msix_config:\` block and no ${t.field} this renderer can find. ${APPS_DIR}/${id}/app.yaml ` +
            'declares stores.windows-store, so this block packages the app for the Microsoft Store, and a rendering that skipped ' +
            "it would leave the packaged identity to whatever the file happens to say. Restore `  identity_name:` inside the block.",
        );
        continue;
      }
      files.set(rel, current.replace(t.re, (_m, pre, post) => `${pre}${t.encode(record.identityName)}${post}`));
    }
  }

  // ── ⏱ 2026-09-28 · the Windows toast activator (ST-R4) ──────────────────────
  // Only for a declaration whose windows-store record carries the CLSID (the
  // schema requires it). The Dart file is written for EVERY declared app with a
  // lib/core/ (null where there is no record), because the app imports it
  // unconditionally; a pubspec with no msix_config is not packaged for the
  // Store and gets no manifest block.
  for (const { id, doc } of declarations) {
    const record = doc?.stores?.['windows-store'];
    const clsid = typeof doc?.windows?.toastActivatorClsid === 'string' ? doc.windows.toastActivatorClsid : null;
    const rel = `${APPS_DIR}/${id}/pubspec.yaml`;
    const pubspec = files.get(rel) ?? read(root, rel);
    if (isDir(join(root, APPS_DIR, id, 'lib', 'core'))) {
      const name = pubspec === null ? null : (/^name:\s*([A-Za-z0-9_]+)\s*$/m.exec(pubspec) ?? [])[1];
      if (clsid && !name) {
        lost.push(`${rel} declares no \`name:\` this renderer can read, so the Windows AUMID for ${id} cannot be composed.`);
      } else {
        files.set(
          `${APPS_DIR}/${id}/${WINDOWS_IDENTITY_DART}`,
          renderWindowsIdentityDart(
            clsid ? { appName: doc.name, appUserModelId: windowsAppUserModelId(record, name), clsid } : null,
          ),
        );
      }
    }
    const t = MSIX_TOAST_TARGET;
    if (!clsid || pubspec === null || !t.applies.test(pubspec)) continue;
    const display = yamlScalar(doc.name);
    if (t.existing.test(pubspec)) {
      files.set(rel, pubspec.replace(t.existing, (_m, a, b, c) => `${a}${clsid}${b}${yamlScalar(TOAST_ACTIVATOR_ARGUMENTS)}${c}${display}`));
    } else if (t.anchor.test(pubspec)) {
      files.set(
        rel,
        pubspec.replace(t.anchor, (m, _all, cr) =>
          `${m}  toast_activator:${cr}\n    clsid: ${clsid}${cr}\n    arguments: ${yamlScalar(TOAST_ACTIVATOR_ARGUMENTS)}${cr}\n    display_name: ${display}${cr}\n`),
      );
    } else {
      lost.push(`${rel} carries an \`msix_config:\` block and no identity_name to anchor ${t.field} on.`);
    }
  }

  // ── the two Apple Info.plist keys (O-APPLE-PLIST-KEYS-UNRENDERED) ──────────
  // Every declaration carries `exportCompliance` (the schema requires it), so
  // this runs for every app that has an Apple target. A target file that is not
  // on disk is a platform the app was never stamped for and is skipped, exactly
  // as the label loop skips one; see PLIST_KEY_TARGETS for the rest.
  for (const { id, doc } of declarations) {
    for (const t of PLIST_KEY_TARGETS) {
      const rel = `${APPS_DIR}/${id}/${t.in}`;
      // Two rows share each file; the second reads the first's output.
      const current = files.get(rel) ?? read(root, rel);
      if (current === null) continue;
      if (!PLIST_ROOT_CLOSE.test(current)) {
        lost.push(
          `${rel} exists but does not end with the root \`</dict>\` and \`</plist>\` this renderer inserts ${t.key} before. ` +
            'It is an Apple target of a declared app, so App Store review reads this key from it; a render that skipped the file ' +
            'would leave the key to whatever the file happens to say. Restore the plist\'s root close.',
        );
        continue;
      }
      const val = t.value(doc, t);
      if (val.lost) {
        lost.push(`${rel} ${t.key}: ${val.lost}`);
        continue;
      }
      if (val.problem) {
        problems.push(`${APPS_DIR}/${id}/app.yaml → ${rel} ${t.key}: ${val.problem}`);
        continue;
      }
      const keyTag = `<key>${t.key}</key>`;
      const seen = current.split(keyTag).length - 1;
      if (seen > 1) {
        problems.push(
          `${rel} carries ${keyTag} ${seen} times. A plist reader keeps one of them, and which one is not this renderer's to guess; ` +
            'delete the extra copies by hand, then re-render.',
        );
        continue;
      }
      if (seen === 1) {
        const span = new RegExp(`(${keyTag}\\s*)(?:<string>[^<]*</string>|<true\\s*/>|<false\\s*/>)`);
        if (!span.test(current)) {
          lost.push(`${rel} carries ${keyTag} but its value is not a <string>, <true/> or <false/> this renderer can replace.`);
          continue;
        }
        files.set(rel, current.replace(span, (_m, pre) => `${pre}${plistValue(val)}`));
      } else {
        files.set(rel, current.replace(PLIST_ROOT_CLOSE, (_m, nl, close) => `${nl}\t${keyTag}${nl}\t${plistValue(val)}${nl}${close}`));
      }
    }
  }

  // ── ⏱ 2026-09-25 · the .msix Store title (O-MSIX-IDENTITY-UNGRADED) ───────
  // `name`, not `shortName`: see MSIX_TITLE_TARGET. A pubspec with no
  // msix_config is an app not packaged for the Microsoft Store and is skipped;
  // one whose msix_config has lost its display_name anchor is COVERAGE LOST.
  for (const { id, doc } of declarations) {
    const t = MSIX_TITLE_TARGET;
    const rel = `${APPS_DIR}/${id}/${t.in}`;
    const current = files.get(rel) ?? read(root, rel);
    if (current === null || !t.applies.test(current)) continue;
    if (!t.re.test(current)) {
      lost.push(
        `${rel} carries an msix_config block with no display_name this renderer can find. It is the name the .msix ` +
          'declares as Properties/DisplayName, which Partner Center compares to the name reserved for the product — ' +
          'restore the field.',
      );
      continue;
    }
    files.set(rel, current.replace(t.re, (_m, pre, post) => `${pre}${t.encode(doc.name)}${post}`));
  }

  // ── ⏱ 2026-09-15 · the RevenueCat app-id routing map ([ADR 085] decision A) ──
  // Owner: "RevenueCat app id per app". The platform's RevenueCat verifier routes
  // an event to OUR app by the RevenueCat app ids that app declares in
  // `billing.mobileIap.revenuecatAppIds`, and refuses an undeclared id. The
  // Worker cannot read YAML, so the map is RENDERED into a TypeScript module next
  // to the verifier — TypeScript, not JSON, because src/lib/mor/ is also loaded
  // under bare node by tooling/ops/money-dry-run.mjs, which refuses a JSON import
  // without an import attribute (store.ts `MoneyStoreDeps.isKnownProduct` records
  // the measurement). One RevenueCat id claimed by two apps is a PROBLEM, never a
  // last-writer-wins: an event routed to the wrong app grants the wrong product.
  // Rendered only where the platform Worker's money rail exists in this root, so
  // a fixture tree without a Worker is not asked to carry its routing table.
  if (isDir(join(root, REVENUECAT_APP_IDS_DIR))) {
    const routes = new Map();
    for (const { id, doc } of declarations) {
      const ids = doc?.billing?.mobileIap?.revenuecatAppIds;
      if (!ids || typeof ids !== 'object') continue;
      for (const platform of Object.keys(ids).sort()) {
        const rc = ids[platform];
        if (routes.has(rc) && routes.get(rc) !== id) {
          problems.push(
            `${APPS_DIR}/${id}/app.yaml billing.mobileIap.revenuecatAppIds.${platform} is "${rc}", which ${APPS_DIR}/${routes.get(rc)}/app.yaml ` +
              'also declares. [ADR 085] routes a RevenueCat event to an app BY this id, so one id in two apps is an event that grants ' +
              'one of them a product it did not sell.',
          );
          continue;
        }
        routes.set(rc, id);
      }
    }
    files.set(REVENUECAT_APP_IDS_MODULE, renderRevenueCatAppIds(routes));
  }

  // ── O-BRICK-SELLS-NOTHING-IN-A-STORE (12a) · the store SDK key NAME and the plans, per app ──
  // `publicKeySecrets` names the repository secrets a store build of THIS app
  // compiles in. A RevenueCat public key belongs to ONE RevenueCat app, so one
  // name in two apps is the first app's key built into the second: its purchases
  // land in the first app's RevenueCat app and the webhook grants the wrong
  // product — the defect the id map above refuses, one step earlier. Checked in
  // every root, Worker or not, because the build lanes read it, not the Worker.
  // `storeProducts` lists each plan once; at `live` every plan is sold.
  const keyOwners = new Map();
  const PLANS = schema?.properties?.billing?.properties?.mobileIap?.properties?.storeProducts?.items?.properties?.plan?.enum ?? [];
  for (const { id, doc } of declarations) {
    const iap = doc?.billing?.mobileIap;
    if (!iap || typeof iap !== 'object') continue;
    const names = iap.publicKeySecrets && typeof iap.publicKeySecrets === 'object' ? iap.publicKeySecrets : {};
    for (const field of Object.keys(names).sort()) {
      const name = names[field];
      if (typeof name !== 'string') continue;
      if (keyOwners.has(name) && keyOwners.get(name).id !== id) {
        problems.push(
          `${APPS_DIR}/${id}/app.yaml billing.mobileIap.publicKeySecrets.${field} is "${name}", which ${APPS_DIR}/${keyOwners.get(name).id}/app.yaml ` +
            `also declares (publicKeySecrets.${keyOwners.get(name).field}). A RevenueCat public key belongs to ONE RevenueCat app, so a store build ` +
            'of the second app would compile in the first app\'s key and its purchases would be granted to the first app. Name a secret of its own.',
        );
        continue;
      }
      if (!keyOwners.has(name)) keyOwners.set(name, { id, field });
    }
    const plans = Array.isArray(iap.storeProducts) ? iap.storeProducts.map((p) => p?.plan).filter((p) => typeof p === 'string') : [];
    for (const plan of [...new Set(plans)].filter((p) => plans.indexOf(p) !== plans.lastIndexOf(p))) {
      problems.push(`${APPS_DIR}/${id}/app.yaml billing.mobileIap.storeProducts lists plan "${plan}" twice. One plan is one store product.`);
    }
    if (iap.state === 'live') {
      for (const plan of PLANS.filter((p) => !plans.includes(p))) {
        problems.push(
          `${APPS_DIR}/${id}/app.yaml billing.mobileIap is state: live and storeProducts has no "${plan}". A live app sells every plan in-app ` +
            '([ADR 093] §2); the product id is read from the store console, never guessed.',
        );
      }
    }
  }

  // ── ⏱ 2026-09-27 · O-IAP-BUNDLE-SALE-UNLOCKS-ONE-APP · the store SKU map ─────
  // The RevenueCat route cannot tell a bundle SKU from a single-app plan by the
  // event alone, so the map is RENDERED — never typed — from the two registers
  // that declare store products: each app's `storeProducts` (12a, kind `app`,
  // term `subscription`) and each bundle row's `storeProducts` (kind `bundle`).
  // Rendered where the Worker's money rail exists, like the routing map above.
  // The bundle register is read through tooling/catalog/read.mjs, the one Node
  // reader, so this renderer adds no direct catalogue reader (limb G's floor).
  // An (app, productId) pair claimed twice is a PROBLEM: one store product sold
  // as two things grants one of them.
  if (isDir(join(root, REVENUECAT_APP_IDS_DIR))) {
    const skus = [];
    const owners = new Map();
    const claim = (sku, where) => {
      const k = `${sku.app}\u0000${sku.productId}`;
      if (owners.has(k)) {
        problems.push(
          `${where} lists store product "${sku.productId}" for app ${sku.app}, which ${owners.get(k)} also lists. One store product is ` +
            'one thing sold; a SKU in two places is a purchase that grants one of them.',
        );
        return;
      }
      owners.set(k, where);
      skus.push(sku);
    };
    const iapApps = new Set();
    for (const { id, doc } of declarations) {
      const iap = doc?.billing?.mobileIap;
      if (!iap || typeof iap !== 'object') continue;
      iapApps.add(id);
      for (const p of Array.isArray(iap.storeProducts) ? iap.storeProducts : []) {
        if (typeof p?.productId !== 'string' || typeof p?.plan !== 'string') continue;
        claim(
          { app: id, productId: p.productId, kind: 'app', plan: p.plan, term: 'subscription', store: null, featureSet: null, version: null },
          `${APPS_DIR}/${id}/app.yaml billing.mobileIap.storeProducts`,
        );
      }
    }
    if (existsSync(join(root, BUNDLES_REGISTER))) {
      const bundles = readBundles(root);
      if (!bundles.ok) {
        lost.push(`${bundles.why}, so the bundle SKUs could not be read and ${STORE_SKUS_MODULE} would render without them.`);
      } else {
        for (const row of bundles.rows) {
          if (row.storeProducts === undefined) continue;
          const at = `${BUNDLES_REGISTER} ${row.featureSet}@${row.version} storeProducts`;
          if (!Array.isArray(row.storeProducts)) {
            problems.push(`${at} is not a list. It lists each bundle store product as {app, store, plan, productId, term}.`);
            continue;
          }
          if (typeof row.featureSet !== 'string' || !Number.isInteger(row.version)) {
            problems.push(`${at} sits on a row with no string featureSet and integer version, so a SKU on it names no feature set.`);
            continue;
          }
          row.storeProducts.forEach((p, i) => {
            const bad = [];
            if (typeof p?.app !== 'string' || !iapApps.has(p.app)) bad.push('`app` is not an app that declares billing.mobileIap');
            if (!BUNDLE_STORE_RAILS.includes(p?.store)) bad.push(`\`store\` is not one of ${BUNDLE_STORE_RAILS.join(', ')}`);
            if (!BUNDLE_STORE_PLANS.includes(p?.plan)) {
              bad.push(`\`plan\` is not one of ${BUNDLE_STORE_PLANS.join(', ')} (a lifetime is never sold in-app)`);
            }
            if (typeof p?.productId !== 'string' || !STORE_PRODUCT_ID.test(p.productId)) bad.push('`productId` is not a store product id');
            if (!BUNDLE_STORE_TERMS.includes(p?.term)) {
              bad.push(
                `\`term\` is not ${BUNDLE_STORE_TERMS.join(', ')} (every in-app plan is a subscription, so a store bundle grant rolls to the current sellable version)`,
              );
            }
            if (bad.length > 0) {
              problems.push(`${at}[${i}]: ${bad.join('; ')}.`);
              return;
            }
            claim(
              { app: p.app, productId: p.productId, kind: 'bundle', plan: p.plan, term: p.term, store: p.store, featureSet: row.featureSet, version: row.version },
              `${at}[${i}]`,
            );
          });
        }
      }
    }
    files.set(STORE_SKUS_MODULE, renderStoreSkus(skus));
  }

  return { declarations, files, problems, lost };
}

function listDirs(abs) {
  return readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

/** The file's text, or null when there is no file. Read-and-catch rather than
 *  exists-then-read: the answer is the read itself, not a check a later write
 *  could race (CodeQL js/file-system-race). */
function readIfPresent(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                               */

export function render(root, { check = false } = {}) {
  const { files, problems, lost } = plan(root);
  if (lost.length) return { code: 2, lost, problems, stale: [], wrote: [] };
  if (problems.length) return { code: 1, lost, problems, stale: [], wrote: [] };
  const stale = [];
  const wrote = [];
  for (const [rel, contents] of files) {
    const abs = join(root, rel);
    const current = readIfPresent(abs);
    if (current === contents) continue;
    stale.push(rel);
    if (!check) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, contents);
      wrote.push(rel);
    }
  }
  return { code: check && stale.length ? 1 : 0, lost, problems, stale, wrote, total: files.size };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const positional = args.filter((a) => !a.startsWith('--'));
  const root = resolve(positional[0] ?? join(HERE, '..', '..'));
  const r = render(root, { check });
  if (r.code === 2) {
    console.error('');
    for (const l of r.lost) console.error(`FAIL COVERAGE LOST — ${l}`);
    console.error('\nrender: COVERAGE LOST');
    process.exit(2);
  }
  if (r.problems.length) {
    for (const p of r.problems) console.error(`✗ ${p}`);
    console.error(`\nrender: ${r.problems.length} problem(s) in the declarations — nothing was written.`);
    process.exit(1);
  }
  if (check) {
    if (r.stale.length) {
      console.error('✗ these renderings no longer match their declaration:');
      for (const s of r.stale) console.error(`    ${s}`);
      console.error('\n  Change the declaration, not the rendering, then:  node tooling/app-yaml/render.mjs');
      process.exit(1);
    }
    console.log(`ok   render --check — ${r.total} rendering(s) match apps/*/app.yaml`);
    process.exit(0);
  }
  if (r.wrote.length) for (const w of r.wrote) console.log(`wrote ${w}`);
  console.log(`ok   render — ${r.total} rendering(s) from apps/*/app.yaml, ${r.wrote.length} rewritten`);
  process.exit(0);
}
