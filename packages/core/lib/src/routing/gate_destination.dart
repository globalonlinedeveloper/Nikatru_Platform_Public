// ─────────────────────────────────────────────────────────────────────────────
// gate_destination.dart — WHERE A SATISFIED AUTH GATE SENDS THE USER, and the
// validation that stops a stranger choosing that destination for them.
//
// 🔴 WHY THIS IS SHARED CODE AND NOT A ROUTER DETAIL. Until 2026-09-04 all four
// functions below existed TWICE — in `apps/subly/lib/core/router.dart` and in
// the app brick's `core/router.dart` — with **byte-identical bodies**, verified
// by extracting and comparing them. Two copies of an open-redirect validator
// means a security fix applied to one tree is invisible to the other, and
// nothing anywhere would have said so. `apps/subly` predates the brick and was
// never stamped from it, so there was no mechanism by which the two could ever
// have converged on their own.
//
// ⚠️ WHAT DELIBERATELY DID **NOT** MOVE: the list of locations that may never be
// a destination. Subly's carries `/login` (its legacy alias) and the brick's
// does not, because the brick has no such route — that difference is real and
// per-app. So the LOGIC is shared and the LIST is a parameter. Moving the list
// too would have forced one app's route table onto every other app, which is the
// opposite of the change.
//
// ⚠️ AND WHY IT LIVES IN `packages/core` RATHER THAN A NEW PACKAGE: every
// function here is pure Dart over `Uri` and `String`. It needs neither
// `go_router` nor `flutter_riverpod`, so it required no new dependency and no
// new package — which matters, because `assert-package-earned.mjs` accepts only
// a native payload, a licence exposure or a codegen step as a reason to create
// one, and "somewhere to put shared code" is explicitly not a reason.
//
// The callers keep their thin private wrappers so the router reads the same as
// before; those wrappers pass their own route list in.
// ─────────────────────────────────────────────────────────────────────────────

/// The address a confirmation mail was just sent to, as carried by
/// `context.go('/check-inbox', extra: …)`.
///
/// An empty string is treated as absent: a sign-up cannot have mailed nowhere,
/// so the honest answer for one is the same as for a missing address.
///
/// Takes the raw `extra` rather than a router state so this file stays free of
/// `go_router` — see the header.
String? pendingAddress(Object? extra) =>
    extra is String && extra.isNotEmpty ? extra : null;

/// The banked `?next=`, or null when the query cannot be decoded at all.
///
/// 🔴 `Uri.queryParameters` THROWS, AND A REDIRECT THAT THROWS TAKES THE WHOLE
/// APP DOWN. MEASURED against the real SDK, not reasoned: escapes that are
/// well-formed HEX but not well-formed UTF-8 pass through `Uri.parse` untouched
/// and blow up only on decode — `?next=%FF` raises `FormatException: Invalid
/// UTF-8 byte`, `?next=%E0%A4%A` raises `Missing extension byte`. Worse, this
/// getter decodes the WHOLE query, so `?a=%ED%A0%80&next=%2Fhome` throws on a
/// key nothing here reads. `/reaccept-terms` and `/verify-email` are public
/// URLs and the read below runs for every user who does NOT owe the gate — the
/// common case — so without this catch one typed link is an app-wide crash.
/// (`Uri.parse` itself does not throw: it rewrites a non-hex `%zz` to `%25zz`.)
String? bankedNext(Uri uri) {
  try {
    return uri.queryParameters['next'];
  } on FormatException {
    return null;
  }
}

/// Where a satisfied gate hands the user: the destination it took, or
/// [fallback] when it never took one.
///
/// 🔴 VALIDATED, NEVER TRUSTED. `next` rides in a URL, so on web anybody can
/// type one. Only a single-slash absolute path is honoured: `//evil.test` is a
/// protocol-relative URL a browser resolves OFF-ORIGIN, and anything carrying a
/// scheme is an open redirect. A `next` naming another gate is refused too — it
/// would re-open the screen just cleared, and a nested one walks go_router's
/// redirect limit down to the errorBuilder. The query and fragment are split
/// off before that comparison so `?next=%2Fverify-email%3Fx%3D1` cannot smuggle
/// a gate past a whole-string match.
///
/// [neverADestination] is the caller's own route list — see the header for why
/// it is a parameter and not a constant in here.
String nextOr(
  Uri uri,
  String fallback, {
  required Set<String> neverADestination,
}) {
  final String? next = bankedNext(uri);
  if (next == null || !next.startsWith('/') || next.startsWith('//')) {
    return fallback;
  }
  final String path = next.split('?').first.split('#').first;
  return neverADestination.contains(path) ? fallback : next;
}

/// `<gate>?next=<where they were going>`, or a bare `<gate>` when the current
/// location is not somewhere anybody can be sent back to.
///
/// The WHOLE uri is carried rather than the matched location, so a deep link's
/// own query survives the detour and `/sub/42?from=mail` comes back intact.
/// `toString()` never decodes, so a query this app cannot read still travels.
String gateWithNext(
  String gate, {
  required String matchedLocation,
  required Uri uri,
  required Set<String> neverADestination,
}) {
  if (neverADestination.contains(matchedLocation)) return gate;
  return '$gate?next=${Uri.encodeComponent(uri.toString())}';
}
