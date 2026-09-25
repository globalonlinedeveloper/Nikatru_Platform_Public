// ─────────────────────────────────────────────────────────────────────────────
// capture-suite-scan.mjs — CAN THIS CAPTURE PUT AN ACCOUNT ON A STORE LISTING?
//
// 🔴 THE DEFECT, 2026-08-05. The Play capture produced five frames and the
// fifth, `05-settings.png`, rendered the signed-in account at the top of the
// settings card in large legible type. CI captures signed in as the throwaway
// end-to-end account, so the frame read `subscriptiontracker-e2e+…@nikatru.com` — an internal
// test address on a public marketing asset, and the first thing a reader's eye
// lands on. It was found by a human OPENING THE IMAGE.
//
// ⚠️ AND IT COULD ONLY BE FOUND THAT WAY. `assert-listing-assets.mjs` decodes
// every frame and passed all five: it measures size, colour type, aspect and a
// full-width band of ONE COLOUR (the demo banner). Nothing in this tree can read
// TEXT out of a PNG, and inventing something that pretends to would be worse
// than admitting it — a detector that fires on some glyphs and not others
// reports "clean" for the frames it cannot read.
//
// So the check moved UPSTREAM of the pixels, to the two places where the answer
// is still knowable:
//
//   1. AT CAPTURE TIME, in `store_capture_guard.dart`, which reads the real
//      widget tree one instruction before the shutter and refuses to photograph
//      a frame carrying the session's own identity. That is the limb that covers
//      a shared widget nobody audited, a frame added months from now, and a
//      local run signed in as a real person rather than as the CI throwaway.
//
//   2. STATICALLY — this file — so the same mistake fails on the PUSH that makes
//      it rather than on a capture run that needs CI-only secrets, a provisioned
//      Supabase user and a browser. It resolves every frame the suite captures to
//      the SCREEN SOURCE it photographs and asks whether that source touches the
//      account address at all — an over-approximation, stated at
//      `readsAccountAddress` below rather than relied on quietly.
//
// Imported by BOTH `tooling/ci/assert-listing-assets.mjs` (every push) and
// `tooling/store/capture-play-screenshots.mjs` (before chromedriver or Flutter is
// touched, so a bad suite never starts a browser). One implementation, because
// two readings of "does this capture leak the account" would eventually differ
// and the disagreement would be silent.
//
// ── WHAT MAKES THE ASSOCIATION POSSIBLE, AND WHY THE SUITE LOOKS LIKE IT DOES ─
// The suite's own convention is the contract this reads:
//
//     expect(find.byType(HomeScreen), findsWidgets);
//     await captureFrame(take: shutter, frame: '01-home', …);
//
// Each capture names the screen it is of, on the line above. A `shot(name)`
// wrapper — which is what the suite used to have — collapses every capture to
// ONE call site, and the association below collapses with it into a scan over
// nothing that prints ok. So the wrapper is gone, and a capture that cannot be
// resolved to a screen is a FAILURE here rather than a frame quietly skipped.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from '../ci/tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from '../ci/text-reductions.mjs';

/** The capture suite, relative to an app directory. */
export const SUITE_FILE = 'integration_test/store_screenshots_test.dart';
/** The refusal the suite must route every frame through. */
export const GUARD_FILE = 'integration_test/store_capture_guard.dart';
/** The shutter the suite binds once and hands to every frame. */
export const SHUTTER_FILE = 'integration_test/store_frame_shutter.dart';

/**
 * The capture devices with no platform shutter, each with the `TargetPlatform`
 * the shutter file must map to the LAYER shutter. The register's
 * `capture.flutterDevice` is the key. ⏱ 2026-09-24, O-DESKTOP-CAPTURE-HAS-NO-SHUTTER.
 */
export const DESKTOP_DEVICES = new Map([
  ['linux', 'TargetPlatform.linux'],
  ['windows', 'TargetPlatform.windows'],
  ['macos', 'TargetPlatform.macOS'],
]);

