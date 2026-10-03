import 'package:flutter/foundation.dart' show TargetPlatform, kDebugMode;
import 'package:flutter/widgets.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../integrity/device_integrity_gate.dart';
import 'web_semantics.dart';

// The boot step's one app-side input, re-exported so a stamped `main()` keeps
// ONE chassis import (the delegation resolvers refuse a file with two).
export '../integrity/device_integrity_gate.dart'
    show DeviceIntegrityRecorder, integrityRecorder;

/// THE BOOT ORDER EVERY STAMPED APP INHERITS — [ADR 067] decision 2.
///
/// 🏗️ THIS IS THE BODY OF THE BRICK'S `main()`, MOVED. What stayed there is
/// what a package with no third-party dependency cannot carry, and it is a short
/// list: the `TelemetryConfig` const (`nikatru_telemetry`), the Supabase
/// initialisation (`nikatru_auth_supabase`), the local-notification adapter's
/// construction (`nikatru_notifications`), and the `ProviderScope` with its one
/// override (`flutter_riverpod`). Each arrives here as a value or a callback.
///
/// 🔴 THE ORDER IS THE WHOLE POINT, AND IT IS LOAD-BEARING AT FOUR PLACES. It
/// was 110 lines of comment in a per-app template, which means fifty apps would
/// each have inherited a copy of it and any one of them could have re-ordered it
/// without anything noticing. It is one function now, and
/// `tooling/ci/assert-stamp-properties.mjs` still anchors the three calls the
/// brick must make (`initNikatruAuth`, `secureStore: FlutterSecureStore(`,
/// `notificationServiceProvider.overrideWithValue(notifications)`) in the
/// stamped `main.dart`, because those are claims about what the APP supplies.
///
/// The five steps, in the order they must happen:
///
/// 1. **Bind, turn the web screen-reader tree on, then register the vendored
///    licences.**
///    🔴 ST-Y5 (audit D26) — EVERY STAMPED WEB APP SHIPPED NO SCREEN-READER
///    TREE. Flutter web compiles the semantics DOM only once a client asks for
///    it; until then a reader finds a canvas and a hidden "Enable
///    accessibility" button. `apps/subscriptiontracker` fixed it in its own
///    `main()`, and nothing reached the brick. [enableWebSemantics] is called
///    straight after the binding exists and BEFORE [runGuarded], so the first
///    frame — and the error screen, which is a surface too — carries a tree.
///    It is a no-op off web and idempotent (one handle per process), so an app
///    that also calls it cannot stack a second handle.
///    `tooling/ci/assert-a11y-primitives.mjs` limb 3 holds the order.
///
///    🔴 [pipeline K-10/K-11] THE LICENCE CONDITION EVERY STAMPED APP WAS
///    BREACHING. The assets that ship in the bundle but that Flutter's NOTICES
///    collector never sees — today the CC BY 4.0 Material Icons font, which
///    arrives from the SDK artifact cache rather than as a Dart package.
///    Measured: the shipped NOTICES has ZERO hits for its licence, so the font
///    was distributed with its attribution condition UNMET, and an unmet CC BY
///    condition means the licence does not apply. That is a breach at the first
///    store submission, not untidiness. The shared half already existed and was
///    tested (`packages/design_system/.../vendored_asset_licences.dart`); the
///    brick simply never called it, so `apps/subscriptiontracker` was compliant and every app
///    the factory stamped was not.
///
///    Registered BEFORE `runApp` because `LicenseRegistry` is read lazily by
///    `LicensePage` — the surface Settings offers — and a registration that
///    lands after a user has already opened that page shows them an incomplete
///    list. It is idempotent, so a hot restart, a second call, or a stamped app
///    that also calls it cannot stack duplicate entries.
///
/// 2. **Enter the telemetry zone** via [runGuarded]. With no DSN the chassis
///    client is a NoOp and the runner runs directly; a `GLITCHTIP_DSN` via
///    `--dart-define` enables GlitchTip/Sentry with PII scrubbing.
///    `sentry_flutter` is isolated inside `packages/telemetry`, so the brick
///    passes this in rather than this package importing it.
///
/// 3. **Replace Flutter's default build-error widget before the first frame**
///    — [pipeline C-13]. The default is the grey/yellow box in release and the
///    red screen in debug; shipping either to a user looks like a broken app and
///    leaks widget internals. One line at startup, impossible to retrofit across
///    fifty shipped apps. The copy is the design system's own last-resort
///    fallback: this runs before any `BuildContext` exists, so there is no
///    `Localizations` to read, and an error during the FIRST build is exactly
///    what it covers.
///
/// 3½. **Check the device and the artefact** — ⏱ 2026-10-01 (row
///    O-APPS-GOV-IN-VAPT-CHECKLIST) [checkDeviceIntegrity]: root detection and
///    the runtime signature check. 🔴 BEFORE THE NOTIFICATION ADAPTER AND
///    IDENTITY, because a copy someone re-signed must reach NO data: when the
///    signer is not one of [releaseChannel]'s complete pins,
///    [modifiedCopyBlocked] runs `TamperedBuildApp` and this function returns —
///    no adapter, no identity, no app. A rooted device is recorded and runs on (the notice and the
///    re-auth gate live in the app, `RootedDeviceNoticeHost` and
///    `confirmSensitiveAction`). [integrityProbe] is the app's
///    `platformDeviceIntegrityProbe()` — this package declares no plugin.
///    `tooling/ci/assert-runtime-signer-check.mjs` holds the order.
///
/// 4. **Initialise the ONE notification adapter** — 🔴 [13]T-9 THE INBOUND
///    HALF, AND THE ORDER IS LOAD-BEARING. One adapter, constructed once by the
///    caller and `init()`ed once HERE, before the first frame, and then handed
///    to the tree as a provider override by the caller. Three things make that
///    the whole wiring rather than a tidy-up:
///     1. `init()` is where the plugin's tap callback is registered, and the
///        taps are delivered on THAT instance's own broadcast stream. A second
///        instance — which is exactly what the provider's default body builds —
///        exposes a stream that is silent forever. Working code, no error, no
///        tap.
///     2. The platform plugin is a process singleton, so the LAST `initialize`
///        call is the one whose callback survives. Doing it here and overriding
///        the provider means the reminder rail's own `svc.init()`
///        (`RemindersEnabledController.resyncOnStart`, from the app root's
///        post-frame callback) hits `_initialized` and returns early instead of
///        re-pointing every future tap at a stream nobody listens to.
///     3. A cold start FROM a notification is the case that cannot be fixed
///        later: the OS delivers it at launch, so the registration has to
///        already exist. A post-frame `init()` is too late by a frame.
///
///    ⚠️ IT MUST NOT ASK FOR PERMISSION, and it does not: `init()` loads the
///    timezone database and registers the callback, nothing else. The ask stays
///    on the enable path, because Android 13+ turns a SECOND denial into
///    USER_FIXED — permanently non-promptable — so a launch-time prompt can burn
///    the channel for the life of the install.
///    `tooling/ci/assert-stamp-properties.mjs` walks this boot path and fails
///    the build if an ask ever appears on it.
///
/// 5. **Initialise identity, then run** — 🔴 [pipeline C-15 / G-43] (absent from
///    origins.lock.json by construction — G-43 is a MASTER_PLAN §3 chassis-gap
///    id, a different register from the pipeline ids; see Private/pre-minimal-2026-09-08:MASTER_PLAN.md)
///    IDENTITY,
///    BEFORE THE FIRST FRAME. Nothing in the brick used to initialise the SDK at
///    all, while the auth provider returns the real repository the moment
///    `SUPABASE_URL`/`SUPABASE_ANON_KEY` are supplied — the exact configuration
///    the stamped README tells the owner to use. The router resolves that
///    provider through `refreshListenable` while it is being built, so the app
///    died at LAUNCH on `Supabase.instance` (AssertionError in debug,
///    LateInitializationError in release), before a screen rendered. It was
///    invisible to every test because widget tests take no `--dart-define`s.
///    [initialiseIdentity] is a callback because the SDK, the secure store and
///    the app's own config all live outside this package.
/// Runs [appRunner] inside the app's crash-reporting zone. The brick supplies
/// `TelemetryBootstrap.init(config, appRunner: appRunner)`.
///
/// ⚠️ A TYPEDEF RATHER THAN AN INLINE FUNCTION TYPE, AND THE REASON IS
/// MECHANICAL. `tooling/ci/chassis-delegation.mjs`'s `publicApiOf` matches a
/// top-level declaration with `\([^;()]*\)` — a parameter list that CONTAINS
/// parentheses is not a declaration it can see. Written inline, this file's only
/// public name was invisible, the resolver answered `{ lost }`, and every guard
/// that follows the delegation reported COVERAGE LOST on a perfectly wired
/// tree. Loud, not silent — but the repair belongs on the declaration, because a
/// looser regex over there is a looser regex for all fifteen importers.
typedef TelemetryZoneRunner =
    Future<void> Function(Future<void> Function() appRunner);

