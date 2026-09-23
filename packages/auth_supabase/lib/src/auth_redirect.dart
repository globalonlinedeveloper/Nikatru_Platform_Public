/// Where every mail or browser hop that leaves this app should send the user
/// back to, and how to recognise the arrival when it lands.
///
/// ⏱ 2026-09-23 — THIS WAS `password_reset_redirect.dart`, AND IT ANSWERED FOR
/// ONE FLOW OF FIVE. The reset mail carried a `redirect_to`; the sign-up
/// confirmation, the resend, the OAuth browser hop and the identity link did
/// not, so gotrue sent all four to the project's Site URL — one URL for the
/// whole portfolio — and every native build had no address at all, because no
/// native target registered a URI scheme. One derivation now answers every flow
/// on every target, and `tooling/ci/assert-auth-callbacks.mjs` proves both
/// halves: each native target REGISTERS the scheme derived here, and each
/// link-sending GoTrue call in this package PASSES the value derived here.
///
/// BOTH HALVES LIVE IN ONE FILE ON PURPOSE. The URL that is SENT and the parser
/// that READS it back are one contract with two ends; split across files they
/// drift, and the drift is invisible — a mail still sends, a link still
/// resolves, and only the person who followed it ever finds out.
///
/// PURE FUNCTIONS taking their inputs, rather than reading `kIsWeb` and
/// `Uri.base` themselves, for the reason `AuthCapabilities.forPlatform` is
/// written the same way: a value that can only be computed on the host it
/// describes is a value five of six platforms never check. [AuthRedirects.current]
/// is the one thin wrapper that reads the host, and it holds no logic.
library;

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, immutable, kIsWeb;
import 'package:nikatru_core/nikatru_core.dart' as core;

// 🔴 `PasswordResetArrival` AND ITS REPORT LIVE IN `packages/core`, NOT HERE.
// The router and the screen read them, and everything above the data layer
// programs against the seam rather than against whichever adapter is wired
// ([pipeline C-15]). What belongs in THIS package is the part that knows
// gotrue's redirect shape: the URL that is sent, and the parse that reads it
// back.
export 'package:nikatru_core/nikatru_core.dart'
    show PasswordResetArrival, PasswordResetArrivalReport;

/// Every flow that sends the user OUT of the app and expects them back.
///
/// The [marker] is what rides in the query as `nk_auth=<marker>`, and it is also
/// what `tooling/mail-transport.json` `supabaseAuth.uri_allow_list` carries one
/// exact native entry for — the guard reads the markers off THIS enum, so a
/// flow added here without its allow-list entry is a red build, not a mail that
/// silently lands on the Site URL.
enum AuthFlow {
  /// The sign-up confirmation mail, and its resend.
  signUpConfirm('confirm'),

  /// The OAuth browser hop (Sign in with Apple, Google).
  oauth('oauth'),

  /// Linking a second identity to a signed-in account.
  linkIdentity('link'),

  /// The password-reset mail. The only flow whose web URL carries a route.
  reset('reset'),

  /// The mail that confirms a changed email address.
  emailChange('email-change');

  const AuthFlow(this.marker);

  /// The `nk_auth` value for this flow. Lower-case letters and `-` only: it is
  /// matched against the allow-list by gotrue's glob, where `.` and `/` are
  /// separators and must never appear inside a marker.
  final String marker;
}

/// The query parameter that marks a URL as one of OUR arrivals.
///
/// 🔴 IT IS NOT DECORATION — IT IS WHAT KEEPS ONE FLOW OFF ANOTHER'S SCREEN.
/// `?code=` is the shape of EVERY PKCE arrival, so a parser that keyed on it
/// alone would send somebody returning from Google sign-in to the reset-password
/// screen. gotrue preserves the query on both the success and the failure
/// redirect (measured live, 2026-08-11: `redirect_to=…/?nk_auth=reset` with an
/// invalid token answered `303` to
/// `…/?nk_auth=reset#error=access_denied&error_code=otp_expired`), and
/// `supabase_flutter`'s `removeAuthParametersFromUrl` strips only its own twelve
/// auth parameters and "preserv[es] any unrelated parameters" — so this survives
/// the SDK cleaning the URL after a successful exchange too.
const String kAuthMarkerKey = 'nk_auth';

/// The reset flow's pair, kept under its old names because they are public
/// API of this package and the reset screen's contract is unchanged.
const String kPasswordResetMarkerKey = kAuthMarkerKey;
const String kPasswordResetMarkerValue = 'reset';

/// The host every native callback lands on: `<scheme>://auth-callback`.
const String kAuthCallbackHost = 'auth-callback';

