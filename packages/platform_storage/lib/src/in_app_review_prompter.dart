import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:in_app_review/in_app_review.dart' as iar;
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'review_capabilities.dart';

/// The real [core.ReviewPrompter] — [pipeline C-13].
///
/// 🔴 IT LIVES HERE, NOT IN A PACKAGE OF ITS OWN, and that was adjudicated
/// rather than chosen ([pipeline C-4], recorded in
/// `tooling/capability-register.json`): a capability name is not a reason to
/// spawn a package. Followed loosely, the remaining gap list would produce
/// pubspecs for share, deep-links, review, purchases and connectivity — five
/// more analysis_options, five more test harnesses and five more CI surfaces,
/// forever, for one founder. `share_plus`, `app_links` and `in_app_review` all
/// land in this existing adapter.
///
/// EVERY METHOD IS GATED ON THE MATRIX FIRST. `in_app_review` has no Linux or
/// web implementation, so calling it there throws `MissingPluginException` —
/// a crash, at the exact moment the app was trying to be pleasant. Checking
/// [ReviewCapabilities] before touching the plugin is what makes this safe on
/// all six targets.
class InAppReviewPrompter implements core.ReviewPrompter {
  InAppReviewPrompter(
      {iar.InAppReview? plugin, ReviewCapabilities? capabilities})
      : _plugin = plugin ?? iar.InAppReview.instance,
        _caps = capabilities ??
            ReviewCapabilities.forPlatform(defaultTargetPlatform,
                isWeb: kIsWeb);

  final iar.InAppReview _plugin;
  final ReviewCapabilities _caps;

  /// What this platform can do — exposed so a caller can explain itself rather
  /// than silently doing nothing.
  ReviewCapabilities get capabilities => _caps;

  /// 🔴 BOTH HALVES MATTER. The matrix says whether the plugin implements
  /// anything here at all; `isAvailable()` says whether THIS DEVICE can actually
  /// service it — on Android that means the Play Store being installed, which no
  /// build-time fact can tell us. Skipping either one produces a confident
  /// "yes" on a device with no store.
  @override
  Future<bool> isAvailable() async {
    if (!_caps.canPrompt) return false;
    try {
      return await _plugin.isAvailable();
    } catch (_) {
      // A plugin that throws here must read as "cannot ask", never as an error
      // the user sees. Nothing was spent.
      return false;
    }
  }

  @override
  Future<void> requestReview() async {
    if (!_caps.canPrompt) return;
    try {
      await _plugin.requestReview();
    } catch (_) {
      // Best-effort by nature: neither store tells us whether anything was
      // drawn, so there is no success to report and no failure worth surfacing.
    }
  }

  /// The Windows row, and the honest answer to a "rate us" button the user
  /// pressed deliberately.
  @override
  Future<void> openStoreListing() async {
    if (!_caps.canOpenStoreListing) return;
    try {
      await _plugin.openStoreListing();
    } catch (_) {
      // As above.
    }
  }
}
