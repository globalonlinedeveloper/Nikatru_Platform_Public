// ─────────────────────────────────────────────────────────────────────────────
// ops-refund.test.mjs — tooling/ops/refund.mjs, the prepared manual refund
// (refund-finish, MF-6). Red controls:
//   · without --execute NO network call is made (a stubbed fetch sees 0);
//   · under GITHUB_ACTIONS=true it exits 2 with empty stdout, dry run included;
//   · --execute needs the token derived from THIS request, a --ledger outside
//     every git work tree, and the keys by name — any one missing sends nothing;
//   · Windows: a backslash/drive-letter ledger path is judged with path.win32,
//     and `node c:\…\refund.mjs` (any case) is this module.
//
// Run:  node --test tooling/ci/test/ops-refund.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPlan, confirmationToken, insideGitWorkTree, isThisModule, ledgerPrior, main, refundIdOf } from '../../ops/refund.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOL = join(REPO, 'tooling', 'ops', 'refund.mjs');
const ARGS = ['--provider', 'paddle', '--ref', 'txn_01habc', '--reason', 'goodwill: charged twice'];

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-refund-'));
});
after(() => rmSync(TMP, { recursive: true, force: true }));

function harness(env = {}, answer = { data: { id: 'adj_01test' } }, io = {}) {
  const calls = [];
  const out = [];
  const err = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (io.noAnswer) throw new Error('socket hang up');
    return new Response(JSON.stringify(answer), { status: 201 });
  };
  return { calls, out, err, run: (argv) => main(argv, { env: { PADDLE_API_KEY: 'pdl_sdbx_x', ...env }, fetchImpl, out: (s) => out.push(s), err: (s) => err.push(s), now: () => '2026-10-02T00:00:00.000Z', ...io.deps }) };
}

