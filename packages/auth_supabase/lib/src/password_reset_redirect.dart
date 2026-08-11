/// Where a password-reset mail should send this build back to, and how to
/// recognise the arrival when it lands.
///
/// BOTH HALVES LIVE IN ONE FILE ON PURPOSE. The URL that is SENT and the parser
/// that READS it back are one contract with two ends; split across files they
/// drift, and the drift is invisible — a mail still sends, a link still
/// resolves, and only the person who followed it ever finds out.
///
/// PURE FUNCTIONS taking their inputs, rather than reading `kIsWeb` and
/// `Uri.base` themselves, for the reason `AuthCapabilities.forPlatform` is
/// written the same way: a value that can only be computed on the host it
/// describes is a value five of six platforms never check. Here it is worse than
/// that — the web arm is the ONLY arm that returns anything today, so a
/// self-reading version would be untestable on the one lane where the tests run.
library;

import 'package:nikatru_core/nikatru_core.dart' as core;

// 🔴 `PasswordResetArrival` AND ITS REPORT LIVE IN `packages/core`, NOT HERE.
// The router and the screen read them, and everything above the data layer
// programs against the seam rather than against whichever adapter is wired
// ([pipeline C-15]). What belongs in THIS package is the part that knows
// gotrue's redirect shape: the URL that is sent, and the parse that reads it
// back.
export 'package:nikatru_core/nikatru_core.dart'
    show PasswordResetArrival, PasswordResetArrivalReport;

/// The query parameter that marks a URL as OUR reset arrival.
///
/// 🔴 IT IS NOT DECORATION — IT IS WHAT KEEPS THIS OFF EVERY OTHER CALLBACK.
/// `?code=` is the shape of EVERY PKCE arrival, OAuth included, so a parser that
/// keyed on it alone would send somebody returning from Google sign-in to the
/// reset-password screen. gotrue preserves the query on both the success and the
/// failure redirect (measured live, 2026-08-11: `redirect_to=…/?nk_auth=reset`
/// with an invalid token answered `303` to
/// `…/?nk_auth=reset#error=access_denied&error_code=otp_expired`), and
/// `supabase_flutter`'s `removeAuthParametersFromUrl` strips only its own twelve
/// auth parameters and "preserv[es] any unrelated parameters" — so this survives
/// the SDK cleaning the URL after a successful exchange too.
const String kPasswordResetMarkerKey = 'nk_auth';
const String kPasswordResetMarkerValue = 'reset';

/// The URL to hand gotrue as `redirect_to`, or null to leave it to the project's
/// Site URL.
///
/// 🔴 THE ROUTE, THE MARKER, AND THE ORIGIN — ALL THREE, AND EACH ONE IS
/// LOAD-BEARING. The shape is `https://host/?nk_auth=reset#/reset-password`.
///
///   · THE ORIGIN AND THE `/` PATH, because gotrue appends `code=…` to the
///     QUERY. Flutter web here is on the HASH strategy (nothing in this
///     repository calls `usePathUrlStrategy`), so a bare `…/#/reset-password`
///     would put the code inside the fragment where `detectSessionInUri` never
///     looks — a reset link that quietly does nothing.
///   · THE FRAGMENT, because with hash routing the fragment IS the route. On the
///     success redirect gotrue keeps it (it sets the query and leaves the
///     fragment alone), so the user lands ON this screen rather than on home and
///     then being moved.
///   · THE MARKER, because the fragment is the one part that does NOT survive a
///     FAILURE. Measured live rather than reasoned about: an expired link
///     answers `303` with `Location: https://subly.nikatru.com/?nk_auth=reset#error=access_denied&error_code=otp_expired&…`
///     — the query intact, the fragment REPLACED by the error parameters. So on
///     the commonest real failure the route is gone and only the query can say
///     what this arrival was. [passwordResetArrivalOf] reads it.
///
/// ⚠️ THIS EXACT STRING MUST BE ON THE SUPABASE REDIRECT ALLOW-LIST. A
/// `redirect_to` that is not allow-listed does not error — gotrue silently
/// substitutes the project's Site URL, which is the same host here, so the flow
/// looks IDENTICAL while being wrong. Verified live on 2026-08-11 against
/// project `lcrkiurkvzhkonjwhpiv`: `uri_allow_list` holds
/// `https://subly.nikatru.com/**`, and a probe with this shape came back
/// pointing at `https://subly.nikatru.com/?nk_auth=reset#…` rather than at the
/// bare Site URL (`https://subly.nikatru.com`, no slash) — which is how an
/// ACCEPTED redirect is told apart from a substituted one.
///
/// [isWeb] false ⇒ null. No native target in this repository registers a custom
/// URI scheme yet (no `CFBundleURLTypes`, no `<data android:scheme>`, no
/// `.desktop` handler), so there is no address a native build could give that
/// would resolve. Returning the file: URI `Uri.base` reports off-web would be
/// worse than saying nothing.
String? passwordResetRedirectUrl({required bool isWeb, required Uri base}) {
  if (!isWeb) return null;
  // `Uri.origin` THROWS on anything that is not http(s) with a host — which is
  // exactly what `Uri.base` is under a VM test runner. Guarded rather than
  // caught, so the refusal is a decision and not an exception path.
  if (!base.isScheme('http') && !base.isScheme('https')) return null;
  if (base.host.isEmpty) return null;
  return '${base.origin}/'
      '?$kPasswordResetMarkerKey=$kPasswordResetMarkerValue'
      '#/reset-password';
}

