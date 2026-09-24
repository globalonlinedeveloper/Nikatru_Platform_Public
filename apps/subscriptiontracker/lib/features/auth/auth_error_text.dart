import 'package:flutter/foundation.dart';

import '../../l10n/app_localizations.dart';

/// Maps raw auth/network errors onto short, human messages so users never see a
/// stack-tracey exception (e.g. Supabase's `invalid_credentials`).
///
/// The `raw` it matches on is the SERVER's English — Supabase's error codes are
/// not localized and must not be, or the matching stops working. Only the
/// message handed back to the user comes from the arb.
///
/// 🔴 WHY THIS IS A SHARED FUNCTION AND NOT A PRIVATE METHOD, ADDED 2026-09-04.
/// It lived as `_friendlyMessage` inside `login_screen.dart` and **only** the
/// login screen had it. Measured on the other auth screens: `sign_up_screen`
/// (:122), `verify_email_screen` (:65) and `reset_password_screen` (:126) each
/// did `_error = e.message` — i.e. they printed **the server's raw English
/// straight to the user**. `packages/auth_supabase`'s repository deliberately
/// keeps that English in `AuthFailure.message` *because* this mapper matches on
/// it, so the seam was built for a mapper that three of its four consumers did
/// not have.
///
/// ⚠️ That was survivable while the strings were things like
/// `invalid_credentials`. It stops being survivable at the auth cutover: Box A
/// enforces Turnstile, so a gated request fails with
/// `captcha protection: request disallowed (invalid-input-response)` — a
/// sentence no user can act on, shown verbatim.
String authErrorText(AppLocalizations l10n, Object e) {
  if (e is String) return e;
  final String raw = e.toString().toLowerCase();
  if (raw.contains('invalid_credentials') || raw.contains('invalid login')) {
    return l10n.authIncorrect;
  }
  if (raw.contains('already registered') ||
      raw.contains('already been registered') ||
      raw.contains('user_already_exists')) {
    return l10n.authAlreadyRegistered;
  }
  // 🔴 THE COPY CHANGED HERE, ON PURPOSE (WORKORDER §8 decision 3). This said
  // "Password must be at least 6 characters." — the 6 was GoTrue's server
  // default leaking into our words, while `signUpTitle`'s own screen enforces
  // 8 client-side and says so via `passwordTooShort` ("Use at least 8
  // characters."). Two numbers for one rule is a bug in the copy, and the
  // shipped one was the wrong number.
  // 👤 Flagged for the polish list: the login screen's sign-up toggle has no
  // client-side 8-check at all, so it can still reach the server with 6.
  // ⏱ 2026-09-24 — every weak-password refusal went to `passwordTooShort`
  // here, including the two that are not about length at all. It is now mapped
  // by the server's REASON: see `_weakPasswordText` below.
  final String? weak = _weakPasswordText(l10n, raw);
  if (weak != null) return weak;
  if (raw.contains('email_not_confirmed') || raw.contains('not confirmed')) {
    return l10n.authConfirmEmail;
  }
  if (raw.contains('rate limit') || raw.contains('over_email_send')) {
    return l10n.authRateLimited;
  }
  // 🔴 CAPTCHA MUST BE TESTED BEFORE THE NETWORK BRANCH BELOW. That branch
  // matches a bare `connection`, and GoTrue's captcha refusal reads "captcha
  // protection: request disallowed" — no overlap today, but the network branch
  // is the widest test in this function and the cheapest place to be bitten by
  // a future server string. Order is the guard.
  //
  // ⚠️ AND IT MUST NOT REUSE `authIncorrect`. On a gated endpoint the captcha is
  // checked BEFORE the password, so "Incorrect email or password" would be an
  // outright lie to a user whose credentials were fine and whose token had
  // simply expired — `TurnstileGate` tokens are single-use and last ~5 minutes,
  // which makes expiry the DOMINANT cause here, not a wrong password.
  if (raw.contains('captcha')) {
    return l10n.authCaptchaFailed;
  }
  if (raw.contains('socketexception') ||
      raw.contains('failed host lookup') ||
      raw.contains('connection') ||
      raw.contains('network')) {
    return l10n.authNetworkError;
  }
  // ⚠️ The fallback DELIBERATELY discards the server's text rather than showing
  // it. On the three screens this function is new to, that is a change: they
  // used to show the raw message. Losing a debuggable string is the price of
  // never showing a user a sentence written for a machine — and in debug builds
  // the original is still printed below so the information is not lost to us.
  assert(() {
    debugPrint('authErrorText: unmapped auth error -> $e');
    return true;
  }());
  return l10n.authUnknownError;
}

/// A weak-password refusal, mapped by REASON — ⏱ 2026-09-24, auth cutover prep.
/// Returns null when [raw] is not a weak-password refusal at all.
///
/// The self-hosted server (GoTrue v2.189.0, `internal/api/password.go`) refuses
/// a weak password with HTTP 422, code `weak_password`, and a
/// `weak_password.reasons` list whose members are exactly `length`,
/// `characters` and `pwned`. It runs with the breached-password check ON, so
/// `pwned` is a live answer there, and its sentence ("known to be weak and easy
/// to guess") used to fall through every branch above to `authUnknownError`.
///
///   · `pwned`  → `passwordBreached`. It WINS when several reasons arrive: it is
///     the only one a user cannot fix by adding characters.
///   · `length` → `passwordTooShort`.
///   · `characters`, an unknown reason, or NO reasons list → `passwordTooWeak`.
///     Never the length message without `length` — it may be false.
///
/// ⚠️ THE VENDOR TYPE CANNOT BE NAMED HERE. gotrue-dart throws
/// `AuthWeakPasswordException` carrying the list, but
/// `assert-package-boundaries` limb (c) fails any app `lib/` import of
/// `package:supabase_flutter`, which `packages/auth_supabase` wraps. So the list
/// is read from that exception's own `toString()` — gotrue-dart writes it as
/// `AuthWeakPasswordException(message: …, statusCode: …, reasons: [..])`, a
/// string literal that survives web minification where a runtime type name
/// would not.
///
/// ⚠️ THE NO-LIST CASE IS REAL, NOT DEFENSIVE. `auth_supabase`'s
/// `updatePassword` rewraps the vendor exception as `AuthFailure(e.message)`
/// and drops the list, so the reset screen hands this function GoTrue's
/// sentences only. They are matched to know it IS a weak-password refusal —
/// never to decide which reason.
String? _weakPasswordText(AppLocalizations l10n, String raw) {
  final bool isWeakPassword =
      raw.contains('weakpasswordexception') ||
      raw.contains('weak_password') ||
      raw.contains('password should be') ||
      raw.contains('password should contain') ||
      raw.contains('known to be weak');
  if (!isWeakPassword) return null;
  final Match? list = _reasonsList.firstMatch(raw);
  final Set<String> reasons = <String>{
    if (list != null)
      for (final String r in list.group(1)!.split(','))
        if (r.trim().isNotEmpty) r.trim(),
  };
  if (reasons.contains('pwned')) return l10n.passwordBreached;
  if (reasons.contains('length')) return l10n.passwordTooShort;
  return l10n.passwordTooWeak;
}

/// The `reasons: [..]` field of the vendor exception's `toString()`, lowercased.
final RegExp _reasonsList = RegExp(r'reasons: \[([a-z_, ]*)\]');
