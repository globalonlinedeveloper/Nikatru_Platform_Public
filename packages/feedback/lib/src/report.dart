import 'package:flutter/material.dart';

/// The closed category set `POST /v1/feedback` accepts
/// (services/feedback/src/lib/limits.ts `CATEGORIES`). The wire name is the
/// enum's name.
enum FeedbackCategory {
  bug,
  crash,
  billing,
  accessibility,
  translation,
  question,
  other;

  String get wire => name;
}

/// What the app says about itself in a report. Every field is a build or
/// platform fact, never a device identifier or model.
class FeedbackAppInfo {
  const FeedbackAppInfo({
    required this.appId,
    required this.appVersion,
    required this.build,
    required this.channel,
    required this.platform,
    this.osVersion,
  });

  /// The catalogue id, e.g. `subscriptiontracker`.
  final String appId;
  final String appVersion;
  final String build;

  /// The release channel the build was made for (`web`, `android-play`, …).
  final String channel;

  /// `android`, `ios`, `macos`, `windows`, `linux` or `web`.
  final String platform;

  /// The OS version string the platform reports, or null.
  final String? osVersion;
}

/// The device CLASS — phone, tablet or desktop — from the window's logical
/// size: what a layout bug needs, and nothing that identifies a device.
enum DeviceClass { phone, tablet, desktop }

DeviceClass deviceClassOf(Size logical) {
  final double shortest = logical.shortestSide;
  if (shortest < 600) return DeviceClass.phone;
  if (shortest < 900) return DeviceClass.tablet;
  return DeviceClass.desktop;
}

/// The diagnostics a report carries, exactly as the preview shows them.
///
/// [logs] is null unless the person ticked the logs box: then, and only then,
/// the payload has a `logs` key (lane feedback-intake, Do 3).
/// [crashEventId] is the crash sink's id of the last crash, which exists only
/// where crash reporting was consented to.
class FeedbackDiagnostics {
  const FeedbackDiagnostics({
    required this.app,
    required this.deviceClass,
    required this.locale,
    required this.textScale,
    required this.theme,
    this.errorCodes = const <String>[],
    this.crashEventId,
    this.logs,
  });

  /// Reads the window, text scale, theme and locale off [context].
  factory FeedbackDiagnostics.of(
    BuildContext context, {
    required FeedbackAppInfo app,
    List<String> errorCodes = const <String>[],
    String? crashEventId,
    List<String>? logs,
  }) {
    final MediaQueryData mq = MediaQuery.of(context);
    return FeedbackDiagnostics(
      app: app,
      deviceClass: deviceClassOf(mq.size),
      locale: Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en',
      textScale: mq.textScaler.scale(1),
      theme: Theme.of(context).brightness == Brightness.dark ? 'dark' : 'light',
      errorCodes: errorCodes,
      crashEventId: crashEventId,
      logs: logs,
    );
  }

  final FeedbackAppInfo app;
  final DeviceClass deviceClass;
  final String locale;
  final double textScale;

  /// `light` or `dark`, as the person sees the app.
  final String theme;
  final List<String> errorCodes;
  final String? crashEventId;
  final List<String>? logs;

  /// The wire form: no null value, and no `logs` key without the opt-in.
  Map<String, Object?> toJson() => <String, Object?>{
    'appVersion': app.appVersion,
    if (app.build.isNotEmpty) 'build': app.build,
    'channel': app.channel,
    'platform': app.platform,
    if (app.osVersion != null) 'osVersion': app.osVersion,
    'deviceClass': deviceClass.name,
    'locale': locale,
    'textScale': double.parse(textScale.toStringAsFixed(2)),
    'theme': theme,
    'errorCodes': errorCodes.take(20).toList(),
    if (crashEventId != null) 'crashEventId': crashEventId,
    if (logs != null) 'logs': logs,
  };

  FeedbackDiagnostics withLogs(List<String>? value) => FeedbackDiagnostics(
    app: app,
    deviceClass: deviceClass,
    locale: locale,
    textScale: textScale,
    theme: theme,
    errorCodes: errorCodes,
    crashEventId: crashEventId,
    logs: value,
  );
}

/// Whether a report may be sent: it says what happened.
bool canSubmitReport(String description) => description.trim().isNotEmpty;

/// The report JSON exactly as `POST /v1/feedback` reads it
/// (services/feedback/src/lib/report.ts). The contact address rides ONLY with
/// "you may reply to me", and only when signed out (the Worker takes a
/// signed-in person's address from their session).
Map<String, Object?> buildReport({
  required String idempotencyKey,
  required FeedbackCategory category,
  required String description,
  required String steps,
  required FeedbackDiagnostics diagnostics,
  required bool reply,
  required bool notifyFixed,
  required String contactEmail,
  required int elapsedMs,
  String surface = 'app',
}) {
  final String typedEmail = contactEmail.trim();
  return <String, Object?>{
    'idempotencyKey': idempotencyKey,
    'appId': diagnostics.app.appId,
    'surface': surface,
    'category': category.wire,
    'description': description.trim(),
    if (steps.trim().isNotEmpty) 'steps': steps.trim(),
    'diagnostics': diagnostics.toJson(),
    'consent': <String, Object?>{'reply': reply, 'notifyFixed': notifyFixed},
    if (reply && typedEmail.isNotEmpty) 'contactEmail': typedEmail,
    'elapsedMs': elapsedMs,
  };
}
