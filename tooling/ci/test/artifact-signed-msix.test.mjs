// ─────────────────────────────────────────────────────────────────────────────
// artifact-signed-msix.test.mjs — assert-artifact-signed-msix.mjs must be able
// to FAIL, and must fail on the case that is unrecoverable in production.
//
// Pipeline requirement: Private/requirements/ → F-2.
//
// 🔴 THE GUARD UNDER TEST IS NOT "assert-artifact-signed, for Windows". It
// proves a signature is ABSENT and an identity MATCHES. `store: true` makes
// `msix` skip signing because the Store re-signs, so an absent
// AppxSignature.p7x is POSITIVE EVIDENCE that store mode took effect — and
// `store: false` silently re-introduces a test certificate nobody owns. A test
// that demanded a signature would fail every correct package this factory can
// currently produce.
//
// ⚠️ THE SENTINEL IS NOT A SKIP. All three identity fields are assigned by
// Partner Center (OWNER_QUEUE A-2) and carry PARTNER-CENTER-PENDING until it
// completes. The guard requires the package to carry EXACTLY what the register
// declares, sentinel included — a package built under a plausible INVENTED
// identity while the register still says PENDING is the unrecoverable case, and
// that is the mutation pinned below.
// ⏱ 2026-09-22 — the live register now carries the real identity; the fixtures
// below keep their own fake values on purpose, and the live-register case reads
// whatever the register declares.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  readIdentity, parseArgs, IDENTITY_FIELDS, MANIFEST_MEMBER, SIGNATURE_MEMBER, REGISTER_REL, CHANNEL_ID,
  readVisualIdentity, tileProblems, tileMembersFor, msixLogoPath, pinnedMsixVersion, MSIX_PLUGIN_DEFAULT_TILE_HASHES,
} from '../assert-artifact-signed-msix.mjs';
import { readDeclaration } from '../../app-yaml/render.mjs';

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assert-artifact-signed-msix.mjs');
/** The root the guard falls back to when no `--repo-root` is given — the CI shape. */
const REPO_ROOT = resolve(dirname(GUARD), '..', '..');
const SENTINEL = 'PARTNER-CENTER-PENDING';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-msix-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** A real zip, central directory and all — the same construction the apple
 *  signing suite uses, because the guard reads it with the same reader, and
 *  duplicated here for the same reason that one is: a fixture builder shared
 *  between suites is one more thing that can be wrong in both at once.
 *
 *  `{ zip64: true }` promotes it to the ZIP64 form MakeAppx writes for EVERY
 *  .msix regardless of size — EOCD64 record, its locator, and 0xFFFF/0xFFFFFFFF
 *  sentinels in the 32-bit records. That is the shape this guard was handed on
 *  build-platforms run 32814517717 and threw ERR_OUT_OF_RANGE on. */
function makeZip(entries, { zip64 = false } = {}) {
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.method ?? 0;
    const data = method === 8 ? deflateRawSync(e.bytes) : e.bytes;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(e.bytes), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.bytes.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(e.bytes), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(e.bytes.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    if (zip64) {
      // ZIP64 promotion of THIS entry. The sizes become sentinels and move into
      // the 0x0001 extra field; the local-header offset does too — EXCEPT for
      // the first member, which sits at 0 and therefore keeps its 32-bit field.
      // That asymmetry is not decoration: it is what a real writer emits, and it
      // is the case a reader gets wrong by taking the extra field's slots
      // positionally instead of conditionally.
      const offsetIsSentinel = offset !== 0;
      const localExtra = Buffer.alloc(20);
      localExtra.writeUInt16LE(0x0001, 0);
      localExtra.writeUInt16LE(16, 2);
      localExtra.writeBigUInt64LE(BigInt(e.bytes.length), 4);
      localExtra.writeBigUInt64LE(BigInt(data.length), 12);
      local.writeUInt32LE(0xffffffff, 18);
      local.writeUInt32LE(0xffffffff, 22);
      local.writeUInt16LE(localExtra.length, 28);
      const centralExtra = Buffer.alloc(offsetIsSentinel ? 28 : 20);
      centralExtra.writeUInt16LE(0x0001, 0);
      centralExtra.writeUInt16LE(offsetIsSentinel ? 24 : 16, 2);
      centralExtra.writeBigUInt64LE(BigInt(e.bytes.length), 4);
      centralExtra.writeBigUInt64LE(BigInt(data.length), 12);
      if (offsetIsSentinel) centralExtra.writeBigUInt64LE(BigInt(offset), 20);
      central.writeUInt32LE(0xffffffff, 20);
      central.writeUInt32LE(0xffffffff, 24);
      central.writeUInt16LE(centralExtra.length, 30);
      if (offsetIsSentinel) central.writeUInt32LE(0xffffffff, 42);
      locals.push(local, nameBuf, localExtra, data);
      centrals.push(central, nameBuf, centralExtra);
      offset += local.length + nameBuf.length + localExtra.length + data.length;
      continue;
    }
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const tail = [];
  if (zip64) {
    // The EOCD64 record carries the true count/size/offset; the locator says
    // where it is. MakeAppx writes both and then fills the 32-bit EOCD with
    // sentinels REGARDLESS OF SIZE, which is the shape that crashed the guard.
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE(45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(entries.length), 24);
    rec.writeBigUInt64LE(BigInt(entries.length), 32);
    rec.writeBigUInt64LE(BigInt(centralBuf.length), 40);
    rec.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + centralBuf.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(rec, locator);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(zip64 ? 0xffff : entries.length, 8);
  eocd.writeUInt16LE(zip64 ? 0xffff : entries.length, 10);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : centralBuf.length, 12);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...locals, centralBuf, ...tail, eocd]);
}

