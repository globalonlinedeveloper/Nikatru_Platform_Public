// Recorded failing cases for the stage-7 content guards.
//
// [pipeline F-10] Each guard here runs against the real repository on every push,
// and the real repository is valid input by definition — so only its passing path
// is ever exercised in CI. These tests feed each guard KNOWN-BAD input.
//
// 🔴 THE FIXTURE IS A COPY OF THE REAL TREE, NOT A TREE THIS FILE INVENTED. A
// fixture you wrote encodes the same misunderstanding as the guard you wrote —
// assert-seams-wired.mjs shipped with six passing fixture tests over a version
// that could not catch the real defect. So `tree()` copies the actual committed
// subject and every case below MUTATES it. Each of these was first proven against
// a scratch copy of the real worktree, before this file existed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const trees = [];

/** A copy of the real tree's stage-7 subject, small enough to build per test. */
function tree() {
  const dst = mkdtempSync(join(tmpdir(), 'nk-s7-'));
  trees.push(dst);
  for (const rel of [
    'tooling/ci',
    'tooling/content_pipeline',
    'tooling/legal',
    'packages/core/test/fixtures',
    'packages/core/lib/src/content',
    '.github/workflows',
  ]) {
    cpSync(join(REPO, rel), join(dst, rel), { recursive: true });
  }
  for (const rel of ['pnpm-workspace.yaml', 'pubspec.yaml', 'packages/core/pubspec.yaml', '.gitattributes']) {
    mkdirSync(dirname(join(dst, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(dst, rel));
  }
  // The UNIT MARKERS of every deployable unit, copied from the real tree rather
  // than invented — assert-lane-coverage.mjs enumerates units by these files and
  // refuses (MIN_UNITS) a tree with too few, so a fixture holding only the
  // content pipeline would fail for the wrong reason and every lane case below
  // would prove nothing.
  for (const top of ['apps', 'packages', 'services', 'sites']) {
    const dir = join(REPO, top);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      for (const marker of ['pubspec.yaml', 'package.json', 'wrangler.jsonc', 'wrangler.toml', 'index.html']) {
        const src = join(dir, e.name, marker);
        if (!existsSync(src)) continue;
        const out = join(dst, top, e.name, marker);
        if (existsSync(out)) continue;
        mkdirSync(dirname(out), { recursive: true });
        cpSync(src, out);
      }
    }
  }
  return dst;
}
after(() => {
  for (const t of trees) rmSync(t, { recursive: true, force: true });
});

const run = (root, guard) =>
  spawnSync(process.execPath, [join(root, 'tooling', 'ci', guard), root], { encoding: 'utf8', cwd: root });

const edit = (root, rel, f) => {
  const p = join(root, rel);
  writeFileSync(p, f(readFileSync(p, 'utf8')));
};
const editJson = (root, rel, f) => edit(root, rel, (t) => { const o = JSON.parse(t); f(o); return `${JSON.stringify(o, null, 2)}\n`; });

const RECIPE_DIR = 'tooling/content_pipeline/examples/lingo-phrases';
const PACK = 'packages/core/test/fixtures/pack/v1';

/** Every case asserts a NON-ZERO exit AND that the message names the reason —
 *  a crash and a catch look identical from the exit code alone. */
function assertRefused(r, re, label) {
  const out = `${r.stdout}\n${r.stderr}`;
  assert.notEqual(r.status, 0, `${label}: the guard exited 0 on known-bad input\n${out}`);
  assert.ok(!/SyntaxError|ReferenceError|ERR_MODULE/.test(out), `${label}: the guard CRASHED rather than caught\n${out}`);
  assert.match(out, re, label);
}

describe('assert-recipe-contract — [pipeline 7]P-1 + P-8', () => {
  it('passes on the real tree (or nothing below means anything)', () => {
    assert.equal(run(tree(), 'assert-recipe-contract.mjs').status, 0);
  });

  it('FAILS when the validator stops enforcing the schema required[] set', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/recipe.mjs', (s) => s.replace('for (const key of SCHEMA.required) {', 'for (const key of []) {'));
    assertRefused(run(t, 'assert-recipe-contract.mjs'), /was ACCEPTED/, 'required[] not enforced');
  });

  it('FAILS when an unimplemented modality is accepted instead of refused', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/recipe.mjs', (s) => s.replace('if (!IMPLEMENTED_MODALITIES.includes(m)) {', 'if (false) {'));
    assertRefused(run(t, 'assert-recipe-contract.mjs'), /"video" was ACCEPTED/, 'unimplemented modality skipped');
  });

  it('FAILS when a non-base locale shard loses a key — the failure the client CANNOT rescue', () => {
    const t = tree();
    editJson(t, `${RECIPE_DIR}/content/fr.json`, (o) => { delete o['food.water_please']; });
    assertRefused(run(t, 'assert-recipe-contract.mjs'), /is missing 1 key/, 'shard key-set inequality');
  });

  it('COVERAGE LOST when required[] grows past what the real recipe can exercise', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/schema/recipe.schema.json', (s) => s.replace('"items"\n  ],', '"items",\n    "brand_new_field"\n  ],'));
    assertRefused(run(t, 'assert-recipe-contract.mjs'), /does not carry|no committed recipe validates/, 'unexercised required field');
  });

  it('FAILS when a streaming TTS endpoint becomes acceptable — [ADR 017] locks MP3', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/recipe.mjs', (s) => s.replace('if (spec.enum && !spec.enum.includes(value)) {', 'if (false) {'));
    assertRefused(run(t, 'assert-recipe-contract.mjs'), /"streaming" TTS endpoint was ACCEPTED/, 'streaming TTS accepted');
  });
});

describe('assert-content-licences — [pipeline 7]P-5 / G-36', () => {
  it('passes on the real tree', () => {
    assert.equal(run(tree(), 'assert-content-licences.mjs').status, 0);
  });

  it('FAILS when a REQUIRED_COVERAGE family loses its row', () => {
    const t = tree();
    editJson(t, 'tooling/legal/content-licence-register.json', (o) => { o.families = o.families.filter((f) => f.family !== 'noto-fonts'); });
    assertRefused(run(t, 'assert-content-licences.mjs'), /requiredCoverage names "noto-fonts"/, 'missing required family');
  });

  it('FAILS when a row loses one verdict field', () => {
    const t = tree();
    editJson(t, 'tooling/legal/content-licence-register.json', (o) => { delete o.families[0].verdicts.store_sale; });
    assertRefused(run(t, 'assert-content-licences.mjs'), /no verdict for "store_sale"/, 'incomplete verdicts');
  });

  it('FAILS when archived_text points at a path that is not on disk', () => {
    const t = tree();
    editJson(t, 'tooling/legal/content-licence-register.json', (o) => { o.families[0].archived_text = 'tooling/legal/licences/nope.txt'; });
    assertRefused(run(t, 'assert-content-licences.mjs'), /is not on disk/, 'phantom archive');
  });

  it('REFUSES CC-BY-NC at intake — it excludes commercial distribution outright', () => {
    const t = tree();
    editJson(t, 'tooling/legal/content-licence-register.json', (o) => { o.families[0].licence_id = 'CC-BY-NC-4.0'; });
    assertRefused(run(t, 'assert-content-licences.mjs'), /REFUSED AT INTAKE/, 'banned licence id');
  });

  it('FAILS when a recipe declares a family whose row is NOT CLEARED', () => {
    const t = tree();
    editJson(t, 'tooling/legal/content-licence-register.json', (o) => { o.families[0].cleared_by = null; o.families[0].wouldNeed = 'x'; });
    assertRefused(run(t, 'assert-content-licences.mjs'), /NOT CLEARED/, 'uncleared family declared');
  });

  it('FAILS when a recipe declares a family nobody registered', () => {
    const t = tree();
    edit(t, `${RECIPE_DIR}/recipe.json`, (s) => s.replace('"hand-authored-content"', '"some-unregistered-voice-pack"'));
    assertRefused(run(t, 'assert-content-licences.mjs'), /the register has no row for it/, 'unregistered family');
  });

  it('TRIPWIRE: FAILS the moment awesome_notifications_fcm enters a real pubspec while uncleared', () => {
    const t = tree();
    edit(t, 'packages/core/pubspec.yaml', (s) => `${s}\n  awesome_notifications_fcm: ^0.12.0\n`);
    assertRefused(run(t, 'assert-content-licences.mjs'), /is now IN A PUBSPEC/, 'tripwire tripped');
  });
});

describe('assert-pack-roundtrip — [pipeline 7]P-9 + P-6 + P-11', () => {
  it('passes on the real tree', () => {
    assert.equal(run(tree(), 'assert-pack-roundtrip.mjs').status, 0);
  });

  it('FAILS on ONE flipped byte of the frozen signature', () => {
    const t = tree();
    const p = join(t, PACK, 'manifest.sig');
    const b = readFileSync(p);
    b[10] ^= 1;
    writeFileSync(p, b);
    assertRefused(run(t, 'assert-pack-roundtrip.mjs'), /DRIFTED|does NOT verify/, 'tampered signature');
  });

  it('FAILS when the canonical serialiser changes — the SIGNED-BYTES DRIFT class', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/canonical.mjs', (s) => s.replace('JSON.stringify(ordered, null, 2)', 'JSON.stringify(ordered, null, 3)'));
    assertRefused(run(t, 'assert-pack-roundtrip.mjs'), /DRIFTED/, 'serialiser drift');
  });

  it('FAILS when the emitter stops requiring the five provenance fields', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/pack.mjs', (s) => s.replace('for (const f of PROVENANCE_REQUIRED_FIELDS) {', 'for (const f of []) {'));
    assertRefused(run(t, 'assert-pack-roundtrip.mjs'), /was ACCEPTED/, 'provenance fields unenforced');
  });

  it('FAILS when manifest.generators names a model PROVENANCE.json does not', () => {
    const t = tree();
    edit(t, `${PACK}/PROVENANCE.json`, (s) => s.replace(/"none\/hand-authored"/g, '"none/renamed"'));
    assertRefused(run(t, 'assert-pack-roundtrip.mjs'), /DRIFTED|no PROVENANCE\.json row does/, 'generator drift');
  });
});

describe('assert-pack-inert — [pipeline 7]P-7 + P-14', () => {
  it('passes on the real tree', () => {
    assert.equal(run(tree(), 'assert-pack-inert.mjs').status, 0);
  });

  it('FAILS on AVIF bytes in a shipped pack — the cut, enforced', () => {
    const t = tree();
    const b = Buffer.alloc(32);
    b.write('ftypavif', 4, 'latin1');
    writeFileSync(join(t, PACK, 'assets/badge/streak.webp'), b);
    assertRefused(run(t, 'assert-pack-inert.mjs'), /AVIF|no allowed format|sha256/, 'AVIF asset');
  });

  it('FAILS when AVIF is ADDED to the allowlist — reversing a written cut', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/formats.mjs', (s) => s.replace("    format: 'webp',", "    format: 'avif',"));
    assertRefused(run(t, 'assert-pack-inert.mjs'), /allowlist carries AVIF|NOT CAUGHT/, 'AVIF re-admitted');
  });

  it('FAILS when .gitattributes stops marking *.sig binary — eol=lf would rewrite a signature', () => {
    const t = tree();
    edit(t, '.gitattributes', (s) => s.replace('*.sig binary', '# *.sig binary'));
    assertRefused(run(t, 'assert-pack-inert.mjs'), /does not mark "\*\.sig" as binary/, 'signature left to the text heuristic');
  });

  it('FAILS when the member whitelist accepts anything — a root-level .js would walk past', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/formats.mjs', (s) =>
      s.replace('export function isAllowedMember(rel) {', 'export function isAllowedMember(rel) {\n  return true;'));
    assertRefused(run(t, 'assert-pack-inert.mjs'), /NOT CAUGHT/, 'member whitelist disabled');
  });
});

