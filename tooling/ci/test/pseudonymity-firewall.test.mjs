// ─────────────────────────────────────────────────────────────────────────────
// pseudonymity-firewall.test.mjs — assert-pseudonymity-firewall.mjs must FAIL.
//
// [pipeline 5]M-16 — measure revenue without ever joining the paid id to the
// pseudonymous one. [ADR 020]:21.
//
// 🔴 WHY THIS IS A ONE-WAY DOOR. Creating a `(user_id, anon_id)` mapping ONCE
// retroactively reclassifies the ENTIRE analytics store as personal data subject
// to DPDP erasure, for every app, forever. Deleting the join afterwards does not
// undo it: the events were linkable at the moment they were stored.
//
// ⚠️ REAL-TREE MUTATIONS FIRST (2026-08-01, five, on a scratch COPY):
//   PF1  onPurchaseSuccess loses its only caller      -> caught
//   PF2  onPaywallViewed loses its only caller        -> caught
//   PF3  a pairing keyed by STRINGS in Dart           -> caught after a FIX (a)
//   PF4  a pairing arriving in SQL                    -> caught
//   PF5  the funnel grows a `userId` parameter        -> caught
//
// 🔴 TWO DEFECTS THE MUTATION RUN FOUND IN THE GUARD ITSELF:
//   (a) PF3 WAS NOT CAUGHT. Part B stripped STRING LITERALS before matching, so
//       `<String, String>{'user_id': u, 'anon_id': a}` — the most likely shape
//       the violation actually takes — was invisible, and so was every KV key,
//       request body and SQL column name. Strings are kept now.
//   (b) KEEPING THEM ALL then fired on a TEST TITLE: auth.test.ts names a test
//       "they have NO user_id, by design" in the same `it(...)` as an unrelated
//       `INSERT … anon_id …`. Sentences are blanked; keys, columns and queries
//       are kept. The first attempt at that rule put `AND` in the
//       case-insensitive SQL list, which made every English sentence containing
//       "and" count as SQL — the same title survived one round later.
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
const GUARD = join(CI_DIR, 'assert-pseudonymity-firewall.mjs');
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const PAYWALL_REL = `${BRICK}/lib/features/monetization/paywall_screen.dart`;

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pf-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const FUNNEL = `
class MoneyFunnel {
  const MoneyFunnel(this._analytics);
  Future<void> onPaywallViewed(String trigger) => _log('paywall_viewed');
  Future<void> onCheckoutStarted(String sku) => _log('checkout_started');
  Future<void> onPurchaseSuccess(String sku) => _log('purchase_success');
  Future<void> onPurchaseFailed(String reason) => _log('purchase_failed');
}
`;

const PAYWALL = `
class PaywallScreen extends ConsumerStatefulWidget {
  const PaywallScreen({super.key});
}
class _PaywallScreenState extends ConsumerState<PaywallScreen> {
  Future<void> _buy(Offering offering) async {
    await funnel.onPaywallViewed('feature_gate');
    await funnel.onCheckoutStarted(offering.productId);
    await funnel.onPurchaseSuccess(offering.productId);
    await funnel.onPurchaseFailed('still_pending');
  }
}
`;

