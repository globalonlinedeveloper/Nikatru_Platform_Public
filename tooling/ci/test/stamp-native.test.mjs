// ─────────────────────────────────────────────────────────────────────────────
// stamp-native.test.mjs — tooling/kit/stamp-native.mjs must write what the
// guards grade, refuse what it does not recognise, and never clobber.
//
// Row O-BRICK-STAMPS-WEB-ONLY (D30). Three layers:
//   · each TRANSFORM on the stock shape `flutter create` writes (Flutter
//     3.47.5, measured 2026-10-01), checked with the reader the GUARD uses —
//     backgroundDrawsSplash, readStoryboardImageSize, parsePbxproj — never with
//     a second idea of the answer; idempotent; refusing an unknown shape;
//   · app #1's hand-made native files are a FIXED POINT of every transform:
//     the shape the first app converged on by hand is the shape the stamp
//     recognises as done, so a re-stamp over it changes nothing;
//   · the ORCHESTRATOR with an injected `flutter`: what it copies, what it
//     keeps, what `--check` reports, and that a failed create writes nothing.
//
// Run:  node --test tooling/ci/test/stamp-native.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NATIVE_PLATFORMS,
  ORG,
  flutterCreateArgs,
  stampNative,
  withAmazonReceiverRemoved,
  withGradleWaiver,
  withLaunchBitmap,
  withLinuxPackagingInstall,
  withLinuxWindowIcon,
  withMacosDisplayNameKey,
  withPrivacyManifestInProject,
  withStoryboardLaunchSize,
  withWindowsWaiver,
  NativeStampRefused,
} from '../../kit/stamp-native.mjs';
import { backgroundDrawsSplash, readStoryboardImageSize, IOS_BASE_PX, ANDROID_BACKGROUNDS } from '../../store/render-splash.mjs';
import { parsePbxproj } from '../assert-apple-privacy-manifest.mjs';
import { encodeRgba } from '../../store/png-codec.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP1 = join(REPO, 'apps', 'subscriptiontracker');

// ── the stock shapes `flutter create` writes ────────────────────────────────
const STOCK = {
  'android/gradle.properties':
    'org.gradle.jvmargs=-Xmx8G -XX:MaxMetaspaceSize=4G\nandroid.useAndroidX=true\n',
  'android/app/src/main/AndroidManifest.xml': [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <application',
    '        android:label="demo"',
    '        android:icon="@mipmap/ic_launcher">',
    '        <activity android:name=".MainActivity" android:exported="true" />',
    '    </application>',
    '</manifest>',
    '',
  ].join('\n'),
  'android/app/src/main/res/drawable/launch_background.xml': [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Modify this file to customize your launch splash screen -->',
    '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <item android:drawable="@android:color/white" />',
    '',
    '    <!-- You can insert your own image assets here -->',
    '    <!-- <item>',
    '        <bitmap',
    '            android:gravity="center"',
    '            android:src="@mipmap/launch_image" />',
    '    </item> -->',
    '</layer-list>',
    '',
  ].join('\n'),
  'ios/Runner/Base.lproj/LaunchScreen.storyboard': [
    '<document>',
    '    <resources>',
    '        <image name="LaunchImage" width="168" height="185"/>',
    '    </resources>',
    '</document>',
    '',
  ].join('\n'),
  'macos/Runner/Info.plist': [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>CFBundleInfoDictionaryVersion</key>',
    '\t<string>6.0</string>',
    '\t<key>CFBundleName</key>',
    '\t<string>$(PRODUCT_NAME)</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n'),
  'windows/CMakeLists.txt': [
    'cmake_minimum_required(VERSION 3.14)',
    'add_subdirectory("runner")',
    '',
    '# Generated plugin build rules, which manage building the plugins and adding',
    '# them to the application.',
    'include(flutter/generated_plugins.cmake)',
    '',
  ].join('\n'),
  'linux/CMakeLists.txt': [
    'cmake_minimum_required(VERSION 3.13)',
    'set(BINARY_NAME "demo")',
    'set(APPLICATION_ID "com.nikatru.demo")',
    'install(TARGETS ${BINARY_NAME} RUNTIME DESTINATION "${CMAKE_INSTALL_PREFIX}" COMPONENT Runtime)',
    '',
  ].join('\n'),
  'linux/runner/my_application.cc': [
    'static void my_application_activate(GApplication* application) {',
    '  GtkWindow* window =',
    '      GTK_WINDOW(gtk_application_window_new(GTK_APPLICATION(application)));',
    '  gtk_window_set_default_size(window, 1280, 720);',
    '',
    '  g_autoptr(FlDartProject) project = fl_dart_project_new();',
    '}',
    '',
  ].join('\n'),
};

