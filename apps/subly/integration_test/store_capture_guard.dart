// ─────────────────────────────────────────────────────────────────────────────
// store_capture_guard.dart — THE REFUSAL BETWEEN A SIGNED-IN SESSION AND A
// PUBLIC MARKETING ASSET.
//
// 🔴 THE DEFECT THIS EXISTS FOR, FOUND 2026-08-05 BY OPENING THE IMAGES.
// The capture produced five frames and the fifth, `05-settings.png`, rendered
// the signed-in account at the top of the account card in large legible type.
// CI captures signed in as the throwaway end-to-end account, so the frame read
// `subly-e2e+1785856022717@nikatru.com` — an internal test address on a public
// Play listing, and the first thing a reader's eye lands on in that frame. It
// was removed from the published set by hand.
//
// 🔴 CURATION WAS NOT A FIX, AND THAT IS THE WHOLE REASON THIS FILE EXISTS.
// The address is not baked into a PNG; it is whatever account signed in. Every
// re-run reproduced it, and the leak is NOT bounded by the CI account:
// `capture-play-screenshots.mjs` takes `E2E_EMAIL` from the environment, so an
// owner running the live lane locally would photograph their OWN address. The
// only fix that holds for every possible signer is to refuse to photograph a
// frame that carries the session's identity at all.
//
// ⚠️ NO GUARD IN THIS REPOSITORY CAN READ TEXT IN A PNG.
// `assert-listing-assets.mjs` decodes every frame and measured all five as
// compliant — size, colour type, aspect, and the absence of the demo banner —
// because it looks for a band of ONE COLOUR, not for glyphs. So the check cannot
// live downstream of the pixels. It lives HERE, one instruction before the
// shutter, where the widget tree is still a tree and a string is still a string.
//
// The refusal reads the REAL widget tree at the exact moment of capture, so it
// covers what a static scan of one screen file cannot:
//   · a shared widget that renders the account somewhere nobody thought to look;
//   · a new frame added months from now, of a screen nobody has audited;
//   · a local run signed in as a real person rather than as the CI throwaway.
//
// Split out of `store_screenshots_test.dart` so it can be unit-tested:
// `apps/subly/test/store_capture_guard_test.dart` drives both directions of
// every branch below in a real widget tree, on every push. An integration_test
// file can only be exercised by a live capture, which needs CI-only secrets —
// so a refusal that lived only there would ship having never once refused.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_test/flutter_test.dart';

import 'package:subly/data/auth/auth_models.dart';

/// Every string that must not appear on screen in a frame bound for a listing.
///
/// Derived from the SESSION rather than pinned, so it is right for whoever
/// signed in — the CI throwaway, or the owner running the live lane by hand.
///
/// · `signedInWith` is the address the suite typed into the login form. It is
///   always present, which is what makes the returned set non-empty and the
///   refusal non-vacuous. An empty set would be an assertion that cannot fail.
/// · `account` is the session the app actually holds. Its `email` is normally
///   the same string, and asking the app rather than the harness is what catches
///   a capture that signed in as somebody else than it meant to.
/// · `includeProfileName` covers `AuthUser.displayName`, which `HomeScreen`
///   renders (`user?.displayName ?? 'Welcome'`) — so a live account carrying a
///   `full_name` would put a real person's name on `01-home.png`. It is null for
///   the provisioned CI account today, which is exactly the kind of "safe by
///   accident" this repository stops relying on.
///
/// 🔴 IT IS FALSE ON A DEMO BUILD, AND THAT IS A REASONED EXCEPTION RATHER THAN
/// A CONVENIENCE. `MockAuthRepository` hands out a FICTIONAL profile — `Alex
/// Rivera` — which Home renders. On the `--proof` lane that name is not an
/// identity, it is seed data, and the output goes to a throwaway directory that
/// the runner refuses to point at the listing. Including it would fail the
/// mechanism-proof lane forever on a leak that cannot exist, and a guard that
/// blocks correct work is a guard somebody switches off. The ADDRESS limbs stay
/// on in both postures.
Set<String> accountIdentityNeedles({
  required String signedInWith,
  AuthUser? account,
  bool includeProfileName = true,
}) {
  final Set<String> out = <String>{};
  void add(String? value) {
    final String trimmed = (value ?? '').trim();
    if (trimmed.isNotEmpty) out.add(trimmed);
  }

  add(signedInWith);
  add(account?.email);
  if (includeProfileName) add(account?.displayName);
  return out;
}

/// The ONLY way this app photographs a store frame.
///
/// 🔴 `binding.takeScreenshot` IS NOT CALLED ANYWHERE ELSE, and that is enforced
/// rather than remembered: `tooling/ci/assert-listing-assets.mjs` fails the
/// build if `store_screenshots_test.dart` contains a direct `takeScreenshot(`
/// call. A second, unguarded shutter is how this defect would come back — not by
/// somebody deleting the refusal, but by somebody adding one more frame in the
/// obvious way.
///
/// Takes the shutter as a function rather than the binding, so a widget test can
/// pass a recorder and prove that a refused frame is a frame NOT TAKEN. A
/// refusal that throws after the bytes exist is not a refusal.
Future<void> captureFrame({
  required Future<void> Function(String frame) take,
  required String frame,
  required Set<String> forbidden,
}) async {
  // Vacuity first. An empty needle set makes every check below range over
  // nothing and report a clean frame — the shape this repository has paid for
  // more than any other, arriving in the one place where its output is a public
  // asset. Refuse, loudly, rather than photograph on no evidence.
  if (forbidden.isEmpty) {
    fail(
      'store capture REFUSED to photograph "$frame": the set of forbidden '
      'account strings is EMPTY, so the identity check would have examined the '
      'frame for nothing and passed it. The set is built from the address the '
      'suite signed in with, which is never empty on a real run — an empty one '
      'means the harness lost track of who it is signed in as, and a frame '
      'captured in that state has no evidence behind it.',
    );
  }

  final List<String> onScreen = forbidden
      .where(
        (String needle) => find
            .textContaining(needle, findRichText: true)
            .evaluate()
            .isNotEmpty,
      )
      .toList();

  if (onScreen.isNotEmpty) {
    fail(
      'store capture REFUSED to photograph "$frame": the frame carries the '
      'signed-in account on screen (${onScreen.join(', ')}). This frame would '
      'go on a public Play listing, where an internal test address — or, on a '
      'local run, the owner\'s own — is a test artefact on a marketing asset '
      'and the first thing a reader\'s eye lands on. It happened once, on '
      '05-settings.png, and was caught only because a human opened the file: '
      'no guard in this tree can read text out of a PNG. Photograph a screen '
      'that does not render the account, or stop capturing this one.',
    );
  }

  await take(frame);
}
