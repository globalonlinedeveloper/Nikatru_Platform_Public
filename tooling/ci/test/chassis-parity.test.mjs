// ─────────────────────────────────────────────────────────────────────────────
// chassis-parity.test.mjs — assert-chassis-parity.mjs must be able to FAIL in all
// three directions, and must refuse to grade a tree it could not read.
//
// The guard's subject is ONE question: does an app get a shared capability from
// the shared package, or keep a private copy? The cases below drive a synthetic
// tree so each answer can be produced on purpose:
//   · new drift (an undeclared unadopted package) → 1
//   · a stale declaration (the app adopted it and the row stayed) → 1
//   · a declaration whose file list no longer matches the template → 1
//   · a row missing why / since / plan / files → 1
//   · every coverage floor → 2, never 0
//
// 🔴 THE CONTROL IS LOAD-BEARING HERE. Three of the five failing shapes differ from
// the passing tree by ONE line of JSON, so a control that passes is the only thing
// that proves the failures are caused by the mutation rather than by the fixture.
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
const GUARD = join(CI_DIR, 'assert-chassis-parity.mjs');
const TEMPLATE_LIB = join('tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-parity-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/** The row a passing tree declares: one unadopted package, fully justified. */
const ROW = {
  app: 'demo',
  package: 'nikatru_chassis_screens',
  since: '2026-09-12',
  why: 'the app predates the move and carries its own screens',
  cost: 'its pubspec does not declare the dependency either',
  plan: 'screen by screen, smallest first; delete this row on the last one',
  files: ['features/auth/sign_in_screen.dart'],
};

/**
 * A tree where the template delegates two packages and the app adopts one.
 *
 * `templateFiles` and `appFiles` are `relative path → source`; `rows` is the
 * manifest's `notAdopted`. Every case below changes exactly one of the three.
 */
function tree({ templateFiles, appFiles, rows, manifest = true, apps = true } = {}) {
  const root = join(TMP, `t${seq++}`);
  const tpl = templateFiles ?? {
    'features/auth/sign_in_screen.dart': "import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';\n",
    'state/providers.dart': "import 'package:nikatru_core/core.dart';\n",
  };
  for (const [rel, body] of Object.entries(tpl)) {
    const p = join(root, TEMPLATE_LIB, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  if (apps) {
    const app = appFiles ?? { 'state/providers/auth.dart': "import 'package:nikatru_core/core.dart';\n" };
    for (const [rel, body] of Object.entries(app)) {
      const p = join(root, 'apps', 'demo', 'lib', ...rel.split('/'));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
  }
  if (manifest) {
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(
      join(root, 'tooling', 'chassis-parity.json'),
      `${JSON.stringify({ notAdopted: rows ?? [ROW] }, null, 2)}\n`,
    );
  }
  return root;
}

describe('assert-chassis-parity — the control', () => {
  test('an app that adopts one package and declares the other passes, and names what it graded', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /chassis parity/);
    assert.match(out, /2 app x package pair\(s\)/);
    assert.match(out, /nikatru_chassis_screens, nikatru_core/);
    // the declared debt is PRINTED, so it cannot be forgotten while it is tolerated
    assert.match(out, /declared debt/);
    assert.match(out, /since 2026-09-12/);
  });
});

describe('assert-chassis-parity — the three ways to go red', () => {
  test('NEW DRIFT: an unadopted package with no row fails, naming the template files', () => {
    const { code, out } = run(tree({ rows: [] }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/demo imports `nikatru_chassis_screens` in NO file/);
    assert.match(out, /features\/auth\/sign_in_screen\.dart/);
    assert.match(out, /The factory is the base/);
  });

  // 🔴 THE DIRECTION THAT KEEPS THE FILE HONEST. Without it the manifest becomes a
  // list of things that used to be true and the next reader cannot tell which half
  // is current — the exact rot this repository's registers grow when nobody has to
  // delete a satisfied row.
  test('PAID DEBT: the app adopts the package and the row stays → fails, saying delete the row', () => {
    const { code, out } = run(
      tree({
        appFiles: {
          'state/providers/auth.dart': "import 'package:nikatru_core/core.dart';\n",
          'features/auth/sign_in.dart': "import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';\n",
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /THE DEBT IS PAID — delete the row/);
    assert.match(out, /now imports it in 1 file\(s\)/);
  });

  test('MOVED TARGET: the template delegates a file the row does not list → fails naming ADDED', () => {
    const { code, out } = run(
      tree({
        templateFiles: {
          'features/auth/sign_in_screen.dart': "import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';\n",
          'features/auth/sign_up_screen.dart': "import 'package:nikatru_chassis_screens/auth/sign_up_screen.dart';\n",
          'state/providers.dart': "import 'package:nikatru_core/core.dart';\n",
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /ADDED: features\/auth\/sign_up_screen\.dart/);
    assert.match(out, /nobody decided what the unmigrated app should do about it/);
  });

  test('…and the mirror: a delegation the template dropped is named GONE', () => {
    const { code, out } = run(
      tree({ rows: [{ ...ROW, files: [...ROW.files, 'features/auth/gone_screen.dart'] }] }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /GONE: features\/auth\/gone_screen\.dart/);
  });
});

describe('assert-chassis-parity — a debt must be justified', () => {
  for (const field of ['why', 'since', 'plan']) {
    test(`a row with no \`${field}\` fails`, () => {
      const row = { ...ROW };
      delete row[field];
      const { code, out } = run(tree({ rows: [row] }));
      assert.equal(code, 1, out);
      assert.match(out, new RegExp(`has no \\\`${field}\\\``));
      assert.match(out, /permission slip/);
    });
  }

  test('a row with no `files` array fails — nothing would pin which delegations it covers', () => {
    const row = { ...ROW };
    delete row.files;
    const { code, out } = run(tree({ rows: [row] }));
    assert.equal(code, 1, out);
    assert.match(out, /has no `files` array/);
    assert.match(out, /could grow one silently/);
  });
});

describe('assert-chassis-parity — COVERAGE LOST, never a pass', () => {
  test('no manifest at all is exit 2, not "no declared debts"', () => {
    const { code, out } = run(tree({ manifest: false }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /refuses to grade rather than guess/);
  });

  test('a manifest with no `notAdopted` key is exit 2 — an empty ratchet is `[]`', () => {
    const root = tree();
    writeFileSync(join(root, 'tooling', 'chassis-parity.json'), '{"_what":"nothing"}\n');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /not an absent key/);
  });

  test('an unparseable manifest is exit 2, naming the parse error', () => {
    const root = tree();
    writeFileSync(join(root, 'tooling', 'chassis-parity.json'), '{ not json\n');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /did not parse/);
  });

  test('a template lib with no shared import at all is exit 2 — the matcher may have stopped matching', () => {
    const { code, out } = run(tree({ templateFiles: { 'main.dart': "import 'dart:async';\n" } }));
    assert.equal(code, 2, out);
    assert.match(out, /imports a `package:nikatru_\*`/);
  });

  test('no apps/<id>/lib is exit 2, not a vacuous pass over zero apps', () => {
    const { code, out } = run(tree({ apps: false }));
    assert.equal(code, 2, out);
    assert.match(out, /no apps\/<id>\/lib directory exists/);
  });

  test('no template lib is exit 2', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(join(root, 'apps', 'demo', 'lib'), { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /does not exist/);
  });
});

// ⏱ 2026-09-15 · [ADR 086] partial adoption — one piece at a time. Each case is
// declared on its own (assert-no-loop-cases).
const ADOPTING_APP = {
  'state/providers/auth.dart': "import 'package:nikatru_core/core.dart';\n",
  'app.dart': "import 'package:nikatru_chassis_screens/shell/app_shell.dart';\n",
};
const adoptedRow = (adopted) => ({ ...ROW, adopted });
const PIECE = { file: 'app.dart', piece: 'OfflineBannerHost', on: '2026-09-15', callSiteDelta: -2 };

describe('assert-chassis-parity — partial adoption ([ADR 086])', () => {
  test('a partly paid debt passes and PRINTS what was adopted and what stays owed', () => {
    const { code, out } = run(tree({ appFiles: ADOPTING_APP, rows: [adoptedRow([PIECE])] }));
    assert.equal(code, 0, out);
    assert.match(out, /declared debt, partly paid — apps\/demo adopts `nikatru_chassis_screens` in 1 file\(s\) \(OfflineBannerHost -2\)/);
  });

  test('an import the row does not record FAILS naming it UNRECORDED', () => {
    const { code, out } = run(
      tree({
        appFiles: { ...ADOPTING_APP, 'features/x.dart': "import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';\n" },
        rows: [adoptedRow([PIECE])],
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /UNRECORDED: features\/x\.dart/);
  });

  test('a recorded piece whose file no longer imports the package FAILS', () => {
    const { code, out } = run(
      tree({ appFiles: ADOPTING_APP, rows: [adoptedRow([PIECE, { ...PIECE, file: 'gone.dart' }])] }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /NO LONGER IMPORTS: gone\.dart/);
  });

  test('a callSiteDelta that is not negative FAILS — ADR 066: the call site must shrink', () => {
    const { code, out } = run(tree({ appFiles: ADOPTING_APP, rows: [adoptedRow([{ ...PIECE, callSiteDelta: 3 }])] }));
    assert.equal(code, 1, out);
    assert.match(out, /records callSiteDelta 3/);
  });

  test('a partly paid row still pins the template files — an ADDED delegation FAILS', () => {
    const { code, out } = run(
      tree({
        templateFiles: {
          'features/auth/sign_in_screen.dart': "import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';\n",
          'features/auth/sign_up_screen.dart': "import 'package:nikatru_chassis_screens/auth/sign_up_screen.dart';\n",
          'state/providers.dart': "import 'package:nikatru_core/core.dart';\n",
        },
        appFiles: ADOPTING_APP,
        rows: [adoptedRow([PIECE])],
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /ADDED: features\/auth\/sign_up_screen\.dart/);
  });
});

describe('assert-chassis-parity — the real repository', () => {
  // 🔴 A GREEN UNIT SUITE OVER A SYNTHETIC TREE PROVES THE GUARD, NOT THE REPO.
  test('the tree as it stands is graded, and its one declared debt is printed', () => {
    const { code, out } = run(resolve(CI_DIR, '..', '..'));
    assert.equal(code, 0, out);
    assert.match(out, /nikatru_chassis_screens/);
    assert.match(out, /declared debt/);
  });
});
