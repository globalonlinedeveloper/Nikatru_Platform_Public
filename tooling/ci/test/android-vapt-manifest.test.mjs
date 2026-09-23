// ─────────────────────────────────────────────────────────────────────────────
// android-vapt-manifest.test.mjs — assert-android-vapt-manifest.mjs must be able
// to FAIL on each of the six static apps.gov.in VAPT items, and must refuse
// rather than pass when it cannot judge what it read.
//
// Register row O-APPS-GOV-IN-VAPT-CHECKLIST: "a mutation case per item".
// ⏱ 2026-09-23 · Row O-VAPT-V5-FOREIGN-PERMISSION: V5 F1-F7 judge the CLASS of
// a protecting permission (platform, declared signature, or FOREIGN).
//
// ⚠️ THE FIXTURES ARE REAL BYTES. Every .apk below is a genuine zip holding a
// genuine binary AXML manifest, encoded chunk by chunk by the writer in THIS
// file, which shares no code with the guard's decoder. A fixture built by the
// guard's own helper would prove only that the helper agrees with itself.
//
// The base manifest mirrors the merged manifest of the real app: a launcher
// activity, the notification receivers at exported=false, and
// androidx.profileinstaller.ProfileInstallReceiver exported but protected by
// android.permission.DUMP (store/android-play/data-safety.json records that one
// in the merged manifest read off run 34345368085).
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-android-vapt-manifest.mjs');
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-vapt-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

// ── binary AXML writer ──────────────────────────────────────────────────────
// android.R.attr ids, written out again here rather than imported.
const ATTR_IDS = {
  name: 0x01010003, permission: 0x01010006, readPermission: 0x01010007, writePermission: 0x01010008,
  protectionLevel: 0x01010009, debuggable: 0x0101000f, exported: 0x01010010, value: 0x01010024, resource: 0x01010025,
  minSdkVersion: 0x0101020c, targetSdkVersion: 0x01010270, allowBackup: 0x01010280,
  usesCleartextTraffic: 0x010104ec, networkSecurityConfig: 0x01010527, label: 0x01010001, icon: 0x01010002, scheme: 0x01010027,
  host: 0x01010028, pathPattern: 0x0101002c,
};

const A = (name, value) => ({ android: true, name, value });
const P = (name, value) => ({ android: false, name, value });
const el = (tag, attrs = [], children = []) => ({ tag, attrs, children });

function chunk(type, headerSize, body) {
  const h = Buffer.alloc(8);
  h.writeUInt16LE(type, 0);
  h.writeUInt16LE(headerSize, 2);
  h.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([h, body]);
}

/**
 * @param doc    the element tree
 * @param utf8   write the string pool as UTF-8 (aapt2's choice varies by version)
 * @param garbleNames  replace every android attribute NAME string with a
 *               meaningless one, so only the resource map identifies it
 */
