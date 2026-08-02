#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-pack-roundtrip.mjs — [pipeline 7]P-9 (producer half) + P-6 (provenance)
// + P-11 (a format change never strands a shipped binary).
//
// 🔴 THE FAILURE THIS EXISTS FOR: a signer that signs a RE-SERIALISATION instead
// of the bytes it wrote. Key order, whitespace and the trailing newline are all
// part of the signed message, so the pack verifies perfectly on the machine that
// made it and fails on every installed app — and nothing except a real loader
// reading the real bytes will tell you.
//
// The pack is therefore REBUILT from the committed recipe on every push and
// compared BYTE FOR BYTE with packages/core/test/fixtures/pack/v1/, signature
// included. Ed25519 is deterministic and the test key is derived rather than
// committed, so the signature is reproducible anywhere; any drift in the emitter,
// the canonical serialiser or the content is a red build here.
//
// ⚠️ WHAT THIS CANNOT DO, stated rather than implied. The CI round-trip uses a
// TEST keypair by design — the production seed must never reach a runner — so it
// can never go red on the two failures that would strand every user: a seed that
// no longer matches pinned `k1`, or a signer writing different bytes than it
// signed IN PRODUCTION. Those need the local canary, and the canary is owner-run
// ([ADR 022] / tooling/legal/pack-key-drills.json).
//
// ⚠️ AND THE REAL CLIENT LOADER IS DART. The strongest half of this round trip is
// packages/core/test/content_pack_fixture_test.dart, which loads THIS committed
// pack through ContentPackLoader.loadFrom(requireSignature: true) in the
// workspace_gate lane. This guard proves the pack is reproducible and that its
// signature verifies against the same base64-raw-32-byte encoding
// kContentPackPublicKeys pins; the Dart test proves the client accepts it. Both,
// because either alone leaves a gap the other covers.
//
// Usage:  node tooling/ci/assert-pack-roundtrip.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';

import { PROVENANCE_REQUIRED_FIELDS, emitPack, writeManifest } from '../content_pipeline/src/pack.mjs';
import { TEST_KEY_ID, keyPairFromSeed, signPack, testSeed, verifyWithPinnedKey } from '../content_pipeline/src/sign.mjs';
import { walk } from '../content_pipeline/src/pack.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const FIXTURES = join(repoRoot, 'packages', 'core', 'test', 'fixtures', 'pack');
const RECIPE = join(repoRoot, 'tooling', 'content_pipeline', 'examples', 'lingo-phrases', 'recipe.json');
const SRC_DIR = join(repoRoot, 'tooling', 'content_pipeline', 'examples', 'lingo-phrases');

/** EVERY MANIFEST FORMAT EVER SHIPPED. A frozen fixture per entry, so the current
 *  parser is proven against every shape a released binary might have written.
 *  Adding a manifest field means adding v2/ — never editing v1/, because v1/ IS
 *  the evidence that the old shape still loads. */
const MANIFEST_FORMATS = Object.freeze([
  Object.freeze({
    dir: 'v1',
    since: '[ADR 007] + [ADR 016]',
    keys: ['pack_id', 'version', 'key_id', 'content_hash', 'assets', 'generators', 'locales'],
  }),
]);

