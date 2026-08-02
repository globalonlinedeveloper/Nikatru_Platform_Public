#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-recipe-contract.mjs — [pipeline 7]P-1 (a recipe is a validated input
// contract) and P-8's machine limb (content is locale-sharded).
//
// 🔴 THE ORIGINAL ACCEPTANCE CRITERION NAMES NO SET. "Refuses a recipe missing
// any required field" is satisfied by a validator that checks exactly one field,
// because the criterion never says which fields are required. The required set is
// therefore `required[]` in src/schema/recipe.schema.json, committed in the repo,
// and this guard proves the validator refuses on EVERY entry.
//
// 🔴 AND IT PROVES IT BY MUTATING THE REAL RECIPE, NOT A FIXTURE. Ten hand-written
// "missing-<field>.json" files would have been the obvious build, and it is the
// build this repo has already paid for twice: a fixture you wrote encodes the same
// misunderstanding as the guard you wrote, and `assert-seams-wired.mjs` shipped
// with SIX passing fixture tests over a version that could not catch the real
// defect. Here each required field is DELETED from the committed example recipe in
// memory and the validator must refuse naming that field. Parity is then automatic:
// add a ninth entry to `required[]` and this guard exercises it on the next run,
// with no fixture to remember and no count to ratchet.
//
// P-8's three relationships live in localeShardProblems() and are exercised here
// against the real shards, including the one the client cannot rescue: a shard
// missing a key renders as the base language via content_pack.dart's locale
// FALLBACK, silently, with nothing logged anywhere.
//
// Usage:  node tooling/ci/assert-recipe-contract.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  IMPLEMENTED_MODALITIES,
  QA_IMPLEMENTED_MODALITIES,
  SCHEMA,
  localeShardProblems,
  validateRecipe,
} from '../content_pipeline/src/recipe.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const EXAMPLES = join(repoRoot, 'tooling', 'content_pipeline', 'examples');

