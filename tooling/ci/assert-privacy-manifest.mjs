#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-privacy-manifest.mjs — an Apple privacy manifest that exists is one the
// build actually COPIES, and every reason code in it is one somebody sourced.
//
// Pipeline requirement: Private/requirements/ → C-6.
//
// ── THE FAILURE THIS EXISTS FOR, AND IT IS NOT "THE FILE IS MISSING" ─────────
// 🔴 A `PrivacyInfo.xcprivacy` sitting in the repository and ABSENT FROM THE
// TARGET'S Copy Bundle Resources PHASE IS NEVER COPIED INTO THE APP. The file is
// in git, the diff looks right, the review passes — and the shipped bundle has
// no manifest at all. That state is INDISTINGUISHABLE, from inside this
// repository, from never having written the file, which is precisely why it
// needs a machine to notice.
//
// apps/subly/{ios,macos}/Runner.xcodeproj carries `objectVersion = 54` and NO
// `PBXFileSystemSynchronizedRootGroup` (measured 2026-08-20), so membership is
// NOT automatic: a resource reaches the bundle only through an explicit
// PBXBuildFile in the PBXResourcesBuildPhase. Newer Xcode projects synchronise
// folders and would not need this check; this one does.
//
// ── WHAT IT DELIBERATELY DOES NOT VALIDATE, AND WHY THAT IS NOT LAZINESS ─────
// ⚠️ IT DOES NOT CHECK APPLE'S CONSTANT STRINGS AGAINST A LIST TYPED IN HERE.
// The legal values for `NSPrivacyAccessedAPIType`, and the approved reason codes
// for each, are Apple's vocabulary, and on 2026-08-20 a sourced sweep returned
// only TWO of the five category names with citations. A guard that validated
// against a list assembled from memory would be enforcing invented constants —
// and a wrong constant is ITMS-91056, a rejection. So the rule here is one level
// up and needs no vocabulary at all:
//
//     EVERY reason code appearing in a manifest must have an entry in
//     tooling/channel-register.json carrying a `source` URL and the date it was
//     fetched. A code with no citation FAILS THE BUILD rather than being
//     enforced.
//
// That is the same rule assert-listing-assets.mjs already applies to listing
// numbers, and it is strictly stronger than a hardcoded list: it cannot go stale
// when Apple adds a category, and it cannot certify a value nobody looked up.
//
// ── WHILE NO MANIFEST EXISTS IT PRINTS, IT DOES NOT FAIL ────────────────────
// Zero `.xcprivacy` files exist in this tree today. Writing one correctly needs
// Apple's constants sourced first, and the Apple channels are owner-gated behind
// OWNER_QUEUE A-4 — so failing CI on it would red the build over work only a
// person with an Apple account can finish, which is the shape this repository
// switches off. The gap PRINTS on every run instead, and the moment a manifest
// appears the checks above become hard.
//
// Usage:  node tooling/ci/assert-privacy-manifest.mjs [repoRoot]
// Exit 0 = every manifest present is copied by its target and fully cited.
//      1 = one is not.
//      2 = the scan could not run over the tree it is supposed to read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

export const MANIFEST_NAME = 'PrivacyInfo.xcprivacy';
export const REGISTER_REL = 'tooling/channel-register.json';
export const APPS_DIR = 'apps';

/** The Apple targets a Flutter app carries, and where each one's manifest and
 *  project file live. Declared, because it is toolchain layout and is not
 *  derivable from the register. */
export const APPLE_TARGETS = Object.freeze([
  { platform: 'ios', target: 'Runner', manifest: 'ios/Runner/PrivacyInfo.xcprivacy', pbxproj: 'ios/Runner.xcodeproj/project.pbxproj' },
  { platform: 'macos', target: 'Runner', manifest: 'macos/Runner/PrivacyInfo.xcprivacy', pbxproj: 'macos/Runner.xcodeproj/project.pbxproj' },
]);

/**
 * Pure. Every reason-code-shaped token in a manifest's text.
 *
 * Apple's codes are of the form `CA92.1`, `1C8F.1`, `E174.1` — four
 * alphanumerics, a dot, a digit. Matching the SHAPE rather than a list is what
 * lets this guard demand a citation for a code it has never heard of, which is
 * the whole point: a code nobody has looked up is exactly the one worth stopping.
 */
export function reasonCodesIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/<string>\s*([0-9A-Z]{4}\.\d+)\s*<\/string>/g)) out.add(m[1]);
  return [...out].sort();
}

/**
 * Pure. Is `file` a member of any PBXResourcesBuildPhase in this pbxproj?
 *
 * A resource reaches the bundle in two hops: a PBXBuildFile whose `fileRef`
 * points at the PBXFileReference, and that PBXBuildFile's id listed in a
 * resources phase's `files`. Both hops are checked — a PBXBuildFile that exists
 * and is in no phase is the exact silent case.
 */
