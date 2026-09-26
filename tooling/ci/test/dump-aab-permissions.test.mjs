// ─────────────────────────────────────────────────────────────────────────────
// dump-aab-permissions.test.mjs — dump-aab-permissions.mjs must read the same
// set out of an .aab's protobuf manifest and an .apk's AXML manifest, must FAIL
// when the two disagree, and must refuse rather than write a set it did not read.
//
// Register row O-PLAY-DATA-SAFETY-FROM-A-STALE-RUN. Red controls RC5 (the two
// artefacts differ by one permission: exit 1) and RC6 (an .aab without its
// manifest entry: exit 2) are cases below.
//
// ⚠️ THE FIXTURES ARE REAL BYTES, written by the encoders in THIS file, which
// share no code with the dumper's decoders: a protobuf XmlNode the way aapt2
// serializes one (with the SourcePosition and resource_id fields a decoder has
// to skip), a binary AXML manifest, and a zip around each. A fixture built by
// the dumper's own helpers would prove only that the helpers agree with
// themselves.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { zipEntries, decodeAxml } from '../android-zip.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DUMPER = join(CI_DIR, 'dump-aab-permissions.mjs');
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const TOOLS_NS = 'http://schemas.android.com/tools';

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-aabperm-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const el = (tag, attrs = [], children = []) => ({ tag, attrs, children });
const android = (name, value) => ({ ns: ANDROID_NS, name, value });
const tools = (name, value) => ({ ns: TOOLS_NS, name, value });
const plain = (name, value) => ({ ns: '', name, value });
const uses = (name) => el('uses-permission', [android('name', name)]);

// ── protobuf writer (aapt2 Resources.proto: XmlNode / XmlElement / XmlAttribute) ──
function varint(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}
const lenField = (field, body) => Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
const strField = (field, s) => lenField(field, Buffer.from(s, 'utf8'));
const intField = (field, n) => Buffer.concat([varint(field * 8), varint(n)]);
// SourcePosition { line_number = 1; column_number = 2 } — present on every aapt2 node.
const source = (line) => Buffer.concat([intField(1, line), intField(2, 5)]);

function protoAttribute(a) {
  return Buffer.concat([
    a.ns ? strField(1, a.ns) : Buffer.alloc(0),
    strField(2, a.name),
    strField(3, a.value),
    lenField(4, source(3)),
    a.ns === ANDROID_NS && a.name === 'name' ? intField(5, 0x01010003) : Buffer.alloc(0),
  ]);
}
function protoNode(n, line = 1) {
  const element = Buffer.concat([
    n.tag === 'manifest' ? lenField(1, Buffer.concat([strField(1, 'android'), strField(2, ANDROID_NS)])) : Buffer.alloc(0),
    strField(3, n.tag),
    ...n.attrs.map((a) => lenField(4, protoAttribute(a))),
    ...n.children.map((c, i) => lenField(5, protoNode(c, line + i + 1))),
  ]);
  return Buffer.concat([lenField(1, element), lenField(3, source(line))]);
}

