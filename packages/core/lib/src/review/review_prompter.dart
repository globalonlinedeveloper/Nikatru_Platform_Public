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

/// What happened when the app tried to open the store listing.
///
/// 🔴 IT RETURNS A VALUE BECAUSE THE FAILURE IS OTHERWISE INVISIBLE. The listing
/// call used to be `Future<void>` wrapped in a bare `catch (_) {}`, and the
/// pinned plugin throws `ArgumentError.checkNotNull` in a RELEASE build when the
/// store id it needs is absent (`appStoreId` on iOS/macOS, `microsoftStoreId` on
/// Windows). So the one deliberate "rate us" tap a user ever makes did nothing,
/// silently, on three of the four store platforms — and no caller could tell.
/// A no-op is acceptable; a no-op indistinguishable from success is not.
enum StoreListingOutcome {
  /// The platform was asked to show the listing. Whether the store app actually
  /// came to the foreground is not something any of them report back.
  opened,

  /// This platform has no store listing to open (Linux, web, Fuchsia).
  unavailable,

  /// The platform HAS a listing and needs an id to address it, and this build
  /// carries none. Owner-gated: the id does not exist until the app is
  /// registered with that store, so this is a configuration gap and must read
  /// as one rather than as a store that refused.
  notConfigured,

  /// The platform was asked and threw. Best-effort by nature — nothing is
  /// surfaced to the user — but the caller can at least count it.
  failed,
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
  ///
  /// The STORE IDS are not parameters here on purpose: they are a property of
  /// the build, not of the tap, so they are configured once where the concrete
  /// prompter is constructed. What this method owes its caller is the
  /// [StoreListingOutcome] — the difference between "the store opened" and
  /// "this build has no id for that store" is the whole reason it is typed.
  Future<StoreListingOutcome> openStoreListing();
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
  Future<StoreListingOutcome> openStoreListing() async =>
      StoreListingOutcome.unavailable;
}
