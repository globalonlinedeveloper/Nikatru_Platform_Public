#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scheduled-rehearsal.mjs — which app a SCHEDULED store rehearsal takes, when the
// workspace set holds more than one.
//
// ⏱ ADDED 2026-10-03 (review of #1187, finding 5; O-STORE-DRY-RUNS-HAVE-NO-CADENCE (absent from open.json until the next Private pass records it)).
// A scheduled run of a submit-*.yml has no `app` input, and the dry-run job
// rehearses one app per run (every job reads the gate's one checked app). The
// gate first REFUSED a set of more than one, so the day a second app landed all
// four weekly rehearsals would go red, and fourteen days later
// `assert-platform-proof-fresh.mjs --store-lanes` would turn every ci-gate red
// with them. Now the set ROTATES: each scheduled run rehearses the app whose turn
// this week is — the apps sorted, the turn the ISO week index modulo their count —
// and says so, naming the week and when the next app comes up. A set of N apps
// rehearses each one every N weeks; a dispatch still rehearses any app on demand.
// The lane's freshness (a green dry run inside 14 days) holds as long as the
// weekly runs are green, whatever N is.
//
// Usage: node tooling/ci/scheduled-rehearsal.mjs --apps '<json array>' [--now <iso>]
// stdout: the app id, alone. stderr: the rotation it came from.
// Exit 0 = an app. 1 = a bad invocation. 2 = COVERAGE LOST (the set is empty:
// there is nothing to rehearse, and picking "no app" would print green over nothing).
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEEK_MS = 7 * 86_400_000;

/** PURE. `{ app, index, of, week }` for a set and an instant, or `{ empty: true }`. */
export function scheduledApp(apps, nowMs) {
  const set = [...new Set(apps)].sort();
  if (set.length === 0) return { empty: true };
  const week = Math.floor(nowMs / WEEK_MS);
  const index = week % set.length;
  return { app: set[index], index, of: set.length, week, set };
}

function coverageLost(why) {
  console.error(`✗ COVERAGE LOST — ${why}`);
  process.exit(2);
}

function main(argv) {
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
  };
  let apps;
  try {
    apps = JSON.parse(opt('apps') ?? '');
  } catch {
    console.error('✗ scheduled-rehearsal: --apps must be a JSON array of app ids (assert-release-lane-generic.mjs --emit-apps prints one).');
    return 1;
  }
  if (!Array.isArray(apps) || apps.some((a) => typeof a !== 'string' || a === '')) {
    console.error('✗ scheduled-rehearsal: --apps must be a JSON array of non-empty app ids.');
    return 1;
  }
  const nowRaw = opt('now');
  const nowMs = nowRaw === null ? Date.now() : Date.parse(nowRaw);
  if (Number.isNaN(nowMs)) {
    console.error(`✗ scheduled-rehearsal: --now "${nowRaw}" is not a date.`);
    return 1;
  }
  const pick = scheduledApp(apps, nowMs);
  if (pick.empty) coverageLost('the workspace app set is empty, so a scheduled rehearsal has no app to take.');
  const next = pick.set[(pick.index + 1) % pick.of];
  console.error(
    pick.of === 1
      ? `scheduled rehearsal: ${pick.app}, the workspace set's only app`
      : `scheduled rehearsal: ${pick.app} — week ${pick.week}, turn ${pick.index + 1} of ${pick.of} [${pick.set.join(', ')}]; next week: ${next}. Dispatch the lane with app=<id> to rehearse another now.`,
  );
  process.stdout.write(pick.app);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