describe('assert-prompt-provenance — [pipeline 7]P-2', () => {
  it('passes on the real tree', () => {
    assert.equal(run(tree(), 'assert-prompt-provenance.mjs').status, 0);
  });

  it('FAILS on a planted IP-steering prompt in the SHIPPED log', () => {
    const t = tree();
    edit(t, `${PACK}/PROVENANCE.json`, (s) =>
      s.replace(/"prompt": "Write the single most common everyday greeting[^"]*"/, '"prompt": "Draw it in the style of a famous studio"'));
    assertRefused(run(t, 'assert-prompt-provenance.mjs'), /style-of/, 'IP-steering prompt shipped');
  });

  it('FAILS when an item has no provenance entry — count(prompts) != count(items)', () => {
    const t = tree();
    editJson(t, `${PACK}/PROVENANCE.json`, (o) => { o.items = o.items.slice(1); });
    assertRefused(run(t, 'assert-prompt-provenance.mjs'), /has NO provenance entry|logs \d+ non-text/, 'unlogged item');
  });

  it('FAILS when a ban-list rule stops matching — the list is checked, not trusted', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/prompts.mjs', (s) =>
      s.replace('the\\s+(?:art\\s+)?style\\s+of\\b', 'the\\s+(?:art\\s+)?zzzzstyle\\s+of\\b'));
    assertRefused(run(t, 'assert-prompt-provenance.mjs'), /NOT CAUGHT/, 'ban list neutered');
  });
});

