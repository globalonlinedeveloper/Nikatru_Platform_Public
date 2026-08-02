// ─────────────────────────────────────────────────────────────────────────────
// pack.mjs — [pipeline 7]P-9 (producer half) + P-6 (provenance) + P-14 (formats).
//
// Emits the exact [ADR 007] layout:
//   manifest.json · content.json · assets/ · PROVENANCE.json   (+ manifest.sig, from sign.mjs)
//
// 🔴 THE MANIFEST IS SERIALISED ONCE. `emitPack` returns the manifest BYTES it
// wrote, and sign.mjs signs those bytes. Nothing re-derives the document. A
// re-serialisation with different key order or whitespace produces a pack that
// verifies on this machine and fails on every client in the field, and the only
// thing that catches it is a round-trip through the real loader — by which point
// the pack is already on a CDN.
//
// 🔴 PROVENANCE IS NOT DECORATION AND ITS FIVE FIELDS ARE NOT INTERCHANGEABLE.
//   generator_model_id  → which model, for the [ADR 019] risk tiering
//   generated_at        → when, for the independent-creation argument
//   prompt              → what was asked, which is the NO-IP-PROMPTING evidence
//   marking             → SynthID present or absent WITH A REASON; on audio this
//                         log is the ONLY marking evidence that exists, because
//                         Chirp 3 HD applies no watermark at all
//   review_verdict_ref  → the human verdict, which is the copyright moat
// Each rests a different argument. Proving the row exists proves none of them, so
// each field is its own recorded failing case.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { MANIFEST_KEY_ORDER, canonicalJson, sha256Hex } from './canonical.mjs';
import { classifyAsset } from './formats.mjs';
import { ipSteeringViolations } from './prompts.mjs';
import { localeShardProblems, validateRecipe } from './recipe.mjs';

export const PROVENANCE_REQUIRED_FIELDS = Object.freeze([
  'generator_model_id',
  'generated_at',
  'prompt',
  'marking',
  'review_verdict_ref',
]);

/** generator -> whether that generator's output carries a machine-readable mark.
 *
 *  🔴 KEYED ON THE GENERATOR, NEVER ON THE MODALITY. A check asserting "SynthID
 *  survived" on a Chirp asset asserts that a mark which was NEVER APPLIED was not
 *  removed — it can only pass. Chirp 3 HD carries no SynthID and the vendor doc
 *  mentions neither SynthID nor watermarking (settled in the negative; see
 *  PROJECT_STATE 2026-07-25). So `none` is a legitimate value that must be
 *  DECLARED with a reason, and the count of unmarked items is PRINTED every run
 *  rather than hidden, because that count is the EU AI-Act Art. 50 exposure. */
export const GENERATOR_MARKING = Object.freeze({
  'google/gemini-image': 'synthid',
  'google/gemini-text': 'none:text output carries no SynthID image/audio watermark; PROVENANCE.json is the marking record',
  'google/chirp-3-hd': 'none:Chirp 3 HD applies no watermark — verified against the vendor doc, which mentions neither SynthID nor watermarking. PROVENANCE.json is the ONLY marking evidence for audio.',
  'none/hand-authored': 'none:not model output — a person wrote it, so there is no generated-content marking duty to discharge',
  'none/hand-constructed': 'none:not model output — deterministic bytes assembled by tooling, no model involved',
});

class PackError extends Error {}
const fail = (problems) => {
  throw new PackError(`pack REFUSED — ${problems.length} problem(s):\n${problems.map((p) => `    ${p}`).join('\n')}`);
};

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else out.push(relative(base, abs).split('\\').join('/'));
  }
  return out;
}

/**
 * Build a pack from a recipe directory.
 *
 * @param {string} recipePath  path to recipe.json
 * @param {string} outDir      where the pack is written (created; must be empty or overwritten)
 * @returns {{manifestBytes:Buffer, contentBytes:Buffer, manifest:object, outDir:string, provenance:object}}
 */