/** A stock-shaped Xcode project: the objects the transform and the guard read. */
const stockPbxproj = (prefix) => `// !$*UTF8*$!
{
	archiveVersion = 1;
	objects = {

/* Begin PBXBuildFile section */
		${prefix}FC1CF9000F007C117D /* Main.storyboard in Resources */ = {isa = PBXBuildFile; fileRef = ${prefix}FA1CF9000F007C117D /* Main.storyboard */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		${prefix}FA1CF9000F007C117D /* Base */ = {isa = PBXFileReference; lastKnownFileType = file.storyboard; name = Base; path = Base.lproj/Main.storyboard; sourceTree = "<group>"; };
/* End PBXFileReference section */

/* Begin PBXGroup section */
		${prefix}F01CF9000F007C117D /* Runner */ = {
			isa = PBXGroup;
			children = (
				${prefix}FA1CF9000F007C117D /* Main.storyboard */,
			);
			path = Runner;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		${prefix}ED1CF9000F007C117D /* Runner */ = {
			isa = PBXNativeTarget;
			buildPhases = (
				${prefix}EC1CF9000F007C117D /* Resources */,
			);
			name = Runner;
		};
/* End PBXNativeTarget section */

/* Begin PBXResourcesBuildPhase section */
		${prefix}EC1CF9000F007C117D /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			files = (
				${prefix}FC1CF9000F007C117D /* Main.storyboard in Resources */,
			);
		};
/* End PBXResourcesBuildPhase section */
	};
}
`;
STOCK['ios/Runner.xcodeproj/project.pbxproj'] = stockPbxproj('97C146');
STOCK['macos/Runner.xcodeproj/project.pbxproj'] = stockPbxproj('33CC10');
STOCK['android/app/src/main/res/drawable-v21/launch_background.xml'] =
  STOCK['android/app/src/main/res/drawable/launch_background.xml'].replace('@android:color/white', '?android:colorBackground');

/** The Runner target's Resources phase, resolved to file paths — the guard's question. */
function runnerResources(pbx) {
  const objects = parsePbxproj(pbx);
  const runner = [...objects.values()].find((o) => o.isa === 'PBXNativeTarget' && o.name === 'Runner');
  const phase = runner.buildPhases.map((id) => objects.get(id)).find((o) => o.isa === 'PBXResourcesBuildPhase');
  return phase.files.map((f) => objects.get(objects.get(f).fileRef).path);
}

