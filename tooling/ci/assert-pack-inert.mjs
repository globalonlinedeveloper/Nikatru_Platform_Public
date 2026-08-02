#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-pack-inert.mjs — [pipeline 7]P-7 (a pack is provably inert data) and
// P-14 (the optimize stage emits only the locked formats). ONE allowlist serves
// both; two allowlists is how they drift.
//
// 🔴 MEMBER WHITELIST, NOT TWO PATHS. P-7's original scope was `content.json` and
// `assets/`, and its own worked example — a root-level `.js` — is in neither, so
// the example walks straight past the criterion written to catch it. Every file
// in the pack is enumerated and anything outside {manifest.json, manifest.sig,
// content.json, PROVENANCE.json, assets/**} fails.
//
// 🔴 BYTES, NEVER EXTENSIONS, IN BOTH DIRECTIONS. A `.mp3` holding WebP bytes and
// a `.webp` holding MP3 bytes are the same defect — a file lying about itself —
// and only one of them is caught by looking at bytes alone.
//
// 🔴 THE ALLOWLIST DOES NOT CARRY THE ISOBMFF/AVIF SIGNATURE, AND THAT OMISSION
// IS THE ENFORCEMENT. AVIF was cut 2026-07-29 because Flutter cannot decode it
// (flutter/flutter#61229, open since 2020). TRIGGER: AVIF returns the day that
// issue closes — not because an encoder produced a smaller file.
//
// Apple App Store Review Guidelines **2.5.2** (no downloading or executing code
// that introduces or changes features) and **4.7** (mini apps / plug-ins, and its
// conditions) are cited BY NUMBER per 39-CHASSIS §5.16 so the over-compliance
// framing is not re-litigated from memory. A content pack carries no code and is
// not a mini-app, so 4.7's conditions never arise — which is exactly why this is
// bytes-only and deliberately stricter than either clause requires.
//
// Usage:  node tooling/ci/assert-pack-inert.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';

import { FORMAT_ALLOWLIST, KNOWN_REFUSED } from '../content_pipeline/src/formats.mjs';
import { inspectPack } from '../content_pipeline/src/inert.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const FIXTURES = join(repoRoot, 'packages', 'core', 'test', 'fixtures', 'pack');

const problems = [];
const prints = [];
const coverageLost = (...lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── the domain ───────────────────────────────────────────────────────────────
const packs = existsSync(FIXTURES)
  ? listDir(FIXTURES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(FIXTURES, e.name, 'manifest.json')))
      .map((e) => join(FIXTURES, e.name))
  : [];
if (packs.length === 0) {
  coverageLost(
    `no pack under ${relative(repoRoot, FIXTURES)}/*/manifest.json.`,
    'Every limb here enumerates a pack. With none, this guard reports every pack inert having opened none.',
  );
}
if (FORMAT_ALLOWLIST.length === 0) coverageLost('the format allowlist is empty, so every asset would be refused and the guard would fail for the wrong reason.');

// AVIF must stay out. This is the cut, mechanised.
if (FORMAT_ALLOWLIST.some((f) => f.format === 'avif')) {
  problems.push(
    'the allowlist carries AVIF. That reverses a written cut (2026-07-29): Flutter cannot decode AVIF — flutter/flutter#61229, ' +
      'open since 2020 — so an AVIF asset ships an image no client can render. It returns when that issue closes.',
  );
}
if (FORMAT_ALLOWLIST.some((f) => f.modality === 'video')) {
  problems.push('the allowlist carries a video format. Video is DORMANT (39-CHASSIS §4 cut 8, an unanswered owner scope question); building for it reverses the cut.');
}

