/// THE GDPR Art 21 OBJECTION HAS EXACTLY ONE HOME, AND THIS FILE IS THE ROAD
/// FROM IT TO THE GATE — [ADR 040 · research/44 rung 4].
///
/// `promo_gate.dart` ships with the warning this file answers, verbatim:
///
/// > ⚠️ ONE OBJECTION, NOT TWO … either the rail becomes the source of truth and
/// > this latch is set from it, or the reverse. Two stores for one legal
/// > obligation is how a person objects on the rail, the card keeps rendering
/// > off a stale latch, and both halves report healthy.
///
/// **The rail won.** `ConsentPurpose.promo` is the source of truth, for three
/// reasons that are all about machinery this repo already built and tested:
///
///   1. the artifact trail is APPEND-ONLY and server-verified, so an objection
///      leaves evidence that it was made, when, and against which policy
///      version — a private boolean in a gate record leaves none, and Art 21
///      objections are exactly the kind of thing a regulator asks to see;
///   2. the withdrawal surface, the server route (`POST /v1/consent`) and the
///      erasure reach all key on `purpose`, so a new purpose inherits them
///      unchanged — a second store would need all three built again;
///   3. GPC. `ConsentController` already suppresses signal-governed purposes
///      live on every consult, so an automated objection (Art 21(5)) reaches the
///      gate through this file with no extra wiring. A latch persisted in the
///      gate record could not see a signal that toggles mid-session at all.
///
/// So [PromoGateState.suppressed] is a PROJECTION, never an independent fact.
/// Nothing in the app writes it; [PromoObjection.applyTo] computes it from the
/// rail on every consult, in BOTH directions — which is what makes withdrawing
/// an objection work, and what stops a stale `true` from outliving it.
///
/// 🔴 WITH ONE ASYMMETRY, AND IT IS THE DIFFERENCE BETWEEN THIS FILE BEING
/// FAIL-CLOSED AND FAIL-OPEN. The rail has three states and only two of them are
/// answers. `granted` and `denied` are things a person did; `unknown` is the
/// absence of a reading, and [ConsentController.hydrate] returns it for a store
/// that threw, an artifact that would not parse, AND a device where nobody ever
/// touched the control — three facts one value cannot tell apart.
///
/// Projecting `unknown` as "not objected" would therefore let a transient disk
/// failure CLEAR a persisted objection: the caller is instructed to persist
/// [PromoGateDecision.state], so the cleared latch is written back and the
/// objection is gone from disk for good. Measured on this exact code before the
/// fix — a store whose `read` throws, against a record holding
/// `suppressed: true`, produced `PromoGateVerdict.show` and a state to persist
/// carrying `suppressed: false`.
///
/// So the latch is cleared by an EXPLICIT withdrawal only
/// (`ConsentStatus.granted`), never by the mere absence of a `denied`. Read as a
/// sentence: the rail says whether promotion must stop **now**; the record
/// remembers that it was once told to stop, and only the person can take that
/// back. `promo_gate.dart` already reads a corrupt latch as TRUE for the same
/// reason — *"corruption in a field whose whole job is to say 'stop' is read as
/// 'stop'"* — and a rail that could not be read is corruption one layer up.
library;

import '../analytics/consent.dart';
import 'promo_gate.dart';

/// Reads the objection off the consent rail and projects it onto a gate record.
///
/// Deliberately a tiny object rather than three loose functions: the projection
/// and the decision must not be separable, because the failure mode is a caller
/// that reads the rail, forgets to apply it, and gets a decision made against a
/// persisted record that never knew about the objection. [decide] is the whole
/// call site, and it does both.
class PromoObjection {
  const PromoObjection(this.consent);

  /// The rail. The SAME controller the analytics decision uses — one hydrated
  /// consent seam per app, not one per purpose.
  final ConsentController consent;

  /// True when promotional processing must stop for this person right now.
  ///
  /// Reads through [ConsentController.permits], so the opt-OUT direction lives
  /// in exactly one place: `unknown` (never touched the control) permits,
  /// because the surface runs on legitimate interest and is lawful until
  /// objected to; `denied` forbids; a live GPC signal reads as `denied` without
  /// a stored artifact.
  bool get objected => !consent.permits(ConsentPurpose.promo);

