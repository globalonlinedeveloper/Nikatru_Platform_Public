#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render-apple-privacy-manifest.mjs — BOTH `PrivacyInfo.xcprivacy` files, from
// the ONE audit, on demand.
//
// [G-49] Apple's rule is enforced AT UPLOAD, not at review: "Starting May 1,
// 2024, apps that don't describe their use of required reason API in their
// privacy manifest file aren't accepted by App Store Connect." So the manifest
// is not a review-time nicety that can be fixed in the next round — it is the
// gate on the first byte reaching App Store Connect at all.
//
// ── WHY A GENERATOR AND NOT TWO CHECKED-IN FILES ────────────────────────────
// `apps/<app>/store/ios-appstore/privacy-manifest.json` is the AUDIT: what was
// read, in which binary, on which date, and — the row that matters most — why
// `NSPrivacyAccessedAPITypes` is EMPTY by measurement rather than by default.
// The two `.xcprivacy` files are a RENDERING of that audit, and they are two
// because Xcode wants one per platform, not because there are two audits.
//
// Two copies of one identity is how the wrong one ships. That is the same
// argument `tooling/channel-register.json` makes about the MSIX identity and the
// same one `render-linux-icons.mjs` makes about the desktop entry: the file the
// build consumes is DERIVED, and `assert-apple-privacy-manifest.mjs` re-derives
// it on every CI run and compares BYTES. A hand edit to either `.xcprivacy` is a
// build failure. Never a checksum stored beside the data — the same reasoning as
// `assert-enforcement-index.mjs`.
//
// ── WHAT ACTUALLY DIFFERS BETWEEN THE TWO FILES ─────────────────────────────
// Measured against the committed pair: TWO LINES. The `Platform:` word in the
// header, and the app target's source-file list in the paragraph that explains
// why the accessed-API array is empty. Everything else — tracking, the eleven
// collected data types, the accessed-API array — is one rendering of one audit,
// because iOS and macOS ship the same Dart tree and collect the same data.
//
// 🔴 THE PARAGRAPH THAT NAMES Flutter.framework IS SHARED ON PURPOSE AND IS NOT
// PER-PLATFORM. The macOS engine manifest declares NOTHING (the audit records
// that, under `binaryInventory.macos`), so a per-platform derivation of that
// sentence would render two different paragraphs and the committed macOS file
// would stop reproducing. It is prose ABOUT THE AUDIT, one audit, one sentence.
// What IS per-platform is only what the audit itself records per platform.
//
// ── WHY THE SOURCE-FILE LIST IS A TABLE HERE AND ASSERTED THERE ─────────────
// `APP_TARGET_SOURCES` below is the one place the three file names per platform
// are written, and it is deliberately NOT derived from the pbxproj by this
// generator: the ORDER in the sentence is editorial (delegate, then the
// window/scene, then the generated registrant) and neither the build phase's
// order nor alphabetical order reproduces it — inventing an ordering rule to
// dress a typed list as a derivation would be a derivation of nothing.
//
// What is NOT left to prose is MEMBERSHIP. `assert-apple-privacy-manifest.mjs`
// imports this table and requires it to EQUAL, as a set, the Runner target's
// `PBXSourcesBuildPhase` file list. Add a fourth source file to the app target
// and the guard says so; the ordering stays a sentence a human wrote. Same
// division as `HICOLOR_SIZES` in `render-linux-icons.mjs`: the generator owns the
// declaration, the guard owns the relation to the tree.
//
// Usage:
//   node tooling/store/render-apple-privacy-manifest.mjs --app subly           # write
//   node tooling/store/render-apple-privacy-manifest.mjs --app subly --check   # verify
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

/**
 * The audit, relative to an app directory.
 *
 * 🔴 IT LIVES UNDER `ios-appstore/` AND SERVES BOTH CHANNELS, and that asymmetry
 * is deliberate rather than an oversight: the store-metadata contract gives each
 * channel a directory, and putting a second copy under `macos-appstore/` would
 * recreate exactly the two-copies-of-one-identity failure this file exists to
 * prevent. The JSON's own `channels` array names both.
 */
export const AUDIT_REL = 'store/ios-appstore/privacy-manifest.json';

/** Where the rendered manifest lands, per platform, relative to an app dir. */
export const MANIFEST_REL = {
  ios: 'ios/Runner/PrivacyInfo.xcprivacy',
  macos: 'macos/Runner/PrivacyInfo.xcprivacy',
};

/** The Xcode project that must carry the manifest into the bundle, per platform,
 *  relative to an app dir. Declared here so the guard and this file cannot
 *  disagree about which project owns which manifest. */
