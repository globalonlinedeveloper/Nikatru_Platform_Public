// ─────────────────────────────────────────────────────────────────────────────
// slot-pipeline.test.mjs — PROVE THE GUARD CAN GO RED, BY BREAKING THE REAL
// TEMPLATE AND WATCHING IT FAIL.
//
// 🔴 EVERY CASE HERE MUTATES THE REAL FILES IN tooling/store-pipeline/ AND THE
// REAL REGISTERS, THEN RESTORES THEM. It does not build a fixture tree, and the
// reason is written down in this corpus in blood: assert-seams-wired.mjs shipped
// with its caller check matching the function's own declaration, so deleting
// every real caller still passed — and ALL SIX of its fixture tests passed
// against the broken version. A fixture you wrote encodes the same
// misunderstanding as the guard you wrote. Only the real tree can disagree with
// both.
//
// Every restore is in a `finally`. If a case throws mid-way the file is put
// back anyway; if the process is killed, `git status` shows what to revert.
//
// Run:  node --test tooling/store-pipeline/test/slot-pipeline.test.mjs
//
// ⚠️ NOT WIRED INTO ci.yml, and that is deliberate rather than an oversight.
// Its two siblings — assert-store-matrix.mjs and assert-github-matrix.mjs — are
// not wired either, for the reason catalog/store-matrix.json records: an
// insertion into ci.yml shifts every `ci.yml:NNNN` citation below it, and the
// private corpus holds roughly 1,647 of them. This suite is run by hand, and
// the README says so where somebody will read it.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const REL = 'tooling/store-pipeline';
const GUARD = join(ROOT, REL, 'assert-slot-pipeline.mjs');

const F = {
  build: join(ROOT, REL, 'slot-build.yml'),
  submit: join(ROOT, REL, 'slot-submit.yml'),
  artifact: join(ROOT, REL, 'artifact-build.mjs'),
  seams: join(ROOT, REL, 'signing-seams.mjs'),
  register: join(ROOT, 'tooling/channel-register.json'),
  matrix: join(ROOT, 'catalog/store-matrix.json'),
};

const INSTALLED = ['.github/workflows/slot-build.yml', '.github/workflows/slot-submit.yml'].map((p) => join(ROOT, p));

function guard(args = ['--template-only']) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Mutate one real file, run the guard, restore. The restore is unconditional. */
function withMutation(file, mutate, fn) {
  const original = readFileSync(file, 'utf8');
  const next = mutate(original);
  assert.notEqual(next, original, 'the mutation was a no-op — it would prove nothing');
  try {
    writeFileSync(file, next);
    fn(guard());
  } finally {
    writeFileSync(file, original);
  }
}

/** Every negative case below is meaningless unless the unmutated tree is green:
 *  a guard that fails on everything "detects" every mutation and detects
 *  nothing. This is the positive control, and it runs first. */
before(() => {
  const { code, out } = guard();
  assert.equal(code, 0, `the UNMUTATED template must pass, or every case below is vacuous.\n${out}`);
});

after(() => {
  for (const p of INSTALLED) if (existsSync(p)) rmSync(p);
});

test('positive control — the real template passes', () => {
  assert.equal(guard().code, 0);
});

test('deleting `environment:` from the submitting job is caught', () => {
  withMutation(F.submit, (s) => s.replace('    environment: store-publish\n', ''), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /runs --submit with NO `environment:`/);
  });
});

test('a confirm input that defaults to a confirming value is caught', () => {
  withMutation(F.submit, (s) => s.replace("default: 'dry-run-only'", "default: 'SUBMIT-Google_Play_Store'"), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /which CONFIRMS/);
  });
});

test('a push trigger on the submission workflow is caught', () => {
  withMutation(F.submit, (s) => s.replace('\non:\n  workflow_dispatch:\n', '\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\n'), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /must be workflow_dispatch and nothing else/);
  });
});

test('submitting without reading the artifact signature first is caught', () => {
  withMutation(F.submit, (s) => {
    const i = s.lastIndexOf('slot-signing.mjs --verify');
    const j = s.lastIndexOf('      - name:', i);
    const k = s.indexOf('\n', i);
    return s.slice(0, j) + s.slice(k + 1);
  }, ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /submits without reading the artifact's signature first/);
  });
});

test('a secret referenced outside the per-slot markers is caught', () => {
  withMutation(F.submit, (s) => {
    const k = s.indexOf('permissions:\n');
    return s.slice(0, k) + 'env:\n  LEAK: ${{ secrets.ANDROID_KEY_ALIAS }}\n\n' + s.slice(k);
  }, ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /OUTSIDE the per-slot markers/);
  });
});

test('a secret this slot\'s channel does not declare is caught', () => {
  withMutation(F.submit, (s) => s.replace('secrets.ANDROID_KEY_ALIAS', 'secrets.APPLE_API_KEY_ID'), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /does not declare for channel/);
  });
});

test('`--submit` reachable from the push-triggered build lane is caught', () => {
  withMutation(F.build, (s) => s.replace('        run: node tooling/store-pipeline/resolve-slot.mjs --github-output', '        run: node tooling/release/submit-play.mjs --submit'), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /RUNS `--submit`/);
  });
});

test('any secret reference in the build lane is caught', () => {
  withMutation(F.build, (s) => s.replace('        with:\n          node-version: 24', '        with:\n          node-version: 24\n        env:\n          K: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}'), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /references 1 secret/);
  });
});

