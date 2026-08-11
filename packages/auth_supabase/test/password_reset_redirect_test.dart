// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE RECOVERY MAIL SENDS PEOPLE BACK TO.
//
// 🔴 THE FAILURE THIS RULES OUT IS INVISIBLE FROM INSIDE THE APP. gotrue does
// not reject a `redirect_to` it dislikes and does not error on a null one — it
// silently substitutes the PROJECT's Site URL. So a wrong value, an absent
// value and a correct value all produce mail that sends, a link that resolves
// and a page that loads. The only observable difference is which app the user
// ends up in, and one Supabase project authenticates the whole portfolio.
//
// ⚠️ THE ORIGIN, NOT THE ROUTE, AND THE REASON IS THE URL STRATEGY. Nothing in
// this repository calls `usePathUrlStrategy`, so Flutter web is on the HASH
// strategy and the reset screen's real address is `https://host/#/reset-password`
// — the route is in the FRAGMENT. gotrue appends `?code=…` to whatever it is
// handed; append it to that and the code lands inside the fragment, where
// `detectSessionInUri` never looks. No error, no session, no screen: a reset
// link that quietly does nothing. Landing on the root and letting the SDK read
// `?code=` off the query is what makes the flow work at all — and it is why the
// app has to learn "this is a recovery" from the EVENT rather than from the URL.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' show AuthLinkProblem;