export function emitPack(recipePath, outDir) {
  const srcDir = dirname(resolve(recipePath));
  const recipe = validateRecipe(JSON.parse(readFileSync(recipePath, 'utf8')));
  const problems = [];

  // ── content.json, assembled from one file per locale ──────────────────────
  const content = {};
  for (const locale of recipe.locales) {
    const p = join(srcDir, 'content', `${locale}.json`);
    if (!existsSync(p)) {
      problems.push(`content/${locale}.json is declared in the recipe and absent from ${relative(process.cwd(), srcDir)}`);
      continue;
    }
    content[locale] = JSON.parse(readFileSync(p, 'utf8'));
  }
  problems.push(...localeShardProblems(recipe, content));

  // Every text item must be a real key in every shard, and every shard key must
  // be a declared item. Without the second direction a shard can carry content
  // that no item declares, so no provenance row and no review verdict covers it.
  const textIds = recipe.items.filter((i) => i.modality === 'text').map((i) => i.id).sort();
  for (const locale of Object.keys(content)) {
    const shard = content[locale] ?? {};
    for (const id of textIds) if (!(id in shard)) problems.push(`content/${locale}.json has no entry for text item "${id}"`);
    for (const k of Object.keys(shard)) if (!textIds.includes(k)) problems.push(`content/${locale}.json carries key "${k}", which no recipe item declares`);
  }

  // ── the generation log -> PROVENANCE.json ─────────────────────────────────
  const logPath = join(srcDir, 'generation-log.json');
  if (!existsSync(logPath)) problems.push('generation-log.json is absent — there is no provenance to emit, and a pack without it is unshippable evidence-wise');
  const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : { items: [] };
  const logById = new Map((log.items ?? []).map((r) => [r.item_id, r]));

  const provenanceItems = [];
  for (const item of recipe.items) {
    const row = logById.get(item.id);
    if (!row) {
      problems.push(`generation-log.json has no entry for item "${item.id}" — every produced item needs a provenance row (P-2: count(prompt entries) == count(items))`);
      continue;
    }
    for (const f of PROVENANCE_REQUIRED_FIELDS) {
      if (row[f] === undefined || row[f] === null || row[f] === '') {
        problems.push(`generation-log.json "${item.id}": missing "${f}" — each of the five fields rests a DIFFERENT argument, so none substitutes for another`);
      }
    }
    // [ADR 019] applied to the log, not only to the submission. A prompt that
    // steered toward IP and produced an asset we then shipped is the exposure.
    for (const v of ipSteeringViolations(row.prompt)) {
      problems.push(`generation-log.json "${item.id}": prompt ${v.id} — matched "${v.match}". ${v.adr}`);
    }
    // marking must AGREE with the declared generator -> marking table.
    const declaredMark = GENERATOR_MARKING[row.generator_model_id];
    if (declaredMark === undefined) {
      problems.push(
        `generation-log.json "${item.id}": generator "${row.generator_model_id}" is not in GENERATOR_MARKING. ` +
          'A generator with no declared marking behaviour cannot have its marking claim checked, so the claim would be free text.',
      );
    } else {
      const expected = declaredMark.split(':')[0];
      if (row.marking !== expected) {
        problems.push(
          `generation-log.json "${item.id}": marking "${row.marking}" contradicts the declared behaviour of ${row.generator_model_id} ("${expected}")`,
        );
      }
      if (expected === 'none' && !String(row.marking_reason ?? '').trim()) {
        problems.push(`generation-log.json "${item.id}": marking is "none" with no marking_reason. An unmarked item is the EU AI-Act Art. 50 exposure; it must say why.`);
      }
    }
    provenanceItems.push({
      item_id: item.id,
      modality: item.modality,
      generator_model_id: row.generator_model_id,
      generated_at: row.generated_at,
      prompt: row.prompt,
      marking: row.marking,
      marking_reason: row.marking_reason ?? '',
      review_verdict_ref: row.review_verdict_ref,
    });
  }
  for (const id of logById.keys()) {
    if (!recipe.items.some((i) => i.id === id)) problems.push(`generation-log.json describes "${id}", which the recipe does not produce`);
  }

  // ── assets: bytes decide the format, and the recipe decides the set ───────
  const assetsSrc = join(srcDir, 'assets');
  const declaredAssets = recipe.items.filter((i) => i.asset).map((i) => i.asset).sort();
  const foundAssets = walk(assetsSrc);
  for (const a of foundAssets) {
    if (!declaredAssets.includes(a)) problems.push(`assets/${a} is on disk and no recipe item declares it — an undeclared asset has no provenance row and no review verdict`);
  }
  const manifestAssets = [];
  for (const rel of declaredAssets) {
    const abs = join(assetsSrc, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      problems.push(`assets/${rel} is declared by a recipe item and is not on disk`);
      continue;
    }
    const bytes = readFileSync(abs);
    const verdict = classifyAsset(rel, bytes);
    if (!verdict.ok) problems.push(`assets/${rel}: ${verdict.reason}`);
    else {
      const item = recipe.items.find((i) => i.asset === rel);
      if (item && verdict.modality !== item.modality) {
        problems.push(`assets/${rel}: bytes are ${verdict.format} (${verdict.modality}) but item "${item.id}" declares modality "${item.modality}"`);
      }
    }
    manifestAssets.push({ path: rel, sha256: sha256Hex(bytes) });
  }

  if (problems.length) fail(problems);

  // ── write ────────────────────────────────────────────────────────────────
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const contentBytes = canonicalJson(content);
  writeFileSync(join(outDir, 'content.json'), contentBytes);

  for (const rel of declaredAssets) {
    const dest = join(outDir, 'assets', rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(assetsSrc, rel)));
  }

  // `generators` is DERIVED from the provenance rows, so manifest.generators ⊆
  // the models PROVENANCE.json names holds by construction and the guard's
  // assertion of it can only fail if somebody edits one of the two by hand.
  const generators = [...new Set(provenanceItems.map((r) => r.generator_model_id))].sort();

  const manifest = {
    pack_id: recipe.pack_id,
    version: recipe.pack_version,
    key_id: '',
    content_hash: sha256Hex(contentBytes),
    assets: manifestAssets,
    generators,
    locales: [...recipe.locales],
  };
  const provenance = {
    pack_id: manifest.pack_id,
    version: manifest.version,
    content_hash: manifest.content_hash,
    generator_marking: Object.fromEntries(generators.map((g) => [g, GENERATOR_MARKING[g]])),
    items: provenanceItems.sort((a, b) => a.item_id.localeCompare(b.item_id)),
  };
  writeFileSync(join(outDir, 'PROVENANCE.json'), canonicalJson(provenance));

  return { manifest, provenance, contentBytes, outDir, recipe };
}

/** Serialise the manifest ONCE and write it. Returns the exact bytes on disk, so
 *  the caller signs what a client will read rather than a second rendering. */
export function writeManifest(outDir, manifest) {
  const bytes = canonicalJson(manifest, MANIFEST_KEY_ORDER);
  writeFileSync(join(outDir, 'manifest.json'), bytes);
  return bytes;
}

export { PackError, walk };
