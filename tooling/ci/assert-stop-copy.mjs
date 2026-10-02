#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-stop-copy.mjs — the stop-a-charge copy says only what is allowed
// (train ST-detail-stop, DE-07/DE-08; the design rule R3).
//
// The detail screen's India rail panel and the stop-a-charge flow tell a user
// how to stop a charge THEY are paying: what a UPI Autopay, card e-mandate or
// NACH mandate is, that cancelling with the provider is not revoking the
// mandate, and where to revoke it — in their own UPI app, bank or card portal.
// Two things that copy must never do, because each is a false statement about
// the user's money:
//
//   · CLAIM THE APP CANCELS OR REVOKES ANYTHING. It cannot; no API exists for
//     it and none is called. "We'll cancel it for you" would leave a user
//     believing a charge has stopped while it keeps arriving.
//   · PRINT A DEBIT TIME. The app does not know when a mandate debits; a time
//     of day ("9:00 AM"), or "debited on/at", is invented precision about a
//     charge.
//
// The subject is every value in `apps/subscriptiontracker/lib/l10n/app_*.arb`
// whose key is in the stop-copy namespace — `railPanel*`, `stop*` and
// `howToCancel*` — in EVERY shipped locale, because a translation can say what
// the English does not.
//
// Exit codes: 0 green · 1 a forbidden phrase (the key, locale and phrase are
// named) · 2 COVERAGE LOST — an arb is missing or unreadable, or the namespace
// holds fewer keys than the floor below, so this run checked too little to be
// evidence.
//
// Usage:  node tooling/ci/assert-stop-copy.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(HERE, '..', '..'));
const L10N = 'apps/subscriptiontracker/lib/l10n';

/** The stop-copy namespace: the keys whose values R3 governs. */
export const SCOPE = /^(?:railPanel|stop|howToCancel)[A-Z]/;

/**
 * MEASURED 2026-10-01 off the arb: 45 keys in the namespace per locale
 * (railPanel 10, stop 28, howToCancel 7). A floor, not the count: it
 * only refuses a namespace that SHRANK — renamed keys, a moved arb — so a
 * guard that found nothing to read cannot print "clean". Move it with the
 * namespace, in the same change.
 */
const SCOPE_FLOOR = 45;

/**
 * The forbidden shapes. Each is a phrase a reviewer would refuse on sight;
 * the regex is what refuses it when no reviewer is looking. Case-insensitive.
 */
export const FORBIDDEN = [
  {
    why: 'claims the app cancels, revokes or stops the charge',
    re: /\bwe(?:'ll|\s+will|\s+can|'ve|\s+have)?\s+(?:cancel|revoke|stop)(?:led|ed|ped)?\b/i,
  },
  { why: 'claims the app acted for the user', re: /\b(?:cancel(?:l?ed)?|revoked|stopped)\s+(?:it\s+)?for\s+you\b/i },
  { why: 'claims the app cancels', re: /\b(?:subly|this app|the app)\s+(?:will\s+|can\s+)?(?:cancel|revoke|stop)s?\b/i },
  { why: 'prints a debit time of day', re: /\b\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)\b/i },
  { why: 'prints a clock time', re: /\b\d{1,2}:\d{2}\b/ },
  { why: 'names when a debit happens', re: /\bdebit(?:ed|s)?\s+(?:at|on|by)\b/i },
  { why: 'names a next debit', re: /\b(?:next|upcoming)\s+debit\b/i },
  { why: 'predicts a debit', re: /\bwill\s+be\s+debited\b/i },
];

/** Every finding in one arb object: [{key, why, phrase}]. Pure, for the suite. */
export function findingsIn(arb) {
  const out = [];
  for (const [key, value] of Object.entries(arb)) {
    if (key.startsWith('@') || !SCOPE.test(key) || typeof value !== 'string') continue;
    for (const { why, re } of FORBIDDEN) {
      const m = value.match(re);
      if (m) out.push({ key, why, phrase: m[0] });
    }
  }
  return out;
}

function main() {
  const dir = join(ROOT, L10N);
  if (!existsSync(dir)) {
    console.error(`COVERAGE LOST — ${L10N} does not exist under ${ROOT}; nothing was read.`);
    return 2;
  }
  const arbs = listDir(dir)
    .filter((f) => /^app_[a-z]{2,3}(?:_[A-Z]{2})?\.arb$/.test(f))
    .sort();
  if (!arbs.includes('app_en.arb')) {
    console.error(`COVERAGE LOST — ${L10N}/app_en.arb (the template) is missing; nothing was read.`);
    return 2;
  }
  let failed = false;
  let lost = false;
  for (const f of arbs) {
    let arb;
    try {
      arb = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      console.error(`COVERAGE LOST — ${L10N}/${f} does not parse as JSON (${e.message}).`);
      lost = true;
      continue;
    }
    const scoped = Object.keys(arb).filter((k) => !k.startsWith('@') && SCOPE.test(k));
    if (scoped.length < SCOPE_FLOOR) {
      console.error(
        `COVERAGE LOST — ${L10N}/${f} holds ${scoped.length} stop-copy key(s), under the floor of ` +
          `${SCOPE_FLOOR}: the namespace shrank or moved, so this run read too little to be evidence.`,
      );
      lost = true;
      continue;
    }
    const found = findingsIn(arb);
    for (const { key, why, phrase } of found) {
      console.error(`FAIL ${L10N}/${f} · ${key} ${why}: "${phrase}"`);
      failed = true;
    }
    if (found.length === 0) console.log(`ok   ${L10N}/${f}: ${scoped.length} stop-copy value(s), none forbidden`);
  }
  if (lost) return 2;
  if (failed) return 1;
  console.log(`assert-stop-copy: ok — ${arbs.length} locale(s), ${FORBIDDEN.length} forbidden shape(s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