const problems = [];
const prints = [];
const coverageLost = (...lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── the produced-pack set must not be empty ─────────────────────────────────
if (!existsSync(RECIPE)) coverageLost(`${relative(repoRoot, RECIPE)} does not exist, so nothing was produced and "the round trip passed" would mean "it ran on nothing".`);
const frozen = existsSync(FIXTURES)
  ? listDir(FIXTURES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : [];
if (frozen.length === 0) {
  coverageLost(
    `no frozen fixture pack under ${relative(repoRoot, FIXTURES)}.`,
    'Every comparison below is against one. With none, this guard rebuilds a pack and compares it to nothing.',
  );
}
if (frozen.length < MANIFEST_FORMATS.length) {
  coverageLost(
    `${MANIFEST_FORMATS.length} manifest format(s) have shipped and only ${frozen.length} frozen fixture(s) exist: ${frozen.join(', ')}.`,
    '[pipeline 7]P-11 — a format change must never strand a shipped binary, and the evidence that the current',
    'parser still reads an older shape IS the older fixture. Deleting one deletes the proof.',
  );
}
for (const fmt of MANIFEST_FORMATS) {
  const p = join(FIXTURES, fmt.dir, 'manifest.json');
  if (!existsSync(p)) {
    problems.push(`format "${fmt.dir}" (${fmt.since}) has no frozen manifest at ${relative(repoRoot, p)}`);
    continue;
  }
  const keys = Object.keys(JSON.parse(readFileSync(p, 'utf8')));
  const missing = fmt.keys.filter((k) => !keys.includes(k));
  if (missing.length) problems.push(`frozen ${fmt.dir}/manifest.json is missing declared format key(s): ${missing.join(', ')}`);
}

// ── rebuild, byte for byte ──────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'nikatru-pack-'));
let rebuilt = 0;
try {
  const out = join(tmp, 'v1');
  const r = emitPack(RECIPE, out);
  const bytes = writeManifest(out, { ...r.manifest, key_id: TEST_KEY_ID });
  signPack({ outDir: out, manifestBytes: bytes, keyId: TEST_KEY_ID, seed: testSeed(), repoRoot });

  const frozenDir = join(FIXTURES, 'v1');
  const a = walk(out);
  const b = walk(frozenDir);
  const onlyBuilt = a.filter((m) => !b.includes(m));
  const onlyFrozen = b.filter((m) => !a.includes(m));
  for (const m of onlyBuilt) problems.push(`the rebuilt pack contains "${m}" and the frozen fixture does not`);
  for (const m of onlyFrozen) problems.push(`the frozen fixture contains "${m}" and a rebuild does not produce it`);
  for (const m of a.filter((x) => b.includes(x))) {
    const x = readFileSync(join(out, m));
    const y = readFileSync(join(frozenDir, m));
    if (!x.equals(y)) {
      problems.push(
        `${m} DRIFTED — the rebuild produced ${x.length} byte(s) and the frozen fixture holds ${y.length}. ` +
          (m === 'manifest.sig'
            ? 'Ed25519 is deterministic, so a different signature means the SIGNED MESSAGE changed: the emitter and the frozen pack no longer agree about the manifest bytes. That is the exact defect this guard exists for.'
            : 'Re-freeze deliberately (a new vN/ for a format change), never by overwriting v1/.'),
      );
    }
    rebuilt++;
  }

  // ── the signature verifies over the bytes AS WRITTEN ──────────────────────
  const { publicKeyBase64 } = keyPairFromSeed(testSeed());
  const manifestOnDisk = readFileSync(join(frozenDir, 'manifest.json'));
  const sigOnDisk = readFileSync(join(frozenDir, 'manifest.sig'));
  if (!verifyWithPinnedKey(publicKeyBase64, manifestOnDisk, sigOnDisk)) {
    problems.push(
      'the frozen pack\'s manifest.sig does NOT verify over manifest.json as written. A pack in this state loads on nothing.',
    );
  }
  // …and one flipped byte must be refused. Proven, not assumed.
  const tampered = Buffer.from(manifestOnDisk);
  tampered[tampered.length - 3] ^= 0x01;
  if (verifyWithPinnedKey(publicKeyBase64, tampered, sigOnDisk)) {
    problems.push('a manifest with ONE FLIPPED BYTE still verified. The signature is not binding the bytes.');
  }
  // …and the test key must not be a key any shipped binary trusts.
  const pinned = readFileSync(join(repoRoot, 'packages', 'core', 'lib', 'src', 'content', 'pack_verifier.dart'), 'utf8');
  if (pinned.includes(publicKeyBase64)) {
    problems.push(
      `the DERIVED TEST public key is pinned in pack_verifier.dart. A pack CI can sign would then be a pack every ` +
        'shipped binary accepts, which turns a throwaway key into a production one.',
    );
  }
  if (pinned.includes(`'${TEST_KEY_ID}'`)) {
    problems.push(`"${TEST_KEY_ID}" appears in pack_verifier.dart. The test key_id must never be pinned in a shipped binary.`);
  }

  // ── P-6: five recorded failing cases, one per provenance field ────────────
  // 🔴 THE MUTATION IS AGAINST THE REAL LOG AND THE RESTORE IS BYTE-FOR-BYTE.
  // Re-serialising on the way back would leave the tree dirty on every run —
  // a guard that edits the repository is a guard somebody switches off, and the
  // diff would be indistinguishable from a real change.
  const logPath = join(SRC_DIR, 'generation-log.json');
  const realBytes = readFileSync(logPath);
  const realLog = JSON.parse(realBytes.toString('utf8'));
  if (PROVENANCE_REQUIRED_FIELDS.length !== 5) {
    coverageLost(
      `PROVENANCE_REQUIRED_FIELDS declares ${PROVENANCE_REQUIRED_FIELDS.length} field(s), not the five P-6 names.`,
      'The copyright argument, the independent-creation argument and the AI-Act evidence trail each rest on a',
      'DIFFERENT field, so proving the row exists proves none of them.',
    );
  }
  for (const field of PROVENANCE_REQUIRED_FIELDS) {
    const mutant = structuredClone(realLog);
    delete mutant.items[0][field];
    writeFileSync(logPath, `${JSON.stringify(mutant, null, 2)}\n`);
    let refused = null;
    try {
      emitPack(RECIPE, join(tmp, `mut-${field}`));
    } catch (e) {
      refused = e.message;
    } finally {
      writeFileSync(logPath, realBytes);
    }
    if (refused === null) problems.push(`deleting provenance field "${field}" from a real row was ACCEPTED — the pack would ship without it`);
    else if (!refused.includes(field)) problems.push(`deleting "${field}" was refused without naming it: ${refused.split('\n')[1] ?? refused.split('\n')[0]}`);
  }
  if (!readFileSync(logPath).equals(realBytes)) {
    problems.push('the provenance mutation loop did not restore generation-log.json byte-for-byte. Fix that before trusting anything above.');
  }

  // ── manifest.generators ⊆ the models PROVENANCE.json names ────────────────
  const prov = JSON.parse(readFileSync(join(frozenDir, 'PROVENANCE.json'), 'utf8'));
  const named = new Set((prov.items ?? []).map((i) => i.generator_model_id));
  const manifest = JSON.parse(readFileSync(join(frozenDir, 'manifest.json'), 'utf8'));
  for (const g of manifest.generators ?? []) {
    if (!named.has(g)) problems.push(`manifest.generators names "${g}" and no PROVENANCE.json row does. Cheap to check now, unreconstructable later.`);
  }
  if ((manifest.generators ?? []).length === 0 && named.size > 0) {
    problems.push('manifest.generators is empty while PROVENANCE.json names generators — the provenance trail is not reaching the signed document');
  }
  if (prov.content_hash !== manifest.content_hash) {
    problems.push(`PROVENANCE.json names content_hash ${prov.content_hash} and the manifest says ${manifest.content_hash} — the provenance describes a different pack`);
  }
  if ((prov.items ?? []).length === 0) coverageLost('the frozen pack\'s PROVENANCE.json carries no rows, so every provenance relationship above compared empty sets.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (rebuilt === 0) coverageLost('not one member was byte-compared, so "the round trip passed" would mean "it ran on nothing".');

if (problems.length) {
  console.error(`✗ pack round-trip — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
if (prints.length) for (const p of prints) console.log(`⬜ ${p}`);
console.log(
  `ok  pack round-trip — ${rebuilt} member(s) rebuilt byte-identical to the frozen fixture (signature included); ` +
    `signature verifies over manifest.json as written and refuses one flipped byte; ` +
    `${PROVENANCE_REQUIRED_FIELDS.length} provenance field(s) each proven to refuse by deletion from a real row; ` +
    `${frozen.length} frozen format(s) for ${MANIFEST_FORMATS.length} shipped manifest format(s)`,
);
