#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-inappwebview-waivers.mjs — an app whose dependencies pull
// flutter_inappwebview carries the two native build waivers that plugin needs,
// on every native platform the app actually has.
//
// Register row: O-BRICK-NATIVE-SCAFFOLDING (the guard exit `closes` allows).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// 🔴 THE APP BRICK EMITS WEB ONLY, so android/ and windows/ come from stock
// `flutter create`, which carries neither waiver. On 2026-09-04 the first app to
// pull flutter_inappwebview (transitively, under cloudflare_turnstile) broke on
// both platforms: Android in Gradle project evaluation on
// getDefaultProguardFile('proguard-android.txt') (flutter_inappwebview_android
// 1.1.3, build.gradle:44 — AGP 9 throws), Windows in C++ on STL1011 from
// flutter_inappwebview_windows including <experimental/coroutine>. Since PR 537
// (2026-09-07) tooling/bricks/app/hooks/post_gen.dart PRINTS both at stamp time.
// Nothing ENFORCED them. ci.yml's `android-artifacts` job (a ci-gate constituent)
// builds the Android apk and appbundle, so the Gradle evaluation the Android waiver
// is for runs on every PR — minutes in, after the toolchain installs. ci.yml builds
// no Windows binary, so a missing Windows waiver is invisible on every required
// check until build-platforms.yml runs, and this is the check that sees it first.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   W1 for every apps/<app> whose pubspec — or any local `path:` package it
//      depends on, followed recursively — declares a PULLER:
//        · android/ exists  -> android/gradle.properties sets
//          `android.r8.proguardAndroidTxt.disallowed=false` on a live line
//        · windows/ exists  -> windows/CMakeLists.txt has a live
//          `add_compile_definitions(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)`
//          ABOVE `include(flutter/generated_plugins.cmake)`, the directory scope
//          the plugin subdirectories inherit
//   W2 the PULLER set still describes the lockfile: if pubspec.lock resolves
//      flutter_inappwebview and no workspace pubspec declares a known puller, or
//      it resolves a known puller WITHOUT flutter_inappwebview, the set is stale
//      and the guard refuses (exit 2) rather than judge apps against it
//
// A web-only app (no android/, no windows/) needs neither waiver and is printed.
//
// Usage:  node tooling/ci/assert-inappwebview-waivers.mjs [repoRoot]
// Exit 0 = clean. Exit 1 = a missing waiver. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
/** Direct dependencies that pull flutter_inappwebview. cloudflare_turnstile's
 *  membership is a MEASUREMENT (2026-09-04), re-checked against pubspec.lock by W2. */
const PULLERS = ['flutter_inappwebview', 'cloudflare_turnstile'];
const GRADLE_WAIVER = /^\s*android\.r8\.proguardAndroidTxt\.disallowed\s*=\s*false\s*$/m;
const CMAKE_WAIVER = /^\s*add_compile_definitions\(\s*_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS\s*\)/m;
const CMAKE_PLUGINS = /^\s*include\(\s*flutter\/generated_plugins\.cmake\s*\)/m;

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

/** The `dependencies:` block of a pubspec: package name -> `path:` value or null. */
function depsOf(pubspecAbs) {
  const out = new Map();
  const lines = readFileSync(pubspecAbs, 'utf8').split(/\r?\n/);
  let inDeps = false;
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\S/.test(line)) {
      inDeps = /^dependencies:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inDeps || line.trim() === '' || /^\s*#/.test(raw)) continue;
    const top = line.match(/^ {2}([A-Za-z_][\w]*):\s*(.*)$/);
    if (top) {
      current = top[1];
      out.set(current, null);
      continue;
    }
    const p = line.match(/^ {4}path:\s*(\S+)\s*$/);
    if (p && current) out.set(current, p[1]);
  }
  return out;
}

/** Every puller reachable from a pubspec through local path packages. */
function pullersReachable(pubspecAbs, seen = new Set()) {
  if (seen.has(pubspecAbs) || !existsSync(pubspecAbs)) return [];
  seen.add(pubspecAbs);
  const found = [];
  for (const [name, path] of depsOf(pubspecAbs)) {
    if (PULLERS.includes(name)) found.push(`${name} (${rel(pubspecAbs)})`);
    if (path) found.push(...pullersReachable(join(resolve(pubspecAbs, '..', path), 'pubspec.yaml'), seen));
  }
  return found;
}

// ── W2: the puller set against the lockfile ──────────────────────────────────
const lockAbs = join(ROOT, 'pubspec.lock');
if (!existsSync(lockAbs)) coverageLost(['pubspec.lock does not exist at the workspace root, so what the apps really resolve could not be read.']);
const lock = readFileSync(lockAbs, 'utf8');
const resolved = (name) => new RegExp(`^ {2}${name}:\\s*$`, 'm').test(lock);
const appsAbs = join(ROOT, 'apps');
if (!existsSync(appsAbs)) coverageLost(['apps/ does not exist. The scan is broken, not the tree.']);
const apps = listDir(appsAbs, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(appsAbs, e.name, 'pubspec.yaml'))).map((e) => e.name).sort();
if (apps.length === 0) coverageLost(['apps/ holds no app with a pubspec.yaml; every check below would range over nothing.']);

