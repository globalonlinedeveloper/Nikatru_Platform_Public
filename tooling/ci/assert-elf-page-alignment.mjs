#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-elf-page-alignment.mjs — open the built artifact, read the ELF program
// headers of every 64-bit shared library inside it, and refuse a LOAD segment
// that is not aligned for a 16 KB memory page.
//
// [pipeline K-13] "A compliance corpus decays quietly and goes on reading as
//                  authoritative." The duty row is `play-16kb-page-size` in
//                  tooling/legal/duty-matrix.json, and the floor lives THERE.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// 🔴 NOTHING IN THIS TREE HAD EVER LOOKED INSIDE A `.so`. Measured 2026-08-20:
// `readelf`, `llvm-readelf`, `objdump`, `zipalign`, `p_align` and
// `max-page-size` returned ZERO hits across every workflow, guard, Gradle file
// and script in the repository.
//
// That is the interesting part. Segment alignment is not a value anybody here
// writes down — it is decided by the NDK and by the linker flags Flutter's own
// Gradle plugin passes — so there is no line for a reviewer to review and no
// diff for a reviewer to see. It changes underneath the app when the toolchain
// moves, with no Gradle error and no failing test. That is the same shape as the
// `targetSdk` that was unpinned until 2026-08-04 and met its floor by accident
// of which SDK happened to be installed, and the same shape as the debug signing
// assert-artifact-signed.mjs exists for: the configuration was correct, every
// configuration check was green, and nothing read the bytes.
//
// So this guard reads the bytes. It is the one question about an artifact that a
// configuration scan is structurally unable to answer.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   1. every `lib/<abi>/*.so` entry inside the artifact parses as an ELF object
//      (a `.so` this guard cannot decode must not be reported as one it read)
//   2. every PT_LOAD segment of every 64-bit library has `p_align >= the floor`
//      declared in the duty row — 16384, which is 2**14, the form the cited page
//      states it in
//
// ── 🔴 WHAT IT DELIBERATELY DOES NOT ASSERT, AND WHY ─────────────────────────
// **32-BIT LIBRARIES ARE READ, COUNTED AND EXEMPT.** The cited requirement is
// "must support 16 KB memory page sizes ON 64-BIT DEVICES on Google Play".
// armeabi-v7a and x86 do not run on those devices, and holding them to 2**14
// would fail an upload Play accepts — an invented limit firing on correct input,
// which this repository has already paid for once at 129 characters against a
// made-up "120 or fewer". They are printed, never failed, so the exemption is
// visible in every run's output instead of being a silence.
//
// It also does not check the zip's own entry alignment (`zipalign -c -P 16`).
// That is a second, different property, of the container rather than of the
// library, and asserting it from a claim rather than from the bytes is precisely
// the mistake above.
//
// ── THE FLOOR IS READ, NEVER WRITTEN HERE ────────────────────────────────────
// `enforced.loadSegmentAlignAtLeast` comes out of the duty row, beside its
// citation, for the same reason `assert-android-target-sdk.mjs` reads
// `targetSdkAtLeast` from its row: a number hard-coded in a guard is a limit
// with no source attached, and this corpus refuses that shape everywhere else.
// A row carrying the number but no `source` FAILS rather than being enforced.
//
// ── ⚠️ NO `llvm-readelf`, ON PURPOSE ─────────────────────────────────────────
// The cited page recommends `llvm-readelf -l` and `zipalign -c -P 16`. Both live
// in the Android SDK/NDK, which no workflow in this repository installs or pins.
// A guard that shells out to a tool the runner may or may not have has two
// failure modes that look identical in a log — "the libraries are aligned" and
// "the tool was missing" — and this repository has already established that the
// second must never be able to print as the first. The program header table is
// fixed-offset structure; it is parsed here directly, so the guard has no
// dependency it can silently lose.
//
// Usage:  node tooling/ci/assert-elf-page-alignment.mjs <artifact.aab|.apk> [...] [--repo-root <dir>]
// Exit 0 = every 64-bit LOAD segment in every artifact clears the floor.
// Exit 1 = a segment is under-aligned, or the scan reached nothing (COVERAGE LOST).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const DUTY_REL = 'tooling/legal/duty-matrix.json';
const DUTY_ID = 'play-16kb-page-size';

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--repo-root');
// `rootIdx + 1` alone is the bug scan-secrets.mjs shipped: with the flag absent
// indexOf returns -1, and -1 + 1 is 0 — the first ARTIFACT's own index — so the
// flagless form would silently drop its first argument.
const rootValueIdx = rootIdx >= 0 ? rootIdx + 1 : -1;
const artifacts = argv.filter((a, i) => !a.startsWith('--') && i !== rootValueIdx);
const ROOT = resolve(rootIdx >= 0 ? argv[rootIdx + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-elf-page-alignment: FAILED');
  process.exit(1);
}

// ── the floor, read from the duty row ────────────────────────────────────────
const dutyAbs = join(ROOT, DUTY_REL);
if (!existsSync(dutyAbs)) {
  coverageLost([
    `${DUTY_REL} does not exist, so this guard has no floor to enforce.`,
    'The number is deliberately not in this file. Without the row there is no right-hand side, and every',
    'artifact below would satisfy a comparison against nothing.',
  ]);
}
let duty;
try {
  duty = JSON.parse(readFileSync(dutyAbs, 'utf8'));
} catch (e) {
  coverageLost([`${DUTY_REL} is not valid JSON — ${e.message}`]);
}
const row = (Array.isArray(duty.duties) ? duty.duties : []).find((d) => d && d.id === DUTY_ID);
if (!row) {
  coverageLost([
    `${DUTY_REL} declares no duty with id "${DUTY_ID}".`,
    'That row IS the requirement, and it carries the citation that makes the number checkable. Deleting it does',
    'not make this guard unnecessary — it makes it blind, and it would go on printing ok.',
  ]);
}
const FLOOR = row.enforced && row.enforced.loadSegmentAlignAtLeast;
if (!Number.isInteger(FLOOR) || FLOOR <= 0) {
  coverageLost([
    `duty "${DUTY_ID}" carries no integer \`enforced.loadSegmentAlignAtLeast\` (found ${JSON.stringify(FLOOR === undefined ? null : FLOOR)}).`,
    'The floor is the whole right-hand side of this guard.',
  ]);
}
// A limit that arrives without its citation is refused, exactly as
// assert-listing-assets.mjs refuses an unsourced dimension: an invented number
// fires on correct input, and nobody can re-check it later.
if (!row.source || typeof row.source.url !== 'string' || typeof row.source.quote !== 'string') {
  coverageLost([
    `duty "${DUTY_ID}" declares a floor of ${FLOOR} with no \`source.url\` + \`source.quote\`.`,
    "A number with no citation cannot be re-verified, and this guard would then be enforcing somebody's memory.",
  ]);
}

if (artifacts.length === 0) {
  coverageLost([
    'no artifact was named on the command line, so ZERO libraries were examined.',
    'This guard takes the artifact path from the workflow step that built it — one source of truth for where the',
    'build puts its output — so an empty argument list is a lane that stopped passing its artifact, not an app',
    'with nothing to check.',
    'Usage: node tooling/ci/assert-elf-page-alignment.mjs <artifact.aab|.apk> [...] [--repo-root <dir>]',
  ]);
}

// ── zip reader ───────────────────────────────────────────────────────────────
// Central-directory walk. Deliberately refuses rather than guesses: an archive
// shape it cannot read is COVERAGE LOST, never an empty entry list, because an
// empty entry list is indistinguishable from "this bundle ships no native code"
// and would print clean.
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function zipEntries(buf, rel) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) {
    coverageLost([`${rel} has no zip end-of-central-directory record — it is not a readable .aab/.apk.`]);
  }
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_EOCD64_LOCATOR) {
    coverageLost([
      `${rel} is a ZIP64 archive and this reader does not implement ZIP64.`,
      'Refusing rather than reading the 32-bit fields, which in a ZIP64 archive are the 0xFFFFFFFF sentinels and',
      'would produce a confident, wrong entry list.',
    ]);
  }
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    coverageLost([`${rel} carries ZIP64 sentinel values in its end-of-central-directory record; this reader does not implement ZIP64.`]);
  }
  const out = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) {
      coverageLost([`${rel} central directory entry ${n} of ${count} is malformed at offset ${p}.`]);
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readEntry(buf, entry, rel) {
  const o = entry.localOffset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== SIG_LOC) {
    coverageLost([`${rel}: entry "${entry.name}" has no local file header at offset ${o}.`]);
  }
  const nameLen = buf.readUInt16LE(o + 26);
  const extraLen = buf.readUInt16LE(o + 28);
  const start = o + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw);
    } catch (e) {
      coverageLost([
        `${rel}: entry "${entry.name}" would not inflate — ${e.message}.`,
        'A library this guard cannot decompress must not be reported as one it read.',
      ]);
    }
  }
  coverageLost([`${rel}: entry "${entry.name}" uses zip compression method ${entry.method}, which this reader does not implement.`]);
}

