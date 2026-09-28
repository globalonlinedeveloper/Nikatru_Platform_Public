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
// Every committed pack is therefore REBUILT from its recipe on every push and
// compared BYTE FOR BYTE with what is committed, signature included — one
// declared (recipe -> produced pack) pair each in PAIRS below: the frozen format
// fixture packages/core/test/fixtures/pack/v1/, and (ST-X5) the service
// catalogue bundled at apps/subscriptiontracker/assets/content_pack/. Ed25519 is
// deterministic and the test key is derived rather than committed, so the
// signature is reproducible anywhere; any drift in the emitter, the canonical
// serialiser or the content is a red build here. A declared pair whose recipe or
// pack is missing, a recipe under examples/ with no pair, or an app-bundled pack
// with no recipe is COVERAGE LOST (exit 2): the domain can only shrink out loud.
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
import { dirname, join, relative, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';

import { PROVENANCE_REQUIRED_FIELDS, emitPack, writeManifest } from '../content_pipeline/src/pack.mjs';
import { TEST_KEY_ID, keyPairFromSeed, signPack, testSeed, verifyWithPinnedKey } from '../content_pipeline/src/sign.mjs';
import { walk } from '../content_pipeline/src/pack.mjs';
import { PRODUCED_PACKS } from '../content_pipeline/src/gates.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const FIXTURES = join(repoRoot, 'packages', 'core', 'test', 'fixtures', 'pack');
const EXAMPLES = join(repoRoot, 'tooling', 'content_pipeline', 'examples');
const APPS = join(repoRoot, 'apps');

/** 🔴 THE DOMAIN, DECLARED: every (recipe -> committed produced pack) pair.
 *  Each is rebuilt with the test key and compared byte for byte, signature
 *  included, and each gets its own provenance-mutation loop. The list lives in
 *  content_pipeline/src/gates.mjs (PRODUCED_PACKS), because the review and
 *  publish gates judge the same pairs. Two kinds of pack
 *  are committed and both must be reproducible from their recipe:
 *    · the FROZEN FORMAT fixture (v1/), whose job is to prove an old manifest
 *      shape still loads — see MANIFEST_FORMATS below;
 *    · a pack BUNDLED INTO AN APP (ST-X5), which ships inside the binary and is
 *      read with requireSignature:false. A bundled pack nobody can rebuild is a
 *      snapshot, and a snapshot is exactly what "the signer signs the bytes it
 *      wrote" cannot be checked against.
 *  The list is checked against the TREE in both directions below, so a recipe
 *  with no pair, or a bundled pack with no recipe, is COVERAGE LOST rather than a
 *  pack this guard quietly stopped rebuilding. */
const PAIRS = PRODUCED_PACKS;

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
  process.exit(2);
};

// ── the domain: every declared pair exists, and the tree has no undeclared one ─
const rel = (p) => relative(repoRoot, p).split('\\').join('/');
for (const pair of PAIRS) {
  const recipe = join(repoRoot, ...pair.recipe.split('/'));
  const produced = join(repoRoot, ...pair.produced.split('/'));
  if (!existsSync(recipe)) {
    coverageLost(
      `${pair.recipe} does not exist, so ${pair.what} has no recipe to rebuild it from.`,
      'A committed pack nobody can reproduce is a snapshot, and "the round trip passed" would mean "it skipped one".',
    );
  }
  if (!existsSync(join(produced, 'manifest.json'))) {
    coverageLost(
      `${pair.produced}/manifest.json does not exist, so ${pair.what} was compared to nothing.`,
      'The pair is declared; the produced pack it names is gone. Rebuild it (cli.mjs build --test-key) or retire the pair.',
    );
  }
}
const declaredRecipes = new Set(PAIRS.map((p) => p.recipe));
const recipesOnDisk = existsSync(EXAMPLES)
  ? listDir(EXAMPLES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(EXAMPLES, e.name, 'recipe.json')))
      .map((e) => rel(join(EXAMPLES, e.name, 'recipe.json')))
  : [];
for (const r of recipesOnDisk) {
  if (!declaredRecipes.has(r)) {
    coverageLost(
      `${r} is a recipe with no declared (recipe -> produced pack) pair in PAIRS.`,
      'Its pack is either committed somewhere this guard does not rebuild, or not committed at all; either way',
      'the round trip does not cover it. Declare the pair.',
    );
  }
}
const declaredProduced = new Set(PAIRS.map((p) => p.produced));
const bundledOnDisk = existsSync(APPS)
  ? listDir(APPS, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(APPS, e.name, 'assets', 'content_pack', 'manifest.json')))
      .map((e) => rel(join(APPS, e.name, 'assets', 'content_pack')))
  : [];
