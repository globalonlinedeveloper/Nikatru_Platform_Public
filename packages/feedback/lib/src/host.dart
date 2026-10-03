import 'dart:async';

import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/widgets.dart' show Key;
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart' show RecentActivity;

import 'outbox.dart';
import 'report.dart';
import 'report_page.dart';

/// The platform name a report carries: `web`, or the target platform's name.
String feedbackPlatformName() => kIsWeb ? 'web' : defaultTargetPlatform.name;

/// The ONE [FeedbackHost] an app builds (lane feedback-intake), so the brick's
/// wiring is a single call: the outbox over the app's own (origin-scoped)
/// store, the telemetry ring's error codes, crash id and scrubbed breadcrumbs
/// (packages/telemetry `RecentActivity`), and the app's identity. It also
/// sends whatever an earlier session left queued, once.
FeedbackHost buildFeedbackHost({
  required String appId,
  required String appVersion,
  required String channel,
  required Future<KeyValueStore> store,
  required FeedbackTransport transport,
  required Future<String?> Function() accessToken,
  required String? Function() userId,
  required String supportEmail,
  required Future<void> Function(Uri mail) openMail,
  String build = '',
  Key? boundaryKey,
  RecentActivity? activity,
}) {
  final RecentActivity ring = activity ?? RecentActivity.instance;
  final FeedbackOutbox outbox = FeedbackOutbox(store: store, transport: transport, accessToken: accessToken);
  String owner() => userId() ?? kAnonymousOwner;
  unawaited(outbox.flush(owner: owner()).catchError((Object _) => <String, FeedbackSendResult>{}));
  return FeedbackHost(
    app: FeedbackAppInfo(
      appId: appId,
      appVersion: appVersion,
      build: build,
      channel: channel,
      platform: feedbackPlatformName(),
    ),
    outbox: outbox,
    owner: owner,
    signedIn: () => userId() != null,
    supportEmail: supportEmail,
    openMail: openMail,
    errorCodes: () => ring.errorCodes,
    crashEventId: () => ring.lastCrashEventId,
    readLogs: ring.breadcrumbs,
    boundaryKey: boundaryKey,
  );
}
