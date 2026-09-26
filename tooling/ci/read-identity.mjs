#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// read-identity.mjs — ONE reading of "what identity does this app declare on
// this platform".
//
// [pipeline 10]D-3 "One `app_id` derives every store identity."
//
// 🔴 NOT A GUARD. It is the single set of readers that
// `tooling/ci/assert-store-identity.mjs`, `tooling/release/submit-play.mjs` and
// `tooling/release/submit-appstore.mjs` share. A second implementation would
// inherit none of the tests those two already carry — and the failure mode of a
// duplicated identity reader is the sharpest one in this stage: it reports
// agreement between two things it read wrongly.
//
// Every reader here answers ONE of three ways and never guesses:
//   { value }            — found exactly one identity;
//   { missing: reason }  — the file is there and declares none (a real fault);
//   { lost: reason }     — the reader cannot see what it is supposed to see, so
//                          the caller must report COVERAGE LOST rather than a
//                          pass. This is the distinction Windows was green on
//                          for weeks: having no identity at all read exactly
//                          like having the right one.
//
// The FILE each identity lives in is declared ONCE, in
// `tooling/channel-register.json`, as a `{app}` template — never here. iOS and
// macOS declare the same bundle id in DIFFERENT files (a pbxproj and an
// xcconfig), and the macOS pbxproj carries only `…​.RunnerTests`, so a reader
// that assumed one location would compare against the TEST bundle's id and
// happily agree with itself.
//
// ⚠️ IT SCANS NOTHING AND OWNS NO COVERAGE CLAIM — it reads the one path it is
// given. "Did my scan still reach the tree" belongs to its callers.
// It is FLAT in tooling/ci because assert-guard-coverage.mjs treats any .mjs
// below tooling/ci as a guard that has escaped its scan.
//
// ⏱ 2026-09-25 — `windowsIdentityOf` joins the readers (O-SECOND-APP-SIGNS-AS-
// THE-FIRST limb (1)). It answers a different question from the four above:
// not "what does this app PACKAGE" but "what did Partner Center ISSUE to this
// app", which each app now declares in its own app.yaml `stores.windows-store`.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from '../app-yaml/yaml.mjs';

const found = (value) => ({ value, missing: null, lost: null });
const missing = (reason) => ({ value: null, missing: reason, lost: null });
const lost = (reason) => ({ value: null, missing: null, lost: reason });

/** Android: `applicationId = "…"` in the app module's Gradle script. */
export function readGradleApplicationId(text, rel) {
  const m = text.match(/^\s*applicationId\s*=\s*"([^"]+)"/m);
  if (!m) {
    return missing(
      `${rel} declares no \`applicationId\`. Play binds the package name PERMANENTLY at the first upload — ` +
        'there is no version of "we will fix it later" — so an undefined package name is not a gap that can ' +
        'wait until submission day.',
    );
  }
  return found(m[1]);
}

/**
 * Apple: every `PRODUCT_BUNDLE_IDENTIFIER` in a pbxproj or an xcconfig, with
 * the TEST bundles dropped EXPLICITLY rather than by taking the first match —
 * "the first one" is order-dependent and silently wrong, and the macOS pbxproj
 * contains nothing else.
 */
