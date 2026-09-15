// ─────────────────────────────────────────────────────────────────────────────
// chassis-ledger.test.mjs — assert-chassis-ledger.mjs must be able to FAIL.
//
// Every case builds a SYNTHETIC GIT REPOSITORY and runs the guard against it.
// A git repo rather than a plain directory because the guard derives the
// template's contents from `git ls-files`, exactly as the tree does — the same
// reason vacuity-b.test.mjs builds one. Nothing here touches the real tree.
//
// The fixture deliberately does NOT contain `tooling/ci/assert-chassis-ledger.mjs`,
// so the guard's own sentinel reports "not a full checkout" and the 60-file floor
// is skipped. That is what lets a three-file fixture exercise every other limb
// without tripping a floor written for a 96-file template.
//
// 🔴 EVERY CASE HERE WAS PROVEN ABLE TO FAIL. Before this file was kept, each
// limb of the guard was removed in turn and the suite re-run; the case named
// beside each limb went red. A test that cannot fail is worse than no test, and
// this repository has found three that could not.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, '..', 'assert-chassis-ledger.mjs');
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
// The SECOND root, since 2026-09-07 ([ADR 067] phase 2, unit app-shell). The
// guard owns the root list; the fixture must build BOTH or the per-root
// coverage limb refuses before any other limb is reached, which is the guard
// working and would make every case below untestable.
const WORKER = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';

const write = (root, rel, body) => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

/** A minimal template: three tracked files, and a ledger that describes them. */
function fixture(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'chassis-ledger-'));
  const files = {
    'lib/main.dart': 'void main() {}\n',
    'lib/core/app_config.dart': 'class AppConfig {}\n',
    'pubspec.yaml': 'name: app\n',
  };
  for (const [rel, body] of Object.entries(files)) write(root, `${BRICK}/${rel}`, body);

  // The Worker half of the template. ONE file is enough: what the fixture has to
  // reproduce is that the root is non-empty and its rows are keyed by it, and the
  // fixture is not a checkout so no file floor applies.
  const workerFiles = { 'src/index.ts': 'export default {};\n' };
  for (const [rel, body] of Object.entries(workerFiles)) write(root, `${WORKER}/${rel}`, body);

  const countLines = (body) => body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
  const rows = Object.entries(files).map(([path, body]) => ({
    path,
    lines: countLines(body),
    verdict: 'STAYS',
    why: 'per-app by construction',
  }));
  // `root` is written EXPLICITLY on the second root's rows and OMITTED on the
  // first's, because that is exactly how the real ledger is shaped: the 96 rows
  // written before there was a second root default to ROOTS[0] and were not
  // re-keyed.
  const workerRows = Object.entries(workerFiles).map(([path, body]) => ({
    root: WORKER,
    path,
    lines: countLines(body),
    verdict: 'STAYS',
    why: 'per-app Worker by construction',
  }));
  const allRows = [...rows, ...workerRows];
  const ledger = {
    roots: [BRICK, WORKER],
    totals: {
      files: allRows.length,
      lines: allRows.reduce((n, r) => n + r.lines, 0),
      unclassified: 0,
    },
    files: allRows,
  };

  const bag = { root, ledger, files };
  mutate(bag);
  write(root, 'tooling/chassis-ledger.json', JSON.stringify(bag.ledger, null, 2) + '\n');

  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '-A']);
  return root;
}

