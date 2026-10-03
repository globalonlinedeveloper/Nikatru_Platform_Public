import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:http/http.dart' as http;
import 'package:sentry_flutter/sentry_flutter.dart';

import 'noop_telemetry_client.dart';
import 'pii_scrubber.dart';
import 'sentry_telemetry_client.dart';
import 'telemetry_client.dart';
import 'telemetry_config.dart';
import 'telemetry_rate_bound.dart';
import 'web_envelope_transport.dart';

/// One-shot initializer wiring [TelemetryConfig], Sentry and the PII
/// scrubber together.
class TelemetryBootstrap {
  TelemetryBootstrap._();

  static const PiiScrubber _scrubber = PiiScrubber();

  /// Initializes telemetry and returns the client the app should use.
  ///
  /// * When `config.enabled` is false (empty DSN): runs [appRunner] directly
  ///   and returns a [NoOpTelemetryClient]. No Sentry code path is touched.
  /// * Otherwise: initializes `sentry_flutter` with a `beforeSend` hook that
  ///   scrubs PII from every outgoing event, then returns a
  ///   [SentryTelemetryClient].
  static Future<TelemetryClient> init(
    TelemetryConfig config, {
    Future<void> Function()? appRunner,
  }) async {
    if (!config.enabled) {
      if (appRunner != null) {
        await appRunner();
      }
      return const NoOpTelemetryClient();
    }

    await SentryFlutter.init(
      optionsCallback(config),
      appRunner: appRunner,
    );

    return const SentryTelemetryClient();
  }

  /// The bound every app's events share, per process
  /// ([TelemetryRateBound.defaultMaxEvents] a minute).
  static final TelemetryRateBound _defaultRateBound = TelemetryRateBound();

  /// THE SENTRY-PROTOCOL HALF of the options: what every event carries and
  /// what every event passes through, on any [SentryOptions] — the app's
  /// [SentryFlutterOptions] in [optionsCallback], and a plain [SentryOptions]
  /// under `runTelemetryClientConformance` (lib/testing.dart), so the suite
  /// drives THIS wiring rather than a copy of it.
  ///
  /// `beforeSend` is the one door every event leaves through, whichever path
  /// captured it (the client, an uncaught Flutter error, an isolate error): it
  /// first applies the rate bound — an event over it is dropped, never sent and
  /// never thrown — and then [scrubEvent]. [rateBound] is injectable for tests;
  /// apps share [_defaultRateBound].
  static void configureCore(
    SentryOptions options,
    TelemetryConfig config, {
    TelemetryRateBound? rateBound,
  }) {
    final bound = rateBound ?? _defaultRateBound;
    options.dsn = config.dsn;
    options.release = config.release;
    options.environment = config.environment;
    // 🔴 SET ONLY WHEN DECLARED, AND THE `if` IS THE WHOLE POINT.
    // [pipeline 9]R-7, web limb. A source-map artifact is stored under
    // (release, dist) and matched against the event's (release, dist), so
    // an EMPTY string is not "no dist" — it is a dist value that matches
    // no bundle, which is strictly worse than sending none. Two open
    // production issues were unreadable on 2026-09-03 for want of the
    // upload; sending a dist nobody uploaded under would leave them
    // unreadable with the upload in place, and look configured while doing
    // it. Apps that declare a channel pass it (`AppConfig.releaseChannel`);
    // a developer build declares nothing and sends nothing.
    if (config.dist.isNotEmpty) {
      options.dist = config.dist;
    }
    options.tracesSampleRate = config.tracesSampleRate;
    // Belt and braces: never attach default PII (ip address, ...).
    options.sendDefaultPii = false;
    options.beforeSend =
        (event, hint) => bound.tryAcquire() ? scrubEvent(event) : null;
  }

