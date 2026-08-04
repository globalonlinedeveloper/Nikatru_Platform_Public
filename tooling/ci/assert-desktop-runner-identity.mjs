#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-desktop-runner-identity.mjs — the desktop apps must not show users a
// reverse-DNS application id where a human name belongs.
//
// 🔴 WHY THIS EXISTS — two shipped defects, found 2026-08-04.
//   apps/subly/windows/runner/Runner.rc          CompanyName    = "com.nikatru"
//   apps/subly/windows/runner/Runner.rc          LegalCopyright = "... com.nikatru ..."
//   apps/subly/macos/Runner/Configs/AppInfo.xcconfig  PRODUCT_COPYRIGHT = "... com.nikatru ..."
//
// Those are not internal strings. Windows shows CompanyName and LegalCopyright in
// the file's Properties → Details tab, and macOS shows NSHumanReadableCopyright
// (= PRODUCT_COPYRIGHT) in the About box. Every user who ever right-clicked the
// binary saw the package id where the company's name should be.
//
// 🔬 AND IT IS A FACTORY DEFECT, NOT AN APP DEFECT. Nothing was mistyped: this is
// verbatim what `flutter create --org com.nikatru` writes. The Mason brick under
// tooling/bricks/app carries no windows/ or macos/ runner of its own, so every
// one of the 50 planned apps is born with the same three fields wrong. Fixing
// only Subly fixes one instance of a defect the template reproduces on demand —
// which is exactly why this is a guard and not a note.
//
// ⚠️ WHAT THIS GUARD DELIBERATELY DOES NOT DO: assert the company is called
// "Nikatru". The factory is explicitly MULTI-BRAND (the brick takes a per-app
// seed and identity), there is no company-name SSoT in the tree to compare
// against, and inventing one here would hard-code this brand into a check that
// must outlive it. It asserts two brand-agnostic properties instead:
//
//   (1) NO HUMAN-FACING FIELD CONTAINS THE APP'S OWN REVERSE-DNS ID.
//       The forbidden strings are DERIVED per app from the identifiers the build
//       actually uses — not from a hard-coded "com.nikatru" — so the check keeps
//       meaning under a different org, and cannot be satisfied by a rename.
//   (2) THE COPYRIGHT HOLDER IS THE SAME ON WINDOWS AND macOS.
//       Two platforms, two files, one company. Left uncompared they drift, and a
//       drift is invisible precisely because no one person builds both.
//
// 🔬 WHY NOT JUST FORBID ANY DOTTED LOWERCASE TOKEN? Because it fails on correct
// input: `Copyright 2026 Nikatru (nikatru.com)` is a legitimate line and a naive
// /\w+\.\w+/ rejects it. A guard that fires on correct input gets disabled by
// whoever hits it next, which is how a check stops checking — this repo has that
// failure on record. Deriving the forbidden set from the real bundle id is both
// narrower and stronger.
//
// Usage:  node tooling/ci/assert-desktop-runner-identity.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
// NOT `readdirSync` — a raw listing descends into a nested checkout (a git
// worktree, a submodule, a stray clone) and reads another repository's files as
// this tree's. Green in CI, which creates no worktrees; red on the one machine
// actually looking at it. `listDir` is the single place that knows which entries
// belong to the tree under test.
import { listDir } from './tree-walk.mjs';

const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());
const APPS = join(repoRoot, 'apps');

const problems = [];
const prints = [];

