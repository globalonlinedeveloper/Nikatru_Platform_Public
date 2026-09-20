// ─────────────────────────────────────────────────────────────────────────────
// capture-network-posture.mjs — THE APP IN A STORE FRAME MUST NOT BE TELLING
// THE USER IT IS OFFLINE.
//
// Two halves of one concern, deliberately in one file: the CAUSE (a launch-time
// fetch the capture harness cannot complete) and the EFFECT (a full-width alarm
// banner across the top of every frame). Splitting them would let one be fixed
// and the other quietly deleted.
//
// ── 🔴 WHAT WAS MEASURED, 2026-09-20 ────────────────────────────────────────
// Every one of the EIGHT frames committed under
// `apps/subscriptiontracker/store/android-play/` — four phone, four tablet,
// from runs 34202461387 (PR #542, merged 2026-09-09) and #393 — carries a
// FULL-WIDTH `#ffdad6` band across the top reading
//
//     "Could not reach the network. Some things may be out of date."  [Retry]
//
// measured with `tooling/store/png-codec.mjs`:
//
//     screenshots/01-home.png          1080x1920  topColour=#ffdad6  solidRows=70  maxRow=1.000
//     screenshots/02-calendar.png      1080x1920  topColour=#ffdad6  solidRows=70  maxRow=1.000
//     screenshots/03-insights.png      1080x1920  topColour=#ffdad6  solidRows=70  maxRow=1.000
//     screenshots/04-budget.png        1080x1920  topColour=#ffdad6  solidRows=70  maxRow=1.000
//     screenshots-tablet/01-home.png   1800x3200  topColour=#ffdad6  solidRows=63  maxRow=1.000
//     screenshots-tablet/02-calendar.png 1800x3200 topColour=#ffdad6 solidRows=63 maxRow=1.000
//     screenshots-tablet/03-insights.png 1800x3200 topColour=#ffdad6 solidRows=63 maxRow=1.000
//     screenshots-tablet/04-budget.png 1800x3200  topColour=#ffdad6  solidRows=63  maxRow=1.000
//
// That band is `OfflineNotice` in
// `packages/design_system/lib/src/widgets/system_screens.dart`, painted at
// `theme.colorScheme.errorContainer`, hoisted over every route by
// `OfflineBannerHost` in `packages/chassis_screens/lib/shell/app_shell.dart`.
//
// ── ⚠️ IT IS NOT AN ANDROID STATUS BAR, AND THAT MATTERS FOR THE FIX ────────
// Read as "the phone had no signal", the remedy looks like Android's SystemUI
// demo mode (`adb shell am broadcast -a com.android.systemui.demo …`) and the
// emulator's `-netdelay none -netspeed full`. NONE of that applies here. This
// lane runs NO emulator and NO Android image: `capture-play-screenshots.mjs`
// drives `flutter drive -d web-server --browser-name=chrome`, so the pixels are
// a headless Chrome viewport and there is no system status bar in the frame at
// all — row 0 of every frame above is the app's own first pixel. There is no
// clock, battery or signal icon to pin, and no radio to bring up.
//
// ── 🔴 THE ACTUAL CAUSE: A CROSS-ORIGIN CONFIG FETCH THAT CANNOT SUCCEED ────
// The banner is NOT driven by a connectivity plugin. `NetworkReachabilityController`
// (`apps/subscriptiontracker/lib/state/providers/config.dart`) starts FALSE and
// flips true only when a real request fails — and the app makes exactly one at
// launch: `GET {CONFIG_BASE_URL}/config/subscriptiontracker`, default host
// `https://config.nikatru.com`, served by the `platform` Worker.
//
// `flutter drive -d web-server` serves the app from `http://localhost:<RANDOM
// PORT>`, and that fetch is therefore CROSS-ORIGIN from the browser. The repo
// already records, in `tooling/ci/assert-cors-allowlist.mjs`, that the two
// Workers differ on exactly this point:
//
//   · `subscriptiontracker-api` — "allows localhost by regex (a recorded trade
//     — the `flutter drive -d web-server` harness picks a random port)".
//     ⇒ the API calls succeed, which is why the frames ARE populated
//       ($93.47/mo, 6 active, "Video streaming") rather than empty.
//   · `platform` (config.nikatru.com) — "this Worker has NO localhost regex, so
//     the origin must be listed explicitly", and the only explicit entry is
//     `http://localhost:3000`.
//     ⇒ the config fetch is refused by the browser on every run, because the
//       port is random and can never be 3000.
//
// So the app is online, signed in and populated, and is nonetheless told by its
// own launch fetch that the network is unreachable. The banner is correct about
// what it observed and wrong about the product.
//
// ── THE FIX: DO NOT MAKE THE DOOMED FETCH ───────────────────────────────────
// `apps/subscriptiontracker/lib/core/app_config.dart` already carries the lever
// and already describes this exact situation, verbatim:
//
//   "Also force-off with `--dart-define=SKIP_REMOTE_CONFIG=true`, which an
//    `integration_test` run wants: it supplies identity defines but has no
//    reason to reach the config host, and a network-restricted runner turns
//    that fetch into a dio timeout."
//
// Measured 2026-09-20: NOTHING passes it. A sweep of the tree for
// `SKIP_REMOTE_CONFIG` outside `app_config.dart` finds three hits — a doc
// comment, a `capability-register.json` row and a key list in
// `vendor-portability.test.mjs` — and no workflow, script or lane. The define
// was designed for this caller and never wired to it.
//
// With it set, `remoteConfigEnabled` is false, the launch fetch never happens,
// the reachability signal can never leave its initial `false`, and the banner
// cannot be constructed. Config resolution falls back to `kAppDefaultConfig`,
// which `apps/subscriptiontracker/test/config_default_test.dart` pins AGAINST
// THE SERVER's authoritative values — so the captured app renders the same
// configuration it would have fetched. Nothing is staged or masked: the fix
// removes a false statement from the frame, it does not hide a true one.
//
// ⚠️ THE ALTERNATIVE WAS CONSIDERED AND REJECTED. Widening the `platform`
// Worker's CORS allowlist to admit localhost would also clear the banner, and
// it would do so by loosening a PRODUCTION allowlist for the benefit of a
// screenshot lane — against a random port, so it could only be done with a
// regex. Not making a request is strictly narrower than permitting one.
// ─────────────────────────────────────────────────────────────────────────────
import { decodeRgba, encodeRgba } from './png-codec.mjs';

