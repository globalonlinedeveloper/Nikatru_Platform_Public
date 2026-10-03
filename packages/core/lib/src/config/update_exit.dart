// ─────────────────────────────────────────────────────────────────────────────
// update_exit.dart — [pipeline 10]D-8, WHAT THE FORCE-UPDATE WALL'S BUTTON DOES,
// for every channel. Pure: a channel id and two URLs in, one action out.
//
// 🔴 WHY THIS EXISTS (O-FORCE-UPDATE-VERSION-READ-UNPROVEN, folding
// O-UPDATE-EXIT-OPENS-HOMEPAGE and O-WEB-KILL-SWITCH-LAUNCH-ONLY). Until
// 2026-10-01 every build's wall opened `appConfig.updateUrl ?? AppConfig.updateUrl`,
// the service served `update_url: null` to every channel, and the compiled-in
// fallback is the company homepage. So a walled store user was sent to a site
// root, the sideloaded apps.gov.in .apk had no way to an update at all, and a
// walled web tab was sent to another URL when all it needed was a reload.
//
// THE ORDER IS THE CONTRACT, and tooling/ci/update-exit.mjs grades the served
// data against exactly this order:
//   1. `web` RELOADS. The page is the update: the deploy's `_headers` revalidate
//      the entry points, so a reload fetches the new build. A URL would leave it.
//   2. A SERVED url wins everywhere else, so an exit stays repointable without a
//      release (owner decision #19).
//   3. A [kStoreListingChannels] build with nothing served opens its own store
//      listing through the review adapter (`openStoreListing()`).
//   4. Anything else opens the compiled-in fallback. The D-8 limb refuses a
//      live or armed row in this branch unless it is served a real URL.
// ─────────────────────────────────────────────────────────────────────────────

import 'web_page.dart';

/// The channels whose wall may be served no URL, because their build was
/// installed by a store `openStoreListing()` opens. READ BY
/// tooling/ci/update-exit.mjs `parseStoreListingChannels` — keep the literal.
///
/// NOT `apps-gov-in`, although it is an android store: its .apk is sideloaded
/// from a portal the adapter cannot open, and Play cannot update that install.
/// NOT `linux-snap`: no adapter opens the Snap Store, so it is served its page.
const Set<String> kStoreListingChannels = <String>{
  'android-play',
  'ios-appstore',
  'macos-appstore',
  'windows-store',
};

/// The web channel's id in tooling/channel-register.json.
const String kWebChannel = 'web';

/// What the wall's button does.
sealed class UpdateExit {
  const UpdateExit();
}

/// Reload the page (web only).
final class ReloadPage extends UpdateExit {
  const ReloadPage();
}

/// Open this build's own store listing.
final class OpenStoreListing extends UpdateExit {
  const OpenStoreListing();
}

/// Open [url].
final class OpenUpdateUrl extends UpdateExit {
  const OpenUpdateUrl(this.url);
  final String url;

  @override
  bool operator ==(Object other) => other is OpenUpdateUrl && other.url == url;
  @override
  int get hashCode => url.hashCode;
}

/// The wall's action on [channel] (`AppConfig.releaseChannel`), given the
/// [served] `update_url` (null or empty when none) and the compiled-in
/// [fallbackUrl]. See the file header for the order.
UpdateExit resolveUpdateExit({
  required String channel,
  required String? served,
  required String fallbackUrl,
}) {
  if (channel == kWebChannel) return const ReloadPage();
  if (served != null && served.isNotEmpty) return OpenUpdateUrl(served);
  if (kStoreListingChannels.contains(channel)) return const OpenStoreListing();
  return OpenUpdateUrl(fallbackUrl);
}

/// Runs the wall's exit (see [resolveUpdateExit]): reloads on web, calls
/// [listing] on a store-listing build with nothing [served], and otherwise
/// [open]s [url] — the value the app resolved, `served ?? its compiled-in
/// fallback`, which is the URL [resolveUpdateExit] picks in both cases.
/// Best-effort: a throwing exit never crashes the update screen.
///
/// [reload] is the page reload, injectable so a test run IN a browser does not
/// reload its own runner page (that left `dart test -p chrome` hung forever).
Future<void> openUpdateExit(
  String url,
  String? served, {
  required String channel,
  required Future<Object?> Function() listing,
  required Future<Object?> Function(String url) open,
  void Function() reload = reloadPage,
}) async {
  try {
    switch (resolveUpdateExit(
      channel: channel,
      served: served,
      fallbackUrl: url,
    )) {
      case ReloadPage():
        reload();
      case OpenStoreListing():
        await listing();
      case OpenUpdateUrl(:final String url):
        await open(url);
    }
  } catch (_) {
    // The wall stays up and can be tapped again.
  }
}

/// The installed-version read the force-update floor compares against, made
/// VISIBLE (O-FORCE-UPDATE-VERSION-READ-UNPROVEN). [read] is the platform's own
/// read; a throw or an empty answer is null, and the floor fails OPEN on null
/// by design. What was wrong is that it failed open SILENTLY — Snap
/// confinement, an MSIX package or a web bundle whose `version.json` did not
/// load would never enforce any floor. So a null read is [report]ed once per
/// call (a provider calls this once per launch), naming [channel], and on web
/// the read is published for tooling/smoke/smoke-web-artifact.mjs.
Future<String?> readInstalledVersion(
  Future<String> Function() read, {
  required String channel,
  required Future<void> Function(String message) report,
}) async {
  String? version;
  try {
    version = await read();
  } catch (_) {
    version = null;
  }
  if (version != null && version.isEmpty) version = null;
  publishVersionRead(version);
  if (version == null) {
    try {
      await report(
        'force-update: the installed-version read resolved null on channel '
        '"$channel", so the min_supported_version floor cannot wall this build',
      );
    } catch (_) {
      // A sink that fails must not turn a fail-open read into a crash.
    }
  }
  return version;
}
