// The in-app promotional card — [research/44 §7 rung 3]. It stood inside
// SECTION I (store review) and is a separate capability: a different surface, a
// different config key, a different declaration consequence, and a GDPR Art 21
// objection latch of its own. Re-exported from `../providers.dart`.

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../analytics_providers.dart';

// ─────────────────────────────────────────────────────────────────────────────
// THE IN-APP PROMOTIONAL CARD — [research/44 §7 rung 3].
//
// 🔴 SAME-APP ONLY, AND THAT IS A DECLARATION FACT, NOT A PRODUCT PREFERENCE.
// This surface promotes THE APP THE USER IS ALREADY IN. It matches none of
// Google Play's three ads-declaration YES triggers — the house-ad trigger is
// worded "to promote MY OTHER APPS" — so it carries no ads label and puts no
// "Contains ads" badge on a listing (research/44 V2). A cross-app version is a
// DIFFERENT component with a DIFFERENT config key and a different declaration
// consequence, and the two must never share a widget or a flag.
//
// ⚠️ EVERYTHING HERE IS DORMANT BY DEFAULT, HONESTLY. The on-switch is
// `features.promo_card_enabled`, and an ABSENT key reads false
// (`AppConfig.feature` defaults to `orElse: false`), so a stamped app that has
// never reached the network — and every stamped app today — renders nothing.
// The dormancy is not a placeholder: the card's open path is proven in
// `test/chassis_properties_test.dart` by serving the flag, which is the only
// thing that distinguishes this from the four capabilities that shipped
// fail-closed with no proven open path ([pipeline C-6]).
// ─────────────────────────────────────────────────────────────────────────────

/// `features.promo_card_enabled` — the campaign's on-switch, named once.
const String kPromoCardFeature = 'promo_card_enabled';

/// `flags.promo_card_variant` — which wording this install sees.
const String kPromoCardVariantFlag = 'promo_card_variant';

const String _promoCardStateKey = 'nikatru.promo_card';

/// The frequency rule. A provider rather than a constant so a test can shorten
/// the thresholds instead of simulating a fortnight of calendar time — the same
/// reason [reviewGateProvider] is one.
final Provider<core.PromoGate> promoGateProvider = Provider<core.PromoGate>(
  (ref) => const core.PromoGate(),
);

/// The persisted promo history: how often this card has been shown, when, and
/// the two latches.
///
/// 🔴 THE LATCHES ARE NOT PREFERENCES. `dismissed` is the close control's answer
/// and `suppressed` is the GDPR Art 21 objection, which is ABSOLUTE — "the data
/// subject shall have the right to object at any time", after which "the
/// personal data shall no longer be processed for such purposes". Neither is
/// reachable from `copyWith`, by construction in [core.PromoGateState]; this
/// controller adds the other half of that promise, which is that nothing here
/// clears them either. There is deliberately no `reset()`.
///
/// 🔴 AN [AsyncNotifier], AND THE `Notifier` IT REPLACES SHIPPED TWO REAL
/// DEFECTS THAT ONLY THE TYPE COULD CLOSE. The first version published
/// `const core.PromoGateState()` synchronously and hydrated behind it, so for
/// the length of one disk read the card's caller could not tell "this person
/// never objected" from "we have not looked yet" — and those two must produce
/// opposite behaviour. Measured on the real tree before the change, with a
/// store whose read lands 40 ms after the config read: a record holding
/// `"suppressed": true` still rendered a promotional card at t+0, t+5, t+10 and
/// t+20 ms, and only came off screen at t+60. Every widget test hid that window
/// behind `pumpAndSettle()`.
///
/// Making the value an [AsyncValue] moves the barrier from a comment into the
/// type: `valueOrNull == null` covers *loading* and *unreadable* in one
/// expression, and the caller cannot decide without a record because there is
/// no record to decide from. Art 21(3) has no grace period in it, so neither
/// does this.
///
/// Counters, not a choice — so every mutator awaits hydration, exactly as
/// [ReviewPromptController] does. That distinction cost a lost launch on every
/// cold start when it was got wrong there: a counter incremented before the
/// disk read lands is overwritten by the stored value the moment it does.
class PromoCardStateController extends AsyncNotifier<core.PromoGateState> {
  /// Did the record we are holding actually come off disk?
  ///
  /// 🔴 THE SECOND DEFECT, AND THE WORSE ONE: A CORRUPT RECORD WAS NOT ONLY
  /// IGNORED, IT WAS OVERWRITTEN. `jsonDecode` and the map cast used to sit
  /// inside one `catch` that fell back to the empty default, so an interrupted
  /// write — `'{"shown_count":0,"dismissed":false,"suppressed":true'`, with the
  /// objection plainly in the bytes — read as a fresh device, showed the card,
  /// and then `markShown` rewrote the key as `"suppressed":false`. Proven on
  /// the real tree; the objection was gone from disk after one launch, and a
  /// truncated write is the ordinary way a mobile key/value store fails.
  ///
  /// [core.PromoGateState.fromJson] already falls closed on every FIELD it can
  /// read at all ("present but not `false`" reads as a set latch) — but it only
  /// gets to do that for bytes that parse. What lands here is the case where
  /// they do not, and a record we could not read is not a record that says no
  /// one objected. So the read fails to [AsyncError], which the card renders as
  /// nothing, and this flag blocks every write that could clobber the bytes we
  /// failed to read.
  bool _recordRead = false;