const problems = [];
const prints = [];
const coverageLost = (...lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── the domain ───────────────────────────────────────────────────────────────
const recipes = [];
if (existsSync(EXAMPLES)) {
  for (const e of readdirSync(EXAMPLES, { withFileTypes: true })) {
    const p = join(EXAMPLES, e.name, 'recipe.json');
    if (e.isDirectory() && existsSync(p) && statSync(p).isFile()) recipes.push(p);
  }
}
if (recipes.length === 0) {
  coverageLost(
    `no recipe found under ${relative(repoRoot, EXAMPLES)}/*/recipe.json.`,
    'Every limb below quantifies over recipes. With none, this guard reports a validated contract over',
    'an empty set — the exact shape it exists to prevent, and the reason the example pack is committed',
    'rather than generated in CI.',
  );
}
if (!Array.isArray(SCHEMA.required) || SCHEMA.required.length === 0) {
  coverageLost('recipe.schema.json declares an empty `required[]`, so the field-by-field proof below ranges over nothing.');
}

// ── every committed recipe must actually validate ───────────────────────────
const parsed = new Map();
for (const path of recipes) {
  const rel = relative(repoRoot, path).split('\\').join('/');
  try {
    parsed.set(rel, validateRecipe(JSON.parse(readFileSync(path, 'utf8'))));
  } catch (e) {
    problems.push(`${rel} does not validate against its own schema:\n${e.message}`);
  }
}
if (parsed.size === 0) {
  coverageLost('no committed recipe validates, so nothing below has a subject to mutate.');
}

// ── THE PROOF: one deletion per required field, on the real recipe ───────────
const [subjectRel, subject] = [...parsed.entries()][0];
const uncovered = [];
for (const field of SCHEMA.required) {
  if (!(field in subject)) {
    uncovered.push(field);
    continue;
  }
  const mutant = structuredClone(subject);
  delete mutant[field];
  let refused = null;
  try {
    validateRecipe(mutant);
  } catch (e) {
    refused = e.message;
  }
  if (refused === null) {
    problems.push(
      `deleting required field "${field}" from ${subjectRel} was ACCEPTED. The schema declares it required and ` +
        'the validator does not enforce it, so every recipe missing it passes.',
    );
  } else if (!refused.includes(field)) {
    problems.push(
      `deleting "${field}" was refused, but the message never names it: ${refused.split('\n')[0]}. ` +
        'An operator cannot fix a field the refusal does not identify.',
    );
  }
}
if (uncovered.length) {
  coverageLost(
    `${subjectRel} does not carry ${uncovered.length} of the schema's required field(s): ${uncovered.join(', ')}.`,
    'The proof above works by DELETING each required field from a real recipe, so a field the subject',
    'never had cannot be deleted and is silently not proven. That is COVERAGE LOST, not a shorter run —',
    "it is exactly how `required[].length` would drift past the set anybody actually exercises.",
  );
}

// ── REFUSED, NEVER SKIPPED ──────────────────────────────────────────────────
// An unimplemented modality must be a hard failure. Proven by planting one.
// ⚠️ THE ASSERTION NAMES THE REASON, NOT THE WORD. Mutation-proven 2026-08-02:
// the first version planted `{modality:'video', asset:'clip/planted.webm'}` and
// asserted the refusal merely CONTAINED "video" — so disabling the
// implementation check entirely was NOT CAUGHT, because a different rule (a
// non-image/audio item may not name an asset) refused it and the message
// happened to contain the item id. Wrong property tested, exactly the shape the
// stage plan names. The planted item now carries no asset, and the assertion
// requires the modality-not-implemented reason by its own words.
{
  const mutant = structuredClone(subject);
  mutant.modalities = [...mutant.modalities, 'video'];
  mutant.items = [...mutant.items, { id: 'planted.video', modality: 'video' }];
  let refused = null;
  try {
    validateRecipe(mutant);
  } catch (e) {
    refused = e.message;
  }
  if (refused === null || !/does not implement it/.test(refused)) {
    problems.push(
      'a recipe declaring the unimplemented modality "video" was ACCEPTED. Skipping an unimplemented modality is how ' +
        'a text-only run comes back green for an audio-bearing app: every gate passes, over nothing. ' +
        `(implemented: ${IMPLEMENTED_MODALITIES.join(', ')})`,
    );
  }
}

// ── the streaming-TTS refusal, at VALIDATE time ─────────────────────────────
// [ADR 017] locks MP3 and the streaming synthesis endpoint cannot emit MP3 at
// all, so a streaming recipe can never satisfy the lock. Catching that here costs
// nothing; catching it asset-by-asset at the end of a metered run costs the run.
{
  const audioRecipes = [...parsed.values()].filter((r) => r.modalities.includes('audio'));
  if (audioRecipes.length === 0) {
    prints.push('no committed recipe declares audio, so the batch-TTS refusal was not exercised against a real subject this run.');
  } else {
    const mutant = structuredClone(audioRecipes[0]);
    mutant.tts = { ...mutant.tts, endpoint: 'streaming' };
    let refused = null;
    try {
      validateRecipe(mutant);
    } catch (e) {
      refused = e.message;
    }
    if (refused === null) {
      problems.push(
        'an audio recipe naming the "streaming" TTS endpoint was ACCEPTED. The streaming endpoint cannot emit MP3, ' +
          'so the recipe can never satisfy [ADR 017] — and the failure would arrive after the run was paid for.',
      );
    }
    const dropped = structuredClone(audioRecipes[0]);
    delete dropped.tts;
    let refusedDrop = null;
    try {
      validateRecipe(dropped);
    } catch (e) {
      refusedDrop = e.message;
    }
    if (refusedDrop === null) problems.push('an audio recipe with no `tts` block at all was ACCEPTED.');
  }
}

// ── [pipeline 7]P-8 — the locale shards, all three relationships ────────────
let shardsChecked = 0;
for (const [rel, recipe] of parsed) {
  const dir = join(repoRoot, rel, '..', 'content');
  const content = {};
  for (const locale of recipe.locales) {
    const p = join(dir, `${locale}.json`);
    if (existsSync(p)) content[locale] = JSON.parse(readFileSync(p, 'utf8'));
  }
  for (const p of localeShardProblems(recipe, content)) problems.push(`${rel}: ${p}`);
  shardsChecked += Object.keys(content).length;

  // The limb that can actually go red, proven by deleting a key from a
  // non-base shard — the failure the client CANNOT rescue, because
  // content_pack.dart:113-132 falls back to the base locale and renders the
  // untranslated string with nothing logged.
  if (recipe.locales.length > 1) {
    const secondary = recipe.locales[1];
    const mutated = structuredClone(content);
    const keys = Object.keys(mutated[secondary] ?? {});
    if (keys.length === 0) {
      problems.push(`${rel}: shard "${secondary}" has no keys to remove, so the key-set-equality limb could not be proven`);
    } else {
      delete mutated[secondary][keys[0]];
      if (localeShardProblems(recipe, mutated).length === 0) {
        problems.push(
          `${rel}: removing key "${keys[0]}" from shard "${secondary}" was ACCEPTED. Key-set equality across shards is ` +
            'the one locale limb the client cannot rescue — a missing translation renders as the base language, silently.',
        );
      }
    }
  }
}
if (shardsChecked === 0) {
  coverageLost('not one locale shard was read, so every P-8 relationship was computed over an empty content map.');
}

// ── the honest gap, printed rather than implied ─────────────────────────────
const unimplementedQa = IMPLEMENTED_MODALITIES.filter((m) => !QA_IMPLEMENTED_MODALITIES.includes(m));
if (unimplementedQa.length) {
  prints.push(
    `the pipeline can PACK ${IMPLEMENTED_MODALITIES.join('/')} but its QA stage implements only ` +
      `${QA_IMPLEMENTED_MODALITIES.join('/')} — ${unimplementedQa.join(', ')} carry no machine check. ` +
      'The ASR-WER, per-language NER and NSFW limbs each need a downloaded model, and every local QA model needs a ' +
      'row in tooling/legal/content-licence-register.json before it runs. Land each limb WITH its row, never before.',
  );
}

if (problems.length) {
  console.error(`✗ recipe contract — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
if (prints.length) {
  console.log('⬜ printed, not hidden:');
  for (const p of prints) console.log(`    ${p}`);
}
console.log(
  `ok  recipe contract — ${parsed.size} recipe(s); all ${SCHEMA.required.length} required field(s) proven to refuse by ` +
    `deletion from ${subjectRel}; unimplemented modality and streaming-TTS both refused; ${shardsChecked} locale shard(s) checked in both directions with key-set equality`,
);
