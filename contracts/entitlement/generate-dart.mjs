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

const rendered = lines.join('\n') + '\n';

if (!check) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, rendered, 'utf8');
  console.log(`ok  wrote ${REL} — ${reasons.length} revocation reason(s), ${environments.length} money environment(s)`);
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
  `(${reasons.length} revocation reason(s), ${environments.length} money environment(s))`);