// ── ELF program headers ──────────────────────────────────────────────────────
// Fixed-offset structure; only the fields this guard uses are read. Returns null
// when the buffer is not an ELF object at all, so the caller can say so rather
// than treat an unreadable file as an aligned one.
const PT_LOAD = 1;

function elfLoadSegments(buf) {
  if (buf.length < 64) return null;
  if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) return null;
  const cls = buf[4]; // 1 = ELF32, 2 = ELF64
  const data = buf[5]; // 1 = little-endian, 2 = big-endian
  if (cls !== 1 && cls !== 2) return null;
  if (data !== 1 && data !== 2) return null;
  const bits = cls === 2 ? 64 : 32;
  const le = data === 1;
  const u16 = (off) => (le ? buf.readUInt16LE(off) : buf.readUInt16BE(off));
  const u32 = (off) => (le ? buf.readUInt32LE(off) : buf.readUInt32BE(off));
  const u64 = (off) => Number(le ? buf.readBigUInt64LE(off) : buf.readBigUInt64BE(off));

  const phoff = bits === 64 ? u64(0x20) : u32(0x1c);
  const phentsize = bits === 64 ? u16(0x36) : u16(0x2a);
  const phnum = bits === 64 ? u16(0x38) : u16(0x2c);
  const want = bits === 64 ? 56 : 32;
  if (phnum === 0 || phentsize < want) {
    return { bits, segments: [], malformed: `its program header table declares ${phnum} entry(ies) of ${phentsize} byte(s), and a PT_LOAD entry needs ${want}` };
  }
  if (phoff + phnum * phentsize > buf.length) {
    return { bits, segments: [], malformed: `its program header table runs past the end of the file (${phoff} + ${phnum}x${phentsize} > ${buf.length})` };
  }

  const segments = [];
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phentsize;
    if (u32(p) !== PT_LOAD) continue;
    segments.push({
      index: i,
      align: bits === 64 ? u64(p + 48) : u32(p + 28),
    });
  }
  return { bits, segments, malformed: null };
}