const live = (text, re) => text.split('\n').filter((l) => !/^\s*#/.test(l)).some((l) => re.test(l));

describe('stamp-native — each transform on the stock shape', () => {
  test('the AGP 9 waiver lands on a live, ASCII-only line, once', () => {
    const out = withGradleWaiver(STOCK['android/gradle.properties']);
    assert.ok(live(out, /^\s*android\.r8\.proguardAndroidTxt\.disallowed\s*=\s*false\s*$/), out);
    assert.ok(/^[\x00-\x7f]*$/.test(out), 'gradle.properties is read as ISO-8859-1; a non-ASCII byte arrives mangled');
    assert.equal(withGradleWaiver(out), out, 'not idempotent');
    assert.ok(out.startsWith(STOCK['android/gradle.properties']), 'the stock lines were rewritten');
  });

  test('the STL1011 define lands live, at directory scope, ABOVE the plugin include', () => {
    const out = withWindowsWaiver(STOCK['windows/CMakeLists.txt']);
    const define = out.search(/^add_compile_definitions\(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS\)$/m);
    const include = out.search(/^include\(flutter\/generated_plugins\.cmake\)$/m);
    assert.ok(define !== -1 && include !== -1 && define < include, out);
    assert.equal(withWindowsWaiver(out), out, 'not idempotent');
    assert.throws(() => withWindowsWaiver('add_subdirectory("runner")\n'), NativeStampRefused);
  });

  test('a define BELOW the include does not count; the transform adds one above it', () => {
    const below = `${STOCK['windows/CMakeLists.txt']}add_compile_definitions(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)\n`;
    const out = withWindowsWaiver(below);
    assert.ok(out.indexOf('add_compile_definitions(') < out.indexOf('include(flutter/generated_plugins.cmake)'));
  });

  test('the Amazon receiver is removed from the merge, with the tools namespace, once', () => {
    const out = withAmazonReceiverRemoved(STOCK['android/app/src/main/AndroidManifest.xml']);
    assert.match(out, /<manifest xmlns:tools="http:\/\/schemas\.android\.com\/tools" xmlns:android=/);
    assert.match(out, /<receiver android:name="com\.amazon\.device\.iap\.ResponseReceiver" tools:node="remove" \/>\n\s*<\/application>/);
    assert.doesNotMatch(out, /<!--[^>]*--[^>]*-->/, 'XML 1.0 forbids "--" inside a comment, and aapt refuses the build over one');
    assert.equal(withAmazonReceiverRemoved(out), out, 'not idempotent');
  });

  test('a removal that exists only inside a comment is not the removal', () => {
    const commented = STOCK['android/app/src/main/AndroidManifest.xml'].replace(
      '    </application>',
      '        <!-- <receiver android:name="com.amazon.device.iap.ResponseReceiver" tools:node="remove" /> -->\n    </application>',
    );
    const out = withAmazonReceiverRemoved(commented);
    assert.equal(out.split('tools:node="remove"').length - 1, 2, 'the live line was not added beside the commented one');
  });

  test('the splash: the storyboard declares the 1x size, and both backgrounds DRAW the drawable (guard readers)', () => {
    const sb = withStoryboardLaunchSize(STOCK['ios/Runner/Base.lproj/LaunchScreen.storyboard']);
    assert.deepEqual(readStoryboardImageSize(sb), { width: IOS_BASE_PX, height: IOS_BASE_PX });
    assert.equal(withStoryboardLaunchSize(sb), sb);
    for (const rel of ANDROID_BACKGROUNDS) {
      assert.equal(backgroundDrawsSplash(STOCK[rel]), false, `the stock ${rel} must read as NOT drawing, or this test proves nothing`);
      const out = withLaunchBitmap(STOCK[rel]);
      assert.equal(backgroundDrawsSplash(out), true, out);
      assert.doesNotMatch(out, /@mipmap\/launch_image/);
      assert.equal(withLaunchBitmap(out), out);
      assert.match(out, /<item android:drawable="(@android:color\/white|\?android:colorBackground)" \/>/, 'the colour layer must stay as the template wrote it');
    }
    assert.throws(() => withLaunchBitmap('<layer-list></layer-list>'), NativeStampRefused);
    assert.throws(() => withStoryboardLaunchSize('<document/>'), NativeStampRefused);
  });

  test('the privacy manifest is in the Runner Resources phase and the Runner group, on both Apple projects, once', () => {
    for (const platform of ['ios', 'macos']) {
      const rel = `${platform}/Runner.xcodeproj/project.pbxproj`;
      assert.ok(!runnerResources(STOCK[rel]).includes('PrivacyInfo.xcprivacy'));
      const out = withPrivacyManifestInProject(STOCK[rel], { id: 'demo', platform });
      assert.ok(runnerResources(out).includes('PrivacyInfo.xcprivacy'), out);
      const objects = parsePbxproj(out);
      assert.equal(objects.size, parsePbxproj(STOCK[rel]).size + 2, 'exactly one PBXFileReference and one PBXBuildFile are added');
      assert.equal(withPrivacyManifestInProject(out, { id: 'demo', platform }), out, 'not idempotent');
      assert.equal(withPrivacyManifestInProject(STOCK[rel], { id: 'demo', platform }), out, 'not deterministic: a re-stamp would rewrite the project');
    }
    assert.throws(() => withPrivacyManifestInProject('{ objects = { }; }', { id: 'demo', platform: 'ios' }), NativeStampRefused);
  });

  test('the macOS plist gains the CFBundleDisplayName anchor render.mjs fills; iOS-shaped input is left alone', () => {
    const out = withMacosDisplayNameKey(STOCK['macos/Runner/Info.plist']);
    assert.match(out, /<key>CFBundleInfoDictionaryVersion<\/key>\n\t<string>6\.0<\/string>\n\t<key>CFBundleDisplayName<\/key>\n\t<string>\$\(PRODUCT_NAME\)<\/string>\n/);
    assert.equal(withMacosDisplayNameKey(out), out);
  });

  test('Linux: the two install rules and the window icon call, as limb 7 reads them', () => {
    const cmake = withLinuxPackagingInstall(STOCK['linux/CMakeLists.txt']);
    const code = cmake.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
    assert.match(code, /install\(FILES "\$\{LINUX_PACKAGING_DIR\}\/\$\{APPLICATION_ID\}\.desktop"\s+DESTINATION "\$\{CMAKE_INSTALL_PREFIX\}\/share\/applications"/);
    assert.match(code, /install\(DIRECTORY "\$\{LINUX_PACKAGING_DIR\}\/icons"\s+DESTINATION "\$\{CMAKE_INSTALL_PREFIX\}\/share"/);
    assert.match(code, /set\(LINUX_PACKAGING_DIR "\$\{CMAKE_CURRENT_SOURCE_DIR\}\/packaging"\)/);
    assert.equal(withLinuxPackagingInstall(cmake), cmake);
    const cc = withLinuxWindowIcon(STOCK['linux/runner/my_application.cc']);
    assert.match(cc, /\n  gtk_window_set_icon_name\(window, APPLICATION_ID\);\n\n  g_autoptr\(FlDartProject\) project/);
    assert.equal(withLinuxWindowIcon(cc), cc);
    assert.throws(() => withLinuxWindowIcon('int main() {}\n'), NativeStampRefused);
  });
});

describe("stamp-native — app #1's hand-made native files are a fixed point of every transform", () => {
  /** `edit` leaves app #1's file byte for byte: the stamp recognises the shape the first app converged on by hand. */
  const fixed = (rel, edit) => {
    const text = readFileSync(join(APP1, rel), 'utf8');
    assert.equal(edit(text), text, `the stamp does not recognise the first app's ${rel} as done, so a re-stamp over it would edit it`);
  };

  test('android/gradle.properties (the AGP 9 waiver)', () => fixed('android/gradle.properties', withGradleWaiver));
  test('windows/CMakeLists.txt (the STL1011 waiver)', () => fixed('windows/CMakeLists.txt', withWindowsWaiver));
  test('android/app/src/main/AndroidManifest.xml (the Amazon receiver removal)', () =>
    fixed('android/app/src/main/AndroidManifest.xml', withAmazonReceiverRemoved));
  test('ios/Runner/Base.lproj/LaunchScreen.storyboard (the LaunchImage size)', () =>
    fixed('ios/Runner/Base.lproj/LaunchScreen.storyboard', withStoryboardLaunchSize));
  test('android/app/src/main/res/drawable/launch_background.xml (the live bitmap)', () =>
    fixed('android/app/src/main/res/drawable/launch_background.xml', withLaunchBitmap));
  test('android/app/src/main/res/drawable-v21/launch_background.xml (the live bitmap)', () =>
    fixed('android/app/src/main/res/drawable-v21/launch_background.xml', withLaunchBitmap));
  test('ios/Runner.xcodeproj/project.pbxproj (the privacy manifest in Resources)', () =>
    fixed('ios/Runner.xcodeproj/project.pbxproj', (t) => withPrivacyManifestInProject(t, { id: 'subscriptiontracker', platform: 'ios' })));
  test('macos/Runner.xcodeproj/project.pbxproj (the privacy manifest in Resources)', () =>
    fixed('macos/Runner.xcodeproj/project.pbxproj', (t) => withPrivacyManifestInProject(t, { id: 'subscriptiontracker', platform: 'macos' })));
  test('macos/Runner/Info.plist (the CFBundleDisplayName anchor)', () => fixed('macos/Runner/Info.plist', withMacosDisplayNameKey));
  test('linux/CMakeLists.txt (the two packaging install rules)', () => fixed('linux/CMakeLists.txt', withLinuxPackagingInstall));
  test('linux/runner/my_application.cc (the window icon call)', () => fixed('linux/runner/my_application.cc', withLinuxWindowIcon));
});

// ── the orchestrator ─────────────────────────────────────────────────────────
let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-native-test-'));
});
after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});
let seq = 0;