// ── binary AXML writer (string attributes only; that is all a permission carries) ──
function chunk(type, headerSize, body) {
  const h = Buffer.alloc(8);
  h.writeUInt16LE(type, 0);
  h.writeUInt16LE(headerSize, 2);
  h.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([h, body]);
}
function axml(doc) {
  const pool = [ANDROID_NS, 'android', TOOLS_NS, 'tools'];
  const add = (s) => { if (!pool.includes(s)) pool.push(s); };
  const visit = (n) => {
    add(n.tag);
    for (const a of n.attrs) { add(a.name); add(a.value); }
    n.children.forEach(visit);
  };
  visit(doc);
  const idx = (s) => pool.indexOf(s);
  const encoded = pool.map((s) => {
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
  spHead.writeUInt32LE(28 + offsets.length, 12);
  const parts = [chunk(0x0001, 28, Buffer.concat([spHead, offsets, data]))];
  const emit = (n) => {
    const head = Buffer.alloc(28);
    head.writeUInt32LE(1, 0); head.writeInt32LE(-1, 4);
    head.writeInt32LE(-1, 8); head.writeUInt32LE(idx(n.tag), 12);
    head.writeUInt16LE(20, 16); head.writeUInt16LE(20, 18); head.writeUInt16LE(n.attrs.length, 20);
    const attrs = n.attrs.map((a) => {
      const b = Buffer.alloc(20);
      if (a.ns) b.writeUInt32LE(idx(a.ns), 0); else b.writeInt32LE(-1, 0);
      b.writeUInt32LE(idx(a.name), 4);
      b.writeUInt32LE(idx(a.value), 8);
      b.writeUInt16LE(8, 12); b[15] = 0x03; b.writeUInt32LE(idx(a.value), 16);
      return b;
    });
    parts.push(chunk(0x0102, 16, Buffer.concat([head, ...attrs])));
    n.children.forEach(emit);
    const end = Buffer.alloc(16);
    end.writeUInt32LE(1, 0); end.writeInt32LE(-1, 4); end.writeInt32LE(-1, 8); end.writeUInt32LE(idx(n.tag), 12);
    parts.push(chunk(0x0103, 16, end));
  };
  emit(doc);
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

// ── the manifests ───────────────────────────────────────────────────────────
// The real app's merged set as recorded on 2026-09-09, plus BILLING.
const manifest = (permissionElements) =>
  el('manifest', [plain('package', 'com.example.demo')], [
    el('uses-sdk', [android('minSdkVersion', '21')]),
    ...permissionElements,
    el('application', [android('name', 'android.app.Application')], [
      el('activity', [android('name', 'com.example.demo.MainActivity')]),
    ]),
  ]);
const realSet = () => [
  uses('android.permission.INTERNET'),
  uses('android.permission.VIBRATE'),
  uses('android.permission.POST_NOTIFICATIONS'),
  el('permission', [android('name', 'com.example.demo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'), android('protectionLevel', 'signature')]),
  uses('com.example.demo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'),
  uses('com.android.vending.BILLING'),
];

function writeAab(doc, { entry = 'base/manifest/AndroidManifest.xml', bytes } = {}) {
  const path = join(TMP, `app-${++seq}.aab`);
  writeFileSync(path, zip([
    { name: 'BundleConfig.pb', data: Buffer.from([0x0a, 0x00]) },
    { name: entry, data: bytes ?? protoNode(doc) },
    { name: 'base/dex/classes.dex', data: Buffer.from('dex\n035\0') },
  ]));
  return path;
}
function writeApk(doc) {
  const path = join(TMP, `app-${++seq}.apk`);
  writeFileSync(path, zip([
    { name: 'AndroidManifest.xml', data: axml(doc) },
    { name: 'classes.dex', data: Buffer.from('dex\n035\0') },
  ]));
  return path;
}
function run(args) {
  const r = spawnSync(process.execPath, [DUMPER, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const outPath = () => join(TMP, `dump-${++seq}.json`);

describe('dump-aab-permissions', () => {
  test('a good pair: both decoders read the same set, and the record carries it sorted with its provenance', () => {
    const out = outPath();
    const r = run(['--aab', writeAab(manifest(realSet())), '--apk', writeApk(manifest(realSet())), '--out', out,
      '--run-id', '1234567890', '--commit', 'abc1230000000000000000000000000000000000', '--artifact', 'demo-android-release-signed']);
    assert.equal(r.code, 0, r.err);
    const rec = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(rec.schema, 1);
    assert.equal(rec.runId, '1234567890');
    assert.equal(rec.commit, 'abc1230000000000000000000000000000000000');
    assert.equal(rec.artifact, 'demo-android-release-signed');
    assert.equal(rec.entry, 'base/manifest/AndroidManifest.xml');
    assert.equal(rec.method, 'dump-aab-permissions.mjs protobuf + apk AXML cross-check');
    assert.match(rec.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(rec.permissions, [
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE',
      'com.android.vending.BILLING',
      'com.example.demo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
    ]);
    assert.match(r.out, /5 permission\(s\), the \.aab protobuf and the \.apk AXML agree — run 1234567890/);
    assert.match(r.out, /^ {3}com\.android\.vending\.BILLING$/m);
  });

  test('without --run-id, --commit and --artifact the record says null rather than inventing them', () => {
    const out = outPath();
    const r = run(['--aab', writeAab(manifest(realSet())), '--apk', writeApk(manifest(realSet())), '--out', out]);
    assert.equal(r.code, 0, r.err);
    const rec = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(rec.runId, null);
    assert.equal(rec.commit, null);
    assert.equal(rec.artifact, null);
  });

  test('uses-permission-sdk-23 and a <permission> declaration are both read', () => {
    const out = outPath();
    const set = () => [
      uses('android.permission.INTERNET'),
      el('uses-permission-sdk-23', [android('name', 'android.permission.ACCESS_NETWORK_STATE')]),
      el('permission', [android('name', 'com.example.demo.OWN_SIGNATURE_PERMISSION')]),
    ];
    const r = run(['--aab', writeAab(manifest(set())), '--apk', writeApk(manifest(set())), '--out', out]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).permissions, [
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.INTERNET',
      'com.example.demo.OWN_SIGNATURE_PERMISSION',
    ]);
  });

  test('an element carrying tools:node="remove" is skipped by both decoders', () => {
    const out = outPath();
    const set = () => [
      uses('android.permission.INTERNET'),
      el('uses-permission', [android('name', 'com.android.vending.BILLING'), tools('node', 'remove')]),
    ];
    const r = run(['--aab', writeAab(manifest(set())), '--apk', writeApk(manifest(set())), '--out', out]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).permissions, ['android.permission.INTERNET']);
  });

  test('a uses-permission nested below <application> is not a permission request, and is not read', () => {
    const out = outPath();
    const nested = el('manifest', [plain('package', 'com.example.demo')], [
      uses('android.permission.INTERNET'),
      el('application', [], [uses('android.permission.CAMERA')]),
    ]);
    const r = run(['--aab', writeAab(nested), '--apk', writeApk(nested), '--out', out]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).permissions, ['android.permission.INTERNET']);
  });

  test('RC5: the .aab carries BILLING and the .apk does not — exit 1, named, and nothing written', () => {
    const out = outPath();
    const apkSet = [
      uses('android.permission.INTERNET'),
      uses('android.permission.VIBRATE'),
      uses('android.permission.POST_NOTIFICATIONS'),
      el('permission', [android('name', 'com.example.demo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')]),
      uses('com.example.demo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'),
    ];
    const r = run(['--aab', writeAab(manifest(realSet())), '--apk', writeApk(manifest(apkSet)), '--out', out]);
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /FAIL com\.android\.vending\.BILLING is in the \.aab .* and NOT in the \.apk/);
    assert.match(r.err, /Two decoders on two artefacts of one build disagree/);
    assert.equal(existsSync(out), false);
  });

  test('the .apk carrying one permission the .aab lacks fails the same way, from the other side', () => {
    const out = outPath();
    const aabSet = [uses('android.permission.INTERNET')];
    const apkSet = [uses('android.permission.INTERNET'), uses('android.permission.CAMERA')];
    const r = run(['--aab', writeAab(manifest(aabSet)), '--apk', writeApk(manifest(apkSet)), '--out', out]);
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /FAIL android\.permission\.CAMERA is in the \.apk .* and NOT in the \.aab/);
    assert.equal(existsSync(out), false);
  });

  test('RC6: an .aab without base/manifest/AndroidManifest.xml is COVERAGE LOST', () => {
    const out = outPath();
    const r = run(['--aab', writeAab(manifest(realSet()), { entry: 'base/manifest/Other.xml' }), '--apk', writeApk(manifest(realSet())), '--out', out]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /FAIL COVERAGE LOST — .*\.aab has no base\/manifest\/AndroidManifest\.xml entry/);
    assert.equal(existsSync(out), false);
  });

  test('zero permissions in both artefacts is COVERAGE LOST, not an empty record', () => {
    const out = outPath();
    const r = run(['--aab', writeAab(manifest([])), '--apk', writeApk(manifest([])), '--out', out]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /a decoder read ZERO permissions/);
    assert.equal(existsSync(out), false);
  });

  test('an .aab whose manifest entry is binary AXML (an .apk manifest in the wrong place) is refused, not parsed', () => {
    const out = outPath();
    const r = run(['--aab', writeAab(null, { bytes: axml(manifest(realSet())) }), '--apk', writeApk(manifest(realSet())), '--out', out]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /FAIL COVERAGE LOST — base\/manifest\/AndroidManifest\.xml: /);
  });

  test('a protobuf whose root element is not <manifest> is COVERAGE LOST', () => {
    const out = outPath();
    const r = run(['--aab', writeAab(el('application', [], [uses('android.permission.INTERNET')])), '--apk', writeApk(manifest(realSet())), '--out', out]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /decodes to <application>, not <manifest>/);
  });

  test('a truncated protobuf is COVERAGE LOST', () => {
    const out = outPath();
    const whole = protoNode(manifest(realSet()));
    const r = run(['--aab', writeAab(null, { bytes: whole.subarray(0, whole.length - 20) }), '--apk', writeApk(manifest(realSet())), '--out', out]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /FAIL COVERAGE LOST — base\/manifest\/AndroidManifest\.xml: /);
  });

  test('a permission element with no android:name is COVERAGE LOST: the set would silently lose it', () => {
    const out = outPath();
    const set = () => [uses('android.permission.INTERNET'), el('uses-permission', [plain('name', 'android.permission.CAMERA')])];
    const r = run(['--aab', writeAab(manifest(set())), '--apk', writeApk(manifest(realSet())), '--out', out]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /a <uses-permission> element carries no readable android:name/);
  });

  test('a missing .aab file is COVERAGE LOST', () => {
    const r = run(['--aab', join(TMP, 'absent.aab'), '--apk', writeApk(manifest(realSet())), '--out', outPath()]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /the \.aab .*absent\.aab does not exist/);
  });

  test('a missing --apk is COVERAGE LOST: the cross-check is not optional', () => {
    const r = run(['--aab', writeAab(manifest(realSet())), '--out', outPath()]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /--apk is required/);
  });

  test('an unknown argument is COVERAGE LOST, not ignored', () => {
    const r = run(['--aab', writeAab(manifest(realSet())), '--apk', writeApk(manifest(realSet())), '--out', outPath(), '--skip-apk', 'yes']);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /unknown argument "--skip-apk"/);
  });
});

// android-zip.mjs is shared by this dumper and assert-android-vapt-manifest.mjs.
// Its refusals are reached through both guards above; these call it directly, so
// a refusal that stopped calling the caller's `refuse` cannot hide behind a guard.
describe('android-zip.mjs, called directly', () => {
  test('green control: the entries of a real zip are listed by name', () => {
    const buf = zip([{ name: 'AndroidManifest.xml', data: Buffer.from('x') }, { name: 'classes.dex', data: Buffer.from('y') }]);
    const refused = [];
    const names = zipEntries(buf, 'fixture.apk', (lines) => refused.push(...lines)).map((e) => e.name);
    assert.deepEqual(names, ['AndroidManifest.xml', 'classes.dex']);
    assert.deepEqual(refused, []);
  });

  test('bytes with no end-of-central-directory record are refused through refuse, and the call throws when refuse returns', () => {
    const refused = [];
    assert.throws(() => zipEntries(Buffer.alloc(64), 'fixture.apk', (lines) => refused.push(...lines)), /end-of-central-directory/);
    assert.equal(refused.length, 1);
    assert.match(refused[0], /fixture\.apk has no zip end-of-central-directory record/);
  });

  test('a text manifest handed to the AXML decoder is refused, not parsed as an empty tree', () => {
    const refused = [];
    assert.throws(() => decodeAxml(Buffer.from('<manifest package="x"/>'), 'fixture.apk', (lines) => refused.push(...lines)), /not binary AXML/);
    assert.equal(refused.length, 1);
    assert.match(refused[0], /fixture\.apk: AndroidManifest\.xml is not binary AXML/);
  });
});