void main() {
  group('passwordResetRedirectUrl', () {
    // ALL THREE PARTS ASSERTED TOGETHER, because each one is load-bearing for a
    // different failure: the ORIGIN sends a preview deployment's users back to
    // itself; the `/` PATH keeps gotrue's `?code=` in the real query where the
    // SDK reads it (with hash routing a bare `.../#/reset-password` would bury
    // it in the fragment); the FRAGMENT is the route, so a SUCCESSFUL link lands
    // on this screen rather than on home; and the MARKER is the part that
    // survives a FAILURE, where gotrue replaces the fragment with its own error
    // parameters — measured live, not assumed.
    test('on web it is the ORIGIN, the MARKER and the ROUTE', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://subly.nikatru.com/#/settings'),
        ),
        'https://subly.nikatru.com/?nk_auth=reset#/reset-password',
      );
    });

    test('the port is carried — localhost dev is a different origin', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('http://localhost:8080/'),
        ),
        'http://localhost:8080/?nk_auth=reset#/reset-password',
        reason: 'an origin that dropped the port would send every local run to '
            'the production site, which is a reset link that works and takes '
            'the developer somewhere else entirely',
      );
    });

    // THE ROUND TRIP, which is the property that actually matters: whatever this
    // function SENDS must be recognised by the parser that READS it back. They
    // are one contract with two ends, and the way they come apart is silent.
    test('what it sends is what the arrival parser recognises', () {
      final String sent = passwordResetRedirectUrl(
        isWeb: true,
        base: Uri.parse('https://subly.nikatru.com/'),
      )!;
      expect(
        passwordResetArrivalOf(Uri.parse(sent)).arrival,
        PasswordResetArrival.pending,
      );
    });

    // 🔴 NULL, NOT A FABRICATED SCHEME. No native target in this repository
    // registers a URI scheme yet — no CFBundleURLTypes, no <data android:scheme>,
    // no .desktop handler — so there is no address a native build could give
    // that would resolve. Returning the `file:` URI `Uri.base` reports off-web
    // would be worse than saying nothing: it is not on any allow-list, so gotrue
    // falls back to the Site URL anyway, with the reason hidden.
    test('off web it declines rather than inventing an address', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: false,
          base: Uri.parse('https://subly.nikatru.com/'),
        ),
        isNull,
        reason: 'isWeb wins over the URI — a web build still reports a host '
            'TargetPlatform, and a desktop build handed a plausible https URI '
            'still has nothing registered to receive it',
      );
    });

    // The VM's `Uri.base` is a `file:` directory URI, and `Uri.origin` THROWS on
    // one. Guarded rather than caught: the refusal is a decision this function
    // makes, not an exception path it survives.
    test('a non-http base is refused instead of throwing', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('file:///C:/src/app/'),
        ),
        isNull,
      );
      expect(
        passwordResetRedirectUrl(isWeb: true, base: Uri.parse('https:///path')),
        isNull,
        reason: 'no host is no origin',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE PARSER, AGAINST URLS MEASURED OFF THE LIVE PROJECT — not invented.
  //
  // Every URL below is a real `Location:` answered by the real gotrue instance
  // (project lcrkiurkvzhkonjwhpiv) on 2026-08-11, by handing
  // `/auth/v1/verify?type=recovery` a deliberately invalid token with each
  // `redirect_to` in turn. A fixture written from the documentation would encode
  // what the docs say; these encode what the server does — including the part
  // that decided this design, which is that the FRAGMENT does not survive a
  // failure and the QUERY does.
  group('passwordResetArrivalOf', () {
    test('an EXPIRED link is unusable, and typed as expired', () {
      final report = passwordResetArrivalOf(
        Uri.parse(
          'https://subly.nikatru.com/?nk_auth=reset'
          '#error=access_denied&error_code=otp_expired'
          '&error_description=Email+link+is+invalid+or+has+expired&sb=',
        ),
      );
      expect(report.arrival, PasswordResetArrival.unusable);
      expect(
        report.problem,
        AuthLinkProblem.expiredOrUsed,
        reason:
            'the same classifier the seam runs over an exception message, so '
            'the URL path and the exception path cannot tell the user two '
            'different things about one situation',
      );
    });

    test('a link still carrying its code is PENDING', () {
      expect(
        passwordResetArrivalOf(
          Uri.parse(
            'https://subly.nikatru.com/?nk_auth=reset&code=abc123'
            '#/reset-password',
          ),
        ).arrival,
        PasswordResetArrival.pending,
      );
    });

    test('the marker alone is still PENDING — the SDK cleaned up after itself',
        () {
      // `removeAuthParametersFromUrl` strips the SDK's own twelve auth
      // parameters and preserves everything else, so after a SUCCESSFUL
      // exchange the URL is exactly this. Reading it as `none` would drop the
      // user off the screen they are standing on.
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://subly.nikatru.com/?nk_auth=reset#/reset-password'),
        ).arrival,
        PasswordResetArrival.pending,
      );
    });

    // THE CASE THE MARKER EXISTS FOR. `?code=` is the shape of EVERY PKCE
    // arrival, OAuth included. Without the marker this parser would route
    // somebody returning from a Google sign-in to the reset-password screen — a
    // defect strictly worse than the one it fixes, because it would hit users
    // who never asked for a reset at all.
    test('an OAuth callback with a code is NOT a reset arrival', () {
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://subly.nikatru.com/?code=oauth-code-here'),
        ).arrival,
        PasswordResetArrival.none,
      );
      expect(
        passwordResetArrivalOf(
          Uri.parse(
            'https://subly.nikatru.com/'
            '#error=access_denied&error_code=otp_expired',
          ),
        ).arrival,
        PasswordResetArrival.none,
        reason: 'an error with no marker belongs to some other flow — a signup '
            'confirmation, a magic link — and this screen has nothing to say '
            'about it',
      );
    });

    test('an ordinary launch is none, and a route fragment does not confuse it',
        () {
      expect(
        passwordResetArrivalOf(Uri.parse('https://subly.nikatru.com/')).arrival,
        PasswordResetArrival.none,
      );
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://subly.nikatru.com/#/budget'),
        ).arrival,
        PasswordResetArrival.none,
        reason:
            'the fragment is a ROUTE here rather than a parameter list, and '
            'this parser decides the first screen of the app — it must not '
            'throw on one',
      );
    });

    test('a wrong marker VALUE is not a reset arrival', () {
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://subly.nikatru.com/?nk_auth=signup&code=x'),
        ).arrival,
        PasswordResetArrival.none,
        reason:
            'the key alone is not the contract — a future flow reusing the key '
            'with its own value must not land on this screen',
      );
    });
  });
}
