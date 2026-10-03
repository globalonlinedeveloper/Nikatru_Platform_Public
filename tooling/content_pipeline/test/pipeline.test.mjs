// The content pipeline's own unit suite. The guards in tooling/ci/ prove the
// pipeline against the REAL committed recipe and pack; this file proves the
// pieces in isolation, including the ones a real pack cannot exercise because a
// real pack is valid input by definition.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { MANIFEST_KEY_ORDER, canonicalJson, sha256Hex } from '../src/canonical.mjs';
import { classifyAsset, isAllowedMember } from '../src/formats.mjs';
import { assertPromptIsClean, ipSteeringViolations } from '../src/prompts.mjs';
import { REVIEW_CHECKLIST, checklistProblems, deriveSample } from '../src/sample.mjs';
import { validateRecipe } from '../src/recipe.mjs';
import { TEST_KEY_ID, drillStatus, keyPairFromSeed, testSeed, verifyWithPinnedKey } from '../src/sign.mjs';
import { DECLARED_GATES, publishPreconditionProblems } from '../src/gates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const CLI = join(REPO, 'tooling', 'content_pipeline', 'cli.mjs');
const RECIPE = join(REPO, 'tooling', 'content_pipeline', 'examples', 'lingo-phrases', 'recipe.json');

const runCli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: REPO });

describe('canonical serialisation — the bytes the signer signs', () => {
  it('fixes the manifest key order regardless of insertion order', () => {
    const a = canonicalJson({ locales: [], pack_id: 'x', version: '1.0.0' }, MANIFEST_KEY_ORDER);
    const b = canonicalJson({ version: '1.0.0', pack_id: 'x', locales: [] }, MANIFEST_KEY_ORDER);
    assert.ok(a.equals(b), 'two insertion orders must produce one document, or the signed message depends on assembly order');
  });

  it('ends with a newline, because the trailing byte is part of the signed message', () => {
    assert.equal(canonicalJson({ a: 1 }).at(-1), 0x0a);
  });

  it('emits keys the order does not name, sorted, so an added field is still deterministic', () => {
    const out = JSON.parse(canonicalJson({ zz: 1, aa: 2, pack_id: 'x' }, MANIFEST_KEY_ORDER).toString());
    assert.deepEqual(Object.keys(out), ['pack_id', 'aa', 'zz']);
  });

  it('hashes to lower-case hex — the encoding Dart\'s sha256.convert().toString() produces', () => {
    assert.match(sha256Hex(Buffer.from('x')), /^[0-9a-f]{64}$/);
  });
});

describe('format allowlist — bytes decide, extensions must agree', () => {
  const mp3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(20)]);
  const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8L', 'latin1')]);

  it('accepts an MP3 named .mp3 and a WebP named .webp', () => {
    assert.equal(classifyAsset('a/b.mp3', mp3).ok, true);
    assert.equal(classifyAsset('a/b.webp', webp).ok, true);
  });

  it('REFUSES WebP bytes named .mp3 — a file lying about itself', () => {
    const v = classifyAsset('a/b.mp3', webp);
    assert.equal(v.ok, false);
    assert.match(v.reason, /extension and content disagree/);
  });

  it('names LINEAR16/WAV when it refuses, because that is the asset that actually arrives', () => {
    const wav = Buffer.alloc(64);
    wav.write('RIFF', 0, 'latin1');
    wav.write('WAVE', 8, 'latin1');
    assert.match(classifyAsset('a/b.mp3', wav).reason, /WAV \/ LINEAR16/);
  });

  it('carries NO AVIF signature — the omission is the 2026-07-29 cut', () => {
    const avif = Buffer.alloc(32);
    avif.write('ftypavif', 4, 'latin1');
    assert.match(classifyAsset('a/b.avif', avif).reason, /AVIF/);
  });

  it('whitelists exactly the five pack members', () => {
    for (const m of ['manifest.json', 'manifest.sig', 'content.json', 'PROVENANCE.json', 'assets/x.webp']) {
      assert.equal(isAllowedMember(m), true, m);
    }
    assert.equal(isAllowedMember('loader.js'), false);
    assert.equal(isAllowedMember('assets/'), false, 'the bare prefix is not a member');
  });
});

