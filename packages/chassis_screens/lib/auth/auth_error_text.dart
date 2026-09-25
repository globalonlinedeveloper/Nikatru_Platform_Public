import 'package:flutter/foundation.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// Maps raw auth/network errors onto short, human messages so users never see a
/// stack-tracey exception (e.g. Supabase's `invalid_credentials`).
///
/// ⏱ 2026-09-24 — 🔴 THE ONE COPY, AND WHY IT LIVES IN THIS PACKAGE. It lived in
/// `apps/subscriptiontracker/lib/features/auth/`, so only that app's screens
/// could call it, while five catch sites did `_error = '$e'` — the two app
/// screens and three chassis views — and every chassis view rendered
/// `AuthFailure.message`, the server's English, verbatim. Moved with `git mv`.
/// `tooling/ci/assert-package-boundaries.mjs` leaves exactly one home that both
/// the app and the chassis views can import:
///   · limb A keeps `packages/core` pure Dart — no Flutter, so no localized
///     strings to return;
///   · limb B forbids `packages/design_system` any `nikatru_*` import, so it
///     could not read [core.AuthFailure.code] or its reasons;
///   · this package sees both, and wraps no vendor, so limb C's derivation
///     never counts it as an adapter.
///
/// 🔴 ORDER OF EVIDENCE — the machine's answer first, its prose last:
///   1. a `String`, or an [core.AuthFailure.localized] — text a screen already
///      wrote for the user. Shown as written.
///   2. [core.AuthFailure.code] and [core.AuthFailure.reasons] — what the
///      adapter carried over from the server. When the code is one modelled
///      below it DECIDES, whatever the sentence says.
///   3. ⚠️ THE ENGLISH SENTENCE — a FALLBACK ONLY: for a failure with no code,
///      a code this build has never heard of, or a vendor exception that
///      escaped a repository method without being wrapped. It is kept because
///      those still happen (a dropped connection has no code at all), never
///      because the sentence is trusted over the code.
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
/// `invalid_credentials`. It stops being survivable at the auth cutover: the
/// self-hosted auth server — Box C, `https://auth-api.nikatru.com` — enforces
/// Turnstile, so a gated request fails with
/// `captcha protection: request disallowed (invalid-input-response)` — a
/// sentence no user can act on, shown verbatim.
String authErrorText(ChassisLocalizations l10n, Object e) {
  if (e is String) return e;
  if (e is core.AuthFailure) {
    if (e.localized) return e.message;
    final String? byCode = _codeText(l10n, e);
    if (byCode != null) return byCode;
  }
  // ── FALLBACK: THE SENTENCE. Reached only when step 2 above had no answer. ──
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
  // it. Losing a debuggable string is the price of never showing a user a
  // sentence written for a machine — and in debug builds the original is still
  // printed below so the information is not lost to us.
  assert(() {
    debugPrint('authErrorText: unmapped auth error -> $e');
    return true;
  }());
  return l10n.authUnknownError;
}

/// Step 2: the failure's machine [core.AuthFailure.code], or null when there is
/// no code or it is not one modelled here — which sends the caller to the
/// sentence fallback rather than to "Something went wrong".
///
/// The strings are GoTrue's own `error_code` values (gotrue-dart
/// `lib/src/types/error_code.dart`), which the Supabase adapter copies onto the
/// failure unchanged. The captcha arm is the same `authCaptchaFailed` the
/// sentence fallback reaches, for the same reason given there.
String? _codeText(ChassisLocalizations l10n, core.AuthFailure e) =>
    switch (e.code) {
      core.AuthFailure.weakPassword => _weakPasswordByReason(l10n, e.reasons),
      'captcha_failed' => l10n.authCaptchaFailed,
      'invalid_credentials' => l10n.authIncorrect,
      'user_already_exists' || 'email_exists' => l10n.authAlreadyRegistered,
      'email_not_confirmed' => l10n.authConfirmEmail,
      'over_request_rate_limit' ||
      'over_email_send_rate_limit' ||
      'over_sms_send_rate_limit' =>
        l10n.authRateLimited,
      _ => null,
    };

/// A weak-password refusal, mapped by REASON — ⏱ 2026-09-24, auth cutover prep.
///
/// The self-hosted server (GoTrue v2.189.0, `internal/api/password.go`) refuses
/// a weak password with HTTP 422, code `weak_password`, and a
/// `weak_password.reasons` list whose members are exactly `length`,
/// `characters` and `pwned`. It runs with the breached-password check ON, so
/// `pwned` is a live answer there.
///
///   · `pwned`  → `passwordBreached`. It WINS when several reasons arrive: it is
///     the only one a user cannot fix by adding characters.
///   · `length` → `passwordTooShort`.
///   · `characters`, an unknown reason, or NO reasons list → `passwordTooWeak`.
///     Never the length message without `length` — it may be false.
///
/// The ONE statement of that priority: the code path and the sentence fallback
/// both end here, so they cannot disagree about which reason wins.
String _weakPasswordByReason(
  ChassisLocalizations l10n,
  Iterable<String> reasons,
) {
  final Set<String> r = <String>{
    for (final String x in reasons) x.trim().toLowerCase(),
  };
  if (r.contains(core.AuthFailure.reasonPwned)) return l10n.passwordBreached;
  if (r.contains(core.AuthFailure.reasonLength)) return l10n.passwordTooShort;
  return l10n.passwordTooWeak;
}

/// The FALLBACK half of the weak-password mapping: [raw] is a lowercased
/// `toString()`. Returns null when it is not a weak-password refusal at all.
///
/// ⏱ 2026-09-24 — no longer the path a weak password normally takes. The
/// Supabase adapter's `updatePassword` and `signUpWithEmail` now wrap
/// `AuthWeakPasswordException` into an [core.AuthFailure] carrying the code and
/// the reasons, which [_codeText] reads. This stays for a vendor exception that
/// reaches a screen unwrapped: gotrue-dart writes it as
/// `AuthWeakPasswordException(message: …, statusCode: …, reasons: [..])`, a
/// string literal that survives web minification where a runtime type name
/// would not — and the vendor type cannot be named here anyway, because no
/// screen package may import `package:supabase_flutter`.
///
/// The sentences are matched to know it IS a weak-password refusal — never to
/// decide which reason. With no list to read, the answer is `passwordTooWeak`.
String? _weakPasswordText(ChassisLocalizations l10n, String raw) {
  final bool isWeakPassword = raw.contains('weakpasswordexception') ||
      raw.contains('weak_password') ||
      raw.contains('password should be') ||
      raw.contains('password should contain') ||
      raw.contains('known to be weak');
  if (!isWeakPassword) return null;
  final Match? list = _reasonsList.firstMatch(raw);
  return _weakPasswordByReason(l10n, <String>[
    if (list != null)
      for (final String r in list.group(1)!.split(','))
        if (r.trim().isNotEmpty) r,
  ]);
}

/// The `reasons: [..]` field of the vendor exception's `toString()`, lowercased.
final RegExp _reasonsList = RegExp(r'reasons: \[([a-z_, ]*)\]');