describe('tooling/ops/refund.mjs', () => {
  test('🔴 a dry run makes NO network call and prints the exact request and its token', async () => {
    const h = harness();
    assert.equal(await h.run(ARGS), 0);
    assert.equal(h.calls.length, 0);
    const text = h.out.join('');
    assert.match(text, /DRY RUN — nothing was sent/);
    assert.match(text, /"transaction_id": "txn_01habc"/);
    assert.match(text, new RegExp(`--confirm ${confirmationToken(buildPlan({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' }))}`));
    assert.doesNotMatch(text, /pdl_sdbx_x/);
  });

  test('🔴 under GITHUB_ACTIONS=true it exits 2 with EMPTY stdout (the real CLI)', () => {
    const r = spawnSync(process.execPath, [TOOL, ...ARGS], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
    const h = harness({ GITHUB_ACTIONS: 'true' });
    return h.run([...ARGS, '--execute', '--confirm', 'x', '--ledger', join(TMP, 'l.jsonl')]).then((code) => {
      assert.equal(code, 2);
      assert.equal(h.calls.length, 0);
      assert.equal(h.out.join(''), '');
    });
  });

  test('--execute with a wrong token, no ledger, a ledger inside a repo or no key sends nothing', async () => {
    const plan = buildPlan({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' });
    const token = confirmationToken(plan);
    const outside = join(TMP, 'ledger.jsonl');
    let h = harness();
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', 'deadbeef00', '--ledger', outside]), 1);
    h = harness();
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token]), 1);
    h = harness();
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token, '--ledger', join(REPO, 'refunds.jsonl')]), 1);
    assert.match(h.err.join(''), /inside a git work tree/);
    h = harness({ PADDLE_API_KEY: '' });
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token, '--ledger', outside]), 1);
    assert.equal(h.calls.length, 0);
    assert.equal(existsSync(outside), false);
  });

  test('--execute with the token sends ONE request and records the money event in the ledger', async () => {
    const plan = buildPlan({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' });
    const ledger = join(TMP, 'executed.jsonl');
    const h = harness();
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', confirmationToken(plan), '--ledger', ledger]), 0);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, 'https://api.paddle.com/adjustments');
    assert.deepEqual(JSON.parse(h.calls[0].init.body), { action: 'refund', transaction_id: 'txn_01habc', reason: 'goodwill: charged twice', type: 'full' });
    const token = confirmationToken(plan);
    const lines = readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines, [
      { at: '2026-10-02T00:00:00.000Z', kind: 'manual_refund_intent', token, provider: 'paddle', ref: 'txn_01habc', amount_minor: null, reason: 'goodwill: charged twice' },
      { at: '2026-10-02T00:00:00.000Z', kind: 'manual_refund', token, provider: 'paddle', ref: 'txn_01habc', amount_minor: null, reason: 'goodwill: charged twice', status: 201, refund_id: 'adj_01test' },
    ]);
  });

  test('🔴 the answer writes only a rail-shaped refund id to the ledger: free text from the response is recorded as null', async () => {
    const plan = buildPlan({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' });
    const ledger = join(TMP, 'shaped.jsonl');
    const h = harness({}, { data: { id: 'adj_01\n{"kind":"forged"}' } });
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', confirmationToken(plan), '--ledger', ledger]), 0);
    const lines = readFileSync(ledger, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).refund_id, null);
    assert.equal(refundIdOf({ id: 'rfnd_FP8QHiV938haTz' }), 'rfnd_FP8QHiV938haTz');
    assert.equal(refundIdOf({ data: { id: 'adj_01h' } }), 'adj_01h');
    assert.equal(refundIdOf({ id: 42 }), null);
    assert.equal(refundIdOf({ id: 'x'.repeat(65) }), null);
    assert.equal(refundIdOf(null), null);
  });

  // ── LEDGER FIRST, ONCE PER TOKEN (review 2026-10-03) ──────────────────────
  const RZP = ['--provider', 'razorpay', '--ref', 'pay_N1abc', '--reason', 'goodwill: late cancel'];
  const RZP_KEYS = { RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' };
  const tokenOf = (o) => confirmationToken(buildPlan(o));

  test('🔴 a re-run with the SAME token sends nothing: the ledger already holds it', async () => {
    const ledger = join(TMP, 'rerun.jsonl');
    const token = tokenOf({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' });
    const h = harness();
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token, '--ledger', ledger]), 0);
    const again = harness();
    assert.equal(await again.run([...ARGS, '--execute', '--confirm', token, '--ledger', ledger]), 1);
    assert.equal(again.calls.length, 0);
    assert.match(again.err.join(''), /already holds this request/);
    assert.equal(readFileSync(ledger, 'utf8').trim().split('\n').length, 2);
  });

  test('🔴 a crash after the intent (no answer) still refuses the re-run: the intent is the record', async () => {
    const ledger = join(TMP, 'crash.jsonl');
    const token = tokenOf({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' });
    const h = harness({}, undefined, { noAnswer: true });
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token, '--ledger', ledger]), 1);
    assert.equal(h.calls.length, 1);
    // An intent with no result line at all (the process died mid-send):
    const only = join(TMP, 'intent-only.jsonl');
    writeFileSync(only, `${readFileSync(ledger, 'utf8').split('\n')[0]}\n`);
    const again = harness();
    assert.equal(await again.run([...ARGS, '--execute', '--confirm', token, '--ledger', only]), 1);
    assert.equal(again.calls.length, 0);
  });

  test('🔴 the intent is written BEFORE the send; a ledger that will not take it sends nothing', async () => {
    const ledger = join(TMP, 'order.jsonl');
    const token = tokenOf({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' });
    const order = [];
    const h = harness({}, undefined, {
      deps: {
        appendLedger: (f, line) => order.push(`append:${JSON.parse(line).kind}`),
        fetchImpl: async () => (order.push('send'), new Response(JSON.stringify({ data: { id: 'adj_01x' } }), { status: 201 })),
      },
    });
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token, '--ledger', ledger]), 0);
    assert.deepEqual(order, ['append:manual_refund_intent', 'send', 'append:manual_refund']);

    const refused = harness({}, undefined, { deps: { appendLedger: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } } });
    assert.equal(await refused.run([...ARGS, '--execute', '--confirm', token, '--ledger', join(TMP, 'readonly.jsonl')]), 1);
    assert.equal(refused.calls.length, 0);
    assert.match(refused.err.join(''), /would not take the intent line/);
  });

  test('🔴 an unreadable or corrupt ledger exits 2 and sends nothing; a missing one is empty', async () => {
    const token = tokenOf({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' });
    const bad = join(TMP, 'corrupt.jsonl');
    writeFileSync(bad, '{"kind":"manual_refund"\n');
    let h = harness();
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token, '--ledger', bad]), 2);
    assert.equal(h.calls.length, 0);
    h = harness({}, undefined, { deps: { readLedger: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } } });
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token, '--ledger', join(TMP, 'x.jsonl')]), 2);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(ledgerPrior(join(TMP, 'never-written.jsonl'), buildPlan({ provider: 'paddle', ref: 'txn_01habc', reason: 'abc' }), 't'), { prior: null });
  });

  test('🔴 a relative ledger path is refused before any send', async () => {
    const token = tokenOf({ provider: 'paddle', ref: 'txn_01habc', reason: 'goodwill: charged twice' });
    const h = harness();
    assert.equal(await h.run([...ARGS, '--execute', '--confirm', token, '--ledger', 'refunds.jsonl']), 1);
    assert.equal(h.calls.length, 0);
    assert.match(h.err.join(''), /absolute path/);
  });

  test('partial refunds are keyed separately: another amount is another token and is sent; the same amount again is not', async () => {
    const ledger = join(TMP, 'partials.jsonl');
    const t1 = tokenOf({ provider: 'razorpay', ref: 'pay_N1abc', reason: 'goodwill: late cancel', amount: '5000' });
    const t2 = tokenOf({ provider: 'razorpay', ref: 'pay_N1abc', reason: 'goodwill: late cancel', amount: '2500' });
    let h = harness(RZP_KEYS, { id: 'rfnd_1' });
    assert.equal(await h.run([...RZP, '--amount', '5000', '--execute', '--confirm', t1, '--ledger', ledger]), 0);
    h = harness(RZP_KEYS, { id: 'rfnd_2' });
    assert.equal(await h.run([...RZP, '--amount', '2500', '--execute', '--confirm', t2, '--ledger', ledger]), 0);
    assert.equal(h.calls.length, 1);
    h = harness(RZP_KEYS, { id: 'rfnd_3' });
    assert.equal(await h.run([...RZP, '--amount', '2500', '--execute', '--confirm', t2, '--ledger', ledger]), 1);
    assert.equal(h.calls.length, 0);
    const results = readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((j) => j.kind === 'manual_refund');
    assert.deepEqual(results.map((j) => [j.token, j.refund_id]), [[t1, 'rfnd_1'], [t2, 'rfnd_2']]);
  });

  test('a token-less line from before the token existed still refuses the same rail, reference and amount', () => {
    const plan = buildPlan({ provider: 'paddle', ref: 'txn_01habc', reason: 'abc' });
    const legacy = JSON.stringify({ at: '2026-10-01T00:00:00.000Z', kind: 'manual_refund', provider: 'paddle', ref: 'txn_01habc', amount_minor: null, status: 201 });
    assert.equal(ledgerPrior('/l', plan, 'tok', { read: () => `${legacy}\n` }).prior.status, 201);
    assert.equal(ledgerPrior('/l', { ...plan, ref: 'txn_other' }, 'tok', { read: () => `${legacy}\n` }).prior, null);
  });

  test('the token binds the request: another amount or reference is another token', () => {
    const a = buildPlan({ provider: 'razorpay', ref: 'pay_N1', reason: 'goodwill', amount: '17900' });
    const b = buildPlan({ provider: 'razorpay', ref: 'pay_N1', reason: 'goodwill', amount: '17901' });
    const c = buildPlan({ provider: 'razorpay', ref: 'pay_N2', reason: 'goodwill', amount: '17900' });
    assert.notEqual(confirmationToken(a), confirmationToken(b));
    assert.notEqual(confirmationToken(a), confirmationToken(c));
    assert.equal(a.url, 'https://api.razorpay.com/v1/payments/pay_N1/refund');
    assert.deepEqual(a.body, { amount: 17900, speed: 'normal', notes: { reason: 'goodwill' } });
  });

  test('a Paddle partial is refused rather than guessed; a bad reference is refused', () => {
    assert.match(buildPlan({ provider: 'paddle', ref: 'txn_1abc', reason: 'goodwill', amount: '100' }).error, /full only/);
    assert.match(buildPlan({ provider: 'paddle', ref: '../x', reason: 'goodwill' }).error, /--ref/);
    assert.match(buildPlan({ provider: 'stripe', ref: 'x_1234', reason: 'goodwill' }).error, /--provider/);
  });

  test('Windows: a drive-letter ledger path is judged with path.win32, case and slashes either way', () => {
    const repo = 'C:\\Users\\owner\\Nikatru_Platform_Public';
    const exists = (p) => p.toLowerCase() === `${repo}\\.git`.toLowerCase();
    assert.equal(insideGitWorkTree('C:\\Users\\owner\\Nikatru_Platform_Public\\ledger.jsonl', { pathMod: path.win32, exists }), true);
    assert.equal(insideGitWorkTree('c:/Users/owner/Nikatru_Platform_Public/sub/l.jsonl', { pathMod: path.win32, exists }), true);
    assert.equal(insideGitWorkTree('C:\\Users\\owner\\money\\ledger.jsonl', { pathMod: path.win32, exists }), false);
    assert.equal(isThisModule('c:\\repo\\tooling\\ops\\refund.mjs', 'C:\\repo\\tooling\\ops\\refund.mjs', 'win32'), true);
    assert.equal(isThisModule('C:/repo/tooling/ops/refund.mjs', 'C:\\repo\\tooling\\ops\\refund.mjs', 'win32'), true);
    assert.equal(isThisModule('/repo/tooling/ops/Refund.mjs', '/repo/tooling/ops/refund.mjs', 'linux'), false);
  });
});