describe('[ADR 019] NO-IP-PROMPTING — the pre-submission refusal', () => {
  for (const bad of [
    'A mascot in the style of a famous animation studio',
    'Draw a scene with Pokemon characters',
    'A voice that sounds like a well-known singer',
    'Recreate the artwork of that album cover',
    'Use the Acme™ brand palette',
  ]) {
    it(`refuses: ${bad.slice(0, 40)}…`, () => {
      assert.ok(ipSteeringViolations(bad).length > 0);
      assert.throws(() => assertPromptIsClean(bad, 'test'), /REFUSED before submission/);
    });
  }

  it('is a FLOOR, not a proof — a named character the list does not carry passes, and that is why the human sample exists', () => {
    // Recorded deliberately rather than papered over. An exhaustive character
    // list is impossible; [ADR 019]'s mitigation stack is this rule PLUS the P-4
    // review sample PLUS reverse-image-search on illustrations. A test asserting
    // the list is complete would be an assertion that cannot hold.
    assert.deepEqual(ipSteeringViolations('Draw a small yellow electric rodent creature'), []);
  });

  it('accepts a neutral [ADR 019]-compliant prompt, or the rule gets switched off', () => {
    assert.deepEqual(
      ipSteeringViolations('Flat-vector friendly rodent mascot, rounded shapes, teal-and-blue palette, plain background.'),
      [],
    );
  });

  it('treats a non-string prompt as a violation rather than skipping it', () => {
    assert.equal(ipSteeringViolations(undefined).length, 1);
  });
});

describe('deterministic review sample', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const h = sha256Hex(Buffer.from('pack-1'));

  it('is a function of the content hash — same pack, same sample', () => {
    assert.deepEqual(deriveSample(h, ids, { tier: 'standard', sampleFloor: 0.5 }), deriveSample(h, [...ids].reverse(), { tier: 'standard', sampleFloor: 0.5 }));
  });

  it('changes when the pack changes, so a re-run cannot inherit an old sample', () => {
    const other = sha256Hex(Buffer.from('pack-2'));
    assert.notDeepEqual(deriveSample(h, ids, { tier: 'standard', sampleFloor: 0.5 }), deriveSample(other, ids, { tier: 'standard', sampleFloor: 0.5 }));
  });

  it('is 100% at the expert tier regardless of sample_floor — the tier means "no sampling"', () => {
    assert.deepEqual(deriveSample(h, ids, { tier: 'expert', sampleFloor: 0.1 }), [...ids].sort());
  });

  it('never returns an empty sample for a non-empty pack', () => {
    assert.equal(deriveSample(h, ids, { tier: 'standard', sampleFloor: 0.0001 }).length, 1);
  });

  it('refuses n/a on a check that DOES apply to the modality', () => {
    const checks = Object.fromEntries(REVIEW_CHECKLIST.map((c) => [c.key, 'pass']));
    checks['reverse-image-search'] = 'n/a: skipped';
    assert.match(checklistProblems('x', 'image', checks).join('\n'), /where it DOES apply/);
  });

  it('requires a reason after n/a even where it is legitimate', () => {
    const checks = Object.fromEntries(REVIEW_CHECKLIST.map((c) => [c.key, 'pass']));
    checks['reverse-image-search'] = 'n/a';
    assert.match(checklistProblems('x', 'text', checks).join('\n'), /n\/a with no reason/);
  });

  it('reports a missing checklist key rather than passing over it', () => {
    assert.match(checklistProblems('x', 'text', {}).join('\n'), /no verdict for/);
  });
});

describe('recipe validation', () => {
  const base = () => JSON.parse(readFileSync(RECIPE, 'utf8'));

  it('accepts the committed example', () => {
    assert.doesNotThrow(() => validateRecipe(base()));
  });

  it('REFUSES a declared modality it has not implemented — never skips it', () => {
    const r = base();
    r.modalities.push('video');
    r.items.push({ id: 'x.y', modality: 'video', asset: 'v/x.webm' });
    assert.throws(() => validateRecipe(r), /video/);
  });

  it('REFUSES a modality declared with no item using it — an empty per-modality gate reports clean', () => {
    const r = base();
    r.items = r.items.filter((i) => i.modality !== 'image');
    assert.throws(() => validateRecipe(r), /no item uses it/);
  });

  it('REFUSES a streaming TTS endpoint at validate time, not after the run is paid for', () => {
    const r = base();
    r.tts.endpoint = 'streaming';
    assert.throws(() => validateRecipe(r), /streaming/);
  });

  it('REFUSES an empty locales array — the P-8 REQUIRED_COVERAGE floor', () => {
    const r = base();
    r.locales = [];
    assert.throws(() => validateRecipe(r), /locales/);
  });

  it('REFUSES a text item that names an asset, and an asset item that does not', () => {
    const a = base();
    a.items[0].asset = 'x/y.webp';
    assert.throws(() => validateRecipe(a), /must not name an asset/);
    const b = base();
    delete b.items.find((i) => i.modality === 'image').asset;
    assert.throws(() => validateRecipe(b), /must name an asset path/);
  });
});