  /// **Has this person affirmatively said promotion may resume?**
  ///
  /// The only thing that may clear a persisted objection — see the library
  /// comment. `granted` is a decision somebody made; `unknown` is a reading that
  /// did not happen, and [ConsentController.hydrate] returns it for a throwing
  /// store and an unparseable artifact as readily as for a fresh device.
  ///
  /// Read off [ConsentController.statusOf] rather than [ConsentController
  /// .permits] on purpose: `permits` collapses `unknown` into `granted` for a
  /// legitimate-interest purpose, which is right for "may we process **now**"
  /// and catastrophic for "may we forget that they objected".
  bool get withdrawn =>
      consent.statusOf(ConsentPurpose.promo) == ConsentStatus.granted;

  /// [stored] with its `suppressed` latch set from the rail — both ways.
  ///
  /// 🔴 BOTH WAYS IS THE LOAD-BEARING HALF. Applying only the `true` direction
  /// would leave a person who withdrew their objection permanently suppressed by
  /// a value nothing can clear, and `PromoGateState` offers no `copyWith` for
  /// the latches precisely so that nobody clears one by accident. Here it is not
  /// an accident: the rail said so, and the rail is the record.
  ///
  /// 🔴 BUT THE CLEARING DIRECTION NEEDS AN ANSWER, NOT MERELY THE ABSENCE OF A
  /// REFUSAL. `objected` is `!permits`, and `permits` reads an UNREADABLE rail as
  /// permission; routing the clear through it made a failed disk read erase a
  /// persisted objection and write the erasure back. So: raise on [objected],
  /// clear on [withdrawn], and otherwise leave the record exactly as it was.
  ///
  /// Returns [stored] ITSELF when the latch already agrees with the rail, which
  /// is the ordinary case on every rebuild. `PromoGateDecision` documents that a
  /// hold is `identical` to the state passed in so a caller may skip the write;
  /// allocating here unconditionally broke that promise through the one path
  /// callers are told to use, and `PromoGateState` defines no `==` for them to
  /// fall back on.
  ///
  /// The other latch, `dismissed`, is untouched. Withdrawing an objection
  /// re-enables the surface; it does not un-answer a card the person closed.
  PromoGateState applyTo(PromoGateState stored) {
    final bool suppressed = objected || (stored.suppressed && !withdrawn);
    if (suppressed == stored.suppressed) return stored;
    return suppressed ? stored.objectToPromotion() : stored.withdrawObjection();
  }

  /// Project, then judge. **The only sanctioned way to reach
  /// [PromoGate.decide] from an app.**
  ///
  /// A caller that reached the gate directly would be deciding from a record
  /// whose `suppressed` field is whatever was last written to disk — which is
  /// the two-stores defect wearing one store's clothes.
  ///
  /// 🔴 "SANCTIONED" IS ENFORCED, NOT ASSERTED. This sentence used to be the
  /// whole enforcement, and it lasted one increment: the next chip built a card
  /// on `ref.watch(promoGateProvider).decide(stored, …)`. It is now
  /// `tooling/ci/assert-consent-withdrawal-surface.mjs` limb 5, which fails the
  /// build for any `.decide(` on a promo gate in an app root that does not name
  /// `PromoObjection` in the same expression — negative-tested against that
  /// exact shape, in both the app and the brick.
  PromoGateDecision decide(
    PromoGate gate,
    PromoGateState stored, {
    required DateTime now,
    required bool featureEnabled,
    required bool hasContent,
  }) =>
      gate.decide(
        applyTo(stored),
        now: now,
        featureEnabled: featureEnabled,
        hasContent: hasContent,
      );

  /// The artifact to record when a person uses the stop-offers control.
  ///
  /// `granted` is inverted on purpose and the naming deserves a sentence,
  /// because "granted: false" reading as "objected: true" is the kind of double
  /// negative that gets flipped in a refactor. The rail's field means *may this
  /// purpose be processed* — so an objection is `granted: false` and a
  /// withdrawal of that objection is `granted: true`. One artifact shape for
  /// both bases; the meaning of the field never changes, only which way silence
  /// falls (see [ConsentBasis]).
  static bool grantedForObjection({required bool objected}) => !objected;
}