/** `VALUE "Name", "text" "\0"` out of a Windows VERSIONINFO block. */
function rcValue(text, name) {
  const m = text.match(new RegExp(`VALUE\\s+"${name}"\\s*,\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

/** `KEY = value` out of an .xcconfig, comments stripped. */
function xcconfigValue(text, key) {
  for (const line of text.split(/\r?\n/)) {
    const bare = line.replace(/\/\/.*$/, '').trim();
    const m = bare.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * The holder out of a copyright line, both platforms' spellings:
 *   "Copyright (C) 2026 Nikatru. All rights reserved."
 *   "Copyright © 2026 Nikatru. All rights reserved."
 * Returns null when the line is not in that shape — the caller reports that,
 * because an unparseable line is a field this guard cannot vouch for, and
 * silently skipping it is how coverage disappears.
 */
function copyrightHolder(line) {
  const m = line.match(/Copyright\s*(?:\(C\)|\(c\)|©)?\s*\d{4}(?:\s*[-–]\s*\d{4})?\s+(.+?)\s*\.\s*All rights reserved/i);
  return m ? m[1].trim() : null;
}

/**
 * Every reverse-DNS prefix of an id, longest first, that is specific enough to
 * be evidence. `com.nikatru.subly` → ["com.nikatru.subly", "com.nikatru"].
 *
 * The single leading segment is EXCLUDED on purpose: "com" on its own appears
 * inside ordinary English ("com" in a URL, "Telecom") and matching it would fire
 * on correct input. Two segments is the shortest form that is unambiguously an
 * application id.
 */
function dnsPrefixes(id) {
  const parts = id.split('.');
  const out = [];
  for (let n = parts.length; n >= 2; n--) out.push(parts.slice(0, n).join('.'));
  return out;
}

const appsDir = existsSync(APPS) ? listDir(APPS) : [];
let appsWithDesktop = 0;
let fieldsChecked = 0;

for (const slug of appsDir) {
  const appDir = join(APPS, slug);
  const pubspec = join(appDir, 'pubspec.yaml');
  if (!existsSync(pubspec) || !statSync(pubspec).isFile()) continue;

  const rcPath = join(appDir, 'windows', 'runner', 'Runner.rc');
  const xcPath = join(appDir, 'macos', 'Runner', 'Configs', 'AppInfo.xcconfig');
  const hasWindows = existsSync(rcPath);
  const hasMac = existsSync(xcPath);
  if (!hasWindows && !hasMac) continue; // this app ships no desktop runner
  appsWithDesktop += 1;

  const rc = hasWindows ? readFileSync(rcPath, 'utf8') : null;
  const xc = hasMac ? readFileSync(xcPath, 'utf8') : null;

  // ── The forbidden set, derived from what the build really uses ────────────
  // Sources are the app's own identifier declarations. If NONE can be found the
  // guard has nothing to compare against and must say so rather than pass: an
  // empty forbidden set makes limb (1) vacuously true for that app.
  const ids = new Set();
  if (xc) {
    const bundle = xcconfigValue(xc, 'PRODUCT_BUNDLE_IDENTIFIER');
    if (bundle && bundle.includes('.')) ids.add(bundle);
  }
  for (const gradle of ['build.gradle.kts', 'build.gradle']) {
    const g = join(appDir, 'android', 'app', gradle);
    if (!existsSync(g)) continue;
    const m = readFileSync(g, 'utf8').match(/applicationId\s*=?\s*["']([\w.]+)["']/);
    if (m && m[1].includes('.')) ids.add(m[1]);
  }
  if (ids.size === 0) {
    problems.push(
      `apps/${slug}: ships a desktop runner but declares no reverse-DNS application id this guard can read ` +
        `(looked at macos AppInfo.xcconfig PRODUCT_BUNDLE_IDENTIFIER and android applicationId). ` +
        `Without it limb (1) compares against nothing and would pass on any value at all.`,
    );
    continue;
  }
  const forbidden = [...new Set([...ids].flatMap(dnsPrefixes))];

  /** Human-facing = a user can read it without a debugger. */
  const humanFields = [];
  if (rc) {
    for (const name of ['CompanyName', 'FileDescription', 'LegalCopyright', 'ProductName']) {
      const v = rcValue(rc, name);
      if (v === null) {
        problems.push(`apps/${slug}/windows/runner/Runner.rc: no VALUE "${name}" — Windows shows this in file Properties; a missing one is not an empty one, it is unreadable.`);
        continue;
      }
      humanFields.push([`windows/runner/Runner.rc VALUE "${name}"`, v]);
    }
  }
  if (xc) {
    const v = xcconfigValue(xc, 'PRODUCT_COPYRIGHT');
    if (v === null) {
      problems.push(`apps/${slug}/macos/Runner/Configs/AppInfo.xcconfig: no PRODUCT_COPYRIGHT — it is the About box's NSHumanReadableCopyright.`);
    } else {
      humanFields.push(['macos/Runner/Configs/AppInfo.xcconfig PRODUCT_COPYRIGHT', v]);
    }
  }

  // ── Limb 1 — no application id in a field a human reads ───────────────────
  for (const [where, value] of humanFields) {
    fieldsChecked += 1;
    const hit = forbidden.find((f) => value.includes(f));
    if (hit) {
      problems.push(
        `apps/${slug}/${where} = "${value}" contains the application id "${hit}". ` +
          `This is what \`flutter create --org\` writes and it is shown to users — Windows in ` +
          `Properties → Details, macOS in the About box. Put the company's name here.`,
      );
    }
    if (value.trim() === '') {
      problems.push(`apps/${slug}/${where} is empty.`);
    }
    if (/com\.example/.test(value)) {
      problems.push(`apps/${slug}/${where} still carries the \`com.example\` Flutter placeholder.`);
    }
  }

  // ── Limb 2 — one company, two platforms, one spelling ─────────────────────
  if (rc && xc) {
    const winLine = rcValue(rc, 'LegalCopyright');
    const macLine = xcconfigValue(xc, 'PRODUCT_COPYRIGHT');
    if (winLine !== null && macLine !== null) {
      const winHolder = copyrightHolder(winLine);
      const macHolder = copyrightHolder(macLine);
      if (winHolder === null) {
        problems.push(`apps/${slug}: Windows LegalCopyright "${winLine}" is not in the form "Copyright (C) <year> <holder>. All rights reserved." — the holder cannot be compared across platforms.`);
      } else if (macHolder === null) {
        problems.push(`apps/${slug}: macOS PRODUCT_COPYRIGHT "${macLine}" is not in the form "Copyright © <year> <holder>. All rights reserved." — the holder cannot be compared across platforms.`);
      } else if (winHolder !== macHolder) {
        problems.push(
          `apps/${slug}: the copyright holder differs by platform — Windows says "${winHolder}", macOS says "${macHolder}". ` +
            `Two files, one company; nobody builds both by hand, so a drift here is invisible.`,
        );
        fieldsChecked += 1;
      } else {
        fieldsChecked += 1;
        // The Windows CompanyName must be the same company as the copyright
        // holder. Not a style rule: they are two adjacent rows in the same
        // Properties dialog, and disagreeing there reads as a repackaged binary.
        //
        // ⚠️ CONTAINMENT, NOT EQUALITY, and that is deliberate. A copyright line
        // legitimately carries more than the bare name — "Nikatru (nikatru.com)",
        // or a legal form after it. Strict equality rejected exactly that in the
        // first draft, i.e. it failed on correct input, which is the sin this
        // file's header calls out. Containment still catches a different company.
        const company = rcValue(rc, 'CompanyName');
        if (company !== null && company.trim() !== '' && !winHolder.includes(company)) {
          problems.push(
            `apps/${slug}: Windows CompanyName "${company}" and the copyright holder "${winHolder}" are different companies. ` +
              `They sit two rows apart in the same Properties dialog.`,
          );
        }
      }
    }
  }
}