/** A repo root holding apps/demo as the brick leaves it: pubspec, app.yaml and the 1024 master. */
function stampedApp() {
  const root = join(TMP, `r${seq++}`);
  const app = join(root, 'apps', 'demo');
  mkdirSync(join(app, 'assets', 'icon'), { recursive: true });
  writeFileSync(join(app, 'pubspec.yaml'), 'name: demo\nresolution: workspace\n');
  writeFileSync(join(app, 'app.yaml'), 'id: demo\nshortName: "Demo"\n');
  // The listing the Linux desktop entry's text is derived from (render-linux-icons.mjs).
  mkdirSync(join(app, 'store', 'linux-snap'), { recursive: true });
  writeFileSync(join(app, 'store', 'linux-snap', 'title.txt'), 'Demo\n');
  writeFileSync(join(app, 'store', 'linux-snap', 'short-description.txt'), 'A demo app.\n');
  writeFileSync(join(app, 'store', 'linux-snap', 'category.txt'), 'Productivity\n');
  const size = 512; // HICOLOR_SIZES (512..64) must divide the master
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) rgba.set([0x2a, 0x6f, 0xdb, 0xff], i * 4);
  writeFileSync(join(app, 'assets', 'icon', 'app_icon_1024.png'), encodeRgba({ width: size, height: size, rgba }));
  return { root, app };
}