/// A URI scheme may carry `+`, `-` and `.` (RFC 3986 §3.1) but the app id is
/// also the last label of a reverse-DNS identity (`com.nikatru.<id>`, the
/// bundle id, the Android application id, the Flatpak/snap desktop id), where
/// `-` and `_` are not interchangeable across stores. Lower-case letters and
/// digits are the set every one of those accepts.
final RegExp _schemeSafeAppId = RegExp(r'^[a-z][a-z0-9]*$');

/// The custom URI scheme a native build of [appId] registers with its OS.
///
/// 🔴 REVERSE-DNS, NEVER THE BARE APP ID. RFC 8252 §7.1 asks a native app to
/// use a scheme based on a domain it controls, and the reason is concrete: a
/// bare word (`subscriptiontracker://`, which `docs/platform/supabase/README.md`
/// once proposed) can be registered by ANY app on the device, and whichever one
/// the OS picks receives the PKCE code. `com.nikatru.<id>` is the identity the
/// stores already bind to this company.
///
/// DERIVED, NEVER TYPED PER TARGET. Android, iOS, macOS, Windows and Linux each
/// declare this string in a different file format; the guard derives it the
/// same way from `apps/<id>/app.yaml` and reads each file for it.
String authCallbackScheme(String appId) {
  if (!_schemeSafeAppId.hasMatch(appId)) {
    throw ArgumentError.value(
      appId,
      'appId',
      'must match ${_schemeSafeAppId.pattern} to form the URI scheme '
          'com.nikatru.<appId> — a URI scheme cannot carry `_`',
    );
  }
  return 'com.nikatru.$appId';
}

/// The URL to hand gotrue as `redirect_to` / `emailRedirectTo` for [flow], or
/// null where no address can exist.
///
/// ON NATIVE (android, iOS, macOS, windows, linux) it is
/// `com.nikatru.<appId>://auth-callback?nk_auth=<marker>` — the scheme each of
/// those targets registers with its OS, which is how the PKCE code comes back
/// to the SAME installation that holds the verifier. `supabase_flutter` listens
/// for it (through its own `app_links` dependency) and runs the exchange; this
/// app only has to register the scheme and say where to come back to.
///
/// ON WEB it is the per-origin URL, `https://host/<base path>/?nk_auth=<marker>`,
/// plus `#/reset-password` for [AuthFlow.reset] alone. The four parts, and why
/// each is load-bearing:
///
///   · THE BASE PATH, because this build is NOT served at the origin root. The
///     web bundle is built with `--base-href /<app id>/`, so the app's home is
///     `https://<apex>/<app id>/` and the apex itself is a DIFFERENT document.
///     A redirect composed from `origin` alone lands there. It is DERIVED from
///     the running URL and never named.
///   · THE TRAILING `/` AND THE QUERY AFTER IT, because gotrue appends `code=…`
///     to the QUERY. Flutter web here is on the HASH strategy (nothing in this
///     repository calls `usePathUrlStrategy`), so a bare `…/#/reset-password`
///     would put the code inside the fragment where `detectSessionInUri` never
///     looks — a link that quietly does nothing.
///   · THE FRAGMENT (reset only), because with hash routing the fragment IS the
///     route. On the success redirect gotrue keeps it, so the user lands ON the
///     reset screen. The other flows land on the app root and the router moves a
///     signed-in user on, as it does for any sign-in.
///   · THE MARKER, because the fragment is the one part that does NOT survive a
///     FAILURE: an expired link answers `303` with the redirect it was handed,
///     the query intact and the fragment REPLACED by the error parameters
///     (measured live 2026-08-11). [authArrivalOf] reads it.
///
/// ⚠️ EVERY VALUE THIS RETURNS MUST BE ON THE SUPABASE REDIRECT ALLOW-LIST.
/// gotrue does not error on a `redirect_to` that is not: it SILENTLY
/// SUBSTITUTES the project's Site URL, so a wrong entry and a right one both
/// produce mail that sends and a link that resolves. The web entries are scoped
/// to the app's base path (`https://<apex>/<app id>/**`, never
/// `https://<apex>/**`); the native entries are EXACT, one per [AuthFlow],
/// because gotrue's glob treats `?` as "one non-separator character", which the
/// literal `?` before `nk_auth` is. The record of the list is
/// `tooling/mail-transport.json` `supabaseAuth.uri_allow_list`, and the only
/// evidence it is live is reading it back from the Management API — "the flow
/// works" never is.
///
/// [baseHref] (web only) is the resolved `<base href>` of the document and is
/// the AUTHORITATIVE base path when the caller can supply it. Left null, the
/// base path is derived from [base] (`Uri.base`), which is exact under the hash
/// strategy. 🔴 IF THIS APP EVER ADOPTS `usePathUrlStrategy`, THAT DERIVATION
/// STOPS BEING TRUE and the caller MUST pass [baseHref].
///
/// [isWeb] wins over [platform]: a web build still reports a host
/// [TargetPlatform], and a browser is its own target for this question.
///
/// NULL IN EXACTLY TWO CASES: fuchsia, which is not a target of this portfolio,
/// and a web [base] that is not http(s) with a host (the VM test runner's
/// `file:` URI), where no allow-list entry could ever match. Never null for a
/// real target.
String? authRedirectUrl({
  required AuthFlow flow,
  required bool isWeb,
  required TargetPlatform platform,
  required Uri base,
  required String appId,
  String? baseHref,
}) {
  if (isWeb) return _webRedirectUrl(flow, base: base, baseHref: baseHref);
  return switch (platform) {
    TargetPlatform.android ||
    TargetPlatform.iOS ||
    TargetPlatform.macOS ||
    TargetPlatform.windows ||
    TargetPlatform.linux =>
      '${authCallbackScheme(appId)}://$kAuthCallbackHost'
          '?$kAuthMarkerKey=${flow.marker}',
    TargetPlatform.fuchsia => null,
  };
}

