import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:sentry_flutter/sentry_flutter.dart';

import 'noop_telemetry_client.dart';
import 'pii_scrubber.dart';
import 'sentry_telemetry_client.dart';
import 'telemetry_client.dart';
import 'telemetry_config.dart';

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
      (options) {
        options.dsn = config.dsn;
        options.release = config.release;
        options.environment = config.environment;
        options.tracesSampleRate = config.tracesSampleRate;
        // Belt and braces: never attach default PII (ip address, ...).
        options.sendDefaultPii = false;
        options.beforeSend = (event, hint) => scrubEvent(event);
      },
      appRunner: appRunner,
    );

    return const SentryTelemetryClient();
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
}