describe('signing', () => {
  it('derives a stable 32-byte keypair from the test seed', () => {
    assert.equal(keyPairFromSeed(testSeed()).publicKeyBase64, keyPairFromSeed(testSeed()).publicKeyBase64);
    assert.equal(Buffer.from(keyPairFromSeed(testSeed()).publicKeyBase64, 'base64').length, 32);
  });

  it('refuses a seed of the wrong length — a mis-encoded seed still LOOKS like a key', () => {
    assert.throws(() => keyPairFromSeed(Buffer.alloc(31)), /exactly 32 bytes/);
  });

  it('verifies against the same base64-raw-32 encoding kContentPackPublicKeys pins', () => {
    const { publicKeyBase64 } = keyPairFromSeed(testSeed());
    const r = runCli('build', '--recipe', RECIPE, '--out', join(mkdtempSync(join(tmpdir(), 'sgn-')), 'p'), '--test-key');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(Buffer.from(publicKeyBase64, 'base64').length, 32);
  });

  it('rejects a signature over different bytes', () => {
    const { publicKeyBase64 } = keyPairFromSeed(testSeed());
    assert.equal(verifyWithPinnedKey(publicKeyBase64, Buffer.from('a'), Buffer.alloc(64)), false);
  });

  it('[P-10] reports a production key id as undrilled while drilled_on is null', () => {
    const st = drillStatus(REPO, 'k1');
    assert.equal(st.ok, false);
    assert.match(st.reason, /drilled_on|no drill record/);
  });

  it('[P-10] does NOT gate the derived test key, or CI could never sign at all', () => {
    assert.equal(drillStatus(REPO, TEST_KEY_ID).ok, true);
  });
});

