/// The store-review seam — [pipeline C-13].
///
/// Pure Dart, provider-free, like every other seam in `core`. The concrete
/// implementation wraps `in_app_review` and lives in `packages/platform_storage`
/// ([pipeline C-4] adjudicated that: `share_plus`, `app_links` and
/// `in_app_review` all land in the existing adapter package rather than earning
/// one each — six pubspecs, six analysis_options, six CI surfaces, forever, for
/// one founder).
library;

/// What happened when the app asked. Deliberately NOT "did the user leave a
/// review": no platform tells us that, and a seam that pretended to know would
/// be inventing its own success metric.
enum ReviewRequestOutcome {
  /// The OS was asked to show its rating prompt. It may or may not have drawn
  /// anything — both stores throttle this and neither reports which happened.
  requested,

  /// The platform cannot ask at all (Linux, web) or the store is absent
  /// (Android without Play). Nothing was shown and nothing was spent.
  unavailable,

  /// The gate refused: too early, too recent, or already asked enough times.
  gated,
}

/// Asks the platform's own store-review UI to appear.
///
/// 🔴 THE ONE CHANCE PROBLEM. iOS shows this at most a handful of times a year
/// per user and silently ignores the rest, and Android enforces its own
/// undocumented quota. So a request that lands at a bad moment is not a
/// dismissed dialog — it is the app's whole opportunity, spent. That is why the
/// decision of WHEN lives in [ReviewGate] rather than at the call site.
abstract interface class ReviewPrompter {
  /// Whether this platform can show the in-app rating prompt at all.
  ///
  /// Asked fresh rather than cached: on Android it depends on the Play Store
  /// being present on the device, which is a property of the handset, not of
  /// the build.
  Future<bool> isAvailable();

  /// Ask the OS to show its rating prompt.
  Future<void> requestReview();

  /// Open the store listing instead — the fallback where the inline prompt does
  /// not exist but a store page does (Windows), and the honest answer to a
  /// "rate us" button the user pressed deliberately.
  Future<void> openStoreListing();
}

/// The safe default, and the value a stamped app is born with.
///
/// ⚠️ [pipeline C-6] A NO-OP DEFAULT IS ONLY SAFE IF SOMETHING ELSE PROVES THE
/// OPEN PATH. Four seams shipped fail-closed with no consumer and no test went
/// red, because refusing is the correct behaviour when nothing is configured.
/// Here the open path is proven by the property test driving a recording
/// prompter through [ReviewGate] and asserting the request really arrives.
class NoOpReviewPrompter implements ReviewPrompter {
  const NoOpReviewPrompter();

  @override
  Future<bool> isAvailable() async => false;

  @override
  Future<void> requestReview() async {}

  @override
  Future<void> openStoreListing() async {}
}