  /// The options every app gets. A function of [config] and of whether this is
  /// a web build, so a test can drive the WEB branch on the VM.
  @visibleForTesting
  static FlutterOptionsConfiguration optionsCallback(
    TelemetryConfig config, {
    bool isWeb = kIsWeb,
    http.Client? webClient,
  }) {
    return (options) {
      // The Sentry-protocol half, shared with the conformance suite
      // (lib/testing.dart): DSN, release, environment, the PII scrub and the
      // rate bound. Only the FLUTTER-only switches follow it here.
      configureCore(options, config);
      // 🔴 SESSIONS ARE OFF, AND THAT IS AN HONESTY FIX, NOT A SAVING.
      // [pipeline 11]E-10. sentry_flutter defaults this ON, so the SDK was
      // computing and shipping session start/end envelopes to a server that
      // has no concept of them: GlitchTip does not implement Sentry's release
      // health, so nothing on the receiving end ever stored one. The visible
      // consequence is worse than the wasted bytes — "crash-free sessions" is
      // the metric every crash-health conversation reaches for, and leaving
      // this on implies the number is available when it can never be
      // computed. Turning it off makes the gap explicit: crash health here
      // has to be defined against a denominator we actually hold (`app_open`
      // rows in `events`), not against a session count nobody records.
      options.enableAutoSessionTracking = false;
      // 🔴 THE NATIVE LAYER IS OFF ON EVERY TARGET, AND THAT IS A DECISION.
      // ⏱ 2026-10-01 · full review AA-08. The pinned sentry_flutter (9.26.0)
      // defaults this ON, and the channel register said `native: false` on
      // every row while nothing here turned it off — so native crashes were
      // probably being SENT. Two things make such an event worse than none:
      // nothing uploads the symbols that would make it readable (no dSYM, PDB,
      // NDK or R8 mapping upload exists), and it never passes `beforeSend`
      // (configureCore), because the native SDK sends it itself — so it reaches
      // GlitchTip outside the PII scrub the privacy policy promises. Off, the
      // register's `native: false` is true: the JVM handler and ANR watchdog
      // on Android, KSCrash on iOS/macOS (which also drops the native device
      // context from Dart events there), and sentry-native on Windows/Linux
      // are never installed. The Android NDK signal handler is NOT reached by
      // this flag; each app's AndroidManifest switches it off with
      // `io.sentry.ndk.enable`. tooling/ci/assert-seams-wired.mjs holds the
      // register, this line and the manifest to one answer. Turning it back on
      // needs the native symbol uploads AND a native-side scrub first.
      options.enableNativeCrashHandling = false;
      // LAST, because the transport reads `options.dsn` when it is built.
      if (isWeb) {
        useHttpTransportOnWeb(options, client: webClient);
      }
    };
  }

  /// 🔴 ON WEB, SEND EVENTS WITH THE DART SDK'S HTTP TRANSPORT, NOT THE BROWSER
  /// SDK FROM SENTRY'S CDN. ⏱ 2026-09-12 (W5).
  ///
  /// sentry_flutter 9.26.0 (and every release through 9.30.0) injects
  /// `https://browser.sentry-cdn.com/<ver>/bundle.tracing.min.js` from a `const`
  /// (`lib/src/web/sentry_js_bundle.dart`), so every visitor's browser contacted a
  /// third party the privacy notice does not name, and there is no option to
  /// re-point it. Turning `autoInitializeNativeSdk` off stops the injection, but
  /// ON ITS OWN IT IS AN OUTAGE: `SentryFlutter.init` has already installed
  /// `JavascriptTransport`, which hands envelopes to a JS client that is only
  /// created by the skipped integration — no script, no events, no error. This
  /// callback runs after that assignment, so replacing the transport here is
  /// what keeps crash reports flowing: [WebEnvelopeTransport], which POSTs to
  /// the DSN host (already in the app CSP `connect-src`; GlitchTip answers the
  /// CORS preflight for `x-sentry-auth`, measured 2026-09-12) using only the
  /// SDK's public API — the SDK's own `HttpTransport` is not exported, and
  /// reaching it would need a suppression in a package every app links.
  ///
  /// What the web build gives up, stated rather than implied: the browser SDK's
  /// window-level JS error handlers, and debug-id images on events. Dart errors
  /// are still captured by sentry_flutter's Flutter/zone integrations, and
  /// GlitchTip resolves web source maps by (release, file name) as well as by
  /// debug id (tooling/ops/upload-web-sourcemaps.mjs header).
  @visibleForTesting
  static void useHttpTransportOnWeb(
    SentryFlutterOptions options, {
    http.Client? client,
  }) {
    options.autoInitializeNativeSdk = false;
    options.transport = WebEnvelopeTransport(options, client: client);
  }

