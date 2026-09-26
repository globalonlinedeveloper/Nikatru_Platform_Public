#!/usr/bin/env node
// [pipeline C-5] The three boundaries that make the chassis reusable, defended
// mechanically instead of by good intentions.
//
//   A. `packages/core` stays PURE DART — no Flutter, no plugins. That purity is
//      *why* core is testable with no Flutter harness and *why* it compiles on
//      web, and it is one careless import from gone.
//   B. `packages/design_system` stays DOMAIN-FREE — it must not know what an app
//      sells. `39-CHASSIS` §6 names the failure exactly: "the first person who
//      imports nikatru_core into design_system to just read isPro destroys
//      [reusability] silently, with every test still green."
//   C. An app never imports a VENDOR SDK that an adapter package already wraps.
//      Without this limb the seams are decorative — nothing stops the app going
//      around them.
//
// ── 🔴 WHY THIS CHECKS IMPORTS AND NOT ONLY PUBSPECS (C-5 lock amendment,
//    PROVEN on the real tree 2026-07-28) ──────────────────────────────────────
// The original acceptance criterion asked only that the PUBSPECS stay clean.
// That criterion cannot fail in this repo, because every package here sets
// `resolution: workspace` and pub workspaces share ONE package config: a member
// can import anything ANY other member depends on, with no dependency of its
// own. Both boundaries were broken by hand to check, and both went green:
//
//   · `import 'package:flutter/material.dart';` + `Color? purityIsDead;` added
//     to packages/core/lib/src/result.dart, pubspec untouched
//        → `dart analyze packages/core` **exit 0**
//   · `import 'package:nikatru_core/...';` + `Failure? domainLeaked;` added to
//     design_system's paywall_gate.dart, pubspec untouched
//        → `dart analyze packages/design_system` **exit 0**
//
// The analyzer's only complaint in each case is `depend_on_referenced_packages`,
// which is an INFO — and the workspace's own analyze script keeps infos
// non-fatal on purpose. So the gate is structurally blind here. A pubspec-only
// guard would have caught NEITHER, which is the whole reason the criterion was
// amended before a line of this file was written.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { deriveAdapters, pubspecDeps } from './adapter-set.mjs';
import { requireAppSet } from './app-set.mjs';

const ROOT = process.cwd();
// ⏱ 2026-09-24 · O-GUARDS-READ-A-HAND-LISTED-APP-SET: limb (c)'s app roots are
// the workspace app set, not a directory listing of apps/. Empty → exit 2.
const APP_SET = requireAppSet(ROOT, 'assert-package-boundaries');
const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`); // exit 2 only if EVERY problem is one (summary below)
// ── pubspec reading lives in adapter-set.mjs, shared with
//    assert-adapter-capabilities.mjs so the two guards read one pubspec the same
//    way. Comments are stripped BEFORE matching there — a commented-out
//    dependency is not a dependency, and grepping prose is how a sibling guard
//    once matched the template comment explaining why a thing was absent.
const depsOf = (pkgDir, block = 'dependencies') => pubspecDeps(ROOT, pkgDir, block);

// Every `package:<name>` referenced from the .dart files under a directory,
// with the files each name appears in.
function packageImports(dir) {
  const found = new Map();
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const de of listDir(d, { withFileTypes: true })) {
      const entry = de.name;
      const full = join(d, entry);
      // The listing's own dirent, not a second look at the path (CodeQL #80).
      if (de.isDirectory()) walk(full);
      else if (entry.endsWith('.dart')) {
        const src = readFileSync(full, 'utf8');
        // Import/export directives only — a `package:` inside a doc comment or
        // a string is prose, and prose is not a dependency.
        // 🔴 BOTH quote styles (2026-08-01 full-corpus review). The quote was
        // hardcoded as `'`, and Dart accepts `"` — so
        // `import "package:flutter/material.dart";` walked through ALL THREE
        // C-5 limbs invisibly. Mutation-proven on core: the double-quoted form
        // left this guard printing "core is pure" while the single-quoted
        // control failed. `prefer_single_quotes` is a non-fatal INFO under the
        // workspace's own analyze posture, so nothing else goes red either: a
        // boundary that quote style can walk around is not a boundary.
        for (const m of src.matchAll(/^\s*(?:import|export)\s+['"]package:([a-z0-9_]+)\//gm)) {
          if (!found.has(m[1])) found.set(m[1], []);
          const rel = relative(ROOT, full).replace(/\\/g, '/');
          if (!found.get(m[1]).includes(rel)) found.get(m[1]).push(rel);
        }
      }
    }
  };
  walk(join(ROOT, dir));
  return found;
}