  @override
  Future<core.PromoGateState> build() async {
    _recordRead = false;
    final core.KeyValueStore kv = await ref.read(keyValueStoreProvider.future);
    final String? raw = await kv.read(_promoCardStateKey);
    if (raw == null || raw.isEmpty) {
      // A device that has never run this app: the ONE state that may be shown a
      // card, and the only one an absent key is allowed to mean.
      _recordRead = true;
      return const core.PromoGateState();
    }
    final Object? decoded = jsonDecode(raw);
    if (decoded is! Map<String, Object?>) {
      // A non-object top level (`'["suppressed"]'`) used to reach the same
      // silent fallback as a truncated one. Named as a failure instead.
      throw FormatException('promo record is not a JSON object', raw);
    }
    final core.PromoGateState stored = core.PromoGateState.fromJson(decoded);
    _recordRead = true;
    return stored;
  }

  /// The record, once the read has settled — and never the read's exception.
  ///
  /// A failed hydration is not a caller's problem to handle; it is a reason to
  /// do nothing, which every caller here does by consulting [_recordRead].
  Future<core.PromoGateState> _settled() async {
    try {
      return await future;
    } catch (_) {
      return state.valueOrNull ?? const core.PromoGateState();
    }
  }

  Future<void> _persist(core.PromoGateState next) async {
    state = AsyncValue<core.PromoGateState>.data(next);
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_promoCardStateKey, jsonEncode(next.toJson()));
    } catch (_) {
      // Best-effort. A failed write on a SHOW means at most one extra
      // impression; a failed write on a latch is the one that matters, and it
      // is why the latch is also held in memory for the life of the process.
    }
  }

  /// Record that the card was really put on screen.
  ///
  /// ⚠️ CALLED ON RENDER, NOT ON DECIDE. `PromoGate.decide` is pure and
  /// idempotent, so deciding twice from the same stored state says `show`
  /// twice; the write is the moment of truth. Persisting here — and only here —
  /// is what keeps the card from vanishing mid-frame under its own cooldown.
  ///
  /// 🔴 IT DOES NOT WRITE [decided] STRAIGHT THROUGH. The counter is incremented
  /// against the HYDRATED record rather than the one the decision saw — the same
  /// distinction [ReviewPromptController] records, where treating a counter like
  /// a choice cost one uncounted launch on every cold start — and a latch that
  /// arrived from storage WINS, abandoning this write. An impression is worth
  /// one counter tick; it is not worth a legal obligation.
  ///
  /// 🔴 AND IT WRITES NOTHING AT ALL OVER A RECORD WE COULD NOT READ. That is
  /// [_recordRead]'s whole job: an impression counter is the least important
  /// thing on this key, and it must never be the thing that destroys the most
  /// important one.
  Future<void> markShown(core.PromoGateState decided) async {
    final core.PromoGateState current = await _settled();
    if (!_recordRead) return;
    if (current.dismissed || current.suppressed) return;
    await _persist(
      current.copyWith(
        shownCount: current.shownCount + 1,
        lastShownAt: decided.lastShownAt,
      ),
    );
  }

  /// The user closed the card. One-way.
  ///
  /// Also refuses to write over an unread record: `dismissed: true` is a WEAKER
  /// latch than `suppressed: true`, so writing it over bytes that may have held
  /// an objection would trade a legal obligation for a preference. Unreachable
  /// in practice — a card the user can close is a card that rendered, and a
  /// failed read renders nothing — which is exactly why it is asserted rather
  /// than assumed.
  Future<void> dismiss() async {
    final core.PromoGateState current = await _settled();
    if (!_recordRead) return;
    await _persist(current.dismiss());
  }

  /// The user objected to promotional processing (GDPR Art 21). Ends every
  /// promotion on this device, not just this campaign.
  ///
  /// ⚠️ THE ONE MUTATOR THAT WRITES EVEN WHEN THE READ FAILED, and the asymmetry
  /// is deliberate. `suppressed: true` is the MAXIMAL latch — the gate consults
  /// it before the dismissal and before every counter — so the record this
  /// writes is at least as restrictive as anything the unreadable bytes could
  /// have encoded. Refusing the write is the only option that could lose an
  /// objection, and losing an objection is the one outcome Art 21(3) forbids
  /// outright.
  ///
  /// ⬜ NOT YET SURFACED, AND SAID OUT LOUD RATHER THAN LEFT TO BE NOTICED.
  /// research/44 rung 4 is the objection surface — a `promo` purpose on the
  /// existing `ConsentPurpose` rail, presented in/beside the first card per
  /// Art 21(4). Until that lands the latch is honoured everywhere it is read
  /// and set from nowhere, so this method has no UI caller. That is a real gap
  /// and it belongs to rung 4; what it is NOT is a reason to leave the latch
  /// out of the primitive, because retrofitting an objection across fifty
  /// shipped apps is the expensive path.
  Future<void> objectToPromotion() async {
    final core.PromoGateState current = await _settled();
    await _persist(current.objectToPromotion());
  }
}

final AsyncNotifierProvider<PromoCardStateController, core.PromoGateState>
promoCardStateProvider =
    AsyncNotifierProvider<PromoCardStateController, core.PromoGateState>(
      PromoCardStateController.new,
    );
