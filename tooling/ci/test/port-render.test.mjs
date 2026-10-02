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
import { cancelPathOf, checkoutRailsOf, renderPortsTs, renderCheck, renderRailsDart, PAYMENTS_REGISTRY, RENDERED_PORTS, CHANNEL_REGISTER, FEE_REGISTER, RENDERED_RAILS_DART } from '../../ports/render.mjs';

// ⏱ 2026-10-01 · fix-india-rail-tax-data: the render reads the register payments.json `selection.source`
// cites (the web checkout rail per market) — CHANNEL_REGISTER, which every scratch root already carries.
const CHANNELS = CHANNEL_REGISTER;
const REGISTER = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', CHANNELS), 'utf8'));

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
    for (const rel of [PAYMENTS_REGISTRY, RENDERED_PORTS, CHANNEL_REGISTER, FEE_REGISTER, RENDERED_RAILS_DART]) {
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
      for (const rel of [PAYMENTS_REGISTRY, CHANNEL_REGISTER, FEE_REGISTER, RENDERED_RAILS_DART]) {
        mkdirSync(dirname(join(scratch, rel)), { recursive: true });
        cpSync(join(REPO, rel), join(scratch, rel));
      }
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
      for (const rel of [PAYMENTS_REGISTRY, CHANNEL_REGISTER, FEE_REGISTER]) {
        mkdirSync(dirname(join(scratch, rel)), { recursive: true });
        cpSync(join(REPO, rel), join(scratch, rel));
      }
      const r = run(['--root', scratch]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /^ok {3}render — wrote services\/platform\/src\/generated\/ports\.ts/);
      assert.match(r.out, /^ok {3}render — wrote packages\/purchases\/lib\/src\/generated\/rails\.dart/m);
      assert.equal(run(['--check', '--root', scratch]).code, 0);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
  it('COVERAGE LOST: an unreadable selection source (the channel register) is exit 2, never a pass', () => {
    const rel = join(root, CHANNELS);
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, '{ not json');
      const r = run(['--check', '--root', root]);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /^LOST render --check — tooling\/channel-register\.json#purchaseRails could not be read/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a region rail added to the web row and not re-rendered exits 1', () => {
    const rel = join(root, CHANNELS);
    const before = readFileSync(rel, 'utf8');
    try {
      const reg = JSON.parse(before);
      reg.channels.find((c) => c.id === 'web').purchaseRail.regionRails.push({ region: 'BD', rail: 'razorpay', why: 'fixture', source: 'fixture' });
      writeFileSync(rel, JSON.stringify(reg));
      assert.equal(run(['--check', '--root', root]).code, 1);
    } finally { writeFileSync(rel, before); }
  });
  it('refuses an unknown flag (exit 2)', () => {
    assert.equal(run(['--chek']).code, 2);
  });
});