function axml(doc, { utf8 = false, garbleNames = false } = {}) {
  // android attribute names first, in resource-map order
  const androidNames = [];
  const others = [ANDROID_NS, 'android'];
  const visit = (n) => {
    for (const a of n.attrs) {
      if (a.android) { if (!androidNames.includes(a.name)) androidNames.push(a.name); }
      else if (!others.includes(a.name)) others.push(a.name);
      if (typeof a.value === 'string' && !others.includes(a.value)) others.push(a.value);
    }
    if (!others.includes(n.tag)) others.push(n.tag);
    n.children.forEach(visit);
  };
  visit(doc);
  const pool = [...androidNames.map((n, i) => (garbleNames ? `z${i}` : n)), ...others.filter((s) => !androidNames.includes(s))];
  const idx = (s) => {
    const i = pool.indexOf(s);
    if (i < 0) throw new Error(`string not pooled: ${s}`);
    return i;
  };
  const nameIdx = (a) => (a.android ? androidNames.indexOf(a.name) : idx(a.name));

  // string pool
  const encoded = pool.map((s) => {
    if (utf8) {
      const bytes = Buffer.from(s, 'utf8');
      assert.ok(bytes.length < 128, 'fixture strings stay under 128 bytes');
      return Buffer.concat([Buffer.from([s.length, bytes.length]), bytes, Buffer.from([0])]);
    }
    const len = Buffer.alloc(2);
    len.writeUInt16LE(s.length, 0);
    return Buffer.concat([len, Buffer.from(s, 'utf16le'), Buffer.alloc(2)]);
  });
  const offsets = Buffer.alloc(4 * pool.length);
  let off = 0;
  encoded.forEach((e, i) => { offsets.writeUInt32LE(off, 4 * i); off += e.length; });
  let data = Buffer.concat(encoded);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const spHead = Buffer.alloc(20);
  spHead.writeUInt32LE(pool.length, 0);
  spHead.writeUInt32LE(0, 4);
  spHead.writeUInt32LE(utf8 ? 0x100 : 0, 8);
  spHead.writeUInt32LE(28 + offsets.length, 12);
  spHead.writeUInt32LE(0, 16);
  const stringPoolChunk = chunk(0x0001, 28, Buffer.concat([spHead, offsets, data]));

  const resMap = Buffer.alloc(4 * androidNames.length);
  androidNames.forEach((n, i) => resMap.writeUInt32LE(ATTR_IDS[n], 4 * i));
  const resMapChunk = chunk(0x0180, 8, resMap);

  const nsBody = () => {
    const b = Buffer.alloc(16);
    b.writeUInt32LE(1, 0); b.writeInt32LE(-1, 4);
    b.writeUInt32LE(idx('android'), 8); b.writeUInt32LE(idx(ANDROID_NS), 12);
    return b;
  };
  const parts = [stringPoolChunk, resMapChunk, chunk(0x0100, 16, nsBody())];
  const emit = (n) => {
    const head = Buffer.alloc(8 + 20);
    head.writeUInt32LE(1, 0); head.writeInt32LE(-1, 4);
    head.writeInt32LE(-1, 8); head.writeUInt32LE(idx(n.tag), 12);
    head.writeUInt16LE(20, 16); head.writeUInt16LE(20, 18); head.writeUInt16LE(n.attrs.length, 20);
    const attrs = n.attrs.map((a) => {
      const b = Buffer.alloc(20);
      if (a.android) b.writeUInt32LE(idx(ANDROID_NS), 0); else b.writeInt32LE(-1, 0);
      b.writeUInt32LE(nameIdx(a), 4);
      b.writeUInt16LE(8, 12);
      if (typeof a.value === 'string') {
        b.writeUInt32LE(idx(a.value), 8); b[15] = 0x03; b.writeUInt32LE(idx(a.value), 16);
      } else if (typeof a.value === 'boolean') {
        b.writeInt32LE(-1, 8); b[15] = 0x12; b.writeUInt32LE(a.value ? 0xffffffff : 0, 16);
      } else if (typeof a.value === 'number') {
        b.writeInt32LE(-1, 8); b[15] = 0x10; b.writeUInt32LE(a.value, 16);
      } else if ('hex' in a.value) {
        // TYPE_INT_HEX, the way aapt2 writes a flag attribute such as protectionLevel
        b.writeInt32LE(-1, 8); b[15] = 0x11; b.writeUInt32LE(a.value.hex, 16);
      } else {
        b.writeInt32LE(-1, 8); b[15] = 0x01; b.writeUInt32LE(a.value.ref, 16);
      }
      return b;
    });
    parts.push(chunk(0x0102, 16, Buffer.concat([head, ...attrs])));
    n.children.forEach(emit);
    const end = Buffer.alloc(16);
    end.writeUInt32LE(1, 0); end.writeInt32LE(-1, 4); end.writeInt32LE(-1, 8); end.writeUInt32LE(idx(n.tag), 12);
    parts.push(chunk(0x0103, 16, end));
  };
  emit(doc);
  parts.push(chunk(0x0101, 16, nsBody()));
  return chunk(0x0003, 8, Buffer.concat(parts));
}

// ── zip writer ──────────────────────────────────────────────────────────────
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const body = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12); eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

// ── the base manifest, and mutations of it ──────────────────────────────────
const launcherFilter = () =>
  el('intent-filter', [], [el('action', [A('name', 'android.intent.action.MAIN')]), el('category', [A('name', 'android.intent.category.LAUNCHER')])]);

function baseManifest({ app = {}, targetSdk = 36, extraComponents = [], activityFilters = null, manifestExtras = [] } = {}) {
  const appAttrs = [A('label', 'Demo'), A('name', 'android.app.Application'), A('icon', { ref: 0x7f0d0000 })];
  const backup = 'allowBackup' in app ? app.allowBackup : false;
  if (backup !== undefined) appAttrs.push(A('allowBackup', backup));
  for (const [k, v] of Object.entries(app)) if (k !== 'allowBackup' && v !== undefined) appAttrs.push(A(k, v));
  return el('manifest', [P('package', 'com.example.demo')], [
    el('uses-sdk', [A('minSdkVersion', 21), A('targetSdkVersion', targetSdk)]),
    el('uses-permission', [A('name', 'android.permission.INTERNET')]),
    ...manifestExtras,
    el('application', appAttrs, [
      el('activity', [A('name', 'com.example.demo.MainActivity'), A('exported', true)], [
        el('meta-data', [A('name', 'io.flutter.embedding.android.NormalTheme'), A('resource', { ref: 0x7f0f0001 })]),
        ...(activityFilters ?? [launcherFilter()]),
      ]),
      el('meta-data', [A('name', 'flutterEmbedding'), A('value', '2')]),
      el('receiver', [A('name', 'com.dexterous.flutterlocalnotifications.ScheduledNotificationReceiver'), A('exported', false)]),
      el('receiver', [A('name', 'androidx.profileinstaller.ProfileInstallReceiver'), A('exported', true), A('permission', 'android.permission.DUMP')], [
        el('intent-filter', [], [el('action', [A('name', 'androidx.profileinstaller.action.INSTALL_PROFILE')])]),
      ]),
      el('provider', [A('name', 'androidx.startup.InitializationProvider'), A('exported', false)]),
      ...extraComponents,
    ]),
  ]);
}

