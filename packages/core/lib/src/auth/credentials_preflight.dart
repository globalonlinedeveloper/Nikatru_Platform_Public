/// What the client can say about a credential pair BEFORE it sends one.
///
/// PURE, IN `core`, for the same reason `password_policy.dart` is: a rule
/// checked on several surfaces and copied to each of them is several rules that
/// will disagree. These two were hand-written inside
/// `apps/subly/lib/features/auth/login_screen.dart` and existed **nowhere** in
/// the app brick — measured 2026-09-04:
/// `grep -c "contains('@')" tooling/bricks/.../features/auth/sign_in_screen.dart`
/// → 0. Every app the factory stamps therefore posted whatever was in the boxes
/// and waited for the server to say no.
///
/// ⚠️ WHAT THIS DOES **NOT** FINISH. `password_policy.dart`'s header names a
/// second debt — *"`login_screen.dart` already carries a hand-written `< 8` and
/// `sign_up_screen.dart` another"*. This increment adopts [kMinPasswordLength]
/// in `login_screen.dart` only. The literal `8` still stands in three files
/// (both trees' `sign_up_screen.dart`, and the brick has no email check at all
/// on that surface); those are one-line adoptions on screens this increment does
/// not otherwise touch, and they are recorded in the backlog rather than done
/// quietly here.
///
/// ⚠️ IT IS NOT THE AUTHORITY, and the same caveat `password_policy.dart` writes
/// applies here word for word: the SERVER decides. This exists so the commonest
/// refusals are answered without a round trip. A pair this passes can still be
/// refused upstream, and the screen must render that refusal rather than assume
/// it cannot happen.
///
/// 🔴 WHY AN ENUM AND NOT A BOOL — the same argument as [NewPasswordProblem].
/// "Invalid" tells a user nothing. Each arm below has a different remedy and a
/// different published sentence, and the arb key each one maps to is named on
/// the arm so the mapping is reviewable in one place instead of being rebuilt
/// from an `if` chain on every surface.
///
/// ⛔ CONSENT IS NOT IN HERE, deliberately. The sign-up clickwrap
/// (`_acceptedTerms`) is checked by the SCREEN, and it stays there because
/// `tooling/ci/assert-signup-consent-shape.mjs` reads those flags out of the
/// screen files by name (`:69`) and because a legal gate that a shared helper
/// could be called without is a gate with a second entrance. The rule that file
/// enforces is that the flag initialises FALSE on the surface; moving the flag
/// out of the surface would move it out of the guard's sight.
library;

/// What is wrong with the credentials as typed, if anything.
///
/// ORDER IS PART OF THE CONTRACT, checked from the most basic outward, the same
/// rule [newPasswordProblem] is written to: a blank box is reported as blank
/// rather than as malformed, because filling it in is the change that has to
/// happen either way.
///
/// ⛔ THERE IS NO `passwordTooShort` ARM HERE AND THAT IS DELIBERATE. The
/// length floor already lives in `password_policy.dart` as [kMinPasswordLength]
/// and belongs to the surfaces that create a password, not to the two doors
/// below. Restating it here would put the same rule in two files — the exact
/// thing that file was written to stop — and it would add an arm that neither
/// [signInProblem] nor [passwordResetProblem] can ever return, which is an
/// assertion that cannot fail.
enum CredentialsProblem {
  /// A surface that needs BOTH an address and a password has at least one of
  /// them blank. Maps to the arb key `authEnterBoth`.
  ///
  /// 🔴 ONE ARM FOR "EITHER IS BLANK", NOT TWO, AND THAT IS THE SHIPPED
  /// BEHAVIOUR RATHER THAN A SIMPLIFICATION. `login_screen.dart` has said
  /// *"Enter both your email and password"* for a blank of either kind since it
  /// was written; splitting it here would change the sentence a live user reads
  /// inside a refactor that is supposed to change nothing they can see.
  incomplete,

  /// A surface that needs ONLY an address has it blank — the forgot-password
  /// door. Maps to `emailRequired`.
  ///
  /// Distinct from [incomplete] because the sentence is different and because
  /// there is no password box on that path to be told about.
  emailMissing,

  /// The address has no `@` or no `.`. Maps to `authInvalidEmail`.
  ///
  /// ⚠️ DELIBERATELY THE WEAKEST USEFUL TEST, and it is not a validator. RFC
  /// 5321 permits addresses this rejects (`user@localhost`) and accepts
  /// nonsense this passes (`.@.`). What it is FOR is the typo that costs a
  /// round trip and then reports back as a generic failure — a missing `@`,
  /// a half-typed domain. A stricter regex here would start refusing real
  /// addresses on a screen that has no way to be argued with, which is a worse
  /// failure than one wasted request.
  emailMalformed,
}

/// Is the address obviously not one? See [CredentialsProblem.emailMalformed]
/// for why the test is this weak on purpose.
bool _emailLooksMalformed(String email) =>
    !email.contains('@') || !email.contains('.');

/// The sign-IN door. Returns null when there is nothing to say.
///
/// [email] is expected already trimmed by the caller — the caller is the one
/// holding the controller, and trimming here as well would leave two places
/// deciding what the user typed.
CredentialsProblem? signInProblem({
  required String email,
  required String password,
}) {
  if (email.isEmpty || password.isEmpty) return CredentialsProblem.incomplete;
  if (_emailLooksMalformed(email)) return CredentialsProblem.emailMalformed;
  return null;
}

/// The password-reset door, where the address is the only field.
///
/// ⚠️ IT CHECKS BLANK AND NOT MALFORMED, and that is a deliberate hold rather
/// than an omission. The shipped screen checks blank only
/// (`login_screen.dart` `_forgot`), and adding a malformed-address refusal here
/// would change what a live user experiences inside a change whose whole claim
/// is that it moves code without moving behaviour. Adding it is a one-line
/// follow-up with its own test; it is not this increment's to take.
CredentialsProblem? passwordResetProblem({required String email}) {
  if (email.isEmpty) return CredentialsProblem.emailMissing;
  return null;
}
