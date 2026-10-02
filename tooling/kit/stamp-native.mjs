#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stamp-native.mjs — the five NATIVE platform folders of a stamped app, branded
// and waived, so app #2 inherits every target app #1 builds for and not web alone.
//
// Row O-BRICK-STAMPS-WEB-ONLY (D30). Called by tooling/bricks/app/hooks/post_gen.dart
// (`_stampNativePlatforms`) BEFORE the site chain, so render.mjs writes the
// app's icon label and export-compliance answer into native files that exist.
//
// Usage:  node tooling/kit/stamp-native.mjs --app <id>            # stamp
//         node tooling/kit/stamp-native.mjs --app <id> --check    # verify only
//
// ── WHY THE BRICK DID NOT DO THIS, AND WHAT IT COST ─────────────────────────
// The brick stamped `web/` only and PRINTED the rest as checklist steps 1a and
// 1b: run `flutter create . --platforms=…`, then brand the icons, then copy two
// dated waivers and one manifest removal out of the app that already carries
// them. Every one of those steps is mechanical, and the first app paid for each
// one being manual (the stock icon on four platforms, a blank splash on two).
// And the build-platforms matrix is every `apps/` workspace member with no
// platform filter, so a web-only app #2 turns the weekly proof red on every
// native job the day it is committed. assert-stamp-platforms.mjs's app-set limb
// now says so on the PR instead.
//
// ── WHAT THIS FILE WRITES, IN ORDER ─────────────────────────────────────────
//   1. `flutter create --no-pub` into a TEMPORARY directory, never into
//      apps/<id>: in the app directory it also writes test/widget_test.dart
//      (which names a `MyApp` the template does not have, so analyze and test go
//      red), a member pubspec.lock, .idea/ and an .iml. Only the five platform
//      folders are copied back. A folder that already exists is KEPT, never
//      overwritten: a re-stamp must not erase hand edits.
//   2. The two DATED WAIVERS and the one manifest REMOVAL that
//      assert-inappwebview-waivers.mjs and assert-android-vapt-manifest.mjs V5
//      grade, each with the reason written beside it.
//   3. The SPLASH, from the stamped brand seed: tooling/store/render-splash.mjs's
//      derivation from assets/icon/app_icon_1024.png, plus the two declarations
//      that make it drawn (the storyboard's LaunchImage size, the Android
//      launch_background bitmap taken out of its comment). Graded by
//      assert-launcher-icons.mjs limb 8.
//   4. The two PrivacyInfo.xcprivacy files and their place in each Runner
//      target's Resources phase, which assert-apple-privacy-manifest.mjs owes a
//      PREVIEW audit for every Apple platform app.yaml declares.
//   5. The Linux packaging (desktop entry + hicolor icons), from
//      tooling/store/render-linux-icons.mjs's derivation, and the two edits that
//      make it reach a user: the CMake install rules and the window icon call.
//   6. The ANCHOR render.mjs needs in the macOS Info.plist (CFBundleDisplayName,
//      which `flutter create` writes for iOS only); the value is render's.
// The launcher icons are NOT here: `dart run flutter_launcher_icons` needs the
// resolved workspace, which tooling/kit/stamp-app.mjs creates after mason.
//
// Exit 0 = every artefact is in place (or was written). Exit 1 = refused or drift.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANDROID_BACKGROUNDS,
  ANDROID_DRAWABLE_NAME,
  IOS_BASE_PX,
  IOS_STORYBOARD,
  SplashBrandUnavailable,
  backgroundDrawsSplash,
  deriveSplash,
  readStoryboardImageSize,
} from '../store/render-splash.mjs';
import { LinuxBrandUnavailable, deriveLinuxPackaging } from '../store/render-linux-icons.mjs';
import { APP_TARGET_NAME, MANIFEST_REL, PBXPROJ_REL } from '../store/render-apple-privacy-manifest.mjs';
import { parsePbxproj } from '../ci/assert-apple-privacy-manifest.mjs';
import { appIdProblems } from '../../contracts/app-id/app-id.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The native platforms `flutter create` writes for a stamp. `web` is not here:
 *  the brick's own template carries `web/`. These are BUILD targets, not the
 *  published claim (post_gen.dart's `claim`, which stays `web`: a stamp has no
 *  store identity to publish under). assert-stamp-platforms.mjs imports this
 *  list and holds it to every platform build-platforms.yml compiles for a
 *  workspace app, so a platform the weekly proof gains is one the stamp gains. */