/**
 * The `--dart-define` pair that tells the suite which geometry to impose, for a
 * runner capture `{ flutterDevice, cssWidth, cssHeight, dpr }`. Two tokens, the
 * way `flutter drive` takes every define. `[]` for any device that is not a
 * desktop (a phone simulator, or web, whose `flutterDevice` is null): those use
 * the platform shutter, and the suite refuses the define there.
 */
export function storeViewDefineArgs(cap) {
  if (!DESKTOP_DEVICES.has(cap?.flutterDevice)) return [];
  return ['--dart-define', `STORE_CAPTURE_VIEW=${cap.cssWidth}x${cap.cssHeight}@${cap.dpr}`];
}

/**
 * A read of the signed-in account's ADDRESS.
 *
 * 🔴 THE ADDRESS ONLY, AND `displayName` DELIBERATELY NOT. `AuthUser.email` is
 * non-empty for every signed-in user, so putting it in a captured frame is
 * unconditionally the defect. `displayName` is NULLABLE and `HomeScreen` already
 * renders it (`user?.displayName ?? 'Welcome'`) — it is null for the provisioned
 * CI account, so Home draws the fallback. Failing the build on it would forbid
 * capturing Home, which is the frame Google's "prioritize UI in the first three"
 * note is about. The conditional half is covered where it can be answered
 * exactly: the capture-time refusal, which compares against the session the app
 * is actually holding.
 */
const ACCOUNT_ADDRESS_READ = /\.email\b/;

/**
 * Does this Dart source TOUCH the signed-in account's address at all?
 *
 * Comments AND string literals are removed first. This repository has twice
 * shipped a guard satisfied by its own explanatory prose, and once one that
 * matched a template comment explaining why the thing it looked for was absent.
 * A `'…email…'` label is a word on screen, not a read of the session.
 *
 * ⚠️ IT ASKS "TOUCHES", NOT "RENDERS", AND THAT OVER-APPROXIMATION IS STATED
 * RATHER THAN QUIETLY RELIED ON. Measured while mutation-testing this guard on
 * 2026-08-05: with `settings_screen.dart`'s account-card `Text(user?.email)`
 * removed, the file STILL matches — because `_deleteAccount` re-authenticates
 * with `auth.signInWithEmail(email: user.email, …)`, a read that never reaches
 * the screen. So this limb would refuse a settings frame whose address row was
 * genuinely gone.
 *
 * That is deliberate and it is the safe direction. A regex cannot follow a value
 * from a read to a pixel — narrowing it to "inside a `Text(`" would miss
 * `Text(_label(user))` and pass a leaking screen, which is the failure that
 * costs something. What this over-approximation costs is bounded and visible: a
 * screen that handles the account address cannot be a store frame, and the
 * remedy is to photograph a different screen. No screen this app would want on a
 * listing is affected — Home, Calendar, Insights and Budget do not read `.email`
 * at all. The precise question — is the account ON SCREEN in THIS frame — is
 * answered where it can be: `store_capture_guard.dart`, at capture time,
 * against the real widget tree.
 */
export function readsAccountAddress(dartSource) {
  return ACCOUNT_ADDRESS_READ.test(stripStringLiterals(stripSourceComments(dartSource, '.dart')));
}

/**
 * 🔴 THE DETECTOR PROVES ITSELF ON EVERY INVOCATION.
 *
 * `readsAccountAddress` is one regular expression, and the failure mode that
 * costs everything is not it being wrong — it is it being EDITED into something
 * that never matches. Every captured screen would then read clean and the limb
 * would print ok forever, which is this repository's single most repeated
 * failure and the exact way the original defect stayed invisible.
 *
 * Two synthetic sources, both shaped like the real thing: one is the settings
 * card as it actually is, one is the same card with the address row taken out.
 * If the first stops matching or the second starts, the caller must report
 * COVERAGE LOST before it looks at a single real file.
 */
