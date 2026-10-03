#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// money-dry-run.mjs — REPLAY THE VERBATIM STORE THROUGH THE REAL DERIVATION,
// IN SEVERAL ORDERS, AND ASSERT THE FINAL ENTITLEMENT IS THE SAME EVERY TIME.
//
// 🔴 WHY THIS EXISTS. `research/2026-09-09/bundle-entitlement-design-2026-09-09.md`
// §8 names webhook ordering and retry as something that CANNOT be proven before
// real money moves: "No vendor guarantees it and no fixture can prove the
// vendor's behaviour." What a fixture CAN prove is the half that is ours — that
// OUR derivation is insensitive to the order the rail happens to deliver in. The
// verbatim store (`provider_notifications.payload`, migration 0004 section B)
// exists precisely so a real notification can be re-fed byte-identically, and
// this script is the tool that re-feeds it.
//
// The property under test is ONE SQL clause, in
// `services/platform/src/lib/mor/store.ts::upsertEntitlement`:
//
//     WHERE entitlements.occurred_at IS NULL
//        OR excluded.occurred_at > entitlements.occurred_at
//
// That clause is the whole defence against the defect store.ts's own header
// states first: "A refund at T2 and a retried purchase from T1 < T2 are TWO
// DIFFERENT EVENT IDS: both are stored exactly once, both are genuinely new, and
// the late one re-grants Pro to a refunded customer." Deduplication is
// orthogonal and cannot help.
//
// ── WHAT IS REAL HERE AND WHAT IS NOT ────────────────────────────────────────
// REAL: `deriveAndApply`, `persistNotification` and the paddle adapter's
//       `parse`, imported from services/platform/src as TypeScript and executed
//       by Node's own type stripping (Node 24 — the major pinned in
//       tooling/versions.json). No transpiled copy, no re-implementation.
// REAL: the migrations. `services/platform/migrations/*.sql` are read off disk
//       and applied to an in-memory `node:sqlite` database behind D1's
//       interface — the same mechanism as services/platform/test/harness.ts,
//       which cannot be imported here because it pulls its SQL through Vite's
//       `?raw` suffix and Node has no such loader.
// NOT REAL: the SIGNATURE. Replay starts after verification, exactly where
//       routes/money.ts starts deriving. A stored payload's `Paddle-Signature`
//       is not kept and its five-second window would have expired anyway; the
//       verifier is graded by services/platform/test/money.test.ts.
// NOT REAL: the second rail. There is NO Razorpay adapter in this tree
//       (`src/lib/mor/registry.ts` registers exactly one verifier), so the
//       "interleaved across rails" order does NOT pretend to parse a second
//       vendor's bytes. It relabels `provider` on a copy of the corpus, giving
//       a second event stream that is keyed independently in
//       `provider_notifications`, `provider_accounts` and `entitlements`. When
//       an adapter for a second rail lands, this order starts exercising it for
//       free; until then it is honest about being a relabel.
//
// ── A MEASURED LIMIT ON THE CLAIM, STATED RATHER THAN HIDDEN ─────────────────
// Order-independence is a property of the SUBSCRIPTION stream. It is NOT true of
// a corpus that mixes an access-moving ADJUSTMENT with subscription events that
// occurred before it, and that is a fact about `decideAdjustment`, not a defect
// in this harness: a refund's decision is derived from the entitlement row AS IT
// STANDS (contract.ts — "it deliberately does not invent a new paid-through
// date: it clears the revocation and restores the period the row already
// carried"), so which subscription event happened to land first decides the
// `current_period_end` the refund snapshots. Two consequences:
//
//   1. The checked-in corpus is a subscription stream plus one adjustment that
//      moves no access (`chargeback_warning`), which is order-independent by
//      construction and still exercises the adjustment branch.
//   2. `services/platform/test/money-replay.test.ts` covers the refund case as
//      an explicit ORDERED sequence — grant, refund, then the late OLD grant,
//      which must come back `stale` — because that is the shape store.ts's
//      header describes and it is the one worth guarding in CI.
//
// A second measured fact, from the same reading: routes/money.ts answers 2xx for
// a derivation that REFUSED (":137 → { ok: true, recorded: true, derived:
// 'error' }"), so the rail does not retry a refusal. Re-derivation of a refused
// or unclaimed notification is therefore an OPERATOR act over the verbatim
// store, not something the vendor does — which is why `--rounds` exists and why
// its default is small and its use is printed.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//   node tooling/ops/money-dry-run.mjs [root] [--corpus=<dir>] [--from=<file>]
//                                      [--now=<iso>] [--rounds=<n>] [--json]
//
//   --from=<file>  a JSON array of `provider_notifications` rows, as exported
//                  from D1 (`wrangler d1 execute PLATFORM_DB --json --command
//                  "SELECT provider, provider_event_id, payload FROM
//                  provider_notifications"`). `payload` is TEXT, so it arrives
//                  as the exact bytes the rail sent and is re-fed unchanged.
//
// It calls NO live API and reads NO secret. It never writes to any database but
// the in-memory one it creates per run.
//
// Exit codes: 0 every order agreed · 1 the orders DISAGREED (or the red control
// failed to go red) · 2 COVERAGE LOST — there was nothing to replay.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readProducts } from '../bundle-availability.mjs';
import { BUNDLE_KIND } from '../../contracts/entitlement/bundle.js';

