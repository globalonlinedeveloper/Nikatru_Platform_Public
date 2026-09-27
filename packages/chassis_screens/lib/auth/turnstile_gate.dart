// ─────────────────────────────────────────────────────────────────────────────
// TurnstileGate — the web CAPTCHA every stamped app shares (ST-A1; audit BUG-1,
// D29; [ADR 084]).
//
// It lived in apps/subscriptiontracker alone, so the brick's chassis sign-in had
// no captcha at all and app #2 could not sign anyone in on web against the
// captcha-gated identity server. It moves here, and it moves WITHOUT the plugin:
// this package declares no third-party dependency (pubspec.yaml says why), so the
// one `CloudflareTurnstile(...)` call stays in each app's adapter and arrives as
// a [TurnstileRenderer]. Everything else — the posture, the token's lifecycle,
// the re-challenge — is here, once.
//
// ── 🔴 THE TOKEN IS SINGLE-USE, AND THIS IS WHERE THAT IS ENFORCED (BUG-1)
//
// Cloudflare lets a Turnstile token be redeemed ONCE, and the identity server
// redeems it on the first gated call even when the password is wrong. The app
// stored the token once and re-sent it, so after one failed sign-in every retry
// carried a spent token and read "Verification expired" until a reload. So a
// token is never READ at a call site; it is [CaptchaTokenController.consume]d,
// which hands it over, forgets it and re-challenges — after EVERY gated call,
// success or failure. And [CaptchaTokenController.ready] is false while a
// rendered challenge has not answered, so a screen disables its submit instead
// of sending no token at all.
// ─────────────────────────────────────────────────────────────────────────────

import 'package:flutter/widgets.dart';

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

/// The decision, as a pure function so every branch is testable.
///
/// 🔴 A NATIVE BUILD NEVER RENDERS THE CHALLENGE, EVEN WITH A KEY. [ADR 084]
/// makes Turnstile web-only; a key in a native build is a lane defect that the
/// build-time guard names.
CaptchaPosture captchaPostureFor({
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

/// One screen's captcha token: who holds it, whether a submit may go, and the
/// re-challenge after it is spent.
class CaptchaTokenController extends ChangeNotifier {
  CaptchaTokenController({required this.posture, this.siteKey = ''});

  final CaptchaPosture posture;

  /// The PUBLIC site key — it ships inside the web bundle by design.
  final String siteKey;

  /// Whether a challenge renders in this build.
  bool get renders => posture == CaptchaPosture.challenge;

  String? _token;
  int _generation = 0;

  /// The current, unspent token, or null.
  String? get token => _token;

  /// Bumps on every [consume]: the gate re-mounts its challenge on a new one.
  int get generation => _generation;

  /// Whether a gated call may be made now. Always true where no challenge
  /// renders (the server does not gate that channel); otherwise only once the
  /// challenge has answered.
  bool get ready => !renders || _token != null;

  /// The renderer's answer: a fresh token, or null when the last one stopped
  /// being usable (expiry, timeout, error).
  void setToken(String? token) {
    if (_token == token) return;
    _token = token;
    notifyListeners();
  }

  /// The token for ONE gated call. It is forgotten and the challenge re-runs,
  /// whatever the call's outcome — a redeemed token is dead either way.
  String? consume() {
    final String? spent = _token;
    _token = null;
    _generation++;
    notifyListeners();
    return spent;
  }
}

/// What a [TurnstileRenderer] is handed.
class TurnstileChallenge {
  const TurnstileChallenge({
    required this.siteKey,
    required this.onToken,
    required this.onError,
  });

  final String siteKey;

  /// A fresh token, or null when the current one stopped being usable.
  final ValueChanged<String?> onToken;

  /// The challenge itself failed; the token is already cleared.
  final ValueChanged<String> onError;
}

/// Builds the vendor widget. The adapter owns it, because this package may not
/// import the plugin.
typedef TurnstileRenderer =
    Widget Function(BuildContext context, TurnstileChallenge challenge);

/// Renders the challenge for [controller] — nothing where the posture is not
/// [CaptchaPosture.challenge] — and a NEW challenge after every spend.
class TurnstileGate extends StatefulWidget {
  const TurnstileGate({
    required this.controller,
    required this.render,
    this.onError,
    super.key,
  });

  final CaptchaTokenController controller;
  final TurnstileRenderer render;

  /// Optional: surface a human message when the challenge itself fails.
  final void Function(String message)? onError;

  @override
  State<TurnstileGate> createState() => _TurnstileGateState();
}

class _TurnstileGateState extends State<TurnstileGate> {
  @override
  void initState() {
    super.initState();
    // [ADR 084]: a web build against a real backend with no key is an ERROR.
    // Reported, never thrown — throwing from a sign-in screen would take the
    // screen down with it. The library name is what the store capture matches.
    if (widget.controller.posture == CaptchaPosture.misconfigured) {
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
    final CaptchaTokenController c = widget.controller;
    if (!c.renders) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, _) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        // 🔴 KEYED BY THE GENERATION: a spent token re-mounts the vendor widget,
        // which is a fresh challenge. Refreshing only on EXPIRY (~300 s) is what
        // left a failed sign-in retrying with a dead token (BUG-1).
        child: KeyedSubtree(
          key: ValueKey<int>(c.generation),
          child: widget.render(
            context,
            TurnstileChallenge(
              siteKey: c.siteKey,
              onToken: c.setToken,
              onError: (String message) {
                c.setToken(null);
                widget.onError?.call(message);
              },
            ),
          ),
        ),
      ),
    );
  }
}
