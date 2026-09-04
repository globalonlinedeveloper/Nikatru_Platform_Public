// ─────────────────────────────────────────────────────────────────────────────
// SUBLY STATE SPINE ([ADR 037] productization, re-stamp).
//
// 🔴 READ THIS BEFORE EDITING. This file is the CHASSIS SPINE (the brick's
// `lib/state/providers.dart`) with Subly's own app state merged UNDER it — not
// over it. The rule the merge followed, in one line:
//
//     the chassis owns the plumbing; Subly owns its product.
//
// Three things are structural rather than stylistic, and undoing any of them
// re-creates a measured defect:
//
//  1. 🔴 `analytics_providers.dart` DOES NOT MOVE, AND IS RE-EXPORTED FROM HERE.
//     Ten symbols exist in BOTH the chassis spine and Subly's
//     `lib/state/analytics_providers.dart`. Eight files in this app import BOTH
//     files, so declaring them twice is a hard compile error ("the name X is
//     defined in the libraries …"), not a style problem. The file itself cannot
//     move: `tooling/ci/assert-seams-wired.mjs:481` and
//     `tooling/ci/assert-policy-archive.mjs:64` BOTH read
//     `kPrivacyPolicyVersion` out of that exact path with a regex, so a
//     re-export shim there fails two guards. The fix is the other direction —
//     this file imports it and re-exports the ten, so both import paths resolve
//     to ONE declaration and Dart reports no ambiguity.
//
//  2. 🔴 THE DELETION CALL STAYS POINTED AT THE SHARED PLATFORM WORKER.
//     The chassis sends `requestServerDeletion` to `restClientProvider`
//     (this app's own API). Subly sends it to [platformRestClientProvider] —
//     the SHARED Worker — because that Worker is the erasure ENTRY POINT and
//     owns the ordering (precondition → platform_db → relay to subly-api →
//     identity LAST). Taking the chassis version here would have the client own
//     an ordering it must not own. [ADR 027]. Live version kept verbatim.
//
//  3. 🔴 `notificationServiceProvider` IS THE CHASSIS ONE (`core.NotificationService`).
//     Subly's own `flutter_local_notifications` fork moved to
//     [sublyNotificationServiceProvider]. The name had to go to the chassis: the
//     stamped `RemindersEnabledController` below reads it three times, the
//     stamped `chassis_properties_test.dart` overrides it by that name, and
//     `tooling/ci/assert-stamp-properties.mjs:1083` maps it to the
//     `reminder-intent-persisted` property — a mapping `apps/subly` is exempt
//     from today (`EXEMPT_APPS`, :104) and will NOT be after Phase 5.
//
// ⚠️ THE CONFIG IMPORT IS `../core/app_config.dart` — the de-duplicated union
// at the STAMP's path. `../core/config/app_config.dart` no longer exists.
// ─────────────────────────────────────────────────────────────────────────────

// 📁 THE SPINE IS A DIRECTORY NOW, AND THIS FILE IS ITS BARREL. Every symbol
// below is declared in exactly one file under `state/providers/`, grouped by
// the capability it serves, and re-exported here — so every existing
// `import '.../state/providers.dart';` keeps resolving exactly what it did
// before, and two capabilities can be edited at once without touching one
// file. Nothing moved package, nothing was renamed, and no behaviour changed.
//
// ⚠️ THE CAPABILITY EXPORTS COME FIRST, AND THE ORDER IS LOAD-BEARING RATHER
// THAN ALPHABETICAL. The `analytics_providers.dart` re-export below carries a
// `///` doc comment. A `///` block standing before the FIRST directive in a
// file is read as a LIBRARY doc comment, and `dangling_library_doc_comments`
// then reports it — one new analyzer finding, in a change whose whole claim is
// that it produces none. Putting a directive above it keeps the comment
// attached to the export it explains.

export 'providers/analytics_envelope.dart';
export 'providers/auth.dart';
export 'providers/config.dart';
export 'providers/content_pack.dart';
export 'providers/force_update.dart';
export 'providers/legal.dart';
export 'providers/notifications.dart';
export 'providers/persistence.dart';
export 'providers/preferences.dart';
export 'providers/promo.dart';
export 'providers/review.dart';
export 'providers/routing.dart';
export 'providers/subscriptions.dart';

/// 🔴 THE AMBIGUITY FIX — see note 1 in the header. These names are declared
/// by the chassis spine AND by `analytics_providers.dart`. They are declared
/// ONCE, over there, and surfaced here so that a file importing either path
/// reaches the same declaration.
///
/// The list is EXPLICIT rather than a blanket `export 'analytics_providers.dart';`
/// so that the set is auditable: if the chassis grows an eleventh colliding
/// symbol, this list is where the collision has to be acknowledged rather than
/// absorbed. `kInstallIdKey` is deliberately NOT here — it is Subly-only and
/// reachable through the direct import that every live consumer already
/// carries. (`backendLiveProvider` used to be named alongside it; it was deleted
/// 2026-08-10 with the `ConsentGate` that was its only reader.)
export 'analytics_providers.dart'
    show
        analyticsConsentProvider,
        analyticsEnabledProvider,
        analyticsProvider,
        applyConsentDecision,
        applyLegalAcceptance,
        consentControllerProvider,
        consentDecidedProvider,
        consentTransportProvider,
        eventTransportProvider,
        installIdProvider,
        kLegalVersions,
        kPrivacyPolicyVersion,
        kTermsVersion,
        keyValueStoreProvider,
        privacySignalProvider,
        promoObjectedProvider,
        promoObjectionKnownProvider,
        recordAnalyticsConsent,
        recordPromoObjection;