/** 16384 reads as "2**14" on the cited page. Printed both ways so a reader
 *  comparing the page to this output never has to do the arithmetic. */
const pow2 = (n) => (n > 0 && Number.isInteger(Math.log2(n)) ? `2**${Math.log2(n)}` : `not a power of two`);

// ── the scan ─────────────────────────────────────────────────────────────────
// An .apk holds `lib/<abi>/x.so`; an .aab holds `<module>/lib/<abi>/x.so`. Both
// shapes are matched, and the ABI is taken from the path rather than guessed, so
// the printed exemption names the directory the bytes really came from.
const LIB_RE = /(?:^|\/)lib\/([^/]+)\/[^/]+\.so$/;

let librariesRead = 0;
let segmentsChecked = 0;
let exempt32 = 0;
const abisSeen = new Set();

for (const rel of artifacts) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    coverageLost([
      `${rel} does not exist (looked at ${abs}).`,
      'The lane names the artifact it built. A missing one means the build step did not produce what the next step',
      'claims to check, and reporting that as "nothing to check" is the vacuous green this repository has already',
      'paid for twice.',
    ]);
  }
  const buf = readFileSync(abs);
  const entries = zipEntries(buf, rel).filter((e) => LIB_RE.test(e.name));
  if (entries.length === 0) {
    coverageLost([
      `${rel} contains ZERO lib/<abi>/*.so entries.`,
      'Every Flutter release artifact ships libflutter.so and libapp.so, so an empty native set is a broken artifact',
      'or a reader that stopped reading — not an app without native code. Either way the alignment question went',
      'unanswered, and it must not print as answered.',
    ]);
  }

  for (const entry of entries) {
    const abi = entry.name.match(LIB_RE)[1];
    abisSeen.add(abi);
    const so = readEntry(buf, entry, rel);
    const elf = elfLoadSegments(so);
    if (elf === null) {
      problems.push(
        `${rel} :: ${entry.name} is not a decodable ELF object (${so.length} byte(s) after inflation). ` +
          'A .so this guard cannot parse must not be counted as one it cleared.',
      );
      continue;
    }
    librariesRead++;
    if (elf.malformed) {
      problems.push(`${rel} :: ${entry.name} — ${elf.malformed}. Its LOAD segments could not be enumerated, so its alignment is unknown.`);
      continue;
    }
    if (elf.bits !== 64) {
      exempt32++;
      continue;
    }
    if (elf.segments.length === 0) {
      problems.push(`${rel} :: ${entry.name} is a 64-bit ELF with NO PT_LOAD segment. Nothing was compared, which is not the same as nothing being wrong.`);
      continue;
    }
    for (const s of elf.segments) {
      segmentsChecked++;
      if (s.align < FLOOR) {
        problems.push(
          `${rel} :: ${entry.name} (abi ${abi}) LOAD segment ${s.index} has p_align ${s.align} (${pow2(s.align)}), below the ` +
            `required ${FLOOR} (${pow2(FLOOR)}). Source: ${row.source.url} (fetched ${row.source.fetched}) — "${row.source.quote}"`,
        );
      }
    }
  }
}