function write(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

/** Both floors have to be reachable — 40 dart files and 80 dart/ts/sql files —
 *  or every case below measures a broken scan instead of its own subject. */
function filler(root, dart = 60, ts = 40) {
  for (let i = 0; i < dart; i += 1) {
    write(root, `packages/core/lib/src/filler_${i}.dart`, `class Filler${i} {}\n`);
  }
  for (let i = 0; i < ts; i += 1) {
    write(root, `services/platform/src/filler_${i}.ts`, `export const filler${i} = ${i};\n`);
  }
}

function run(o = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  filler(root, o.dartFiller ?? 60, o.tsFiller ?? 40);
  write(root, 'packages/purchases/lib/src/money_funnel.dart', o.funnel ?? FUNNEL);
  write(root, PAYWALL_REL, o.paywall ?? PAYWALL);
  if (o.extra) for (const [rel, body] of Object.entries(o.extra)) write(root, rel, body);
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('assert-pseudonymity-firewall — revenue measured without a join', () => {
  test('PASSES on a wired funnel with no pairing anywhere', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /assert-pseudonymity-firewall: ok/);
  });

  // ── A · the four events, resolved BY SYMBOL ───────────────────────────────
  for (const sym of ['onPaywallViewed', 'onCheckoutStarted', 'onPurchaseSuccess', 'onPurchaseFailed']) {
    test(`🔴 FAILS when ${sym} loses its only non-test caller`, () => {
      const r = run({ paywall: PAYWALL.replace(new RegExp(`await funnel\\.${sym}\\([^)]*\\);`), 'await Future<void>.value();') });
      assert.equal(r.code, 1);
      assert.match(r.out, new RegExp(`\`${sym}\` has NO non-test caller`));
    });
  }

  test('a DECLARATION is not a caller — the shape that let every real caller be deleted', () => {
    // `foo(` finds the declaration as readily as a call. The funnel file alone
    // must not satisfy the check.
    const r = run({ paywall: '// no callers here at all\n' });
    assert.equal(r.code, 1);
    assert.match(r.out, /has NO non-test caller/);
  });

  test('a caller inside test/ does NOT count — that is the state being rejected', () => {
    const r = run({
      paywall: '// no callers\n',
      extra: { [`${BRICK}/test/paywall_test.dart`]: 'await funnel.onPurchaseSuccess("x");' },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /has NO non-test caller/);
  });

  test('COVERAGE LOST when the dart scan reaches almost nothing', () => {
    const r = run({ dartFiller: 2 });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — scanned only/);
  });

  // ── B · the pairing ───────────────────────────────────────────────────────
  test('🔴 FAILS on a pairing keyed by STRINGS in Dart — the shape stripping strings made invisible', () => {
    const r = run({
      extra: {
        'packages/core/lib/src/cohort.dart':
          "final Map<String, String> row = <String, String>{'user_id': u, 'anon_id': a};",
      },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /places a PAID identifier beside a PSEUDONYMOUS one/);
  });

  test('FAILS on a pairing in TypeScript', () => {
    const r = run({ extra: { 'services/platform/src/cohort.ts': 'const row = { userId: u, anonId: a };' } });
    assert.equal(r.code, 1);
    assert.match(r.out, /places a PAID identifier beside a PSEUDONYMOUS one/);
  });

  test('🔴 FAILS on a pairing in SQL — where the risk lives until `events` splits off', () => {
    const r = run({
      extra: { 'services/platform/migrations/0006_cohort.sql': 'CREATE TABLE cohort (user_id TEXT, anon_id TEXT);' },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /places a PAID identifier beside a PSEUDONYMOUS one/);
  });

  test('FAILS on a pairing in a WHERE clause, which reads like a sentence', () => {
    // The prose rule must not swallow this: it is a real join predicate.
    const r = run({
      extra: {
        'services/platform/src/q.ts': "db.prepare('DELETE FROM x WHERE user_id = ? AND anon_id = ?');",
      },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /places a PAID identifier beside a PSEUDONYMOUS one/);
  });

  test('FAILS on a KV write that pairs the two', () => {
    const r = run({ extra: { 'packages/core/lib/src/kv.dart': 'await kv.write(userId, installId);' } });
    assert.equal(r.code, 1);
    assert.match(r.out, /places a PAID identifier beside a PSEUDONYMOUS one/);
  });

  test('does NOT fire on two ids in DIFFERENT blocks — the shared types file', () => {
    // A ±400-character window fired on `services/platform/src/types.ts`, where
    // two unrelated interfaces sit near each other. The unit is the BLOCK.
    const r = run({
      extra: {
        'services/platform/src/types.ts':
          'export interface ConsentArtifact { anon_id: string; }\nexport interface Subscription { user_id: string; }\n',
      },
    });
    assert.equal(r.code, 0, r.out);
  });

  test('does NOT fire on a TEST TITLE arguing FOR the separation', () => {
    // The exact literal from services/platform/test/auth.test.ts.
    const r = run({
      extra: {
        'services/platform/test/erasure.test.ts':
          "it('leaves `events` and `consent_artifacts` alone — they have NO user_id, by design', () => {\n" +
          '  db.prepare(`INSERT INTO events (event_id, anon_id, event) VALUES (?,?,?)`);\n});\n',
      },
    });
    assert.equal(r.code, 0, r.out);
  });

  test('does NOT fire on a COMMENT that names both, which is how the rule is documented', () => {
    const r = run({
      extra: {
        'packages/core/lib/src/note.dart':
          '// [ADR 020]:21 — never create a (user_id, anon_id) mapping.\nclass Note {}\n',
      },
    });
    assert.equal(r.code, 0, r.out);
  });

  test('does NOT fire on `user_id` beside `app_id` — a normal scoped read', () => {
    const r = run({ extra: { 'services/platform/src/read.ts': 'const row = { user_id: u, app_id: a };' } });
    assert.equal(r.code, 0, r.out);
  });

  test('COVERAGE LOST when the pairing scan misses the Workers entirely', () => {
    const r = run({ tsFiller: 1, dartFiller: 60 });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — the pairing scan reaches only/);
  });

  // ── the funnel's own API ──────────────────────────────────────────────────
  test('🔴 FAILS when the funnel grows an identity parameter', () => {
    // An API with no such parameter is stronger than a rule about not passing
    // one — there is nothing to forget to leave out.
    const r = run({ funnel: FUNNEL.replace('onPurchaseSuccess(String sku)', 'onPurchaseSuccess(String sku, {String? userId})') });
    assert.equal(r.code, 1);
    assert.match(r.out, /must have NO identity parameter/);
  });

  test('COVERAGE LOST when the funnel is gone — four symbols belonging to nothing', () => {
    const root = join(TMP, `bare-${(seq += 1)}`);
    filler(root);
    write(root, PAYWALL_REL, PAYWALL);
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
  });
});