/// Classify the URL this app was launched with.
///
/// 🔴 READS THE FRAGMENT AS WELL AS THE QUERY, and both are necessary rather
/// than belt-and-braces. gotrue puts the SUCCESS parameters in the query
/// (`?code=`) and the FAILURE parameters in the fragment
/// (`#error=access_denied&error_code=otp_expired`) — the same split
/// `supabase_flutter`'s own `_isAuthCallbackDeeplink` reads both sides for
/// (`supabase_auth.dart:203-213`).
///
/// 🔴 AND IT REFUSES ANY URL WITHOUT OUR MARKER. See [kPasswordResetMarkerKey]:
/// `?code=` is every PKCE arrival, so keying on it alone would route somebody
/// coming back from an OAuth sign-in to the reset screen.
core.PasswordResetArrivalReport passwordResetArrivalOf(Uri url) {
  Map<String, String> fragmentParams;
  try {
    fragmentParams = Uri.splitQueryString(url.fragment);
  } catch (_) {
    // A fragment that is a ROUTE rather than a parameter list is the ordinary
    // case here (`#/reset-password`), and `splitQueryString` is total over it —
    // but a percent-decoding failure is not, and this parser deciding the
    // app's first route must not be able to throw.
    fragmentParams = const <String, String>{};
  }
  final Map<String, String> query = url.queryParameters;
  String? param(String key) => query[key] ?? fragmentParams[key];

  if (param(kPasswordResetMarkerKey) != kPasswordResetMarkerValue) {
    return core.PasswordResetArrivalReport.none;
  }
  final String? error =
      param('error') ?? param('error_code') ?? param('error_description');
  if (error != null) {
    return core.PasswordResetArrivalReport(
      core.PasswordResetArrival.unusable,
      // The SAME classifier the seam runs over an exception message, given the
      // three error parameters joined. `error_code=otp_expired` is what gotrue
      // really sends for an expired or already-spent link (measured live), and
      // it reaches `expiredOrUsed` through the `otp_expired` arm — so the URL
      // path and the exception path cannot disagree about what to tell the user.
      problem: core.authLinkProblemOf(
        <String?>[
          param('error'),
          param('error_code'),
          param('error_description'),
        ].whereType<String>().join(' '),
      ),
    );
  }
  // `code` present ⇒ the exchange is about to run. `code` ABSENT with the marker
  // still there ⇒ the SDK has already exchanged it and cleaned its own
  // parameters out of the URL, leaving ours behind. Both are "a reset is in
  // flight"; neither is a failure.
  return const core.PasswordResetArrivalReport(
    core.PasswordResetArrival.pending,
  );
}