export function isInResourcesPhase(pbxproj, file) {
  const text = String(pbxproj ?? '');
  const refIds = [...text.matchAll(/([0-9A-F]{24}) \/\* [^*]*? \*\/ = \{isa = PBXFileReference;[^}]*?path = ([^;]+);/g)]
    .filter((m) => m[2].replace(/["']/g, '').trim().endsWith(file))
    .map((m) => m[1]);
  if (refIds.length === 0) return { member: false, why: `no PBXFileReference names ${file}` };

  const buildIds = [...text.matchAll(/([0-9A-F]{24}) \/\* [^*]*? \*\/ = \{isa = PBXBuildFile; fileRef = ([0-9A-F]{24})/g)]
    .filter((m) => refIds.includes(m[2]))
    .map((m) => m[1]);
  if (buildIds.length === 0) {
    return { member: false, why: `${file} has a PBXFileReference but no PBXBuildFile — it is in the project navigator and in no build phase` };
  }

  for (const phase of text.matchAll(/isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/g)) {
    if (buildIds.some((id) => phase[1].includes(id))) return { member: true, why: null };
  }
  return { member: false, why: `${file} has a PBXBuildFile that no PBXResourcesBuildPhase lists — it will not be copied into the bundle` };
}

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const problems = [];
const prints = [];

function coverageLost(first, ...more) {
  console.error(`✗ COVERAGE LOST — ${first}`);
  for (const m of more) console.error(`    ${m}`);
  process.exit(2);
}

// ── the apps, derived from the tree ─────────────────────────────────────────
const appsAbs = join(ROOT, APPS_DIR);
if (!existsSync(appsAbs)) coverageLost(`${APPS_DIR}/ does not exist under ${ROOT}, so there is no app to check.`);
const apps = listDir(appsAbs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
if (apps.length === 0) {
  coverageLost(`${APPS_DIR}/ holds no app directory.`, 'Every assertion below would be true of the empty set.');
}

// ── the citations, read from the register, never from this file ─────────────
const regAbs = join(ROOT, REGISTER_REL);
if (!existsSync(regAbs)) coverageLost(`${REGISTER_REL} does not exist, so no reason code could be checked for a citation.`);
let register;
try {
  register = JSON.parse(readFileSync(regAbs, 'utf8'));
} catch (e) {
  coverageLost(`${REGISTER_REL} is not valid JSON (${e.message}).`);
}
/** name -> { source, fetched } for every reason code the register cites. */
const cited = new Map();
for (const c of register?.channels ?? []) {
  const codes = c?.privacyManifest?.approvedReasonCodes;
  if (!codes || typeof codes !== 'object') continue;
  for (const [code, meta] of Object.entries(codes)) {
    if (code.startsWith('_')) continue;
    cited.set(code, meta);
  }
}

// ── the check ───────────────────────────────────────────────────────────────
let present = 0;
let checked = 0;
for (const app of apps) {
  for (const t of APPLE_TARGETS) {
    const manifestRel = `${APPS_DIR}/${app}/${t.manifest}`;
    const manifestAbs = join(ROOT, APPS_DIR, app, t.manifest);
    const pbxAbs = join(ROOT, APPS_DIR, app, t.pbxproj);
    if (!existsSync(pbxAbs)) continue; // this app has no such Apple target
    checked++;

    if (!existsSync(manifestAbs)) {
      prints.push(
        `${manifestRel} does not exist. Apple requires a privacy manifest for an app that uses a ` +
          'required-reason API or collects data; ITMS-91053 names the missing-reason case. Printed and not ' +
          'failed: writing one needs Apple\'s constant strings sourced first, and the Apple channels are ' +
          'owner-gated (OWNER_QUEUE A-4). The moment this file appears, the two checks below become hard.',
      );
      continue;
    }
    present++;

    // 1. it must actually be copied into the bundle
    const verdict = isInResourcesPhase(readFileSync(pbxAbs, 'utf8'), MANIFEST_NAME);
    if (!verdict.member) {
      problems.push(
        `${manifestRel} EXISTS AND IS NOT COPIED — ${verdict.why}. A manifest the build never bundles is ` +
          'indistinguishable, from inside this repository, from one that was never written: the file is in ' +
          `git, the diff reads right, and the shipped ${t.platform} bundle has no manifest at all.`,
      );
    }

    // 2. every reason code in it must be cited in the register
    const text = readFileSync(manifestAbs, 'utf8');
    for (const code of reasonCodesIn(text)) {
      const meta = cited.get(code);
      if (!meta || typeof meta.source !== 'string' || !/^https?:\/\//.test(meta.source) || !meta.fetched) {
        problems.push(
          `${manifestRel} declares reason code "${code}" and ${REGISTER_REL} carries no citation for it ` +
            '(a `privacyManifest.approvedReasonCodes` entry with a `source` URL and a `fetched` date). A code ' +
            'nobody looked up is the one worth stopping: the wrong one is ITMS-91056, refused at upload, after ' +
            'the submission slot is spent.',
        );
      }
    }
  }
}

if (checked === 0) {
  coverageLost(
    `no Apple target was found under ${APPS_DIR}/*/{ios,macos}, so nothing was examined.`,
    'This guard would then pass by having looked at no project at all.',
  );
}

if (prints.length) {
  console.log('   ── printed, not failed (owner-gated behind OWNER_QUEUE A-4) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error('assert-privacy-manifest: FAILED');
  process.exit(1);
}
console.log(
  `ok  privacy manifests — ${checked} Apple target(s) across ${apps.length} app(s) examined; ${present} manifest(s) ` +
    `present, each one a member of its target's Copy Bundle Resources phase and carrying only reason codes ` +
    `${REGISTER_REL} cites with a source and a date [pipeline C-6]`,
);
