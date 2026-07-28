// ─────────────────────────────────────────────────────────────────────────────
// capability-register.test.mjs — assert-capability-register.mjs must be able to FAIL.
//
// [pipeline C-1] one declared home per capability · [pipeline C-2] no capability
// without a consumer. Both requirements name that one guard as their enforcement,
// and C-2 was marked VERIFIED at 5f3466b while the guard did not exist — so the
// tree was correct and unprotected.
//
// ⚠️ These fixtures are the SECOND line of evidence, not the first. CLAUDE.md:
// "A fixture passing is not a guard working — MUTATE THE REAL TREE", because a
// fixture you wrote encodes the same misunderstanding as the guard you wrote.
// Six mutations were run against the real repository first (package dropped from
// the register, consumer dropping a claimed dep, an unregistered dep wired in, a
// dead seam path, a reasonless zero-consumer entry, and an empty tree), each was
// caught, and each message was read to confirm it failed for the intended reason
// rather than incidentally. These tests keep that closed.
//
// Every case builds a fake tree and runs the real guard against it with the root
// passed as argv[2] — the guard resolves every path from there, so this exercises
// the real code with no stubbing.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-capability-register.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-caps-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** MIN_EXPECTED_PACKAGES in the guard is 5, so a fixture needs at least that
 *  many package dirs to get past the coverage floor and reach the real checks. */
const BASE = ['core', 'api_client', 'design_system', 'telemetry', 'storage'];

let seq = 0;

/** A minimally valid tree: 5 packages, each consumed by one app.
 *  `mutate(register, files)` breaks exactly one thing. */