export const PBXPROJ_REL = {
  ios: 'ios/Runner.xcodeproj/project.pbxproj',
  macos: 'macos/Runner.xcodeproj/project.pbxproj',
};

/** The app target whose Resources build phase must contain the manifest, and
 *  whose Sources build phase the table below is checked against. */
export const APP_TARGET_NAME = 'Runner';

/**
 * The app target's OWN source files, per platform — the three files the audit
 * says were read in full, in the order the header sentence names them.
 *
 * These are the ONLY per-platform words in either rendered file besides the
 * platform id. iOS has a `SceneDelegate.swift` and no `MainFlutterWindow.swift`;
 * macOS is the mirror image, and its generated registrant is Swift rather than
 * Objective-C. That difference is exactly why the audit read BOTH targets
 * instead of letting one stand for the pair.
 *
 * Membership is asserted against the pbxproj by the guard — see the header.
 */
export const APP_TARGET_SOURCES = {
  ios: ['AppDelegate.swift', 'SceneDelegate.swift', 'GeneratedPluginRegistrant.m'],
  macos: ['AppDelegate.swift', 'MainFlutterWindow.swift', 'GeneratedPluginRegistrant.swift'],
};

/** The platforms this generator renders, in the order it renders them. */
export const PLATFORMS = ['ios', 'macos'];

/** Raised when the audit cannot be read or does not describe what it must.
 *  `lines` is a ready-to-print explanation the caller frames — the same shape
 *  `LinuxBrandUnavailable` and `StockAssetsUnavailable` already use, so a guard
 *  can turn it into its own COVERAGE LOST without reformatting a message. */
export class AppleManifestUnavailable extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

// ── the plist serialisation ──────────────────────────────────────────────────
// Tab-indented, LF-terminated, EMPTY ARRAYS SELF-CLOSED. Worked out by reading
// the committed files rather than by picking a house style: `plutil` and Xcode
// both write `<array/>` for an empty array and a tab per level, and the whole
// value of byte comparison is that this file agrees with what a real tool emits.

const TAB = '\t';
const ind = (depth) => TAB.repeat(depth);

/** 🔴 XML-ESCAPED, even though every constant in Apple's vocabulary is
 *  `[A-Za-z0-9.]`. A `&` or a `<` in a purpose string would otherwise produce a
 *  plist Apple silently fails to parse — and "the file is present but
 *  unreadable" is the one failure mode this whole artefact exists to avoid. */
function xmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** `<array>` of `<string>`, or `<array/>` when empty. */
function stringArray(values, depth) {
  if (values.length === 0) return [`${ind(depth)}<array/>`];
  return [
    `${ind(depth)}<array>`,
    ...values.map((v) => `${ind(depth + 1)}<string>${xmlText(v)}</string>`),
    `${ind(depth)}</array>`,
  ];
}

/** One `NSPrivacyCollectedDataTypes` element. */
function collectedDataTypeDict(row, depth) {
  return [
    `${ind(depth)}<dict>`,
    `${ind(depth + 1)}<key>NSPrivacyCollectedDataType</key>`,
    `${ind(depth + 1)}<string>${xmlText(row.type)}</string>`,
    `${ind(depth + 1)}<key>NSPrivacyCollectedDataTypeLinked</key>`,
    `${ind(depth + 1)}<${row.linked ? 'true' : 'false'}/>`,
    `${ind(depth + 1)}<key>NSPrivacyCollectedDataTypeTracking</key>`,
    `${ind(depth + 1)}<${row.tracking ? 'true' : 'false'}/>`,
    `${ind(depth + 1)}<key>NSPrivacyCollectedDataTypePurposes</key>`,
    ...stringArray(row.purposes ?? [], depth + 1),
    `${ind(depth)}</dict>`,
  ];
}

/** One `NSPrivacyAccessedAPITypes` element. EMPTY TODAY, and rendering it is not
 *  dead code: `unresolved.U-1`'s tripwire is one row added to
 *  `accessedApiDetermination`, regenerate, re-upload. A generator that could not
 *  express the remedy would make the remedy a hand edit. */
function accessedApiDict(entry, depth) {
  return [
    `${ind(depth)}<dict>`,
    `${ind(depth + 1)}<key>NSPrivacyAccessedAPIType</key>`,
    `${ind(depth + 1)}<string>${xmlText(entry.category)}</string>`,
    `${ind(depth + 1)}<key>NSPrivacyAccessedAPITypeReasons</key>`,
    ...stringArray(entry.reasons ?? [], depth + 1),
    `${ind(depth)}</dict>`,
  ];
}

// ── the header comment ───────────────────────────────────────────────────────

