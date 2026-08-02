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
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
