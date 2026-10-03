// ─────────────────────────────────────────────────────────────────────────────
// worker-shared-modules.test.mjs — the negative cases for
// worker-shared-modules.mjs, the ONE reading of "this Worker module was emptied
// into `services/_shared/src/`, and here is the file that now carries it".
//
// The module scans nothing and owns no coverage claim — the guards that import
// it each carry their own COVERAGE LOST over what they read, and each has its
// own delegation case against its own subject. What THIS file exists for is the
// thing those cannot see: the module's REFUSALS. A resolver that stopped
// refusing would make its importers green while the property they pin was
// asserted nowhere, which is exactly what `assert-guard-coverage.mjs`'s
// NOT_A_SCANNER exemption is granted against.
//
// 🔴 THE REFUSAL WITH THE MEASURED HISTORY IS "ENTIRE, NOT CONTAINS".
// `chassis-delegation.mjs` — the Dart-side sibling of this module — shipped on
// 2026-09-05 without an equivalent limb, and an independent reviewer then
// demonstrated on the real tree that a file which LOOKED delegated turned two
// deleted controls from EXIT 1 into EXIT 0. Case F1 below is that shape in
// TypeScript: a carrier that re-exports the shared home AND declares something
// of its own reads as delegated to every guard that follows delegations, while
// what it added is judged by nobody.
//
// GREEN CONTROL FIRST (case A1). Without it every red below is equally
// consistent with a resolver that refuses everything, which would be a module
// that reports a defect on a correct tree — the shape this repository deletes.
//
// Run:  node --test tooling/ci/test/worker-shared-modules.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { SHARED_DIR, sharedHomeOf, workerModuleSource } from '../worker-shared-modules.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-wsm-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A throwaway repository holding one shared home and one carrier. `carrier` is
 *  the carrier's source; pass `null` for `shared` to leave the home absent. */
function fixture({ carrier, shared = "export const x = 1;\n", carrierRel = 'services/w/src/lib/m.ts' }) {
  const root = join(TMP, `r${(seq += 1)}`);
  if (shared !== null) {
    mkdirSync(join(root, 'services', '_shared', 'src'), { recursive: true });
    writeFileSync(join(root, 'services', '_shared', 'src', 'm.ts'), shared);
  }
  const abs = join(root, ...carrierRel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, carrier);
  return { root, carrierRel };
}

const REEXPORT = "export * from '../../../_shared/src/m';\n";

describe('worker-shared-modules — the three answers', () => {
  test('A1 GREEN CONTROL — a whole-file re-export resolves to the shared home', () => {
    const { root, carrierRel } = fixture({ carrier: REEXPORT });
    const answer = sharedHomeOf(root, carrierRel);
    assert.ok(answer !== null, 'a re-export must not read as "no delegation"');
    assert.ok(!('lost' in answer), `expected a target, got ${JSON.stringify(answer)}`);
    assert.equal(answer.target, `${SHARED_DIR}/m.ts`);
    assert.equal(answer.source, 'export const x = 1;\n');
  });

  test('A2 GREEN CONTROL — a header comment above the re-export is still a re-export', () => {
    // The five-line carriers in this tree all open with four comment lines. If
    // comments were not stripped, every real carrier would answer `{ lost }` and
    // this module would refuse the only input it exists to accept.
    const { root, carrierRel } = fixture({
      carrier: `// m.ts — a RE-EXPORT. The one home is ${SHARED_DIR}/m.ts.\n// Second line of prose.\n${REEXPORT}`,
    });
    const answer = sharedHomeOf(root, carrierRel);
    assert.ok(answer !== null && !('lost' in answer), `expected a target, got ${JSON.stringify(answer)}`);
    assert.equal(answer.target, `${SHARED_DIR}/m.ts`);
  });

  test('A3 an ordinary module answers null — judge it where it stands', () => {
    const { root, carrierRel } = fixture({ carrier: 'export function f() { return 1; }\n' });
    assert.equal(sharedHomeOf(root, carrierRel), null);
    const src = workerModuleSource(root, carrierRel);
    assert.equal(src.delegated, false);
    assert.equal(src.relPath, carrierRel);
  });
});