export function selfTestAccountAddressDetector() {
  const leaks = [
    'class SettingsScreen extends ConsumerWidget {',
    '  Widget build(BuildContext context, WidgetRef ref) {',
    '    final AuthUser? user = ref.watch(authRepositoryProvider).currentUser;',
    "    return Text(user?.email ?? '');",
    '  }',
    '}',
  ].join('\n');
  // The same screen with the row gone — and, deliberately, with the WORD still
  // present in a comment and in a string literal, because those are the two
  // shapes that have satisfied a check in this tree before.
  const clean = [
    'class SettingsScreen extends ConsumerWidget {',
    '  // The account row used to read user?.email here.',
    '  Widget build(BuildContext context, WidgetRef ref) {',
    "    return const Text('Email preferences');",
    '  }',
    '}',
  ].join('\n');
  const onLeaking = readsAccountAddress(leaks);
  const onClean = readsAccountAddress(clean);
  return { onLeaking, onClean, ok: onLeaking === true && onClean === false };
}

/** Every `.dart` file under a directory, relative paths, bounded by the repo's
 *  one directory listing so a nested checkout cannot leak into the search. */
function dartFilesUnder(dir) {
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try {
      entries = listDir(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = join(d, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs, `${rel}${name}/`);
      else if (name.endsWith('.dart')) out.push({ abs, rel: `${rel}${name}` });
    }
  };
  walk(dir, '');
  return out;
}

/**
 * Static answer to "can this app's store capture photograph the account?".
 *
 * Returns `{ present, problems, frames }`. `present: false` means the app has no
 * capture suite at all — not a fault here, and the CALLER decides whether that is
 * expected (a fixture) or coverage loss (the real repository).
 *
 * `devices` is every `capture.flutterDevice` the caller will capture on. Limb 5
 * judges the ones in DESKTOP_DEVICES; the rest are ignored.
 */
