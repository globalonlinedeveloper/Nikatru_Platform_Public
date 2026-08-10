/// What the user agreed to, and when the app has to ask again.
///
/// Adopted as auth-increment riders from the consent-placement research
/// (research/43, 2026-08-09 night; SPLIT verdict): an UNTICKED, BLOCKING terms
/// clickwrap at sign-up, plus a MATERIAL-CHANGE re-acceptance interstitial at
/// sign-in. Declined in the same verdict, and therefore not modelled here:
/// pre-ticked boxes and uncheckable "optional" consents (Planet49 / EDPB, DPDP
/// Rules 2025, CPRA dark-pattern rules), and gating sign-in on an OPTIONAL
/// consent (GDPR Art 7(4) conditionality).
///
/// 🔴 RE-ACCEPTANCE IS A MATERIAL-CHANGE FLAG, NOT A VERSION BUMP. That
/// distinction is the whole reason [LegalVersions] holds hand-edited constants
/// instead of, say, a build number: bumping it puts an interstitial in front of
/// every signed-in user in the world, so it must be an act somebody performs on
/// purpose when the terms materially change — never a side effect of shipping.
library;

/// The pair of documents a NIKATRU account is held under.
///
/// TWO versions rather than one, because they change for different reasons and
/// on different days: the privacy policy version is already load-bearing (it
/// rides on every consent artifact and `assert-seams-wired.mjs` fails the build
/// if it drifts from `data-policy-version` on the published page), while the
/// terms version moves when the contract does.
class LegalVersions {
  const LegalVersions({required this.terms, required this.privacy});

  final String terms;
  final String privacy;

  /// The single string an acceptance is RECORDED under.
  ///
  /// 🔴 A COMPOSITE, AND IT IS NOT A CONVENIENCE. The acceptance has to be
  /// comparable later against whatever the app ships THEN, and the question
  /// "have the terms OR the policy moved since?" cannot be answered by storing
  /// one of them. Storing only the privacy version — the tempting shortcut,
  /// since `ConsentArtifact.policyVersion` is already that field's name — would
  /// make a terms-only change invisible, which is precisely the change class
  /// this whole mechanism exists for.
  ///
  /// It rides in `ConsentArtifact.policyVersion` (a 64-char column server-side;
  /// `terms/2026-08-01+privacy/2026-08-01` is 36) so there is ONE store and ONE
  /// append-only audit trail rather than a second parallel record that can
  /// drift from it.
  String get stamp => 'terms/$terms+privacy/$privacy';

  @override
  String toString() => stamp;
}

/// Whether the signed-in user must be asked to accept again.
///
/// [acceptedStamp] is what was recorded when they last accepted — `null` when
/// the store has not been read yet OR when they never accepted at all, and
/// those two are deliberately NOT distinguished here: both mean "we cannot show
/// them the product yet", and a caller that knows the difference (the loading
/// state) has to decline to decide anyway rather than flash an interstitial.
///
/// 🔴 STRING INEQUALITY, NOT AN ORDERING. "Advances beyond the accepted one"
/// reads like `>` and must not be implemented as one: the versions are dates
/// today and could be `v3` tomorrow, and a wrong parse of an unexpected format
/// would silently answer "no change" — failing OPEN, on the one question where
/// open means showing somebody a product under terms they never saw. Any
/// difference at all asks again. Re-asking after a rollback is a nuisance;
/// not asking after a change is the failure.
bool needsLegalReacceptance({
  required String? acceptedStamp,
  required LegalVersions current,
}) => acceptedStamp != current.stamp;
