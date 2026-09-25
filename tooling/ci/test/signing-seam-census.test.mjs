// signing-seam-census.test.mjs — every signing ADAPTER takes its primitives from
// signing-seam.mjs, and the ones that do not yet are named here, dated.
//
// 🔴 O-SIGNING-PRIMITIVES-IN-FOUR-COPIES. The copies had diverged in the one
// place that mattered: android refused a line break before writing $GITHUB_ENV
// and appimage did not. A seam fixes that only while nothing re-grows beside it,
// and a re-grown copy compiles, passes its own tests and prints nothing. This
// census reads each adapter's CODE (comments blanked by text-reductions.mjs) for
// the shapes a copy takes, and fails on one this file does not list.
//
// ⏱ 2026-09-25 — apple-signing.mjs is the first adapter (C5a). android-signing
// and appimage-signing are PENDING until C5b: their entries below are exactly
// what they carry at this commit, and the second test fails on an entry that no
// longer fires — so the change that moves a copy deletes its entry in the same
// commit, and the list ends empty.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../text-reductions.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SEAM = 'signing-seam.mjs';

const code = (f) => stripSourceComments(readFileSync(join(CI_DIR, f), 'utf8'), '.mjs');

/** The seam's exports an adapter must import rather than define. `releaseLane`
 *  is left out: apple keeps an exported `releaseLane` that delegates to
 *  `releaseSignal`, because its tests call it by that name. `decodeB64` is the
 *  name apple's own copy had, so a copy restored from history is caught too. */
const SEAM_PRIMITIVES = ['decideSecretSet', 'releaseSignal', 'decodeKey', 'placeKey', 'newlineOffenders', 'exportEnv'];
const RETIRED = ['decodeB64'];

/** What a copy looks like in code. Each is a shape the seam owns: the arming
 *  verdict is asked through `releaseLane`, $GITHUB_ENV is written by `exportEnv`,
 *  key material is decoded by `decodeKey` and written by `placeKey`. */