String? _webRedirectUrl(AuthFlow flow, {required Uri base, String? baseHref}) {
  // A `<base href>` is ordinarily relative (`/<app id>/`), so it is RESOLVED
  // against the running URL rather than parsed alone. `tryParse` because this
  // value crosses in from the DOM: a malformed one must degrade to the
  // derivation, not throw out of the provider that builds the auth repository.
  final Uri? href =
      baseHref == null || baseHref.isEmpty ? null : Uri.tryParse(baseHref);
  final Uri deployed = href == null ? base : base.resolveUri(href);
  // `Uri.origin` THROWS on anything that is not http(s) with a host — which is
  // exactly what `Uri.base` is under a VM test runner. Guarded rather than
  // caught, so the refusal is a decision and not an exception path.
  if (!deployed.isScheme('http') && !deployed.isScheme('https')) return null;
  if (deployed.host.isEmpty) return null;
  final String route = flow == AuthFlow.reset ? '#/reset-password' : '';
  return '${deployed.origin}${_deployedBasePath(deployed.path)}'
      '?$kAuthMarkerKey=${flow.marker}$route';
}

/// The DIRECTORY [path] is served from, always leading- and trailing-slashed.
///
///   · `/<app id>/` — the address bar under a base href. Already the directory.
///   · `/<app id>` — the same deployment before the server's directory redirect
///     has run. Stripping the last segment here is the bug this unit exists to
///     prevent, so a final segment that names no FILE is the directory it is.
///   · `/<app id>/index.html` — what `document.baseURI` reports when the document
///     carries no `<base>` tag. The file is dropped.
///
/// A segment counts as a file when it carries a dot, which is also why a
/// path-strategy route would be misread as a directory — see the `baseHref`
/// escape hatch on [authRedirectUrl].
String _deployedBasePath(String path) {
  if (path.isEmpty) return '/';
  final String rooted = path.startsWith('/') ? path : '/$path';
  final int lastSlash = rooted.lastIndexOf('/');
  final String last = rooted.substring(lastSlash + 1);
  if (last.isEmpty) return rooted;
  if (last.contains('.')) return rooted.substring(0, lastSlash + 1);
  return '$rooted/';
}

/// The redirect for each [AuthFlow], bound to one build's inputs.
///
/// What `SupabaseAuthRepository` takes instead of the single reset URL it used
/// to: the adapter asks for the flow it is about to start, and cannot forget a
/// flow, because `assert-auth-callbacks.mjs` fails the build on a link-sending
/// call that does not pass `redirects(AuthFlow.<flow>)`.
@immutable
final class AuthRedirects {
  const AuthRedirects({
    required String this.appId,
    required this.isWeb,
    required TargetPlatform this.platform,
    required Uri this.base,
    this.baseHref,
  });

  const AuthRedirects._none()
      : appId = null,
        isWeb = false,
        platform = null,
        base = null,
        baseHref = null;

  /// Sends no redirect for any flow — gotrue then uses the project's Site URL.
  /// The default for a repository nobody configured (tests, the in-memory
  /// wiring); never what a shipping app passes.
  static const AuthRedirects none = AuthRedirects._none();

  /// The redirects for the build this is running in. The ONLY place that reads
  /// the host; everything it decides is [authRedirectUrl]'s.
  factory AuthRedirects.current({required String appId, String? baseHref}) =>
      AuthRedirects(
        appId: appId,
        isWeb: kIsWeb,
        platform: defaultTargetPlatform,
        base: Uri.base,
        baseHref: baseHref,
      );

