// ─────────────────────────────────────────────────────────────────────────────
// inappwebview-waivers.test.mjs — assert-inappwebview-waivers.mjs must be able
// to FAIL on each waiver, follow a puller through a local package, leave a
// web-only app alone, and refuse when its puller set no longer describes the
// lockfile.
//
// Register row O-BRICK-NATIVE-SCAFFOLDING. The fixture app is shaped like a
// stamp that has had `flutter create --platforms=android,windows` run in it: a
// stock gradle.properties and a stock CMakeLists.txt, neither carrying a waiver.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-inappwebview-waivers.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-iaw-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const LOCK_WITH = 'packages:\n  cloudflare_turnstile:\n    dependency: "direct main"\n  flutter_inappwebview:\n    dependency: transitive\n';
const LOCK_WITHOUT = 'packages:\n  dio:\n    dependency: "direct main"\n';
const STOCK_GRADLE = 'org.gradle.jvmargs=-Xmx8G\nandroid.useAndroidX=true\n';
const WAIVED_GRADLE = `${STOCK_GRADLE}# dated waiver\nandroid.r8.proguardAndroidTxt.disallowed=false\n`;
const STOCK_CMAKE = 'cmake_minimum_required(VERSION 3.14)\nproject(probe LANGUAGES CXX)\nadd_subdirectory("runner")\ninclude(flutter/generated_plugins.cmake)\n';
const WAIVED_CMAKE = STOCK_CMAKE.replace('add_subdirectory("runner")', 'add_compile_definitions(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)\nadd_subdirectory("runner")');
const pubspec = (deps) => `name: probe\n\ndependencies:\n  flutter:\n    sdk: flutter\n${deps}\ndev_dependencies:\n  cloudflare_turnstile: ^3.8.1\n`;

function fixture({ lock = LOCK_WITH, appDeps = '  cloudflare_turnstile: ^3.8.1\n', gradle = WAIVED_GRADLE, cmake = WAIVED_CMAKE, android = true, windows = true, extra = {} } = {}) {
  const dir = join(TMP, `r${seq++}`);
  const w = (rel, body) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
  if (lock !== null) w('pubspec.lock', lock);
  w('apps/probe/pubspec.yaml', pubspec(appDeps));
  if (android) w('apps/probe/android/gradle.properties', gradle);
  if (windows) w('apps/probe/windows/CMakeLists.txt', cmake);
  for (const [rel, body] of Object.entries(extra)) w(rel, body);
  return dir;
}
const run = (dir) => {
  const r = spawnSync(process.execPath, [GUARD, dir], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-inappwebview-waivers', () => {
  test('passes an app that pulls the plugin and carries both waivers, and names what it judged', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /apps\/probe pulls flutter_inappwebview via cloudflare_turnstile \(apps\/probe\/pubspec\.yaml\); judged on android \+ windows/);
  });

  test('W1: a stock gradle.properties (no waiver) fails', () => {
    const { code, out } = run(fixture({ gradle: STOCK_GRADLE }));
    assert.equal(code, 1, out);
    assert.match(out, /W1 apps\/probe pulls flutter_inappwebview .*android\/gradle\.properties does not set `android\.r8\.proguardAndroidTxt\.disallowed=false`/);
  });

  test('W1: a COMMENTED gradle waiver is no waiver', () => {
    const { code, out } = run(fixture({ gradle: `${STOCK_GRADLE}# android.r8.proguardAndroidTxt.disallowed=false\n` }));
    assert.equal(code, 1, out);
    assert.match(out, /W1 apps\/probe .*gradle\.properties does not set/);
  });

  test('W1: a stock CMakeLists.txt (no waiver) fails', () => {
    const { code, out } = run(fixture({ cmake: STOCK_CMAKE }));
    assert.equal(code, 1, out);
    assert.match(out, /W1 apps\/probe .*windows\/CMakeLists\.txt has no live `add_compile_definitions\(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS\)`/);
  });

  test('W1: the CMake waiver BELOW the generated plugins include fails', () => {
    const { code, out } = run(fixture({ cmake: `${STOCK_CMAKE}add_compile_definitions(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)\n` }));
    assert.equal(code, 1, out);
    assert.match(out, /W1 apps\/probe\/windows\/CMakeLists\.txt defines the coroutine waiver BELOW include\(flutter\/generated_plugins\.cmake\)/);
  });

  test('W1: a puller reached through a local path package is followed', () => {
    const { code, out } = run(fixture({
      appDeps: '  nikatru_auth:\n    path: ../../packages/auth\n',
      gradle: STOCK_GRADLE,
      extra: { 'packages/auth/pubspec.yaml': 'name: nikatru_auth\n\ndependencies:\n  flutter_inappwebview: ^6.0.0\n' },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /via flutter_inappwebview \(packages\/auth\/pubspec\.yaml\)/);
  });

  test('a web-only app that pulls the plugin needs no waiver yet, and says so', () => {
    const { code, out } = run(fixture({ android: false, windows: false }));
    assert.equal(code, 0, out);
    assert.match(out, /apps\/probe pulls flutter_inappwebview but has no android\/ or windows\/ — no waiver needed yet/);
  });

  test('an app that pulls nothing needs no waiver, even on a stock native tree', () => {
    const { code, out } = run(fixture({ lock: LOCK_WITHOUT, appDeps: '  dio: ^5.4.0\n', gradle: STOCK_GRADLE, cmake: STOCK_CMAKE }));
    assert.equal(code, 0, out);
    assert.match(out, /apps\/probe pulls no flutter_inappwebview — no waiver needed/);
  });

  test('W2: the lock resolves flutter_inappwebview and no pubspec declares a known puller -> COVERAGE LOST', () => {
    const { code, out } = run(fixture({ appDeps: '  some_new_webview_plugin: ^1.0.0\n' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — pubspec\.lock resolves flutter_inappwebview and no app or package pubspec declares a known puller/);
  });

  test('W2: the lock resolves cloudflare_turnstile WITHOUT flutter_inappwebview -> COVERAGE LOST', () => {
    const { code, out } = run(fixture({ lock: 'packages:\n  cloudflare_turnstile:\n    dependency: "direct main"\n' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — pubspec\.lock resolves cloudflare_turnstile and NOT flutter_inappwebview/);
  });

  test('COVERAGE LOST: no pubspec.lock', () => {
    const { code, out } = run(fixture({ lock: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — pubspec\.lock does not exist/);
  });
});