// ── A · packages/core stays pure Dart ────────────────────────────────────────
// Core's dependency list is an ALLOWLIST, not a ban-list. A ban-list can only
// stop the plugins somebody thought of; an allowlist makes "core takes a new
// dependency" the reviewed event it should be — and catches plugins by
// construction, since a plugin would arrive as a new name here.
const CORE_ALLOWED = {
  crypto: 'pure Dart, Dart-team maintained, all six platforms incl. web — sha256 for content-pack integrity',
  cryptography: 'pure Dart (Apache-2.0, verified publisher), works on web incl. WASM — the Ed25519 pack verifier [ADR 007 AMENDED]',
  intl: 'pure Dart, Dart-team maintained, all six platforms incl. web — MoneyFormatter (src/money/money_format.dart) renders Money through NumberFormat; moved here from two copies 2026-09-11, same constraint as design_system and the app (flutter_localizations hard-pins it)',
};

const coreDeps = depsOf('packages/core');
if (!coreDeps) {
  problems.push('packages/core/pubspec.yaml is unreadable — limb A cannot run, so core purity is unchecked.');
} else {
  for (const [name, kind] of coreDeps) {
    if (kind === 'sdk') {
      problems.push(`core declares \`${name}\` from an SDK (\`sdk: ${name}\`). Core is pure Dart: this is the dependency that makes it untestable without a Flutter harness and unbuildable on some targets.`);
    } else if (!CORE_ALLOWED[name]) {
      problems.push(
        `core declares \`${name}\`, which is not on the pure-Dart allowlist. If it really is pure Dart and portable to all six platforms, add it to CORE_ALLOWED with the reason. If it is a plugin, it does not belong in core — wrap it in an adapter package and put the interface here.`,
      );
    }
  }
  ok(`core declares ${coreDeps.size} dependency/dependencies, all on the pure-Dart allowlist`);
}

const coreImports = packageImports('packages/core/lib');
if (coreImports.size === 0) {
  coverageLost('no `package:` imports found anywhere under packages/core/lib. Core imports crypto and cryptography, so finding none means this scanner has stopped scanning.');
}
for (const [name, files] of coreImports) {
  if (name === 'flutter' || name === 'flutter_test') {
    problems.push(`core IMPORTS \`package:${name}\` in ${files.join(', ')}. The pubspec may still look clean — a pub workspace resolves it anyway — but core is no longer pure Dart.`);
  } else if (name !== 'nikatru_core' && !coreDeps?.has(name)) {
    problems.push(`core imports \`package:${name}\` (${files.join(', ')}) without declaring it. In a pub workspace this compiles and analyzes clean, which is exactly how a boundary dies quietly.`);
  }
}
if (coreImports.size > 0) ok(`core's ${coreImports.size} imported package(s) are declared and Flutter-free`);

// ── B · packages/design_system stays domain-free ─────────────────────────────
const dsDeps = depsOf('packages/design_system');
if (!dsDeps) {
  problems.push('packages/design_system/pubspec.yaml is unreadable — limb B cannot run.');
} else {
  for (const name of dsDeps.keys()) {
    if (name.startsWith('nikatru_')) {
      problems.push(`design_system declares \`${name}\`. The design system must not know what an app sells; the moment it depends on the domain it stops serving 50 unrelated apps.`);
    }
  }
  ok(`design_system declares ${dsDeps.size} dependency/dependencies, none of them domain packages`);
}

const dsImports = packageImports('packages/design_system/lib');
if (dsImports.size === 0) {
  coverageLost('no `package:` imports found under packages/design_system/lib. It imports Flutter, so finding none means this scanner has stopped scanning.');
}
for (const [name, files] of dsImports) {
  if (name.startsWith('nikatru_')) {
    problems.push(`design_system IMPORTS \`package:${name}\` in ${files.join(', ')}. This is the exact failure 39-CHASSIS §6 names — reading one domain value from core, with every test still green.`);
  } else if (!dsDeps?.has(name)) {
    problems.push(`design_system imports \`package:${name}\` (${files.join(', ')}) without declaring it — resolved only by the shared workspace.`);
  }
}
if (dsImports.size > 0) ok(`design_system's ${dsImports.size} imported package(s) are declared and domain-free`);

// ── C · an app never goes around an adapter ──────────────────────────────────
// DERIVED, never typed. The lock is explicit that this set must not be able to
// range over nothing: a hand-written vendor list that somebody empties is an
// assertion that cannot fail, and this repo has shipped several of those.
//
// An adapter = a package under packages/ that is not core, not design_system,
// and declares at least one third-party dependency. Its third-party deps are
// the vendors it wraps — the SDKs an app is supposed to reach only through the
// seam.
//
// The derivation is adapter-set.mjs's deriveAdapters(), the SAME function
// assert-adapter-capabilities.mjs calls for its domain, so the two guards
// range over one adapter set by import rather than by two copies agreeing.
// ⏱ 2026-09-24 · EVERY adapter that wraps a vendor, not the last one listed.
// `url_launcher` is wrapped twice — `purchases` (checkout pages) and
// `external_links` (every other link) — and a one-name map told an app that
// imported it directly to go through the MONEY seam, which refuses `mailto:`.
const WRAPPED = new Map(); // vendor -> [adapter packages that wrap it]
const adapterNames = [];
for (const { name, vendors } of deriveAdapters(ROOT)) {
  for (const v of vendors) WRAPPED.set(v, [...(WRAPPED.get(v) ?? []), name]);
  adapterNames.push(name);
}

