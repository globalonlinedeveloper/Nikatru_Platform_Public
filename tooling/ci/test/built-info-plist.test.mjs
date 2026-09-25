// ─────────────────────────────────────────────────────────────────────────────
// built-info-plist.test.mjs — the recorded failing cases for
// assert-built-info-plist.mjs (O-APPLE-PLIST-KEYS-UNRENDERED, RC4).
//
// The expected values are the REAL repository's: every case runs the guard with
// --app subscriptiontracker against the real tree, so what it compares to is
// what render.mjs plans for apps/subscriptiontracker today. The bundles are the
// XML fixtures under fixtures/built-info-plist/, copied into a temp directory
// wherever a case changes one. A binary plist and an .ipa are built by the case
// that needs them.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { readPlistXml } from '../assert-built-info-plist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-built-info-plist.mjs');
const FIX = join(HERE, 'fixtures', 'built-info-plist');
const MAC_GOOD = join(FIX, 'macos-good', 'Fixture.app');
const MAC_MISSING = join(FIX, 'macos-missing-key', 'Fixture.app');
const IOS_GOOD = join(FIX, 'ios-good', 'Runner.app');
const APP = ['--app', 'subscriptiontracker'];

/* Never through a pipe: the exit code is read off spawnSync, on its own. */
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status === null ? 2 : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const scratch = () => mkdtempSync(join(tmpdir(), 'built-info-plist-'));
const kill = (dir) => rmSync(dir, { recursive: true, force: true });