/** A `flutter` that writes the stock folders into the create destination. */
function fakeFlutter(calls, { status = 0 } = {}) {
  return (args) => {
    calls.push(args);
    if (status !== 0) return { status, output: 'boom' };
    const dest = args[args.length - 1];
    for (const [rel, body] of Object.entries(STOCK)) {
      mkdirSync(dirname(join(dest, rel)), { recursive: true });
      writeFileSync(join(dest, rel), body);
    }
    // The files flutter create writes OUTSIDE the platform folders — never copied.
    mkdirSync(join(dest, 'test'), { recursive: true });
    writeFileSync(join(dest, 'test', 'widget_test.dart'), 'MyApp();\n');
    writeFileSync(join(dest, 'pubspec.lock'), 'packages: {}\n');
    return { status: 0, output: '' };
  };
}

describe('stamp-native — the orchestrator', () => {
  test('stamps all five folders from ONE flutter create into a temp dir, and copies nothing else', () => {
    const { root, app } = stampedApp();
    const calls = [];
    const r = stampNative({ root, id: 'demo', flutter: fakeFlutter(calls) });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, -1), flutterCreateArgs({ id: 'demo', dest: 'x' }).slice(0, -1));
    assert.ok(calls[0].includes('--no-pub'), 'a create that resolves would write a member pubspec.lock');
    assert.ok(calls[0].includes(ORG));
    assert.ok(!calls[0][calls[0].length - 1].startsWith(app), 'flutter create must not run into apps/<id>');
    for (const p of NATIVE_PLATFORMS) assert.ok(existsSync(join(app, p)), `${p}/ was not copied`);
    assert.ok(!existsSync(join(app, 'test', 'widget_test.dart')), 'widget_test.dart names a MyApp the template does not have');
    assert.ok(!existsSync(join(app, 'pubspec.lock')), 'a member pubspec.lock was copied into the workspace');
    // every edit and every derived file landed
    assert.match(readFileSync(join(app, 'android/gradle.properties'), 'utf8'), /^android\.r8\.proguardAndroidTxt\.disallowed=false$/m);
    assert.ok(backgroundDrawsSplash(readFileSync(join(app, ANDROID_BACKGROUNDS[0]), 'utf8')));
    assert.ok(runnerResources(readFileSync(join(app, 'ios/Runner.xcodeproj/project.pbxproj'), 'utf8')).includes('PrivacyInfo.xcprivacy'));
    for (const rel of [
      'ios/Runner/PrivacyInfo.xcprivacy',
      'macos/Runner/PrivacyInfo.xcprivacy',
      'ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage@3x.png',
      'android/app/src/main/res/drawable-xxhdpi/launch_image.png',
      'linux/packaging/com.nikatru.demo.desktop',
      'linux/packaging/icons/hicolor/512x512/apps/com.nikatru.demo.png',
    ]) {
      assert.ok(existsSync(join(app, rel)), `${rel} was not written`);
    }
    assert.match(readFileSync(join(app, 'ios/Runner/PrivacyInfo.xcprivacy'), 'utf8'), /<dict\/>/, 'a preview manifest must answer nothing');
    assert.equal(stampNative({ root, id: 'demo', check: true }).ok, true, 'a fresh stamp fails its own --check');
  });

  test('a re-stamp runs no flutter create and changes no byte', () => {
    const { root } = stampedApp();
    stampNative({ root, id: 'demo', flutter: fakeFlutter([]) });
    const calls = [];
    const r = stampNative({ root, id: 'demo', flutter: fakeFlutter(calls) });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.equal(calls.length, 0);
    assert.deepEqual(r.lines.filter((l) => /^(edit|wrote)/.test(l)), []);
  });

  test('an existing platform folder is KEPT: its hand edits survive and only the missing folders are created', () => {
    const { root, app } = stampedApp();
    mkdirSync(join(app, 'android'), { recursive: true });
    for (const [rel, body] of Object.entries(STOCK)) {
      if (!rel.startsWith('android/')) continue;
      mkdirSync(dirname(join(app, rel)), { recursive: true });
      writeFileSync(join(app, rel), body);
    }
    writeFileSync(join(app, 'android', 'HAND_EDIT'), 'mine\n');
    const r = stampNative({ root, id: 'demo', flutter: fakeFlutter([]) });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.equal(readFileSync(join(app, 'android', 'HAND_EDIT'), 'utf8'), 'mine\n');
    assert.ok(r.lines.some((l) => l.startsWith('kept  apps/demo/android/')));
  });

  test('🔴 RED: --check names a waiver removed after the stamp, and a missing folder', () => {
    const { root, app } = stampedApp();
    stampNative({ root, id: 'demo', flutter: fakeFlutter([]) });
    const props = join(app, 'android/gradle.properties');
    writeFileSync(props, readFileSync(props, 'utf8').replace('android.r8.proguardAndroidTxt.disallowed=false', ''));
    rmSync(join(app, 'linux'), { recursive: true, force: true });
    const r = stampNative({ root, id: 'demo', check: true });
    assert.equal(r.ok, false);
    assert.ok(r.lines.includes('DRIFT apps/demo/android/gradle.properties is missing what the native stamp writes'), r.lines.join('\n'));
    assert.ok(r.lines.includes('DRIFT apps/demo/linux/ does not exist'), r.lines.join('\n'));
    assert.ok(!existsSync(join(app, 'linux')), '--check wrote a file');
  });

  test('a failed flutter create writes no folder and says so', () => {
    const { root, app } = stampedApp();
    const r = stampNative({ root, id: 'demo', flutter: fakeFlutter([], { status: 1 }) });
    assert.equal(r.ok, false);
    assert.match(r.lines.join('\n'), /exited 1; no native folder was written/);
    for (const p of NATIVE_PLATFORMS) assert.ok(!existsSync(join(app, p)));
  });

  test('no stamped app, or no icon master, is a refusal and not a half stamp', () => {
    const empty = join(TMP, `r${seq++}`);
    mkdirSync(empty, { recursive: true });
    assert.equal(stampNative({ root: empty, id: 'demo', flutter: fakeFlutter([]) }).ok, false);
    const { root, app } = stampedApp();
    rmSync(join(app, 'assets', 'icon', 'app_icon_1024.png'));
    const r = stampNative({ root, id: 'demo', flutter: fakeFlutter([]) });
    assert.equal(r.ok, false);
    assert.match(r.lines.join('\n'), /REFUSED .*app_icon_1024\.png does not exist/);
  });
});