/**
 * The paragraph that explains the accessed-API array.
 *
 * TWO BRANCHES, because the empty one is a CLAIM. Declaring a category "just in
 * case" costs nothing at upload and is a false sworn statement about the app
 * target; the audit's `_readme` refuses it in those words. If the array ever
 * becomes non-empty — U-1's tripwire is the only way it should — the paragraph
 * has to stop saying it is empty, and it does so here rather than by somebody
 * remembering to edit a comment that is regenerated on every run.
 */
function accessedApiParagraph(sources, accessedApis) {
  const named = sources.join(', ');
  if (accessedApis.length === 0) {
    return [
      '  NSPrivacyAccessedAPITypes IS EMPTY BY MEASUREMENT, NOT BY DEFAULT. The app target\'s',
      `  own code — ${named} — calls`,
      '  no Required Reason API. The categories this app depends on are declared by the binaries',
      '  that use them: FileTimestamp and SystemBootTime by Flutter.framework, UserDefaults by',
      '  flutter_local_notifications (CA92.1) and shared_preferences_foundation (1C8F.1).',
      '  Repeating any of those here would be this target swearing to code it does not contain.',
      '  The full audit, including the one unsettled question, is in the JSON above.',
    ];
  }
  return [
    '  NSPrivacyAccessedAPITypes IS NON-EMPTY, AND EVERY ROW BELOW IS A SWORN STATEMENT ABOUT',
    `  THIS TARGET'S OWN CODE — ${named}.`,
    '  A category declared here that this target does not call is a false declaration, not a',
    '  harmless precaution; the categories other binaries in the bundle use are declared by those',
    '  binaries, in their own manifests, and must not be repeated here. Declared:',
    ...accessedApis.map((e) => `    ${e.category}: ${(e.reasons ?? []).join(', ')}`),
    '  The full audit, including why each row is here, is in the JSON above.',
  ];
}

function headerComment({ app, platform, sources, accessedApis }) {
  return [
    '<!--',
    `  GENERATED — DO NOT EDIT. Platform: ${platform}.`,
    '',
    `  Source of truth : apps/${app}/${AUDIT_REL}`,
    `  Regenerate with : node tooling/store/render-apple-privacy-manifest.mjs --app ${app}`,
    '  Enforced by     : tooling/ci/assert-apple-privacy-manifest.mjs, which re-derives this',
    '                    file from the JSON on every CI run and compares bytes, and which',
    '                    also asserts this file is a member of the Runner target\'s Resources',
    '                    build phase — a manifest on disk that is not in the bundle is the',
    '                    silent half of this failure.',
    '',
    ...accessedApiParagraph(sources, accessedApis),
    '-->',
  ];
}

// ── reading the audit ────────────────────────────────────────────────────────

/**
 * Parse and structurally validate the audit.
 *
 * 🔴 IT REFUSES A VACUOUS AUDIT RATHER THAN RENDERING ONE. An audit with no
 * `collectedDataTypes.rows` renders a perfectly well-formed plist that swears
 * the app collects nothing — the single most dangerous output this generator
 * could produce, and the one that looks most like success.
 */
export function readAudit(appDir) {
  const path = join(appDir, AUDIT_REL);
  if (!existsSync(path)) {
    throw new AppleManifestUnavailable([
      `${path} does not exist.`,
      'The Apple privacy manifest is GENERATED from that audit; there is nothing to render without it.',
    ]);
  }
  let audit;
  try {
    audit = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new AppleManifestUnavailable([`${path} is not valid JSON — ${e.message}`]);
  }
  const rows = audit?.collectedDataTypes?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppleManifestUnavailable([
      `${path} declares no collectedDataTypes.rows.`,
      'An empty array renders a well-formed plist swearing this app collects nothing, which is the most',
      'dangerous output this generator can produce and the one that looks most like success.',
    ]);
  }
  if (!audit.tracking || typeof audit.tracking.NSPrivacyTracking !== 'boolean') {
    throw new AppleManifestUnavailable([
      `${path} declares no tracking.NSPrivacyTracking boolean.`,
      'Apple requires the key; omitting it is not the same claim as answering false.',
    ]);
  }
  if (!Array.isArray(audit.tracking.NSPrivacyTrackingDomains)) {
    throw new AppleManifestUnavailable([`${path} declares no tracking.NSPrivacyTrackingDomains array.`]);
  }
  if (!audit.accessedApiDetermination || typeof audit.accessedApiDetermination !== 'object') {
    throw new AppleManifestUnavailable([
      `${path} declares no accessedApiDetermination.`,
      'An ABSENT determination and an EMPTY one are different claims: the first is an audit that was never',
      'done, the second is an audit whose finding was "none". Only the second may be rendered.',
    ]);
  }
  for (const platform of PLATFORMS) {
    if (!Array.isArray(audit.accessedApiDetermination[platform])) {
      throw new AppleManifestUnavailable([
        `${path} declares no accessedApiDetermination.${platform} array.`,
      ]);
    }
  }
  return { audit, path };
}

