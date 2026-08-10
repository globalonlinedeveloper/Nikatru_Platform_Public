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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = process.cwd();
const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

// ── pubspec reading. Line-based on purpose: this repo has no YAML dependency
//    in tooling/, and the shapes we need (a top-level block of `name:` keys) are
//    unambiguous. Comments are stripped BEFORE matching — a commented-out
//    dependency is not a dependency, and grepping prose is how a sibling guard
//    once matched the template comment explaining why a thing was absent.
function depsOf(pkgDir, block = 'dependencies') {
  const p = join(ROOT, pkgDir, 'pubspec.yaml');
  if (!existsSync(p)) return null;
  const out = new Map(); // name -> 'sdk' | 'path' | 'hosted'
  let inBlock = false;
  let current = null;
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^[a-z_]+:/i.test(line)) {
      inBlock = line.startsWith(`${block}:`);
      current = null;
      continue;
    }
    if (!inBlock) continue;
    const m = line.match(/^  ([a-z0-9_]+)\s*:(.*)$/i);
    if (m) {
      current = m[1];
      out.set(current, m[2].trim() ? 'hosted' : 'pending');
      continue;
    }
    if (current && /^\s+sdk:\s*flutter/.test(line)) out.set(current, 'sdk');
    else if (current && /^\s+path:/.test(line)) out.set(current, 'path');
  }
  return out;
}