function run(root) {
  const r = spawnSync('node', [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const withFixture = (mutate, check) => {
  const root = fixture(mutate);
  try {
    check(run(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe('assert-chassis-ledger · the control', () => {
  test('an accounted-for template passes, and says what it counted', () => {
    withFixture(() => {}, (r) => {
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /4 tracked file\(s\) across 2 root\(s\)/);
      assert.match(r.out, /STAYS=4/);
      // The fixture is not a checkout of this repo, and the guard must SAY so
      // rather than silently skipping its floor.
      assert.match(r.out, /NOT applied/);
    });
  });
});

describe('assert-chassis-ledger · bijection, both directions', () => {
  test('a tracked file with no ledger row FAILS', () => {
    withFixture((b) => { write(b.root, `${BRICK}/lib/sneaky.dart`, 'int x = 1;\n'); },
      (r) => {
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /lib\/sneaky\.dart[\s\S]*NO ledger row/);
      });
  });

  test('a ledger row naming no tracked file FAILS', () => {
    withFixture((b) => {
      b.ledger.files.push({ path: 'lib/ghost.dart', lines: 4, verdict: 'STAYS', why: 'x' });
      b.ledger.totals.files += 1;
    }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /ghost\.dart[\s\S]*not tracked/);
    });
  });

  test('the same path declared twice FAILS', () => {
    withFixture((b) => { b.ledger.files.push({ ...b.ledger.files[0] }); b.ledger.totals.files += 1; },
      (r) => {
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /twice/);
      });
  });
});

describe('assert-chassis-ledger · the counts are recomputed, never trusted', () => {
  test('a recorded line count that disagrees with the tree FAILS', () => {
    withFixture((b) => { b.ledger.files[0].lines += 7; b.ledger.totals.lines += 7; },
      (r) => {
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /the ledger records[\s\S]*the tree has/);
      });
  });

  test('totals.lines drifting from the rows FAILS', () => {
    withFixture((b) => { b.ledger.totals.lines += 100; },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /totals\.lines/); });
  });

  test('totals.files drifting from the tree FAILS', () => {
    withFixture((b) => { b.ledger.totals.files = 99; },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /totals\.files/); });
  });

  test('totals.unclassified drifting from the rows FAILS', () => {
    withFixture((b) => { b.ledger.totals.unclassified = 5; },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /totals\.unclassified/); });
  });
});

describe('assert-chassis-ledger · the ADR 066 rule is mechanical', () => {
  const asMove = (b, extra) => Object.assign(b.ledger.files[0], { verdict: 'MOVES', ...extra });

  test('MOVES with no measured callSiteDelta FAILS', () => {
    withFixture((b) => { asMove(b, { target: 'packages' }); },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /no measured `callSiteDelta`/); });
  });

  test('MOVES whose call site GREW FAILS — this is the whole rule', () => {
    withFixture((b) => { asMove(b, { target: 'packages', callSiteDelta: 148 }); },
      (r) => {
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /does NOT shrink the caller/);
      });
  });

  test('MOVES with a delta of exactly zero FAILS — no change is not a win', () => {
    withFixture((b) => { asMove(b, { target: 'packages', callSiteDelta: 0 }); },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /does NOT shrink the caller/); });
  });

  test('MOVES naming a target that does not exist FAILS', () => {
    withFixture((b) => { asMove(b, { target: 'packages/nowhere', callSiteDelta: -20 }); },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /does not exist/); });
  });

  test('CONTROL — MOVES that shrinks the caller, to a real target, PASSES', () => {
    withFixture((b) => {
      mkdirSync(join(b.root, 'packages/design_system'), { recursive: true });
      writeFileSync(join(b.root, 'packages/design_system/x.dart'), '// x\n');
      asMove(b, { target: 'packages/design_system', callSiteDelta: -120 });
    }, (r) => {
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /MOVES=1/);
    });
  });

  test('GOES whose caller GREW FAILS', () => {
    withFixture((b) => { Object.assign(b.ledger.files[0], { verdict: 'GOES', callSiteDelta: 12 }); },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /made the caller bigger/); });
  });
});

describe('assert-chassis-ledger · a row nobody thought about', () => {
  test('an empty reason FAILS', () => {
    withFixture((b) => { b.ledger.files[0].why = '   '; },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /no `why`/); });
  });

  test('an unknown verdict FAILS', () => {
    withFixture((b) => { b.ledger.files[0].verdict = 'PROBABLY'; },
      (r) => { assert.equal(r.code, 1, r.out); assert.match(r.out, /is not one of/); });
  });
});

