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
import { readIdentity, parseArgs, IDENTITY_FIELDS, MANIFEST_MEMBER, SIGNATURE_MEMBER, REGISTER_REL, CHANNEL_ID } from '../assert-artifact-signed-msix.mjs';

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assert-artifact-signed-msix.mjs');
/** The root the guard falls back to when no `--repo-root` is given — the CI shape. */
const REPO_ROOT = resolve(dirname(GUARD), '..', '..');
const SENTINEL = 'PARTNER-CENTER-PENDING';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-msix-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** A real zip, central directory and all — the same construction the apple
 *  signing suite uses, because the guard reads it with the same reader. */
function makeZip(entries) {
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
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const manifestXml = ({ name = SENTINEL, publisher = `CN=${SENTINEL}`, displayName = SENTINEL, version = '1.0.3.0' } = {}) =>
  `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="${name}" Publisher="${publisher}" Version="${version}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Subly</DisplayName>
    <PublisherDisplayName>${displayName}</PublisherDisplayName>
  </Properties>
</Package>
`;

const REGISTER = {
  channels: [
    {
      id: 'windows-store',
      packageIdentity: {
        notYetConfiguredSentinel: SENTINEL,
        identityName: SENTINEL,
        publisher: `CN=${SENTINEL}`,
        publisherDisplayName: SENTINEL,
      },
    },
  ],
};

/** @param opts.members  zip members; default is a correct store-mode package. */
function fixture({ register = REGISTER, members = null, raw = null } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'pkg'), { recursive: true });
  if (register !== null) {
    writeFileSync(
      join(root, 'tooling', 'channel-register.json'),
      typeof register === 'string' ? register : JSON.stringify(register, null, 2),
    );
  }
  const entries = members ?? [
    { name: MANIFEST_MEMBER, bytes: Buffer.from(manifestXml(), 'utf8'), method: 8 },
    { name: 'subly.exe', bytes: Buffer.from('PE-BYTES'), method: 0 },
  ];
  writeFileSync(join(root, 'pkg', 'subly.msix'), raw ?? makeZip(entries));
  return root;
}