export const NATIVE_PLATFORMS = ['android', 'ios', 'macos', 'windows', 'linux'];

/** The reverse-domain prefix every app id is stamped under: the Android
 *  applicationId, the Apple bundle id and the Linux APPLICATION_ID become
 *  `com.nikatru.<id>`. The same prefix tooling/apple-provisioning.json registers
 *  and render-linux-icons.mjs's auth-callback scheme is built from. */
export const ORG = 'com.nikatru';

/** The file one waiver or removal lives in, relative to an app directory. */
export const GRADLE_PROPERTIES = 'android/gradle.properties';
export const WINDOWS_CMAKE = 'windows/CMakeLists.txt';
export const ANDROID_MANIFEST = 'android/app/src/main/AndroidManifest.xml';
export const MACOS_INFO_PLIST = 'macos/Runner/Info.plist';
export const LINUX_CMAKE = 'linux/CMakeLists.txt';
export const LINUX_RUNNER = 'linux/runner/my_application.cc';

const GRADLE_WAIVER_LINE = 'android.r8.proguardAndroidTxt.disallowed=false';
const GRADLE_WAIVER_LIVE = /^\s*android\.r8\.proguardAndroidTxt\.disallowed\s*=\s*false\s*$/m;
const CMAKE_DEFINE = 'add_compile_definitions(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)';
const CMAKE_DEFINE_LIVE = /^\s*add_compile_definitions\(\s*_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS\s*\)/m;
const CMAKE_PLUGINS_LIVE = /^\s*include\(\s*flutter\/generated_plugins\.cmake\s*\)/m;
const AMAZON_RECEIVER = 'com.amazon.device.iap.ResponseReceiver';
/** Every RegExp metacharacter escaped, the backslash included (CodeQL #570). */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOOLS_NS = 'xmlns:tools="http://schemas.android.com/tools"';

/** A transform met a file it does not recognise. Refusing beats guessing: a
 *  waiver inserted in the wrong scope builds green and waives nothing. */
export class NativeStampRefused extends Error {}

// ── 2. the waivers and the removal ──────────────────────────────────────────
// Every transform is IDEMPOTENT and returns the text unchanged when its line is
// already live, so a re-stamp and a hand-edited app both pass through it.

/** android/gradle.properties with the AGP 9 proguard waiver on a live line.
 *  ASCII only: Gradle reads this file as ISO-8859-1. */
export function withGradleWaiver(text) {
  if (GRADLE_WAIVER_LIVE.test(text)) return text;
  const block = [
    '',
    '# --- DATED WAIVER, stamped by tooling/kit/stamp-native.mjs ---',
    '# ASCII ONLY IN THIS FILE ON PURPOSE: Gradle reads gradle.properties as ISO-8859-1.',
    '#',
    "# AGP 9 made getDefaultProguardFile('proguard-android.txt') throw. The plugin that",
    '# still asks for it is flutter_inappwebview_android, which arrives transitively under',
    '# cloudflare_turnstile, and it has no release to move to. This is the escape hatch',
    '# named in the AGP 9.0.0 release notes, scoped to this Gradle build.',
    '# tooling/ci/assert-inappwebview-waivers.mjs requires it of every app that pulls that',
    '# plugin. Delete it the day the plugin asks for proguard-android-optimize.txt.',
    GRADLE_WAIVER_LINE,
  ];
  return `${text.replace(/\n*$/, '\n')}${block.join('\n')}\n`;
}

/** windows/CMakeLists.txt with the STL1011 define at DIRECTORY scope, above the
 *  include that adds the plugin subdirectories (which inherit it). */