describe('publish preconditions', () => {
  it('declares five gates covering P-3, P-4, P-5, P-7 and P-9', () => {
    assert.deepEqual(
      DECLARED_GATES.map((g) => g.requirement).sort(),
      ['P-3', 'P-4', 'P-5', 'P-7', 'P-9'],
    );
  });

  it('fails naming EVERY missing artifact, not just the first', () => {
    const d = mkdtempSync(join(tmpdir(), 'gates-'));
    const problems = publishPreconditionProblems(d, 'a'.repeat(64));
    assert.equal(problems.length, DECLARED_GATES.length);
    rmSync(d, { recursive: true, force: true });
  });

  it('fails an artifact that parses but binds to nothing', () => {
    const d = mkdtempSync(join(tmpdir(), 'gates-'));
    for (const g of DECLARED_GATES) writeFileSync(join(d, g.artifact), g.artifact.endsWith('.jsonl') ? '' : '{}');
    const problems = publishPreconditionProblems(d, 'a'.repeat(64));
    assert.ok(problems.length >= DECLARED_GATES.length - 1);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('the CLI, as an operator runs it', () => {
  it('exits 2 (REFUSED) — not 1 — on a recipe outside the declared modalities', () => {
    const d = mkdtempSync(join(tmpdir(), 'cli-'));
    const r = JSON.parse(readFileSync(RECIPE, 'utf8'));
    r.modalities.push('video');
    r.items.push({ id: 'x.y', modality: 'video', asset: 'v/x.webm' });
    const p = join(d, 'recipe.json');
    writeFileSync(p, JSON.stringify(r));
    const out = runCli('validate', '--recipe', p);
    assert.equal(out.status, 2, out.stderr);
    assert.match(out.stderr, /video/);
    rmSync(d, { recursive: true, force: true });
  });

  it('refuses `generate` and says why, rather than pretending to run', () => {
    const out = runCli('generate');
    assert.equal(out.status, 2);
    assert.match(out.stderr, /owner-gated|NOT IMPLEMENTED/);
  });

  it('refuses to sign as a production key id with no drill record', () => {
    const d = mkdtempSync(join(tmpdir(), 'cli-'));
    const built = runCli('pack', '--recipe', RECIPE, '--out', join(d, 'p'));
    assert.equal(built.status, 0, built.stderr);
    const seedFile = join(d, 'seed.txt');
    writeFileSync(seedFile, testSeed().toString('base64'));
    const out = runCli('sign', '--out', join(d, 'p'), '--key-id', 'k1', '--seed-file', seedFile);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /drill/i);
    assert.match(out.stderr, /NO SHAMIR SHARES/, '[ADR 022] abolished Shamir; the refusal must not demand a restore-from-shares drill');
    rmSync(d, { recursive: true, force: true });
  });

  it('--test-key cannot be used to sign as a production key id', () => {
    const d = mkdtempSync(join(tmpdir(), 'cli-'));
    runCli('pack', '--recipe', RECIPE, '--out', join(d, 'p'));
    const out = runCli('sign', '--out', join(d, 'p'), '--key-id', 'k1', '--test-key');
    assert.equal(out.status, 2);
    rmSync(d, { recursive: true, force: true });
  });

  it('refuses `publish` even with every gate green — the target is [4]B-18\'s', () => {
    const out = runCli(
      'publish',
      '--out',
      join(REPO, 'packages', 'core', 'test', 'fixtures', 'pack', 'v1'),
      '--gates',
      join(REPO, 'tooling', 'content_pipeline', 'examples', 'lingo-phrases', 'gates'),
    );
    assert.equal(out.status, 2);
    assert.match(out.stderr, /B-18|NO PUBLISH TARGET|gate\(s\) unsatisfied/);
  });
});

// ── ST-X5: the service catalogue recipe — the app-bundled pack ───────────────
describe('service-catalogue recipe (apps/subscriptiontracker bundled pack)', () => {
  const SC = join(REPO, 'tooling', 'content_pipeline', 'examples', 'service-catalogue');
  const SC_RECIPE = join(SC, 'recipe.json');
  const REQUIRED_FACTS = ['id', 'category', 'cycle', 'cancel_url', 'manage_play', 'manage_appstore', 'notice_days', 'regions', 'aliases'];

  // ST-T9 (AD-04) red control: the facts schema REFUSES a service with no
  // category id, an unknown one, and a missing alias list — and accepts the
  // committed Netflix record, so the refusal is about the field, not the file.
  it('the facts schema rejects a service with no category id', async () => {
    const { factsProblems } = await import('../examples/service-catalogue/make-recipe.mjs');
    const good = JSON.parse(JSON.parse(readFileSync(join(SC, 'content', 'en.json'), 'utf8'))['svc.netflix.facts']);
    assert.deepEqual(factsProblems(good), []);
    const { category: _drop, ...noCategory } = good;
    assert.match(factsProblems(noCategory).join('\n'), /category: required and absent/);
    assert.match(factsProblems({ ...good, category: 'streaming' }).join('\n'), /category: "streaming" is not one of/);
    const { aliases: _a, ...noAliases } = good;
    assert.match(factsProblems(noAliases).join('\n'), /aliases: required and absent/);
  });

  it('the committed recipe, shards, log and gates are exactly a render of make-recipe.mjs\'s table', async () => {
    const { drift } = await import('../examples/service-catalogue/make-recipe.mjs');
    assert.deepEqual(drift(), [], 'a derived file was hand-edited or the table changed without a re-render');
  });

  it('validates, builds with the TEST key, and loads as the subscriptiontracker pack', async () => {
    const { CATEGORIES, LOCALES: SC_LOCALES, factsProblems } = await import('../examples/service-catalogue/make-recipe.mjs');
    assert.equal(runCli('validate', '--recipe', SC_RECIPE).status, 0);
    const d = mkdtempSync(join(tmpdir(), 'nikatru-sc-'));
    try {
      const out = runCli('build', '--recipe', SC_RECIPE, '--out', d, '--test-key');
      assert.equal(out.status, 0, out.stderr);
      const manifestBytes = readFileSync(join(d, 'manifest.json'));
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      assert.equal(manifest.pack_id, 'subscriptiontracker', 'the app loads it with expectPackId = its own app id');
      assert.equal(manifest.key_id, TEST_KEY_ID);
      assert.deepEqual(manifest.assets, [], 'no binary asset ships: a service glyph is its initials, rendered by the app');
      const { publicKeyBase64 } = keyPairFromSeed(testSeed());
      assert.ok(verifyWithPinnedKey(publicKeyBase64, manifestBytes, readFileSync(join(d, 'manifest.sig'))));

      const contentBytes = readFileSync(join(d, 'content.json'));
      assert.equal(sha256Hex(contentBytes), manifest.content_hash);
      const content = JSON.parse(contentBytes.toString('utf8'));
      // One shard per supported locale of the locale register (make-recipe's
      // LOCALES reads it), in register order.
      assert.deepEqual(Object.keys(content), [...SC_LOCALES]);
      for (const l of SC_LOCALES) {
        assert.deepEqual(content[l], JSON.parse(readFileSync(join(SC, 'content', `${l}.json`), 'utf8')));
      }
      const ids = content.en['catalogue.services'].split(',');
      // ST-T9 (AD-04): the scope moved from "at most 40" to the market's
      // floor — 150 or more, India-first — and a ceiling that keeps the
      // bundled pack an offline-sized asset.
      assert.ok(ids.length >= 150 && ids.length <= 600, `${ids.length} services — the scope is 150..600`);
      const inFirst = ids.slice(0, 20).map((id) => JSON.parse(content.en[`svc.${id}.facts`]).regions);
      assert.ok(inFirst.filter((r) => r.includes('IN') || r.includes('*')).length === 20, 'the first rows are India-first');
      assert.equal(new Set(ids).size, ids.length, 'duplicate id in the index');
      for (const l of SC_LOCALES) assert.equal(content[l]['catalogue.services'], content.en['catalogue.services']);
      for (const l of SC_LOCALES) {
        for (const id of ids) {
          const name = content[l][`svc.${id}.name`];
          assert.ok(typeof name === 'string' && name.trim(), `${l}/${id}: no name`);
          const facts = JSON.parse(content[l][`svc.${id}.facts`]);
          for (const f of REQUIRED_FACTS) assert.ok(f in facts, `${l}/${id}: facts lacks "${f}"`);
          assert.equal(facts.id, id);
          assert.ok(CATEGORIES.includes(facts.category), `${l}/${id}: category "${facts.category}"`);
          assert.ok(['monthly', 'yearly'].includes(facts.cycle), `${l}/${id}: cycle "${facts.cycle}"`);
          for (const u of ['cancel_url', 'manage_play', 'manage_appstore']) {
            assert.equal(new URL(facts[u]).protocol, 'https:', `${l}/${id}: ${u} is not https`);
          }
          assert.ok(Number.isInteger(facts.notice_days) && facts.notice_days >= 0);
          assert.ok(facts.regions.length > 0 && facts.regions.every((r) => r === '*' || /^[A-Z]{2}$/.test(r)));
          assert.ok(Array.isArray(facts.aliases) && facts.aliases.every((a) => typeof a === 'string' && a === a.toLowerCase()));
          assert.deepEqual(factsProblems(facts), [], `${l}/${id}: not a schema-valid facts record`);
        }
        // The Tamil names are transliterations, not copies of the English.
        if (l === 'ta') for (const id of ids) assert.notEqual(content.ta[`svc.${id}.name`], content.en[`svc.${id}.name`], id);
      }
      // 🔴 NO PRICE IS AUTHORED: a price needs a public price page read during
      // the run, with its URL and date, and this run read none.
      const priceKeys = Object.values(content).flatMap((s) => Object.keys(s)).filter((k) => /\.price\./.test(k));
      assert.deepEqual(priceKeys, []);
      // Every key is an index, a name or a facts record — nothing else rides along.
      for (const k of Object.keys(content.en)) {
        assert.match(k, /^(catalogue\.services|svc\.[a-z0-9_-]+\.(name|facts))$/);
      }
      // …and the build is the committed bundled pack, byte for byte.
      const bundled = join(REPO, 'apps', 'subscriptiontracker', 'assets', 'content_pack');
      for (const m of ['manifest.json', 'manifest.sig', 'content.json', 'PROVENANCE.json']) {
        assert.ok(readFileSync(join(d, m)).equals(readFileSync(join(bundled, m))), `${m} differs from the bundled pack`);
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
