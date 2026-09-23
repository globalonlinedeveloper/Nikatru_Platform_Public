// ─────────────────────────────────────────────────────────────────────────────
// WHERE EVERY AUTH MAIL AND BROWSER HOP SENDS PEOPLE BACK TO.
//
// ⏱ 2026-09-23 — THIS WAS password_reset_redirect_test.dart. Every web case in
// the first group is the reset flow's and expects exactly what it expected
// before. The native half and the flow × target table are new: until then no
// native target had an address at all, and four flows of five sent no redirect
// on any target.
//
// 🔴 THE FAILURE THIS RULES OUT IS INVISIBLE FROM INSIDE THE APP. gotrue does
// not reject a `redirect_to` it dislikes and does not error on a null one — it
// silently substitutes the PROJECT's Site URL. So a wrong value, an absent
// value and a correct value all produce mail that sends, a link that resolves
// and a page that loads. The only observable difference is which app the user
// ends up in, and one Supabase project authenticates the whole portfolio.
//
// 🔴 AND SINCE THE MOVE TO PATH ROUTING THAT IS NO LONGER A DIFFERENT HOST — IT
// IS A DIFFERENT PATH ON THE SAME ONE. The web bundle is built with
// `--base-href /<app id>/`, so this app lives at `https://<apex>/<app id>/` and
// the apex is the marketing site. A redirect composed from the ORIGIN alone is
// still a perfectly valid URL, still resolves, still returns 200 — and lands
// the user on a page that has no idea what the `?code=` in its query is for.
// That is the regression every case in the first group exists to catch.
//
// ⚠️ THE BASE PATH ENDS IN `/`, AND THE ROUTE STAYS IN THE FRAGMENT. Nothing in
// this repository calls `usePathUrlStrategy`, so Flutter web is on the HASH
// strategy and the reset screen's real address is
// `https://<apex>/<app id>/#/reset-password` — the route is in the FRAGMENT.
// gotrue appends `?code=…` to whatever it is handed; append it to that and the
// code lands inside the fragment, where `detectSessionInUri` never looks. No
// error, no session, no screen: a reset link that quietly does nothing. Landing
// on the app's OWN ROOT and letting the SDK read `?code=` off the query is what
// makes the flow work at all — and it is why the app has to learn "this is a
// recovery" from the EVENT rather than from the URL.
//
// The `/subscriptiontracker/` in these fixtures is DATA, not a contract: `app.yaml`'s `id`
// today, renamed once already. The last case in the first group proves nothing
// in the web composition knows it.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' show AuthLinkProblem;

/// The web RESET URL — what `passwordResetRedirectUrl(isWeb: true, …)` used to
/// return. The host [TargetPlatform] is android on purpose: a web build still
/// reports one, and `isWeb` must win over it.
String? web(Uri base, {String? baseHref}) => authRedirectUrl(
      flow: AuthFlow.reset,
      isWeb: true,
      platform: TargetPlatform.android,
      base: base,
      appId: 'subscriptiontracker',
      baseHref: baseHref,
    );

/// The five real native targets. Fuchsia is not one.
const List<TargetPlatform> kNative = <TargetPlatform>[
  TargetPlatform.android,
  TargetPlatform.iOS,
  TargetPlatform.macOS,
  TargetPlatform.windows,
  TargetPlatform.linux,
];