export function withWindowsWaiver(text) {
  const plugins = CMAKE_PLUGINS_LIVE.exec(text);
  if (plugins === null) {
    throw new NativeStampRefused(
      `${WINDOWS_CMAKE} has no live include(flutter/generated_plugins.cmake), so there is no directory scope to put the define above.`,
    );
  }
  const define = CMAKE_DEFINE_LIVE.exec(text);
  if (define !== null && define.index < plugins.index) return text;
  const block = [
    '# --- DATED WAIVER, stamped by tooling/kit/stamp-native.mjs ---',
    '# The MSVC 14.51 STL makes <experimental/coroutine> a hard error (STL1011), and',
    '# flutter_inappwebview_windows, which arrives transitively under cloudflare_turnstile,',
    '# includes it with no release to move to. DIRECTORY scope, above the plugin include,',
    '# so the plugin subdirectories inherit it; tooling/ci/assert-inappwebview-waivers.mjs',
    '# requires exactly that placement. Delete it the day the plugin builds on <coroutine>.',
    CMAKE_DEFINE,
    '',
    '',
  ].join('\n');
  return text.slice(0, plugins.index) + text.slice(plugins.index).replace(/^\s*/, (ws) => `${ws}${block}`);
}

/** The Android manifest with RevenueCat's Amazon receiver removed from the merge,
 *  and the `tools` namespace that removal needs. */
export function withAmazonReceiverRemoved(text) {
  let out = text;
  if (!/<manifest\b[^>]*\bxmlns:tools\s*=/.test(out)) {
    const open = /<manifest\b/.exec(out);
    if (open === null) throw new NativeStampRefused(`${ANDROID_MANIFEST} has no <manifest> element.`);
    out = `${out.slice(0, open.index)}<manifest ${TOOLS_NS}${out.slice(open.index + '<manifest'.length)}`;
  }
  const live = new RegExp(`<receiver\\s[^>]*android:name="${escapeRegExp(AMAZON_RECEIVER)}"[^>]*tools:node="remove"`);
  if (live.test(stripXmlComments(out))) return out;
  const close = out.lastIndexOf('</application>');
  if (close === -1) throw new NativeStampRefused(`${ANDROID_MANIFEST} has no </application> to put the removal inside.`);
  const block = [
    '        <!-- DATED REMOVAL, stamped by tooling/kit/stamp-native.mjs. purchases_flutter',
    '             (through packages/billing_revenuecat) merges in this receiver: exported,',
    '             and guarded only by a permission no app here declares, so any app',
    '             installed first can hold that permission and reach it.',
    '             assert-android-vapt-manifest.mjs V5 fails the build on it. No purchase',
    '             rail in tooling/channel-register.json sells through Amazon.',
    '             REVERT CONDITION: an Amazon rail is declared. -->',
    `        <receiver android:name="${AMAZON_RECEIVER}" tools:node="remove" />`,
    '',
  ].join('\n');
  return `${out.slice(0, close)}${block}    ${out.slice(close).replace(/^\s*/, '')}`;
}

/** The Android manifest with sentry-android's NDK signal handler switched OFF.
 *  ⏱ 2026-10-02 (club apply-ci, the first CI red). Every Android row of
 *  tooling/channel-register.json declares crashSink.native=false, and
 *  assert-seams-wired.mjs requires this meta-data inside <application> of every
 *  workspace app's manifest: the Dart `enableNativeCrashHandling = false` does not
 *  reach the NDK handler, and SentryAndroid.init reads this switch first. A
 *  stamped app is graded from its first commit, so the stamp writes it, in the
 *  shape the first app carries. Comment-stripped, so prose about it is not it. */
export function withNdkSwitchedOff(text) {
  const src = stripXmlComments(text);
  const open = src.search(/<application[\s>]/);
  const shut = src.indexOf('</application>');
  if (open >= 0 && shut > open) {
    for (const m of src.slice(open, shut).matchAll(/<meta-data\b[^>]*>/g)) {
      if (/android:name\s*=\s*"io\.sentry\.ndk\.enable"/.test(m[0]) && /android:value\s*=\s*"false"/.test(m[0])) return text;
    }
  }
  const close = text.lastIndexOf('</application>');
  if (close === -1) throw new NativeStampRefused(`${ANDROID_MANIFEST} has no </application> to put the NDK switch inside.`);
  const block = [
    '        <!-- NATIVE CRASH LAYER OFF, stamped by tooling/kit/stamp-native.mjs. Every',
    '             Android row of tooling/channel-register.json declares',
    '             crashSink.native=false; the Dart enableNativeCrashHandling = false does',
    "             not reach sentry-android's NDK signal handler, and SentryAndroid.init",
    '             reads this switch from the manifest first.',
    '             tooling/ci/assert-seams-wired.mjs fails while a row says native=false',
    '             and this line is gone. -->',
    '        <meta-data',
    '            android:name="io.sentry.ndk.enable"',
    '            android:value="false" />',
    '',
  ].join('\n');
  return `${text.slice(0, close)}${block}    ${text.slice(close).replace(/^\s*/, '')}`;
}

