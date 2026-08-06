// ─────────────────────────────────────────────────────────────────────────────
// selection-record.test.mjs — tooling/scripts/check-selection-record.mjs must be
// able to fail, and — the point of this whole change — must be able NOT to.
//
// [pipeline N-9] "No app enters the factory without passing the three selection
// gates."
//
// 🔴 WHY THIS FILE EXISTS AT ALL. On 2026-08-06 the script exited 1 on the real
// tree with `COVERAGE LOST — the workspace lists no non-exempt app`, and
// `grep check-selection-record .github/workflows/*.yml` returned nothing: it was
// wired into NOTHING, so the `selection.sha256` half of N-9's acceptance was
// enforced by nothing at all. The two facts are one fact. A guard that reddens
// CI on a state that is legitimately correct does not get fixed, it gets left
// unwired — and then the case it WOULD have caught goes uncaught too.
//
// So the split these cases pin is the load-bearing decision:
//   · the domain is WRONG          → COVERAGE LOST, exit 1
//   · the domain is RIGHT and EMPTY → print, exit 0
// and the two floors that keep the second honest — a stale exemption, and an app
// under apps/ the workspace does not list — are exercised as failures, because
// an empty domain is only good news if it is provably the whole domain.
//
// 🔴 THE REAL-TREE MUTATIONS CAME FIRST. Recorded 2026-08-06 against a scratch
// copy of HEAD's pubspec.yaml, restored and re-run green afterwards:
//   T1  HEAD state, company/ present   => exit 0, "NO APP HAS ENTERED THE FACTORY"
//   T2  HEAD state, company/ removed   => exit 0, + "THE PRIVATE TREE IS NOT IN THIS CHECKOUT"
//   T3  apps/subly renamed to apps/sublite (workspace AND disk)
//                                      => exit 1, "EXEMPT name(s) are not workspace members"
//   T4  apps/ghost created on disk only => exit 1, "not in the root pubspec.yaml `workspace:` block"
//   T5  restored                        => exit 0
// A parallel agent's transient `apps/probe` also exercised the NON-empty path on
// the real tree the same day: exit 0, "1 non-exempt app(s) … 1 not linked yet".
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'scripts', 'check-selection-record.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-selection-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const PUBSPEC = (apps) => `name: nikatru_workspace\n\nenvironment:\n  sdk: ^3.9.0\n\nworkspace:\n  - packages/core\n${apps.map((a) => `  - ${a}\n`).join('')}\ndev_dependencies:\n  melos: ^8.2.2\n`;

/**
 * A tree with a root pubspec, the apps it names, and optionally a company/.
 * `EXEMPT` in the script names `apps/subly`, so a fixture that wants the empty
 * domain has to carry that app — which is the point: the exemption is a claim
 * about a specific app, and a fixture that fakes it would be testing nothing.
 */