/**
 * Extra `--dart-define`s every capture drive passes, with the reason each one
 * is there. Data only — this module has no filesystem and no process, so the
 * lane's test can import it and read the contract rather than grepping prose
 * out of the runner.
 *
 * 🔴 A DEFINE ADDED HERE REACHES NO SHIPPING BINARY. It is passed to
 * `flutter drive`, which builds the `integration_test` target; `flutter build`
 * never compiles that tree. `SKIP_REMOTE_CONFIG` is declared in
 * `tooling/capability-register.json` as a "test/demo switch, no external system
 * behind it", which is exactly what this use is.
 */
export const LAUNCH_DEFINES = Object.freeze({
  SKIP_REMOTE_CONFIG: Object.freeze({
    value: 'true',
    why:
      'The launch-time GET {CONFIG_BASE_URL}/config/<app> is cross-origin from the random localhost port ' +
      '`flutter drive -d web-server` serves on, and the platform Worker has no localhost regex — so it is ' +
      'refused by the browser on every run, flips NetworkReachabilityController true, and paints ' +
      '"Could not reach the network. Some things may be out of date." across the top of every captured ' +
      'frame. Not making the request is the fix; config resolves to kAppDefaultConfig, which ' +
      'apps/subscriptiontracker/test/config_default_test.dart pins against the server\'s own values.',
  }),
});

/** The `KEY=value` argv tokens for [LAUNCH_DEFINES], in declaration order. */
export function launchDefineArgs() {
  return Object.entries(LAUNCH_DEFINES).flatMap(([k, spec]) => ['--dart-define', `${k}=${spec.value}`]);
}

/**
 * How far down the frame an alarm banner can start. `OfflineNotice` sits under
 * a `SafeArea` at the very top of the shell, so the band begins at row 0; the
 * window is a tenth of the frame purely so a future inset cannot slide it out
 * of view of this scan.
 */
export const TOP_BAND_RATIO = 0.1;

/**
 * How much of one ROW the band must cover to count. The banner is
 * `width: double.infinity`, so its solid rows measure 1.000. A legitimate
 * coloured accent in this repo's UI is a bar a few pixels wide — low
 * single-digit percent of a 1080px row. 0.60 sits between the two with two
 * orders of magnitude of margin on each side, the same threshold and the same
 * reasoning as the demo-banner limb in `tooling/ci/assert-listing-assets.mjs`.
 */
