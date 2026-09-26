// ─────────────────────────────────────────────────────────────────────────────
// build-stamp.ts — which `app_version` a PRODUCTION ingest row may carry.
//
// ⏱ 2026-09-26 · ops-watch 36241509870 (12:18Z) went red on "Every row in
// production traces to a released build": two `events` rows and two
// `consent_artifacts` rows stamped `dev` (subscriptiontracker, android, US).
// The repository is PUBLIC, so anyone can build the app from it; a build with
// no APP_VERSION define stamps `dev`, and /v1/events and /v1/consent took any
// string. tooling/ops/check-prod-provenance.mjs then called the rows
// unattributable, a day after they were written, with nothing able to stop the
// next one.
//
// So production now refuses at the door what the monitor would refuse at the
// census, on SHAPE: 422 `unreleased_build`, and nothing is written.
//
// 🔴 THE PATTERNS ARE MIRRORS, NOT A THIRD DEFINITION. A Worker bundle cannot
// import tooling/, so each is restated here and test/build-stamp.test.ts holds
// every one to its source, byte for byte:
//   RELEASED_BUILD   ← `BUILD_VERSION`, tooling/ops/check-prod-provenance.mjs
//   E2E_RUN          ← `E2E_RUN_SHAPE`, tooling/e2e/app-version-stamp.mjs
//   PRODUCTION_STAMPS ← each app_version-graded table's `resolver` +
//                      `alsoResolves` in tooling/prod-provenance.json, less
//                      `store-capture`: the monitor calls a `cap-*` consent row
//                      in production a FINDING ("a sandbox lane wrote
//                      production"), since the capture writes the sandbox
//                      Workers.
//
// ⚠️ SHAPE ONLY. The monitor ALSO cross-checks the run number and the sha
// against GitHub's run history, and that is a network read no ingest request
// should wait on. A hand-crafted `1.0.999+abcdef0` still gets in and the
// monitor still reddens on it. What this refuses is the class that arrives by
// ACCIDENT: every unstamped build from a clone of the public repo.
// ─────────────────────────────────────────────────────────────────────────────

/** `<release_line>.<run_number>+<sha7>`: what deploy-web.yml and every
 *  submission lane stamp. */
export const RELEASED_BUILD = /^(\d+)\.(\d+)\.(\d+)\+([0-9a-fA-F]{7,40})$/;

/** `e2e-<run_number>-<sha7>`: .github/workflows/e2e.yml's live drive, which
 *  writes consent rows to production and purges them itself. */
export const E2E_RUN = /^e2e-(\d{1,9})-([0-9a-f]{7})$/;

/** Named by the monitor's resolver ids, so the pin test compares like with like. */
const SHAPES = {
  'released-build': RELEASED_BUILD,
  'e2e-run': E2E_RUN,
} as const;

export type StampResolver = keyof typeof SHAPES;

/** Per table the ingest routes write, the resolvers a production row may pass. */
export const PRODUCTION_STAMPS: Readonly<Record<'events' | 'consent_artifacts', readonly StampResolver[]>> = {
  events: ['released-build'],
  consent_artifacts: ['released-build', 'e2e-run'],
};

/** The stable error code. The Dart client stops retrying on exactly this. */
export const UNRELEASED_BUILD = 'unreleased_build';

/**
 * Is this the PRODUCTION Worker? `MONEY_ENVIRONMENT` is the one var that says
 * which deployed world this is: the top level of wrangler.jsonc is `"live"`
 * (tooling/ci/assert-money-config.mjs fails the build on anything else),
 * `env.sandbox` is `"sandbox"`, and the local `.dev.vars.example` sets
 * `sandbox`. A test env that sets nothing is not production either, so local
 * and sandbox work keeps accepting `dev`.
 */
export function isProductionIngest(env: { MONEY_ENVIRONMENT?: string }): boolean {
  return env.MONEY_ENVIRONMENT === 'live';
}

/**
 * True when production must REFUSE this row. `appVersion` is the value the
 * route would bind, so an absent, empty or over-long value (stored as NULL)
 * is refused too, the same as the monitor's "no app_version at all".
 */
export function refusesStamp(
  env: { MONEY_ENVIRONMENT?: string },
  table: keyof typeof PRODUCTION_STAMPS,
  appVersion: string | null,
): boolean {
  if (!isProductionIngest(env)) return false;
  if (appVersion === null) return true;
  return !PRODUCTION_STAMPS[table].some((r) => SHAPES[r].test(appVersion));
}