// ⏱ 2026-09-23 · THE REAL SHAPE, row O-VAPT-V5-FOREIGN-PERMISSION. The app's
// built APK (CI job 107298933655's V5 print) exports three components: the
// launcher, ProfileInstallReceiver on android.permission.DUMP, and
// com.amazon.device.iap.ResponseReceiver on
// com.amazon.inapp.purchasing.Permission.NOTIFY, which RevenueCat's Amazon
// module brings in and the app never declares. The merged manifest does declare
// one permission of its own, androidx.core's
// DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION, at signature
// (store/android-play/data-safety.json). Levels are written as aapt2 writes a
// flag: TYPE_INT_HEX, `{ hex: n }`.
const DYNAMIC_PERM = 'com.example.demo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION';
const declarePermission = (name, level) => el('permission', [A('name', name), A('protectionLevel', level)]);
const amazonReceiver = () =>
  el('receiver', [A('name', 'com.amazon.device.iap.ResponseReceiver'), A('exported', true), A('permission', 'com.amazon.inapp.purchasing.Permission.NOTIFY')], [
    el('intent-filter', [], [el('action', [A('name', 'com.amazon.inapp.purchasing.NOTIFY')])]),
  ]);
function realShape({ amazon = true } = {}) {
  return baseManifest({
    extraComponents: amazon ? [amazonReceiver()] : [],
    manifestExtras: [declarePermission(DYNAMIC_PERM, { hex: 0x2 }), el('uses-permission', [A('name', DYNAMIC_PERM)])],
  });
}
// One receiver on a plugin's own permission, declared at `level` (or not at all).
const guardedReceiver = (level) =>
  baseManifest({
    extraComponents: [el('receiver', [A('name', 'io.plugin.GuardedReceiver'), A('exported', true), A('permission', 'io.plugin.permission.GUARD')])],
    manifestExtras: level === undefined ? [] : [declarePermission('io.plugin.permission.GUARD', level)],
  });
const failLines = (out) => out.split('\n').filter((l) => l.startsWith('FAIL '));

const GOOD_KT = 'package com.example.demo\n\nimport io.flutter.embedding.android.FlutterActivity\n\nclass MainActivity : FlutterActivity()\n';
const GOOD_ANALYSIS = 'analyzer:\n  errors:\n    avoid_print: error\n';

function fixture({ manifest = baseManifest(), axmlOpts, entries, kotlin = GOOD_KT, analysis = GOOD_ANALYSIS, dart = '', generated = null, git = true } = {}) {
  const dir = join(TMP, `r${seq++}`);
  const kt = join(dir, 'apps', 'demo', 'android', 'app', 'src', 'main', 'kotlin', 'com', 'example', 'demo');
  mkdirSync(kt, { recursive: true });
  if (kotlin !== null) writeFileSync(join(kt, 'MainActivity.kt'), kotlin);
  mkdirSync(join(dir, 'packages', 'analysis', 'lib'), { recursive: true });
  if (analysis !== null) writeFileSync(join(dir, 'packages', 'analysis', 'lib', 'analysis_options.yaml'), analysis);
  mkdirSync(join(dir, 'apps', 'demo', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'apps', 'demo', 'lib', 'main.dart'), dart);
  const files = entries ?? [
    { name: 'AndroidManifest.xml', data: axml(manifest, axmlOpts) },
    { name: 'classes.dex', data: Buffer.from('dex\n035\0') },
  ];
  writeFileSync(join(dir, 'app-release.apk'), zip(files));
  // ⏱ 2026-09-15 · V6 grades TRACKED files: the fixture is a git work tree and the
  // app sources are staged. `generated` is written AFTER staging, untracked — the
  // shape `flutter build` leaves GeneratedPluginRegistrant.java in.
  if (git) {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['add', 'apps'], { cwd: dir });
  }
  if (generated !== null) {
    const gen = join(dir, 'apps', 'demo', 'android', 'app', 'src', 'main', 'java', 'io', 'flutter', 'plugins');
    mkdirSync(gen, { recursive: true });
    writeFileSync(join(gen, 'GeneratedPluginRegistrant.java'), generated);
  }
  return dir;
}