describe('assert-review-gate — [pipeline 7]P-4', () => {
  it('passes on the real tree', () => {
    assert.equal(run(tree(), 'assert-review-gate.mjs').status, 0);
  });

  it('FAILS when a sampled item loses its verdict (coverage)', () => {
    const t = tree();
    edit(t, `${RECIPE_DIR}/gates/review.jsonl`, (s) =>
      `${s.split('\n').filter((l) => l.trim() && !l.includes('"greeting.hello"')).join('\n')}\n`);
    assertRefused(run(t, 'assert-review-gate.mjs'), /has no verdict|coverage is/, 'sample not covered');
  });

  it('FAILS on a FREE-HAND sample — an item outside the derived set was reviewed', () => {
    const t = tree();
    edit(t, `${RECIPE_DIR}/gates/review.jsonl`, (s) => s.replace('"item_id":"greeting.hello"', '"item_id":"food.water_please"'));
    assertRefused(run(t, 'assert-review-gate.mjs'), /is NOT in the derived sample/, 'free-hand sample');
  });

  it('FAILS when a named checklist item has no verdict', () => {
    const t = tree();
    edit(t, `${RECIPE_DIR}/gates/review.jsonl`, (s) => s.replace(/,"g3-do-no-harm":"[^"]*"/, ''));
    assertRefused(run(t, 'assert-review-gate.mjs'), /no verdict for "g3-do-no-harm"/, 'checklist gap');
  });

  it('FAILS when a verdict names a different pack — what a re-run leaves behind', () => {
    const t = tree();
    const hash = JSON.parse(readFileSync(join(t, PACK, 'manifest.json'), 'utf8')).content_hash;
    edit(t, `${RECIPE_DIR}/gates/review.jsonl`, (s) => s.split(hash).join('a'.repeat(64)));
    assertRefused(run(t, 'assert-review-gate.mjs'), /reviewed a different pack/, 'stale binding');
  });

  it('COVERAGE LOST when the sample carries no image item — the reverse-image-search limb retires silently', () => {
    const t = tree();
    edit(t, `${RECIPE_DIR}/gates/review.jsonl`, (s) =>
      `${s.split('\n').filter((l) => l.trim() && !l.includes('"badge.streak"')).join('\n')}\n`);
    assertRefused(run(t, 'assert-review-gate.mjs'), /reviews no image item|has no verdict/, 'image limb retired');
  });
});

describe('assert-publish-gate — [pipeline 7]P-13 + P-10', () => {
  it('passes on the real tree', () => {
    assert.equal(run(tree(), 'assert-publish-gate.mjs').status, 0);
  });

  it('COVERAGE LOST when a gate leaves the registry — the required list is DERIVED from it', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/gates.mjs', (s) => s.replace("    requirement: 'P-5',", "    requirement: 'P-99',"));
    assertRefused(run(t, 'assert-publish-gate.mjs'), /no longer names P-5|COVERAGE LOST/, 'gate dropped');
  });

  it('FAILS when the content-hash binding stops being checked', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/gates.mjs', (s) =>
      s.replace('const wrong = [...new Set(bound.filter((h) => h !== contentHash))];', 'const wrong = [];'));
    assertRefused(run(t, 'assert-publish-gate.mjs'), /NOT CAUGHT/, 'binding unchecked');
  });

  it('FAILS when a declared gate\'s guard is no longer invoked by any workflow', () => {
    const t = tree();
    edit(t, '.github/workflows/ci.yml', (s) =>
      s.replace(/\n *- name: The human sample is deterministic, covered and checklisted\n *run: node tooling\/ci\/assert-review-gate\.mjs/, ''));
    assertRefused(run(t, 'assert-publish-gate.mjs'), /which no workflow invokes/, 'gate guard unwired');
  });

  it('[P-10] FAILS when the sign step stops refusing an undrilled production key', () => {
    const t = tree();
    edit(t, 'tooling/content_pipeline/src/sign.mjs', (s) => s.replace('if (!status.ok) {', 'if (false) {'));
    assertRefused(run(t, 'assert-publish-gate.mjs'), /was ACCEPTED with no dated restore drill/, 'drill refusal disabled');
  });

  it('[P-10] COVERAGE LOST when no key id is declared production — the refusal would gate nothing', () => {
    const t = tree();
    editJson(t, 'tooling/legal/pack-key-drills.json', (o) => { o.productionKeyIds = []; });
    assertRefused(run(t, 'assert-publish-gate.mjs'), /COVERAGE LOST|no production key/, 'no production key declared');
  });

  it('[P-10] the refusal must NOT demand a restore-from-shares drill — [ADR 022] abolished Shamir', () => {
    const src = readFileSync(join(REPO, 'tooling/content_pipeline/src/sign.mjs'), 'utf8');
    assert.match(src, /NO SHAMIR SHARES/, 'the message must say the shares do not exist, not ask for them');
    const drills = readFileSync(join(REPO, 'tooling/legal/pack-key-drills.json'), 'utf8');
    assert.match(drills, /Shamir splitting is NOT required/);
  });
});