/** ⏱ 2026-09-25 (O-MSIX-IDENTITY-UNGRADED): the fixture package now carries
 *  what `msix` 3.18.0 writes after tooling/store/msix-visual-name.mjs — the
 *  Store title in Properties, the launcher label in VisualElements and
 *  DefaultTile, and three tile references. `visual: false` drops the
 *  Applications block. */
const TITLE = 'Nikatru Subscription Tracker';
const LABEL = 'Subscriptions';
const manifestXml = ({
  name = SENTINEL,
  publisher = `CN=${SENTINEL}`,
  displayName = SENTINEL,
  version = '1.0.3.0',
  title = TITLE,
  label = LABEL,
  tileShortName = label,
  visual = true,
} = {}) =>
  `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10">
  <Identity Name="${name}" Publisher="${publisher}" Version="${version}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${title}</DisplayName>
    <PublisherDisplayName>${displayName}</PublisherDisplayName>
    <Logo>Images\\StoreLogo.png</Logo>
  </Properties>
${visual ? `  <Applications>
    <Application Id="subscriptiontracker" Executable="subscriptiontracker.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements BackgroundColor="transparent"
        DisplayName="${label}" Square150x150Logo="Images\\Square150x150Logo.png"
        Square44x44Logo="Images\\Square44x44Logo.png" Description="${title}">
        <uap:DefaultTile ShortName="${tileShortName}" Square310x310Logo="Images\\LargeTile.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
` : ''}</Package>
`;

/** One file per tile reference above, in the resource-qualified form `msix`
 *  generates from a logo_path. Their bytes are not PNGs, so none can hash to
 *  a plugin default. */
const TILES = [
  { name: 'Images/StoreLogo.scale-100.png', bytes: Buffer.from('fixture tile: store logo'), method: 0 },
  { name: 'Images/Square150x150Logo.scale-100.png', bytes: Buffer.from('fixture tile: 150'), method: 0 },
  { name: 'Images/Square44x44Logo.scale-100.png', bytes: Buffer.from('fixture tile: 44'), method: 0 },
  { name: 'Images/Square44x44Logo.targetsize-16_altform-unplated.png', bytes: Buffer.from('fixture tile: 44 unplated'), method: 0 },
  { name: 'Images/LargeTile.scale-100.png', bytes: Buffer.from('fixture tile: large'), method: 0 },
];

const APP_YAML = `id: subscriptiontracker\nname: ${TITLE}\nshortName: ${LABEL}\n`;
const PUBSPEC = [
  'name: subscriptiontracker',
  'msix_config:',
  `  display_name: ${TITLE}`,
  '  store: true',
  '  logo_path: assets/icon/app_icon_1024.png',
  '',
].join('\n');
const LOCK = [
  'packages:',
  '  msix:',
  '    dependency: transitive',
  '    description:',
  '      name: msix',
  '      url: "https://pub.dev"',
  '    source: hosted',
  `    version: "${MSIX_PLUGIN_DEFAULT_TILE_HASHES.version}"`,
  '',
].join('\n');

const REGISTER = {
  channels: [
    {
      id: 'windows-store',
      storeMetadataDir: 'apps/{app}/store/windows-store',
      packageIdentity: {
        notYetConfiguredSentinel: SENTINEL,
        identityName: SENTINEL,
        publisher: `CN=${SENTINEL}`,
        publisherDisplayName: SENTINEL,
      },
    },
  ],
};

/** @param opts.members  zip members; default is a correct store-mode package.
 *  @param opts.zip64    write the package in the ZIP64 form MakeAppx actually
 *                       emits, which is what CI hands this guard. */
