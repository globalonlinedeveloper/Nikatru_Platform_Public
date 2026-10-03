// ─────────────────────────────────────────────────────────────────────────────
// "Report a problem" (lane feedback-intake): packages/feedback's one host for
// this app — the outbox over the app's own store, the shared intake
// (services/feedback), the signed-in session when there is one. The screenshot
// is taken under the root RepaintBoundary app.dart already mounts for the store
// capture (E2EKeys.storeFrame), so the app root is not edited. Hermetic, like
// every transport here, when the backend is not live.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/widgets.dart' show BuildContext;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart'
    show DioFeedbackTransport;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_feedback/nikatru_feedback.dart'
    show FeedbackHost, buildFeedbackHost, openReportProblem;

export 'package:nikatru_feedback/nikatru_feedback.dart'
    show reportProblemLabelOf;

import '../../core/app_config.dart';
import '../../core/e2e_keys.dart';
import '../analytics_providers.dart' show keyValueStoreProvider;
import 'auth.dart' show authTokenProvider, authUserProvider;
import 'links.dart' show externalLinks;

final Provider<FeedbackHost> feedbackHostProvider = Provider<FeedbackHost>(
  (ref) => buildFeedbackHost(
    appId: AppConfig.appId,
    appVersion: AppConfig.appVersion,
    channel: AppConfig.releaseChannel,
    store: ref.watch(keyValueStoreProvider.future),
    transport: AppConfig.isBackendLive
        ? DioFeedbackTransport()
        : const core.UnavailableFeedbackTransport(),
    accessToken: ref.watch(authTokenProvider),
    userId: () => ref.read(authUserProvider).value?.id,
    supportEmail: AppConfig.supportEmail,
    openMail: externalLinks.open,
    boundaryKey: E2EKeys.storeFrame,
  ),
);

/// The Help card's "Report a problem" action: packages/feedback's page.
Future<void> openFeedback(BuildContext context, WidgetRef ref) =>
    openReportProblem(context, ref.read(feedbackHostProvider));
