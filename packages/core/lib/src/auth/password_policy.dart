/// The one rule the client can state exactly about a new password.
///
/// PURE, IN `core`, for the same reason `identity_assurance.dart` is: the rule
/// is checked on at least three surfaces (sign-up, the reset screen, and the
/// in-memory identity) and a rule copied three times is three rules that will
/// disagree. `login_screen.dart` already carries a hand-written `< 8` and
/// `sign_up_screen.dart` another; both predate this file and neither is changed
/// by the increment that added it.
///
/// ⚠️ IT IS NOT THE AUTHORITY. The SERVER decides what it will accept —
/// gotrue's own floor is 6 by default and a project can require symbols, digits
/// or a length we know nothing about. This exists so the commonest refusal is
/// answered without a round trip, and so the two fields on a reset form can
/// disagree loudly before anything is sent. A password this passes can still be
/// refused upstream, and the screen must render that refusal rather than assume
/// it cannot happen.
library;

/// The client-side floor, in characters.
///
/// 8, matching `passwordTooShort`'s published wording ("Use at least 8
/// characters.") in both arb files. 🔴 THE NUMBER AND THE SENTENCE MUST AGREE:
/// the copy said 6 for a while because gotrue's server default had leaked into
/// our words, and a user reading one number while the code enforced another
/// simply cannot tell which of them is wrong.
const int kMinPasswordLength = 8;

/// What is wrong with a proposed new password, if anything.
///
/// Three arms, each reachable and each with a different remedy — which is the
/// reason this returns an enum rather than a bool. "Invalid" tells a user
/// nothing; "the two boxes do not match" tells them where to look.
enum NewPasswordProblem {
  /// Nothing typed. Distinct from [tooShort] because an empty field is not a
  /// failed attempt — the message for it is "fill this in", not "try harder".
  empty,

  /// Shorter than [kMinPasswordLength].
  tooShort,

  /// The confirmation box does not equal the password box.
  ///
  /// 🔴 THE CONFIRMATION IS NOT DECORATION. A reset screen is the one place a
  /// typo is UNRECOVERABLE by retrying: the password the user meant to set is
  /// not the one they now have, and the link that got them here is single-use.
  /// The next thing they do is ask for another reset mail.
  mismatched,
}

/// The rule, in one place. Null means acceptable.
///
/// ORDER IS PART OF THE CONTRACT and it is checked from the most basic outward:
/// an empty box is reported as empty rather than as "too short", and a password
/// below the floor is reported as too short even when the confirmation also
/// disagrees — because lengthening it is the change that must happen either way,
/// and reporting the mismatch first would send the user to fix the wrong field.
NewPasswordProblem? newPasswordProblem({
  required String password,
  required String confirmation,
}) {
  if (password.isEmpty) return NewPasswordProblem.empty;
  if (password.length < kMinPasswordLength) return NewPasswordProblem.tooShort;
  if (password != confirmation) return NewPasswordProblem.mismatched;
  return null;
}