export function readAppleBundleId(text, rel) {
  const all = [...text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([A-Za-z0-9.$()_-]+)"?\s*;?/g)].map((m) => m[1]);
  if (all.length === 0) {
    return lost(
      `${rel} contains ZERO \`PRODUCT_BUNDLE_IDENTIFIER\` assignments. The reader has stopped reaching them, ` +
        'so any comparison would be against nothing and would agree.',
    );
  }
  const app = [...new Set(all.filter((b) => !/\.(RunnerTests|RunnerUITests)$/.test(b)))];
  if (app.length === 0) {
    return missing(
      `${rel} declares a PRODUCT_BUNDLE_IDENTIFIER only for test bundles (${all.join(', ')}). The app target has ` +
        'none, so there is no identifier to submit under.',
    );
  }
  if (app.length > 1) {
    return missing(`${rel} declares ${app.length} DIFFERENT app bundle identifiers (${app.join(', ')}). Only one can be submitted and nothing says which.`);
  }
  return found(app[0]);
}

/**
 * Linux: `set(APPLICATION_ID "…")` in the desktop CMakeLists.
 *
 * 🔴 THIS IS THE ONE NOTHING COMPARED. It is the app id GTK registers, the one
 * a `.desktop` file and a Snap must agree with, and until [10]D-3 it was read
 * by no check at all — so a Linux build could carry any identity and every
 * guard stayed green.
 */
export function readCMakeApplicationId(text, rel) {
  const m = text.match(/set\s*\(\s*APPLICATION_ID\s+"([^"]+)"\s*\)/);
  if (!m) {
    return missing(
      `${rel} declares no \`APPLICATION_ID\`. It is the id GTK registers the application under and the one a ` +
        '.desktop entry and a Snap must agree with; absent, the Linux build has no identity for anything to ' +
        'be checked against.',
    );
  }
  return found(m[1]);
}

/** Windows MSIX: the `identity_name` inside a pubspec's `msix_config` block.
 *
 *  ⚠️ THE BLOCK IS BOUNDED BY INDENTATION, not by "everything after the key".
 *  A pubspec has many top-level keys and `identity_name` is a plausible name
 *  under another one; reading to end-of-file would pick up whichever came
 *  first. (Written the loose way once and caught by its own test on the first
 *  run — the regex used `\Z`, which JavaScript does not have, so it silently
 *  matched a literal "Z" and returned "no msix_config block" on a pubspec that
 *  has one.) */
export function readMsixIdentityName(text, rel) {
  const block = text.match(/^msix_config:[^\n]*\n((?:[ \t]+[^\n]*\n|\n)*)/m);
  if (!block) return missing(`${rel} has no \`msix_config:\` block, so the MSIX this app packages under is undeclared.`);
  const m = block[1].match(/^\s+identity_name:\s*(\S.*?)\s*$/m);
  if (!m) return missing(`${rel}'s \`msix_config\` declares no \`identity_name\`.`);
  return found(m[1].replace(/^['"]|['"]$/g, ''));
}

/** How each declared platform's identity is read. Keyed by the `kind` a
 *  register `identity` block names, so the register decides which reader runs
 *  and this file only decides HOW each one reads. */
export const READERS = Object.freeze({
  'gradle-application-id': readGradleApplicationId,
  'apple-bundle-id': readAppleBundleId,
  'cmake-application-id': readCMakeApplicationId,
  'msix-identity-name': readMsixIdentityName,
});

/**
 * Resolve one `{ kind, declaredIn }` identity declaration for one app.
 * `declaredIn` is a `{app}` template from the register.
 */
export function resolveIdentity(root, appSlug, decl) {
  const reader = READERS[decl?.kind];
  if (!reader) {
    return lost(`identity kind "${decl?.kind ?? '(absent)'}" has no reader — known kinds: ${Object.keys(READERS).join(', ')}`);
  }
  if (typeof decl.declaredIn !== 'string' || !decl.declaredIn.includes('{app}')) {
    return lost(`identity declaredIn ${JSON.stringify(decl.declaredIn ?? null)} is not an "{app}" template, so it cannot resolve for any app`);
  }
  const rel = decl.declaredIn.replace('{app}', appSlug);
  const abs = join(root, rel);
  if (!existsSync(abs)) return { value: null, missing: null, lost: null, absent: rel };
  return { ...reader(readFileSync(abs, 'utf8'), rel), rel };
}

/** The store channel whose identity each app declares in its own app.yaml, and
 *  the two fields of that record (tooling/app-yaml/schema/app.schema.json
 *  `stores.windows-store`, which requires both). */
export const WINDOWS_STORE = 'windows-store';
export const WINDOWS_RECORD_FIELDS = Object.freeze(['identityName', 'packageFamilyName']);

/**
 * Windows MSIX: the identity Partner Center ISSUED to one app, read from that
 * app's own declaration, `apps/<appId>/app.yaml` → `stores.windows-store`.
 *
 * O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1). The identity used to be one value on
 * the windows-store channel row, and the app brick copied that row into every
 * app it stamped, so app #2 would package and submit as app #1. Every reader of
 * an app's Windows identity reads it through here, so they all ask the app they
 * are grading and none of them asks the channel.
 *
 * The sentinel belongs to the channel row (`packageIdentity.notYetConfiguredSentinel`),
 * so telling "not yet issued" from "issued" is the caller's job. The answers:
 *   { value: { identityName, packageFamilyName } } — a complete record, real or sentinel;
 *   { missing: reason } — the declaration exists and its record is a FAULT: it does
 *                         not parse, is not a mapping, or has a hole;
 *   { undeclared: rel } — the declaration exists and declares no record;
 *   { absent: rel }     — there is no apps/<appId>/app.yaml at all.
 * Every answer carries `rel`, the declaration's path.
 */
export function windowsIdentityOf(root, appId) {
  const rel = `apps/${appId}/app.yaml`;
  const none = { value: null, missing: null, lost: null, rel };
  const abs = join(root, rel);
  if (!existsSync(abs)) return { ...none, absent: rel };
  let doc;
  try {
    doc = parseYaml(readFileSync(abs, 'utf8'));
  } catch (e) {
    return { ...missing(`${rel} does not parse (${e.message}), so app "${appId}"'s Windows identity cannot be read.`), rel };
  }
  const stores = doc !== null && typeof doc === 'object' ? doc.stores : undefined;
  const rec = stores !== null && typeof stores === 'object' ? stores[WINDOWS_STORE] : undefined;
  if (rec === undefined || rec === null) return { ...none, undeclared: rel };
  if (typeof rec !== 'object' || Array.isArray(rec)) {
    return { ...missing(`${rel} stores.${WINDOWS_STORE} is ${JSON.stringify(rec)}, not a record of ${WINDOWS_RECORD_FIELDS.join(' and ')}.`), rel };
  }
  const holes = WINDOWS_RECORD_FIELDS.filter((f) => typeof rec[f] !== 'string' || rec[f].trim() === '');
  if (holes.length > 0) {
    return {
      ...missing(
        `${rel} stores.${WINDOWS_STORE}.${holes.join(', .')} missing or empty — a hole, not a placeholder. ` +
          "An app with no Partner Center product yet writes the channel row's notYetConfiguredSentinel in both fields.",
      ),
      rel,
    };
  }
  return { ...found({ identityName: rec.identityName, packageFamilyName: rec.packageFamilyName }), rel };
}