/** The macOS Info.plist with a CFBundleDisplayName key for render.mjs to fill.
 *  `flutter create` writes one into the iOS plist and NONE into the macOS one,
 *  and render.mjs refuses (COVERAGE LOST) an Apple plist that lacks the anchor of
 *  a name field it owns. The value is the build's own PRODUCT_NAME until the
 *  site chain renders the declared icon label over it; placed where the first
 *  app carries it, after CFBundleInfoDictionaryVersion. */
export function withMacosDisplayNameKey(text) {
  if (/<key>CFBundleDisplayName<\/key>/.test(text)) return text;
  const after = /(<key>CFBundleInfoDictionaryVersion<\/key>\s*<string>[^<]*<\/string>)(\r?\n)/.exec(text);
  if (after === null) throw new NativeStampRefused(`${MACOS_INFO_PLIST} has no CFBundleInfoDictionaryVersion entry to place CFBundleDisplayName after.`);
  const at = after.index + after[1].length;
  const nl = after[2];
  return `${text.slice(0, at)}${nl}\t<key>CFBundleDisplayName</key>${nl}\t<string>$(PRODUCT_NAME)</string>${text.slice(at)}`;
}

// ── 5. the Linux packaging's two consumers ──────────────────────────────────
// The desktop entry and the hicolor icons are files; these two edits are what
// get them into the bundle and onto the window. assert-launcher-icons.mjs limb 7
// grades both, and `flutter create` writes neither.

const LINUX_INSTALL_DESKTOP = 'install(FILES "${LINUX_PACKAGING_DIR}/${APPLICATION_ID}.desktop"';
const LINUX_INSTALL_ICONS = 'install(DIRECTORY "${LINUX_PACKAGING_DIR}/icons"';

/** linux/CMakeLists.txt with the two install rules that stage the packaging
 *  under the bundle's standard `share/` prefix, which every packaging layer reads. */
export function withLinuxPackagingInstall(text) {
  const code = text.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
  if (code.includes(LINUX_INSTALL_DESKTOP) && code.includes(LINUX_INSTALL_ICONS)) return text;
  if (code.includes('LINUX_PACKAGING_DIR')) {
    throw new NativeStampRefused(`${LINUX_CMAKE} already names LINUX_PACKAGING_DIR without both install rules; finish it by hand.`);
  }
  const block = [
    '',
    '# === Linux launcher icon (stamped by tooling/kit/stamp-native.mjs) ===',
    '# The Linux embedder has no icon slot: the icon is a PACKAGING artefact, a',
    '# desktop entry plus a hicolor theme under linux/packaging/, derived by',
    '# tooling/store/render-linux-icons.mjs. These two rules stage them under the',
    "# bundle's share/ prefix, which every packaging layer reads; without them the",
    '# icon exists in git and nowhere a user can see. assert-launcher-icons.mjs',
    '# limb 7 checks they are still here.',
    'set(LINUX_PACKAGING_DIR "${CMAKE_CURRENT_SOURCE_DIR}/packaging")',
    '',
    LINUX_INSTALL_DESKTOP,
    '  DESTINATION "${CMAKE_INSTALL_PREFIX}/share/applications" COMPONENT Runtime)',
    '',
    LINUX_INSTALL_ICONS,
    '  DESTINATION "${CMAKE_INSTALL_PREFIX}/share" COMPONENT Runtime)',
  ];
  return `${text.replace(/\n*$/, '\n')}${block.join('\n')}\n`;
}

