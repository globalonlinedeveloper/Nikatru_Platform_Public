// ─────────────────────────────────────────────────────────────────────────────
// money-wiring.mjs — WHERE AN APP'S MONEY WIRING LIVES, AND WHAT WIRES ITS
// STORE BRIDGE. O-BRICK-SELLS-NOTHING-IN-A-STORE (12b).
//
// Two guards read an app's money provider: assert-stamp-properties.mjs (the
// chassis must fetch, save verified and lock) and assert-app-yaml.mjs limb 6
// (e) (an app that declares `billing.mobileIap` wires its store bridge through
// the shared rule and passes no literal null). Both name the file from
// MONEY_PROVIDERS below, so moving the provider moves both readers at once —
// and limb 6 (e) turns a provider that is not where this says into COVERAGE
// LOST, never a pass.
//
// Pure data: no filesystem, no tree, no exit.
// ─────────────────────────────────────────────────────────────────────────────

/** The app-relative path of an app's money provider (the brick's and every
 *  stamped app's, and app #1's). */
export const MONEY_PROVIDERS = 'lib/state/money_providers.dart';

/** The call that wires a store bridge: packages/billing_revenuecat's
 *  `StoreBridgeWiring.forChannel`, the one fail-closed rule. */
export const STORE_WIRING_CALL = 'StoreBridgeWiring.forChannel(';

/** A money provider handing the facade a literal null bridge or config. */
export const NULL_BRIDGE = /\biapBridge(?:Config)?:\s*null\b/;
