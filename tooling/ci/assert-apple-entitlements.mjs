#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-apple-entitlements.mjs — every app's iOS entitlements are DERIVED
// from its declared Apple capability list, and nothing else.
//
// O-STAMP-APPLE-PROVISIONING-MANUAL · [ADR 088] · [ADR 082] §5.
//
// THE TREE HALF of a three-way agreement: the declared list
// (tooling/apple-provisioning.json), the app's ios/Runner/Runner.entitlements,
// and the LIVE App Store profile. This file needs no secret and runs in ci.yml;
// the live profile is compared by `node tooling/ops/provision-apple.mjs --app
// <slug>`, which holds the ASC key. Both read the rules through
// tooling/ci/apple-provisioning.mjs, so they cannot disagree about what a
// declared capability requires.
//
//   · every apps/<slug> with an ios/Runner tree has a register row — an app
//     stamped without one ships with whatever `flutter create` left, which is
//     how SubscriptionTracker's age door threw until 2026-09-15;
//   · its Runner.entitlements carries EXACTLY the derived keys and values, both
//     directions — a key the profile lacks is a distribution rejection, and a
//     declared key the file lacks is a capability that answers "not entitled";
//   · the Xcode project points CODE_SIGN_ENTITLEMENTS at that file, or the
//     file is inert and the signed app carries none of it;
//   · every register row names an app that exists.
//
// ⏱ 2026-09-18 · O-STAMP-APPLE-MACOS-ENTITLEMENTS — AND THE SAME FOR macOS,
// which until today was compared against nothing:
//   · every file the register's `macosEntitlementFiles` names carries EXACTLY
//     its base App Sandbox keys plus the macOS side of each declared capability
//     (Declared Age Range's macOS side is null — its consumer is iOS-only);
//   · the macOS Xcode project names EXACTLY that set of files: one it names
//     that the register does not is a second file nothing compares, and a
//     register file it does not name is inert. DebugProfile is named by two
//     configurations and is one file, so the comparison is a SET.
// Measured before this limb existed: network.client removed from the macOS
// Release file — the key without which the sandboxed app reaches no backend —
// and this guard exited 0 reporting "1 iOS tree(s) agree".
//
// Exit 0 = agreement. 1 = a finding. 2 = COVERAGE LOST — the register is
// unreadable, or no app's iOS tree, or no app's macOS tree, was read at all.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import {
  REGISTER,
  validateRegister,
  expectedEntitlements,
  expectedMacosEntitlements,
  macosEntitlementFileNames,
  parseFlatDict,
  compareFileToDeclared,
} from './apple-provisioning.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const ENTITLEMENTS = 'ios/Runner/Runner.entitlements';
const PBXPROJ = 'ios/Runner.xcodeproj/project.pbxproj';
const WANT_SETTING = 'CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;';
const MAC_PBXPROJ = 'macos/Runner.xcodeproj/project.pbxproj';

/** Every file a project's CODE_SIGN_ENTITLEMENTS names, comments stripped, as a SET:
 *  the macOS project names DebugProfile for two configurations and Release for one. */
function signedEntitlementFiles(pbxText) {
  const text = pbxText.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...text.matchAll(/CODE_SIGN_ENTITLEMENTS\s*=\s*"?([^;"]+?)"?\s*;/g)].map((m) => m[1].trim()));
}

function lost(why) {
  console.error(`✗ COVERAGE LOST — ${why}`);
  console.error('  assert-apple-entitlements checked nothing, which is not a pass.');
  process.exitCode = 2;
}