export const BAND_ROW_FRACTION = 0.6;

/**
 * How far the red channel must lead the others for a band to read as an ALARM
 * rather than as a background.
 *
 * 🔴 DERIVED FROM A PROPERTY, NOT PINNED TO A HEX, AND THAT IS THE WHOLE POINT.
 * The offline banner's colour is `ColorScheme.fromSeed(...).errorContainer` — a
 * Material 3 tonal-palette computation in Dart that no Node guard can
 * recompute, so a pinned `#ffdad6` would silently stop matching the day the
 * seed moved and this scan would pass a banner it was written to catch. What
 * every alarm surface in this app shares instead is that red leads:
 *
 *     measured 2026-09-20, r - max(g, b):
 *       offline banner   #ffdad6  (errorContainer)  →  +37   FLAGGED
 *       demo banner      #f59e0b  (AppColors.warn)  →  +87   FLAGGED
 *       danger           #ef4d6a  (AppColors.danger)→  +32   FLAGGED
 *       app background   #f4f4f8  (AppColors.bg)    →   -4   clear
 *       surface          #ffffff                    →    0   clear
 *       hero card        #1b1930  (AppColors.heroA) →  -21   clear
 *
 * 16 sits between -4 and +32 with margin on both sides. This catches the demo
 * banner as a side effect, which is correct — it is the same defect wearing a
 * different colour.
 *
 * ⬜ WHAT IT CANNOT DO: tell an alarm banner from a legitimately WARM full-width
 * header. This app has none today, and if one arrives this scan will refuse the
 * capture and a human will read the refusal, which is the right way round for a
 * store filing. It also reads no text: a full-width band of a NEUTRAL colour
 * carrying alarming words is invisible here, exactly as the demo-banner limb is
 * blind to glyphs.
 */
export const RED_LEAD = 16;

/** The fraction of row `y` that is exactly `rgb`. */
function rowFraction(img, y, rgb) {
  let n = 0;
  for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4;
    if (img.rgba[i] === rgb[0] && img.rgba[i + 1] === rgb[1] && img.rgba[i + 2] === rgb[2]) n++;
  }
  return n / img.width;
}

const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/**
 * Measure the top band of a decoded frame.
 *
 * Takes the colour of the frame's own first pixel — whatever the app painted
 * there — and asks how much of a row it covers within the top window and
 * whether it reads as an alarm. Nothing about the expected colour is supplied
 * by the caller, so the scan cannot be aimed at the wrong one.
 *
 * @returns {{colour: string, fraction: number, redLead: number, banner: boolean}}
 */
export function scanTopBand(img) {
  const rgb = [img.rgba[0], img.rgba[1], img.rgba[2]];
  const limit = Math.max(1, Math.floor(img.height * TOP_BAND_RATIO));
  let fraction = 0;
  for (let y = 0; y < limit; y++) fraction = Math.max(fraction, rowFraction(img, y, rgb));
  const redLead = rgb[0] - Math.max(rgb[1], rgb[2]);
  return {
    colour: hex(rgb),
    fraction,
    redLead,
    banner: fraction >= BAND_ROW_FRACTION && redLead >= RED_LEAD,
  };
}

/**
 * Prove the detector can still tell the two apart, in BOTH directions, on every
 * invocation.
 *
 * A scan that ranges over nothing prints ok forever, and this repo has paid for
 * that failure more than any other. The frames are round-tripped through the
 * real encoder and the real decoder rather than handed over as raw buffers,
 * because the limb's true input is PNG bytes: a decoder regression has to be
 * able to red this.
 *
 * The banded fixture uses the MEASURED offline colour and the clean fixture the
 * app's own background token, so this self-test is also the record of the two
 * values the threshold was placed between.
 */
export function selfTestOfflineBannerDetector() {
  const w = 64;
  const h = 64;
  const build = (bandRgb, bandRows) => {
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const c = y < bandRows ? bandRgb : [0xf4, 0xf4, 0xf8];
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 0xff;
      }
    }
    return decodeRgba(encodeRgba({ width: w, height: h, rgba }));
  };
  // 4 rows of 64 is inside the 10% window (6 rows) and full width.
  const withBanner = scanTopBand(build([0xff, 0xda, 0xd6], 4));
  const without = scanTopBand(build([0xf4, 0xf4, 0xf8], 0));
  return {
    withBanner,
    without,
    ok: withBanner.banner === true && without.banner === false,
  };
}
