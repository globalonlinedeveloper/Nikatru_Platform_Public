// ─────────────────────────────────────────────────────────────────────────────
// port-render.test.mjs — tooling/ports/render.mjs, the renderer of the tables code reads
// (port-pay-core, 2026-10-01). Each red is a recorded mutation of a scratch COPY of the
// real registry and its rendered file (vacuous-03), beside its green control.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cancelPathOf, renderPortsTs, renderCheck, PAYMENTS_REGISTRY, RENDERED_PORTS } from '../../ports/render.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOL = join(REPO, 'tooling', 'ports', 'render.mjs');
const run = (args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('render.mjs — the payments table', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'port-render-'));
    for (const rel of [PAYMENTS_REGISTRY, RENDERED_PORTS]) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      cpSync(join(REPO, rel), join(root, rel));
    }
  });
  it('green control: the committed table is the render of the committed registry', () => {
    const r = run(['--check', '--root', root]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^ok {3}render --check — services\/platform\/src\/generated\/ports\.ts matches tooling\/ports\/payments\.json \(4 adapter\(s\)\)/);
  });
  it('red: a hand edit of the generated file exits 1 and names the line', () => {
    const rel = join(root, RENDERED_PORTS);
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, before.replace("live: ['paddle', 'razorpay', 'revenuecat'],", "live: ['paddle', 'razorpay', 'revenuecat', 'fake'],"));
      const r = run(['--check', '--root', root]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /^FAIL render --check — services\/platform\/src\/generated\/ports\.ts differs from its render at line \d+/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a registry edit not re-rendered exits 1', () => {
    const rel = join(root, PAYMENTS_REGISTRY);
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      // The fake put back on sandbox (the #1127 money review's forgeable door) without a re-render.
      doc.adapters.find((a) => a.id === 'fake').environments = ['test', 'sandbox'];
      writeFileSync(rel, JSON.stringify(doc));
      assert.equal(run(['--check', '--root', root]).code, 1);
    } finally { writeFileSync(rel, before); }
  });
  it('COVERAGE LOST: an unreadable registry is exit 2, never a pass', () => {
    const rel = join(root, PAYMENTS_REGISTRY);
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, '{ not json');
      const r = run(['--check', '--root', root]);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /^LOST render --check/);
    } finally { writeFileSync(rel, before); }
  });
  it('COVERAGE LOST: a registry of zero adapters is current by construction, so it is refused', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'port-render-empty-'));
    try {
      mkdirSync(join(scratch, 'tooling/ports'), { recursive: true });
      writeFileSync(join(scratch, PAYMENTS_REGISTRY), JSON.stringify({ adapters: [] }));
      const r = renderCheck(scratch);
      assert.equal(r.ok, false);
      assert.equal(r.lost, true);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
  // #1127 CodeQL js/file-system-race: the generated file is read ONCE, never exists-then-read.
  // A path that exists but cannot be read (here a directory) was an uncaught EISDIR, exit 1,
  // in both modes; it is LOST (exit 2) now, and only ENOENT means "absent".
  it('COVERAGE LOST: a generated path that exists but cannot be read is exit 2 in both modes, never a crash', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'port-render-dir-'));
    try {
      mkdirSync(join(scratch, 'tooling/ports'), { recursive: true });
      cpSync(join(REPO, PAYMENTS_REGISTRY), join(scratch, PAYMENTS_REGISTRY));
      mkdirSync(join(scratch, RENDERED_PORTS), { recursive: true });
      for (const args of [['--check', '--root', scratch], ['--root', scratch]]) {
        const r = run(args);
        assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`);
        assert.match(r.out, /^LOST render( --check)? — services\/platform\/src\/generated\/ports\.ts could not be read/m);
      }
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
  it('green control: an ABSENT generated file is written (ENOENT is absence, not an error)', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'port-render-new-'));
    try {
      mkdirSync(join(scratch, 'tooling/ports'), { recursive: true });
      cpSync(join(REPO, PAYMENTS_REGISTRY), join(scratch, PAYMENTS_REGISTRY));
      const r = run(['--root', scratch]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /^ok {3}render — wrote services\/platform\/src\/generated\/ports\.ts/);
      assert.equal(run(['--check', '--root', scratch]).code, 0);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
  it('refuses an unknown flag (exit 2)', () => {
    assert.equal(run(['--chek']).code, 2);
  });
});

describe('render.mjs — what the table derives', () => {
  it('the cancel path comes from the DECLARED capabilities', () => {
    assert.equal(cancelPathOf(['verify', 'cancel']), 'api');
    assert.equal(cancelPathOf(['verify', 'cancel-store']), 'store');
    assert.equal(cancelPathOf(['verify']), 'none');
  });
  it('a fake never joins MOR_VERIFIER_IDS or the live set, and the checkout rail is the ONE real seller', () => {
    const doc = JSON.parse(readFileSync(join(REPO, PAYMENTS_REGISTRY), 'utf8'));
    const ts = renderPortsTs(doc);
    assert.match(ts, /export const MOR_VERIFIER_IDS = \['paddle', 'razorpay', 'revenuecat'\] as const/);
    assert.match(ts, /live: \['paddle', 'razorpay', 'revenuecat'\],/);
    assert.match(ts, /export const CHECKOUT_RAIL_ID: PaymentsAdapterId \| null = 'paddle';/);
    const two = { ...doc, adapters: doc.adapters.map((a) => (a.id === 'razorpay' ? { ...a, capabilities: [...a.capabilities, 'checkout'] } : a)) };
    assert.match(renderPortsTs(two), /CHECKOUT_RAIL_ID: PaymentsAdapterId \| null = null;/, 'two sellers render null: the route refuses rather than guesses');
  });
});
