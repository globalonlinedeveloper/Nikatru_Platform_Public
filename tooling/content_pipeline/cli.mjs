#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// cli.mjs — the content pipeline's one entry point.
//
//   validate --recipe R                       parse + refuse
//   pack     --recipe R --out D               emit the [ADR 007] layout
//   sign     --out D [--key-id K] [--test-key] Ed25519 over the manifest bytes
//   build    --recipe R --out D [--test-key]   validate + pack + sign
//   publish  --out D --gates G                 the GATE only; uploads nothing
//   generate                                   NOT IMPLEMENTED — owner-gated
//
// Exit codes are part of the contract, because a caller that cannot tell a
// refusal from a crash treats both as "try again":
//   0 ok · 2 REFUSED (the input is bad and this is the guard working) · 1 broke
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitPack, writeManifest } from './src/pack.mjs';
import { loadRecipe } from './src/recipe.mjs';
import { TEST_KEY_ID, drillStatus, signPack, testSeed } from './src/sign.mjs';
import { DECLARED_GATES, publishPreconditionProblems } from './src/gates.mjs';
import { assertPromptIsClean } from './src/prompts.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const refuse = (msg) => {
  console.error(msg);
  process.exit(2);
};

function seedFor(keyId) {
  if (has('test-key')) {
    if (keyId !== TEST_KEY_ID) {
      refuse(`REFUSED — --test-key signs only as "${TEST_KEY_ID}"; it must never be able to produce a pack a shipped binary would accept.`);
    }
    return testSeed();
  }
  const file = flag('seed-file') ?? process.env.NIKATRU_PACK_SIGNING_SEED_FILE;
  if (!file || !existsSync(file)) {
    refuse(
      'REFUSED — no signing seed. Pass --seed-file <path> (or set NIKATRU_PACK_SIGNING_SEED_FILE), or --test-key for a\n' +
        '  derived throwaway key. The production seed lives in .claude/pack-signing.seed and on paper ([ADR 022]);\n' +
        '  it must never reach a CI runner, which is why CI signs as test-k1 and the production canary is owner-run.',
    );
  }
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
}

function doPack() {
  const recipe = flag('recipe');
  const out = flag('out');
  if (!recipe || !out) refuse('usage: pack --recipe <recipe.json> --out <dir>');
  const r = emitPack(recipe, out);
  return r;
}

function doSign(out, manifest) {
  // 🔴 A CONTRADICTION IS A REFUSAL, NOT A PRECEDENCE RULE. `--test-key --key-id k1`
  // used to let --test-key win silently, so a command that READS as "sign as the
  // production key" produced a test-signed pack — and the only signal was a
  // key_id nobody re-reads. Whichever way that precedence falls it is wrong: the
  // operator asked for two different keys and must be told so.
  if (has('test-key') && flag('key-id') !== undefined && flag('key-id') !== TEST_KEY_ID) {
    refuse(`REFUSED — --test-key and --key-id ${flag('key-id')} contradict each other. --test-key signs only as "${TEST_KEY_ID}".`);
  }
  const keyId = has('test-key') ? TEST_KEY_ID : (flag('key-id') ?? 'k1');
  const seed = seedFor(keyId);
  const withKey = { ...manifest, key_id: keyId };
  const manifestBytes = writeManifest(out, withKey);
  const res = signPack({ outDir: out, manifestBytes, keyId, seed, repoRoot: REPO_ROOT });
  return { ...res, manifest: withKey, manifestBytes };
}

try {
  switch (cmd) {
    case 'validate': {
      const path = flag('recipe');
      if (!path) refuse('usage: validate --recipe <recipe.json>');
      const recipe = loadRecipe(path);
      // The pre-submission half of [ADR 019], applied to every prompt template
      // the recipe carries — BEFORE anything is submitted and anything is spent.
      for (const item of recipe.items) {
        if (typeof item.prompt_template === 'string') assertPromptIsClean(item.prompt_template, `items."${item.id}".prompt_template`);
      }
      console.log(`ok  recipe — ${recipe.pack_id}@${recipe.pack_version}, ${recipe.items.length} item(s), ${recipe.locales.length} locale(s), modalities: ${recipe.modalities.join(', ')}`);
      break;
    }
    case 'pack': {
      const r = doPack();
      writeManifest(r.outDir, r.manifest);
      console.log(`ok  packed ${r.manifest.pack_id}@${r.manifest.version} -> ${r.outDir} (content_hash ${r.manifest.content_hash})`);
      break;
    }
    case 'sign': {
      const out = flag('out');
      if (!out) refuse('usage: sign --out <packdir> [--key-id k1 | --test-key]');
      const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
      const r = doSign(out, manifest);
      console.log(`ok  signed ${out} as key_id "${r.keyId}"`);
      break;
    }
    case 'build': {
      const r = doPack();
      const s = doSign(r.outDir, r.manifest);
      console.log(
        `ok  built + signed ${s.manifest.pack_id}@${s.manifest.version} -> ${r.outDir}\n` +
          `    key_id ${s.keyId} · content_hash ${s.manifest.content_hash} · ${s.manifest.assets.length} asset(s) · ${r.provenance.items.length} provenance row(s)`,
      );
      break;
    }
    case 'publish': {
      const out = flag('out');
      const gates = flag('gates');
      if (!out || !gates) refuse('usage: publish --out <packdir> --gates <dir>');
      const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
      const problems = publishPreconditionProblems(gates, manifest.content_hash);
      if (problems.length) {
        refuse(
          `publish REFUSED — ${problems.length} of ${DECLARED_GATES.length} gate(s) unsatisfied:\n${problems.map((p) => `    ${p}`).join('\n')}`,
        );
      }
      const drill = drillStatus(REPO_ROOT, manifest.key_id);
      if (!drill.ok) refuse(`publish REFUSED — ${drill.reason}`);
      refuse(
        'publish REFUSED — every gate passed and there is NO PUBLISH TARGET.\n' +
          '  The shared R2 bucket, the packs.nikatru.com binding, the cache policy and latest.json hosting are\n' +
          "  [4]B-18's, and services/platform/wrangler.jsonc still declares no r2_buckets. Stage 7 owns the gate;\n" +
          '  stage 4 owns the shelf. Do not create a bucket from here.',
      );
      break;
    }
    case 'generate':
      refuse(
        'generate is NOT IMPLEMENTED, deliberately.\n' +
          '  The industrial runs are owner-gated: Gemini image/text generation runs on a consumer subscription\n' +
          '  (a browser console, not an API key in CI) and Chirp 3 HD is a metered Google Cloud API requiring\n' +
          '  billing. An agent can build every gate and every refusal; it cannot run a paid batch or accept a\n' +
          "  vendor's terms. What IS implemented is the pre-submission refusal — see `validate`, which applies\n" +
          '  [ADR 019] to every prompt template a recipe carries.',
      );
      break;
    default:
      refuse(
        'usage: cli.mjs <validate|pack|sign|build|publish|generate> [flags]\n' +
          '  see tooling/content_pipeline/README.md',
      );
  }
} catch (e) {
  if (/REFUSED/.test(e.message)) {
    console.error(e.message);
    process.exit(2);
  }
  console.error(e.stack ?? String(e));
  process.exit(1);
}
