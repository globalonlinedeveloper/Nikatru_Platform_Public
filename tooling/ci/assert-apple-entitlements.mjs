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
// Exit 0 = agreement. 1 = a finding. 2 = COVERAGE LOST — the register is
// unreadable, or no app's iOS tree was read at all.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import {
  REGISTER,
  validateRegister,
  expectedEntitlements,
  parseFlatDict,
  compareFileToDeclared,
} from './apple-provisioning.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const ENTITLEMENTS = 'ios/Runner/Runner.entitlements';
const PBXPROJ = 'ios/Runner.xcodeproj/project.pbxproj';
const WANT_SETTING = 'CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;';

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
  for (const slug of Object.keys(reg.apps)) {
    if (!slugs.includes(slug)) problems.push(`${REGISTER} declares apps.${slug}, and apps/${slug} does not exist`);
  }
  if (checked === 0) return lost('no apps/<slug>/ios/Runner tree was found, so no entitlements file was compared');

  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nassert-apple-entitlements — ${checked} iOS tree(s) agree with the declared capability list.`);
}

main();