function tree({ workspace = ['apps/subly'], onDisk = null, company = {}, dod = {} } = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'pubspec.yaml'), PUBSPEC(workspace));
  for (const dir of onDisk ?? workspace) mkdirSync(join(root, dir), { recursive: true });
  for (const [rel, body] of Object.entries(dod)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  if (company !== null) {
    mkdirSync(join(root, 'company'), { recursive: true });
    for (const [rel, body] of Object.entries(company)) {
      const abs = join(root, 'company', rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
  }
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

describe('N-9 · a legitimately empty domain PRINTS and does not redden CI', () => {
  test('🔴 zero non-exempt apps is the requirement SATISFIED, not unmeasured', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /NO APP HAS ENTERED THE FACTORY SINCE THE GATES EXISTED/);
    // …and it must never dress that up as work done.
    assert.match(out, /NOTHING VERIFIED/);
    // ⚠️ Anchored on the FAILURE marker `✗ COVERAGE LOST`, not on the bare
    // phrase: the print itself names COVERAGE LOST when it explains which two
    // conditions are failures rather than prints, and a bare
    // `doesNotMatch(/COVERAGE LOST/)` failed on the guard's own reasoning.
    assert.doesNotMatch(out, /✗ COVERAGE LOST/);
  });

  test('the print names the exemption it is relying on, so the claim is auditable', () => {
    assert.match(run(tree()).out, /exempt by name \(apps\/subly\)/);
  });
});

describe('N-9 · the floors that make "empty" mean empty', () => {
  test('🔴 a STALE EXEMPTION is COVERAGE LOST — an exemption about nothing is not an exemption', () => {
    const { code, out } = run(tree({ workspace: ['apps/sublite'] }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /EXEMPT name\(s\) are not workspace members: apps\/subly/);
  });

  test('🔴 an app on disk the workspace does not list is COVERAGE LOST — it would enter ungated', () => {
    const { code, out } = run(tree({ workspace: ['apps/subly'], onDisk: ['apps/subly', 'apps/ghost'] }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /apps\/ghost/);
  });

  test('no root pubspec, or no workspace block, is COVERAGE LOST — the block IS the domain', () => {
    const noPubspec = join(TMP, `bare${seq++}`);
    mkdirSync(noPubspec, { recursive: true });
    assert.match(run(noPubspec).out, /COVERAGE LOST/);

    const noBlock = join(TMP, `nb${seq++}`);
    mkdirSync(noBlock, { recursive: true });
    writeFileSync(join(noBlock, 'pubspec.yaml'), 'name: x\n');
    const r = run(noBlock);
    assert.equal(r.code, 1);
    assert.match(r.out, /no `workspace:` block/);
  });
});

describe('N-9 · the sha256 half, which is the only reason this script is local', () => {
  const RECORD = 'gate answers: demand yes, moat yes, fit yes\n';
  const SHA = createHash('sha256').update(Buffer.from(RECORD)).digest('hex');
  const withApp = (selection) =>
    tree({
      workspace: ['apps/subly', 'apps/lingo'],
      company: { 'selection/lingo.md': RECORD },
      dod: { 'apps/lingo/dod.json': { status: 'done', selection } },
    });

  test('a resolving record whose sha256 matches PASSES, and says so', () => {
    const { code, out } = run(withApp({ record: 'company/selection/lingo.md', sha256: SHA }));
    assert.equal(code, 0, out);
    assert.match(out, /1 non-exempt app\(s\); 1 linked record\(s\) resolved and hashed as claimed/);
  });

  test('🔴 a record that does not resolve FAILS — CI can only see the string is there', () => {
    const { code, out } = run(withApp({ record: 'company/selection/gone.md', sha256: SHA }));
    assert.equal(code, 1);
    assert.match(out, /does not resolve/);
  });

  test('🔴 a record whose CONTENT changed under the claimed hash FAILS', () => {
    const { code, out } = run(withApp({ record: 'company/selection/lingo.md', sha256: 'f'.repeat(64) }));
    assert.equal(code, 1);
    assert.match(out, /The gate answers the owner signed are not the gate answers on disk/);
  });

  test('an app with no done-record at all FAILS', () => {
    const root = tree({ workspace: ['apps/subly', 'apps/lingo'] });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /no done-record at apps\/lingo\/dod\.json/);
  });

  test('a stamped app that has not linked one yet is a NOTE, not a failure', () => {
    const root = tree({
      workspace: ['apps/subly', 'apps/lingo'],
      dod: { 'apps/lingo/dod.json': { status: 'stamped', selection: { record: '', sha256: '' } } },
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /no selection record linked yet/);
  });
});

describe('N-9 · a checkout with no company/ reports what it could not do', () => {
  test('🔴 PRINTS and exits 0 — this is the CI shape, and failing it would make the lane permanently red', () => {
    const root = tree({ workspace: ['apps/subly'] });
    rmSync(join(root, 'company'), { recursive: true, force: true });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /THE PRIVATE TREE IS NOT IN THIS CHECKOUT/);
  });

  test('🔴 and it does NOT then report an unresolvable record as a failure', () => {
    // Without this, wiring the script into CI would fail every run the moment
    // one app carried a selection link — punishing the correct state.
    const root = tree({
      workspace: ['apps/subly', 'apps/lingo'],
      dod: { 'apps/lingo/dod.json': { status: 'done', selection: { record: 'company/selection/lingo.md', sha256: 'a'.repeat(64) } } },
    });
    rmSync(join(root, 'company'), { recursive: true, force: true });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /does not resolve/);
    assert.match(out, /THE PRIVATE TREE IS NOT IN THIS CHECKOUT/);
  });
});