for (const b of bundledOnDisk) {
  if (!declaredProduced.has(b)) {
    coverageLost(
      `${b} is a pack bundled into an app with no declared recipe in PAIRS.`,
      'It ships inside the binary and nothing proves it is what its recipe produces. Declare the pair.',
    );
  }
}

// ── the frozen formats ──────────────────────────────────────────────────────
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
for (const fmt of MANIFEST_FORMATS) {
  if (!declaredProduced.has(`packages/core/test/fixtures/pack/${fmt.dir}`)) {
    coverageLost(
      `frozen format ${fmt.dir}/ has no declared recipe in PAIRS, so it is never rebuilt.`,
      'A frozen fixture that is not re-derived is a snapshot nobody checks — the thing this guard exists to prevent.',
    );
  }
}

// ── the test key must not be a key any shipped binary trusts ───────────────
const { publicKeyBase64 } = keyPairFromSeed(testSeed());
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
if (PROVENANCE_REQUIRED_FIELDS.length !== 5) {
  coverageLost(
    `PROVENANCE_REQUIRED_FIELDS declares ${PROVENANCE_REQUIRED_FIELDS.length} field(s), not the five P-6 names.`,
    'The copyright argument, the independent-creation argument and the AI-Act evidence trail each rest on a',
    'DIFFERENT field, so proving the row exists proves none of them.',
  );
}

