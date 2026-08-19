// ─────────────────────────────────────────────────────────────────────────────
// elf-page-alignment.test.mjs — assert-elf-page-alignment.mjs must be able to
// FAIL, and must refuse rather than pass when it reaches nothing.
//
// [pipeline K-13] The duty row `play-16kb-page-size` in
// tooling/legal/duty-matrix.json is the floor; the guard reads it from there.
//
// ⚠️ THE FIXTURES ARE REAL BYTES, NOT MOCKS. Every artifact below is a genuine
// zip whose entries are genuine ELF objects assembled field by field — the same
// choice listing-assets.test.mjs makes when it writes PNG chunks by hand. A
// fixture built by the same helper the guard uses would prove only that the
// helper agrees with itself, and this guard exists precisely because nothing in
// this tree had ever decoded a `.so`.
//
// 🔬 MUTATIONS RUN AGAINST THE REAL GUARD (2026-08-20, predictions written
//    first, all six confirmed):
//   M1 p_align 4096 on the only LOAD segment          -> caught, naming 2**12
//   M2 p_align 16384 on segment 0, 4096 on segment 1  -> caught, naming segment 1
//      (the one that matters: a partially-aligned library is the realistic
//       toolchain regression, and a guard that stopped at the first segment
//       would have passed it)
//   M3 a 32-bit library at 4096 alongside a good 64-bit one -> PASSES, and the
//      exemption is PRINTED. Holding armeabi-v7a to 2**14 would fail an upload
//      Play accepts.
//   M4 the `source` block deleted from the duty row    -> COVERAGE LOST, not a
//      pass and not an enforcement of the bare number
//   M5 every library 32-bit                            -> COVERAGE LOST rather
//      than "0 problems"
//   M6 the .so entries removed from the zip            -> COVERAGE LOST
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-elf-page-alignment.mjs');
const DUTY_REL = join('tooling', 'legal', 'duty-matrix.json');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-elf-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

// ── ELF builders ────────────────────────────────────────────────────────────
// Only the fields the guard reads are meaningful; the rest are the values a real
// aarch64 shared object carries, so a fixture that accidentally became valid
// input to some other reader would still be describing the same thing.

/** @param aligns one p_align per PT_LOAD segment */
function elf64(aligns) {
  const phnum = aligns.length;
  const buf = Buffer.alloc(64 + phnum * 56);
  buf.writeUInt8(0x7f, 0); buf.write('ELF', 1, 'ascii');
  buf.writeUInt8(2, 4);   // EI_CLASS = ELFCLASS64
  buf.writeUInt8(1, 5);   // EI_DATA  = little-endian
  buf.writeUInt8(1, 6);   // EI_VERSION
  buf.writeUInt16LE(3, 16);      // e_type = ET_DYN
  buf.writeUInt16LE(0xb7, 18);   // e_machine = AArch64
  buf.writeUInt32LE(1, 20);      // e_version
  buf.writeBigUInt64LE(64n, 0x20); // e_phoff
  buf.writeUInt16LE(64, 52);     // e_ehsize
  buf.writeUInt16LE(56, 0x36);   // e_phentsize
  buf.writeUInt16LE(phnum, 0x38);
  aligns.forEach((align, i) => {
    const p = 64 + i * 56;
    buf.writeUInt32LE(1, p);            // p_type = PT_LOAD
    buf.writeUInt32LE(5, p + 4);        // p_flags = R+X
    buf.writeBigUInt64LE(BigInt(align), p + 48);
  });
  return buf;
}

function elf32(aligns) {
  const phnum = aligns.length;
  const buf = Buffer.alloc(Math.max(64, 52 + phnum * 32));
  buf.writeUInt8(0x7f, 0); buf.write('ELF', 1, 'ascii');
  buf.writeUInt8(1, 4);   // EI_CLASS = ELFCLASS32
  buf.writeUInt8(1, 5);
  buf.writeUInt8(1, 6);
  buf.writeUInt16LE(3, 16);
  buf.writeUInt16LE(0x28, 18);   // e_machine = ARM
  buf.writeUInt32LE(1, 20);
  buf.writeUInt32LE(52, 0x1c);   // e_phoff
  buf.writeUInt16LE(52, 40);     // e_ehsize
  buf.writeUInt16LE(32, 0x2a);   // e_phentsize
  buf.writeUInt16LE(phnum, 0x2c);
  aligns.forEach((align, i) => {
    const p = 52 + i * 32;
    buf.writeUInt32LE(1, p);
    buf.writeUInt32LE(align, p + 28);
  });
  return buf;
}

/** A 64-bit ELF whose program header table is declared past the end of the
 *  file — the "I could not enumerate the segments" path. */
function elf64Truncated() {
  const buf = elf64([16384]);
  buf.writeUInt16LE(40, 0x38); // e_phnum = 40, but only one entry is present
  return buf;
}