// 🔴 A FINDING OUTRANKS COVERAGE LOSS, AND THAT ORDERING IS LOAD-BEARING.
// Both are exit 1, so it would be tempting to check reach first and be done. The
// guard's own test caught why not: a library with no PT_LOAD segment raises a
// precise, actionable problem AND leaves `segmentsChecked` at 0, and the reach
// check — running first — replaced that sentence with "every library was 32-bit",
// which was not merely vaguer but FALSE. A diagnostic is a claim and needs the
// same evidence as a finding. Zero comparisons is only coverage loss when
// nothing else went wrong; otherwise the problems below explain it.
if (problems.length === 0) {
  if (librariesRead === 0) {
    coverageLost([
      `${artifacts.length} artifact(s) were opened and ZERO libraries were successfully read.`,
      'A scan that reached nothing prints the same thing as a scan that found nothing wrong.',
    ]);
  }
  if (segmentsChecked === 0) {
    coverageLost([
      `${librariesRead} library(ies) were read across ${artifacts.length} artifact(s) and ZERO 64-bit LOAD segments were compared.`,
      `${exempt32} of them were 32-bit and exempt, so the requirement — which is about 64-bit devices — ranged over nothing.`,
      'Google Play has required a 64-bit build since 2019, so this is a broken artifact rather than a passing one.',
    ]);
  }
}
if (exempt32 > 0) {
  prints.push(
    `${exempt32} library(ies) are 32-bit and are EXEMPT, not checked: the cited requirement is about 64-bit devices, and ` +
      'holding armeabi-v7a or x86 to a 16 KB page would fail an upload Play accepts.',
  );
}

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  [pipeline K-13] the floor and its citation live in tooling/legal/duty-matrix.json →');
  console.error(`  duties["${DUTY_ID}"]. Rebuild with a 16 KB-aligned NDK, or pass -Wl,-z,max-page-size=16384.`);
  console.error('\nassert-elf-page-alignment: FAILED');
  process.exit(1);
}

console.log('');
console.log(
  `assert-elf-page-alignment: OK — ${segmentsChecked} 64-bit LOAD segment(s) across ${librariesRead} library(ies) in ` +
    `${artifacts.length} artifact(s), every one aligned to at least ${FLOOR} (${pow2(FLOOR)}); abi(s) seen: ${[...abisSeen].sort().join(', ')}`,
);