// ── COVERAGE, not "pass" ────────────────────────────────────────────────────
// A guard that evaluated nothing must never be green. Both counters matter: no
// apps at all means the tree moved, and apps with no readable fields means the
// file formats changed under the parser and it is now matching nothing.
if (!existsSync(APPS)) {
  console.error(`COVERAGE LOST: ${APPS} does not exist. If apps/ moved, re-point this guard. Do not delete it.`);
  process.exit(1);
}
if (appsWithDesktop === 0) {
  console.error('COVERAGE LOST: no app under apps/ has a windows/ or macos/ runner.');
  console.error('  Every desktop identity field in the factory is unchecked. If desktop was dropped,');
  console.error('  retire this guard deliberately; do not let it report green over an empty set.');
  process.exit(1);
}
if (fieldsChecked === 0) {
  console.error('COVERAGE LOST: desktop runners exist but zero identity fields were read.');
  console.error('  The Runner.rc / AppInfo.xcconfig format changed and the parsers now match nothing —');
  console.error('  which looks exactly like every field being correct.');
  process.exit(1);
}

prints.push(`${appsWithDesktop} app(s) with a desktop runner · ${fieldsChecked} identity field(s) read`);
prints.push('forbidden strings are DERIVED per app from its real bundle id / applicationId — not hard-coded to one brand');
prints.push('this guard does NOT assert which company name is correct; it asserts no application id is shown in its place');

if (problems.length) {
  console.error('assert-desktop-runner-identity: FAIL');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  console.error('  These strings are user-visible: Windows Properties → Details, macOS About box.');
  console.error('  `flutter create --org <id>` writes the id into all three by default, so a newly');
  console.error('  stamped app is born with them wrong unless something checks.');
  process.exit(1);
}

console.log('assert-desktop-runner-identity: OK');
for (const p of prints) console.log(`  · ${p}`);