function tree({ mutate = null, registerRaw = null, omitRegister = false } = {}) {
  const root = join(TMP, `r${seq++}`);

  const capabilities = BASE.map((id) => ({
    id,
    capability: `test capability ${id}`,
    owner: `packages/${id}`,
    package: `nikatru_${id}`,
    seam: `packages/${id}/lib/nikatru_${id}.dart`,
    consumers: ['apps/app1'],
  }));

  const register = {
    consumerRoots: ['apps/app1'],
    capabilities,
  };

  const files = {};
  for (const id of BASE) {
    mkdirSync(join(root, 'packages', id, 'lib'), { recursive: true });
    files[join(root, 'packages', id, 'lib', `nikatru_${id}.dart`)] = '// seam\n';
  }
  mkdirSync(join(root, 'apps', 'app1'), { recursive: true });
  mkdirSync(join(root, 'tooling'), { recursive: true });

  const deps = BASE.map((id) => `  nikatru_${id}:\n    path: ../../packages/${id}`).join('\n');
  files[join(root, 'apps', 'app1', 'pubspec.yaml')] = `name: app1\ndependencies:\n${deps}\n`;

  if (mutate) mutate(register, files, root);

  if (!omitRegister) {
    files[join(root, 'tooling', 'capability-register.json')] =
      registerRaw ?? JSON.stringify(register, null, 2);
  }

  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('assert-capability-register.mjs — the passing path', () => {
  test('a well-formed register over a matching tree passes', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}capability register/);
  });

  test('a zero-consumer capability WITH a recorded reason passes, and the gap is printed', () => {
    const root = tree({
      mutate: (reg) => {
        reg.capabilities.push({
          id: 'lonely',
          capability: 'unconsumed on purpose',
          owner: 'packages/core',
          package: null,
          seam: 'packages/core/lib/nikatru_core.dart',
          consumers: [],
          unconsumedReason: 'a node package with no pubspec; gated by its own CI lane',
        });
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    // The waiver must be VISIBLE on a passing run — a waiver you stop seeing
    // becomes permanent.
    assert.match(out, /⚠ {2}lonely — no consumer/);
    assert.match(out, /1 with a recorded reason/);
  });
});

describe('[C-1] register ↔ disk', () => {
  test('fails when a package dir on disk has no register entry', () => {
    const root = tree({
      mutate: (reg) => {
        reg.capabilities = reg.capabilities.filter((c) => c.id !== 'telemetry');
        reg.consumerRoots = []; // avoid direction-(b) noise drowning the signal
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    // consumerRoots emptied above trips its own check first, so re-run the
    // narrower case: keep the root but drop the dep too.
    const root2 = tree({
      mutate: (reg, files, r) => {
        reg.capabilities = reg.capabilities.filter((c) => c.id !== 'telemetry');
        const deps = BASE.filter((id) => id !== 'telemetry')
          .map((id) => `  nikatru_${id}:\n    path: ../../packages/${id}`)
          .join('\n');
        files[join(r, 'apps', 'app1', 'pubspec.yaml')] = `name: app1\ndependencies:\n${deps}\n`;
      },
    });
    const r2 = run(root2);
    assert.equal(r2.code, 1, r2.out);
    assert.match(r2.out, /packages\/telemetry — on disk but absent from the capability register/);
  });

  test('fails when the register names an owner dir that does not exist', () => {
    const root = tree({ mutate: (reg) => { reg.capabilities[0].owner = 'packages/ghost'; } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /names owner `packages\/ghost`, which does not exist/);
  });

  test('fails when the register names a seam file that does not exist', () => {
    const root = tree({ mutate: (reg) => { reg.capabilities[0].seam = 'packages/core/lib/gone.dart'; } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /names seam `packages\/core\/lib\/gone\.dart`, which does not exist/);
  });

  test('fails when an entry has no owner path', () => {
    const root = tree({ mutate: (reg) => { delete reg.capabilities[0].owner; } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /has no `owner` path/);
  });

  test('fails when an entry has no seam entrypoint', () => {
    const root = tree({ mutate: (reg) => { delete reg.capabilities[0].seam; } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /has no `seam` entrypoint/);
  });
});

describe('[C-1] consumers are verified in both directions', () => {
  test('(a) fails when a claimed consumer does not declare the package', () => {
    const root = tree({
      mutate: (reg, files, r) => {
        const deps = BASE.filter((id) => id !== 'telemetry')
          .map((id) => `  nikatru_${id}:\n    path: ../../packages/${id}`)
          .join('\n');
        files[join(r, 'apps', 'app1', 'pubspec.yaml')] = `name: app1\ndependencies:\n${deps}\n`;
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /register claims `apps\/app1` consumes `nikatru_telemetry`, but that pubspec does not declare it/);
  });

  test('(b) fails when a consumer declares a package that is not registered', () => {
    const root = tree({
      mutate: (reg, files, r) => {
        const deps = [...BASE.map((id) => `  nikatru_${id}:\n    path: ../../packages/${id}`), '  nikatru_ghost:\n    path: ../../packages/ghost'].join('\n');
        files[join(r, 'apps', 'app1', 'pubspec.yaml')] = `name: app1\ndependencies:\n${deps}\n`;
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /depends on `nikatru_ghost`, which has no capability register entry/);
  });

  test('(b) fails when the register omits a consumer that really depends on the package', () => {
    const root = tree({ mutate: (reg) => { reg.capabilities[0].consumers = []; reg.capabilities[0].unconsumedReason = 'claims nobody uses it'; } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /but the register does not list it as a consumer/);
  });

  test('fails when a consumerRoot has no pubspec at all', () => {
    const root = tree({ mutate: (reg) => { reg.consumerRoots = ['apps/app1', 'apps/missing']; } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /consumerRoots names `apps\/missing`, which has no pubspec\.yaml/);
  });

  test('fails when consumerRoots is empty — direction (b) could never fire', () => {
    const root = tree({ mutate: (reg) => { reg.consumerRoots = []; } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /declares no `consumerRoots`/);
  });
});

describe('[C-2] a capability with no consumer is not built', () => {
  test('fails on zero consumers with no recorded reason', () => {
    const root = tree({
      mutate: (reg, files, r) => {
        reg.capabilities[0].consumers = [];
        const deps = BASE.filter((id) => id !== 'core')
          .map((id) => `  nikatru_${id}:\n    path: ../../packages/${id}`)
          .join('\n');
        files[join(r, 'apps', 'app1', 'pubspec.yaml')] = `name: app1\ndependencies:\n${deps}\n`;
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /ZERO consumers and no `unconsumedReason`/);
  });

  test('an empty-string reason does not count as a reason', () => {
    const root = tree({
      mutate: (reg, files, r) => {
        reg.capabilities[0].consumers = [];
        reg.capabilities[0].unconsumedReason = '   ';
        const deps = BASE.filter((id) => id !== 'core')
          .map((id) => `  nikatru_${id}:\n    path: ../../packages/${id}`)
          .join('\n');
        files[join(r, 'apps', 'app1', 'pubspec.yaml')] = `name: app1\ndependencies:\n${deps}\n`;
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /ZERO consumers and no `unconsumedReason`/);
  });
});

describe('the guard knows when it is not looking', () => {
  test('COVERAGE LOST when the tree has too few packages', () => {
    const root = tree();
    rmSync(join(root, 'packages', 'telemetry'), { recursive: true, force: true });
    rmSync(join(root, 'packages', 'storage'), { recursive: true, force: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /The scan is broken, not the tree/);
  });

  test('COVERAGE LOST when the register file is absent', () => {
    const { code, out } = run(tree({ omitRegister: true }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no capability register/);
  });

  test('fails loudly on malformed JSON rather than treating it as empty', () => {
    const { code, out } = run(tree({ registerRaw: '{ "capabilities": [ ' }));
    assert.equal(code, 1);
    assert.match(out, /not valid JSON/);
  });

  test('fails when the register has no capabilities array', () => {
    const { code, out } = run(tree({ registerRaw: '{"consumerRoots":["apps/app1"]}' }));
    assert.equal(code, 1);
    assert.match(out, /no `capabilities` array/);
  });
});
