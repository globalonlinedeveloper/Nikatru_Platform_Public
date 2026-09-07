#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-dart.mjs — write the Dart view of the entitlement contract, or prove
// the committed file still agrees with it.
//
//   node contracts/entitlement/generate-dart.mjs           rewrite the .g.dart
//   node contracts/entitlement/generate-dart.mjs --check    exit 1 if it would change
//
// WHY DART IS GENERATED AND THE OTHER TWO CONSUMERS ARE NOT. A TypeScript Worker
// and a vanilla-JS extension import `contract.js` itself — the same bytes, no
// tool in between, which is the whole no-build property [ADR 067] decision 1
// protects. Dart cannot import JavaScript, so the only honest options were a
// hand-kept fourth transcription or a generated one. This is the generated one,
// exactly the pattern `packages/tokens` already uses to write
// `sites/_shared/assets/tokens.css` from DTCG JSON.
//
// ⚠️ NO DEPENDENCIES, DELIBERATELY — plain node, no install, for the same reason
// nothing under extensions/ has a package.json. It reads `contract.js` directly
// rather than `contract.json`, so a `contract.json` that had drifted could not
// make this output agree with it; `generate.mjs --check` is what holds those
// two, and `tooling/ci/assert-entitlement-contract.mjs` limb 4 holds all five
// copies against the SQL seed.
//
// ⚠️ THE OUTPUT IS COMMITTED. `packages/purchases` is a pub package with no
// build_runner and no codegen step in CI; a generated file that is not in the
// tree is a file the analyzer cannot see and the app cannot compile against.
// Committing it is also what makes the drift visible as a diff.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_TABLE } from './contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const REL = 'packages/purchases/lib/src/generated/entitlement_contract.g.dart';
const OUT = join(ROOT, REL);
const check = process.argv.includes('--check');

const environments = [...CONTRACT_TABLE.moneyEnvironments];
const reasons = CONTRACT_TABLE.revocationReasons.map((r) => ({ reason: r.reason, restores: r.restores }));
const events = CONTRACT_TABLE.revenuecatEventReasons.map((r) => ({ event: r.event, reason: r.reason ?? null }));

// A COVERAGE SELF-CHECK, because an empty table renders as valid Dart and reads
// exactly like a clean run. `restores` is called out separately: a table with
// every member present and NO restoring member is the specific corruption that
// leaves a customer who won back a chargeback locked out forever.
if (reasons.length === 0 || environments.length === 0) {
  console.error(`✗ COVERAGE LOST — contract.js exported an empty table, so ${REL} would be written empty.`);
  console.error('  An empty set satisfies every downstream check vacuously; that is not a pass.');
  process.exit(1);
}
if (!reasons.some((r) => r.restores)) {
  console.error(`✗ COVERAGE LOST — no revocation reason in contract.js restores access, so ${REL}`);
  console.error('  would be generated with nothing in this rail that ever gives access back.');
  process.exit(1);
}
// The RevenueCat table gets its own floor, and a sharper one than "non-empty":
// a map whose every row is `reason: null` renders as valid Dart, compiles, and
// silently means "no store event ever revokes anything". That is the shape a
// well-meaning edit produces while removing a row it is unsure about.
if (events.length === 0 || !events.some((e) => e.reason !== null)) {
  console.error(`✗ COVERAGE LOST — contract.js maps no RevenueCat event to a revocation reason, so ${REL}`);
  console.error('  would carry a translation table that translates nothing. An empty answer is not a safe answer here.');
  process.exit(1);
}
// Every mapped reason must be a member of the reason set. The generator refuses
// rather than emitting Dart that names a reason the database has never seeded —
// assert-entitlement-contract limb 6 catches it too, and a generator that can
// emit a broken table is a generator whose output nobody can trust on its own.
{
  const known = new Set(reasons.map((r) => r.reason));
  const stray = events.filter((e) => e.reason !== null && !known.has(e.reason));
  if (stray.length) {
    console.error(`✗ ${REL} would map RevenueCat event(s) ${stray.map((e) => e.event).join(', ')} to reason(s) ` +
      `${stray.map((e) => e.reason).join(', ')}, which contract.js does not declare as revocation reasons.`);
    console.error('  A revocation reason nothing seeded is a value the database will reject after the money has moved.');
    process.exit(1);
  }
}

/** Dart single-quoted string literal. The reason set is `[a-z_]+` today; this
 *  escapes anyway, because a generator that is only correct for today's inputs
 *  is a generator that emits broken code on the day the input changes. */
const dq = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$') + "'";