describe('worker-shared-modules — the refusals', () => {
  test('F1 a carrier that re-exports AND declares is `lost`, not a delegation', () => {
    // 🔴 THE ONE WITH THE HISTORY. A fork wearing a delegation: it reads as
    // delegated to every guard that follows delegations, and the declaration it
    // added is judged by nobody.
    const { root, carrierRel } = fixture({ carrier: `${REEXPORT}export const forked = 1;\n` });
    const answer = sharedHomeOf(root, carrierRel);
    assert.ok(answer !== null && 'lost' in answer, `expected { lost }, got ${JSON.stringify(answer)}`);
    assert.match(answer.lost, /not WHOLLY a re-export/);
  });

  test('F2 a named re-export is `lost` — it is a fork with a smaller surface', () => {
    const { root, carrierRel } = fixture({ carrier: "export { x } from '../../../_shared/src/m';\n" });
    const answer = sharedHomeOf(root, carrierRel);
    assert.ok(answer !== null && 'lost' in answer, `expected { lost }, got ${JSON.stringify(answer)}`);
  });

  test('F3 a specifier that resolves to no file is `lost`, never null', () => {
    // Answering `null` here would send the caller to judge the five-line
    // re-export itself, which declares nothing — a silent pass on a Worker whose
    // module resolves to nothing at all.
    const { root, carrierRel } = fixture({ carrier: "export * from '../../../_shared/src/missing';\n" });
    const answer = sharedHomeOf(root, carrierRel);
    assert.ok(answer !== null && 'lost' in answer, `expected { lost }, got ${JSON.stringify(answer)}`);
    assert.match(answer.lost, /resolves to no file/);
  });

  test('F4 the shared home being absent entirely is `lost`', () => {
    const { root, carrierRel } = fixture({ carrier: REEXPORT, shared: null });
    const answer = sharedHomeOf(root, carrierRel);
    assert.ok(answer !== null && 'lost' in answer, `expected { lost }, got ${JSON.stringify(answer)}`);
  });

  test('F5 a re-export of a target OUTSIDE the shared home is `lost`', () => {
    // This module answers for one home. A delegation to a sibling Worker is a
    // relationship nothing in this repository grades, and reading it as one home
    // would let a guard certify Worker A by reading Worker B.
    const root = join(TMP, `r${(seq += 1)}`);
    mkdirSync(join(root, 'services', 'other', 'src', 'lib'), { recursive: true });
    writeFileSync(join(root, 'services', 'other', 'src', 'lib', 'm.ts'), 'export const x = 1;\n');
    mkdirSync(join(root, 'services', '_shared', 'src'), { recursive: true });
    writeFileSync(join(root, 'services', '_shared', 'src', 'm.ts'), 'export const x = 1;\n');
    const carrierRel = 'services/w/src/lib/m.ts';
    mkdirSync(join(root, 'services', 'w', 'src', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'services', 'w', 'src', 'lib', 'm.ts'),
      "export * from '../../../other/src/lib/m';\n",
    );
    const answer = sharedHomeOf(root, carrierRel);
    assert.ok(answer !== null && 'lost' in answer, `expected { lost }, got ${JSON.stringify(answer)}`);
    assert.match(answer.lost, /outside/);
  });

  test('F6 a delegation that exists only in a COMMENT is not a delegation', () => {
    // A header saying "the one home is services/_shared/src/m.ts" above a real
    // implementation must be read as an ordinary module. Comments are stripped
    // BEFORE the shape is matched, and `looksDelegated` is measured on the code —
    // otherwise the prose that documents a move would itself perform one.
    const { root, carrierRel } = fixture({
      carrier: `// this file used to delegate to ${SHARED_DIR}/m.ts and no longer does\nexport function f() { return 2; }\n`,
    });
    assert.equal(sharedHomeOf(root, carrierRel), null);
  });

  test('F7 workerModuleSource passes `lost` through rather than falling back', () => {
    const { root, carrierRel } = fixture({ carrier: `${REEXPORT}export const forked = 1;\n` });
    const src = workerModuleSource(root, carrierRel);
    assert.ok('lost' in src, `expected { lost }, got ${JSON.stringify(src)}`);
  });

  test('F8 a carrier that does not exist is `lost`, not an empty source', () => {
    const src = workerModuleSource(TMP, 'services/nope/src/lib/m.ts');
    assert.ok('lost' in src, `expected { lost }, got ${JSON.stringify(src)}`);
  });
});

