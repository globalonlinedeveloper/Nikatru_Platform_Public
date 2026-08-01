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
/// 🔴 THE STORE IDS ARE CONSTRUCTOR STATE, AND SUPPLYING THEM IS NOT OPTIONAL
/// ON THREE PLATFORMS. `openStoreListing()` used to be called with no arguments
/// at all, which on iOS, macOS and Windows is a guaranteed
/// `ArgumentError.checkNotNull` inside the pinned plugin — in release builds,
/// not merely under an assert — swallowed by this class's own `catch`. See
/// [StoreIdRequirement].
class InAppReviewPrompter implements core.ReviewPrompter {
  InAppReviewPrompter({
    iar.InAppReview? plugin,
    ReviewCapabilities? capabilities,
    String? appStoreId,
    String? microsoftStoreId,
  })  : _plugin = plugin ?? iar.InAppReview.instance,
        _caps = capabilities ??
            ReviewCapabilities.forPlatform(defaultTargetPlatform,
                isWeb: kIsWeb),
        // Empty and absent are the SAME STATE here on purpose: the value
        // arrives from a `--dart-define` that defaults to '', so treating ''
        // as configured would hand the plugin a blank id and reproduce the
        // silent failure with extra steps.
        _appStoreId = (appStoreId?.isEmpty ?? true) ? null : appStoreId,
        _microsoftStoreId =
            (microsoftStoreId?.isEmpty ?? true) ? null : microsoftStoreId;

  final iar.InAppReview _plugin;
  final ReviewCapabilities _caps;
  final String? _appStoreId;
  final String? _microsoftStoreId;

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
  ///
  /// Every branch returns a DIFFERENT [core.StoreListingOutcome], because the
  /// three ways this can decline are three different problems: a platform with
  /// no store, a build with no id for the store it has, and a store that threw.
  /// Collapsing them back into `Future<void>` is what made the defect invisible.
  @override
  Future<core.StoreListingOutcome> openStoreListing() async {
    if (!_caps.canOpenStoreListing) {
      return core.StoreListingOutcome.unavailable;
    }
    if (_missingRequiredId) {
      // OWNER-GATED, NOT BROKEN: the id does not exist until the app is
      // registered with that store. Reported rather than thrown, and never
      // reported as success.
      return core.StoreListingOutcome.notConfigured;
    }
    try {
      await _plugin.openStoreListing(
        appStoreId: _appStoreId,
        microsoftStoreId: _microsoftStoreId,
      );
      return core.StoreListingOutcome.opened;
    } catch (_) {
      // As above: a failed pleasantry never surfaces to the user — but it is
      // no longer indistinguishable from having worked.
      return core.StoreListingOutcome.failed;
    }
  }

  bool get _missingRequiredId => switch (_caps.requiredStoreId) {
        StoreIdRequirement.none => false,
        StoreIdRequirement.appStore => _appStoreId == null,
        StoreIdRequirement.microsoftStore => _microsoftStoreId == null,
      };
}
