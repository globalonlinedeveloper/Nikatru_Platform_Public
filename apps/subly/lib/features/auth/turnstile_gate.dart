// ─────────────────────────────────────────────────────────────────────────────
// TurnstileGate — the half of the CAPTCHA the SERVER cannot provide.
//
// Self-hosted GoTrue on Box A enforces Cloudflare Turnstile on SIX endpoints,
// measured 2026-09-03: `signup`, `token?grant_type=password`, `recover`, `otp`,
// `magiclink` and `resend`. Four of those are reachable from this app, so four
// screens need a token: sign in, sign up, forgot password, resend verification.
//
// #437 gave `AuthRepository` the ability to CARRY a token. Nothing produced one.
// This is what produces it.
//
// ── 🔴 IT IS OFF UNLESS A SITE KEY IS COMPILED IN, AND THAT IS THE WHOLE DESIGN
//
// `TURNSTILE_SITE_KEY` is a dart-define with an EMPTY default. With no key:
// this renders `SizedBox.shrink()`, never calls back, and every caller's token
// stays null — which is byte-for-byte the behaviour before this file existed.
//
// Three things fall out of that, and each is the reason for it:
//   1. It can be merged and SHIPPED TODAY. Production auth is still the hosted
//      Supabase project, which has no gate, and GoTrue ignores a captcha token
//      when captcha is disabled. So this rides out ahead of the cutover instead
//      of inside its window — the runbook's whole strategy.
//   2. The 791 existing widget tests keep passing untouched. A required key
//      would have made every one of them render a network widget.
//   3. A build that FORGETS the define degrades to today's behaviour rather
//      than to a broken login screen. ⚠️ After the cutover that is no longer
//      safe — a missing key then means every sign-in is refused — which is why
//      `assertConfiguredForCutover` exists below and why the cutover checklist
//      must call it, not trust it.
//
// ── ⚠️ THE TOKEN IS SINGLE-USE AND SHORT-LIVED
//
// Cloudflare expires a Turnstile token in ~5 minutes and it may be redeemed
// once. So a user who opens the form, wanders off and submits later has a
// STALE token and the server refuses with `captcha_failed`. `onTokenExpired`
// clears it and the widget re-challenges; the caller sees null and can ask for
// a retry rather than sending something already dead.
// ─────────────────────────────────────────────────────────────────────────────

import 'package:cloudflare_turnstile/cloudflare_turnstile.dart';
import 'package:flutter/material.dart';

/// Emits the current Turnstile token, or `null` when there is not a usable one.
typedef TurnstileTokenChanged = void Function(String? token);

class TurnstileGate extends StatefulWidget {
  const TurnstileGate({required this.onToken, this.onError, super.key});

  /// Called with a fresh token, and with `null` whenever the token stops being
  /// usable — expiry, timeout or error. Callers should treat null as "not ready".
  final TurnstileTokenChanged onToken;

  /// Optional: surface a human message when the challenge itself fails. The
  /// screens already have a snackbar path; this lets them use it.
  final void Function(String message)? onError;

  /// The PUBLIC site key. Public by design — it ships inside the web bundle and
  /// is meaningless without the secret, which lives only on Box A.
  static const String siteKey = String.fromEnvironment('TURNSTILE_SITE_KEY');

  /// Whether a gate will actually render. Screens use this to decide whether a
  /// missing token should block submission.
  static bool get isConfigured => siteKey.isNotEmpty;

  /// 🔴 FOR THE CUTOVER CHECKLIST, NOT FOR THE APP.
  ///
  /// Before `SUPABASE_URL` moves to Box A, a build with no site key stops being
  /// harmless and becomes a build where nobody can sign in. This turns that
  /// into a loud failure somebody can run, instead of a discovery made by
  /// users. It is deliberately NOT called at startup: doing so would crash
  /// every current build, all of which correctly have no key.
  static void assertConfiguredForCutover() {
    if (!isConfigured) {
      throw StateError(
        'TURNSTILE_SITE_KEY is empty. Box A refuses signup, password sign-in, '
        'recover and resend without a captcha token, so this build cannot '
        'authenticate anyone against it. Pass '
        '--dart-define=TURNSTILE_SITE_KEY=<key> to the web build.',
      );
    }
  }

  @override
  State<TurnstileGate> createState() => _TurnstileGateState();
}

class _TurnstileGateState extends State<TurnstileGate> {
  @override
  Widget build(BuildContext context) {
    if (!TurnstileGate.isConfigured) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: CloudflareTurnstile(
        siteKey: TurnstileGate.siteKey,
        options: TurnstileOptions(
          // `auto` follows the host page, which is what keeps the challenge from
          // being a bright white block in the app's dark theme.
          theme: TurnstileTheme.auto,
          // Cloudflare retries a soft failure itself. Leaving this on means a
          // blip does not strand the user on a form they cannot submit.
          retryAutomatically: true,
          refreshExpired: TurnstileRefreshExpired.auto,
        ),
        onTokenReceived: (String token) => widget.onToken(token),
        // ⚠️ ALL THREE FAILURE PATHS CLEAR THE TOKEN. A caller must never be
        // left holding a value that the server will refuse — a stale token is
        // worse than none, because none is at least honest about not being ready.
        onTokenExpired: () => widget.onToken(null),
        onTimeout: () => widget.onToken(null),
        onError: (TurnstileException e) {
          widget.onToken(null);
          widget.onError?.call(e.message);
        },
      ),
    );
  }
}