// ── 🔴 EVERY BINARY PACK MEMBER MUST BE MARKED `binary` IN .gitattributes ────
// The repo normalises line endings with `* text=auto eol=lf`, and `text=auto`
// decides binary-ness by looking for a NUL byte in the first 8000. An Ed25519
// signature is 64 bytes of uniform noise: the one committed today contains no
// NUL, so git calls manifest.sig TEXT and eol=lf becomes live on it. It is
// harmless only because that signature also happens to contain no 0x0D and no
// 0x0A — and the signature changes every time the pack does, with roughly a one
// in four chance of carrying one. On that run, checkout rewrites the signature
// and every client rejects a correctly signed pack while `git status` shows
// nothing. Found 2026-08-02 by checking rather than by being bitten.
const attributesPath = join(repoRoot, '.gitattributes');
if (!existsSync(attributesPath)) {
  coverageLost(
    '.gitattributes does not exist, so the binary-marking check below asserted nothing.',
    'With `* text=auto eol=lf` in force elsewhere, an unmarked signature is one CR away from silent corruption.',
  );
}
const attributes = readFileSync(attributesPath, 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');
const MUST_BE_BINARY = ['.sig', ...new Set(FORMAT_ALLOWLIST.flatMap((f) => f.extensions))];
for (const ext of MUST_BE_BINARY) {
  if (!new RegExp(`^\\s*\\*\\${ext}\\s+binary\\s*$`, 'm').test(attributes)) {
    problems.push(
      `.gitattributes does not mark "*${ext}" as binary. Under \`* text=auto eol=lf\` a file with no NUL byte is ` +
        'treated as TEXT and its CR/LF bytes are rewritten on checkout — which for a signature or a codec header is ' +
        'silent corruption with no diff to see.',
    );
  }
}

let assetsChecked = 0;
let membersChecked = 0;
for (const dir of packs) {
  const rel = relative(repoRoot, dir).split('\\').join('/');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const r = inspectPack(dir, manifest);
  if (r.coverageLost) coverageLost(`${rel}: ${r.coverageLost}`);
  for (const p of r.problems) problems.push(`${rel}: ${p}`);
  membersChecked += r.members.length;
  assetsChecked += r.assetVerdicts.length;
}
if (assetsChecked === 0) {
  coverageLost(
    'not one asset was classified across every pack found.',
    'The magic-byte allowlist is the half of this guard that can catch a real off-format file, and a pack with',
    'no binary asset exercises none of it — so a text-only fixture would silently retire the whole limb.',
  );
}

// ── SIX RECORDED FAILING CASES, MUTATED ONTO A COPY OF THE REAL PACK ────────
// Not a fixture written beside the guard: a fixture you wrote encodes the same
// misunderstanding as the guard you wrote. Each case is planted into a scratch
// COPY of a real committed pack and must be caught.
const tmp = mkdtempSync(join(tmpdir(), 'nikatru-inert-'));
let caught = 0;
try {
  const cases = [
    {
      name: 'root-level .js (P-7\'s own worked example)',
      apply: (d) => writeFileSync(join(d, 'loader.js'), 'export const x = 1;\n'),
      expect: /loader\.js is not a member/,
    },
    {
      name: 'an undeclared extra member under assets/',
      apply: (d) => writeFileSync(join(d, 'assets', 'stowaway.webp'), Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8L', 'latin1')),
      expect: /manifest\.assets does not declare it/,
    },
    {
      name: 'extension/bytes mismatch — WebP bytes named .mp3',
      apply: (d) => {
        const webp = readFileSync(join(d, 'assets', 'badge', 'streak.webp'));
        writeFileSync(join(d, 'assets', 'tone', 'confirm.mp3'), webp);
      },
      expect: /extension and content disagree|manifest sha256/,
    },
    {
      name: 'LINEAR16 / WAV — the realistic off-format audio asset',
      apply: (d) => writeFileSync(join(d, 'assets', 'tone', 'confirm.mp3'), riff('WAVE')),
      expect: /WAV \/ LINEAR16/,
    },
    {
      name: 'Opus-in-Ogg',
      apply: (d) => writeFileSync(join(d, 'assets', 'tone', 'confirm.mp3'), Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(60)])),
      expect: /Ogg \(Opus\/Vorbis\)/,
    },
    {
      name: 'AVIF',
      apply: (d) =>
        writeFileSync(
          join(d, 'assets', 'badge', 'streak.webp'),
          Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif', 'latin1'), Buffer.alloc(20)]),
        ),
      expect: /AVIF \(ISOBMFF\)/,
    },
  ];
  for (const [i, c] of cases.entries()) {
    const d = join(tmp, `case-${i}`);
    mkdirSync(d, { recursive: true });
    cpSync(packs[0], d, { recursive: true });
    c.apply(d);
    const manifest = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'));
    const r = inspectPack(d, manifest);
    const all = [...(r.coverageLost ? [r.coverageLost] : []), ...r.problems].join('\n');
    if (!c.expect.test(all)) {
      problems.push(`NOT CAUGHT — "${c.name}" was planted into a copy of a real pack and inspectPack said: ${all || '(nothing)'}`);
    } else caught++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (caught < 6) prints.push(`${caught} of 6 planted cases caught — see the failures above`);

function riff(form) {
  const b = Buffer.alloc(64);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(56, 4);
  b.write(form, 8, 'latin1');
  return b;
}

if (problems.length) {
  console.error(`✗ pack inertness — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
if (prints.length) for (const p of prints) console.log(`⬜ ${p}`);
console.log(
  `ok  pack inertness — ${packs.length} pack(s), ${membersChecked} member(s) whitelisted, ${assetsChecked} asset(s) classified by BYTES ` +
    `against ${FORMAT_ALLOWLIST.length} locked format(s) (${FORMAT_ALLOWLIST.map((f) => f.format).join(', ')}); ` +
    `${caught}/6 planted cases caught, including ${KNOWN_REFUSED.length} named refusals; AVIF and video absent by cut`,
);