// The coverage self-check the lock demands, stated as a floor rather than a
// "> 0" so that silently losing most of the set is caught too.
// RATCHETED 7 → 8 on 2026-08-01, when `packages/purchases` joined the adapter
// set with `url_launcher` ([pipeline 5]M-13). The real tree derives nine; the
// floor stays one below so a single legitimate removal does not turn the guard
// into a blocker, while losing two is still caught.
const MIN_WRAPPED = 8;
if (WRAPPED.size < MIN_WRAPPED) {
  coverageLost(
    `derived only ${WRAPPED.size} wrapped vendor(s) from the adapter packages, expected >= ${MIN_WRAPPED}. Limb (c) would range over an almost-empty set and pass everything. Either the adapters stopped declaring their SDKs, or this derivation has stopped working.`,
  );
} else {
  ok(`derived ${WRAPPED.size} wrapped vendor(s) from ${adapterNames.length} adapter(s) [${adapterNames.join(', ')}]: ${[...WRAPPED.keys()].sort().join(', ')}`);
}

// ── Grandfathered bypasses. Dated, reasoned, and PRINTED on every run. ───────
// These are real violations of limb (c) that predate the guard. They are not
// forgiven — they are a work item (see Private/pre-minimal-2026-09-08:archive/2026-09-07/PROJECT_STATE.md). Fixing them is
// an app refactor, and failing the build on day one would have blocked every
// unrelated change until that refactor landed, which is how a guard gets
// switched off. Anything NEW fails immediately.
const KNOWN_BYPASSES = {
  'apps/subscriptiontracker|flutter_local_notifications':
    '2026-07-28 · Subly rolled its own NotificationService before any adapter existed and still owns every SCHEDULING call — `lib/services/notifications/notification_service.dart` is the file importing the plugin directly. ⚠️ CORRECTED 2026-08-11: this entry read "does not depend on nikatru_notifications at all", and [13]T-9 had already made that false. The adapter IS declared (apps/subscriptiontracker/pubspec.yaml) and imported by four lib files — main.dart, state/providers.dart, features/home/home_screen.dart, features/settings/settings_screen.dart — for the tap callback the fork never had. So the bypass is HALF of what it was written as: the inbound half goes through the seam, the scheduling half is still the fork. A waiver that overstates its own scope is the same defect as one that no longer applies.',
  'apps/subscriptiontracker|timezone':
    '2026-07-28 · same NotificationService; timezone arrives with flutter_local_notifications and leaves with it.',
  // 🪦 `apps/subscriptiontracker|supabase_flutter` LIVED HERE AND IS RESOLVED, NOT MOVED.
  // Its own text said the entry appearing "IS the guard working: build the
  // shared home, and the app copy becomes visible as a bypass the same hour" —
  // and it named the blocker, 39-CHASSIS cut 1. The owner reversed that cut on
  // 2026-08-09, `apps/subscriptiontracker/lib/data/auth/supabase_auth_repository.dart` was
  // deleted, and with it the last direct `package:supabase_flutter` import in
  // the app. The entry is DELETED rather than annotated, because the stale-list
  // check below is the whole reason this dictionary can be trusted: a bypass
  // waiver over an import that no longer exists reads as managed debt and is
  // really a standing permit to re-introduce it. The guard failed on exactly
  // that the hour the fork went, which is what a self-checking exemption list
  // is for.
  'apps/subscriptiontracker|dio':
    '2026-07-28 · Subly DOES depend on nikatru_api_client (it imports ApiException from it) but supplies its own DioApiClient transport. Narrower than the other two: the seam types are used, the transport is duplicated.',
  // 🪦 ⏱ 2026-09-24 · `apps/subscriptiontracker|url_launcher` AND `brick|url_launcher`
  // LIVED HERE AND ARE RESOLVED, NOT MOVED (O-LINK-LAUNCHER-SEAM-UNOWNED).
  //
  // Both were dated 2026-08-01, when [5]M-13 created `packages/purchases` and its
  // url_launcher declaration reclassified two long-standing direct imports as
  // bypasses. That seam, `CheckoutLauncher`, opens checkout pages and refuses
  // anything but absolute https, so it could not serve the legal pages and the
  // support `mailto:` — and routing them through it would have made a money seam
  // own the privacy policy. The brick's row named the real gap: "a shared
  // `ExternalLinkLauncher` seam, not a change to the money rail".
  //
  // That seam exists: core declares `ExternalLinkLauncher` and a pure
  // `LinkPolicy` (https only for configured hosts, mailto only for the configured
  // support address), and `packages/external_links` implements it over
  // url_launcher. Subly and the template each build ONE launcher in their
  // lib/state/providers and open every link through it. The rows are DELETED
  // rather than annotated, for the reason the supabase tombstone above gives: a
  // waiver over an import that no longer exists is a standing permit to
  // re-introduce it. A direct url_launcher import in an app or the template is
  // now a NEW bypass and fails.
};