  /// Scrubs PII from every user-influenced field of [event]: the message and
  /// its template, breadcrumb messages, exception values, and the three
  /// MAP-BEARING surfaces - `tags`, `extra` and `breadcrumb.data`.
  ///
  /// 🔴 THE MAPS WERE UNSCRUBBED UNTIL 2026-08-01 (full-corpus triage #12).
  /// This hook covered only the three flat string fields, and
  /// `PiiScrubber.scrubMap` - written for exactly this job - had zero non-test
  /// callers, so it was dead code that a passing test suite made look alive.
  /// Anything an app attached as a tag or as breadcrumb data (an account hint,
  /// an msisdn, a support note) went to GlitchTip verbatim, breaking the
  /// promise `sites/nikatru/privacy.html` makes about crash logs. Every new
  /// user-controlled surface added to an event MUST be routed through here;
  /// this is the only place the policy is enforced.
  ///
  /// sentry-dart 9.x protocol classes are mutable, so the event is mutated
  /// in place and returned. (Returning `null` would drop the event.)
  ///
  /// Public only so `test/telemetry_bootstrap_test.dart` can drive it with a
  /// hand-built [SentryEvent]; the sole production caller is the `beforeSend`
  /// hook installed above. Nothing outside this package may call it.
  @visibleForTesting
  static SentryEvent scrubEvent(SentryEvent event) {
    // Message (captureMessage payloads).
    final message = event.message;
    if (message != null) {
      message.formatted = _scrubber.scrubText(message.formatted);
      final template = message.template;
      if (template != null) {
        message.template = _scrubber.scrubText(template);
      }
    }

    // Searchable tag values. Tag values are always plain strings, but the walk
    // still goes through scrubMap so there is exactly ONE redaction path.
    final tags = event.tags;
    if (tags != null) {
      event.tags = Map<String, String>.from(_scrubber.scrubMap(tags));
    }

    // Arbitrary structured payload. `extra` is deprecated in the SDK in favour
    // of contexts, but it is still serialized and still reaches the server, so
    // it is still our problem.
    // ignore: deprecated_member_use
    final extra = event.extra;
    if (extra != null) {
      // ignore: deprecated_member_use
      event.extra = _scrubber.scrubMap(extra);
    }

    // Breadcrumb messages AND their structured data.
    final breadcrumbs = event.breadcrumbs;
    if (breadcrumbs != null) {
      for (final crumb in breadcrumbs) {
        final crumbMessage = crumb.message;
        if (crumbMessage != null) {
          crumb.message = _scrubber.scrubText(crumbMessage);
        }
        final crumbData = crumb.data;
        if (crumbData != null) {
          crumb.data = _scrubber.scrubMap(crumbData);
        }
      }
    }

    // Exception values, e.g. Exception('otp to 9876543210 failed').
    final exceptions = event.exceptions;
    if (exceptions != null) {
      for (final exception in exceptions) {
        final value = exception.value;
        if (value != null) {
          exception.value = _scrubber.scrubText(value);
        }
      }
    }

    return event;
  }

  /// The client [init] returns for [config], without initialising anything:
  /// for a caller that runs INSIDE `appRunner` and so cannot await [init]'s
  /// result — today the device-integrity record (O-APPS-GOV-IN-VAPT-CHECKLIST).
  /// Both clients are const and stateless, so this is the same client.
  static TelemetryClient clientFor(TelemetryConfig config) => config.enabled
      ? const SentryTelemetryClient()
      : const NoOpTelemetryClient();
}