/**
 * The repository root, derived from THIS FILE rather than from cwd — a guard or
 * a test that resolved it from the working directory would silently scan
 * whatever tree it happened to be launched in.
 *
 * Exported because services/platform/test/money-replay.test.ts needs the same
 * answer and cannot compute it: that package declares
 * `types: ["@cloudflare/workers-types"]` and has no `@types/node`, so
 * `node:path`, `node:url` and `import.meta.url` are all untyped there.
 */
export const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const rootArg = process.argv[2] !== undefined && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
const ROOT = resolve(rootArg ?? REPO_ROOT);

/** Where the checked-in corpus lives, relative to the repository root. */
export const DEFAULT_CORPUS_REL = 'tooling/ops/fixtures/money-replay';

/** That corpus, as an absolute path, without the caller having to know either. */
export function defaultCorpusDir(root = REPO_ROOT) {
  return join(root, DEFAULT_CORPUS_REL);
}

/** The migrations, relative to the repository root. Read, never inlined. */
export const MIGRATIONS_REL = 'services/platform/migrations';

/**
 * A FIXED clock. Every decision `decideSubscription`/`decideAdjustment` makes
 * against "now" (whether a paid-through date has passed, what instant a
 * revocation is stamped with) has to be the same in every order or the
 * comparison below would report the wall clock as an ordering defect.
 * 2026-11-01 sits after every fixture event, so the corpus exercises the
 * already-lapsed branches rather than only the still-paid ones.
 */
export const DEFAULT_NOW_MS = Date.parse('2026-11-01T00:00:00.000Z');

/** The provider label the relabelled second stream carries. See the header. */
export const RAIL_B_PROVIDER = 'replay-rail-b';

/**
 * Columns excluded from the byte-identity comparison, and why each one is.
 *
 * `updated_at` alone. It is stamped with `nowIso()` — the WALL CLOCK — rather
 * than with `deps.nowMs`, so it moves between two runs of the same order and
 * says nothing about ordering. EVERY other column is compared, including
 * `occurred_at`, `last_event_id`, `provider`, `revoked_at` and
 * `revocation_reason`: those are exactly where an ordering defect would show.
 */
export const VOLATILE_COLUMNS = ['updated_at'];

/**
 * Outcomes a later round may usefully re-derive.
 *
 * `refused` — store.ts writes nothing and says why; the grant it depends on may
 *             simply not have been applied yet.
 * `unclaimed` — no account was linked when it arrived; a later notification (or
 *             a sign-in) links it, and the payment was kept rather than dropped.
 * Nothing else is retried: `applied`, `stale` and `ignored` are terminal.
 */
export const RETRYABLE_OUTCOMES = new Set(['refused', 'unclaimed']);

// ─────────────────────────────────────────────────────────────────────────────
// CORPUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One fixture file, or one exported row, reduced to what a replay needs: which
 * adapter reads it, and the exact bytes.
 *
 * A checked-in fixture may spell `payload` as an OBJECT, which is what makes it
 * reviewable in a diff; it is re-serialised here. An exported row spells it as a
 * STRING, which is the verbatim column, and that string is passed through
 * untouched — byte-identity matters for the export path and only for it.
 */