  final String? appId;
  final bool isWeb;
  final TargetPlatform? platform;
  final Uri? base;
  final String? baseHref;

  /// The redirect for [flow], or null ([none], fuchsia, a non-http web base).
  String? call(AuthFlow flow) {
    final String? id = appId;
    final TargetPlatform? p = platform;
    final Uri? b = base;
    if (id == null || p == null || b == null) return null;
    return authRedirectUrl(
      flow: flow,
      isWeb: isWeb,
      platform: p,
      base: b,
      appId: id,
      baseHref: baseHref,
    );
  }
}

/// What [authArrivalOf] read off a launch URL: WHICH flow, and in what state.
///
/// [arrival] reuses core's three states (`none` / `pending` / `unusable`),
/// which say nothing reset-specific; only their type name does.
@immutable
final class AuthArrivalReport {
  const AuthArrivalReport(this.flow, this.arrival, {this.problem});

  /// Not one of our arrivals.
  static const AuthArrivalReport none =
      AuthArrivalReport(null, core.PasswordResetArrival.none);

  /// Null exactly when [arrival] is `none`.
  final AuthFlow? flow;
  final core.PasswordResetArrival arrival;

  /// Set only when [arrival] is `unusable`.
  final core.AuthLinkProblem? problem;

  @override
  bool operator ==(Object other) =>
      other is AuthArrivalReport &&
      other.flow == flow &&
      other.arrival == arrival &&
      other.problem == problem;

  @override
  int get hashCode => Object.hash(flow, arrival, problem);

  @override
  String toString() => 'AuthArrivalReport($flow, $arrival, problem: $problem)';
}

/// Classify the URL this app was opened with, for EVERY flow.
///
/// 🔴 READS THE FRAGMENT AS WELL AS THE QUERY, and both are necessary. gotrue
/// puts the SUCCESS parameters in the query (`?code=`) and the FAILURE
/// parameters in the fragment (`#error=access_denied&error_code=otp_expired`) —
/// the same split `supabase_flutter`'s own `_isAuthCallbackDeeplink` reads both
/// sides for. The web URL and the native `com.nikatru.<id>://auth-callback?…`
/// URL have the same query and fragment, so one parser serves both.
///
/// 🔴 AND IT REFUSES ANY URL WITHOUT A MARKER IT KNOWS. `?code=` is every PKCE
/// arrival; a marker VALUE this enum does not carry is some future flow's, and
/// is none of this parser's business.
AuthArrivalReport authArrivalOf(Uri url) {
  Map<String, String> fragmentParams;
  try {
    fragmentParams = Uri.splitQueryString(url.fragment);
  } catch (_) {
    // A fragment that is a ROUTE rather than a parameter list is the ordinary
    // case (`#/reset-password`), and `splitQueryString` is total over it — but
    // a percent-decoding failure is not, and this parser deciding the app's
    // first route must not be able to throw.
    fragmentParams = const <String, String>{};
  }
  Map<String, String> query;
  try {
    query = url.queryParameters;
  } catch (_) {
    query = const <String, String>{};
  }
  String? param(String key) => query[key] ?? fragmentParams[key];

  final String? marker = param(kAuthMarkerKey);
  AuthFlow? flow;
  for (final AuthFlow f in AuthFlow.values) {
    if (f.marker == marker) flow = f;
  }
  if (flow == null) return AuthArrivalReport.none;

  final String? error =
      param('error') ?? param('error_code') ?? param('error_description');
  if (error != null) {
    return AuthArrivalReport(
      flow,
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
  // parameters out of the URL, leaving ours behind. Both are "in flight";
  // neither is a failure.
  return AuthArrivalReport(flow, core.PasswordResetArrival.pending);
}

/// [authArrivalOf], projected onto the reset flow — the one arrival with a
/// screen of its own. Every other flow lands on the ordinary signed-in route,
/// so this answers `none` for them.
core.PasswordResetArrivalReport passwordResetArrivalOf(Uri url) {
  final AuthArrivalReport r = authArrivalOf(url);
  if (r.flow != AuthFlow.reset) return core.PasswordResetArrivalReport.none;
  return switch (r.arrival) {
    core.PasswordResetArrival.none => core.PasswordResetArrivalReport.none,
    core.PasswordResetArrival.pending => const core.PasswordResetArrivalReport(
        core.PasswordResetArrival.pending,
      ),
    core.PasswordResetArrival.unusable => core.PasswordResetArrivalReport(
        core.PasswordResetArrival.unusable,
        problem: r.problem,
      ),
  };
}