const run = (dir, args = ['app-release.apk', '--app', 'demo']) => {
  const r = spawnSync(process.execPath, [GUARD, ...args, '--repo-root', dir], { cwd: dir, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  const died = r.error || r.signal ? `\n[android-vapt-manifest.test] guard did not finish — status ${r.status} · signal ${r.signal}` : '';
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${died}` };
};

describe('assert-android-vapt-manifest', () => {
  // ── green controls ────────────────────────────────────────────────────────
  test('passes the base manifest, and names what it read', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /package com\.example\.demo · targetSdkVersion 36/);
    assert.match(out, /exported: activity com\.example\.demo\.MainActivity — launcher entry point/);
    assert.match(out, /exported: receiver androidx\.profileinstaller\.ProfileInstallReceiver — permission android\.permission\.DUMP/);
    assert.match(out, /OK — V1 debuggable, V2 allowBackup, V3 cleartext, V4 secrets \(\d+ value\(s\)\), V5 exported \(2 exported/);
  });

  test('a UTF-8 string pool decodes to the same verdict', () => {
    const { code, out } = run(fixture({ axmlOpts: { utf8: true } }));
    assert.equal(code, 0, out);
    assert.match(out, /launcher entry point/);
  });

  test('debugPrint call sites are counted and printed, never failed', () => {
    const { code, out } = run(fixture({ dart: "void f() { debugPrint('a'); debugPrint('b'); }\n" }));
    assert.equal(code, 0, out);
    assert.match(out, /2 debugPrint\( call site\(s\)/);
  });

  // ── one mutation per item ─────────────────────────────────────────────────
  test('V1: android:debuggable="true" fails', () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ app: { debuggable: true } }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V1 debuggable/);
  });

  test('V2: an ABSENT allowBackup fails, because Android reads absent as true', () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ app: { allowBackup: undefined } }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V2 allowBackup — .* is ABSENT, which Android reads as TRUE/);
  });

  test('V2: allowBackup="true" fails', () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ app: { allowBackup: true } }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V2 allowBackup — .* is true/);
  });

  test('V2: the attribute is still found when its NAME is stripped and only the resource map identifies it', () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ app: { allowBackup: true } }), axmlOpts: { garbleNames: true } }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V2 allowBackup/);
  });

  test('V3: usesCleartextTraffic="true" fails', () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ app: { usesCleartextTraffic: true } }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V3 cleartext — <application android:usesCleartextTraffic="true">/);
  });

  test('V3: an absent usesCleartextTraffic fails below targetSdk 28 and passes at 28', () => {
    const low = run(fixture({ manifest: baseManifest({ targetSdk: 27 }) }));
    assert.equal(low.code, 1, low.out);
    assert.match(low.out, /FAIL V3 cleartext — usesCleartextTraffic is absent and targetSdkVersion is 27/);
    const at = run(fixture({ manifest: baseManifest({ targetSdk: 28 }) }));
    assert.equal(at.code, 0, at.out);
  });

  test('V4: a Google API key in a meta-data value fails', () => {
    const md = el('meta-data', [A('name', 'com.google.android.geo.MAPS'), A('value', `AIza${'b'.repeat(35)}`)]);
    const { code, out } = run(fixture({ manifest: baseManifest({ extraComponents: [md] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V4 secrets — <meta-data android:value> has the shape of a Google API key/);
  });

  test('V4: a credential-NAMED meta-data with a literal value fails even without a known shape', () => {
    const md = el('meta-data', [A('name', 'io.vendor.CLIENT_SECRET'), A('value', 'x9f7q2m4k8w1z3v6')]);
    const { code, out } = run(fixture({ manifest: baseManifest({ extraComponents: [md] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V4 secrets — <meta-data android:name="io\.vendor\.CLIENT_SECRET"> carries a literal 16-character value/);
  });

  test('V5: an exported receiver with no permission fails', () => {
    const rc = el('receiver', [A('name', 'io.plugin.OpenReceiver'), A('exported', true)]);
    const { code, out } = run(fixture({ manifest: baseManifest({ extraComponents: [rc] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V5 exported — <receiver android:name="io\.plugin\.OpenReceiver"> is exported with no protecting permission/);
  });

  test('V5: a service exported IMPLICITLY by its intent-filter fails', () => {
    const svc = el('service', [A('name', 'io.plugin.Svc')], [el('intent-filter', [], [el('action', [A('name', 'io.plugin.BIND')])])]);
    const { code, out } = run(fixture({ manifest: baseManifest({ targetSdk: 30, app: { usesCleartextTraffic: false }, extraComponents: [svc] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V5 exported — <service android:name="io\.plugin\.Svc"> is exported \(implicitly, by its intent-filter\)/);
  });

  test('V5: the launcher activity loses its exemption once it also takes a deep link', () => {
    const deepLink = el('intent-filter', [], [
      el('action', [A('name', 'android.intent.action.VIEW')]),
      el('category', [A('name', 'android.intent.category.BROWSABLE')]),
      el('data', [A('scheme', 'demo')]),
    ]);
    const { code, out } = run(fixture({ manifest: baseManifest({ activityFilters: [launcherFilter(), deepLink] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V5 exported — <activity android:name="com\.example\.demo\.MainActivity">/);
  });

  // ⏱ 2026-09-23 · the ONE recorded deep link: this app's auth callback, exact.
  const authFilter = ({ datas = [el('data', [A('scheme', 'com.nikatru.demo'), A('host', 'auth-callback')])], cats = ['DEFAULT', 'BROWSABLE'], action = 'VIEW' } = {}) =>
    el('intent-filter', [], [
      el('action', [A('name', `android.intent.action.${action}`)]),
      ...cats.map((c) => el('category', [A('name', `android.intent.category.${c}`)])),
      ...datas,
    ]);

  test('V5: the launcher keeps its exemption with the exact auth callback beside it, and names it', () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ activityFilters: [launcherFilter(), authFilter()] }) }));
    assert.equal(code, 0, out);
    assert.match(out, /exported: activity com\.example\.demo\.MainActivity — launcher entry point \+ auth callback com\.nikatru\.demo:\/\/auth-callback/);
  });

  test('V5: the auth callback split over two <data> elements is still exact, and passes', () => {
    const datas = [el('data', [A('scheme', 'com.nikatru.demo')]), el('data', [A('host', 'auth-callback')])];
    const { code, out } = run(fixture({ manifest: baseManifest({ activityFilters: [launcherFilter(), authFilter({ datas })] }) }));
    assert.equal(code, 0, out);
  });

  // Each near-miss is its own `test(` (assert-no-loop-cases): a row deleted from
  // a loop would delete a case coverage-manifest.json cannot see.
  const notTheRecordedOne = (opts) => () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ activityFilters: [launcherFilter(), authFilter(opts)] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V5 exported — <activity android:name="com\.example\.demo\.MainActivity">/);
  };

  test('V5: an auth-callback filter with another app\'s scheme is NOT the recorded one, and fails',
    notTheRecordedOne({ datas: [el('data', [A('scheme', 'com.nikatru.other'), A('host', 'auth-callback')])] }));

  test('V5: an auth-callback filter with another host is NOT the recorded one, and fails',
    notTheRecordedOne({ datas: [el('data', [A('scheme', 'com.nikatru.demo'), A('host', 'anything')])] }));

  test('V5: an auth-callback filter with no host at all (any host would match) is NOT the recorded one, and fails',
    notTheRecordedOne({ datas: [el('data', [A('scheme', 'com.nikatru.demo')])] }));

  test('V5: an auth-callback filter with an https scheme riding beside it (schemes combine) is NOT the recorded one, and fails',
    notTheRecordedOne({ datas: [el('data', [A('scheme', 'com.nikatru.demo'), A('host', 'auth-callback')]), el('data', [A('scheme', 'https')])] }));

  test('V5: an auth-callback filter with a path pattern on it is NOT the recorded one, and fails',
    notTheRecordedOne({ datas: [el('data', [A('scheme', 'com.nikatru.demo'), A('host', 'auth-callback'), A('pathPattern', '.*')])] }));

  test('V5: an auth-callback filter with another action (SEND for VIEW) is NOT the recorded one, and fails',
    notTheRecordedOne({ action: 'SEND' }));

  test('V5: an auth-callback filter with no BROWSABLE category is NOT the recorded one, and fails',
    notTheRecordedOne({ cats: ['DEFAULT'] }));

  test('V5: the exact auth callback on an activity WITHOUT the launcher filter fails — it rides the launcher exemption, it is not one', () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ activityFilters: [authFilter()] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V5 exported — <activity android:name="com\.example\.demo\.MainActivity">/);
  });

  // ⏱ 2026-09-23 · a.R and a.W are DECLARED at signature here: since
  // O-VAPT-V5-FOREIGN-PERMISSION an undeclared one is foreign (F7 below).
  test('V5: an exported provider protected by read AND write permissions passes', () => {
    const pv = el('provider', [A('name', 'io.plugin.Prov'), A('exported', true), A('readPermission', 'a.R'), A('writePermission', 'a.W')]);
    const manifestExtras = [declarePermission('a.R', { hex: 0x2 }), declarePermission('a.W', { hex: 0x2 })];
    const { code, out } = run(fixture({ manifest: baseManifest({ extraComponents: [pv], manifestExtras }) }));
    assert.equal(code, 0, out);
    assert.match(out, /exported: provider io\.plugin\.Prov — read \+ write permissions/);
  });

  // ── V5, the permission CLASS (row O-VAPT-V5-FOREIGN-PERMISSION) ───────────
  test('V5 F1: the real shape fails on the Amazon receiver, guarded by a permission the app never declares', () => {
    const { code, out } = run(fixture({ manifest: realShape() }));
    assert.equal(code, 1, out);
    assert.match(out, /exported: receiver com\.amazon\.device\.iap\.ResponseReceiver — permission com\.amazon\.inapp\.purchasing\.Permission\.NOTIFY \(FOREIGN: not declared by this app\)/);
    assert.match(out, /FAIL V5 exported — <receiver android:name="com\.amazon\.device\.iap\.ResponseReceiver"> is exported and guarded only by com\.amazon\.inapp\.purchasing\.Permission\.NOTIFY \(its android:permission\), which is FOREIGN: not declared by this app\./);
    assert.match(out, /remove the component from the merged manifest with tools:node="remove"/);
    assert.equal(failLines(out).length, 1, out);
  });

  test('V5 F2: the real shape with the Amazon receiver removed passes, and the DUMP receiver reads as platform', () => {
    const { code, out } = run(fixture({ manifest: realShape({ amazon: false }) }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ResponseReceiver/);
    assert.match(out, /exported: receiver androidx\.profileinstaller\.ProfileInstallReceiver — permission android\.permission\.DUMP \(platform\)/);
    assert.match(out, /V5 exported \(2 exported/);
  });

  test('V5 F3: a receiver on a permission the app declares at signature (0x2, as aapt2 writes it) passes', () => {
    const { code, out } = run(fixture({ manifest: guardedReceiver({ hex: 0x2 }) }));
    assert.equal(code, 0, out);
    assert.match(out, /exported: receiver io\.plugin\.GuardedReceiver — permission io\.plugin\.permission\.GUARD \(declared signature\)/);
  });

  test('V5 F4: the same permission declared at protectionLevel normal (0x0) is foreign, and fails', () => {
    const { code, out } = run(fixture({ manifest: guardedReceiver({ hex: 0x0 }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V5 exported — <receiver android:name="io\.plugin\.GuardedReceiver"> is exported and guarded only by io\.plugin\.permission\.GUARD \(its android:permission\), which is FOREIGN: declared at protectionLevel normal\./);
  });

  test('V5 F5: signature|privileged (0x12) keeps base level signature, and passes', () => {
    const { code, out } = run(fixture({ manifest: guardedReceiver({ hex: 0x12 }) }));
    assert.equal(code, 0, out);
    assert.match(out, /exported: receiver io\.plugin\.GuardedReceiver — permission io\.plugin\.permission\.GUARD \(declared signature\)/);
  });

  test('V5 F6: a foreign <application android:permission> fallback is judged too, and fails the component that leans on it', () => {
    const svc = el('service', [A('name', 'io.plugin.Svc'), A('exported', true)]);
    const { code, out } = run(fixture({ manifest: baseManifest({ app: { permission: 'io.vendor.permission.APP_GUARD' }, extraComponents: [svc] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V5 exported — <service android:name="io\.plugin\.Svc"> is exported and guarded only by io\.vendor\.permission\.APP_GUARD \(its <application android:permission> fallback\), which is FOREIGN: not declared by this app\./);
  });

  test('V5 F7: a provider with a signature read permission and an undeclared write permission fails on the write', () => {
    const pv = el('provider', [A('name', 'io.plugin.Prov'), A('exported', true), A('readPermission', 'io.plugin.permission.READ'), A('writePermission', 'io.plugin.permission.WRITE')]);
    const { code, out } = run(fixture({ manifest: baseManifest({ extraComponents: [pv], manifestExtras: [declarePermission('io.plugin.permission.READ', { hex: 0x2 })] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /exported: provider io\.plugin\.Prov — read \+ write permissions — read io\.plugin\.permission\.READ \(declared signature\), write io\.plugin\.permission\.WRITE \(FOREIGN: not declared by this app\)/);
    assert.match(out, /FAIL V5 exported — <provider android:name="io\.plugin\.Prov"> is exported and guarded only by io\.plugin\.permission\.WRITE \(its android:writePermission\), which is FOREIGN: not declared by this app\./);
    assert.equal(failLines(out).length, 1, out);
  });

  test('V6: avoid_print demoted below error fails', () => {
    const { code, out } = run(fixture({ analysis: 'analyzer:\n  errors:\n    avoid_print: warning\n' }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V6 logging — packages\/analysis\/lib\/analysis_options\.yaml no longer raises avoid_print/);
  });

  test('V6: a Log.d in the app\'s own Kotlin fails, naming the line; a commented one does not', () => {
    const kt = `${GOOD_KT}// Log.d("x", "commented out")\nfun f(token: String) { android.util.Log.d("auth", token) }\n`;
    const { code, out } = run(fixture({ kotlin: kt }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V6 logging — apps\/demo\/android\/app\/src\/main\/kotlin\/com\/example\/demo\/MainActivity\.kt:7 writes to the device log/);
    assert.doesNotMatch(out, /MainActivity\.kt:6/);
  });

  test('V6: an UNTRACKED GeneratedPluginRegistrant.java with Log.e is NOT graded, and is printed', () => {
    const gen = 'package io.flutter.plugins;\nclass GeneratedPluginRegistrant {\n  void r() { Log.e(TAG, "Error registering plugin app_links"); }\n}\n';
    const { code, out } = run(fixture({ generated: gen }));
    assert.equal(code, 0, out);
    assert.match(out, /V6 not graded, UNTRACKED: apps\/demo\/android\/app\/src\/main\/java\/io\/flutter\/plugins\/GeneratedPluginRegistrant\.java/);
  });

  test('V6: the SAME Log.e in a TRACKED file still fails — tracking, not the path, decides', () => {
    const kt = `${GOOD_KT}fun r() { Log.e("TAG", "Error registering plugin") }\n`;
    const { code, out } = run(fixture({ kotlin: kt, generated: 'class GeneratedPluginRegistrant {}\n' }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL V6 logging — apps\/demo\/android\/app\/src\/main\/kotlin\/com\/example\/demo\/MainActivity\.kt:6 writes to the device log/);
  });

  // ── refusals: "I could not look" never reads as a verdict ─────────────────
  test('V6 outside a git work tree is COVERAGE LOST: it cannot tell app code from generated code', () => {
    const { code, out } = run(fixture({ git: false }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — git ls-files could not list the tracked native sources/);
  });

  test('only an untracked native file (none tracked) is COVERAGE LOST, not a pass', () => {
    const { code, out } = run(fixture({ kotlin: null, generated: 'class GeneratedPluginRegistrant {}\n' }));
    assert.equal(code, 2, out);
    assert.match(out, /holds no TRACKED \.kt or \.java file \(1 on disk\)/);
  });

  test('no artifact argument is COVERAGE LOST', () => {
    const { code, out } = run(fixture(), ['--app', 'demo']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — expected exactly ONE \.apk/);
  });

  test('a missing --app is COVERAGE LOST', () => {
    const { code, out } = run(fixture(), ['app-release.apk']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — --app must name the app directory/);
  });

  test('a missing .apk is COVERAGE LOST', () => {
    const { code, out } = run(fixture(), ['nope.apk', '--app', 'demo']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — nope\.apk does not exist/);
  });

  test('an archive with no AndroidManifest.xml (an .aab shape) is COVERAGE LOST', () => {
    const dir = fixture({ entries: [{ name: 'base/manifest/AndroidManifest.xml', data: Buffer.from('proto') }] });
    const { code, out } = run(dir);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — app-release\.apk has no top-level AndroidManifest\.xml/);
  });

  test('a plain-text manifest is COVERAGE LOST, not a parse of nothing', () => {
    const dir = fixture({ entries: [{ name: 'AndroidManifest.xml', data: Buffer.from('<manifest/>') }] });
    const { code, out } = run(dir);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*is not binary AXML/);
  });

  test('a truncated manifest is COVERAGE LOST', () => {
    const full = axml(baseManifest());
    const cut = Buffer.from(full.subarray(0, full.length - 60));
    cut.writeUInt32LE(cut.length, 4);
    const { code, out } = run(fixture({ entries: [{ name: 'AndroidManifest.xml', data: cut }] }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('a networkSecurityConfig is COVERAGE LOST: the cleartext policy moved where this guard does not read', () => {
    const { code, out } = run(fixture({ manifest: baseManifest({ app: { networkSecurityConfig: { ref: 0x7f120000 } } }) }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*networkSecurityConfig/);
  });

  test('an app with no native source is COVERAGE LOST: --app named the wrong directory', () => {
    const { code, out } = run(fixture({ kotlin: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — apps\/demo\/android\/app\/src\/main holds no TRACKED \.kt or \.java file/);
  });

  test('a missing analyzer config is COVERAGE LOST', () => {
    const { code, out } = run(fixture({ analysis: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — packages\/analysis\/lib\/analysis_options\.yaml does not exist/);
  });
});

// ── C1 / C2 ──────────────────────────────────────────────────────────────────
// ⏱ 2026-09-23 · Row O-VAPT-V5-FOREIGN-PERMISSION. An app manifest removes
// com.amazon.device.iap.ResponseReceiver from the merged manifest with
// tools:node="remove", because V5 fails it (F1): it is exported and guarded only
// by com.amazon.inapp.purchasing.Permission.NOTIFY, which no app here declares.
// That removal is right ONLY while no purchase rail sells through Amazon. So the
// removal and the register are read together: a manifest that removes the
// receiver beside a register whose purchaseRails.rails names an Amazon rail is
// red, and the message names the revert. C1 reads the real tree; C2 adds an
// `amazon-appstore` rail to a temp COPY of the real register (the real register
// is never edited) and must turn red.
const REPO = resolve(CI_DIR, '..', '..');
const AMAZON_RECEIVER = 'com.amazon.device.iap.ResponseReceiver';

function removesAmazonReceiver(xml) {
  const live = xml.replace(/<!--[\s\S]*?-->/g, '');
  return [...live.matchAll(/<receiver\b[^>]*>/g)].some(
    ([tag]) => tag.includes(`android:name="${AMAZON_RECEIVER}"`) && /\btools:node="remove"/.test(tag),
  );
}

function amazonCoupling(root) {
  const removers = readdirSync(join(root, 'apps'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `apps/${d.name}/android/app/src/main/AndroidManifest.xml`)
    .filter((rel) => existsSync(join(root, rel)) && removesAmazonReceiver(readFileSync(join(root, rel), 'utf8')));
  const register = JSON.parse(readFileSync(join(root, 'tooling', 'channel-register.json'), 'utf8'));
  const rails = register.purchaseRails?.rails;
  if (rails === null || typeof rails !== 'object') {
    return { removers, problems: ['tooling/channel-register.json has no purchaseRails.rails object, so the Amazon coupling cannot be judged'] };
  }
  const amazonRails = Object.keys(rails).filter((r) => /amazon/i.test(r));
  const problems = amazonRails.length === 0
    ? []
    : removers.map(
      (rel) => `${rel} removes ${AMAZON_RECEIVER} with tools:node="remove", and tooling/channel-register.json purchaseRails.rails declares ${amazonRails.join(', ')}: ` +
        'an Amazon rail is declared, so the Amazon IAP receiver must come back; delete the tools:node=remove line and protect it by other means',
    );
  return { removers, problems };
}

describe('the Amazon IAP receiver removal is coupled to the purchase rails', () => {
  test('C1: no app removes the Amazon IAP receiver while the register declares an Amazon rail', () => {
    const { problems } = amazonCoupling(REPO);
    assert.deepEqual(problems, []);
  });

  test('C2: an amazon-appstore rail in a copy of the register turns the removal red, and names the revert', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nikatru-vapt-c2-'));
    try {
      mkdirSync(join(tmp, 'tooling'), { recursive: true });
      const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
      writeFileSync(join(tmp, 'tooling', 'channel-register.json'), JSON.stringify(register));
      const rel = 'apps/demo/android/app/src/main/AndroidManifest.xml';
      mkdirSync(join(tmp, 'apps', 'demo', 'android', 'app', 'src', 'main'), { recursive: true });
      writeFileSync(
        join(tmp, rel),
        `<manifest xmlns:android="${ANDROID_NS}" xmlns:tools="http://schemas.android.com/tools">\n` +
          '  <application>\n' +
          `    <receiver android:name="${AMAZON_RECEIVER}" tools:node="remove" />\n` +
          '  </application>\n</manifest>\n',
      );

      const control = amazonCoupling(tmp);
      assert.deepEqual(control.removers, [rel]);
      assert.deepEqual(control.problems, [], 'the unchanged copy of the register declares no Amazon rail');

      register.purchaseRails.rails['amazon-appstore'] = 'C2 fixture: an Amazon Appstore rail';
      writeFileSync(join(tmp, 'tooling', 'channel-register.json'), JSON.stringify(register));
      const { problems } = amazonCoupling(tmp);
      assert.equal(problems.length, 1, problems.join('\n'));
      assert.match(problems[0], /^apps\/demo\/android\/app\/src\/main\/AndroidManifest\.xml removes com\.amazon\.device\.iap\.ResponseReceiver/);
      assert.match(problems[0], /purchaseRails\.rails declares amazon-appstore/);
      assert.match(problems[0], /an Amazon rail is declared, so the Amazon IAP receiver must come back; delete the tools:node=remove line and protect it by other means/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
