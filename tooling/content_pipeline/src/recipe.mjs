// ─────────────────────────────────────────────────────────────────────────────
// recipe.mjs — [pipeline 7]P-1: a recipe is a VALIDATED, machine-readable input
// contract, and [pipeline 7]P-8's machine limb (locale sharding).
//
// The required-field set is not written here. It is `required[]` in
// src/schema/recipe.schema.json, committed in the repo, and
// assert-recipe-contract.mjs holds a recorded failing fixture PER ENTRY plus a
// COVERAGE LOST when the two counts drift. That is what the original acceptance
// criterion ("refuses a recipe missing any required field") could not be: it
// names no set, so validating one field satisfies it.
//
// 🔴 REFUSED, NEVER SKIPPED. A recipe naming a modality this pipeline has not
// implemented is a hard failure. Skipping is how a text-only run comes back green
// for an audio-bearing app — every gate passes, over nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(HERE, 'schema', 'recipe.schema.json');
export const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

/** WHAT THIS PIPELINE ACTUALLY IMPLEMENTS. Declared, so `validate` can refuse
 *  anything else instead of quietly producing a partial pack.
 *
 *  `video` and `music` are absent and that is a written cut, not a gap:
 *  39-CHASSIS §4 cut 8 parks video on an unanswered owner scope question, and
 *  [ADR 019] holds music at the 🔴 risk tier with Drift deferred (melody
 *  infringement has a very low similarity threshold). Building either would
 *  reverse a cut. */
export const IMPLEMENTED_MODALITIES = Object.freeze(['text', 'image', 'audio']);

/** What the QA stage implements, which is a SMALLER set than what `pack` can
 *  carry — stated separately rather than folded in, because conflating them is
 *  how "the pack built" gets read as "the assets were checked". The audio and
 *  image limbs need ASR / NER / NSFW models, and every local QA model needs a row
 *  in tooling/legal/content-licence-register.json before it runs. */
export const QA_IMPLEMENTED_MODALITIES = Object.freeze(['text']);

/** The grammar must be a SUPERSET of the capability, and it must be a STRICT one.
 *
 *  🔴 MUTATION-PROVEN 2026-08-02. With the schema enum listing exactly the
 *  implemented set, disabling the IMPLEMENTED_MODALITIES check below changed no
 *  outcome — the enum refused the planted `video` recipe on its own — so the
 *  check was dead code reporting health, which this repo deletes rather than
 *  keeps "for safety". The fix is not to delete it: the two lists answer
 *  different questions (what a recipe may SAY vs what this pipeline can DO), and
 *  a word that is grammatical but unimplemented is exactly what the refusal is
 *  for. So the enum carries `video` and `music` and this assertion keeps the gap
 *  non-empty. If it ever closes, the refusal above has stopped being reachable
 *  and must be re-pointed rather than left looking effective. */
{
  const grammar = SCHEMA.properties.modalities.items.enum ?? [];
  const missing = IMPLEMENTED_MODALITIES.filter((m) => !grammar.includes(m));
  if (missing.length) {
    throw new Error(`recipe.schema.json's modality enum does not admit implemented modalities: ${missing.join(', ')}`);
  }
  if (grammar.length <= IMPLEMENTED_MODALITIES.length) {
    throw new Error(
      'recipe.schema.json\'s modality enum is no larger than IMPLEMENTED_MODALITIES, so no recipe can ever reach the ' +
        '"REFUSED, never skipped" check — it would be an assertion that cannot fail.',
    );
  }
}

class RecipeError extends Error {}

const fail = (problems) => {
  throw new RecipeError(`recipe REFUSED — ${problems.length} problem(s):\n${problems.map((p) => `    ${p}`).join('\n')}`);
};

function checkValue(value, spec, path, problems) {
  if (spec.type === 'array') {
    if (!Array.isArray(value)) return problems.push(`${path}: expected an array`);
    if (spec.minItems !== undefined && value.length < spec.minItems) {
      problems.push(`${path}: needs at least ${spec.minItems} entr(y|ies), found ${value.length}`);
    }
    if (spec.items) value.forEach((v, i) => checkValue(v, spec.items, `${path}[${i}]`, problems));
    return undefined;
  }
  if (spec.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return problems.push(`${path}: expected an object`);
    }
    for (const r of spec.required ?? []) {
      if (!(r in value)) problems.push(`${path}.${r}: required and absent`);
    }
    for (const [k, sub] of Object.entries(spec.properties ?? {})) {
      if (k in value) checkValue(value[k], sub, `${path}.${k}`, problems);
    }
    return undefined;
  }
  if (spec.type === 'integer') {
    if (!Number.isInteger(value)) return problems.push(`${path}: expected an integer`);
  } else if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return problems.push(`${path}: expected a number`);
    if (spec.exclusiveMinimum !== undefined && value <= spec.exclusiveMinimum) {
      problems.push(`${path}: must be greater than ${spec.exclusiveMinimum}`);
    }
    if (spec.maximum !== undefined && value > spec.maximum) problems.push(`${path}: must be at most ${spec.maximum}`);
  } else if (spec.type === 'string') {
    if (typeof value !== 'string') return problems.push(`${path}: expected a string`);
    if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
      problems.push(`${path}: "${value}" does not match ${spec.pattern}`);
    }
  }
  if (spec.const !== undefined && value !== spec.const) problems.push(`${path}: must be ${JSON.stringify(spec.const)}`);
  if (spec.enum && !spec.enum.includes(value)) {
    problems.push(`${path}: "${value}" is not one of ${spec.enum.join(', ')}`);
  }
  return undefined;
}