function fixture({
  register = REGISTER,
  members = null,
  raw = null,
  zip64 = false,
  title = `${TITLE}\n`,
  appYaml = APP_YAML,
  pubspec = PUBSPEC,
  lock = LOCK,
  logo = true,
} = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'pkg'), { recursive: true });
  if (register !== null) {
    writeFileSync(
      join(root, 'tooling', 'channel-register.json'),
      typeof register === 'string' ? register : JSON.stringify(register, null, 2),
    );
  }
  const app = join(root, 'apps', 'subscriptiontracker');
  mkdirSync(join(app, 'store', 'windows-store'), { recursive: true });
  if (title !== null) writeFileSync(join(app, 'store', 'windows-store', 'title.txt'), title);
  if (appYaml !== null) writeFileSync(join(app, 'app.yaml'), appYaml);
  if (pubspec !== null) writeFileSync(join(app, 'pubspec.yaml'), pubspec);
  if (lock !== null) writeFileSync(join(root, 'pubspec.lock'), lock);
  if (logo) {
    mkdirSync(join(app, 'assets', 'icon'), { recursive: true });
    writeFileSync(join(app, 'assets', 'icon', 'app_icon_1024.png'), 'fixture mark');
  }
  const entries = members ?? [
    { name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml(), 'utf8'), method: 8 },
    { name: 'subscriptiontracker.exe', bytes: Buffer.from('PE-BYTES'), method: 0 },
    ...TILES,
  ];
  writeFileSync(join(root, 'pkg', 'subscriptiontracker.msix'), raw ?? makeZip(entries, { zip64 }));
  return root;
}

/** A package whose manifest is `manifestXml(opts)` and which carries every tile. */
const withManifest = (opts) => [
  { name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml(opts), 'utf8'), method: 8 },
  ...TILES,
];

