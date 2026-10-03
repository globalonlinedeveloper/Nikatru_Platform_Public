// ─────────────────────────────────────────────────────────────────────────────
// "Report a problem" (lane feedback-intake): packages/feedback's one host for
// this app — the outbox over the app's own store, the shared intake
// (the platform Worker's POST /v1/feedback), the signed-in session when there is one. The screenshot
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

import 'package:nikatru_help/nikatru_help.dart' show openHelpCentre;

export 'package:nikatru_feedback/nikatru_feedback.dart'
    show reportProblemLabelOf;
export 'package:nikatru_help/nikatru_help.dart' show helpCentreLabelOf;

import '../../core/app_config.dart';
import '../../core/e2e_keys.dart';
import '../../help/help_index.g.dart';
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
        ? DioFeedbackTransport(platformBaseUrl: AppConfig.platformBaseUrl)
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

/// The Help card's "Help" action (lane help-search): packages/help's centre,
/// whose "Ask us" opens the same report sheet with category question.
Future<void> openHelp(BuildContext context, WidgetRef ref) => openHelpCentre(
  context,
  host: ref.read(feedbackHostProvider),
  appId: AppConfig.appId,
  indexTable: kHelpIndexJson,
  sourceLocale: kHelpSourceLocale,
  openUrl: (String url) => externalLinks.open(Uri.parse(url)),
);
