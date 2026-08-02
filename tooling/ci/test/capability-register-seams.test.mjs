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
/** A complete, valid `missingMethods` entry — [pipeline 13]T-9a. Each case in
 *  the T-9a block below breaks exactly one field of it. Declared here rather
 *  than inside that block because the print test above uses it too. */
const gap = (over = {}) => ({
  surface: 'notification tap / open',
  why: 'the seam can schedule but cannot deliver a tap back',
  fixOwner: '[2]C-3 de-forking increment',
  closedIf: [{
    file: 'packages/core/lib/seam.dart',
    pattern: 'setTapHandler|onNotificationTap',
    meaning: 'the seam grew a tap surface, so this waiver is stale',
  }],
  ...over,
});

function tree({ symbol = 'NotificationService', methods = ['init'], seamSrc = null, forkSrc = null, mutate = null, extraFiles = {} } = {}) {
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

  // A funnel file the T-9a `strandedEmitter` clause can name as the DECLARING
  // file — the one place a match must not count as a caller.
  files[join(root, 'packages', 'core', 'lib', 'funnel.dart')] =
    'class Funnel {\n  void onNotificationOpened(String kind) {}\n}\n';
  for (const [p, body] of Object.entries(extraFiles)) files[join(root, ...p.split('/'))] = body;

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
    const { code, out } = run(tree({ mutate: (caps) => { caps[0].seams[0].missingMethods = [gap()]; } }));
    assert.equal(code, 0, out);
    assert.match(out, /MISSING the notification tap \/ open surface/);
    // The COUNT prints too. Zero and one used to print identically.
    assert.match(out, /1 declared missing-surface gap\(s\)/);
  });
});

// ── [pipeline 13]T-9a — A DECLARED GAP THAT CAN BE DELETED IS NOT A GAP ──────
//
// 🔴 THE FINDING (2026-08-02). `missingMethods` was READ in exactly one place —
// the print loop — and validated NOWHERE: no required fields (contrast
// `violations`, which are validated), and nothing that stopped the entry being
// deleted. On the real tree, deleting the notification-tap entry made CI
// QUIETER, not redder.
//
// Proven against the REAL tree first (seven mutations, each restored from
// memory and byte-compared, baseline re-verified green after each):
//   1. the whole entry renamed away                → caught (`must declare a
//      missing surface matching`) — deletion is now RED, not quiet
//   2. fixOwner replaced by a sentence             → caught
//   3. `closedIf` renamed away                     → caught
//   4. `why` renamed away                          → caught
//   5. the SEAM grows `setTapHandler`              → caught (stale waiver)
//   6. the ADAPTER registers onDidReceiveNotificationResponse → caught
//   7. `onNotificationOpened(` gains a real caller → caught
//
// Mutations 1 and 5–7 are the ones that matter: 1 is the deletion the finding
// is about, and 5–7 are the opposite failure — a waiver that outlives its truth.
describe('[13]T-9a a declared missing surface is validated, not merely printed', () => {
  const withGap = (over = {}, rest = {}) =>
    tree({ ...rest, mutate: (caps) => { caps[0].seams[0].missingMethods = [gap(over)]; } });

  for (const field of ['surface', 'why', 'fixOwner']) {
    test(`FAILS when the entry has no \`${field}\``, () => {
      const { code, out } = run(withGap({ [field]: undefined }));
      assert.equal(code, 1);
      assert.match(out, new RegExp(`declares a missing surface with no \`${field}\``));
    });
  }

  // A gap whose owner is a sentence is how G-7 stayed open: nobody is
  // accountable for a paragraph.
  test('FAILS when fixOwner names no pipeline id', () => {
    const { code, out } = run(withGap({ fixOwner: 'somebody should extend the seam one day' }));
    assert.equal(code, 1);
    assert.match(out, /names no pipeline id/);
  });

  test('FAILS when the entry declares no evidence that would close it', () => {
    const { code, out } = run(withGap({ closedIf: undefined }));
    assert.equal(code, 1);
    assert.match(out, /declares no `closedIf` evidence/);
  });

  test('FAILS when closedIf watches a file that is gone (the waiver is unfalsifiable)', () => {
    const { code, out } = run(withGap({
      closedIf: [{ file: 'packages/core/lib/vanished.dart', pattern: 'x', meaning: 'y' }],
    }));
    assert.equal(code, 1);
    assert.match(out, /which does not exist/);
  });

  // 🔴 THE STALE-WAIVER CASE. The seam GREW the surface and the register still
  // says it is missing. A closed gap that keeps being declared is how one
  // waiver ends up excusing a different hole.
  test('FAILS when the seam has grown the surface the entry says is missing', () => {
    const { code, out } = run(withGap({}, {
      methods: ['init'],
      seamSrc:
        'abstract interface class NotificationService {\n' +
        '  Future<void> init();\n' +
        '  Future<void> setTapHandler(void Function(String kind) onTap);\n' +
        '}\n',
    }));
    assert.equal(code, 1);
    assert.match(out, /is CLOSED/);
    assert.match(out, /stale waiver is how a closed gap keeps excusing a new one/);
  });

  // …and the same claim must NOT be satisfiable by the prose that describes it.
  // Every file in this area carries a doc comment explaining the missing tap
  // surface at length, so a raw-text scan would report the gap closed by its
  // own explanation.
  test('does NOT read the gap as closed when the surface appears only in a comment', () => {
    const { code, out } = run(withGap({}, {
      methods: ['init'],
      seamSrc:
        'abstract interface class NotificationService {\n' +
        '  // No setTapHandler yet — see the register entry.\n' +
        "  /// A doc comment naming onNotificationTap, which does not exist.\n" +
        '  Future<void> init();\n' +
        '}\n',
    }));
    assert.equal(code, 0, out);
    assert.match(out, /MISSING the notification tap \/ open surface/);
  });

  // The caller-side half of staleness: a stranded emitter that gains a caller
  // means the surface was reached by some route the register does not know.
  test('FAILS when the stranded emitter gains a caller', () => {
    const { code, out } = run(withGap(
      {
        strandedEmitter: {
          file: 'packages/core/lib/funnel.dart',
          call: 'onNotificationOpened(',
          why: 'the event has no emitter and cannot have one until the seam can deliver a tap',
        },
      },
      { extraFiles: { 'apps/app1/lib/services/tap.dart': "void t(dynamic f) => f.onNotificationOpened('r');\n" } },
    ));
    assert.equal(code, 1);
    assert.match(out, /and it now has 1/);
  });

  test('PRINTS the zero-emitter gap on a passing run', () => {
    const { code, out } = run(withGap({
      strandedEmitter: {
        file: 'packages/core/lib/funnel.dart',
        call: 'onNotificationOpened(',
        why: 'the event has no emitter and cannot have one until the seam can deliver a tap',
      },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /onNotificationOpened has ZERO emitters tree-wide/);
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