/** A stored-or-deflated zip with a central directory: the shape `flutter build
 *  ipa` exports, and the shape unzip() in apple-signing.mjs reads. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = deflateRawSync(e.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(e.bytes), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(e.bytes), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(e.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('assert-built-info-plist — the built bundle carries the two keys app.yaml renders', () => {
  test('POSITIVE CONTROL — the macOS fixture .app carries both keys with the rendered values', () => {
    const { code, out } = run([...APP, MAC_GOOD]);
    assert.equal(code, 0, out);
    assert.match(out, /LSApplicationCategoryType = "public\.app-category\.productivity", as apps\/subscriptiontracker\/macos\/Runner\/Info\.plist renders it/);
    assert.match(out, /ITSAppUsesNonExemptEncryption = <false\/>, as apps\/subscriptiontracker\/macos\/Runner\/Info\.plist renders it/);
  });

  test('POSITIVE CONTROL — an iOS .app keeps its plist at the bundle root and is graded against the iOS rendering', () => {
    const { code, out } = run([...APP, IOS_GOOD]);
    assert.equal(code, 0, out);
    assert.match(out, /as apps\/subscriptiontracker\/ios\/Runner\/Info\.plist renders it/);
    assert.match(out, /ok — 2 rendered key\(s\) found/);
  });

  test('RC4 — the fixture .app with LSApplicationCategoryType missing is RED, naming the key and the rendered value', () => {
    const { code, out } = run([...APP, MAC_MISSING]);
    assert.equal(code, 1, out);
    assert.ok(out.includes('Contents/Info.plist has no LSApplicationCategoryType; apps/subscriptiontracker/macos/Runner/Info.plist renders "public.app-category.productivity"'), out);
  });

  test('a missing bundle is COVERAGE LOST, never a pass', () => {
    const { code, out } = run([...APP, join(FIX, 'no-such-build', 'Fixture.app')]);
    assert.equal(code, 2, out);
    assert.match(out, /no such bundle/);
  });

  test('a value the bundle changed is RED: <true/> where app.yaml renders <false/>', () => {
    const dir = scratch();
    try {
      const app = join(dir, 'Runner.app');
      cpSync(IOS_GOOD, app, { recursive: true });
      const plist = join(app, 'Info.plist');
      const text = readFileSync(plist, 'utf8');
      const flipped = text.replace('<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>', '<key>ITSAppUsesNonExemptEncryption</key>\n\t<true/>');
      assert.notEqual(flipped, text, 'fixture anchor');
      writeFileSync(plist, flipped);
      const { code, out } = run([...APP, app]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('Info.plist has ITSAppUsesNonExemptEncryption = <true/>; apps/subscriptiontracker/ios/Runner/Info.plist renders <false/>'), out);
    } finally { kill(dir); }
  });

  test('a key present only inside a nested dict is not the root key: RED', () => {
    const dir = scratch();
    try {
      const app = join(dir, 'Fixture.app');
      cpSync(MAC_MISSING, app, { recursive: true });
      const plist = join(app, 'Contents', 'Info.plist');
      const text = readFileSync(plist, 'utf8');
      const nested = text.replace(
        '\t\t\t<key>CFBundleURLSchemes</key>',
        '\t\t\t<key>LSApplicationCategoryType</key>\n\t\t\t<string>public.app-category.productivity</string>\n\t\t\t<key>CFBundleURLSchemes</key>',
      );
      assert.notEqual(nested, text, 'fixture anchor');
      writeFileSync(plist, nested);
      const { code, out } = run([...APP, app]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('has no LSApplicationCategoryType'), out);
    } finally { kill(dir); }
  });

  test('a root key carried twice is RED, whatever the two values are', () => {
    const dir = scratch();
    try {
      const app = join(dir, 'Fixture.app');
      cpSync(MAC_GOOD, app, { recursive: true });
      const plist = join(app, 'Contents', 'Info.plist');
      const text = readFileSync(plist, 'utf8');
      writeFileSync(plist, text.replace('</dict>\n</plist>', '\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n</dict>\n</plist>'));
      const { code, out } = run([...APP, app]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('carries ITSAppUsesNonExemptEncryption more than once'), out);
    } finally { kill(dir); }
  });

  test('RC4 — a binary plist on a machine with no plutil is COVERAGE LOST, never a pass', () => {
    const dir = scratch();
    try {
      const app = join(dir, 'Runner.app');
      cpSync(IOS_GOOD, app, { recursive: true });
      writeFileSync(join(app, 'Info.plist'), Buffer.concat([Buffer.from('bplist00', 'latin1'), Buffer.alloc(40, 0)]));
      const { code, out } = run([...APP, app], { ASSERT_BUILT_INFO_PLIST_PLUTIL: 'no-such-plutil-on-this-machine' });
      assert.equal(code, 2, out);
      assert.ok(out.includes('Info.plist is a binary plist and there is no plutil on this machine to read it'), out);
    } finally { kill(dir); }
  });

  test('an .ipa is read through its one Payload/*.app/Info.plist', () => {
    const dir = scratch();
    try {
      const ipa = join(dir, 'Runner.ipa');
      writeFileSync(ipa, makeZip([
        { name: 'Payload/Runner.app/Info.plist', bytes: readFileSync(join(IOS_GOOD, 'Info.plist')) },
        { name: 'Payload/Runner.app/Runner', bytes: Buffer.from('MACHO-BYTES') },
      ]));
      const { code, out } = run([...APP, ipa]);
      assert.equal(code, 0, out);
      assert.match(out, /Runner\.ipa: ITSAppUsesNonExemptEncryption = <false\/>, as apps\/subscriptiontracker\/ios\/Runner\/Info\.plist renders it/);
    } finally { kill(dir); }
  });

  test('an .ipa whose Info.plist lacks a key is RED', () => {
    const dir = scratch();
    try {
      const ipa = join(dir, 'Runner.ipa');
      const text = readFileSync(join(IOS_GOOD, 'Info.plist'), 'utf8');
      const cut = text.replace('\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n', '');
      assert.notEqual(cut, text, 'fixture anchor');
      writeFileSync(ipa, makeZip([{ name: 'Payload/Runner.app/Info.plist', bytes: Buffer.from(cut, 'utf8') }]));
      const { code, out } = run([...APP, ipa]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('Payload/Runner.app/Info.plist has no ITSAppUsesNonExemptEncryption'), out);
    } finally { kill(dir); }
  });

  test('an .ipa with no Payload/*.app/Info.plist is COVERAGE LOST', () => {
    const dir = scratch();
    try {
      const ipa = join(dir, 'Runner.ipa');
      writeFileSync(ipa, makeZip([{ name: 'Payload/Runner.app/Runner', bytes: Buffer.from('MACHO-BYTES') }]));
      const { code, out } = run([...APP, ipa]);
      assert.equal(code, 2, out);
      assert.match(out, /with 0 Payload\/\*\.app\/Info\.plist member/);
    } finally { kill(dir); }
  });

  test('no --app is COVERAGE LOST: the expected values belong to one app', () => {
    const { code, out } = run([MAC_GOOD]);
    assert.equal(code, 2, out);
    assert.match(out, /no --app <id>/);
  });

  test('an app the renderer does not plan is COVERAGE LOST', () => {
    const { code, out } = run(['--app', 'no-such-app', MAC_GOOD]);
    assert.equal(code, 2, out);
    assert.match(out, /there is no app "no-such-app"/);
  });

  test('readPlistXml reads the root dict only, decodes entities, and refuses a root that is not a dict', () => {
    const doc = readPlistXml('<plist version="1.0">\n<dict>\n\t<key>A</key>\n\t<string>x &amp; y</string>\n\t<key>B</key>\n\t<dict>\n\t\t<key>C</key>\n\t\t<true/>\n\t</dict>\n\t<key>D</key>\n\t<false/>\n</dict>\n</plist>\n');
    assert.deepEqual([...doc.root.entries()], [['A', 'x & y'], ['B', { element: 'dict' }], ['D', false]]);
    assert.deepEqual(doc.duplicates, []);
    assert.equal(readPlistXml('<plist version="1.0">\n<array>\n\t<string>A</string>\n</array>\n</plist>\n'), null);
  });
});