const LINUX_ICON_CALL = /gtk_window_set_icon_name\s*\(\s*window\s*,\s*APPLICATION_ID\s*\)/;

/** linux/runner/my_application.cc naming the window's icon by APPLICATION_ID,
 *  the name the desktop entry and the installed theme carry. */
export function withLinuxWindowIcon(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (LINUX_ICON_CALL.test(code)) return text;
  const anchor = /^([ \t]*)g_autoptr\(FlDartProject\) project = fl_dart_project_new\(\);/m.exec(text);
  if (anchor === null) {
    throw new NativeStampRefused(`${LINUX_RUNNER} has no \`g_autoptr(FlDartProject) project = fl_dart_project_new();\` to put the window icon before.`);
  }
  const ind = anchor[1];
  const block =
    `${ind}// The window icon, by the name the desktop entry and the installed hicolor\n` +
    `${ind}// theme carry (stamped by tooling/kit/stamp-native.mjs). Without it the mark\n` +
    `${ind}// shows on the desktops that read the entry and a placeholder on the rest.\n` +
    `${ind}gtk_window_set_icon_name(window, APPLICATION_ID);\n\n`;
  return text.slice(0, anchor.index) + block + text.slice(anchor.index);
}

// ── 3. the splash declarations ──────────────────────────────────────────────

/** The storyboard with LaunchImage declared at the size the 1x asset has. */
export function withStoryboardLaunchSize(text) {
  const size = readStoryboardImageSize(text);
  if (size === null) throw new NativeStampRefused(`${IOS_STORYBOARD} names no LaunchImage image resource with a size.`);
  if (size.width === IOS_BASE_PX && size.height === IOS_BASE_PX) return text;
  return text.replace(/<image\s[^>]*name="LaunchImage"[^>]*\/?>/, (el) =>
    el.replace(/\bwidth="[^"]*"/, `width="${IOS_BASE_PX}"`).replace(/\bheight="[^"]*"/, `height="${IOS_BASE_PX}"`),
  );
}

/** A launch_background.xml whose bitmap item is LIVE markup naming the derived
 *  drawable. What `flutter create` writes is that item inside a comment. */
export function withLaunchBitmap(text) {
  if (backgroundDrawsSplash(text)) return text;
  const stock = /<!--\s*You can insert your own image assets here\s*-->\s*<!--\s*(<item>[\s\S]*?<\/item>)\s*-->/;
  const m = stock.exec(text);
  if (m === null) {
    throw new NativeStampRefused(
      'launch_background.xml is not the stock template (no commented <item> under "You can insert your own image assets here"), and it does not draw the splash either.',
    );
  }
  const item = m[1].replace(/android:src\s*=\s*"@(?:mipmap|drawable)\/[^"]*"/, `android:src="@drawable/${ANDROID_DRAWABLE_NAME}"`);
  const note =
    '<!-- THE BRAND MARK, CENTRED. Stamped live by tooling/kit/stamp-native.mjs: the stock\n' +
    '         template ships this item inside a comment, which is a blank launch window. The\n' +
    '         PNGs are derived by tooling/store/render-splash.mjs from assets/icon/app_icon_1024.png\n' +
    '         and assert-launcher-icons.mjs limb 8 re-derives them. Do not hand-edit them. -->\n    ';
  return text.slice(0, m.index) + note + item + text.slice(m.index + m[0].length);
}

/** `text` with every XML comment removed (render-splash's rule, for the receiver test). */
function stripXmlComments(text) {
  let out = text;
  let prev;
  do {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/, '');
  } while (out !== prev);
  const dangling = out.indexOf('<!--');
  return dangling === -1 ? out : out.slice(0, dangling);
}

// ── 4. the Apple privacy manifests ──────────────────────────────────────────

/** The PREVIEW manifest a stamp writes. An EMPTY dictionary: it answers nothing,
 *  because the audit it is rendered from has answered nothing. A plausible
 *  answer here would be a sworn statement about code nobody has read.
 *  render-apple-privacy-manifest.mjs replaces it once the audit is sworn, and
 *  from then on assert-apple-privacy-manifest.mjs limb 1 compares it byte for byte. */
