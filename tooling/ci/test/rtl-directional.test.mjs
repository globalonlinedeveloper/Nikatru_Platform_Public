// ─────────────────────────────────────────────────────────────────────────────
// rtl-directional.test.mjs — tooling/ci/assert-rtl-directional.mjs. Lane
// i18n-pipeline (O-LOCALES-HAND-TYPED-IN-12-PLACES, item 4).
//
// The green control is the real tree. The matcher cases are each shape the
// audit counted, plus the near misses that must stay quiet (a symmetric inset,
// a gradient's begin/end, a stretch, a direction compared rather than imposed).
// The real-tree mutation puts one of the fixed calls back and requires the
// guard to name it.
//
// Run:  node --test tooling/ci/test/rtl-directional.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check, findHardWired, TREES, MIN_FILES } from '../assert-rtl-directional.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-rtl-directional.mjs');
const rules = (src) => findHardWired(src).map((h) => h.rule);

describe('assert-rtl-directional — the real tree', () => {
  test('green control: no hard-wired left/right, with coverage', () => {
    const r = check(REPO);
    assert.equal(r.coverage, null);
    assert.deepEqual(r.findings, []);
    assert.ok(r.files >= MIN_FILES, `${r.files} files`);
    assert.ok(r.trees.some((t) => t.startsWith('apps/')), 'the shipping app is graded');
  });

  test('the CLI exits 0 on the real tree', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });
});

describe('the matchers', () => {
  test('each shape the audit counted is caught', () => {
    assert.deepEqual(rules('padding: const EdgeInsets.only(right: 8),'), ['D1']);
    assert.deepEqual(rules('padding: EdgeInsets.only(\n  top: 4,\n  left: AppSpacing.lg,\n),'), ['D1']);
    assert.deepEqual(rules('padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),'), ['D2']);
    assert.deepEqual(rules('alignment: Alignment.centerRight,'), ['D3']);
    assert.deepEqual(rules('alignment: on ? Alignment.centerRight : Alignment.centerLeft,'), ['D3', 'D3']);
    assert.deepEqual(rules('Positioned(bottom: -2, right: -2, child: x)'), ['D4']);
    assert.deepEqual(rules('Directionality(textDirection: TextDirection.ltr, child: x)'), ['D5']);
  });

  test('the near misses stay quiet', () => {
    for (const src of [
      'padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),', // symmetric
      'padding: EdgeInsets.fromLTRB(pad, 8, pad, 0),', // symmetric, by expression
      'padding: const EdgeInsets.only(top: 8, bottom: 4),', // vertical only
      'padding: const EdgeInsetsDirectional.only(end: 8),',
      'begin: Alignment.topLeft,\n  end: Alignment.bottomRight,', // a gradient paints
      'Positioned(left: 0, right: 0, bottom: 0, child: x)', // a stretch
      'final bool rtl = direction == TextDirection.rtl;', // reading, not imposing
      '// EdgeInsets.only(left: 8) in a comment',
      'alignment: AlignmentDirectional.centerEnd,',
    ]) {
      assert.deepEqual(rules(src), [], src);
    }
  });

  test('`// rtl-ok:` on the line or the one above exempts a deliberate physical side', () => {
    assert.deepEqual(rules('// rtl-ok: a waveform is drawn left to right\npadding: const EdgeInsets.only(left: 2),'), []);
    assert.deepEqual(rules('padding: const EdgeInsets.only(left: 2), // rtl-ok: the axis'), []);
  });
});

describe('a mutation of the real tree', () => {
  test('putting the promo card\'s asymmetric inset back is named', () => {
    const root = mkdtempSync(join(tmpdir(), 'rtl-'));
    try {
      for (const t of [...TREES, 'apps/subscriptiontracker/lib']) cpSync(join(REPO, t), join(root, t), { recursive: true });
      const f = join(root, 'packages/design_system/lib/src/widgets/promo_card.dart');
      const src = readFileSync(f, 'utf8');
      assert.ok(src.includes('EdgeInsetsDirectional.fromSTEB(16, 12, 8, 12)'));
      assert.deepEqual(check(root).findings, [], 'green control on the copy');
      writeFileSync(f, src.replace('EdgeInsetsDirectional.fromSTEB(16, 12, 8, 12)', 'EdgeInsets.fromLTRB(16, 12, 8, 12)'));
      const r = check(root);
      assert.equal(r.findings.length, 1);
      assert.match(r.findings[0], /^D2 packages\/design_system\/lib\/src\/widgets\/promo_card\.dart:\d+ /);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a missing tree, or no app, is COVERAGE LOST', () => {
    const root = mkdtempSync(join(tmpdir(), 'rtl-'));
    try {
      for (const t of TREES) mkdirSync(join(root, t), { recursive: true });
      assert.match(check(root).coverage ?? '', /no apps\/<id>\/lib/);
      rmSync(join(root, TREES[0]), { recursive: true });
      mkdirSync(join(root, 'apps/x/lib'), { recursive: true });
      assert.match(check(root).coverage ?? '', /not found/);
      mkdirSync(join(root, TREES[0]), { recursive: true });
      writeFileSync(join(root, 'apps/x/lib/a.dart'), 'void main() {}\n');
      assert.match(check(root).coverage ?? '', /read 1 Dart file\(s\); the floor is/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