const run = (root, args = ['pkg/subly.msix']) => {
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

// ── every way the question cannot be asked ───────────────────────────────────
describe('assert-artifact-signed-msix — a question that could not be asked is never a pass', () => {
  test('no package path at all — the empty set is refused', () => {
    const { code, out } = run(fixture(), []);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /certify the empty set/);
  });

  test('a path that does not exist', () => {
    const { code, out } = run(fixture(), ['pkg/absent.msix']);
    assert.equal(code, 1, out);
    assert.match(out, /no such file/);
  });

  test('a file that is not a zip is a FAILURE, not a skip', () => {
    const { code, out } = run(fixture({ raw: Buffer.from('this is not a zip at all') }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE opened as a zip/);
  });

  test('a zip with no AppxManifest.xml', () => {
    const root = fixture({ members: [{ name: 'subly.exe', bytes: Buffer.from('PE'), method: 0 }] });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`no readable ${MANIFEST_MEMBER}`));
  });

  test('no register', () => {
    const { code, out } = run(fixture({ register: null }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /does not exist/);
  });

  test('an unparseable register', () => {
    const { code, out } = run(fixture({ register: '{ not json' }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /not valid JSON/);
  });

  // The register losing the field must be loud: with it gone every comparison
  // would pass by having nothing to disagree with.
  test('a register row with NO packageIdentity', () => {
    const { code, out } = run(fixture({ register: { channels: [{ id: 'windows-store' }] } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no `packageIdentity`/);
  });

  test('a packageIdentity with an empty field is a hole, not a placeholder', () => {
    const reg = JSON.parse(JSON.stringify(REGISTER));
    reg.channels[0].packageIdentity.publisher = '';
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /a hole, not a placeholder/);
  });

  test('the register naming no windows-store channel', () => {
    const { code, out } = run(fixture({ register: { channels: [{ id: 'web' }] } }));
    assert.equal(code, 1, out);
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
    const got = parseArgs(['apps/subly/build/windows/msix/subly.msix']);
    assert.deepEqual(got.packages, ['apps/subly/build/windows/msix/subly.msix']);
    assert.equal(got.rootFlagSeen, false);
    assert.equal(got.rootArg, undefined);
  });

  test('parseArgs keeps EVERY positional when --repo-root is absent', () => {
    assert.deepEqual(parseArgs(['a.msix', 'b.msix', 'c.msix']).packages, ['a.msix', 'b.msix', 'c.msix']);
  });

  test('parseArgs with --repo-root first still takes the value as the root, not as a package', () => {
    const got = parseArgs(['--repo-root', '/tmp/root', 'pkg/subly.msix']);
    assert.equal(got.rootArg, '/tmp/root');
    assert.equal(got.rootFlagSeen, true);
    assert.deepEqual(got.packages, ['pkg/subly.msix']);
  });

  test('parseArgs with --repo-root AFTER the positional keeps both straight', () => {
    const got = parseArgs(['pkg/subly.msix', '--repo-root', '/tmp/root']);
    assert.equal(got.rootArg, '/tmp/root');
    assert.deepEqual(got.packages, ['pkg/subly.msix']);
  });

  test('parseArgs drops other flags without eating the path beside them', () => {
    assert.deepEqual(parseArgs(['--verbose', 'pkg/subly.msix']).packages, ['pkg/subly.msix']);
  });

  // A flag is not a path. Consuming one would root the entire comparison at a
  // string like "--verbose" and report the result as a verdict.
  test('parseArgs does not swallow a following FLAG as the repo root', () => {
    const got = parseArgs(['--repo-root', '--verbose', 'pkg/subly.msix']);
    assert.equal(got.rootFlagSeen, true);
    assert.equal(got.rootArg, undefined);
    assert.deepEqual(got.packages, ['pkg/subly.msix']);
  });

  test('parseArgs on a truly empty argv reports no packages and no flag', () => {
    assert.deepEqual(parseArgs([]), { rootFlagSeen: false, rootArg: undefined, packages: [] });
  });

  // ── spawned, in the exact CI shape ────────────────────────────────────────
  // 🔴 THE PIN. Against the ddb9efe code this reads "no .msix path was given";
  // the path is present in argv and must never be reported as absent.
  test('a lone positional and NO --repo-root is NOT reported as the empty set', () => {
    const missing = join(TMP, `absent${seq++}.msix`);
    const { code, out } = runBare(missing);
    assert.equal(code, 1, out);
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
            }),
            'utf8',
          ),
          method: 8,
        },
      ]),
    );
    const { code, out } = runBare(pkg);
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}msix identity/);
    assert.match(out, /1 package\(s\) opened/);
  });

  // 🔴 AND THE MESSAGE ITSELF. It used to say the packaging step "produced no
  // path to hand over, which is itself the finding" — a diagnosis of a step
  // this guard cannot observe, and one that had SUCCEEDED on the failing run.
  // What is observable here is argv, so argv is what it must print.
  test('the empty-set message prints the argv and blames no step it cannot see', () => {
    const { code, out } = runBare('--verbose');
    assert.equal(code, 1, out);
    assert.match(out, /no \.msix path was given/);
    assert.match(out, /1 argument\(s\) this process received were: "--verbose"/);
    assert.doesNotMatch(out, /produced no path to hand over/);
    assert.doesNotMatch(out, /which is itself the finding/);
  });

  test('a wholly empty argv says so rather than printing an empty list', () => {
    const { code, out } = runBare();
    assert.equal(code, 1, out);
    assert.match(out, /0 argument\(s\) this process received were: \(none\)/);
  });

  // `--repo-root` with nothing usable after it must not quietly fall back to
  // the default root: the caller asked to compare against a tree it named, and
  // answering about a different one is a verdict about the wrong repository.
  test('--repo-root with no value refuses instead of falling back', () => {
    const { code, out } = runBare('--repo-root');
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /`--repo-root` was given with no path after it/);
  });
});