export function previewPrivacyManifest(platform) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    `<!-- PREVIEW, Platform: ${platform}. Stamped by tooling/kit/stamp-native.mjs while`,
    '     store/ios-appstore/privacy-manifest.json is "sworn": false. It declares NOTHING because',
    '     nothing has been answered. Answer the audit, then regenerate this file with',
    '     tooling/store/render-apple-privacy-manifest.mjs and never edit it by hand. -->',
    '<plist version="1.0">',
    '<dict/>',
    '</plist>',
    '',
  ].join('\n');
}

/** A 24-hex pbxproj object id, DERIVED from the app, the platform and the role,
 *  so a re-stamp writes the same project byte for byte. */
export function pbxId(id, platform, role) {
  const word = (k) => {
    let h = 0x811c9dc5;
    for (const unit of Buffer.from(`nikatru-xcprivacy|${id}|${platform}|${role}|${k}`, 'utf8')) {
      h ^= unit;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return `${word(0)}${word(1)}${word(2)}`.toUpperCase();
}

/** The project with PrivacyInfo.xcprivacy referenced from the Runner group and
 *  copied by the Runner target's Resources phase. */
export function withPrivacyManifestInProject(text, { id, platform }) {
  const objects = parsePbxproj(text);
  const runner = [...objects.values()].find((o) => o.isa === 'PBXNativeTarget' && o.name === APP_TARGET_NAME);
  if (!runner) throw new NativeStampRefused(`${PBXPROJ_REL[platform]} has no PBXNativeTarget named ${APP_TARGET_NAME}.`);
  const resources = (runner.buildPhases ?? []).map((p) => objects.get(p)).find((o) => o?.isa === 'PBXResourcesBuildPhase');
  if (!resources) throw new NativeStampRefused(`${PBXPROJ_REL[platform]}: the ${APP_TARGET_NAME} target has no PBXResourcesBuildPhase.`);
  const name = 'PrivacyInfo.xcprivacy';
  const inPhase = (resources.files ?? [])
    .map((f) => objects.get(f))
    .some((bf) => bf?.fileRef && objects.get(bf.fileRef)?.path?.endsWith(name));
  if (inPhase) return text;
  const group = [...objects.values()].find((o) => o.isa === 'PBXGroup' && o.path === APP_TARGET_NAME);
  if (!group) throw new NativeStampRefused(`${PBXPROJ_REL[platform]} has no PBXGroup with path ${APP_TARGET_NAME}.`);

  const ref = pbxId(id, platform, 'ref');
  const build = pbxId(id, platform, 'build');
  if (objects.has(ref) || objects.has(build)) {
    throw new NativeStampRefused(`${PBXPROJ_REL[platform]} already uses the derived id ${ref} or ${build}.`);
  }
  let out = text;
  const insertAfter = (anchor, line, what) => {
    const at = out.indexOf(anchor);
    if (at === -1) throw new NativeStampRefused(`${PBXPROJ_REL[platform]}: ${what} not found.`);
    const end = at + anchor.length;
    out = `${out.slice(0, end)}\n${line}${out.slice(end)}`;
  };
  insertAfter(
    '/* Begin PBXBuildFile section */',
    `\t\t${build} /* ${name} in Resources */ = {isa = PBXBuildFile; fileRef = ${ref} /* ${name} */; };`,
    'the PBXBuildFile section',
  );
  insertAfter(
    '/* Begin PBXFileReference section */',
    `\t\t${ref} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = ${name}; sourceTree = "<group>"; };`,
    'the PBXFileReference section',
  );
  const listIn = (objId, field, line, what) => {
    const header = new RegExp(`\\n\\s*${objId}\\s*(?:/\\*(?:[^*]|\\*(?!/))*\\*/\\s*)?=\\s*\\{`).exec(out);
    if (header === null) throw new NativeStampRefused(`${PBXPROJ_REL[platform]}: ${what} ${objId} not found.`);
    const open = out.indexOf(`${field} = (`, header.index);
    if (open === -1) throw new NativeStampRefused(`${PBXPROJ_REL[platform]}: ${what} ${objId} has no ${field} list.`);
    const end = open + `${field} = (`.length;
    out = `${out.slice(0, end)}\n${line}${out.slice(end)}`;
  };
  listIn(group.id, 'children', `\t\t\t\t${ref} /* ${name} */,`, 'the Runner group');
  listIn(resources.id, 'files', `\t\t\t\t${build} /* ${name} in Resources */,`, 'the Resources phase');
  return out;
}

// ── the plan: every file this stamp owns, as (path → transform or bytes) ────

/** Each text transform this stamp applies, by the platform folder it needs. */
function textEdits(id) {
  return [
    { platform: 'android', rel: GRADLE_PROPERTIES, edit: withGradleWaiver },
    { platform: 'windows', rel: WINDOWS_CMAKE, edit: withWindowsWaiver },
    { platform: 'android', rel: ANDROID_MANIFEST, edit: (t) => withNdkSwitchedOff(withAmazonReceiverRemoved(t)) },
    { platform: 'macos', rel: MACOS_INFO_PLIST, edit: withMacosDisplayNameKey },
    { platform: 'linux', rel: LINUX_CMAKE, edit: withLinuxPackagingInstall },
    { platform: 'linux', rel: LINUX_RUNNER, edit: withLinuxWindowIcon },
    { platform: 'ios', rel: IOS_STORYBOARD, edit: withStoryboardLaunchSize },
    ...ANDROID_BACKGROUNDS.map((rel) => ({ platform: 'android', rel, edit: withLaunchBitmap })),
    ...['ios', 'macos'].map((platform) => ({
      platform,
      rel: PBXPROJ_REL[platform],
      edit: (t) => withPrivacyManifestInProject(t, { id, platform }),
    })),
  ];
}

/** The derived binary artefacts: relative path → bytes. `keepIfPresent` marks a
 *  file that is replaced by its own generator later (the preview manifest). */
function derivedFiles(appDir) {
  const out = [];
  for (const [rel, bytes] of deriveSplash(appDir, { ios: true, android: true })) out.push({ rel, bytes });
  for (const [rel, bytes] of deriveLinuxPackaging(appDir)) out.push({ rel, bytes });
  for (const platform of ['ios', 'macos']) {
    out.push({ rel: MANIFEST_REL[platform], bytes: Buffer.from(previewPrivacyManifest(platform), 'utf8'), keepIfPresent: true });
  }
  return out;
}

/** The `flutter create` invocation, into `dest`. `--no-pub`: the app resolves
 *  in the root workspace, never on its own. */
export function flutterCreateArgs({ id, dest }) {
  return ['create', '--no-pub', `--platforms=${NATIVE_PLATFORMS.join(',')}`, '--project-name', id, '--org', ORG, dest];
}

/** What a flutter argument may contain before it reaches cmd.exe /c: stamp-app.mjs's
 *  SAFE_ARG, plus the comma of `--platforms=` and the tilde of a Windows 8.3 temp
 *  path. Nothing a shell reads as syntax (CodeQL #572). */
export const SAFE_FLUTTER_ARG = /^[A-Za-z0-9._/\\:=,~-]+$/;

/** The default runner: flutter on PATH (flutter.bat through cmd.exe on Windows).
 *  Every argument is checked first; a refused one runs nothing. */
function runFlutter(args) {
  const bad = args.filter((a) => typeof a !== 'string' || !SAFE_FLUTTER_ARG.test(a));
  if (bad.length) return { status: -1, output: `refused flutter argument(s) ${bad.map((a) => JSON.stringify(a)).join(', ')} (${SAFE_FLUTTER_ARG})` };
  const r =
    process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'flutter.bat', ...args], { encoding: 'utf8' })
      : spawnSync('flutter', args, { encoding: 'utf8' });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

/**
 * Stamp (or, with `check`, verify) the native folders of apps/<id>.
 * `flutter` is injectable so the suite drives every branch without the SDK.
 * Returns `{ ok, lines }`; nothing is thrown for an expected refusal.
 */
export function stampNative({ root = REPO, id, check = false, flutter = runFlutter }) {
  const lines = [];
  const appDir = join(root, 'apps', id);
  if (!existsSync(join(appDir, 'pubspec.yaml'))) {
    return { ok: false, lines: [`apps/${id}/pubspec.yaml does not exist; there is no stamped app to add native platforms to.`] };
  }

  // 1. the folders
  const missing = NATIVE_PLATFORMS.filter((p) => !existsSync(join(appDir, p)));
  if (check) {
    for (const p of missing) lines.push(`DRIFT apps/${id}/${p}/ does not exist`);
  } else if (missing.length) {
    const tmp = mkdtempSync(join(tmpdir(), 'nikatru-native-'));
    try {
      const dest = join(tmp, id);
      const r = flutter(flutterCreateArgs({ id, dest }));
      if (r.status !== 0) {
        return { ok: false, lines: [`\`flutter ${flutterCreateArgs({ id, dest: '<tmp>' }).join(' ')}\` exited ${r.status}; no native folder was written.`, r.output.trim()] };
      }
      for (const p of missing) {
        if (!existsSync(join(dest, p))) return { ok: false, lines: [`flutter create wrote no ${p}/ folder; nothing was copied.`] };
      }
      for (const p of missing) {
        cpSync(join(dest, p), join(appDir, p), { recursive: true });
        lines.push(`wrote apps/${id}/${p}/ (flutter create, ${ORG}.${id})`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  for (const p of NATIVE_PLATFORMS.filter((x) => !missing.includes(x))) lines.push(`kept  apps/${id}/${p}/ (already present; never overwritten)`);

  // 2-4. the text edits
  let drift = check ? missing.length : 0;
  for (const { platform, rel, edit } of textEdits(id)) {
    const path = join(appDir, rel);
    if (!existsSync(join(appDir, platform))) continue; // only reachable in --check, already counted
    let have;
    try {
      have = readFileSync(path, 'utf8');
    } catch {
      drift++;
      lines.push(`DRIFT apps/${id}/${rel} does not exist`);
      continue;
    }
    let want;
    try {
      want = edit(have);
    } catch (e) {
      if (!(e instanceof NativeStampRefused)) throw e;
      return { ok: false, lines: [...lines, `REFUSED apps/${id}/${rel}: ${e.message}`] };
    }
    if (want === have) continue;
    if (check) {
      drift++;
      lines.push(`DRIFT apps/${id}/${rel} is missing what the native stamp writes`);
    } else {
      writeFileSync(path, want);
      lines.push(`edit  apps/${id}/${rel}`);
    }
  }

  // 3-5. the derived files
  let derived;
  try {
    derived = derivedFiles(appDir);
  } catch (e) {
    if (!(e instanceof SplashBrandUnavailable) && !(e instanceof LinuxBrandUnavailable)) throw e;
    return { ok: false, lines: [...lines, ...e.lines.map((l) => `REFUSED ${l}`)] };
  }
  for (const { rel, bytes, keepIfPresent } of derived) {
    const path = join(appDir, rel);
    let have = null;
    try {
      have = readFileSync(path);
    } catch {
      have = null;
    }
    if (have !== null && (keepIfPresent || have.equals(bytes))) continue;
    if (check) {
      drift++;
      lines.push(`DRIFT apps/${id}/${rel} ${have === null ? 'does not exist' : 'differs from its derivation'}`);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      lines.push(`wrote apps/${id}/${rel} (${bytes.length} bytes)`);
    }
  }
  return { ok: drift === 0, lines };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--app');
  const id = at === -1 ? null : argv[at + 1];
  const check = argv.includes('--check');
  const idProblems = id ? appIdProblems(id) : ['no --app <id> was given.'];
  if (idProblems.length) {
    console.error('usage: node tooling/kit/stamp-native.mjs --app <id> [--check]');
    for (const p of idProblems) console.error(`  ${p}`);
    process.exit(1);
  }
  const { ok, lines } = stampNative({ id, check });
  for (const l of lines) (ok ? console.log : console.error)(`  ${l}`);
  if (!ok) {
    console.error(`stamp-native: ${check ? 'apps/' + id + ' is not what the native stamp writes' : 'REFUSED'} — run  node tooling/kit/stamp-native.mjs --app ${id}`);
    process.exit(1);
  }
  console.log(`stamp-native: ok — apps/${id} carries ${NATIVE_PLATFORMS.join(', ')}${check ? ' as the native stamp writes them' : ''}.`);
}