test('deleting the no-product job — the vacuous green — is caught', () => {
  withMutation(F.build, (s) => s.slice(0, s.indexOf('  no-product:')), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /has no `no-product` job/);
  });
});

test('build and no-product conditions that are not complements are caught', () => {
  withMutation(F.build, (s) => s.replace("    if: needs.slot.outputs.productState != 'present'", '    if: always()'), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /expected needs\.slot\.outputs\.productState != 'present'/);
  });
});

test('a base64 credential blob planted in a template file is caught', () => {
  withMutation(F.build, (s) => `${s}\n# ${'QUJDRGVmZ2hpams'.repeat(12)}==\n`, ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /base64-looking run/);
  });
});

// ── the tables, in BOTH directions, against the REAL register ───────────────
test('a format added to the register with no build verb is caught', () => {
  withMutation(F.register, (s) => {
    const d = JSON.parse(s);
    d.channels[0].artifactFormats.push('.xyzpkg');
    return JSON.stringify(d, null, 2);
  }, ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /\.xyzpkg/);
  });
});

test('a build verb removed for a format the register still names is caught', () => {
  withMutation(F.artifact, (s) => {
    const i = s.indexOf("  '.aab': {");
    const j = s.indexOf('  },', i) + 5;
    return s.slice(0, i) + s.slice(j);
  }, ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /"\.aab" is declared in .*channel-register/);
  });
});

test('a channel with no signing seam entry is caught', () => {
  withMutation(F.seams, (s) => {
    const i = s.indexOf("  'windows-store': {");
    const j = s.indexOf('  },', i) + 5;
    return s.slice(0, i) + s.slice(j);
  }, ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /NO entry in SIGNING_SEAMS/);
  });
});

test('a seam pointing at a script that does not exist is caught', () => {
  withMutation(F.seams, (s) => s.replace('tooling/ci/android-signing.mjs', 'tooling/ci/nope-signing.mjs'), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /is not in this checkout/);
  });
});

test('a new slot whose target no channel covers is caught', () => {
  withMutation(F.matrix, (s) => {
    const d = JSON.parse(s);
    d.slots.push({
      store: 'Steam', target: 'Steam', type: 'Games', publicDir: 'Nikatru_Steam_Games_Public',
      state: 'shell-empty', backing: null,
      repos: { public: { existsOnGitHub: false, visibility: null, boundRemote: null }, private: { existsOnGitHub: false, visibility: null, boundRemote: null } },
    });
    return JSON.stringify(d, null, 2);
  }, ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /not declared in UNCOVERED_TARGETS/);
  });
});

test('an UNCOVERED_TARGETS entry that has become stale is caught', () => {
  withMutation(GUARD, (s) => s.replace("  Chrome: '", "  Android: 'stale entry.',\n  Chrome: '"), ({ code, out }) => {
    assert.equal(code, 1);
    assert.match(out, /now covers it/);
  });
});

// ── the two absences must not share an answer ───────────────────────────────
test('installed copies absent with no flag REFUSES rather than passing', () => {
  for (const p of INSTALLED) assert.equal(existsSync(p), false, 'this case requires the template not to be installed');
  const { code, out } = guard([]);
  assert.equal(code, 2);
  assert.match(out, /COVERAGE LOST/);
});

test('the waiver is self-policing: --template-only while installed REFUSES', () => {
  mkdirSync(join(ROOT, '.github/workflows'), { recursive: true });
  try {
    copyFileSync(F.build, INSTALLED[0]);
    copyFileSync(F.submit, INSTALLED[1]);
    const a = guard(['--template-only']);
    assert.equal(a.code, 2, 'a waiver that outlives its reason is how a guard dies quietly');
    const b = guard([]);
    assert.equal(b.code, 0, 'byte-identical installed copies must pass without the flag');
    // and one byte of drift must be caught
    const s = readFileSync(INSTALLED[0], 'utf8');
    writeFileSync(INSTALLED[0], s.replace('timeout-minutes: 45', 'timeout-minutes: 46'));
    const c = guard([]);
    assert.equal(c.code, 1);
    assert.match(c.out, /differs from/);
  } finally {
    for (const p of INSTALLED) if (existsSync(p)) rmSync(p);
  }
});

// ── the resolver's own refusals ─────────────────────────────────────────────
function resolveSlot(args) {
  const r = spawnSync(process.execPath, [join(ROOT, REL, 'resolve-slot.mjs'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('an unknown slot name REFUSES rather than falling back to the live slot', () => {
  const { code, out } = resolveSlot(['--slot', 'Nikatru_Nowhere_Apps_Public']);
  assert.equal(code, 2);
  assert.match(out, /names no slot in the registry/);
});

test('an extension slot reports NO CHANNEL rather than inventing a lane', () => {
  const { code, out } = resolveSlot(['--slot', 'Nikatru_Firefox_Extensions_Public']);
  assert.equal(code, 4);
  assert.match(out, /NO CHANNEL covers target/);
});

test('a slot that is not this checkout cannot claim a product', () => {
  const { code, out } = resolveSlot(['--slot', 'Nikatru_Windows_Games_Public', '--require-product']);
  assert.equal(code, 3, 'capability is not backing: this checkout carries every Flutter platform directory');
  assert.match(out, /CAPABILITY IS NOT BACKING/);
});

test('this checkout does resolve, with a product', () => {
  const { code } = resolveSlot(['--require-product']);
  assert.equal(code, 0);
});