const run = (root, args = ['--app', 'subscriptiontracker', 'pkg/subscriptiontracker.msix']) => {
  const r = spawnSync(process.execPath, [GUARD, '--repo-root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/** 🔴 THE CI SHAPE, AND THE ONE NO TEST USED UNTIL 2026-08-24: argv with NO
 *  `--repo-root` at all. build-platforms.yml's "The MSIX carries the identity
 *  the register declares" invokes the guard with exactly one positional and no
 *  flags; every test above passes `--repo-root`, which is precisely the shape
 *  that hid ddb9efe's off-by-one for a week. */
const runBare = (...args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

// ── the reading ──────────────────────────────────────────────────────────────
describe('assert-artifact-signed-msix — reading the packaged identity', () => {
  test('all four values come out of a real manifest shape', () => {
    const id = readIdentity(manifestXml({ name: 'Nikatru.Subly', publisher: 'CN=Nikatru', displayName: 'Nikatru', version: '2.1.0.0' }));
    assert.deepEqual(id, { identityName: 'Nikatru.Subly', publisher: 'CN=Nikatru', version: '2.1.0.0', publisherDisplayName: 'Nikatru' });
  });

  // 🔴 A `Name=` ON SOME OTHER ELEMENT MUST NOT ANSWER FOR Identity. An
  // AppxManifest is full of them — Capability, Application, Resource.
  test('a Name= on another element is not read as the identity', () => {
    const xml = `<Package><Capability Name="internetClient" /><Identity Name="Real.Name" Publisher="CN=X" Version="1.0.0.0" /><Properties><PublisherDisplayName>D</PublisherDisplayName></Properties></Package>`;
    assert.equal(readIdentity(xml).identityName, 'Real.Name');
  });

  test('a manifest with no Identity element reads as null, not as empty strings', () => {
    assert.equal(readIdentity('<Package><Properties/></Package>'), null);
  });

  test('non-string input refuses', () => {
    for (const bad of [null, undefined, 42, {}]) assert.equal(readIdentity(bad), null);
  });
});

// ── the verdict ──────────────────────────────────────────────────────────────
describe('assert-artifact-signed-msix — the declaration is compared to the BYTES', () => {
  test('a correct store-mode package passes, and says what it proved', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}msix identity/);
    assert.match(out, new RegExp(`NO ${SIGNATURE_MEMBER}`));
    // The sentinel is reported, so a package that cannot be submitted never
    // reads as one that can.
    assert.match(out, /NOT-YET-CONFIGURED sentinel/);
    assert.match(out, /ok {2}msix face — the Store title "Nikatru Subscription Tracker", the launcher label "Subscriptions", 5 tile file\(s\)/);
  });

  // 🔴 THE RECORDED FAILING CASE E7 EXISTS FOR. A plausible invented identity,
  // while the register still declares the sentinel. This packages and submits
  // cleanly and is UNRECOVERABLE once published.
  test('a package built under an INVENTED identity FAILS, naming the field', () => {
    const root = fixture({
      members: [
        { name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml({ name: 'Nikatru.Subly' }), 'utf8'), method: 8 },
      ],
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /Package\/Identity\/@Name is "Nikatru\.Subly"/);
    assert.match(out, new RegExp(`declares "${SENTINEL}"`));
    assert.match(out, /unrecoverable rather than re-uploadable/);
  });

  test('a wrong Publisher fails, and the other two fields are not blamed', () => {
    const root = fixture({
      members: [{ name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml({ publisher: 'CN=SomebodyElse' }), 'utf8'), method: 8 }],
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /Package\/Identity\/@Publisher/);
    assert.doesNotMatch(out, /Package\/Identity\/@Name is/);
  });

  test('a wrong PublisherDisplayName fails', () => {
    const root = fixture({
      members: [{ name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml({ displayName: 'Someone Else Ltd' }), 'utf8'), method: 8 }],
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /Package\/Properties\/PublisherDisplayName/);
  });

  // 🔴 THE POSITIVE PROOF, INVERTED. A signature present means store mode did
  // NOT take effect — the `store: false` test certificate nobody owns.
  test('a package carrying AppxSignature.p7x FAILS — store mode did not take effect', () => {
    const root = fixture({
      members: [
        { name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml(), 'utf8'), method: 8 },
        { name: SIGNATURE_MEMBER, bytes: Buffer.from([0x30, 0x82, 0x01, 0x00]), method: 0 },
      ],
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`carries ${SIGNATURE_MEMBER}`));
    assert.match(out, /store: true/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PACKAGE CI ACTUALLY HANDS THIS GUARD IS ZIP64, AND EVERY TEST ABOVE
// BUILDS A ZIP THAT IS NOT
//
// 🔴 MEASURED on build-platforms run 32814517717 (2026-08-25): with PR #366's
// argv defect fixed, the Windows leg reached the real 16,585,912-byte .msix and
// the guard did not fail — it CRASHED, `RangeError [ERR_OUT_OF_RANGE] … Received
// 4294967295` out of unzip(). 4294967295 is 0xFFFFFFFF, the ZIP64 sentinel, in a
// package of 16.6 MB: an .msix is an OPC/APPX package and the packaging tool
// writes the ZIP64 records REGARDLESS OF SIZE. Five other platforms were green
// on that same run.
//
// ⚠️ SO THE SHAPE OF THE FIXTURE WAS THE HOLE. Every assertion above was true
// and none of them could reach production, because makeZip built the one form
// of zip the real packaging tool never produces. The block below re-asks the
// SAME questions of the SAME package written the way MakeAppx writes it, so a
// reader that opens the test form and not the real one is a failure here rather
// than a crash six weeks later.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-artifact-signed-msix — the ZIP64 package MakeAppx actually writes', () => {
  test('the fixture really is ZIP64 — the sentinel is read off the bytes, not assumed', () => {
    const root = fixture({ zip64: true });
    const raw = readFileSync(join(root, 'pkg', 'subscriptiontracker.msix'));
    const sig = (v) => Buffer.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
    assert.notEqual(raw.indexOf(sig(0x07064b50)), -1, 'EOCD64 locator 0x07064b50 must be present');
    assert.notEqual(raw.indexOf(sig(0x06064b50)), -1, 'EOCD64 record 0x06064b50 must be present');
    assert.equal(raw.readUInt32LE(raw.length - 22 + 16), 0xffffffff, 'the central-directory offset must be the sentinel');
    // The 32-bit-only reader read exactly this field and used it as an index.
    // Pristine, that is the crash; the next test is the same bytes passing.
  });

  test('a correct ZIP64 package PASSES — the crash is gone and the verdict is a verdict', () => {
    const { code, out } = run(fixture({ zip64: true }));
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}msix identity/);
    assert.match(out, /1 package\(s\) opened/);
    assert.doesNotMatch(out, /ERR_OUT_OF_RANGE/);
  });

  test('a ZIP64 package under an INVENTED identity still FAILS — the check did not go away with the crash', () => {
    const root = fixture({
      zip64: true,
      members: [{ name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml({ name: 'Nikatru.Subly' }), 'utf8'), method: 8 }],
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /Package\/Identity\/@Name is "Nikatru\.Subly"/);
    assert.match(out, /unrecoverable rather than re-uploadable/);
  });

  test('a ZIP64 package carrying AppxSignature.p7x still FAILS', () => {
    const root = fixture({
      zip64: true,
      members: [
        { name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml(), 'utf8'), method: 8 },
        { name: SIGNATURE_MEMBER, bytes: Buffer.from([0x30, 0x82, 0x01, 0x00]), method: 0 },
      ],
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`carries ${SIGNATURE_MEMBER}`));
  });

  test('a ZIP64 package with no readable AppxManifest.xml still FAILS', () => {
    const root = fixture({ zip64: true, members: [{ name: 'subscriptiontracker.exe', bytes: Buffer.from('PE'), method: 0 }] });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`no readable ${MANIFEST_MEMBER}`));
  });

  test('a ZIP64 package whose EOCD64 locator is gone is COVERAGE LOST, never a pass', () => {
    // The sentinel says "ask the 64-bit record" and nothing answers. A reader
    // that shrugged and used the sentinel as an offset is the original crash; a
    // reader that shrugged and returned members would be worse.
    const root = fixture({ zip64: true });
    const p = join(root, 'pkg', 'subscriptiontracker.msix');
    const raw = readFileSync(p);
    raw.writeUInt32LE(0x07064b51, raw.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07])));
    writeFileSync(p, raw);
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE opened as a zip/);
    assert.doesNotMatch(out, /ERR_OUT_OF_RANGE/);
  });

  test('ZIP64 and classic packages of the SAME members reach the SAME verdict', () => {
    const members = [
      { name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml(), 'utf8'), method: 8 },
      { name: 'subscriptiontracker.exe', bytes: Buffer.from('PE-BYTES'), method: 0 },
      ...TILES,
    ];
    const classic = run(fixture({ members }));
    const wide = run(fixture({ members, zip64: true }));
    assert.equal(classic.code, 0, classic.out);
    assert.equal(wide.code, classic.code, wide.out);
    assert.equal(wide.out.replaceAll('\r\n', '\n'), classic.out.replaceAll('\r\n', '\n'));
  });
});