// ⏱ 2026-10-01 · port-pay-client: the DART target — the client's rail kind per app channel,
// rendered from the channel register (and the store-billed rails payments.json derives).
describe('render.mjs — the Dart rail map', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'port-render-dart-'));
    for (const rel of [PAYMENTS_REGISTRY, RENDERED_PORTS, CHANNEL_REGISTER, FEE_REGISTER, RENDERED_RAILS_DART]) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      cpSync(join(REPO, rel), join(root, rel));
    }
  });
  const sources = () => ({
    channelDoc: JSON.parse(readFileSync(join(root, CHANNEL_REGISTER), 'utf8')),
    doc: JSON.parse(readFileSync(join(root, PAYMENTS_REGISTRY), 'utf8')),
    cells: JSON.parse(readFileSync(join(root, FEE_REGISTER), 'utf8')).cells,
  });
  it('green control: the committed map is the render, and names no vendor', () => {
    const r = run(['--check', '--root', root]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /packages\/purchases\/lib\/src\/generated\/rails\.dart matches tooling\/channel-register\.json/);
    const { channelDoc, doc, cells } = sources();
    const { text } = renderRailsDart(channelDoc, doc, cells);
    assert.match(text, /^ {2}'web': 'hosted',$/m, 'a hosted page is `hosted`, whichever vendor serves it');
    assert.match(text, /^ {2}'android-play': 'play-billing',$/m);
    assert.match(text, /^ {2}'apps-gov-in': 'none',$/m);
    assert.doesNotMatch(text, /paddle|razorpay|revenuecat/i, 'the client names no payment vendor');
    assert.doesNotMatch(text, /chrome-webstore/, 'an extension is sold from the Worker, never from Dart');
  });
  it('red: a register fixture moving windows-direct to none changes the generated map', () => {
    const { channelDoc, doc, cells } = sources();
    const before = renderRailsDart(channelDoc, doc, cells).text;
    channelDoc.channels.find((c) => c.id === 'windows-direct').purchaseRail.rail = 'none';
    const after = renderRailsDart(channelDoc, doc, cells).text;
    assert.match(before, /^ {2}'windows-direct': 'hosted',$/m);
    assert.match(after, /^ {2}'windows-direct': 'none',$/m);
  });
  it('red: that register edit, not re-rendered, exits 1 on --check', () => {
    const rel = join(root, CHANNEL_REGISTER);
    const before = readFileSync(rel, 'utf8');
    try {
      const d = JSON.parse(before);
      d.channels.find((c) => c.id === 'windows-direct').purchaseRail.rail = 'none';
      writeFileSync(rel, JSON.stringify(d));
      const r = run(['--check', '--root', root]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /rails\.dart differs from its render at line \d+: have "  'windows-direct': 'hosted',", want "  'windows-direct': 'none',"/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a hand edit of the Dart map exits 1', () => {
    const rel = join(root, RENDERED_RAILS_DART);
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, before.replace("  'linux-snap': 'hosted',", "  'linux-snap': 'play-billing',"));
      const r = run(['--check', '--root', root]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /^FAIL render --check — .*rails\.dart differs from its render/m);
    } finally { writeFileSync(rel, before); }
  });
  it('the store-billed kinds are DERIVED: with no cancel-store adapter every channel would be hosted, so it is LOST', () => {
    const { channelDoc, doc, cells } = sources();
    for (const a of doc.adapters) a.capabilities = a.capabilities.filter((c) => c !== 'cancel-store');
    assert.match(renderRailsDart(channelDoc, doc, cells).lost ?? '', /no store-billed rail was derived/);
  });
  it('COVERAGE LOST: a channel on a rail the dictionary does not define', () => {
    const { channelDoc, doc, cells } = sources();
    channelDoc.channels.find((c) => c.id === 'web').purchaseRail.rail = 'amazon-iap';
    assert.match(renderRailsDart(channelDoc, doc, cells).lost ?? '', /takes rail `amazon-iap`, which purchaseRails\.rails does not define/);
  });
});

describe('render.mjs — what the table derives', () => {
  it('the cancel path comes from the DECLARED capabilities', () => {
    assert.equal(cancelPathOf(['verify', 'cancel']), 'api');
    assert.equal(cancelPathOf(['verify', 'cancel-store']), 'store');
    assert.equal(cancelPathOf(['verify']), 'none');
  });
  it('a fake never joins MOR_VERIFIER_IDS or the live set', () => {
    const doc = JSON.parse(readFileSync(join(REPO, PAYMENTS_REGISTRY), 'utf8'));
    const ts = renderPortsTs(doc, REGISTER);
    assert.match(ts, /export const MOR_VERIFIER_IDS = \['paddle', 'razorpay', 'revenuecat'\] as const/);
    assert.match(ts, /live: \['paddle', 'razorpay', 'revenuecat'\],/);
  });
  // ⏱ 2026-10-01 · fix-india-rail-tax-data: two real sellers no longer render null — the web
  // channel's purchaseRail decides per buyer-declared market, and the default is CHECKOUT_RAIL_ID.
  it('the checkout rail per market is the web row\'s purchaseRail, restricted to adapters that declare checkout', () => {
    const doc = JSON.parse(readFileSync(join(REPO, PAYMENTS_REGISTRY), 'utf8'));
    const ts = renderPortsTs(doc, REGISTER);
    assert.match(ts, /export const CHECKOUT_RAIL_BY_MARKET: Readonly<Record<string, PaymentsAdapterId \| null>> = \{\n {2}default: 'paddle',\n {2}IN: 'razorpay',\n\};/);
    assert.match(ts, /export const CHECKOUT_RAIL_ID: PaymentsAdapterId \| null = 'paddle';/);
    // red: razorpay without `checkout` drops out of the table — the region falls back to the default.
    const noSell = { ...doc, adapters: doc.adapters.map((a) => (a.id === 'razorpay' ? { ...a, capabilities: a.capabilities.filter((c) => c !== 'checkout') } : a)) };
    assert.deepEqual(checkoutRailsOf(noSell, REGISTER).table, { default: 'paddle' });
    // red: a default rail that cannot sell renders null, so the route refuses rather than guesses.
    const noDefault = { ...doc, adapters: doc.adapters.map((a) => (a.id === 'paddle' ? { ...a, capabilities: ['verify'] } : a)) };
    assert.match(renderPortsTs(noDefault, REGISTER), /CHECKOUT_RAIL_ID: PaymentsAdapterId \| null = null;/);
    // a register with no web row cannot be rendered at all (the caller's LOST).
    assert.throws(() => renderPortsTs(doc, { channels: [] }), /checkout selection cannot be rendered/);
  });
});
