// ─────────────────────────────────────────────────────────────────────────────
// capability-register-seams.test.mjs — the v2 checks in
// assert-capability-register.mjs must be able to FAIL.
//
// Added 2026-07-28 when [2]C-1 was REBUILT. v1 of the guard shipped the same day
// with two structural mistakes that no test could have caught, because the tests
// encoded the same misunderstanding:
//   · every `seam` pointed at a package BARREL FILE, so it asserted nothing about
//     the actual contract. packages/core DECLARES the interfaces; other packages
//     implement them.
//   · there was no concept of a seam METHOD (so decision item 12's notification
//     tap surface could not be carried) and none of LOCATION (so both the Subly
//     notification fork and the misplaced AnalyticsFunnel passed clean).
//
// The finding came from researching C-1 against 00-RECONCILIATION-DECISIONS.md,
// not from a test — which is why the walk researches even "completed"
// requirements. These tests hold the rebuilt behaviour closed.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-capability-register.mjs');

/** MIN_EXPECTED_PACKAGES in the guard is 5. */
const BASE = ['core', 'api_client', 'design_system', 'telemetry', 'storage'];

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-seams-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Writes a tree with 5 packages, one app consuming all of them, and a register.
 *  `core` declares one seam interface; `mutate(capabilities, files, root)` breaks
 *  exactly one thing. */
function tree({ symbol = 'NotificationService', methods = ['init'], seamSrc = null, forkSrc = null, mutate = null } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};
  for (const id of BASE) {
    mkdirSync(join(root, 'packages', id, 'lib'), { recursive: true });
    files[join(root, 'packages', id, 'lib', `nikatru_${id}.dart`)] = '// barrel\n';
  }
  mkdirSync(join(root, 'apps', 'app1', 'lib', 'services'), { recursive: true });
  mkdirSync(join(root, 'tooling'), { recursive: true });

  files[join(root, 'packages', 'core', 'lib', 'seam.dart')] =
    seamSrc ?? `abstract interface class ${symbol} {\n${methods.map((m) => `  Future<void> ${m}();`).join('\n')}\n}\n`;

  const deps = BASE.map((id) => `  nikatru_${id}:\n    path: ../../packages/${id}`).join('\n');
  files[join(root, 'apps', 'app1', 'pubspec.yaml')] = `name: app1\ndependencies:\n${deps}\n`;
  if (forkSrc) files[join(root, 'apps', 'app1', 'lib', 'services', 'fork.dart')] = forkSrc;

  const capabilities = BASE.map((id) => ({
    id,
    capability: `test capability ${id}`,
    owner: `packages/${id}`,
    package: `nikatru_${id}`,
    seams: id === 'core' ? [{ file: 'packages/core/lib/seam.dart', symbol, methods }] : [],
    ...(id === 'core' ? {} : { noSeamReason: 'a plain library in this fixture' }),
    consumers: ['apps/app1'],
  }));

  if (mutate) mutate(capabilities, files, root);

  files[join(root, 'tooling', 'capability-register.json')] =
    JSON.stringify({ consumerRoots: ['apps/app1'], capabilities }, null, 2);

  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

describe('[C-1] a seam SYMBOL must really be declared where the register says', () => {
  test('the passing case: real symbol, real methods', () => {
    const { code, out } = run(tree({ methods: ['init', 'cancelAll'] }));
    assert.equal(code, 0, out);
    assert.match(out, /seam symbol\(s\) verified in place/);
  });

  test('fails when the claimed symbol is not declared in that file', () => {
    const { code, out } = run(tree({ symbol: 'Ghost', seamSrc: 'abstract interface class Other {}\n' }));
    assert.equal(code, 1);
    assert.match(out, /declares `Ghost`, but no class of that name is declared there/);
  });

  test('a mere MENTION of the symbol is not a declaration', () => {
    // v1's failure mode in miniature: matching prose instead of structure.
    const { code, out } = run(tree({ symbol: 'Ghost', seamSrc: '// Ghost used to live here.\nabstract interface class Other {}\n' }));
    assert.equal(code, 1);
    assert.match(out, /no class of that name is declared there/);
  });

  test('fails when the seam file does not exist', () => {
    const { code, out } = run(tree({ mutate: (caps) => { caps[0].seams[0].file = 'packages/core/lib/gone.dart'; } }));
    assert.equal(code, 1);
    assert.match(out, /seam file `packages\/core\/lib\/gone\.dart` does not exist/);
  });
});