// Every `package:<name>` referenced from the .dart files under a directory,
// with the files each name appears in.
function packageImports(dir) {
  const found = new Map();
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const entry of listDir(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
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
  problems.push('COVERAGE LOST — no `package:` imports found anywhere under packages/core/lib. Core imports crypto and cryptography, so finding none means this scanner has stopped scanning.');
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
  problems.push('COVERAGE LOST — no `package:` imports found under packages/design_system/lib. It imports Flutter, so finding none means this scanner has stopped scanning.');
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
const LINT_ONLY = /(?:^|_)lints$/; // a lint ruleset is config, not a wrapped SDK
const WRAPPED = new Map(); // vendor -> adapter package that wraps it
const pkgRoot = join(ROOT, 'packages');
const adapterNames = [];
if (existsSync(pkgRoot)) {
  for (const name of listDir(pkgRoot)) {
    if (name === 'core' || name === 'design_system') continue;
    const deps = depsOf(`packages/${name}`);
    if (!deps) continue;
    let wrapsSomething = false;
    for (const [dep, kind] of deps) {
      if (kind === 'sdk' || kind === 'path') continue;
      if (dep.startsWith('nikatru_') || LINT_ONLY.test(dep)) continue;
      WRAPPED.set(dep, name);
      wrapsSomething = true;
    }
    if (wrapsSomething) adapterNames.push(name);
  }
}

// The coverage self-check the lock demands, stated as a floor rather than a
// "> 0" so that silently losing most of the set is caught too.
// RATCHETED 7 → 8 on 2026-08-01, when `packages/purchases` joined the adapter
// set with `url_launcher` ([pipeline 5]M-13). The real tree derives nine; the
// floor stays one below so a single legitimate removal does not turn the guard
// into a blocker, while losing two is still caught.
const MIN_WRAPPED = 8;
if (WRAPPED.size < MIN_WRAPPED) {
  problems.push(
    `COVERAGE LOST — derived only ${WRAPPED.size} wrapped vendor(s) from the adapter packages, expected >= ${MIN_WRAPPED}. Limb (c) would range over an almost-empty set and pass everything. Either the adapters stopped declaring their SDKs, or this derivation has stopped working.`,
  );
} else {
  ok(`derived ${WRAPPED.size} wrapped vendor(s) from ${adapterNames.length} adapter(s): ${[...WRAPPED.keys()].sort().join(', ')}`);
}

// ── Grandfathered bypasses. Dated, reasoned, and PRINTED on every run. ───────
// These are real violations of limb (c) that predate the guard. They are not
// forgiven — they are a work item (see company/PROJECT_STATE.md). Fixing them is
// an app refactor, and failing the build on day one would have blocked every
// unrelated change until that refactor landed, which is how a guard gets
// switched off. Anything NEW fails immediately.
const KNOWN_BYPASSES = {
  'apps/subly|flutter_local_notifications':
    '2026-07-28 · Subly predates the notifications adapter and does not depend on nikatru_notifications at all — it rolled its own NotificationService. The straightest of the three bypasses.',
  'apps/subly|timezone':
    '2026-07-28 · same NotificationService; timezone arrives with flutter_local_notifications and leaves with it.',
  // 🪦 `apps/subly|supabase_flutter` LIVED HERE AND IS RESOLVED, NOT MOVED.
  // Its own text said the entry appearing "IS the guard working: build the
  // shared home, and the app copy becomes visible as a bypass the same hour" —
  // and it named the blocker, 39-CHASSIS cut 1. The owner reversed that cut on
  // 2026-08-09, `apps/subly/lib/data/auth/supabase_auth_repository.dart` was
  // deleted, and with it the last direct `package:supabase_flutter` import in
  // the app. The entry is DELETED rather than annotated, because the stale-list
  // check below is the whole reason this dictionary can be trusted: a bypass
  // waiver over an import that no longer exists reads as managed debt and is
  // really a standing permit to re-introduce it. The guard failed on exactly
  // that the hour the fork went, which is what a self-checking exemption list
  // is for.
  'apps/subly|dio':
    '2026-07-28 · Subly DOES depend on nikatru_api_client (it imports ApiException from it) but supplies its own DioApiClient transport. Narrower than the other two: the seam types are used, the transport is duplicated.',
  // 🔴 THE `supabase_flutter` SHAPE, EXACTLY, AND A SECOND TIME. These are not
  // new bypasses: `url_launcher` has been imported directly by the brick and by
  // Subly since long before any adapter wrapped it, because none did. It was
  // reclassified the moment [5]M-13 created `packages/purchases`, which declares
  // it to open a hosted checkout.
  //
  // AND THE RECLASSIFICATION IS ONLY PARTLY TRUE, which is why these are dated
  // bypasses rather than a silent exemption. `packages/purchases` wraps
  // url_launcher for ONE job — `CheckoutLauncher`, which refuses anything that
  // is not absolute https, because a payment page must render in the user's own
  // browser with its own address bar. The callers below open a support `mailto:`
  // and the legal pages. Routing those through a checkout launcher would be
  // wrong on both sides: it would reject `mailto:` and it would make a money
  // seam responsible for the privacy policy.
  //
  // The honest reading is that GENERAL external-URL opening has no shared home —
  // the same [2]C-15-shaped gap auth had before `packages/auth_supabase` existed.
  // Recorded here so it is visible on every CI run instead of being argued away.
  'apps/subly|url_launcher':
    '2026-08-01 · NOT A NEW BYPASS — reclassified when [5]M-13 created `packages/purchases`, which declares url_launcher for `CheckoutLauncher` (https-only, checkout pages). Subly opens legal pages and a support mailto:, which that seam is not for and would reject. General external-URL opening has no shared home; giving it one is a [2]C-3-shaped work item, and Subly is frozen by 39-CHASSIS cut 1 either way.',
  'brick|url_launcher':
    "2026-08-01 · same reclassification, same reason: the template opens `AppConfig.privacyUrl`, `AppConfig.termsUrl` and a support `mailto:`. `CheckoutLauncher` refuses non-https by design, so it cannot serve them. THIS ONE IS THE REAL WORK ITEM — it is the chassis, so every stamped app inherits it: the gap is a shared `ExternalLinkLauncher` seam, not a change to the money rail.",
};

const appRoots = [];
if (existsSync(join(ROOT, 'apps'))) {
  for (const a of listDir(join(ROOT, 'apps'))) {
    // apps/probe is a gitignored local stamp — present on a dev box, never in
    // CI. Scanning it would make this guard's result depend on whether somebody
    // happened to stamp a probe, which is not a property of the repository.
    if (a === 'probe') continue;
    if (existsSync(join(ROOT, 'apps', a, 'lib'))) appRoots.push(`apps/${a}/lib`);
  }
}
const BRICK_LIB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';
if (existsSync(join(ROOT, BRICK_LIB))) appRoots.push(BRICK_LIB);

if (appRoots.length === 0) {
  problems.push('COVERAGE LOST — no app or brick lib/ directory found to scan. Limb (c) has nothing to range over.');
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
    problems.push(
      `${owner} imports \`package:${name}\` directly (${files.join(', ')}), but \`packages/${WRAPPED.get(name)}\` already wraps it behind a seam. Going around the adapter is what makes the seam decorative: the next app has to solve the same platform problem again, and the portability guarantee stops being true.`,
    );
  }
}

// A grandfathered entry for a bypass that no longer happens is a stale claim,
// and stale claims inflate apparent debt exactly as badly as they hide it.
for (const key of Object.keys(KNOWN_BYPASSES)) {
  if (!seen.has(key)) {
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
  process.exitCode = 1;
} else {
  console.log('\nassert-package-boundaries: ok — core is pure, the design system is domain-free, and no NEW adapter bypass exists');
}