void main() {
  group('authRedirectUrl — the web reset URL', () {
    // ALL FOUR PARTS ASSERTED TOGETHER, because each one is load-bearing for a
    // different failure: the ORIGIN sends a preview deployment's users back to
    // itself; the BASE PATH keeps them inside this app rather than on the apex;
    // the `/` at its end keeps gotrue's `?code=` in the real query where the SDK
    // reads it (with hash routing a bare `.../#/reset-password` would bury it in
    // the fragment); the FRAGMENT is the route, so a SUCCESSFUL link lands on
    // this screen rather than on home; and the MARKER is the part that survives
    // a FAILURE, where gotrue replaces the fragment with its own error
    // parameters — measured live, not assumed.
    test('on web: the ORIGIN, the BASE PATH, the MARKER and the ROUTE', () {
      expect(
        web(Uri.parse('https://nikatru.com/subscriptiontracker/#/settings')),
        'https://nikatru.com/subscriptiontracker/?nk_auth=reset#/reset-password',
      );
    });

    // 🔴 THE REGRESSION THIS UNIT EXISTS FOR, ASSERTED AS ITS OWN CASE SO THE
    // FAILURE NAMES ITSELF. The previous composition was `'${base.origin}/'` —
    // correct while the app owned a whole subdomain, and silently wrong the
    // moment it moved under a path. Every expectation below reds against that
    // exact code, which is the property the group's first case only implies.
    test('the BASE PATH is never dropped for the bare origin', () {
      final String? sent =
          web(Uri.parse('https://nikatru.com/subscriptiontracker/#/settings'));
      expect(sent, isNotNull);
      expect(
        sent,
        startsWith('https://nikatru.com/subscriptiontracker/'),
        reason: 'composed from the origin alone this would be '
            'https://nikatru.com/?nk_auth=reset#/reset-password — the apex, '
            'which is a different document that will never exchange the code',
      );
      expect(
        Uri.parse(sent!).path,
        '/subscriptiontracker/',
        reason: 'the path IS the app on a shared origin; an empty one is the '
            'marketing site',
      );
      expect(sent, isNot(contains('nikatru.com/?')));
    });

    // `document.baseURI` on a document carrying no `<base>` tag is the DOCUMENT
    // URL, file and all. The file is not part of the base path.
    test('an index.html base URL yields the directory, not the file', () {
      expect(
        web(Uri.parse('https://nikatru.com/subscriptiontracker/index.html')),
        'https://nikatru.com/subscriptiontracker/?nk_auth=reset#/reset-password',
      );
    });

    // The window between a link written without the trailing slash and the
    // server's directory redirect. Treating `/subscriptiontracker` as a file and stripping it
    // would be the dropped-base-path bug wearing a different hat.
    test('a base path with no trailing slash is still the base path', () {
      expect(
        web(Uri.parse('https://nikatru.com/subscriptiontracker')),
        'https://nikatru.com/subscriptiontracker/?nk_auth=reset#/reset-password',
      );
    });

    // 🔴 THE ESCAPE HATCH, AND THE ONE SITUATION THAT NEEDS IT. Under
    // `usePathUrlStrategy` the running URL's path carries the ROUTE as well as
    // the base path, and no amount of string work can tell the two apart. The
    // document's `<base href>` can, so the caller may hand it over and it WINS.
    test('an explicit base href beats the running URL', () {
      expect(
        web(
          Uri.parse(
            'https://nikatru.com/subscriptiontracker/settings/notifications',
          ),
          baseHref: '/subscriptiontracker/',
        ),
        'https://nikatru.com/subscriptiontracker/?nk_auth=reset#/reset-password',
        reason: 'a path-strategy deep link would otherwise send the reset mail '
            'to the screen the user happened to be standing on',
      );
    });

    // `document.baseURI` is absolute in every browser; a hand-written `<base
    // href>` is usually relative. Both have to work, and a broken one must
    // degrade to the derivation rather than throw out of the provider that
    // builds the auth repository.
    test('an absolute base href is honoured and a malformed one degrades', () {
      expect(
        web(
          Uri.parse('https://nikatru.com/subscriptiontracker/#/settings'),
          baseHref: 'https://nikatru.com/subscriptiontracker/',
        ),
        'https://nikatru.com/subscriptiontracker/?nk_auth=reset#/reset-password',
      );
      expect(
        web(
          Uri.parse('https://nikatru.com/subscriptiontracker/#/settings'),
          baseHref: '',
        ),
        'https://nikatru.com/subscriptiontracker/?nk_auth=reset#/reset-password',
        reason: 'an empty base href is no information, not a reason to lose '
            'the path the running URL already carries',
      );
    });

    // 🔴 NOTHING IN THE WEB RULE KNOWS THE APP ID. It is `apps/<id>/app.yaml`'s
    // `id`, it has been renamed once already, and the day it is renamed again
    // the web composition must not be one of the places that has to be found.
    // (The NATIVE scheme is derived from the id on purpose — see below.)
    test('the base path is DERIVED — no app id is written into the rule', () {
      expect(
        web(Uri.parse('https://nikatru.com/some-other-app/#/home')),
        'https://nikatru.com/some-other-app/?nk_auth=reset#/reset-password',
      );
      expect(
        web(Uri.parse('https://subly-9cp.pages.dev/#/home')),
        'https://subly-9cp.pages.dev/?nk_auth=reset#/reset-password',
        reason: 'a build served at the ORIGIN ROOT has an empty base path, and '
            'a rule that INSISTED on a path segment would break every one of '
            'those — a localhost run, a Pages preview alias — as surely as one '
            'that ignores the path breaks production',
      );
    });

    test('the port is carried — localhost dev is a different origin', () {
      expect(
        web(Uri.parse('http://localhost:8080/')),
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
      final String sent =
          web(Uri.parse('https://nikatru.com/subscriptiontracker/'))!;
      expect(
        passwordResetArrivalOf(Uri.parse(sent)).arrival,
        PasswordResetArrival.pending,
      );
    });

    // ⏱ 2026-09-23 — THIS CASE USED TO SAY "OFF WEB IT DECLINES", and that was
    // true only because no native target registered a scheme. Every one does
    // now, so off web the answer is the native callback. `isWeb` still wins over
    // the URI: an https base handed to a desktop build is NOT used as the
    // address, because nothing on that desktop would receive it.
    test('off web the https base is ignored and the native callback is sent',
        () {
      expect(
        authRedirectUrl(
          flow: AuthFlow.reset,
          isWeb: false,
          platform: TargetPlatform.windows,
          base: Uri.parse('https://nikatru.com/subscriptiontracker/'),
          appId: 'subscriptiontracker',
        ),
        'com.nikatru.subscriptiontracker://auth-callback?nk_auth=reset',
      );
    });

    // The VM's `Uri.base` is a `file:` directory URI, and `Uri.origin` THROWS on
    // one. Guarded rather than caught: the refusal is a decision this function
    // makes, not an exception path it survives.
    test('a non-http base is refused instead of throwing', () {
      expect(web(Uri.parse('file:///C:/src/app/')), isNull);
      expect(
        web(Uri.parse('https:///path')),
        isNull,
        reason: 'no host is no origin',
      );
      expect(
        web(Uri.parse('file:///C:/src/app/'),
            baseHref: '/subscriptiontracker/'),
        isNull,
        reason: 'a base href is a PATH — resolved against a file: URI it is '
            'still a file: URI, and no allow-list entry can ever match one',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE FLOW × TARGET TABLE. Every cell is written out, so a cell that changes
  // names itself. Native: `com.nikatru.<id>://auth-callback?nk_auth=<marker>`.
  // Web: the per-origin URL with the flow's marker, and the route for reset
  // alone. NOTHING IS NULL OFF FUCHSIA.
  // ───────────────────────────────────────────────────────────────────────────
  group('authRedirectUrl — the flow × target table', () {
    const Map<AuthFlow, String> webWant = <AuthFlow, String>{
      AuthFlow.signUpConfirm:
          'https://nikatru.com/subscriptiontracker/?nk_auth=confirm',
      AuthFlow.oauth: 'https://nikatru.com/subscriptiontracker/?nk_auth=oauth',
      AuthFlow.linkIdentity:
          'https://nikatru.com/subscriptiontracker/?nk_auth=link',
      AuthFlow.reset:
          'https://nikatru.com/subscriptiontracker/?nk_auth=reset#/reset-password',
      AuthFlow.emailChange:
          'https://nikatru.com/subscriptiontracker/?nk_auth=email-change',
    };
    const Map<AuthFlow, String> nativeWant = <AuthFlow, String>{
      AuthFlow.signUpConfirm:
          'com.nikatru.subscriptiontracker://auth-callback?nk_auth=confirm',
      AuthFlow.oauth:
          'com.nikatru.subscriptiontracker://auth-callback?nk_auth=oauth',
      AuthFlow.linkIdentity:
          'com.nikatru.subscriptiontracker://auth-callback?nk_auth=link',
      AuthFlow.reset:
          'com.nikatru.subscriptiontracker://auth-callback?nk_auth=reset',
      AuthFlow.emailChange:
          'com.nikatru.subscriptiontracker://auth-callback?nk_auth=email-change',
    };

    test('the table covers every flow', () {
      expect(webWant.keys.toSet(), AuthFlow.values.toSet());
      expect(nativeWant.keys.toSet(), AuthFlow.values.toSet());
    });

    for (final AuthFlow flow in AuthFlow.values) {
      test('web × ${flow.name}', () {
        expect(
          authRedirectUrl(
            flow: flow,
            isWeb: true,
            platform: TargetPlatform.linux,
            base: Uri.parse('https://nikatru.com/subscriptiontracker/#/home'),
            appId: 'subscriptiontracker',
          ),
          webWant[flow],
        );
      });
      for (final TargetPlatform p in kNative) {
        test('${p.name} × ${flow.name}', () {
          expect(
            authRedirectUrl(
              flow: flow,
              isWeb: false,
              platform: p,
              base: Uri.parse('file:///C:/src/app/'),
              appId: 'subscriptiontracker',
            ),
            nativeWant[flow],
            reason: 'a native build must never be left without an address — '
                'gotrue would substitute the Site URL, a web page that holds '
                'no PKCE verifier for this installation',
          );
        });
      }
      test('fuchsia × ${flow.name} is null — not a target', () {
        expect(
          authRedirectUrl(
            flow: flow,
            isWeb: false,
            platform: TargetPlatform.fuchsia,
            base: Uri.parse('file:///C:/src/app/'),
            appId: 'subscriptiontracker',
          ),
          isNull,
        );
      });
    }
  });

  group('the native scheme', () {
    // RFC 8252 §7.1: a reverse-DNS scheme, because a bare word can be claimed
    // by any app on the device and whichever one the OS picks gets the code.
    test('is reverse-DNS, derived from the app id, never the bare id', () {
      expect(
        authCallbackScheme('subscriptiontracker'),
        'com.nikatru.subscriptiontracker',
      );
      expect(authCallbackScheme('budget'), 'com.nikatru.budget');
      final String sent = authRedirectUrl(
        flow: AuthFlow.oauth,
        isWeb: false,
        platform: TargetPlatform.android,
        base: Uri.parse('file:///x/'),
        appId: 'subscriptiontracker',
      )!;
      final Uri u = Uri.parse(sent);
      expect(u.scheme, 'com.nikatru.subscriptiontracker');
      expect(u.host, kAuthCallbackHost);
      expect(u.queryParameters, <String, String>{'nk_auth': 'oauth'});
      expect(sent, isNot(startsWith('subscriptiontracker://')));
    });

    // app.schema allows `_` in an id; a URI scheme cannot carry it, and a
    // scheme is lower-case by the time any OS compares it.
    test('refuses an app id that cannot form a scheme', () {
      for (final String bad in <String>['my_app', 'App', '1app', '', 'a-b']) {
        expect(
          () => authCallbackScheme(bad),
          throwsArgumentError,
          reason: '"$bad" cannot be the last label of com.nikatru.<id>',
        );
      }
    });

    // The markers ride inside gotrue's allow-list glob, where `.` and `/` are
    // separators; one entry per marker is only safe if they are plain words.
    test('every marker is glob-safe and distinct', () {
      final Set<String> seen = <String>{};
      for (final AuthFlow f in AuthFlow.values) {
        expect(f.marker, matches(RegExp(r'^[a-z][a-z-]*$')));
        expect(seen.add(f.marker), isTrue, reason: '${f.marker} is reused');
      }
    });
  });

  group('AuthRedirects', () {
    test('none sends nothing for any flow', () {
      for (final AuthFlow f in AuthFlow.values) {
        expect(AuthRedirects.none(f), isNull);
      }
    });

    test('binds one build and answers per flow', () {
      final AuthRedirects ios = AuthRedirects(
        appId: 'subscriptiontracker',
        isWeb: false,
        platform: TargetPlatform.iOS,
        base: Uri.parse('file:///x/'),
      );
      expect(
        ios(AuthFlow.signUpConfirm),
        'com.nikatru.subscriptiontracker://auth-callback?nk_auth=confirm',
      );
      final AuthRedirects page = AuthRedirects(
        appId: 'subscriptiontracker',
        isWeb: true,
        platform: TargetPlatform.android,
        base: Uri.parse('https://nikatru.com/subscriptiontracker/'),
      );
      expect(
        page(AuthFlow.oauth),
        'https://nikatru.com/subscriptiontracker/?nk_auth=oauth',
      );
    });

    // Under the VM test runner the host is a desktop target, so current() must
    // answer that target's native callback — never null, never throw.
    test('current() answers the host target on the VM', () {
      expect(
        AuthRedirects.current(appId: 'subscriptiontracker')(AuthFlow.oauth),
        'com.nikatru.subscriptiontracker://auth-callback?nk_auth=oauth',
      );
    });
  });

  group('authArrivalOf — every flow, both shapes', () {
    // THE ROUND TRIP for every flow on both shapes: what is SENT is what the
    // parser READS back, with the flow it was sent for.
    test('what each flow sends is recognised as that flow', () {
      for (final AuthFlow flow in AuthFlow.values) {
        for (final bool isWeb in <bool>[true, false]) {
          final String sent = authRedirectUrl(
            flow: flow,
            isWeb: isWeb,
            platform: TargetPlatform.android,
            base: Uri.parse('https://nikatru.com/subscriptiontracker/'),
            appId: 'subscriptiontracker',
          )!;
          final AuthArrivalReport r = authArrivalOf(Uri.parse(sent));
          expect(r.flow, flow, reason: sent);
          expect(r.arrival, PasswordResetArrival.pending, reason: sent);
        }
      }
    });

    test('a native callback carrying its code is pending, for its flow', () {
      expect(
        authArrivalOf(
          Uri.parse(
            'com.nikatru.subscriptiontracker://auth-callback'
            '?nk_auth=oauth&code=abc123',
          ),
        ),
        const AuthArrivalReport(AuthFlow.oauth, PasswordResetArrival.pending),
      );
    });

    // gotrue appends its error parameters in the FRAGMENT on native exactly as
    // on web; the query (and so the marker) survives.
    test('a native failure is unusable, typed, and names its flow', () {
      final AuthArrivalReport r = authArrivalOf(
        Uri.parse(
          'com.nikatru.subscriptiontracker://auth-callback?nk_auth=confirm'
          '#error=access_denied&error_code=otp_expired'
          '&error_description=Email+link+is+invalid+or+has+expired',
        ),
      );
      expect(r.flow, AuthFlow.signUpConfirm);
      expect(r.arrival, PasswordResetArrival.unusable);
      expect(r.problem, AuthLinkProblem.expiredOrUsed);
    });

    // Reset keeps its screen; every other flow goes to the ordinary route, so
    // the reset projection must NOT claim them.
    test('only the reset arrival reaches the reset projection', () {
      for (final AuthFlow flow in AuthFlow.values) {
        final Uri u = Uri.parse(
          'com.nikatru.subscriptiontracker://auth-callback'
          '?nk_auth=${flow.marker}&code=x',
        );
        expect(
          passwordResetArrivalOf(u).arrival,
          flow == AuthFlow.reset
              ? PasswordResetArrival.pending
              : PasswordResetArrival.none,
          reason: flow.name,
        );
      }
    });

    test('an unknown marker and no marker are none', () {
      expect(
        authArrivalOf(Uri.parse('https://nikatru.com/x/?nk_auth=nope&code=1')),
        AuthArrivalReport.none,
      );
      expect(
        authArrivalOf(Uri.parse('com.nikatru.x://auth-callback?code=1')),
        AuthArrivalReport.none,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE PARSER, AGAINST URLS MEASURED OFF THE LIVE PROJECT — not invented.
  //
  // Every URL below is the shape of a real `Location:` answered by the real
  // gotrue instance (project lcrkiurkvzhkonjwhpiv) on 2026-08-11, by handing
  // `/auth/v1/verify?type=recovery` a deliberately invalid token with each
  // `redirect_to` in turn; the host and path are the post-move deployment's,
  // since gotrue echoes whatever `redirect_to` it accepted. A fixture written
  // from the documentation would encode what the docs say; these encode what the
  // server does — including the part that decided this design, which is that the
  // FRAGMENT does not survive a failure and the QUERY does.
  group('passwordResetArrivalOf', () {
    test('an EXPIRED link is unusable, and typed as expired', () {
      final report = passwordResetArrivalOf(
        Uri.parse(
          'https://nikatru.com/subscriptiontracker/?nk_auth=reset'
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
            'https://nikatru.com/subscriptiontracker/?nk_auth=reset&code=abc123'
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
          Uri.parse(
              'https://nikatru.com/subscriptiontracker/?nk_auth=reset#/reset-password'),
        ).arrival,
        PasswordResetArrival.pending,
      );
    });

    // 🔴 THE PARSER READS THE QUERY AND THE FRAGMENT AND NOTHING ELSE, which is
    // why the move under a path prefix did not have to touch it — and this case
    // is what says so out loud. Any future "does this URL belong to us?" check
    // added here on the PATH would red it, and that is a check nobody should
    // write: the same build serves preview deployments at the origin root.
    test('the base path is not part of the contract the parser reads', () {
      for (final String url in <String>[
        'https://nikatru.com/subscriptiontracker/?nk_auth=reset&code=abc123',
        'https://nikatru.com/some-other-app/?nk_auth=reset&code=abc123',
        'https://subly-9cp.pages.dev/?nk_auth=reset&code=abc123',
        'http://localhost:8080/?nk_auth=reset&code=abc123',
        'com.nikatru.subscriptiontracker://auth-callback?nk_auth=reset&code=abc123',
      ]) {
        expect(
          passwordResetArrivalOf(Uri.parse(url)).arrival,
          PasswordResetArrival.pending,
          reason: '$url is the same arrival wherever it is served from',
        );
      }
    });

    // THE CASE THE MARKER EXISTS FOR. `?code=` is the shape of EVERY PKCE
    // arrival, OAuth included. Without the marker this parser would route
    // somebody returning from a Google sign-in to the reset-password screen — a
    // defect strictly worse than the one it fixes, because it would hit users
    // who never asked for a reset at all.
    test('an OAuth callback with a code is NOT a reset arrival', () {
      expect(
        passwordResetArrivalOf(
          Uri.parse(
              'https://nikatru.com/subscriptiontracker/?code=oauth-code-here'),
        ).arrival,
        PasswordResetArrival.none,
      );
      expect(
        passwordResetArrivalOf(
          Uri.parse(
            'https://nikatru.com/subscriptiontracker/'
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
        passwordResetArrivalOf(
          Uri.parse('https://nikatru.com/subscriptiontracker/'),
        ).arrival,
        PasswordResetArrival.none,
      );
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://nikatru.com/subscriptiontracker/#/budget'),
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
          Uri.parse(
              'https://nikatru.com/subscriptiontracker/?nk_auth=signup&code=x'),
        ).arrival,
        PasswordResetArrival.none,
        reason:
            'the key alone is not the contract — a future flow reusing the key '
            'with its own value must not land on this screen',
      );
    });
  });
}
