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

import '../../core/app_config.dart';

/// Emits the current Turnstile token, or `null` when there is not a usable one.
typedef TurnstileTokenChanged = void Function(String? token);

/// What the gate does in THIS build ([ADR 084]).
enum CaptchaPosture {
  /// A web build with a site key: the challenge renders.
  challenge,

  /// A native (store or desktop) build, or a web demo build with no backend:
  /// no captcha, by design, and nothing is reported.
  notOnThisChannel,

  /// A web build against a real backend with no site key: an error. The gate
  /// renders nothing (there is no key to render with) and reports it.
  misconfigured,
}

class TurnstileGate extends StatefulWidget {
  const TurnstileGate({required this.onToken, this.onError, super.key});

  /// The decision, as a pure function so every branch is testable — a widget
  /// test runs with `kIsWeb` false and no key, which is exactly one of them.
  ///
  /// 🔴 A NATIVE BUILD NEVER RENDERS THE CHALLENGE, EVEN WITH A KEY. [ADR 084]
  /// makes Turnstile web-only; a key in a native build is a lane defect that the
  /// build-time guard names, and rendering an unverified webview widget because
  /// of it would be the failure the ADR was written to avoid.
  @visibleForTesting
  static CaptchaPosture postureFor({
    required bool isWeb,
    required String siteKey,
    required bool backendLive,
  }) {
    if (!isWeb) return CaptchaPosture.notOnThisChannel;
    if (siteKey.isNotEmpty) return CaptchaPosture.challenge;
    return backendLive
        ? CaptchaPosture.misconfigured
        : CaptchaPosture.notOnThisChannel;
  }

  /// This build's posture.
  static CaptchaPosture get posture => postureFor(
    isWeb: kIsWeb,
    siteKey: AppConfig.turnstileSiteKey,
    backendLive: AppConfig.isBackendLive,
  );

  /// Called with a fresh token, and with `null` whenever the token stops being
  /// usable — expiry, timeout or error. Callers should treat null as "not ready".
  final TurnstileTokenChanged onToken;

  /// Optional: surface a human message when the challenge itself fails. The
  /// screens already have a snackbar path; this lets them use it.
  final void Function(String message)? onError;

  /// The PUBLIC site key. Public by design — it ships inside the web bundle and
  /// is meaningless without the secret, which lives only on Box A.
  ///
  /// ⏱ 2026-09-15: a forward to the chassis, no longer a read of its own
  /// ([ADR 084], the read has one home).
  static String get siteKey => AppConfig.turnstileSiteKey;

  /// Whether a gate will actually render. Screens use this to decide whether a
  /// missing token should block submission.
  ///
  /// ⏱ 2026-09-15: true only for [CaptchaPosture.challenge] — a native build
  /// with a key does not render one ([ADR 084]).
  static bool get isConfigured => posture == CaptchaPosture.challenge;

  /// 🔴 FOR THE CUTOVER CHECKLIST, NOT FOR THE APP.
  ///
  /// Before `SUPABASE_URL` moves to Box A, a build with no site key stops being
  /// harmless and becomes a build where nobody can sign in. This turns that
  /// into a loud failure somebody can run, instead of a discovery made by
  /// users. It is deliberately NOT called at startup: doing so would crash
  /// every current build, all of which correctly have no key.
  static void assertConfiguredForCutover() {
    if (!AppConfig.isTurnstileConfigured) {
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
  void initState() {
    super.initState();
    // [ADR 084]: a web build against a real backend with no key is an ERROR.
    // Reported, never thrown — throwing from a sign-in screen would take the
    // screen down with it, and the build-time guard is the gate that stops it.
    if (TurnstileGate.posture == CaptchaPosture.misconfigured) {
      FlutterError.reportError(
        FlutterErrorDetails(
          exception: StateError(
            'TURNSTILE_SITE_KEY is empty in a WEB build with a live backend. '
            'The identity provider refuses sign-in, sign-up, recover and resend '
            'without a captcha token, so this build cannot authenticate anyone. '
            'Pass --dart-define=TURNSTILE_SITE_KEY=<key> to the web build '
            '(ADR 084).',
          ),
          library: 'turnstile_gate',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!TurnstileGate.isConfigured) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: CloudflareTurnstile(
        siteKey: TurnstileGate.siteKey,
        options: TurnstileOptions(
          // ⏱ 2026-09-12 · THE BOX AND THE FRAME DISAGREED ABOUT ITS WIDTH, and the
          // owner saw the result: a challenge sitting in the left third of a wide
          // bordered box with dead space beside the Cloudflare logo. The package
          // renders the iframe with `style.width = '100%'` so it fills whatever
          // column it is given, while sizing the Flutter box from
          // `options.size.width` - and with no `size` set that default is
          // `normal`, a fixed 300px. Two numbers for one widget.
          //
          // `flexible` is the size Cloudflare documents for this: width fills the
          // container (minimum 300px), height stays 65. Now the frame and the box
          // agree, and the challenge spans the same width as the form above it.
          size: TurnstileSize.flexible,
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