function eventFrom(source, doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new TypeError(`${source}: not a JSON object`);
  }
  const provider = doc.provider ?? doc.provider_id;
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new TypeError(`${source}: no 'provider'`);
  }
  const payload = doc.payload;
  if (typeof payload === 'string') return { source, provider, raw: payload };
  if (payload !== null && typeof payload === 'object') {
    return { source, provider, raw: JSON.stringify(payload) };
  }
  throw new TypeError(`${source}: 'payload' is neither a JSON object nor the verbatim string`);
}

/** Every `*.json` in a directory, sorted by name so a run is reproducible. */
export function loadCorpusDir(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.map((f) => eventFrom(`${dir}/${f}`, JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

/** A D1 export of `provider_notifications`, in any of the shapes wrangler emits. */
export function corpusFromExport(doc, source = '--from') {
  const rows = Array.isArray(doc)
    ? (Array.isArray(doc[0]?.results) ? doc[0].results : doc)
    : Array.isArray(doc?.results)
      ? doc.results
      : null;
  if (rows === null) throw new TypeError(`${source}: no array of rows found`);
  return rows.map((r, i) => eventFrom(`${source}[${i}]`, r));
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────────────────────

/** The provider's own clock, ascending; `eventId` breaks a tie so the baseline
 *  order is itself deterministic rather than dependent on directory listing. */
function byClock(deliveries) {
  return [...deliveries].sort((a, b) => {
    const t = a.notification.occurredAt.localeCompare(b.notification.occurredAt);
    return t !== 0 ? t : a.notification.eventId.localeCompare(b.notification.eventId);
  });
}

/** Group by `provider` (order preserved within a group) and deal round-robin. */
function roundRobinByProvider(deliveries) {
  const groups = new Map();
  for (const d of deliveries) {
    const key = d.notification.provider;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const lanes = [...groups.values()];
  const out = [];
  for (let i = 0; out.length < deliveries.length; i++) {
    for (const lane of lanes) if (i < lane.length) out.push(lane[i]);
  }
  return out;
}

/**
 * The orders every corpus is replayed in. Each one delivers THE SAME MULTISET —
 * a comparison between two runs that saw different events would be measuring the
 * corpus, not the ordering.
 */
export const ORDERS = [
  { name: 'in-order', build: (d) => byClock(d) },
  { name: 'reversed', build: (d) => byClock(d).reverse() },
  { name: 'each-event-duplicated', build: (d) => byClock(d).flatMap((x) => [x, x]) },
  { name: 'interleaved-across-rails', build: (d) => roundRobinByProvider(byClock(d)) },
  { name: 'rails-interleaved-backwards', build: (d) => roundRobinByProvider(byClock(d).reverse()) },
];

/**
 * A second event stream, keyed independently. See the header: this is a RELABEL,
 * not a second adapter, because no second adapter exists in this tree.
 */
export function relabelAsSecondRail(deliveries, provider = RAIL_B_PROVIDER) {
  return deliveries.map((d) => {
    const n = structuredClone(d.notification);
    n.provider = provider;
    n.eventId = `${n.eventId}~${provider}`;
    if (n.subject.kind === 'subscription') {
      n.subject.subscriptionId = `${n.subject.subscriptionId}b`;
      if (n.subject.accountUserId !== null) n.subject.accountUserId = `${n.subject.accountUserId}-b`;
      if (n.subject.transactionId !== null) n.subject.transactionId = `${n.subject.transactionId}b`;
    } else if (n.subject.kind === 'adjustment') {
      if (n.subject.subscriptionId !== null) n.subject.subscriptionId = `${n.subject.subscriptionId}b`;
      if (n.subject.transactionId !== null) n.subject.transactionId = `${n.subject.transactionId}b`;
    }
    return { source: `${d.source} (${provider})`, notification: n, raw: d.raw };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE COMPARISON
// ─────────────────────────────────────────────────────────────────────────────

/** Every entitlement row, key-sorted, volatile columns dropped, as one string. */
export function normalizeRows(rows) {
  const clean = rows.map((row) => {
    const out = {};
    for (const k of Object.keys(row).sort()) {
      if (!VOLATILE_COLUMNS.includes(k)) out[k] = row[k];
    }
    return out;
  });
  clean.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(clean, null, 2);
}

/** A line-oriented diff of two canonical strings, for a human reading a failure. */
export function diffCanonical(nameA, a, nameB, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      out.push(`    line ${i + 1}`);
      out.push(`      ${nameA}: ${la[i] ?? '(absent)'}`);
      out.push(`      ${nameB}: ${lb[i] ?? '(absent)'}`);
    }
  }
  return out;
}

async function readEntitlements(db) {
  const { results } = await db
    .prepare('SELECT * FROM entitlements ORDER BY user_id, app_id, entitlement')
    .bind()
    .all();
  return results ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REPLAY — shared verbatim with services/platform/test/money-replay.test.ts.
// The test injects the vitest harness's `realPlatformDb`; this file injects the
// node:sqlite database below. Neither carries a second copy of the driver.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deliver one ordering into a fresh database and read the final state back.
 *
 * Round 1 models FIRST delivery: store verbatim, then derive; a payload that
 * is already stored in round 1 is a true duplicate here and is `duplicate`.
 * Later rounds re-derive whatever refused, which is what routes/money.ts now
 * does on the rail's own re-delivery — it answers 503 for a derivation that
 * did not conclude and re-derives the stored notification when Paddle brings it
 * back (money.ts, `isUnconcluded`) — and what the nightly `moneyRederive` limb
 * does for anything that outlives the rail's retry window. The rounds exist so
 * a corpus whose refund arrived before its grant can still reach a fixed point,
 * and the number actually used is reported so a run that needed them cannot
 * look like one that did not.
 */
export async function replayOrder(opts) {
  const { deliveries, makeDb, persistNotification, deriveAndApply, isKnownProduct } = opts;
  const environment = opts.environment ?? 'live';
  const nowMs = opts.nowMs ?? DEFAULT_NOW_MS;
  const maxRounds = opts.rounds ?? 3;
  // The store validates a notification's `nikatru_app_id` against the product
  // registers through THIS function (MoneyStoreDeps.isKnownProduct) — injected,
  // because the store cannot import the Worker's config under bare node. No
  // default: a replay that silently accepted every app id would attribute
  // notifications production refuses, and agree with itself about it.
  if (typeof isKnownProduct !== 'function') {
    throw new Error('replayOrder: opts.isKnownProduct is required — the store refuses attribution to a product no register carries, and the replay must apply the same rule');
  }

  const db = await makeDb();
  const deps = { db, environment, nowMs, isKnownProduct };
  const outcomes = [];
  let pending = deliveries;
  let roundsUsed = 0;

  for (let round = 1; round <= maxRounds && pending.length > 0; round++) {
    roundsUsed = round;
    const again = [];
    for (const d of pending) {
      const { fresh } = await persistNotification(deps, d.notification, d.raw);
      if (round === 1 && !fresh) {
        outcomes.push({ round, event: d.notification.eventId, outcome: 'duplicate' });
        continue;
      }
      const result = await deriveAndApply(deps, d.notification);
      outcomes.push({ round, event: d.notification.eventId, outcome: result.outcome });
      if (RETRYABLE_OUTCOMES.has(result.outcome)) again.push(d);
    }
    // No event changed its mind, so another round cannot either.
    if (again.length === pending.length) break;
    pending = again;
  }

  const rows = await readEntitlements(db);
  return { db, rows, canonical: normalizeRows(rows), outcomes, rounds: roundsUsed };
}

/** Every order in [ORDERS], each against a FRESH database. */
export async function replayAllOrders(opts) {
  const runs = [];
  for (const order of ORDERS) {
    const run = await replayOrder({ ...opts, deliveries: order.build(opts.deliveries) });
    runs.push({ name: order.name, ...run });
  }
  const baseline = runs[0];
  const mismatches = runs
    .slice(1)
    .filter((r) => r.canonical !== baseline.canonical)
    .map((r) => ({ name: r.name, diff: diffCanonical(baseline.name, baseline.canonical, r.name, r.canonical) }));
  return { runs, baseline, identical: mismatches.length === 0, mismatches };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RED CONTROL — two events the ordering clause CANNOT separate.
//
// `excluded.occurred_at > entitlements.occurred_at` is a STRICT comparison, so
// two events bearing the SAME provider clock are order-DEPENDENT by
// construction: whichever lands first wins and the second is refused. That is
// not a defect to fix here — it is the one input for which the clause offers no
// protection, and it is exactly what a harness needs in order to demonstrate
// that it can still print red. A run in which this pair comes out IDENTICAL
// means the comparison above stopped comparing.
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal normalized subscription notification, built by hand. */
export function syntheticSubscription({ eventId, occurredAt, periodEnd, userId, appId = 'subscriptiontracker', subscriptionId = 'sub_redcontrol0000000000001' }) {
  return {
    provider: 'paddle',
    eventId,
    notificationId: null,
    eventType: 'subscription.updated',
    occurredAt,
    subject: {
      kind: 'subscription',
      subscriptionId,
      statusVerbatim: 'active',
      access: 'granted',
      currentPeriodEnd: periodEnd,
      trialEnd: null,
      transactionId: null,
      endsWithReason: null,
      accountUserId: userId,
      accountAppId: appId,
      customerId: null,
      customerEmail: null,
    },
  };
}

/** The order-DEPENDENT pair. Two writes, one clock, no tie-breaker anywhere. */
export function redControlDeliveries(clock = '2026-09-09T00:00:00.000Z') {
  const mk = (eventId, periodEnd) => ({
    source: `red-control/${eventId}`,
    notification: syntheticSubscription({
      eventId,
      occurredAt: clock,
      periodEnd,
      userId: 'red-control-user',
    }),
    raw: JSON.stringify({ red_control: eventId, occurred_at: clock }),
  });
  return [mk('evt_red_control_first', '2026-10-01T00:00:00.000Z'), mk('evt_red_control_second', '2027-04-01T00:00:00.000Z')];
}

/** Runs the pair forwards and backwards. Returns whether it went RED. */
export async function runRedControl(opts) {
  const deliveries = redControlDeliveries();
  const forward = await replayOrder({ ...opts, deliveries });
  const backward = await replayOrder({ ...opts, deliveries: [...deliveries].reverse() });
  return {
    forward,
    backward,
    orderDependent: forward.canonical !== backward.canonical,
    diff: diffCanonical('forward', forward.canonical, 'backward', backward.canonical),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE DATABASE — node:sqlite behind D1's interface, with the REAL migrations.
// ─────────────────────────────────────────────────────────────────────────────

function sqliteCtor() {
  // Reached through `process.getBuiltinModule` rather than a static import for
  // the same reason services/platform/test/harness.ts does it: Vite's builtin
  // list does not know `node:sqlite`, and this module is imported by a vitest
  // test. A static import would break that test at transform time.
  return process.getBuiltinModule('node:sqlite').DatabaseSync;
}

class OpsStatement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params ?? [];
  }

  bind(...params) {
    return new OpsStatement(this.db, this.sql, params);
  }

  args() {
    return this.params.map((p) => {
      if (p === undefined) throw new TypeError('D1_TYPE_ERROR: undefined is not a supported bind value');
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p;
    });
  }

  async run() {
    const r = this.db.prepare(this.sql).run(...this.args());
    return { meta: { changes: r.changes } };
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.args()) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args()) };
  }
}

/** platform_db, with `services/platform/migrations/*.sql` applied in order. */
export function makeOpsDb(root) {
  const dir = join(root, MIGRATIONS_REL);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const Ctor = sqliteCtor();
  const db = new Ctor(':memory:');
  for (const f of files) db.exec(readFileSync(join(dir, f), 'utf8'));
  return {
    migrations: files,
    prepare: (sql) => new OpsStatement(db, sql),
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING THE REAL DERIVATION
//
// `store.ts` imports `./contract` and `../d1` WITHOUT a file extension, which
// Node's ESM resolver refuses. A `resolve` hook supplies the extension and
// nothing else — the LOAD is Node's own type stripping, so the bytes executed
// are the bytes in src/, not a transpiled copy this script produced.
// ─────────────────────────────────────────────────────────────────────────────
let hooksRegistered = false;
export async function registerTypeScriptResolution() {
  if (hooksRegistered) return;
  const { registerHooks } = await import('node:module');
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && typeof context.parentURL === 'string' && context.parentURL.endsWith('.ts')) {
        const asIs = new URL(specifier, context.parentURL);
        if (!existsSync(fileURLToPath(asIs))) {
          for (const suffix of ['.ts', '/index.ts']) {
            const candidate = new URL(specifier + suffix, context.parentURL);
            if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
          }
        }
      }
      return nextResolve(specifier, context);
    },
  });
  hooksRegistered = true;
}

async function loadPlatformMoneyModules(root) {
  await registerTypeScriptResolution();
  const src = join(root, 'services/platform/src/lib/mor');
  const store = await import(pathToFileURL(join(src, 'store.ts')).href);
  const registry = await import(pathToFileURL(join(src, 'registry.ts')).href);
  return { store, registry };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

function flag(name) {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
}

function coverageLost(lines) {
  console.error('✗ COVERAGE LOST — money-dry-run.mjs had nothing to replay.');
  for (const l of lines) console.error(`    ${l}`);
  console.error('');
  console.error('  An order-independence claim proven over zero events is the failure this repository exists');
  console.error('  to reject: it is green, it is vacuous, and it reads exactly like a rail that was checked.');
  process.exit(2);
}

async function main() {
  const asJson = flag('json') !== undefined;
  const fromArg = flag('from');
  const corpusArg = flag('corpus');
  const nowArg = flag('now');
  const roundsArg = flag('rounds');

  const nowMs = nowArg ? Date.parse(nowArg) : DEFAULT_NOW_MS;
  if (!Number.isFinite(nowMs)) {
    console.error(`✗ --now=${nowArg} is not a date this script can read.`);
    process.exit(2);
  }
  const rounds = roundsArg ? Number(roundsArg) : 3;
  if (!Number.isInteger(rounds) || rounds < 1) {
    console.error(`✗ --rounds=${roundsArg} must be an integer >= 1.`);
    process.exit(2);
  }

  // ── the subject ────────────────────────────────────────────────────────────
  let corpus = null;
  let subjectName = '';
  if (fromArg) {
    const file = resolve(ROOT, fromArg);
    if (!existsSync(file)) {
      coverageLost([`--from=${fromArg} resolves to ${file}, which does not exist.`]);
    }
    corpus = corpusFromExport(JSON.parse(readFileSync(file, 'utf8')), file);
    subjectName = file;
  } else {
    const dir = resolve(ROOT, corpusArg || DEFAULT_CORPUS_REL);
    corpus = loadCorpusDir(dir);
    subjectName = dir;
    if (corpus === null) {
      coverageLost([
        `${dir} is not a directory on disk, so no fixture was read.`,
        'The corpus is the subject. Without one this script would replay the empty list in five orders,',
        'find all five identical, and print a green verdict about nothing at all.',
      ]);
    }
  }
  if (corpus.length === 0) {
    coverageLost([`${subjectName} held ZERO notification payloads.`]);
  }
  if (corpus.length < 2) {
    coverageLost([
      `${subjectName} held ${corpus.length} notification payload.`,
      'Order-independence over a single event is a statement with no order in it. Two is the floor.',
    ]);
  }

  // ── the real code ──────────────────────────────────────────────────────────
  const { store, registry } = await loadPlatformMoneyModules(ROOT);
  const railA = [];
  const unparsed = [];
  for (const event of corpus) {
    const verifier = registry.verifierFor(event.provider);
    if (verifier === undefined || verifier === null) {
      unparsed.push(`${event.source}: no adapter is registered for provider '${event.provider}'`);
      continue;
    }
    const parsed = verifier.parse(event.raw);
    if (!parsed.ok) {
      unparsed.push(`${event.source}: the real ${event.provider} adapter refused it — ${parsed.reason}`);
      continue;
    }
    railA.push({ source: event.source, notification: parsed.notification, raw: event.raw });
  }
  if (unparsed.length > 0) {
    coverageLost([
      `${unparsed.length} of ${corpus.length} payload(s) never reached the derivation:`,
      ...unparsed,
      'A payload the shipped adapter cannot read is not a replay; it is a fixture that quietly left the run.',
    ]);
  }

  const deliveries = [...railA, ...relabelAsSecondRail(railA)];
  const makeDb = () => makeOpsDb(ROOT);
  // The same product registers the Worker's config.ts reads, through the
  // tooling reader that already exists for them. A register that cannot be
  // read is COVERAGE LOST, not an empty set: an empty set would make every
  // attributable notification `unclaimed` and the five orders would agree
  // about a table nothing wrote to.
  const registers = readProducts(ROOT);
  if (registers.problems.length > 0) {
    coverageLost([
      'the product registers could not be read, so the replay cannot apply the attribution rule the store applies:',
      ...registers.problems,
    ]);
  }
  // Every register's product but a bundle — the Worker's config.ts
  // `isAttributableProduct`, which says why a bundle id is never attributed.
  const knownProducts = new Set(registers.products.filter((p) => p.kind !== BUNDLE_KIND).map((p) => p.slug));
  const isKnownProduct = (id) => typeof id === 'string' && knownProducts.has(id);
  const shared = {
    makeDb,
    persistNotification: store.persistNotification,
    deriveAndApply: store.deriveAndApply,
    isKnownProduct,
    nowMs,
    rounds,
  };

  const { runs, baseline, identical, mismatches } = await replayAllOrders({ ...shared, deliveries });

  // A corpus that writes nothing would be identical in every order and prove
  // nothing at all. It is refused here rather than reported green.
  const applied = baseline.outcomes.filter((o) => o.outcome === 'applied').length;
  if (applied === 0 || baseline.rows.length === 0) {
    coverageLost([
      `${subjectName} produced ${baseline.rows.length} entitlement row(s) and ${applied} 'applied' outcome(s).`,
      'Every order agrees about a table nothing wrote to. The corpus must contain at least one payload',
      'that actually moves an entitlement, or the whole comparison is between two empty sets.',
    ]);
  }

  const red = await runRedControl(shared);

  // ── the verdict ────────────────────────────────────────────────────────────
  if (asJson) {
    console.log(JSON.stringify({
      root: ROOT,
      subject: subjectName,
      fixtures: corpus.length,
      deliveriesPerRun: deliveries.length,
      nowMs,
      orders: runs.map((r) => ({ name: r.name, rounds: r.rounds, deliveries: r.outcomes.length })),
      identical,
      mismatches,
      redControlWentRed: red.orderDependent,
      finalState: JSON.parse(baseline.canonical),
    }, null, 2));
  } else {
    console.log(`money-dry-run — ${subjectName}`);
    console.log(`  ${corpus.length} stored payload(s) × 2 rails = ${deliveries.length} deliveries per run`);
    console.log(`  clock pinned at ${new Date(nowMs).toISOString()}; up to ${rounds} re-derivation round(s)`);
    for (const r of runs) {
      const counts = {};
      for (const o of r.outcomes) counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
      const summary = Object.keys(counts).sort().map((k) => `${k}=${counts[k]}`).join(' ');
      console.log(`    ${r.name.padEnd(28)} ${r.outcomes.length} deliveries · ${r.rounds} round(s) · ${summary}`);
    }
    console.log(`  final entitlement row(s): ${baseline.rows.length}`);
    console.log(baseline.canonical.split('\n').map((l) => `    ${l}`).join('\n'));
  }

  if (!identical) {
    console.error('');
    console.error(`✗ THE FINAL ENTITLEMENT DEPENDS ON DELIVERY ORDER — ${mismatches.length} order(s) disagreed with '${baseline.name}':`);
    for (const m of mismatches) {
      console.error(`  ${m.name}:`);
      for (const line of m.diff) console.error(line);
    }
    console.error('');
    console.error('  No rail guarantees delivery order. If the answer moves with the order, a retried purchase');
    console.error('  can re-grant Pro to a refunded customer — the defect store.ts\'s header names first.');
    process.exit(1);
  }

  if (!red.orderDependent) {
    console.error('');
    console.error('✗ THE RED CONTROL DID NOT GO RED.');
    console.error('    Two notifications bearing the SAME occurred_at were replayed forwards and backwards and');
    console.error('    produced the same final row. The strict `excluded.occurred_at > entitlements.occurred_at`');
    console.error('    comparison cannot separate them, so this pair MUST be order-dependent. That it was not');
    console.error('    means the comparison above has stopped comparing, and every green verdict it printed is');
    console.error('    a verdict about nothing.');
    process.exit(1);
  }

  // `--json` keeps stdout parseable: the verdict is already in the document
  // above (`identical`, `redControlWentRed`), so a human sentence after it would
  // only make the report unreadable to the thing that asked for JSON.
  if (!asJson) {
    console.log('');
    console.log(`ok — ${ORDERS.length} delivery orders, ${deliveries.length} deliveries each, one final entitlement state.`);
    console.log('     red control: two events on the same provider clock DID diverge, so this harness can fail.');
  }
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  await main();
}