describe('assert-chassis-ledger · coverage, because a scan over nothing prints ok', () => {
  test('a DELETED ledger is COVERAGE LOST, not a pass', () => {
    const root = fixture();
    try {
      rmSync(join(root, 'tooling/chassis-ledger.json'));
      const r = run(root);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST[\s\S]*does not exist/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // 🔴 THIS CASE FOUND A REAL HOLE and is kept for that reason. The first draft
  // of it wrote `null` into the file while believing it was testing a DELETED
  // one. `JSON.parse('null')` succeeds, so the parse guard passed it through and
  // the guard threw a raw TypeError on `ledger.files`. Still exit 1 — but a
  // stack trace instead of the sentence that says the ledger is unusable, which
  // reads as a broken guard rather than a broken tree.
  test('a ledger that parses to null is COVERAGE LOST, not a stack trace', () => {
    const root = fixture();
    try {
      writeFileSync(join(root, 'tooling/chassis-ledger.json'), 'null\n');
      const r = run(root);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST[\s\S]*not to an object[\s\S]*null/);
      assert.doesNotMatch(r.out, /TypeError/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a ledger declaring no files is COVERAGE LOST', () => {
    withFixture((b) => { b.ledger.files = []; }, (r) => {
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST[\s\S]*vacuously/);
    });
  });

  test('an empty template is COVERAGE LOST', () => {
    const root = mkdtempSync(join(tmpdir(), 'chassis-ledger-empty-'));
    try {
      write(root, 'tooling/chassis-ledger.json', JSON.stringify({ files: [{ path: 'a', lines: 1, verdict: 'STAYS', why: 'x' }] }));
      execFileSync('git', ['-C', root, 'init', '-q']);
      execFileSync('git', ['-C', root, 'add', '-A']);
      const r = run(root);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST[\s\S]*no tracked file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('assert-chassis-ledger · the real repository', () => {
  test('the committed ledger accounts for the real template', () => {
    const repo = join(HERE, '..', '..', '..');
    const r = run(repo);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /every one accounted for/);
    // The real repo IS a checkout, so the floor must have been applied — the
    // opposite branch from the fixture control above, and it must say so.
    assert.match(r.out, /full checkout, so each root's own file floor was applied/);
  });
});

// ── THE SECOND ROOT ─────────────────────────────────────────────
// Added 2026-09-07 with the roots change. Each of these was proven able to fail
// by removing the limb it names and re-running this file.
describe('assert-chassis-ledger · two roots, and nothing between them', () => {
  test('a tracked template file under NEITHER root FAILS — limb 0', () => {
    withFixture((b) => {
      write(b.root, 'tooling/bricks/app/__brick__/orphan.txt', 'stray\n');
    }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /orphan\.txt[\s\S]*falls under NO declared root/);
    });
  });

  test('a file in the SECOND root with no row FAILS the bijection', () => {
    withFixture((b) => {
      write(b.root, `${WORKER}/src/lib/health.ts`, 'export {};\n');
    }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /health\.ts[\s\S]*NO ledger row/);
    });
  });

  test("a second-root row whose line count drifts FAILS — the recount reads that root's tree", () => {
    withFixture((b) => {
      b.ledger.files.find((f) => f.root === WORKER).lines = 99;
      b.ledger.totals.lines += 98;
    }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /records 99 line\(s\); the tree has 1/);
    });
  });

  test('a row naming a root the guard does not scan FAILS', () => {
    withFixture((b) => {
      b.ledger.files.push({
        root: 'tooling/bricks/app/__brick__/somewhere-else',
        path: 'x.ts', lines: 1, verdict: 'STAYS', why: 'x',
      });
      b.ledger.totals.files += 1;
      b.ledger.totals.lines += 1;
    }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /which this guard does not scan/);
    });
  });

  test("a ledger `roots` that disagrees with the guard is COVERAGE LOST", () => {
    withFixture((b) => { b.ledger.roots = [BRICK]; }, (r) => {
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST[\s\S]*roots` disagrees/);
    });
  });

  test('a ledger with NO `roots` at all is COVERAGE LOST, never a pass', () => {
    withFixture((b) => { delete b.ledger.roots; }, (r) => {
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST[\s\S]*declares no `roots`/);
    });
  });

  test('the SAME relative path under both roots is two rows, not a duplicate', () => {
    withFixture((b) => {
      write(b.root, `${WORKER}/pubspec.yaml`, 'name: worker\n');
      b.ledger.files.push({ root: WORKER, path: 'pubspec.yaml', lines: 1, verdict: 'STAYS', why: 'x' });
      b.ledger.totals.files += 1;
      b.ledger.totals.lines += 1;
    }, (r) => {
      assert.equal(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /twice/);
      assert.match(r.out, /5 tracked file\(s\)/);
    });
  });

  test('the real repository prints a per-root breakdown, not one blended total', () => {
    const repo = join(HERE, '..', '..', '..');
    const r = run(repo);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /apps\/\{\{app_id\}\} — \d+ file\(s\), \d+ line\(s\)/);
    assert.match(r.out, /\{\{app_id\}\}-api — \d+ file\(s\), \d+ line\(s\)/);
  });
});