// ── every way the question cannot be asked ───────────────────────────────────
describe('assert-artifact-signed-msix — a question that could not be asked is never a pass', () => {
  test('no package path at all — the empty set is refused', () => {
    const { code, out } = run(fixture(), []);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /certify the empty set/);
  });

  test('a path that does not exist', () => {
    const { code, out } = run(fixture(), ['pkg/absent.msix']);
    assert.equal(code, 2, out);
    assert.match(out, /no such file/);
  });

  test('a file that is not a zip is a FAILURE, not a skip', () => {
    const { code, out } = run(fixture({ raw: Buffer.from('this is not a zip at all') }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE opened as a zip/);
  });

  test('a zip with no AppxManifest.xml', () => {
    const root = fixture({ members: [{ name: 'subscriptiontracker.exe', bytes: Buffer.from('PE'), method: 0 }] });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`no readable ${MANIFEST_MEMBER}`));
  });

  test('no register', () => {
    const { code, out } = run(fixture({ register: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /does not exist/);
  });

  test('an unparseable register', () => {
    const { code, out } = run(fixture({ register: '{ not json' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /not valid JSON/);
  });

  // The register losing the field must be loud: with it gone every comparison
  // would pass by having nothing to disagree with.
  test('a register row with NO packageIdentity', () => {
    const { code, out } = run(fixture({ register: { channels: [{ id: 'windows-store' }] } }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no `packageIdentity`/);
  });

  test('a packageIdentity with an empty field is a hole, not a placeholder', () => {
    const reg = JSON.parse(JSON.stringify(REGISTER));
    reg.channels[0].packageIdentity.publisher = '';
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /a hole, not a placeholder/);
  });

  test('the register naming no windows-store channel', () => {
    const { code, out } = run(fixture({ register: { channels: [{ id: 'web' }] } }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no channel "windows-store"/);
  });

  test('IDENTITY_FIELDS covers all three declared values — a shrunken list certifies less', () => {
    assert.equal(IDENTITY_FIELDS.length, 3);
    const regFields = IDENTITY_FIELDS.map(([r]) => r).sort();
    assert.deepEqual(regFields, ['identityName', 'publisher', 'publisherDisplayName']);
  });

  test('COVERAGE LOST on a subject-free tree — the shape assert-guards-refuse-empty spawns', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root, []);
    assert.notEqual(code, 0);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ── the argument list, which is where run 32699518559 was lost ───────────────
// 🔴 THE WEEKLY RELEASE LANE FAILED 2026-08-24T06:58Z WITH `Package MSIX`
// GREEN. ddb9efe replaced the argument split with:
//     const rootIdx = argv.indexOf('--repo-root');                 // -1 when ABSENT
//     const packages = argv.filter((a, i) => !a.startsWith('--') && i !== rootIdx + 1);
// Absent flag ⇒ rootIdx === -1 ⇒ `rootIdx + 1 === 0` ⇒ the filter dropped index
// 0, the ONLY positional. CI passes one positional and no `--repo-root`, so the
// guard threw away the path it was given and printed COVERAGE LOST — blaming a
// packaging step that had succeeded.
//
// EVERY test in this file passed `--repo-root`, so every one of them exercised
// rootIdx >= 0, where the arithmetic happens to be right. That is why the suite
// was green while the lane was red. These tests use the CI shape.
describe('assert-artifact-signed-msix — the path CI actually passes is not discarded', () => {
  test('parseArgs keeps the lone positional when --repo-root is ABSENT', () => {
    const got = parseArgs(['apps/subscriptiontracker/build/windows/msix/subscriptiontracker.msix']);
    assert.deepEqual(got.packages, ['apps/subscriptiontracker/build/windows/msix/subscriptiontracker.msix']);
    assert.equal(got.rootFlagSeen, false);
    assert.equal(got.rootArg, undefined);
  });

  test('parseArgs keeps EVERY positional when --repo-root is absent', () => {
    assert.deepEqual(parseArgs(['a.msix', 'b.msix', 'c.msix']).packages, ['a.msix', 'b.msix', 'c.msix']);
  });

  test('parseArgs with --repo-root first still takes the value as the root, not as a package', () => {
    const got = parseArgs(['--repo-root', '/tmp/root', 'pkg/subscriptiontracker.msix']);
    assert.equal(got.rootArg, '/tmp/root');
    assert.equal(got.rootFlagSeen, true);
    assert.deepEqual(got.packages, ['pkg/subscriptiontracker.msix']);
  });

  test('parseArgs with --repo-root AFTER the positional keeps both straight', () => {
    const got = parseArgs(['pkg/subscriptiontracker.msix', '--repo-root', '/tmp/root']);
    assert.equal(got.rootArg, '/tmp/root');
    assert.deepEqual(got.packages, ['pkg/subscriptiontracker.msix']);
  });

  test('parseArgs drops other flags without eating the path beside them', () => {
    assert.deepEqual(parseArgs(['--verbose', 'pkg/subscriptiontracker.msix']).packages, ['pkg/subscriptiontracker.msix']);
  });

  // A flag is not a path. Consuming one would root the entire comparison at a
  // string like "--verbose" and report the result as a verdict.
  test('parseArgs does not swallow a following FLAG as the repo root', () => {
    const got = parseArgs(['--repo-root', '--verbose', 'pkg/subscriptiontracker.msix']);
    assert.equal(got.rootFlagSeen, true);
    assert.equal(got.rootArg, undefined);
    assert.deepEqual(got.packages, ['pkg/subscriptiontracker.msix']);
  });

  test('parseArgs on a truly empty argv reports no packages and no flag', () => {
    assert.deepEqual(parseArgs([]), { rootFlagSeen: false, rootArg: undefined, packages: [], app: undefined });
  });

  test('parseArgs takes the value after --app as the app, not as a package', () => {
    const got = parseArgs(['--app', 'subscriptiontracker', 'pkg/subscriptiontracker.msix']);
    assert.equal(got.app, 'subscriptiontracker');
    assert.deepEqual(got.packages, ['pkg/subscriptiontracker.msix']);
  });

  test('parseArgs does not swallow a following FLAG as the app', () => {
    const got = parseArgs(['--app', '--repo-root', '/tmp/root', 'a.msix']);
    assert.equal(got.app, undefined);
    assert.equal(got.rootArg, '/tmp/root');
    assert.deepEqual(got.packages, ['a.msix']);
  });

  // ── spawned, in the exact CI shape ────────────────────────────────────────
  // 🔴 THE PIN. Against the ddb9efe code this reads "no .msix path was given";
  // the path is present in argv and must never be reported as absent.
  test('a lone positional and NO --repo-root is NOT reported as the empty set', () => {
    const missing = join(TMP, `absent${seq++}.msix`);
    const { code, out } = runBare(missing);
    assert.equal(code, 2, out);
    assert.doesNotMatch(out, /no \.msix path was given/);
    assert.match(out, /no such file/);
    assert.match(out, /NOT ONE opened as a zip/);
  });

  // The whole verdict, end to end, in the CI shape: a package built against
  // whatever the REAL register declares today must PASS with no --repo-root.
  // Built from the live register rather than a copy of it, so the day Partner
  // Center replaces the sentinel this test follows instead of going stale.
  test('a correct package at an absolute path PASSES with no --repo-root', () => {
    const live = JSON.parse(readFileSync(join(REPO_ROOT, REGISTER_REL), 'utf8'));
    const declared = (live.channels ?? []).find((c) => c && c.id === CHANNEL_ID).packageIdentity;
    // ⏱ 2026-09-25: and the face the live tree declares — title.txt, app.yaml
    // `shortName` — graded against the live pubspec's logo_path and lock pin.
    const row = (live.channels ?? []).find((c) => c && c.id === CHANNEL_ID);
    const liveTitle = readFileSync(join(REPO_ROOT, row.storeMetadataDir.replace('{app}', 'subscriptiontracker'), 'title.txt'), 'utf8').trim();
    const liveLabel = readDeclaration(REPO_ROOT, 'subscriptiontracker').shortName;
    const pkg = join(TMP, `ci-shape${seq++}.msix`);
    writeFileSync(
      pkg,
      makeZip([
        {
          name: MANIFEST_MEMBER,
          bytes: Buffer.from(
            manifestXml({
              name: declared.identityName,
              publisher: declared.publisher,
              displayName: declared.publisherDisplayName,
              title: liveTitle,
              label: liveLabel,
            }),
            'utf8',
          ),
          method: 8,
        },
        ...TILES,
      ]),
    );
    const { code, out } = runBare('--app', 'subscriptiontracker', pkg);
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}msix identity/);
    assert.match(out, /1 package\(s\) opened/);
    assert.match(out, /ok {2}msix face/);
  });

  // 🔴 AND THE MESSAGE ITSELF. It used to say the packaging step "produced no
  // path to hand over, which is itself the finding" — a diagnosis of a step
  // this guard cannot observe, and one that had SUCCEEDED on the failing run.
  // What is observable here is argv, so argv is what it must print.
  test('the empty-set message prints the argv and blames no step it cannot see', () => {
    const { code, out } = runBare('--verbose');
    assert.equal(code, 2, out);
    assert.match(out, /no \.msix path was given/);
    assert.match(out, /1 argument\(s\) this process received were: "--verbose"/);
    assert.doesNotMatch(out, /produced no path to hand over/);
    assert.doesNotMatch(out, /which is itself the finding/);
  });

  test('a wholly empty argv says so rather than printing an empty list', () => {
    const { code, out } = runBare();
    assert.equal(code, 2, out);
    assert.match(out, /0 argument\(s\) this process received were: \(none\)/);
  });

  // `--repo-root` with nothing usable after it must not quietly fall back to
  // the default root: the caller asked to compare against a tree it named, and
  // answering about a different one is a verdict about the wrong repository.
  test('--repo-root with no value refuses instead of falling back', () => {
    const { code, out } = runBare('--repo-root');
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /`--repo-root` was given with no path after it/);
  });
});

// ── ⏱ 2026-09-25 · what a person sees (O-MSIX-IDENTITY-UNGRADED) ─────────────
// The identity above is what Partner Center matches; these are what a reviewer
// and a user read: the Store title, the Start-menu label, the tiles, and the
// logo the tiles were generated from.
describe('assert-artifact-signed-msix — the title, the label and the tiles are graded', () => {
  test('readVisualIdentity reads the title, the label, the tile short name and every tile reference', () => {
    const v = readVisualIdentity(manifestXml());
    assert.equal(v.displayName, TITLE);
    assert.equal(v.visualDisplayName, LABEL);
    assert.equal(v.tileShortName, LABEL);
    assert.equal(v.hasVisualElements, true);
    assert.deepEqual(v.tileRefs, ['Images\\StoreLogo.png', 'Images\\Square150x150Logo.png', 'Images\\Square44x44Logo.png', 'Images\\LargeTile.png']);
  });

  test('readVisualIdentity decodes an escaped label', () => {
    assert.equal(readVisualIdentity(manifestXml({ label: 'Subs &amp; Co' })).visualDisplayName, 'Subs & Co');
  });

  test('readVisualIdentity reports a manifest with no VisualElements as such', () => {
    const v = readVisualIdentity(manifestXml({ visual: false }));
    assert.equal(v.hasVisualElements, false);
    assert.equal(v.visualDisplayName, null);
    assert.equal(v.tileShortName, null);
  });

  test('tileMembersFor finds the resource-qualified variants of a reference and nothing with a longer stem', () => {
    const names = ['Images/Square44x44Logo.scale-100.png', 'Images/Square44x44Logo.targetsize-16.png', 'Images/Square44x44LogoX.png'];
    assert.deepEqual(tileMembersFor('Images\\Square44x44Logo.png', names), ['Images/Square44x44Logo.scale-100.png', 'Images/Square44x44Logo.targetsize-16.png']);
  });

  test('an all-correct package passes both halves', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}msix face/);
    assert.match(out, /logo_path "assets\/icon\/app_icon_1024\.png"/);
  });

  // RC1 — the Store title is the launcher label: what render.mjs produced while
  // msix_config.display_name was rendered from shortName.
  test('RC1: Properties/DisplayName carrying the launcher label FAILS, naming title.txt', () => {
    const { code, out } = run(fixture({ members: withManifest({ title: LABEL }) }));
    assert.equal(code, 1, out);
    assert.match(out, /Package\/Properties\/DisplayName is "Subscriptions" and apps\/subscriptiontracker\/store\/windows-store\/title\.txt declares "Nikatru Subscription Tracker"/);
  });

  // RC2 — the label is the Store title: what `msix` writes when nothing runs
  // msix-visual-name.mjs after it.
  test('RC2: uap:VisualElements/@DisplayName carrying the Store title FAILS, naming shortName', () => {
    const { code, out } = run(fixture({ members: withManifest({ label: TITLE, tileShortName: LABEL }) }));
    assert.equal(code, 1, out);
    assert.match(out, /uap:VisualElements\/@DisplayName is "Nikatru Subscription Tracker" and apps\/subscriptiontracker\/app\.yaml declares `shortName: Subscriptions`/);
  });

  test('a DefaultTile ShortName that is not the label FAILS', () => {
    const { code, out } = run(fixture({ members: withManifest({ tileShortName: TITLE }) }));
    assert.equal(code, 1, out);
    assert.match(out, /uap:DefaultTile\/@ShortName is "Nikatru Subscription Tracker"/);
  });

  test('a package with no VisualElements FAILS', () => {
    const { code, out } = run(fixture({ members: withManifest({ visual: false }) }));
    assert.equal(code, 1, out);
    assert.match(out, /carries no uap:VisualElements/);
  });

  test('a Properties block with no DisplayName FAILS', () => {
    const xml = manifestXml().replace(`    <DisplayName>${TITLE}</DisplayName>\n`, '');
    const { code, out } = run(fixture({ members: [{ name: MANIFEST_MEMBER, bytes: Buffer.from(xml, 'utf8'), method: 8 }, ...TILES] }));
    assert.equal(code, 1, out);
    assert.match(out, /Package\/Properties\/DisplayName is absent/);
  });

  test('a tile reference with no file in the package FAILS', () => {
    const members = [{ name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml(), 'utf8'), method: 8 }, ...TILES.filter((t) => !t.name.startsWith('Images/LargeTile'))];
    const { code, out } = run(fixture({ members }));
    assert.equal(code, 1, out);
    assert.match(out, /references "Images\\\\LargeTile\.png" and the package holds no file for it/);
  });

  // RC3 — a tile byte-identical to a plugin default. The real default bytes
  // are the plugin's, not this repository's, so the table is injected: the
  // fixture tile's own hash stands in for a default one.
  test('RC3: a tile whose sha256 is in the default table FAILS, naming the default it matches', () => {
    const tile = TILES[1];
    const table = {
      version: MSIX_PLUGIN_DEFAULT_TILE_HASHES.version,
      files: [['Square150x150Logo.scale-100.png', createHash('sha256').update(tile.bytes).digest('hex')]],
    };
    const got = tileProblems('pkg/x.msix', TILES, ['Images\\Square150x150Logo.png'], table);
    assert.equal(got.graded, 1);
    assert.equal(got.problems.length, 1);
    assert.match(got.problems[0], /tile Images\/Square150x150Logo\.scale-100\.png is byte-identical to msix 3\.18\.0's default Square150x150Logo\.scale-100\.png/);
  });

  test('RC3 control: the same tile against the real table is not a default', () => {
    const got = tileProblems('pkg/x.msix', TILES, ['Images\\Square150x150Logo.png']);
    assert.deepEqual(got.problems, []);
    assert.equal(got.graded, 1);
  });

  test('the default table is the 57 files of the pinned plugin, each a sha256', () => {
    assert.equal(MSIX_PLUGIN_DEFAULT_TILE_HASHES.files.length, 57);
    assert.equal(new Set(MSIX_PLUGIN_DEFAULT_TILE_HASHES.files.map(([, h]) => h)).size, 43);
    assert.ok(MSIX_PLUGIN_DEFAULT_TILE_HASHES.files.every(([f, h]) => /\.png$/.test(f) && /^[0-9a-f]{64}$/.test(h)));
  });

  test('a manifest that references no .png at all FAILS', () => {
    const got = tileProblems('pkg/x.msix', TILES, []);
    assert.match(got.problems[0], /references no \.png at all/);
  });

  // RC4 — no logo_path: `msix` builds every tile from its bundled placeholder.
  test('RC4: a pubspec whose msix_config sets no logo_path FAILS', () => {
    const { code, out } = run(fixture({ pubspec: PUBSPEC.replace('  logo_path: assets/icon/app_icon_1024.png\n', '') }));
    assert.equal(code, 1, out);
    assert.match(out, /msix_config sets no `logo_path`/);
  });

  test('RC4: a logo_path naming a file that is not there FAILS', () => {
    const { code, out } = run(fixture({ logo: false }));
    assert.equal(code, 1, out);
    assert.match(out, /msix_config\.logo_path is "assets\/icon\/app_icon_1024\.png" and apps\/subscriptiontracker\/assets\/icon\/app_icon_1024\.png does not exist/);
  });

  test('msixLogoPath reads only the msix_config block', () => {
    assert.equal(msixLogoPath('flutter_launcher_icons:\n  logo_path: x.png\nmsix_config:\n  store: true\n'), null);
    assert.equal(msixLogoPath('msix_config:\n  logo_path: "a/b.png"\n'), 'a/b.png');
  });

  test('pinnedMsixVersion reads the msix entry, not another package\'s version', () => {
    assert.equal(pinnedMsixVersion(LOCK), MSIX_PLUGIN_DEFAULT_TILE_HASHES.version);
    assert.equal(pinnedMsixVersion('packages:\n  mime:\n    source: hosted\n    version: "1.0.0"\n'), null);
  });

  // ── the questions that could not be asked ──────────────────────────────────
  test('no --app is COVERAGE LOST, after the identity was graded', () => {
    const { code, out } = run(fixture(), ['pkg/subscriptiontracker.msix']);
    assert.equal(code, 2, out);
    assert.match(out, /`--app <id>` was not given/);
  });

  test('a declaration with no shortName is COVERAGE LOST', () => {
    const { code, out } = run(fixture({ appYaml: `id: subscriptiontracker\nname: ${TITLE}\n` }));
    assert.equal(code, 2, out);
    assert.match(out, /declares no `shortName`/);
  });

  test('no title.txt is COVERAGE LOST', () => {
    const { code, out } = run(fixture({ title: null }));
    assert.equal(code, 2, out);
    assert.match(out, /title\.txt does not exist/);
  });

  test('a lock pinning another msix version is COVERAGE LOST — the default table is of 3.18.0', () => {
    const { code, out } = run(fixture({ lock: LOCK.replace(`"${MSIX_PLUGIN_DEFAULT_TILE_HASHES.version}"`, '"3.19.0"') }));
    assert.equal(code, 2, out);
    assert.match(out, /pubspec\.lock pins msix 3\.19\.0/);
  });

  test('a register row with no storeMetadataDir is COVERAGE LOST', () => {
    const reg = JSON.parse(JSON.stringify(REGISTER));
    delete reg.channels[0].storeMetadataDir;
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 2, out);
    assert.match(out, /declares no `storeMetadataDir`/);
  });
});