// ── per pair: rebuild byte for byte, verify, mutate provenance ─────────────
const tmp = mkdtempSync(join(tmpdir(), 'nikatru-pack-'));
let rebuilt = 0;
let pairsCompared = 0;
let mutationsRefused = 0;
try {
  for (const [pi, pair] of PAIRS.entries()) {
    const RECIPE = join(repoRoot, ...pair.recipe.split('/'));
    const SRC_DIR = dirname(RECIPE);
    const frozenDir = join(repoRoot, ...pair.produced.split('/'));
    const tag = pair.produced;
    let rebuiltHere = 0;

    const out = join(tmp, `pair-${pi}`);
    const r = emitPack(RECIPE, out);
    const bytes = writeManifest(out, { ...r.manifest, key_id: TEST_KEY_ID });
    signPack({ outDir: out, manifestBytes: bytes, keyId: TEST_KEY_ID, seed: testSeed(), repoRoot });

    const a = walk(out);
    const b = walk(frozenDir);
    const onlyBuilt = a.filter((m) => !b.includes(m));
    const onlyFrozen = b.filter((m) => !a.includes(m));
    for (const m of onlyBuilt) problems.push(`${tag}: the rebuilt pack contains "${m}" and the committed pack does not`);
    for (const m of onlyFrozen) problems.push(`${tag}: the committed pack contains "${m}" and a rebuild does not produce it`);
    for (const m of a.filter((x) => b.includes(x))) {
      const x = readFileSync(join(out, m));
      const y = readFileSync(join(frozenDir, m));
      if (!x.equals(y)) {
        problems.push(
          `${tag}: ${m} DRIFTED — the rebuild produced ${x.length} byte(s) and the committed pack holds ${y.length}. ` +
            (m === 'manifest.sig'
              ? 'Ed25519 is deterministic, so a different signature means the SIGNED MESSAGE changed: the emitter and the committed pack no longer agree about the manifest bytes. That is the exact defect this guard exists for.'
              : tag.startsWith('packages/core/test/fixtures/pack/')
                ? 'Re-freeze deliberately (a new vN/ for a format change), never by overwriting v1/.'
                : `Rebuild it from ${pair.recipe} with cli.mjs build --test-key and commit the result — never hand-edit a produced pack.`),
        );
      }
      rebuiltHere++;
    }
    if (rebuiltHere === 0) coverageLost(`${tag}: not one member was byte-compared, so its round trip "passed" on nothing.`);
    rebuilt += rebuiltHere;

    // ── the signature verifies over the bytes AS WRITTEN ────────────────────
    const manifestOnDisk = readFileSync(join(frozenDir, 'manifest.json'));
    const sigOnDisk = existsSync(join(frozenDir, 'manifest.sig')) ? readFileSync(join(frozenDir, 'manifest.sig')) : Buffer.alloc(0);
    if (!verifyWithPinnedKey(publicKeyBase64, manifestOnDisk, sigOnDisk)) {
      problems.push(`${tag}: manifest.sig does NOT verify over manifest.json as written. A pack in this state loads on nothing.`);
    }
    // …and one flipped byte must be refused. Proven, not assumed.
    const tampered = Buffer.from(manifestOnDisk);
    tampered[tampered.length - 3] ^= 0x01;
    if (verifyWithPinnedKey(publicKeyBase64, tampered, sigOnDisk)) {
      problems.push(`${tag}: a manifest with ONE FLIPPED BYTE still verified. The signature is not binding the bytes.`);
    }

    // ── P-6: five recorded failing cases per recipe, one per provenance field ─
    // 🔴 THE MUTATION IS AGAINST THE REAL LOG AND THE RESTORE IS BYTE-FOR-BYTE.
    // Re-serialising on the way back would leave the tree dirty on every run —
    // a guard that edits the repository is a guard somebody switches off, and the
    // diff would be indistinguishable from a real change.
    const logPath = join(SRC_DIR, 'generation-log.json');
    const realBytes = readFileSync(logPath);
    const realLog = JSON.parse(realBytes.toString('utf8'));
    for (const field of PROVENANCE_REQUIRED_FIELDS) {
      const mutant = structuredClone(realLog);
      delete mutant.items[0][field];
      writeFileSync(logPath, `${JSON.stringify(mutant, null, 2)}\n`);
      let refused = null;
      try {
        emitPack(RECIPE, join(tmp, `mut-${pi}-${field}`));
      } catch (e) {
        refused = e.message;
      } finally {
        writeFileSync(logPath, realBytes);
      }
      if (refused === null) problems.push(`${tag}: deleting provenance field "${field}" from a real row was ACCEPTED — the pack would ship without it`);
      else if (!refused.includes(field)) problems.push(`${tag}: deleting "${field}" was refused without naming it: ${refused.split('\n')[1] ?? refused.split('\n')[0]}`);
      else mutationsRefused++;
    }
    if (!readFileSync(logPath).equals(realBytes)) {
      problems.push(`${tag}: the provenance mutation loop did not restore ${rel(logPath)} byte-for-byte. Fix that before trusting anything above.`);
    }

    // ── manifest.generators ⊆ the models PROVENANCE.json names ──────────────
    const prov = JSON.parse(readFileSync(join(frozenDir, 'PROVENANCE.json'), 'utf8'));
    const named = new Set((prov.items ?? []).map((i) => i.generator_model_id));
    const manifest = JSON.parse(manifestOnDisk.toString('utf8'));
    for (const g of manifest.generators ?? []) {
      if (!named.has(g)) problems.push(`${tag}: manifest.generators names "${g}" and no PROVENANCE.json row does. Cheap to check now, unreconstructable later.`);
    }
    if ((manifest.generators ?? []).length === 0 && named.size > 0) {
      problems.push(`${tag}: manifest.generators is empty while PROVENANCE.json names generators — the provenance trail is not reaching the signed document`);
    }
    if (prov.content_hash !== manifest.content_hash) {
      problems.push(`${tag}: PROVENANCE.json names content_hash ${prov.content_hash} and the manifest says ${manifest.content_hash} — the provenance describes a different pack`);
    }
    if ((prov.items ?? []).length === 0) coverageLost(`${tag}: PROVENANCE.json carries no rows, so every provenance relationship above compared empty sets.`);
    pairsCompared++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (rebuilt === 0) coverageLost('not one member was byte-compared, so "the round trip passed" would mean "it ran on nothing".');
if (pairsCompared !== PAIRS.length) {
  coverageLost(`${pairsCompared} of ${PAIRS.length} declared pair(s) were compared. A pair that was skipped is a pack nobody rebuilt.`);
}

if (problems.length) {
  console.error(`✗ pack round-trip — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
if (prints.length) for (const p of prints) console.log(`⬜ ${p}`);
console.log(
  `ok  pack round-trip — ${pairsCompared} (recipe -> committed pack) pair(s) compared ` +
    `(${PAIRS.map((p) => p.produced).join(', ')}); ${rebuilt} member(s) rebuilt byte-identical (signatures included); ` +
    `every signature verifies over manifest.json as written and refuses one flipped byte; ` +
    `${mutationsRefused} provenance deletion(s) refused by name (${PROVENANCE_REQUIRED_FIELDS.length} field(s) × ${pairsCompared} real log(s)); ` +
    `${frozen.length} frozen format(s) for ${MANIFEST_FORMATS.length} shipped manifest format(s)`,
);