describe('assert-lane-coverage — INC-0, the lane that claims tooling/content_pipeline', () => {
  it('FAILS naming tooling/content_pipeline when the content_gate job is deleted', () => {
    const t = tree();
    edit(t, '.github/workflows/ci.yml', (s) => s.replace(/\n  content_gate:[\s\S]*?\n\n  app_brick:/, '\n  app_brick:'));
    assertRefused(run(t, 'assert-lane-coverage.mjs'), /tooling\/content_pipeline/, 'lane deleted');
  });

  it('COVERAGE LOST when the tooling/ scan root is removed — the unit would just stop existing', () => {
    const t = tree();
    edit(t, 'tooling/ci/assert-lane-coverage.mjs', (s) => s.replace(/for \(const d of dirs\('tooling'\)\) \{[\s\S]*?\n\}\n/, ''));
    assertRefused(run(t, 'assert-lane-coverage.mjs'), /tooling\/content_pipeline/, 'scan root removed');
  });
});

describe('the pipeline CLI is exercised, not just its exports', () => {
  it('cli.mjs exits 2 (REFUSED) on a recipe outside the declared modalities', () => {
    const t = tree();
    const p = join(t, RECIPE_DIR, 'recipe.json');
    const r = JSON.parse(readFileSync(p, 'utf8'));
    r.modalities.push('video');
    r.items.push({ id: 'planted.video', modality: 'video' });
    writeFileSync(p, JSON.stringify(r, null, 2));
    const out = spawnSync(process.execPath, [join(t, 'tooling/content_pipeline/cli.mjs'), 'validate', '--recipe', p], { encoding: 'utf8', cwd: t });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /does not implement it/);
  });

  it('cli.mjs build produces the five [ADR 007] members and nothing else', () => {
    const t = tree();
    const outDir = join(t, 'built');
    const r = spawnSync(
      process.execPath,
      [join(t, 'tooling/content_pipeline/cli.mjs'), 'build', '--recipe', join(t, RECIPE_DIR, 'recipe.json'), '--out', outDir, '--test-key'],
      { encoding: 'utf8', cwd: t },
    );
    assert.equal(r.status, 0, r.stderr);
    for (const m of ['manifest.json', 'manifest.sig', 'content.json', 'PROVENANCE.json']) {
      assert.ok(existsSync(join(outDir, m)), `${m} missing from a built pack`);
    }
  });
});