export function scanCaptureSuite({ root, app, devices = [] }) {
  const problems = [];
  const frames = [];
  const suiteRel = `apps/${app}/${SUITE_FILE}`;
  const guardRel = `apps/${app}/${GUARD_FILE}`;
  const suiteAbs = join(root, suiteRel);
  if (!existsSync(suiteAbs)) return { present: false, problems, frames };

  const suite = stripSourceComments(readFileSync(suiteAbs, 'utf8'), '.dart');

  // ── limb 1: the refusal exists, and still refuses ─────────────────────────
  const guardAbs = join(root, guardRel);
  if (!existsSync(guardAbs)) {
    problems.push(
      `${suiteRel} captures store frames and ${guardRel} does not exist. That file is the refusal that reads the widget tree one instruction before the shutter and stops a frame carrying the signed-in account from ever becoming bytes. Without it the capture is back to where it was on 2026-08-05, when 05-settings.png put an internal test address on a public Play listing and every automated check passed it.`,
    );
  } else {
    const guard = stripSourceComments(readFileSync(guardAbs, 'utf8'), '.dart');
    if (!/\bFuture<void>\s+captureFrame\s*\(/.test(guard)) {
      problems.push(`${guardRel} no longer declares \`captureFrame\`, which is the only guarded shutter the suite is allowed to use.`);
    }
    if (!/\btextContaining\b/.test(guard)) {
      problems.push(
        `${guardRel} no longer looks for the account in the widget tree (\`textContaining\` is gone from its code). The function would still be called for every frame and would photograph all of them — a refusal that cannot refuse, which is strictly worse than none because the suite reads as guarded.`,
      );
    }
    if (!/\bforbidden\.isEmpty\b/.test(guard)) {
      problems.push(
        `${guardRel} no longer refuses on an EMPTY set of forbidden strings. With that check gone, a capture whose session went missing would examine each frame for nothing and pass it — an assertion that cannot fail, in the one place whose output is a public marketing asset.`,
      );
    }
  }

  // ── limb 2: no unguarded shutter ──────────────────────────────────────────
  // The suite names no platform shutter of its own: every frame's `take:` is the
  // one `shutter` limb 4 holds it to, and the plugin call lives in the shutter
  // file. So any `takeScreenshot(` call in the suite is a frame that skipped
  // `captureFrame`.
  if (/\btakeScreenshot\s*\(/.test(suite)) {
    problems.push(
      `${suiteRel} calls \`takeScreenshot(\` directly. Every frame must go through \`captureFrame\` in ${guardRel}, which refuses to photograph a frame carrying the signed-in account. This is how the defect comes back — not by somebody deleting the refusal, but by somebody adding one more frame in the obvious way.`,
    );
  }

  // ── limb 4: ONE shutter, and every frame takes it ─────────────────────────
  // ⏱ 2026-09-24 (O-DESKTOP-CAPTURE-HAS-NO-SHUTTER). The suite binds one
  // `storeShutter(…)` — the plugin on web and phones, the root layer on the
  // desktops — and hands it to `captureFrame` as `take: shutter`. A frame given
  // a tear-off such as `take: binding.takeScreenshot` photographs through the
  // plugin on every platform, and on a desktop that is no photograph at all. A
  // second binding is a second shutter nobody chose, and a direct `shutter(`
  // call is a frame that skipped `captureFrame`'s refusal.
  //
  // Placed BEFORE limb 3 on purpose: limb 3 returns early when it resolves no
  // frame or reads no screen source, and a check after it would stop running on
  // exactly those suites. Read with string literals blanked as well, since a
  // refusal message that says "the shutter (…)" is prose, not a call. Blanking
  // keeps every offset, so a line number still points into the real file.
  const code = stripStringLiterals(suite);
  const lineAt = (index) => code.slice(0, index).split('\n').length;
  const bindings = [...code.matchAll(/\bstoreShutter\s*\(/g)];
  if (bindings.length !== 1) {
    problems.push(
      `${suiteRel}${bindings.length ? `:${lineAt(bindings[1].index)}` : ''} — limb 4 (one shutter): the suite binds ${bindings.length} \`storeShutter(\` shutter(s), and it must bind exactly ONE and pass it to every frame as \`take: shutter\`. ` +
        `Zero means the frames take whatever they are handed, which on a desktop is a plugin shutter that does not exist; two means a second shutter that ${SHUTTER_FILE}'s platform choice never made.`,
    );
  }
  for (const m of code.matchAll(/\btake:\s*([^,)\s]+)/g)) {
    if (m[1] === 'shutter') continue;
    problems.push(
      `${suiteRel}:${lineAt(m.index)} — limb 4 (one shutter): a frame is handed \`take: ${m[1]}\`. Every frame takes the one \`shutter\` the suite binds with \`storeShutter(\`, which photographs through the plugin on web, android and iOS and renders the root layer on linux, windows and macOS. Anything else photographs through the plugin everywhere, and a desktop capture has no plugin shutter.`,
    );
  }
  for (const m of code.matchAll(/\bshutter\s*\(/g)) {
    problems.push(
      `${suiteRel}:${lineAt(m.index)} — limb 4 (one shutter): the shutter is called directly. A frame taken that way skips \`captureFrame\` in ${guardRel}, the refusal that stops a frame carrying the signed-in account from becoming bytes.`,
    );
  }

  // ── limb 5: every desktop device the register captures on gets the layer ──
  // Read from the shutter file's CODE, comments blanked: an arm that exists
  // only in a comment maps nothing. One arm per desktop device, in the form
  // `TargetPlatform.linux => StoreShutterKind.layer,`.
  const desktops = [...new Set(devices)].filter((d) => DESKTOP_DEVICES.has(d));
  if (desktops.length) {
    const shutterRel = `apps/${app}/${SHUTTER_FILE}`;
    const shutterAbs = join(root, shutterRel);
    if (!existsSync(shutterAbs)) {
      problems.push(
        `${shutterRel} does not exist, and the register captures on ${desktops.join(', ')} — limb 5 (desktop shutter): a desktop capture has no platform shutter, so without this file's layer shutter it cannot photograph a frame at all.`,
      );
    } else {
      const shutterCode = stripSourceComments(readFileSync(shutterAbs, 'utf8'), '.dart');
      for (const device of desktops) {
        const platform = DESKTOP_DEVICES.get(device);
        const arm = new RegExp(`^\\s*${platform.replace('.', '\\.')}\\s*=>\\s*StoreShutterKind\\.layer\\s*,`, 'm');
        if (!arm.test(shutterCode)) {
          problems.push(
            `${shutterRel} — limb 5 (desktop shutter): the register captures on \`${device}\` and the shutter file's code has no \`${platform} => StoreShutterKind.layer,\` arm. That device would be photographed through the plugin shutter, which a desktop does not have, or by no shutter at all.`,
          );
        }
      }
    }
  }

  // ── limb 3: every frame resolves to the screen it photographs ─────────────
  const calls = [...suite.matchAll(/\bcaptureFrame\s*\(/g)];
  if (calls.length === 0) {
    problems.push(
      `${suiteRel} contains no \`captureFrame(\` call, so this scan resolved ZERO frames and every check below ranged over nothing. Either the suite stopped capturing anything — in which case the store screenshot set can no longer be regenerated — or the capture was rewritten in a shape this scan cannot read, which reports the same thing as a clean suite.`,
    );
    return { present: true, problems, frames };
  }

  const libDir = join(root, 'apps', app, 'lib');
  const sources = dartFilesUnder(libDir);
  if (sources.length === 0) {
    problems.push(
      `${suiteRel} captures ${calls.length} frame(s) and apps/${app}/lib holds no Dart source, so no captured screen could be resolved or read. Every screen would be reported clean by never being opened.`,
    );
    return { present: true, problems, frames };
  }

  const declares = (screen) => {
    const pattern = new RegExp(`\\bclass\\s+${screen}\\b`);
    return sources.find((f) => pattern.test(stripSourceComments(readFileSync(f.abs, 'utf8'), '.dart')));
  };

  for (let i = 0; i < calls.length; i++) {
    const at = calls[i].index;
    const from = i === 0 ? 0 : calls[i - 1].index;
    const before = suite.slice(from, at);
    const args = suite.slice(at, i + 1 < calls.length ? calls[i + 1].index : suite.length);
    const frame = args.match(/\bframe:\s*'([^']*)'/)?.[1] ?? `#${i + 1}`;

    const byType = [...before.matchAll(/\bfind\.byType\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)];
    if (byType.length === 0) {
      problems.push(
        `${suiteRel}: the capture of "${frame}" is not preceded by a \`find.byType(...)\` naming the screen it photographs, so this scan cannot tell WHICH screen ends up on the listing and cannot check whether that screen renders the account address. A frame nobody can name is a frame nobody can vet — assert the screen on the line above the capture, the way every other frame does.`,
      );
      continue;
    }
    const screen = byType[byType.length - 1][1];
    const file = declares(screen);
    if (!file) {
      problems.push(
        `${suiteRel}: the capture of "${frame}" photographs \`${screen}\`, and no file under apps/${app}/lib declares \`class ${screen}\`. The screen source could not be read, so it was not checked for the account address — and an unread screen must not be reported as a clean one.`,
      );
      continue;
    }
    frames.push({ frame, screen, file: `apps/${app}/lib/${file.rel}` });
    if (readsAccountAddress(readFileSync(file.abs, 'utf8'))) {
      problems.push(
        `${suiteRel}: the capture of "${frame}" photographs \`${screen}\`, and apps/${app}/lib/${file.rel} READS THE SIGNED-IN ACCOUNT'S ADDRESS off the session (\`.email\`). That frame goes on a public Play listing. It happened on 2026-08-05: the settings frame carried \`subscriptiontracker-e2e+…@nikatru.com\`, every size/format/posture/banner check passed it, and it was caught only because a human opened the PNG — no guard in this tree can read text out of an image. ⚠️ This asks whether the screen TOUCHES the address, not whether it draws it: a regex cannot follow a value from a read to a pixel, and the narrow version would miss \`Text(_label(user))\` and pass a leaking frame. So a screen that handles the address cannot be a store frame — photograph one that does not, or move the read out of this screen.`,
      );
    }
  }

  return { present: true, problems, frames };
}