/// Initialises the identity SDK, if this app has a backend at all.
typedef IdentityInitialiser = Future<void> Function();

Future<void> bootstrapNikatru({
  required core.NotificationService notifications,
  required TelemetryZoneRunner runGuarded,
  required IdentityInitialiser initialiseIdentity,
  required VoidCallback run,
  required String appId,
  required String releaseChannel,
  required core.DeviceIntegrityProbe? integrityProbe,
  DeviceIntegrityRecorder? recordIntegrity,
  bool isDebugBuild = kDebugMode,
  TargetPlatform? platform,
}) async {
  // Step 0, before anything can log: `debugPrint` writes to the device log in a
  // RELEASE build, so it is a no-op there (design_system release_logging.dart).
  silenceDebugPrintInRelease();
  WidgetsFlutterBinding.ensureInitialized();
  enableWebSemantics();
  registerVendoredAssetLicences();

  await runGuarded(() async {
    AppErrorScreen.install();
    if (await modifiedCopyBlocked(
      appId: appId,
      releaseChannel: releaseChannel,
      integrityProbe: integrityProbe,
      record: recordIntegrity,
      isDebugBuild: isDebugBuild,
      platform: platform,
    )) {
      return;
    }
    await notifications.init();
    await initialiseIdentity();
    run();
  });
}
