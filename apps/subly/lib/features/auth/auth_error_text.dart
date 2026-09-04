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
  if (raw.contains('weak_password') || raw.contains('password should be')) {
    // 🔴 THE COPY CHANGED HERE, ON PURPOSE (WORKORDER §8 decision 3). This said
    // "Password must be at least 6 characters." — the 6 was GoTrue's server
    // default leaking into our words, while `signUpTitle`'s own screen enforces
    // 8 client-side and says so via `passwordTooShort` ("Use at least 8
    // characters."). Two numbers for one rule is a bug in the copy, and the
    // shipped one was the wrong number.
    // 👤 Flagged for the polish list: the login screen's sign-up toggle has no
    // client-side 8-check at all, so it can still reach the server with 6.
    return l10n.passwordTooShort;
  }
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
