import 'dart:async';

import 'package:sentry_flutter/sentry_flutter.dart';

import 'telemetry_client.dart';

/// [TelemetryClient] backed by the Sentry SDK (pointed at GlitchTip).
///
/// Together with `telemetry_bootstrap.dart` this is the only place in the
/// monorepo allowed to import `sentry_flutter`. PII scrubbing happens
/// centrally in the `beforeSend` hook installed by `TelemetryBootstrap`, so
/// everything captured here is scrubbed before it leaves the device.
class SentryTelemetryClient implements TelemetryClient {
  /// Const-constructible; all state lives in the Sentry SDK singleton.
  const SentryTelemetryClient();

  @override
  Future<void> captureException(
    Object error, {
    StackTrace? stackTrace,
  }) async {
    await Sentry.captureException(error, stackTrace: stackTrace);
  }

  @override
  Future<void> captureMessage(String message) async {
    await Sentry.captureMessage(message);
  }

  @override
  void addBreadcrumb(String message, {String? category}) {
    // Fire-and-forget by design: breadcrumbs must never block app code.
    unawaited(
      Sentry.addBreadcrumb(Breadcrumb(message: message, category: category)),
    );
  }

  @override
  void setUser({String? id}) {
    // Only an opaque id is ever forwarded - never email/phone/name (PII).
    // Note: configureScope returns FutureOr<void>, so it cannot be wrapped
    // in unawaited(); the result is intentionally discarded.
    Sentry.configureScope(
      (scope) => scope.setUser(id == null ? null : SentryUser(id: id)),
    );
  }

  @override
  Future<void> close() async {
    await Sentry.close();
  }
}