/** Parse + validate. Returns the recipe; throws with every problem at once. */
export function validateRecipe(recipe) {
  const problems = [];
  if (recipe === null || typeof recipe !== 'object' || Array.isArray(recipe)) {
    fail(['the recipe is not a JSON object']);
  }

  for (const key of SCHEMA.required) {
    if (!(key in recipe)) problems.push(`${key}: required and absent (schema required[])`);
  }
  for (const [key, spec] of Object.entries(SCHEMA.properties)) {
    if (key in recipe) checkValue(recipe[key], spec, key, problems);
  }

  // ── REFUSED, NEVER SKIPPED ────────────────────────────────────────────────
  for (const m of Array.isArray(recipe.modalities) ? recipe.modalities : []) {
    if (!IMPLEMENTED_MODALITIES.includes(m)) {
      problems.push(
        `modalities: "${m}" is declared and this pipeline does not implement it (implemented: ${IMPLEMENTED_MODALITIES.join(', ')}). ` +
          'REFUSED rather than skipped — a skipped modality is how a text-only run comes back green for an app that needs audio.',
      );
    }
  }

  // ── audio implies a BATCH MP3 endpoint, decided at validate time ──────────
  const wantsAudio = Array.isArray(recipe.modalities) && recipe.modalities.includes('audio');
  if (wantsAudio && !recipe.tts) {
    problems.push(
      'tts: required when modalities contains "audio". [ADR 017] locks MP3 and the streaming synthesis endpoint cannot emit MP3 at all, ' +
        'so the endpoint has to be settled BEFORE an expensive metered run, not asset-by-asset at the end of one.',
    );
  }
  if (recipe.tts && !wantsAudio) {
    problems.push('tts: declared while modalities does not contain "audio" — one of the two is wrong, and guessing which is how a config drifts.');
  }

  // ── item ↔ modality consistency, both directions ──────────────────────────
  const declared = new Set(Array.isArray(recipe.modalities) ? recipe.modalities : []);
  const used = new Set();
  const seenIds = new Set();
  for (const [i, item] of (Array.isArray(recipe.items) ? recipe.items : []).entries()) {
    if (item === null || typeof item !== 'object') continue;
    if (seenIds.has(item.id)) problems.push(`items[${i}]: duplicate id "${item.id}"`);
    seenIds.add(item.id);
    used.add(item.modality);
    if (item.modality && !declared.has(item.modality)) {
      problems.push(`items[${i}] ("${item.id}"): modality "${item.modality}" is not in the recipe's declared modalities`);
    }
    const needsAsset = item.modality === 'image' || item.modality === 'audio';
    if (needsAsset && (typeof item.asset !== 'string' || item.asset === '')) {
      problems.push(`items[${i}] ("${item.id}"): a ${item.modality} item must name an asset path`);
    }
    if (!needsAsset && item.asset !== undefined) {
      problems.push(`items[${i}] ("${item.id}"): a text item must not name an asset`);
    }
  }
  for (const m of declared) {
    if (!used.has(m)) {
      problems.push(
        `modalities: "${m}" is declared and no item uses it. A declared-but-unused modality makes every per-modality gate range over an empty set and report clean.`,
      );
    }
  }

  if (problems.length) fail(problems);
  return recipe;
}

export function loadRecipe(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new RecipeError(`recipe REFUSED — ${path} is not readable JSON (${e.message})`);
  }
  return validateRecipe(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 7]P-8 — LOCALE SHARDING, three relationships.
//
// The original criterion compared content.json against a list the same author
// wrote: declare `locales: ["en"]`, ship `en`, pass. All three below can fail on
// a real pack, and the third is the one the client cannot rescue —
// content_pack.dart does locale FALLBACK, so a missing translation renders
// silently as the base language and nothing anywhere reports it.
// ─────────────────────────────────────────────────────────────────────────────
export function localeShardProblems(recipe, content) {
  const problems = [];
  const declared = Array.isArray(recipe.locales) ? recipe.locales : [];
  if (declared.length === 0) {
    return ['locales: REQUIRED_COVERAGE — an empty locales array makes every shard comparison vacuously true'];
  }
  const present = Object.keys(content ?? {});

  // (1) both directions
  for (const l of declared) if (!present.includes(l)) problems.push(`content.json has no shard for declared locale "${l}"`);
  const bcp47 = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
  for (const l of present) {
    if (!declared.includes(l)) problems.push(`content.json carries shard "${l}", which the recipe does not declare`);
    if (!bcp47.test(l)) problems.push(`content.json shard "${l}" is not a well-formed BCP-47 tag`);
  }

  // (3) key-set equality against the base shard
  const base = declared[0];
  const baseShard = content?.[base];
  if (baseShard === null || typeof baseShard !== 'object' || Array.isArray(baseShard)) {
    problems.push(`content.json shard "${base}" (the base locale) is not an object of key -> value`);
    return problems;
  }
  const baseKeys = Object.keys(baseShard).sort();
  if (baseKeys.length === 0) problems.push(`content.json base shard "${base}" is empty`);
  for (const l of declared.slice(1)) {
    const shard = content?.[l];
    if (shard === null || typeof shard !== 'object' || Array.isArray(shard)) continue;
    const keys = new Set(Object.keys(shard));
    const missing = baseKeys.filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !baseKeys.includes(k)).sort();
    if (missing.length) {
      problems.push(
        `shard "${l}" is missing ${missing.length} key(s) present in "${base}": ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''} ` +
          '— the client falls back to the base locale, so this renders as untranslated English with nothing logged',
      );
    }
    if (extra.length) problems.push(`shard "${l}" carries ${extra.length} key(s) absent from "${base}": ${extra.slice(0, 8).join(', ')}`);
  }
  return problems;
}

export { RecipeError };