// ── zip builder ─────────────────────────────────────────────────────────────
function zip(files, { zip64Locator = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate = false } of files) {
    const body = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  const parts = [localPart, centralPart];
  if (zip64Locator) {
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    parts.push(loc);
  }
  parts.push(eocd);
  return Buffer.concat(parts);
}

// ── a fixture root: the real duty matrix, optionally mutated ────────────────
function root({ duty = 'real' } = {}) {
  const dir = join(TMP, `r${seq++}`);
  mkdirSync(join(dir, 'tooling', 'legal'), { recursive: true });
  if (duty !== 'absent') {
    const real = JSON.parse(readFileSync(join(REPO, DUTY_REL), 'utf8'));
    if (duty === 'no-source') {
      const row = real.duties.find((d) => d.id === 'play-16kb-page-size');
      delete row.source;
    } else if (duty === 'no-number') {
      const row = real.duties.find((d) => d.id === 'play-16kb-page-size');
      delete row.enforced.loadSegmentAlignAtLeast;
    } else if (duty === 'no-row') {
      real.duties = real.duties.filter((d) => d.id !== 'play-16kb-page-size');
    }
    writeFileSync(join(dir, DUTY_REL), JSON.stringify(real, null, 2));
  }
  return dir;
}

function artifact(dir, name, files, opts) {
  const p = join(dir, name);
  writeFileSync(p, zip(files, opts));
  return p;
}

const run = (dir, args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args, '--repo-root', dir], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const GOOD_64 = { name: 'base/lib/arm64-v8a/libapp.so', data: elf64([16384, 16384]) };
const GOOD_64_X = { name: 'base/lib/x86_64/libflutter.so', data: elf64([65536]) };