describe('worker-shared-modules — a chain inside the home (port-telemetry)', () => {
  const write = (root, rel, text) => {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  test('C1 GREEN CONTROL — carrier → home module → adapter resolves to the BODY', () => {
    const { root, carrierRel } = fixture({ carrier: REEXPORT, shared: "export * from './adapters/x/body';\n" });
    write(root, `${SHARED_DIR}/adapters/x/body.ts`, 'export function reportWorkerError() { return fetch("x"); }\n');
    const r = workerModuleSource(root, carrierRel);
    assert.ok(!('lost' in r), JSON.stringify(r));
    assert.equal(r.relPath, `${SHARED_DIR}/adapters/x/body.ts`);
    assert.match(r.source, /reportWorkerError/);
    assert.equal(r.delegated, true);
  });
  test('C2 a CYCLE inside the home is `lost`, never a pass', () => {
    const { root, carrierRel } = fixture({ carrier: REEXPORT, shared: "export * from './n';\n" });
    write(root, `${SHARED_DIR}/n.ts`, "export * from './m';\n");
    const r = workerModuleSource(root, carrierRel);
    assert.ok('lost' in r, JSON.stringify(r));
    assert.match(r.lost, /is a cycle/);
  });
  test('C3 a hop that leaves the home is `lost`', () => {
    const { root, carrierRel } = fixture({ carrier: REEXPORT, shared: "export * from '../../w/src/lib/elsewhere';\n" });
    write(root, 'services/w/src/lib/elsewhere.ts', 'export const y = 2;\n');
    const r = workerModuleSource(root, carrierRel);
    assert.ok('lost' in r, JSON.stringify(r));
    assert.match(r.lost, /outside services\/_shared\/src/);
  });
  test('C4 the REAL error-sink chain reaches the sentry-envelope adapter body', () => {
    for (const worker of ['platform', 'subscriptiontracker-api']) {
      const r = workerModuleSource(REPO, `services/${worker}/src/lib/error-sink.ts`);
      assert.ok(!('lost' in r), JSON.stringify(r));
      assert.equal(r.relPath, `${SHARED_DIR}/adapters/telemetry/sentry-envelope.ts`);
      assert.match(r.source, /export async function reportWorkerError\b/);
    }
  });
});

describe('worker-shared-modules — against the real tree', () => {
  test('R1 both Workers really do delegate error-sink.ts and health.ts to one home', () => {
    // The green control that would go red if the tree stopped matching the rule
    // this module encodes — the same reason chassis-delegation.test.mjs keeps
    // one live case beside its fixtures.
    for (const worker of ['platform', 'subscriptiontracker-api']) {
      for (const module of ['error-sink.ts', 'health.ts']) {
        const rel = `services/${worker}/src/lib/${module}`;
        const answer = sharedHomeOf(REPO, rel);
        assert.ok(
          answer !== null && !('lost' in answer),
          `${rel} did not resolve to the shared home: ${JSON.stringify(answer)}`,
        );
        assert.equal(answer.target, `${SHARED_DIR}/${module}`);
      }
    }
  });

  test('R2 middleware/auth.ts is NOT a delegation — it is a BINDING that names the secret', () => {
    // ⏱ 2026-10-01: the jose plumbing moved whole to
    // services/_shared/src/auth-middleware.ts (services/_shared declares `jose`
    // since then), and each Worker's middleware/auth.ts binds it: platform calls
    // the kit's verifier with no fallback, the app Worker passes its legacy
    // secret to `supabaseAuthWith` and re-exports `erasureAuth` by name. The
    // secret is still NAMED here, which is where assert-erasure-reach limb 3 reads
    // it — so this must keep answering null. If it ever answers `{ target }`, the
    // boundary was emptied into the kit and the guards that read it must be
    // re-pointed with the same care.
    for (const worker of ['platform', 'subscriptiontracker-api']) {
      assert.equal(sharedHomeOf(REPO, `services/${worker}/src/middleware/auth.ts`), null);
    }
  });
});
