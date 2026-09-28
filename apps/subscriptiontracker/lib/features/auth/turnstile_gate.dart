// ─────────────────────────────────────────────────────────────────────────────
// TurnstileGate — the half of the CAPTCHA the SERVER cannot provide.
//
// ⏱ 2026-09-27 · ST-A1 (audit BUG-1, D29) — THE GATE MOVED TO THE CHASSIS.
// `TurnstileGate`, `CaptchaPosture` and the single-use token's lifecycle
// (`CaptchaTokenController`: consume + re-challenge after EVERY gated call,
// a valid submit WAITS for a token — never a button disabled on one, since
// 2026-09-28) now live in
// `package:nikatru_chassis_screens/auth/turnstile_gate.dart`, so the brick's
// sign-in gets them too. What stays here is this app's ADAPTER: the one
// `CloudflareTurnstile(...)` call the chassis may not import, and the posture
// read off this app's `AppConfig`. The notes below are the history of the
// file; where they say "this renders", read "the chassis gate renders".
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
//      `assertTurnstileConfiguredForCutover` exists below and why the cutover checklist
//      must call it, not trust it.
//
// ── ⚠️ THE TOKEN IS SINGLE-USE AND SHORT-LIVED
//
// Cloudflare expires a Turnstile token in ~5 minutes and it may be redeemed
// once. So a user who opens the form, wanders off and submits later has a
// STALE token and the server refuses with `captcha_failed`. `onTokenExpired`
// clears it and the widget re-challenges; the caller sees null and can ask for
// a retry rather than sending something already dead.
//
// ── ⏱ 2026-09-15 · WEB ONLY, AND THE KEY LIVES IN THE CHASSIS ([ADR 084])
//
// The owner decided store builds skip Turnstile ("Store builds skip it"). So the
// OFF state above now has TWO meanings, and this file tells them apart instead of
// letting both render the same SizedBox:
//   · a NATIVE build (every store and desktop lane) carries no captcha BY DESIGN —
//     `CaptchaPosture.notOnThisChannel`. A key compiled into one anyway is ignored
//     here, and refused at build time by `assert-store-build-config.mjs`.
//   · a WEB build talking to a real backend with NO key is an ERROR, not a pass —
//     `CaptchaPosture.misconfigured`. It is reported through `FlutterError` (the
//     crash-report sink) when the gate mounts, because the server will refuse
//     every sign-in that build sends.
// A web DEMO build (`AppConfig.isBackendLive` false) has nothing to protect and
// stays inert. The key is read ONCE, in `lib/core/app_config.dart`
// (`AppConfig.turnstileSiteKey`); "a dart-define with an EMPTY default" above
// still describes the define, and no longer describes where it is read.
// ─────────────────────────────────────────────────────────────────────────────

import 'package:cloudflare_turnstile/cloudflare_turnstile.dart';
import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:flutter/material.dart';
import 'package:nikatru_chassis_screens/auth/turnstile_gate.dart';

import '../../core/app_config.dart';

export 'package:nikatru_chassis_screens/auth/turnstile_gate.dart';

/// This build's posture ([ADR 084]), read off this app's config.
CaptchaPosture get appCaptchaPosture => captchaPostureFor(
  isWeb: kIsWeb,
  siteKey: AppConfig.turnstileSiteKey,
  backendLive: AppConfig.isBackendLive,
);

/// Tests only: the posture a test build cannot otherwise reach. A widget test
/// is never web, so without this every test sees `notOnThisChannel` and a
/// screen that goes dead on an unanswered challenge — the #1022 regression,
/// E2E live run 36379673890 — passes every one of them.
@visibleForTesting
CaptchaPosture? debugCaptchaPostureOverride;

/// A fresh token holder for ONE screen. Dispose it with the screen.
CaptchaTokenController newCaptchaController() => CaptchaTokenController(
  posture: debugCaptchaPostureOverride ?? appCaptchaPosture,
  siteKey: AppConfig.turnstileSiteKey,
);

/// One screen's [captcha]: created on first read, rebuilt on every change and
/// disposed with the screen. A mixin so the forked auth screens do not grow.
mixin CaptchaHost<T extends StatefulWidget> on State<T> {
  late final CaptchaTokenController captcha = newCaptchaController()
    ..addListener(_captchaChanged);

  void _captchaChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    captcha
      ..removeListener(_captchaChanged)
      ..dispose();
    super.dispose();
  }
}

/// The vendor widget, and the only line in the app that names it.
///
/// Under [debugCaptchaPostureOverride] it renders nothing: a widget test has no
/// Cloudflare, and drives the controller's `setToken` / `reportError` itself.
Widget renderTurnstile(BuildContext context, TurnstileChallenge challenge) =>
    debugCaptchaPostureOverride != null
    ? const SizedBox.shrink()
    : CloudflareTurnstile(
        siteKey: challenge.siteKey,
        options: TurnstileOptions(
          // ⏱ 2026-09-12 · `flexible` fills the column (minimum 300px, height
          // 65), so the frame and the Flutter box agree about the width.
          size: TurnstileSize.flexible,
          // `auto` follows the host page — no bright block in the dark theme.
          theme: TurnstileTheme.auto,
          // Cloudflare retries a soft failure itself.
          retryAutomatically: true,
          refreshExpired: TurnstileRefreshExpired.auto,
        ),
        onTokenReceived: challenge.onToken,
        // ⚠️ ALL THREE FAILURE PATHS CLEAR THE TOKEN: a stale token is worse than
        // none, because none is at least honest about not being ready.
        onTokenExpired: () => challenge.onToken(null),
        onTimeout: () => challenge.onToken(null),
        onError: (TurnstileException e) => challenge.onError(e.message),
      );

/// 🔴 FOR THE CUTOVER CHECKLIST, NOT FOR THE APP.
///
/// Before the identity server enforces the captcha, a build with no site key
/// stops being harmless and becomes a build where nobody can sign in. This
/// turns that into a loud failure somebody can run. Deliberately NOT called at
/// startup.
void assertTurnstileConfiguredForCutover() {
  if (!AppConfig.isTurnstileConfigured) {
    throw StateError(
      'TURNSTILE_SITE_KEY is empty. Box A refuses signup, password sign-in, '
      'recover and resend without a captcha token, so this build cannot '
      'authenticate anyone against it. Pass '
      '--dart-define=TURNSTILE_SITE_KEY=<key> to the web build.',
    );
  }
}
