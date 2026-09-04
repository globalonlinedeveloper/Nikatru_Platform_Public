// ═══════════════════════════════════════════════════════════════════════════
// SUBLY'S ROUTER — the single one. P2.5 de-duplicated the live
// `lib/core/router/app_router.dart` and the stamped router into this file, at
// the STAMP's path (anchored by tooling/ci/assert-stamp-properties.mjs
// `const ROUTER = 'lib/core/router.dart'`; Subly is EXEMPT_APPS today and
// Phase 5 drops that exemption).
//
// 📁 `lib/core/router/` EXISTS AGAIN AS OF P1b, AND IT IS NOT THE THING P2.5
// DELETED. What P2.5 removed was a RIVAL ROUTER — `router/app_router.dart`
// declared its own `GoRouter`, its own redirect and its own refresh bridge, so
// the app had two answers to every routing question and a fix to one was
// invisible to the other. What the directory holds now is THIS router's own
// working, split by capability, with exactly one `GoRouter` in the tree:
//
//   router/gates.dart            the ORDERED gate chain — one function per
//                                gate, composed in `kGateChain` in the same
//                                order the single closure ran them
//   router/routes.dart           the route table above the shell
//   router/shell.dart            the five shell branches + `_GatedInsights`
//   router/navigator_key.dart    `rootNavigatorKey`
//   router/router_provider.dart  the `GoRouter` those four assemble into
//
// This file is the BARREL, and it re-exports exactly the two symbols this app
// has always been able to see from `core/router.dart` — [rootNavigatorKey] and
// [routerProvider]. Every existing `import '.../core/router.dart';` therefore
// resolves what it did before, no importer was edited, nothing was renamed and
// no behaviour changed. The gate helpers stay private to the files that use
// them, so the barrel adds NO new name to any importer's scope — three of them
// (`nextOr`, `gateWithNext`, `pendingAddress`) share a name with
// `package:nikatru_core`'s exports and exporting them would make those names
// ambiguous wherever both libraries are imported.
//
// 🔴 GUARDS AND ONE TEST READ THIS PATH AS A FILE, AND ALL OF THEM NOW READ THE
// SPINE. `assert-a11y-coverage.mjs` and `assert-responsive-coverage.mjs` derive
// the routed-surface set from it, `assert-stamp-properties.mjs` anchors chassis
// properties in it, and `test/chassis_properties_test.dart` derives its whole
// screen set from it. Read as ONE FILE after the split, every one of them ranges
// over a router with no routes in it — which reads exactly like a router that
// lost them. Each was widened to `router.dart` PLUS `router/*.dart`, the same
// repair PR #452 made for the providers spine, and none of them checks less.
//
// Route inventory (the union — nothing live was lost, every stamped route is
// reachable):
//   FROM LIVE : /onboarding /scan /notifications /sub/:id
//               /home /calendar /insights /budget /settings   (shell)
//   FROM STAMP: / /sign-in /sign-up /paywall /manage-plan  + errorBuilder
//   COLLISIONS: /onboarding (live screen wins) · /settings (live shell
//               placement wins) · / (stamp entry kept as a redirect to /home)
//
// ── THE AUTH ROUTE IS `/sign-in`, AND IT IS THE ONLY ONE (owner, 2026-08-09) ─
// P2.5 mounted BOTH `/login` (live) and `/sign-in` (stamp) and deferred the
// choice as a product decision. It is now made: **`/sign-in` is canonical and
// `/login` is a redirect onto it.** Two URLs for one gate is a fork that leaks
// everywhere a link can be written — a marketing page, a password-reset mail, a
// stale bookmark, a deep link built by a Worker — and each of them ages into a
// different answer.
//
// 🔴 THE SCREEN DID NOT MOVE; ONLY THE URL DID. `/sign-in` builds the LIVE
// `LoginScreen`, which is the screen a signed-out Subly user has always landed
// on. It is the surface that carries the ADR-027 account-deletion notice (the
// deletion outcome has NO other place to render — the sign-out redirect tears
// down settings, its dialog and any SnackBar), the `E2EKeys.login*` anchors the
// integration suite and the nightly E2E legs drive, and the localized
// `_friendlyMessage` mapping that keeps a raw GoTrue exception off the screen.
// Canonicalising the URL onto the stamped `SignInScreen` instead would have
// dropped all three, so the stamped twin — unreachable the moment `/sign-in`
// stopped building it — was REMOVED rather than left as a pane no user can
// open. `assert-responsive-coverage.mjs`'s floor moved 16 → 15 in the same
// change, which is exactly the deliberate, noisy way that guard requires a
// surface to leave the app.
// ═══════════════════════════════════════════════════════════════════════════

export 'router/navigator_key.dart';
export 'router/router_provider.dart';