describe('assert-elf-page-alignment', () => {
  // ── the passing path ──────────────────────────────────────────────────────
  test('passes when every 64-bit LOAD segment clears the floor', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [GOOD_64, GOOD_64_X]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 0, out);
    assert.match(out, /3 64-bit LOAD segment\(s\) across 2 library\(ies\) in 1 artifact\(s\)/);
    assert.match(out, /at least 16384 \(2\*\*14\)/);
    assert.match(out, /abi\(s\) seen: arm64-v8a, x86_64/);
  });

  test('an .apk lays its libraries at lib/<abi>/ with no module prefix, and is read the same way', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.apk', [{ name: 'lib/arm64-v8a/libapp.so', data: elf64([16384]) }]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 0, out);
    assert.match(out, /1 64-bit LOAD segment\(s\)/);
  });

  test('deflated entries are inflated and read, not skipped', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [{ ...GOOD_64, deflate: true }]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 0, out);
    assert.match(out, /2 64-bit LOAD segment\(s\)/);
  });

  test('several artifacts are all read, and the count says how many', () => {
    const dir = root();
    const a = artifact(dir, 'a.aab', [GOOD_64]);
    const b = artifact(dir, 'b.apk', [{ name: 'lib/arm64-v8a/libapp.so', data: elf64([16384]) }]);
    const { code, out } = run(dir, [a, b]);
    assert.equal(code, 0, out);
    assert.match(out, /in 2 artifact\(s\)/);
  });

  // ── M1/M2 — the defect this guard exists for ──────────────────────────────
  test('M1 FAILS a LOAD segment aligned to 4096', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [{ name: 'base/lib/arm64-v8a/libapp.so', data: elf64([4096]) }]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /p_align 4096 \(2\*\*12\), below the required 16384 \(2\*\*14\)/);
    assert.match(out, /assert-elf-page-alignment: FAILED/);
  });

  test('M2 FAILS the SECOND segment when the first is fine — the scan does not stop at segment 0', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [{ name: 'base/lib/arm64-v8a/libapp.so', data: elf64([16384, 4096]) }]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /LOAD segment 1 has p_align 4096/);
    assert.doesNotMatch(out, /LOAD segment 0 has p_align/);
  });

  test('the failure names the primary source, so the number can be re-checked from the output alone', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [{ name: 'base/lib/arm64-v8a/libapp.so', data: elf64([8192]) }]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /developer\.android\.com\/guide\/practices\/page-sizes/);
    assert.match(out, /16 KB memory page sizes/);
  });

  // ── M3 — the exemption that must NOT become a failure ─────────────────────
  test('M3 a 32-bit library below the floor PASSES, and the exemption is printed', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [
      GOOD_64,
      { name: 'base/lib/armeabi-v7a/libapp.so', data: elf32([4096]) },
    ]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 0, out);
    assert.match(out, /1 library\(ies\) are 32-bit and are EXEMPT/);
    assert.match(out, /would fail an upload Play accepts/);
  });

  // ── unreadable input must not read as clean input ─────────────────────────
  test('FAILS on a lib/*.so that is not an ELF object at all', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [
      GOOD_64,
      { name: 'base/lib/arm64-v8a/libjunk.so', data: Buffer.alloc(200, 0x41) },
    ]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /is not a decodable ELF object/);
    assert.match(out, /must not be counted as one it cleared/);
  });

  test('FAILS when the program header table runs past the end of the file', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [
      GOOD_64,
      { name: 'base/lib/arm64-v8a/libtrunc.so', data: elf64Truncated() },
    ]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /program header table runs past the end of the file/);
    assert.match(out, /its alignment is unknown/);
  });

  test('FAILS on a 64-bit ELF carrying no PT_LOAD segment at all', () => {
    const dir = root();
    const noLoad = elf64([16384]);
    noLoad.writeUInt32LE(6, 64); // p_type = PT_PHDR, so nothing is a LOAD
    const a = artifact(dir, 'app-release.aab', [{ name: 'base/lib/arm64-v8a/libapp.so', data: noLoad }]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /NO PT_LOAD segment/);
    assert.match(out, /not the same as nothing being wrong/);
  });

  // ── anti-vacuity: a scan that reached nothing ─────────────────────────────
  test('COVERAGE LOST when no artifact is named', () => {
    const dir = root();
    const { code, out } = run(dir, []);
    assert.equal(code, 1, 'an empty argument list must not read as "nothing to check"');
    assert.match(out, /COVERAGE LOST — no artifact was named/);
  });

  test('COVERAGE LOST when the named artifact does not exist', () => {
    const dir = root();
    const { code, out } = run(dir, [join(dir, 'never-built.aab')]);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /does not exist/);
  });

  test('M6 COVERAGE LOST when the artifact carries no lib/<abi>/*.so at all', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [{ name: 'base/manifest/AndroidManifest.xml', data: Buffer.from('<manifest/>') }]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1, 'zero native libraries must not read as "all libraries are aligned"');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO lib\/<abi>\/\*\.so entries/);
  });

  test('M5 COVERAGE LOST when every library is 32-bit, so zero comparisons were made', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [{ name: 'base/lib/armeabi-v7a/libapp.so', data: elf32([16384]) }]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1, 'an all-32-bit artifact is broken, not passing');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO 64-bit LOAD segments were compared/);
  });

  test('COVERAGE LOST on an archive with no end-of-central-directory record', () => {
    const dir = root();
    const p = join(dir, 'app-release.aab');
    writeFileSync(p, Buffer.alloc(500, 0x00));
    const { code, out } = run(dir, [p]);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no zip end-of-central-directory record/);
  });

  test('COVERAGE LOST on a ZIP64 archive rather than a confident, wrong entry list', () => {
    const dir = root();
    const a = artifact(dir, 'app-release.aab', [GOOD_64], { zip64Locator: true });
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZIP64/);
  });

  // ── anti-vacuity: the floor itself ────────────────────────────────────────
  test('COVERAGE LOST when the duty matrix is absent', () => {
    const dir = root({ duty: 'absent' });
    const a = artifact(dir, 'app-release.aab', [GOOD_64]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /duty-matrix\.json does not exist/);
  });

  test('COVERAGE LOST when the duty row has been deleted', () => {
    const dir = root({ duty: 'no-row' });
    const a = artifact(dir, 'app-release.aab', [GOOD_64]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no duty with id "play-16kb-page-size"/);
  });

  test('COVERAGE LOST when the row carries no floor', () => {
    const dir = root({ duty: 'no-number' });
    const a = artifact(dir, 'app-release.aab', [GOOD_64]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no integer `enforced\.loadSegmentAlignAtLeast`/);
  });

  test('M4 COVERAGE LOST when the floor arrives without its citation', () => {
    const dir = root({ duty: 'no-source' });
    const a = artifact(dir, 'app-release.aab', [GOOD_64]);
    const { code, out } = run(dir, [a]);
    assert.equal(code, 1, 'an uncited number must not be enforced');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /with no `source\.url` \+ `source\.quote`/);
  });

  // ── the real tree ─────────────────────────────────────────────────────────
  test('the real duty row supplies a power-of-two floor of 16384', () => {
    const real = JSON.parse(readFileSync(join(REPO, DUTY_REL), 'utf8'));
    const row = real.duties.find((d) => d.id === 'play-16kb-page-size');
    assert.ok(row, 'the duty row must exist in the real tree');
    assert.equal(row.enforced.loadSegmentAlignAtLeast, 16384);
    assert.equal(Math.log2(row.enforced.loadSegmentAlignAtLeast), 14);
    assert.match(row.source.url, /^https:\/\/developer\.android\.com\//);
    assert.equal(row.artefact, 'tooling/ci/assert-elf-page-alignment.mjs');
  });
});
