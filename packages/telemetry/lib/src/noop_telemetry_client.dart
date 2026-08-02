import 'telemetry_client.dart';

/// Telemetry client that intentionally does nothing.
///
/// Returned by `TelemetryBootstrap.init` when no DSN is configured (local
/// dev, tests, telemetry deliberately switched off). Lets call sites stay
/// unconditional - no `if (telemetryEnabled)` sprinkled through app code.
class NoOpTelemetryClient implements TelemetryClient {
  /// Const-constructible; carries no state.
  const NoOpTelemetryClient();

  @override
  Future<void> captureException(
    Object error, {
    StackTrace? stackTrace,
  }) async {}

  @override
  Future<void> captureMessage(String message) async {}

  @override
  void addBreadcrumb(String message, {String? category}) {}

  @override
  void setUser({String? id}) {}

  @override
  Future<void> close() async {}
}