/**
 * The rendered bytes for one platform. Pure: audit in, string out, no
 * filesystem — so the guard can re-derive without touching the tree it is
 * judging, and the round-trip test can render an audit that exists only in
 * memory.
 */
export function renderManifest(audit, platform, app) {
  if (!PLATFORMS.includes(platform)) {
    throw new AppleManifestUnavailable([`unknown platform \`${platform}\` — expected one of ${PLATFORMS.join(', ')}`]);
  }
  const sources = APP_TARGET_SOURCES[platform];
  const accessedApis = audit.accessedApiDetermination[platform] ?? [];
  const rows = audit.collectedDataTypes.rows;
  const tracking = audit.tracking;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    ...headerComment({ app: app ?? audit.app, platform, sources, accessedApis }),
    '<plist version="1.0">',
    '<dict>',
    `${ind(1)}<key>NSPrivacyTracking</key>`,
    `${ind(1)}<${tracking.NSPrivacyTracking ? 'true' : 'false'}/>`,
    `${ind(1)}<key>NSPrivacyTrackingDomains</key>`,
    ...stringArray(tracking.NSPrivacyTrackingDomains, 1),
    `${ind(1)}<key>NSPrivacyCollectedDataTypes</key>`,
  ];
  if (rows.length === 0) {
    lines.push(`${ind(1)}<array/>`);
  } else {
    lines.push(`${ind(1)}<array>`);
    for (const row of rows) lines.push(...collectedDataTypeDict(row, 2));
    lines.push(`${ind(1)}</array>`);
  }
  lines.push(`${ind(1)}<key>NSPrivacyAccessedAPITypes</key>`);
  if (accessedApis.length === 0) {
    lines.push(`${ind(1)}<array/>`);
  } else {
    lines.push(`${ind(1)}<array>`);
    for (const entry of accessedApis) lines.push(...accessedApiDict(entry, 2));
    lines.push(`${ind(1)}</array>`);
  }
  lines.push('</dict>', '</plist>');
  // LF, and a trailing newline — `.gitattributes` stores this tree LF and a
  // file without a final newline is a diff every editor re-introduces.
  return `${lines.join('\n')}\n`;
}

/** Both platforms at once: `{ ios: '<bytes>', macos: '<bytes>' }`. The one entry
 *  point the guard uses, so it cannot re-derive one platform and forget the
 *  other — which is the shape of every "two copies of one identity" failure this
 *  file argues against. */
export function renderAll(audit, app) {
  const out = {};
  for (const platform of PLATFORMS) out[platform] = renderManifest(audit, platform, app);
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main(argv) {
  const appIdx = argv.indexOf('--app');
  const app = appIdx === -1 ? null : argv[appIdx + 1];
  const check = argv.includes('--check');
  if (!app) {
    console.error('usage: node tooling/store/render-apple-privacy-manifest.mjs --app <appId> [--check]');
    return 2;
  }
  const appDir = join(ROOT, 'apps', app);
  if (!existsSync(appDir)) {
    console.error(`apps/${app} does not exist.`);
    return 2;
  }

  let audit;
  try {
    ({ audit } = readAudit(appDir));
  } catch (e) {
    if (!(e instanceof AppleManifestUnavailable)) throw e;
    for (const l of e.lines) console.error(l);
    return 1;
  }

  const rendered = renderAll(audit, app);
  let drift = 0;
  for (const platform of PLATFORMS) {
    const path = join(appDir, MANIFEST_REL[platform]);
    const want = rendered[platform];
    const have = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (check) {
      if (have === want) {
        console.log(`ok    ${app}/${MANIFEST_REL[platform]} (${want.length} bytes)`);
      } else {
        drift++;
        console.error(
          `DRIFT ${app}/${MANIFEST_REL[platform]} — ${have === null ? 'missing' : 'differs from the audit'}`,
        );
      }
    } else if (have === want) {
      console.log(`same  ${app}/${MANIFEST_REL[platform]} (${want.length} bytes)`);
    } else {
      writeFileSync(path, want);
      console.log(`wrote ${app}/${MANIFEST_REL[platform]} (${want.length} bytes)`);
    }
  }
  if (check && drift) {
    console.error('');
    console.error('  The .xcprivacy files are GENERATED. Edit the audit and regenerate; never the other way.');
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
