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
// rendered challenge has not answered, so a gated call WAITS for one
// ([CaptchaTokenController.untilReady]) instead of sending no token at all.
//
// ── 🔴 A CAPTCHA THAT HAS NOT ANSWERED NEVER DISABLES A BUTTON (2026-09-28)
//
// ST-T1 (#1022) gated every auth action on `ready`. A Turnstile widget with no
// token — a slow network, a blocked script, a headless browser — therefore left
// a DEAD button with no reason given: an empty form could not even be told
// "Enter your email" (E2E live run 36379673890; WCAG 3.3.1 / 4.1.3). The rule
// now, for every gated action: the button is enabled unless a request is in
// flight; the action VALIDATES ITS FIELDS FIRST, with no captcha needed; only a
// valid submit then awaits [CaptchaTokenController.untilReady], which shows
// [CaptchaWaitStatus] ("Checking you're human…", a live region), and sends ONCE
// when the token lands — or throws [CaptchaUnavailable], which the one error
// mapper turns into a retry sentence. Never a silent no-op.
// `assert-captcha-gated-call-sites.mjs` limb R4 fails the build if any action
// is disabled on captcha readiness again.
// ─────────────────────────────────────────────────────────────────────────────

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisL10nX;

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
  ///
  /// ⛔ NEVER A BUTTON'S `onPressed` GATE — see the header. A call site awaits
  /// [untilReady] after its own validation instead.
  bool get ready => !renders || _token != null;

  /// How long a valid submit waits for the challenge before saying so.
  static const Duration defaultWait = Duration(seconds: 20);

  Completer<void>? _wait;
  Timer? _waitTimer;
  bool _disposed = false;

  /// True while a gated action is waiting for the challenge to answer — what
  /// [CaptchaWaitStatus] shows.
  bool get waiting => _wait != null;

  /// Completes once a gated call may be made: at once when [ready], else when
  /// the challenge answers. Throws [CaptchaUnavailable] when it does not
  /// answer within [timeout] or reports an error — the caller's error mapper
  /// shows the retry sentence, and a FRESH challenge is mounted for the retry.
  ///
  /// It does not hand out the token: the gated call still spends it through
  /// [consume], in the same synchronous step, so no await can let it expire
  /// or be spent twice in between.
  Future<void> untilReady({Duration timeout = defaultWait}) {
    if (ready) return Future<void>.value();
    final Completer<void>? pending = _wait;
    if (pending != null) return pending.future;
    final Completer<void> wait = _wait = Completer<void>();
    _waitTimer = Timer(
      timeout,
      () => _endWait(const CaptchaUnavailable('timeout')),
    );
    notifyListeners();
    return wait.future;
  }

  void _endWait([CaptchaUnavailable? failure]) {
    final Completer<void>? wait = _wait;
    if (wait == null) return;
    _wait = null;
    _waitTimer?.cancel();
    _waitTimer = null;
    if (failure == null) {
      wait.complete();
    } else {
      // A challenge that did not answer is re-mounted, so the retry the
      // sentence asks for meets a live one rather than the one that failed.
      _generation++;
      wait.completeError(failure);
    }
    if (!_disposed) notifyListeners();
  }

  /// The renderer's answer: a fresh token, or null when the last one stopped
  /// being usable (expiry, timeout, error).
  void setToken(String? token) {
    if (_token == token) return;
    _token = token;
    if (token != null && _wait != null) {
      _endWait();
      return;
    }
    notifyListeners();
  }

  /// The challenge itself failed: the token is gone, and a waiting action is
  /// told so at once instead of waiting out its timeout.
  void reportError(String message) {
    _token = null;
    if (_wait != null) {
      _endWait(CaptchaUnavailable(message));
      return;
    }
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

  @override
  void dispose() {
    _disposed = true;
    // A screen torn down mid-wait: the action is told, and nothing is sent.
    _endWait(const CaptchaUnavailable('disposed'));
    super.dispose();
  }
}

/// A gated action could not get a captcha token: the challenge timed out or
/// failed. `authErrorText` maps it to `authCaptchaUnavailable` — a sentence
/// that says to retry, never a silent no-op.
class CaptchaUnavailable implements Exception {
  const CaptchaUnavailable(this.reason);

  /// `timeout`, `disposed`, or the challenge's own error — for logs only.
  final String reason;

  @override
  String toString() => 'CaptchaUnavailable($reason)';
}

/// The visible, ANNOUNCED half of a wait: "Checking you're human…" under the
/// gated button while [waiting], nothing otherwise. A live region, so a screen
/// reader hears why the button is busy (WCAG 4.1.3).
class CaptchaWaitStatus extends StatelessWidget {
  const CaptchaWaitStatus({required this.waiting, super.key});

  static const Key statusLine = Key('captchaWaitStatus');

  final bool waiting;

  @override
  Widget build(BuildContext context) {
    if (!waiting) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Semantics(
        container: true,
        liveRegion: true,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const ExcludeSemantics(
              child: SizedBox.square(
                dimension: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                context.chassisL10n.authCaptchaChecking,
                key: statusLine,
              ),
            ),
          ],
        ),
      ),
    );
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
                c.reportError(message);
                widget.onError?.call(message);
              },
            ),
          ),
        ),
      ),
    );
  }
}