function main() {
  let reg;
  try {
    reg = JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
  } catch (e) {
    return lost(`${REGISTER} is unreadable: ${e.message}`);
  }
  const problems = [];
  for (const p of validateRegister(reg)) problems.push(`${REGISTER}: ${p}`);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exitCode = 1;
    return;
  }

  const appsDir = join(ROOT, 'apps');
  if (!existsSync(appsDir)) return lost('apps/ does not exist under the root');
  const slugs = listDir(appsDir).filter((d) => statSync(join(appsDir, d)).isDirectory());
  let checked = 0;
  for (const slug of slugs) {
    const iosRunner = join(appsDir, slug, 'ios', 'Runner');
    if (!existsSync(iosRunner)) continue;
    checked++;
    const row = reg.apps[slug];
    if (!row) {
      problems.push(
        `apps/${slug} has an iOS tree and no row in ${REGISTER}. Declare its Apple capability list there, then run ` +
          `\`node tooling/ops/provision-apple.mjs --app ${slug}\`.`,
      );
      continue;
    }
    const expected = expectedEntitlements(reg, slug);
    const file = join(appsDir, slug, ENTITLEMENTS);
    let entries = new Map();
    if (existsSync(file)) {
      const parsed = parseFlatDict(readFileSync(file, 'utf8'));
      if (!parsed.ok) {
        problems.push(`apps/${slug}/${ENTITLEMENTS} is unreadable (${parsed.reason}) — an unread file cannot be compared`);
        continue;
      }
      entries = parsed.entries;
    } else if (expected.size) {
      problems.push(`apps/${slug}/${ENTITLEMENTS} does not exist, and the capability list requires ${[...expected.keys()].join(', ')}`);
      continue;
    }
    for (const p of compareFileToDeclared(entries, expected)) problems.push(`apps/${slug}/${ENTITLEMENTS} ${p}`);

    if (entries.size) {
      const pbx = join(appsDir, slug, PBXPROJ);
      const text = existsSync(pbx) ? readFileSync(pbx, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') : null;
      const settings = text ? [...text.matchAll(/CODE_SIGN_ENTITLEMENTS\s*=\s*[^;]*;/g)].map((m) => m[0].replace(/\s+/g, ' ')) : [];
      if (!settings.includes(WANT_SETTING)) {
        problems.push(`apps/${slug}/${PBXPROJ} never sets ${WANT_SETTING} — the entitlements file is inert and the signed app carries none of it`);
      }
      for (const s of settings) {
        if (s !== WANT_SETTING) problems.push(`apps/${slug}/${PBXPROJ} sets \`${s}\` — a second entitlements file nothing compares`);
      }
    }
    if (!problems.some((p) => p.startsWith(`apps/${slug}/`))) {
      console.log(`ok   ${slug}: Runner.entitlements carries exactly [${[...expected.keys()].join(', ')}] from [${row.capabilities.join(', ')}]`);
    }
  }
  // ── the macOS limb · ⏱ 2026-09-18 · O-STAMP-APPLE-MACOS-ENTITLEMENTS ─────────
  // Until today the macOS files were compared against nothing, so a key could be
  // dropped from Release.entitlements — the network.client that makes the app
  // reach its backend at all under App Sandbox — and every check stayed green.
  // Each register-named file must carry EXACTLY its base sandbox keys plus the
  // macOS side of the declared capabilities (DECLARED_AGE_RANGE's is null), and
  // the macOS project must name EXACTLY that set of files: a file it names that
  // the register does not is a second file nothing compares, and a register file
  // it does not name is inert.
  const macFiles = macosEntitlementFileNames(reg);
  let checkedMac = 0;
  for (const slug of slugs) {
    const macRunner = join(appsDir, slug, 'macos', 'Runner');
    if (!existsSync(macRunner)) continue;
    checkedMac++;
    const row = reg.apps[slug];
    if (!row) {
      problems.push(
        `apps/${slug} has a macOS tree and no row in ${REGISTER}. Declare its Apple capability list there, then run ` +
          `\`node tooling/ops/provision-apple.mjs --app ${slug}\`.`,
      );
      continue;
    }
    const before = problems.length;
    for (const f of macFiles) {
      const rel = `macos/${f}`;
      const abs = join(appsDir, slug, 'macos', ...f.split('/'));
      const expected = expectedMacosEntitlements(reg, slug, f);
      if (!existsSync(abs)) {
        problems.push(`apps/${slug}/${rel} does not exist, and the register requires ${[...expected.keys()].join(', ')}`);
        continue;
      }
      const parsed = parseFlatDict(readFileSync(abs, 'utf8'));
      if (!parsed.ok) {
        problems.push(`apps/${slug}/${rel} is unreadable (${parsed.reason}) — an unread file cannot be compared`);
        continue;
      }
      for (const p of compareFileToDeclared(parsed.entries, expected)) problems.push(`apps/${slug}/${rel} ${p}`);
    }
    const pbx = join(appsDir, slug, MAC_PBXPROJ);
    if (!existsSync(pbx)) {
      problems.push(`apps/${slug}/${MAC_PBXPROJ} does not exist — nothing says which entitlements file the signed app carries`);
    } else {
      const named = signedEntitlementFiles(readFileSync(pbx, 'utf8'));
      for (const f of macFiles) {
        if (!named.has(f)) problems.push(`apps/${slug}/${MAC_PBXPROJ} never names ${f} — that file is inert and no signed build carries it`);
      }
      for (const f of named) {
        if (!macFiles.includes(f)) problems.push(`apps/${slug}/${MAC_PBXPROJ} names ${f} — a second entitlements file nothing compares`);
      }
    }
    if (problems.length === before) {
      console.log(`ok   ${slug}: macOS ${macFiles.join(' + ')} carry exactly their base sandbox keys plus the declared macOS keys, and the project names exactly those`);
    }
  }

  for (const slug of Object.keys(reg.apps)) {
    if (!slugs.includes(slug)) problems.push(`${REGISTER} declares apps.${slug}, and apps/${slug} does not exist`);
  }
  if (checked === 0) return lost('no apps/<slug>/ios/Runner tree was found, so no entitlements file was compared');
  // Every app ships all seven targets, macOS included, so a tree with iOS and no
  // macOS anywhere is a limb that read nothing — not a pass.
  if (checkedMac === 0) return lost('no apps/<slug>/macos/Runner tree was found, so no macOS entitlements file was compared');

  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nassert-apple-entitlements — ${checked} iOS tree(s) and ${checkedMac} macOS tree(s) agree with the declared capability list.`,
  );
}

main();