describe('[C-1 · decision item 12] a seam METHOD must really exist', () => {
  test('fails when a claimed method is absent from the interface', () => {
    const { code, out } = run(tree({
      symbol: 'S',
      methods: ['init', 'onTapped'],
      seamSrc: 'abstract interface class S {\n  Future<void> init();\n}\n',
    }));
    assert.equal(code, 1);
    // Naming a seam method is only useful if it is checked — that is the whole
    // content of decision item 12.
    assert.match(out, /has method `onTapped`, which is not declared in that class/);
  });

  // 🔴 THE MUTATION THAT SURVIVED THE RAW-SOURCE VERSION. Proven on a copy of the
  // real tree 2026-08-01: a complete, compile-clean rename of `scheduleDaily` to
  // `scheduleReminder` in packages/core/.../notification_service.dart that left
  // the old name in ONE house-style doc comment kept this guard at exit 0, still
  // printing "seam symbol(s) verified in place" for a method the interface no
  // longer had. Deleting that single comment line was the entire difference.
  test('a doc comment naming the method is NOT the method', () => {
    const { code, out } = run(tree({
      symbol: 'S',
      methods: ['init', 'scheduleDaily'],
      seamSrc:
        'abstract interface class S {\n' +
        '  Future<void> init();\n' +
        '  /// Renamed 2026-08-01: scheduleDaily(DailyReminder) is now scheduleReminder().\n' +
        '  Future<void> scheduleReminder();\n' +
        '}\n',
    }));
    assert.equal(code, 1, 'the comment is the only place the old name survives');
    assert.match(out, /has method `scheduleDaily`, which is not declared in that class/);
  });

  test('a string literal naming the method is NOT the method', () => {
    const { code, out } = run(tree({
      symbol: 'S',
      methods: ['init', 'scheduleDaily'],
      seamSrc:
        'abstract interface class S {\n' +
        '  Future<void> init();\n' +
        "  static const migrationNote = 'scheduleDaily(r) was removed';\n" +
        '}\n',
    }));
    assert.equal(code, 1);
    assert.match(out, /has method `scheduleDaily`, which is not declared in that class/);
  });

  // The method claim is about THAT INTERFACE — the register's own _readme says
  // so. An unanchored `\bname\s*\(` let any sibling class in the same file, or
  // any call site, stand in for the contract.
  test('a sibling class in the same file does NOT satisfy the interface’s claim', () => {
    const { code, out } = run(tree({
      symbol: 'S',
      methods: ['init', 'scheduleDaily'],
      seamSrc:
        'abstract interface class S {\n  Future<void> init();\n}\n\n' +
        'class NoOpS implements S {\n' +
        '  @override\n  Future<void> init() async {}\n' +
        '  Future<void> scheduleDaily() async {}\n' +
        '}\n',
    }));
    assert.equal(code, 1, 'the NoOp keeping the method does not mean the interface has it');
    assert.match(out, /has method `scheduleDaily`, which is not declared in that class/);
  });

  test('a mere CALL of the method elsewhere in the file does not satisfy it either', () => {
    const { code, out } = run(tree({
      symbol: 'S',
      methods: ['init', 'scheduleDaily'],
      seamSrc:
        'abstract interface class S {\n  Future<void> init();\n}\n\n' +
        'Future<void> warmUp(dynamic s) async {\n  await s.scheduleDaily();\n}\n',
    }));
    assert.equal(code, 1);
    assert.match(out, /has method `scheduleDaily`, which is not declared in that class/);
  });

  // …and the legitimate shapes must stay green, or the tightening is the bug.
  test('passes on real declarations with annotations and generic return types', () => {
    const { code, out } = run(tree({
      symbol: 'S',
      methods: ['init', 'scheduleDaily', 'pending'],
      seamSrc:
        'abstract interface class S {\n' +
        '  /// One-time setup.\n' +
        '  Future<void> init();\n' +
        '  @protected\n' +
        '  Future<void> scheduleDaily(DailyReminder reminder);\n' +
        '  Future<List<Map<String, int>>> pending();\n' +
        '}\n',
    }));
    assert.equal(code, 0, out);
    assert.match(out, /seam symbol\(s\) verified in place/);
  });

  test('a missingMethods entry is PRINTED on a passing run, never silently held', () => {
    const { code, out } = run(tree({
      mutate: (caps) => {
        caps[0].seams[0].missingMethods = [{
          surface: 'notification tap / open',
          why: 'the seam can schedule but cannot deliver a tap back',
          fixOwner: '[2]C-3 de-forking increment',
        }];
      },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /MISSING the notification tap \/ open surface/);
  });
});

describe('[C-1] implementsSeams must name a real contract', () => {
  test('fails when it names a contract nobody declares', () => {
    const { code, out } = run(tree({
      mutate: (caps) => { caps[1].implementsSeams = ['NoSuchContract']; delete caps[1].noSeamReason; },
    }));
    assert.equal(code, 1);
    assert.match(out, /claims to implement seam `NoSuchContract`, which no register entry declares/);
  });

  test('fails when a capability declares no seam, no implementsSeams and no reason', () => {
    const { code, out } = run(tree({ mutate: (caps) => { delete caps[1].noSeamReason; } }));
    assert.equal(code, 1);
    assert.match(out, /declares no `seams`, no `implementsSeams` and no `noSeamReason`/);
  });
});

describe('[C-3 widened] a registered seam may not be implemented in an app', () => {
  const FORK = 'class NotificationService {\n  NotificationService._();\n}\n';

  test('fails on an UNDECLARED fork inside an app', () => {
    const { code, out } = run(tree({ forkSrc: FORK }));
    assert.equal(code, 1);
    assert.match(out, /declares `class NotificationService`, which is a seam registered to/);
    assert.match(out, /may not be implemented in an app/);
  });

  // Same stripping rule as check 3, pointed the other way: here matching prose
  // would falsely ACCUSE an app file of forking a seam it merely talks about.
  test('does NOT accuse an app file whose only `class NotificationService` is commented out', () => {
    // The declaration is at column 0 inside a block comment, so it satisfies the
    // line-anchored fork regex on RAW source — the triage edit that gets left in
    // a file for a week. Only stripping tells it apart from a real fork.
    const { code, out } = run(tree({
      forkSrc: `/*\n${FORK}*/\nvoid nothing() {}\n`,
    }));
    assert.equal(code, 0, out);
  });

  test('passes when the fork is DECLARED, and prints it every run', () => {
    const { code, out } = run(tree({
      forkSrc: FORK,
      mutate: (caps) => {
        caps[0].violations = [{
          path: 'apps/app1/lib/services/fork.dart',
          kind: 'seam-implemented-in-app',
          detail: 'a known fork kept for a frozen legacy app',
          fixOwner: '[2]C-3 de-forking increment',
          declaredOn: '2026-07-28',
        }];
      },
    }));
    assert.equal(code, 0, out);
    // Declared must not mean hidden.
    assert.match(out, /⚠ {2}core — seam-implemented-in-app at apps\/app1\/lib\/services\/fork\.dart/);
  });

  test('a declared violation whose file is GONE must be removed — a stale waiver fails', () => {
    const root = tree({
      forkSrc: FORK,
      mutate: (caps) => {
        caps[0].violations = [{
          path: 'apps/app1/lib/services/fork.dart',
          kind: 'seam-implemented-in-app',
          detail: 'x',
          fixOwner: 'y',
        }];
      },
    });
    rmSync(join(root, 'apps', 'app1', 'lib', 'services', 'fork.dart'));
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /no longer exists\. It was fixed; REMOVE it from the register/);
  });

  test('a violation without detail or fixOwner is not a valid declaration', () => {
    const root = tree({
      forkSrc: FORK,
      mutate: (caps) => {
        caps[0].violations = [{ path: 'apps/app1/lib/services/fork.dart', kind: 'seam-implemented-in-app', detail: 'x' }];
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /needs both `detail` and `fixOwner`/);
  });

  test('an abstract re-declaration in an app is still a fork', () => {
    const { code } = run(tree({ forkSrc: 'final class NotificationService {\n}\n' }));
    assert.equal(code, 1);
  });
});