const lines = [];
lines.push('// GENERATED FILE — DO NOT EDIT.');
lines.push('//');
lines.push('// Written by `node contracts/entitlement/generate-dart.mjs` from');
lines.push('// contracts/entitlement/contract.js, the one authored copy of the money');
lines.push('// vocabulary. `--check` fails CI on drift, and');
lines.push('// tooling/ci/assert-entitlement-contract.mjs limb 4 compares the values below');
lines.push('// against the SQL seed in services/platform/migrations/0004_money_rail.sql,');
lines.push('// so a hand edit here is caught twice.');
lines.push('//');
lines.push('// WHY DART GETS A GENERATED COPY AND NOBODY ELSE DOES: the Worker and the');
lines.push('// extensions import contract.js itself, byte for byte. Dart cannot import');
lines.push('// JavaScript, so this is the one transcription — and it is machine-made');
lines.push('// rather than remembered.');
lines.push('//');
lines.push('// `restoresAccess` MARKS THE ONE MEMBER THAT GIVES ACCESS BACK. A copy that');
lines.push('// loses that flag leaves a customer who raised a dispute in error, and lost');
lines.push('// it, locked out forever — nothing else in this rail restores access.');
lines.push('');
lines.push('/// One revocation reason, and whether it RESTORES access.');
lines.push('class EntitlementRevocationReason {');
lines.push('  const EntitlementRevocationReason(this.reason, {required this.restoresAccess});');
lines.push('');
lines.push('  /// The value written to `entitlements.revocation_reason`.');
lines.push('  final String reason;');
lines.push('');
lines.push('  /// True for the one member that gives access back.');
lines.push('  final bool restoresAccess;');
lines.push('');
lines.push('  @override');
lines.push('  String toString() => reason;');
lines.push('}');
lines.push('');
lines.push('/// The money worlds a credential, a notification and an entitlement row can');
lines.push('/// belong to. Configuration decides which one; a payload never does.');
lines.push('const List<String> kMoneyEnvironments = <String>[');
for (const e of environments) lines.push(`  ${dq(e)},`);
lines.push('];');
lines.push('');
lines.push('/// The revocation-lifecycle reason set, in the order it is authored.');
lines.push('const List<EntitlementRevocationReason> kRevocationReasons =');
lines.push('    <EntitlementRevocationReason>[');
for (const r of reasons) {
  lines.push(`  EntitlementRevocationReason(${dq(r.reason)}, restoresAccess: ${r.restores}),`);
}
lines.push('];');
lines.push('');
lines.push('/// Whether `value` is a money environment this portfolio recognises.');
lines.push('bool isMoneyEnvironment(String value) => kMoneyEnvironments.contains(value);');
lines.push('');
lines.push('/// Whether `reason` is a revocation reason this portfolio recognises.');
lines.push('bool isRevocationReason(String reason) =>');
lines.push('    kRevocationReasons.any((r) => r.reason == reason);');
lines.push('');
lines.push('/// Whether `reason` GIVES ACCESS BACK. Resolved, never remembered.');
lines.push('bool revocationRestoresAccess(String reason) =>');
lines.push('    kRevocationReasons.any((r) => r.reason == reason && r.restoresAccess);');
lines.push('');
lines.push('/// One RevenueCat webhook event and the revocation reason it means.');
lines.push('///');
lines.push('/// A null [reason] is an event that is deliberately NOT a revocation, which is');
lines.push('/// a different fact from an event nobody mapped — the table records both so the');
lines.push('/// next reader does not close the gap by guessing.');
lines.push('class RevenueCatEventReason {');
lines.push('  const RevenueCatEventReason(this.event, this.reason);');
lines.push('');
lines.push('  /// The vendor event type, verbatim.');
lines.push('  final String event;');
lines.push('');
lines.push('  /// The revocation reason, or null when this event revokes nothing.');
lines.push('  final String? reason;');
lines.push('');
lines.push('  @override');
lines.push("  String toString() => reason == null ? '$event -> (no revocation)' : '$event -> $reason';");
lines.push('}');
lines.push('');
lines.push('/// The RevenueCat event to revocation-reason map, in the order it is authored.');
lines.push('const List<RevenueCatEventReason> kRevenueCatEventReasons =');
lines.push('    <RevenueCatEventReason>[');
for (const e of events) {
  lines.push(`  RevenueCatEventReason(${dq(e.event)}, ${e.reason === null ? 'null' : dq(e.reason)}),`);
}
lines.push('];');
lines.push('');
lines.push('/// The revocation reason a RevenueCat event means, or null when it means none.');
lines.push('///');
lines.push('/// An event this table does not name also answers null. That is the SAFE');
lines.push('/// direction: nothing is revoked on an unrecognised event, and the server read');
lines.push('/// stays the only thing that ever unlocks or locks.');
lines.push('String? revocationReasonForRevenueCatEvent(String event) {');
lines.push('  for (final RevenueCatEventReason r in kRevenueCatEventReasons) {');
lines.push('    if (r.event == event) return r.reason;');
lines.push('  }');
lines.push('  return null;');
lines.push('}');

const rendered = lines.join('\n') + '\n';

if (!check) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, rendered, 'utf8');
  console.log(`ok  wrote ${REL} — ${reasons.length} revocation reason(s), ${environments.length} money environment(s), ${events.length} RevenueCat event mapping(s)`);
  process.exit(0);
}

let current;
try { current = readFileSync(OUT, 'utf8'); }
catch { current = null; }

if (current === null) {
  console.error(`✗ ${REL} does not exist. Run: node contracts/entitlement/generate-dart.mjs`);
  process.exit(1);
}
if (current.replace(/\r\n/g, '\n') !== rendered) {
  console.error(`✗ ${REL} is not what contract.js derives — the Dart copy of the entitlement`);
  console.error('  vocabulary has drifted from the authored one, which is the exact failure');
  console.error('  contracts/ exists to prevent.');
  console.error('  Run: node contracts/entitlement/generate-dart.mjs');
  process.exit(1);
}

console.log(`ok  entitlement contract — ${REL} matches contract.js ` +
  `(${reasons.length} revocation reason(s), ${environments.length} money environment(s), ${events.length} RevenueCat event mapping(s))`);