const declaredAnywhere = [];
const pkgsAbs = join(ROOT, 'packages');
const workspacePubspecs = [
  ...apps.map((a) => join(appsAbs, a, 'pubspec.yaml')),
  ...(existsSync(pkgsAbs) ? listDir(pkgsAbs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(pkgsAbs, e.name, 'pubspec.yaml')) : []),
].filter((p) => existsSync(p));
for (const p of workspacePubspecs) for (const name of depsOf(p).keys()) if (PULLERS.includes(name)) declaredAnywhere.push(name);
if (resolved('flutter_inappwebview') && declaredAnywhere.length === 0) {
  coverageLost([
    'pubspec.lock resolves flutter_inappwebview and no app or package pubspec declares a known puller',
    `(${PULLERS.join(', ')}). Something else pulls it now; add it to PULLERS in this guard before it can judge an app.`,
  ]);
}
for (const name of PULLERS.filter((n) => n !== 'flutter_inappwebview')) {
  if (resolved(name) && !resolved('flutter_inappwebview')) {
    coverageLost([
      `pubspec.lock resolves ${name} and NOT flutter_inappwebview, so ${name} no longer pulls it.`,
      'The puller set is stale; remove it from PULLERS rather than demand waivers an app no longer needs.',
    ]);
  }
}

// ── W1: the waivers ──────────────────────────────────────────────────────────
const problems = [];
const prints = [];
let judged = 0;
for (const app of apps) {
  const pulls = pullersReachable(join(appsAbs, app, 'pubspec.yaml'));
  if (pulls.length === 0) {
    prints.push(`apps/${app} pulls no flutter_inappwebview — no waiver needed`);
    continue;
  }
  const platforms = [];
  const android = join(appsAbs, app, 'android');
  const windows = join(appsAbs, app, 'windows');
  if (existsSync(android)) {
    platforms.push('android');
    const gp = join(android, 'gradle.properties');
    if (!existsSync(gp) || !GRADLE_WAIVER.test(readFileSync(gp, 'utf8'))) {
      problems.push(
        `W1 apps/${app} pulls flutter_inappwebview via ${pulls.join(', ')} and apps/${app}/android/gradle.properties does not set ` +
          '`android.r8.proguardAndroidTxt.disallowed=false`. The Android build dies in Gradle evaluation on ' +
          "getDefaultProguardFile('proguard-android.txt'). Copy the dated waiver from apps/subscriptiontracker/android/gradle.properties.",
      );
    }
  }
  if (existsSync(windows)) {
    platforms.push('windows');
    const cm = join(windows, 'CMakeLists.txt');
    const text = existsSync(cm) ? readFileSync(cm, 'utf8') : '';
    const w = text.match(CMAKE_WAIVER);
    const inc = text.match(CMAKE_PLUGINS);
    if (!w) {
      problems.push(
        `W1 apps/${app} pulls flutter_inappwebview via ${pulls.join(', ')} and apps/${app}/windows/CMakeLists.txt has no live ` +
          '`add_compile_definitions(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)`. The Windows build dies on STL1011. ' +
          'Copy the dated waiver from apps/subscriptiontracker/windows/CMakeLists.txt.',
      );
    } else if (inc && w.index > inc.index) {
      problems.push(
        `W1 apps/${app}/windows/CMakeLists.txt defines the coroutine waiver BELOW include(flutter/generated_plugins.cmake), so the plugin ` +
          'subdirectories it exists for are added before it and never see it. Move it above.',
      );
    }
  }
  if (platforms.length === 0) {
    prints.push(`apps/${app} pulls flutter_inappwebview but has no android/ or windows/ — no waiver needed yet`);
    continue;
  }
  judged++;
  prints.push(`apps/${app} pulls flutter_inappwebview via ${pulls.join(', ')}; judged on ${platforms.join(' + ')}`);
}

for (const p of prints) console.log(`   ${p}`);
if (problems.length) {
  console.error(`✗ inappwebview waivers — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  O-BRICK-NATIVE-SCAFFOLDING: ci.yml builds no Windows binary, so this is the only required check that sees a missing Windows waiver;');
  console.error('  a missing Android waiver also fails ci.yml\'s android-artifacts build, later and less directly.');
  process.exit(1);
}
console.log(`ok  inappwebview waivers — ${apps.length} app(s), ${judged} judged on a native platform, puller set agrees with pubspec.lock`);