// ⏱ 2026-09-24 · THE APP ROOTS ARE THE WORKSPACE APP SET (tooling/ci/app-set.mjs).
// This was a directory listing of apps/ that skipped `apps/probe` as "a gitignored
// local stamp, never in CI" — false by then: ci.yml's app-brick job stamps
// apps/probe INTO the workspace, so the skip left the one stamped app CI grades
// unread. A dev-box stamp is still not scanned, because it is not in the
// workspace; an app the workspace declares with no lib/ is COVERAGE LOST.
const appRoots = [];
for (const a of APP_SET) {
  if (existsSync(join(ROOT, a.dir, 'lib'))) appRoots.push(`${a.dir}/lib`);
  else coverageLost(`${a.dir} is in the workspace app set and has no lib/ — limb (c) cannot grade its imports.`);
}
const APP_IDS = new Set(APP_SET.map((a) => a.dir));
const BRICK_LIB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';
if (existsSync(join(ROOT, BRICK_LIB))) appRoots.push(BRICK_LIB);

if (appRoots.length === 0) {
  coverageLost('no app or brick lib/ directory found to scan. Limb (c) has nothing to range over.');
} else {
  ok(`limb (c) scans ${appRoots.length} app/brick root(s): ${appRoots.join(', ')}`);
}

const seen = new Set();
for (const root of appRoots) {
  const owner = root.startsWith('apps/') ? root.split('/').slice(0, 2).join('/') : 'brick';
  for (const [name, files] of packageImports(root)) {
    if (!WRAPPED.has(name)) continue;
    const key = `${owner}|${name}`;
    seen.add(key);
    if (KNOWN_BYPASSES[key]) continue;
    const wrappers = WRAPPED.get(name);
    problems.push(
      `${owner} imports \`package:${name}\` directly (${files.join(', ')}), but ${wrappers.map((a) => `\`packages/${a}\``).join(', ')} already wrap${wrappers.length === 1 ? 's' : ''} it behind a seam. Going around the adapter is what makes the seam decorative: the next app has to solve the same platform problem again, and the portability guarantee stops being true.`,
    );
  }
}

// A grandfathered entry for a bypass that no longer happens is a stale claim,
// and stale claims inflate apparent debt exactly as badly as they hide it.
for (const key of Object.keys(KNOWN_BYPASSES)) {
  // ⏱ 2026-09-24 · a waiver keyed by an app the workspace does not declare is a
  // stale exemption: it can never be seen, so it would otherwise read as fixed
  // debt while re-admitting the import the day the app returns.
  const owner = key.split('|')[0];
  if (owner !== 'brick' && !APP_IDS.has(owner)) {
    problems.push(`stale exemption — KNOWN_BYPASSES key \`${key}\` names ${owner}, which is not in the workspace app set (${[...APP_IDS].join(', ')}). Delete it.`);
    continue;
  }
  if (!seen.has(key) && appRoots.length > 0 && WRAPPED.size >= MIN_WRAPPED) { // a limb (c) that could not look proves nothing stale — its COVERAGE LOST (exit 2) already stands
    problems.push(`KNOWN_BYPASSES still lists \`${key}\`, but that import no longer exists. It was fixed — delete the entry so the list keeps meaning something.`);
  }
}

const live = Object.keys(KNOWN_BYPASSES).filter((k) => seen.has(k));
if (live.length) {
  notes.push(`⬜ ${live.length} grandfathered adapter bypass(es) — real debt, not exemptions:`);
  for (const k of live) notes.push(`   · ${k.replace('|', ' → package:')} — ${KNOWN_BYPASSES[k]}`);
  notes.push('   (printed, not failed: fixing these is an app refactor. Anything NEW fails the build.)');
}

if (notes.length) console.log(`\n${notes.join('\n')}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-package-boundaries: FAILED');
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
} else {
  // apps=N is the workspace set's length, never the number of roots found.
  console.log(`\nassert-package-boundaries: ok apps=${APP_SET.length} — core is pure, the design system is domain-free, and no NEW adapter bypass exists`);
}
