// SECTION I of the spine — the store-review gate. Re-exported from
// `../providers.dart`.
//
// 🔴 `.requestReview()` MAY BE CALLED FROM THIS FILE AND NOWHERE ELSE:
// `tooling/ci/assert-seams-wired.mjs`'s `review_prompt` exclusive trigger names
// this exact path as the one permitted call site.

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart'
    show InAppReviewPrompter;

import '../../core/app_config.dart';
import '../analytics_providers.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION I · STORE REVIEW ([pipeline C-13])
//
// ⚠️ THE ONE-CHANCE PROBLEM. iOS ignores requests beyond roughly three a year
// WITHOUT SAYING SO: the call returns normally and nothing appears. So asking at
// a bad moment does not annoy anybody — it silently spends the app's remaining
// requests on a dialog nobody sees. Everything below exists to make that
// unspendable by accident.
// ═════════════════════════════════════════════════════════════════════════════

const String _reviewStateKey = 'nikatru.review_gate';

/// The real prompter. Platform reality is DECLARED ([pipeline C-7]): the adapter
/// consults [ReviewCapabilities] before touching the plugin, because
/// `in_app_review` has no Linux or web implementation and reaching it there
/// throws.
///
/// 🔴 THE STORE IDS ARE NOT OPTIONAL DECORATION. Constructed bare, the listing
/// call reaches `ArgumentError.checkNotNull` inside the plugin on iOS, macOS and
/// Windows — in release, swallowed by the adapter's catch — so the only route to
/// a store on Windows silently did nothing. Empty defines mean "not registered
/// with that store yet" and the adapter reports that as
/// `core.StoreListingOutcome.notConfigured`.
final Provider<core.ReviewPrompter> reviewPrompterProvider =
    Provider<core.ReviewPrompter>(
      (ref) => InAppReviewPrompter(
        appStoreId: AppConfig.appStoreId,
        microsoftStoreId: AppConfig.microsoftStoreId,
      ),
    );

/// The timing rule. A provider rather than a constant so a test can shorten the
/// thresholds instead of simulating four months of calendar time.
final Provider<core.ReviewGate> reviewGateProvider = Provider<core.ReviewGate>(
  (ref) => const core.ReviewGate(),
);

/// The persisted history plus the decision, in one place.
class ReviewPromptController extends Notifier<core.ReviewGateState> {
  /// 🔴 EVERY MUTATOR AWAITS THIS, and it is not tidiness — the property test
  /// caught the bug. The other persisted controllers here guard hydration with a
  /// `_userChose` flag, which is right for a CHOICE: last writer wins, and the
  /// user is the last writer. These are COUNTERS, and for a counter that rule
  /// loses data. `recordLaunch()` fired from the app's first frame while
  /// `_hydrate()` was still in flight, incremented the EMPTY default to 1, and
  /// then hydration completed and overwrote it with the stored 20 — so the
  /// launch went uncounted and the write was silently discarded.
  Future<void>? _hydrating;

  @override
  core.ReviewGateState build() {
    _hydrating = _hydrate();
    return const core.ReviewGateState();
  }

  /// Wait for the disk read, but never let its failure become the caller's.
  Future<void> _ensureHydrated() async {
    try {
      await _hydrating;
    } catch (_) {
      // Unreadable store ⇒ carry on as a fresh install.
    }
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(_reviewStateKey);
      if (raw == null || raw.isEmpty) return;
      state = core.ReviewGateState.fromJson(
        jsonDecode(raw) as Map<String, Object?>,
      );
    } catch (_) {
      // Unreadable or corrupt ⇒ behave like a fresh install. Never throw at
      // launch, and never fail OPEN into asking.
    }
  }

  Future<void> _persist(core.ReviewGateState next) async {
    state = next;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_reviewStateKey, jsonEncode(next.toJson()));
    } catch (_) {
      // Best-effort: a failed write only means the counter restarts.
    }
  }

  /// Count this launch, and stamp the install date the first time we see it.
  Future<void> recordLaunch({DateTime? now}) async {
    await _ensureHydrated();
    final DateTime at = now ?? DateTime.now().toUtc();
    await _persist(
      state.copyWith(
        launches: state.launches + 1,
        firstLaunch: state.firstLaunch ?? at,
      ),
    );
  }

  /// The user has asked not to be asked again. Never cleared by the chassis.
  Future<void> suppress() async {
    await _ensureHydrated();
    await _persist(state.copyWith(suppressed: true));
  }

  /// Ask, but only if the gate agrees.
  ///
  /// Returns what actually happened, so a caller can tell "we asked" from "the
  /// platform cannot" from "not yet" — three outcomes that are identical from a
  /// bool and need completely different responses.
  Future<core.ReviewRequestOutcome> maybeAsk({DateTime? now}) async {
    await _ensureHydrated();
    final core.ReviewPrompter prompter = ref.read(reviewPrompterProvider);
    // The DEVICE half, asked before the calendar half: on Android this depends
    // on the Play Store being installed, which no build-time fact can tell us.
    final bool canAsk = await prompter.isAvailable();
    final core.ReviewGateVerdict verdict = ref
        .read(reviewGateProvider)
        .decide(
          state,
          now: now ?? DateTime.now().toUtc(),
          platformCanAsk: canAsk,
        );
    if (verdict == core.ReviewGateVerdict.platformCannotAsk) {
      return core.ReviewRequestOutcome.unavailable;
    }
    if (verdict != core.ReviewGateVerdict.ask) {
      return core.ReviewRequestOutcome.gated;
    }
    // Recorded BEFORE the call, deliberately. The platform never tells us
    // whether anything was drawn, so a crash or a kill between the request and
    // the write would let the app ask again on the next launch — and the second
    // ask is the one the store silently discards.
    await _persist(
      state.copyWith(
        lastAskedAt: now ?? DateTime.now().toUtc(),
        timesAsked: state.timesAsked + 1,
      ),
    );
    await prompter.requestReview();
    return core.ReviewRequestOutcome.requested;
  }
}

final NotifierProvider<ReviewPromptController, core.ReviewGateState>
reviewPromptProvider =
    NotifierProvider<ReviewPromptController, core.ReviewGateState>(
      ReviewPromptController.new,
    );