const SHAPES = [
  ...[...SEAM_PRIMITIVES, ...RETIRED].map((name) => [
    `local:${name}`,
    new RegExp(`(?:\\bfunction\\s+${name}\\s*\\(|\\b(?:const|let|var)\\s+${name}\\s*=)`),
  ]),
  ['call:releaseGapVerdict', /\breleaseGapVerdict\s*\(/],
  ['call:appendFileSync', /\bappendFileSync\s*\(/],
  ['decode:base64', /\bBuffer\.from\((?:[^()]|\([^()]*\))*,\s*['"]base64['"]\s*\)/],
  ['write:0o600', /\bmode:\s*0o600\b/],
];

function findingsIn(src) {
  const found = SHAPES.filter(([, re]) => re.test(src)).map(([k]) => k);
  if (!/\bfrom\s+['"]\.\/signing-seam\.mjs['"]/.test(src)) found.push('import:missing');
  return found;
}

/** ⏱ 2026-09-25 — measured at this commit; C5b empties it. */
const PENDING = {
  'android-signing.mjs': ['local:exportEnv', 'call:appendFileSync', 'decode:base64', 'write:0o600', 'import:missing'],
  'appimage-signing.mjs': [
    'local:decideSecretSet',
    'local:exportEnv',
    'call:releaseGapVerdict',
    'call:appendFileSync',
    'decode:base64',
    'write:0o600',
    'import:missing',
  ],
};

/** The adapters, from BOTH sources: every script a register row names as its
 *  `signing.seam.prepare`, and every `*-signing.mjs` in tooling/ci. A script one
 *  source has and the other lacks is still read here — the first test says so. */
function adapterSources() {
  const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
  const named = register.channels
    .map((c) => c?.signing?.seam?.prepare)
    .filter((p) => typeof p === 'string')
    .map((p) => p.replace(/^tooling\/ci\//, ''));
  const onDisk = readdirSync(CI_DIR).filter((f) => /-signing\.mjs$/.test(f));
  return { register, fromRegister: [...new Set(named)].sort(), fromTree: onDisk.sort() };
}

describe('signing-seam census — which adapters take their primitives from the seam', () => {
  test('the adapters named by the register are exactly the *-signing.mjs files, and apple-signing is one', () => {
    const { fromRegister, fromTree } = adapterSources();
    assert.ok(fromRegister.includes('apple-signing.mjs'), `no row names apple-signing.mjs as signing.seam.prepare: ${fromRegister.join(', ')}`);
    assert.ok(!fromTree.includes(SEAM), 'the seam is not an adapter; the glob must not match it');
    assert.deepEqual(
      fromTree,
      fromRegister,
      'a signing script no row names signs for nobody, and a row naming a script that is not here signs with nothing',
    );
  });

  test('🔴 no adapter carries a copy this census does not list, and each one imports the seam', () => {
    const { fromRegister, fromTree } = adapterSources();
    const unlisted = [];
    for (const f of new Set([...fromRegister, ...fromTree])) {
      const pending = new Set(PENDING[f] ?? []);
      for (const k of findingsIn(code(f))) if (!pending.has(k)) unlisted.push(`${f}: ${k}`);
    }
    assert.deepEqual(
      unlisted,
      [],
      `a signing adapter carries its own copy of a primitive signing-seam.mjs holds. Import it from ./signing-seam.mjs instead:\n  ${unlisted.join('\n  ')}`,
    );
  });

  test('🔴 every PENDING entry is still real — the change that moves a copy deletes its entry', () => {
    const stale = [];
    for (const [f, keys] of Object.entries(PENDING)) {
      const found = new Set(findingsIn(code(f)));
      for (const k of keys) if (!found.has(k)) stale.push(`${f}: ${k}`);
    }
    assert.deepEqual(stale, [], `PENDING lists a copy that is no longer there. Delete the entry:\n  ${stale.join('\n  ')}`);
  });

  test('apple-signing is an adapter with nothing pending', () => {
    assert.equal(PENDING['apple-signing.mjs'], undefined);
    assert.deepEqual(findingsIn(code('apple-signing.mjs')), []);
  });
});

describe('signing-seam census — the detector reads the shapes it claims to', () => {
  test('positive control: it finds every primitive DEFINED in the seam, and the seam\'s own calls', () => {
    const found = findingsIn(code(SEAM));
    for (const name of SEAM_PRIMITIVES) assert.ok(found.includes(`local:${name}`), `local:${name} not found in the seam: ${found.join(', ')}`);
    assert.ok(found.includes('call:releaseGapVerdict'));
    assert.ok(found.includes('call:appendFileSync'));
    assert.ok(found.includes('decode:base64'));
  });

  test('it finds the arrow form, the retired name and a 0600 key write', () => {
    const src = [
      "const exportEnv = (pairs) => pairs;",
      'function decodeB64(raw, name) { return Buffer.from(String(raw), \'base64\'); }',
      "writeFileSync(p, bytes, { mode: 0o600 });",
    ].join('\n');
    assert.deepEqual(findingsIn(src).sort(), ['decode:base64', 'import:missing', 'local:decodeB64', 'local:exportEnv', 'write:0o600']);
  });

  test('it reads CODE: a primitive named in a comment is not a copy', () => {
    const src = [
      "import { exportEnv } from './signing-seam.mjs';",
      '// function exportEnv(pairs) was the local copy; appendFileSync(path) is the seam\'s now',
      '/* releaseGapVerdict(rows) and Buffer.from(b64, \'base64\') */',
      'exportEnv({ A: 1 }, null, { fail });',
    ].join('\n');
    assert.deepEqual(findingsIn(stripSourceComments(src, '.mjs')), []);
  });
});

describe('signing-seam census — what the seam itself must not hold', () => {
  test('🔴 the seam names no channel the register declares — it cannot tell one row from another', () => {
    const { register } = adapterSources();
    const ids = register.channels.map((c) => c.id);
    assert.ok(ids.includes('ios-appstore'), 'the register read returned no Apple row, so this check read nothing');
    const src = code(SEAM);
    const named = ids.filter((id) => new RegExp(`['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(src));
    assert.deepEqual(named, [], 'a channel id in the seam is a decision about one row made where every adapter shares it');
  });

  test('🔴 the seam exits nowhere and spawns nothing — its refusals go back to the adapter', () => {
    const src = code(SEAM);
    assert.doesNotMatch(src, /\bprocess\.exit\s*\(/);
    assert.doesNotMatch(src, /\b(?:spawn|spawnSync|execFile|execFileSync|execSync|boundedSpawn)\s*\(/);
    assert.doesNotMatch(src, /COVERAGE LOST/, 'the marker belongs in the adapter, where assert-guard-coverage reads its exit 2');
  });
});
