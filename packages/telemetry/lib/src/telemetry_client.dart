/// Facade over the error-reporting backend.
///
/// App code programs against this interface only. The Sentry SDK is an
/// implementation detail of `nikatru_telemetry` and must not leak out.
abstract class TelemetryClient {
  /// Reports [error] (with optional [stackTrace]) to the backend.
  Future<void> captureException(Object error, {StackTrace? stackTrace});

  /// Reports a plain text [message] to the backend.
  Future<void> captureMessage(String message);

  /// Records a lightweight breadcrumb for debugging context.
  void addBreadcrumb(String message, {String? category});

  /// Associates subsequent events with an opaque user [id].
  ///
  /// Only an opaque id is accepted here by design - never email, phone or
  /// name (PII). Passing `null` clears the current user.
  void setUser({String? id});

  /// Flushes pending events and shuts the client down.
  Future<void> close();
}
