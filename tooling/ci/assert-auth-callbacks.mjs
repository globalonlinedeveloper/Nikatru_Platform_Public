#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-auth-callbacks.mjs — every native target an app ships registers the
// app's auth callback, the Supabase allow list admits it, and every GoTrue call
// that sends a link passes the redirect built for its flow.
//
// ⏱ 2026-09-23 · written with the native auth callback seam (PR A of the
// sign-in audit, with the auth-links row folded in).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// Sign-up confirmation, OAuth, identity linking, password reset and an email
// change all END IN A LINK. gotrue sends the browser to the `redirect_to` the
// app asked for, and on a native target that is
//
//     com.nikatru.<app id>://auth-callback?nk_auth=<flow>&code=…
//
// (`authRedirectUrl` in packages/auth_supabase/lib/src/auth_redirect.dart is
// the one derivation). Four separate things must all be true for that URL to
// come back to the app that is waiting for it, and each one fails SILENTLY:
//
//   1. THE OS KNOWS THE SCHEME. Android's intent-filter, the iOS and macOS
//      CFBundleURLTypes, the MSIX protocol_activation, the Linux .desktop
//      MimeType. Missing, the browser shows "no app can open this" — or the
//      user is left on a blank tab — and the code in the app never runs.
//   2. THE RUNNING COPY RECEIVES IT. A Linux runner left NON_UNIQUE, or a
//      Windows runner that does not forward, starts a SECOND app beside the one
//      holding the PKCE verifier.
//   3. GOTRUE ADMITS IT. gotrue matches `redirect_to` against the allow list
//      with only the #fragment cut, so `…://auth-callback` does not admit
//      `…://auth-callback?nk_auth=reset`. An unmatched redirect is REPLACED
//      with the Site URL: the link opens the web app instead.
//   4. THE CALL ASKS FOR IT. A link-sending call that passes no redirect gets
//      the Site URL too — one URL for the whole portfolio, so a second app's
//      users would confirm into app #1.
//
// Nothing in a unit test can see any of it: the mail sends, the link resolves,
// a page loads. So this guard reads the files that decide it.
//
// ── WHAT IT READS ────────────────────────────────────────────────────────────
//   derivation  auth_redirect.dart still builds `com.nikatru.$appId`, host
//               `auth-callback`, marker key `nk_auth`; the markers are read
//               off `enum AuthFlow` so the allow-list limb cannot drift from it
//   targets     per app under apps/ that constructs SupabaseAuthRepository:
//               `kAuthCallbackTargets` (what the app TELLS AuthCapabilities)
//               equals the native directories it ships, both ways
//   android     the launcher activity (singleTop/singleTask) carries a
//               VIEW + DEFAULT + BROWSABLE filter on <scheme>://auth-callback,
//               flutter_deeplinking_enabled is false, and no overlay manifest
//               under android/app/src/*/ removes or replaces it
//   ios/macos   Runner/Info.plist CFBundleURLTypes names the scheme; iOS also
//               sets FlutterDeepLinkingEnabled false
//   windows     pubspec msix_config.protocol_activation names the scheme, and
//               runner/main.cpp calls SendAppLinkToInstance()
//   linux       every linux/packaging/*.desktop has MimeType
//               x-scheme-handler/<scheme> and an Exec with %u/%U; the runner's
//               g_object_new flags are not NON_UNIQUE and handle the command
//               line; local_command_line returns FALSE (hands the line on)
//   allow list  tooling/mail-transport.json supabaseAuth.uri_allow_list holds
//               the bare callback and one EXACT entry per marker, and no
//               wildcard on a custom scheme
//   calls       every signUp / resend / signInWithOtp / signInWithOAuth /
//               resetPasswordForEmail / linkIdentity / updateUser(email:) call
//               in packages/auth_supabase/lib passes `redirects(AuthFlow.<flow>)`
//               for ITS flow; floor MIN_LINK_CALLS
//   wiring      each in-scope app and the brick's providers.dart construct
//               SupabaseAuthRepository with `redirects: AuthRedirects.current(`
//   policy      (PROVIDER-POLICY) auth_providers.dart `AuthProviders.configured`
//               never declares `google: true` while `apple: false` — App Store
//               Review Guideline 4.8
//
// Exit 0 = clean · 1 = a finding · 2 = COVERAGE LOST (the guard could not read
// what it exists to read, or read fewer call sites / targets than its floor).
//
// `authCallbacksShipped(root)` is exported for assert-screen-set.mjs, whose
// `auth.callbacks` blocker is THIS check rather than a pubspec line.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';

const NAME = 'assert-auth-callbacks';

export const SCHEME_PREFIX = 'com.nikatru.';
export const CALLBACK_HOST = 'auth-callback';
export const MARKER_KEY = 'nk_auth';
/** Five link-sending calls exist today (signUp, resend, signInWithOAuth,
 *  resetPasswordForEmail, linkIdentity). Fewer found means the scan stopped
 *  reaching them — a rename, a move — not that the links got fixed. */
export const MIN_LINK_CALLS = 5;

export const AUTH_REDIRECT = 'packages/auth_supabase/lib/src/auth_redirect.dart';
export const AUTH_LIB = 'packages/auth_supabase/lib';
export const MAIL_TRANSPORT = 'tooling/mail-transport.json';
export const BRICK_PROVIDERS = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart';
export const REPO_INPUTS = [AUTH_LIB, MAIL_TRANSPORT, BRICK_PROVIDERS];
/** Where an app constructs its auth repository: the chassis split file first,
 *  then the single file the brick stamps. */
const PROVIDER_FILES = ['lib/state/providers/auth.dart', 'lib/state/providers.dart'];

/** Everything this guard reads, so a test can copy exactly its inputs into a
 *  fixture: per app (relative to apps/<app>/; a directory is copied whole) and
 *  per repository. */
export const APP_INPUTS = [
  'app.yaml',
  'pubspec.yaml',
  ...PROVIDER_FILES,
  'android/app/src/main/AndroidManifest.xml',
  'ios/Runner/Info.plist',
  'macos/Runner/Info.plist',
  'windows/runner/main.cpp',
  'linux/packaging',
  'linux/runner/my_application.cc',
];

/** TargetPlatform member → the native directory `flutter create` makes for it. */
export const TARGET_DIRS = new Map([
  ['android', 'android'],
  ['iOS', 'ios'],
  ['macOS', 'macos'],
  ['windows', 'windows'],
  ['linux', 'linux'],
]);

/** method → [the redirect parameter, the flow it must carry (null = any)]. */
const LINK_CALLS = new Map([
  ['signUp', ['emailRedirectTo', 'signUpConfirm']],
  ['resend', ['emailRedirectTo', 'signUpConfirm']],
  ['signInWithOtp', ['emailRedirectTo', null]],
  ['signInWithOAuth', ['redirectTo', 'oauth']],
  ['resetPasswordForEmail', ['redirectTo', 'reset']],
  ['linkIdentity', ['redirectTo', 'linkIdentity']],
  ['updateUser', ['emailRedirectTo', 'emailChange']],
]);

const APP_ID = /^[a-z][a-z0-9]*$/;

// ── small readers ────────────────────────────────────────────────────────────
const read = (abs) => (existsSync(abs) ? readFileSync(abs, 'utf8') : null);
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const blank = (m) => m.replace(/[^\n]/g, ' ');
/** Every RegExp metacharacter escaped, so a name read from a file matches literally. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** XML comments blanked, newlines kept, so line numbers survive. */
export const stripXmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, blank);
/** Desktop Entry comments are whole lines starting with `#`. */
const stripHashLines = (s) => s.replace(/^[ \t]*#.*$/gm, blank);
/** C and C++ share the C-family delimiters text-reductions knows as Kotlin. */
const stripCpp = (s) => stripSourceComments(s, '.kt');
const stripDart = (s) => stripSourceComments(s, '.dart');

/** The text between the `(` at `open` and its matching `)`, quote-aware, or null. */
function balanced(text, open, o = '(', c = ')') {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === o) depth++;
    else if (ch === c) {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** The value of `name:` at the TOP level of an argument list, or null. */
function namedArg(args, name) {
  const re = new RegExp(`\\b${escapeRe(name)}\\s*:`, 'g');
  let m;
  while ((m = re.exec(args)) !== null) {
    // Only a top-level argument counts: depth 0 at the match.
    let depth = 0;
    for (let i = 0; i < m.index; i++) {
      if ('([{'.includes(args[i])) depth++;
      else if (')]}'.includes(args[i])) depth--;
    }
    if (depth !== 0) continue;
    let end = m.index + m[0].length;
    let d = 0;
    for (; end < args.length; end++) {
      const ch = args[end];
      if ('([{'.includes(ch)) d++;
      else if (')]}'.includes(ch)) d--;
      else if (ch === ',' && d === 0) break;
    }
    return args.slice(m.index + m[0].length, end).replace(/\s+/g, '');
  }
  return null;
}

/** The app id an app's scheme derives from: app.yaml `id`, else the directory. */
export function appIdOf(appDir) {
  const text = read(join(appDir, 'app.yaml'));
  let id = null;
  if (text !== null) {
    const doc = parseYaml(text);
    if (doc && typeof doc.id === 'string' && doc.id.trim() !== '') id = doc.id.trim();
  }
  return id ?? basename(resolve(appDir));
}

// ── the derivation ───────────────────────────────────────────────────────────
/** Reads auth_redirect.dart: the constants the URL is built from and the flow
 *  markers. Returns { markers: Map<flow, marker>, problems }. */
export function readDerivation(root) {
  const problems = [];
  const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
  const markers = new Map();
  const raw = read(join(root, AUTH_REDIRECT));
  if (raw === null) {
    coverageLost(`${AUTH_REDIRECT} is missing, so the scheme, host and markers every registration is held to cannot be read.`);
    return { markers, problems };
  }
  const src = stripDart(raw);
  if (!src.includes(`'${SCHEME_PREFIX}$appId'`)) {
    problems.push(`${AUTH_REDIRECT}: authCallbackScheme() no longer builds '${SCHEME_PREFIX}$appId' — every native registration below is written against that scheme.`);
  }
  if (!new RegExp(`kAuthCallbackHost\\s*=\\s*'${escapeRe(CALLBACK_HOST)}'`).test(src)) {
    problems.push(`${AUTH_REDIRECT}: kAuthCallbackHost is no longer '${CALLBACK_HOST}' — the Android filter and the allow list name that host.`);
  }
  if (!new RegExp(`kAuthMarkerKey\\s*=\\s*'${escapeRe(MARKER_KEY)}'`).test(src)) {
    problems.push(`${AUTH_REDIRECT}: kAuthMarkerKey is no longer '${MARKER_KEY}' — the allow list's exact entries carry that key.`);
  }
  const at = src.search(/\benum\s+AuthFlow\s*\{/);
  if (at < 0) {
    coverageLost(`${AUTH_REDIRECT} declares no \`enum AuthFlow\`, so the markers the allow list must admit cannot be read.`);
    return { markers, problems };
  }
  const body = balanced(src, src.indexOf('{', at), '{', '}') ?? '';
  const values = body.split(';')[0];
  for (const m of values.matchAll(/\b([A-Za-z_]\w*)\s*\(\s*'([^']+)'\s*\)/g)) markers.set(m[1], m[2]);
  if (markers.size === 0) {
    coverageLost(`\`enum AuthFlow\` in ${AUTH_REDIRECT} yielded 0 markers — the shape \`name('marker')\` changed, and an empty list would make the allow-list limb vacuous.`);
  }
  return { markers, problems };
}

// ── the apps in scope ────────────────────────────────────────────────────────
/** Every apps/<dir> whose providers construct SupabaseAuthRepository. */
export function appsInScope(root) {
  const appsDir = join(root, 'apps');
  if (!existsSync(appsDir)) return [];
  const out = [];
  for (const e of listDir(appsDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = join(appsDir, e.name);
    for (const f of PROVIDER_FILES) {
      const raw = read(join(dir, f));
      if (raw === null) continue;
      const src = stripDart(raw);
      if (src.includes('SupabaseAuthRepository(')) {
        out.push({ name: e.name, dir, providersRel: `apps/${e.name}/${f}`, providers: src });
        break;
      }
    }
  }
  return out;
}

// ── per-target registrations ─────────────────────────────────────────────────
function checkAndroid(root, app, scheme, problems, coverageLost) {
  const rel = `apps/${app.name}/android/app/src/main/AndroidManifest.xml`;
  const raw = read(join(root, rel));
  if (raw === null) return coverageLost(`${rel} is missing although apps/${app.name}/android/ exists.`);
  const xml = stripXmlComments(raw);
  const activities = [...xml.matchAll(/<activity\b[\s\S]*?<\/activity>/g)];
  const launcher = activities.find(
    (a) => a[0].includes('android.intent.action.MAIN') && a[0].includes('android.intent.category.LAUNCHER'),
  );
  if (!launcher) return coverageLost(`${rel}: no <activity> carries MAIN + LAUNCHER, so there is no launcher activity to hold the callback filter.`);
  const act = launcher[0];
  const line = lineAt(xml, launcher.index);
  const mode = /android:launchMode\s*=\s*"([^"]+)"/.exec(act.slice(0, act.indexOf('>') + 1))?.[1] ?? 'standard';
  if (mode !== 'singleTop' && mode !== 'singleTask') {
    problems.push(`${rel}:${line}: the launcher activity's launchMode is "${mode}" — the callback would start a SECOND activity instead of reaching the running one in onNewIntent. Use singleTop.`);
  }
  let found = false;
  for (const f of act.matchAll(/<intent-filter\b[^>]*>([\s\S]*?)<\/intent-filter>/g)) {
    const b = f[1];
    const has = (kind, n) => new RegExp(`<${kind}\\b[^>]*android:name\\s*=\\s*"${escapeRe(n)}"`).test(b);
    const schemes = new Set([...b.matchAll(/android:scheme\s*=\s*"([^"]+)"/g)].map((m) => m[1]));
    const hosts = new Set([...b.matchAll(/android:host\s*=\s*"([^"]+)"/g)].map((m) => m[1]));
    if (
      has('action', 'android.intent.action.VIEW') &&
      has('category', 'android.intent.category.DEFAULT') &&
      has('category', 'android.intent.category.BROWSABLE') &&
      schemes.has(scheme) &&
      hosts.has(CALLBACK_HOST)
    ) {
      found = true;
    }
  }
  if (!found) {
    problems.push(`${rel}:${line}: the launcher activity has no VIEW + DEFAULT + BROWSABLE <intent-filter> on ${scheme}://${CALLBACK_HOST} — Android has nowhere to deliver the auth link.`);
  }
  const deeplink = [...act.matchAll(/<meta-data\b[^>]*>/g)].find((m) => /android:name\s*=\s*"flutter_deeplinking_enabled"/.test(m[0]));
  if (!deeplink || !/android:value\s*=\s*"false"/.test(deeplink[0])) {
    problems.push(`${rel}:${line}: the launcher activity does not set flutter_deeplinking_enabled to false — the engine would ALSO push /?${MARKER_KEY}=…&code=… to the router as a route.`);
  }
  // Overlays: a flavour or build-type manifest merged over main can delete it.
  const srcDir = join(root, 'apps', app.name, 'android', 'app', 'src');
  const overlays = [];
  for (const e of listDir(srcDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'main') continue;
    const d = join(srcDir, e.name);
    overlays.push(join(d, 'AndroidManifest.xml'));
    for (const s of listDir(d, { withFileTypes: true })) if (s.isDirectory()) overlays.push(join(d, s.name, 'AndroidManifest.xml'));
  }
  for (const o of overlays) {
    const text = read(o);
    if (text === null) continue;
    const ox = stripXmlComments(text);
    for (const m of ox.matchAll(/<(application|activity|activity-alias|intent-filter|data)\b[^>]*tools:node\s*=\s*"(remove|removeAll|replace)"/g)) {
      problems.push(`${relative(root, o).replace(/\\/g, '/')}:${lineAt(ox, m.index)}: <${m[1]} tools:node="${m[2]}"> in an overlay manifest can strip the auth-callback filter from the merged app.`);
    }
  }
  return true;
}

/** The <string>s under CFBundleURLTypes → CFBundleURLSchemes, or null if absent. */
export function plistUrlSchemes(xml) {
  const k = xml.indexOf('<key>CFBundleURLTypes</key>');
  if (k < 0) return null;
  const open = xml.indexOf('<array>', k);
  if (open < 0) return [];
  // Balanced on <array>…</array>: the schemes list is an array INSIDE it.
  let depth = 0;
  let end = -1;
  const tag = /<array>|<\/array>/g;
  tag.lastIndex = open;
  let t;
  while ((t = tag.exec(xml)) !== null) {
    depth += t[0] === '<array>' ? 1 : -1;
    if (depth === 0) {
      end = t.index;
      break;
    }
  }
  const types = xml.slice(open, end < 0 ? xml.length : end);
  const out = [];
  for (const m of types.matchAll(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/g)) {
    for (const s of m[1].matchAll(/<string>\s*([^<]*?)\s*<\/string>/g)) out.push(s[1]);
  }
  return out;
}

function checkApple(root, app, scheme, target, problems, coverageLost) {
  const dir = TARGET_DIRS.get(target);
  const rel = `apps/${app.name}/${dir}/Runner/Info.plist`;
  const raw = read(join(root, rel));
  if (raw === null) return coverageLost(`${rel} is missing although apps/${app.name}/${dir}/ exists.`);
  const xml = stripXmlComments(raw);
  const schemes = plistUrlSchemes(xml);
  if (schemes === null || !schemes.includes(scheme)) {
    problems.push(`${rel}: CFBundleURLTypes → CFBundleURLSchemes does not name ${scheme} (found: ${schemes === null ? 'no CFBundleURLTypes at all' : `[${schemes.join(', ')}]`}) — ${target} has nowhere to deliver the auth link.`);
  }
  if (target === 'iOS' && !/<key>FlutterDeepLinkingEnabled<\/key>\s*<false\s*\/>/.test(xml)) {
    problems.push(`${rel}: FlutterDeepLinkingEnabled is not <false/> — the engine would ALSO push /?${MARKER_KEY}=…&code=… to the router as a route.`);
  }
  return true;
}

/** protocol_activation under the top-level `msix_config:` block, as a list. */
export function msixProtocols(pubspec) {
  const lines = pubspec.split('\n');
  const start = lines.findIndex((l) => /^msix_config:\s*(#.*)?$/.test(l));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && !/^#/.test(l)) break;
    const m = /^\s+protocol_activation:\s*(.*)$/.exec(l);
    if (m) {
      const v = m[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
      return v.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function checkWindows(root, app, scheme, problems, coverageLost) {
  const pubRel = `apps/${app.name}/pubspec.yaml`;
  const pub = read(join(root, pubRel));
  if (pub === null) return coverageLost(`${pubRel} is missing.`);
  const protocols = msixProtocols(pub);
  if (protocols === null) {
    problems.push(`${pubRel}: no msix_config block, so the Windows package registers no protocol at all.`);
  } else if (!protocols.includes(scheme)) {
    problems.push(`${pubRel}: msix_config.protocol_activation is [${protocols.join(', ')}], not ${scheme} — Windows has nowhere to deliver the auth link.`);
  }
  const mainRel = `apps/${app.name}/windows/runner/main.cpp`;
  const main = read(join(root, mainRel));
  if (main === null) return coverageLost(`${mainRel} is missing although apps/${app.name}/windows/ exists.`);
  if (!/\bSendAppLinkToInstance\s*\(/.test(stripCpp(main))) {
    problems.push(`${mainRel}: wWinMain no longer calls SendAppLinkToInstance() — the callback starts a SECOND app beside the one holding the PKCE verifier.`);
  }
  return true;
}

function checkLinux(root, app, scheme, problems, coverageLost) {
  const pkgRel = `apps/${app.name}/linux/packaging`;
  const pkgDir = join(root, pkgRel);
  const desktops = existsSync(pkgDir)
    ? listDir(pkgDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.desktop'))
    : [];
  if (desktops.length === 0) {
    coverageLost(`${pkgRel}/ holds no .desktop entry, so the scheme handler the browser launches cannot be read.`);
  }
  for (const d of desktops) {
    const rel = `${pkgRel}/${d.name}`;
    const text = stripHashLines(readFileSync(join(pkgDir, d.name), 'utf8'));
    const mime = /^MimeType\s*=\s*(.*)$/m.exec(text);
    const types = mime ? mime[1].split(';').map((s) => s.trim()) : [];
    if (!types.includes(`x-scheme-handler/${scheme}`)) {
      problems.push(`${rel}: MimeType does not name x-scheme-handler/${scheme} — the desktop never offers this app the auth link.`);
    }
    const exec = /^Exec\s*=\s*(.*)$/m.exec(text);
    if (!exec || !/(^|\s)%[uU](\s|$)/.test(exec[1])) {
      problems.push(`${rel}: Exec (${exec ? exec[1].trim() : 'absent'}) carries no %u — the desktop launches the app WITHOUT the URL.`);
    }
  }
  const ccRel = `apps/${app.name}/linux/runner/my_application.cc`;
  const ccRaw = read(join(root, ccRel));
  if (ccRaw === null) return coverageLost(`${ccRel} is missing although apps/${app.name}/linux/ exists.`);
  const cc = stripCpp(ccRaw);
  let flags = null;
  let flagsLine = 0;
  for (const m of cc.matchAll(/\bg_object_new\s*\(/g)) {
    const args = balanced(cc, m.index + m[0].length - 1);
    if (args === null || !args.includes('"application-id"')) continue;
    const f = args.indexOf('"flags"');
    flagsLine = lineAt(cc, m.index);
    flags = f < 0 ? '' : args.slice(f + '"flags"'.length);
  }
  if (flags === null) {
    problems.push(`${ccRel}: no g_object_new(…, "application-id", …) found — the runner's GApplication flags cannot be read.`);
  } else if (/\bG_APPLICATION_NON_UNIQUE\b/.test(flags)) {
    problems.push(`${ccRel}:${flagsLine}: the GApplication is created G_APPLICATION_NON_UNIQUE — every callback launch is a SECOND app beside the one holding the PKCE verifier.`);
  } else if (!/\bG_APPLICATION_HANDLES_(COMMAND_LINE|OPEN)\b/.test(flags)) {
    problems.push(`${ccRel}:${flagsLine}: the GApplication flags handle neither the command line nor open — the callback URL argument is refused or dropped.`);
  }
  const lcl = /\bmy_application_local_command_line\s*\([^)]*\)\s*\{/.exec(cc);
  if (lcl) {
    const body = balanced(cc, lcl.index + lcl[0].length - 1, '{', '}') ?? '';
    const returns = [...body.matchAll(/\breturn\s+(TRUE|FALSE)\s*;/g)];
    if (returns.length === 0 || returns[returns.length - 1][1] !== 'FALSE') {
      problems.push(`${ccRel}:${lineAt(cc, lcl.index)}: my_application_local_command_line does not end in \`return FALSE;\` — TRUE handles the command line locally and DROPS the callback URL.`);
    }
  }
  return true;
}

/** Native registrations for every in-scope app.
 *  Returns { problems, targets: [{ app, target }], schemes: Map<app, scheme> }. */
export function checkRegistrations(root) {
  const problems = [];
  const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
  const targets = [];
  const schemes = new Map();
  for (const app of appsInScope(root)) {
    let id;
    try {
      id = appIdOf(app.dir);
    } catch (e) {
      coverageLost(`apps/${app.name}/app.yaml does not parse (${e.message}), so the scheme cannot be derived.`);
      continue;
    }
    if (!APP_ID.test(id)) {
      problems.push(`apps/${app.name}: the app id "${id}" is not ^[a-z][a-z0-9]*$, so ${SCHEME_PREFIX}${id} is not a scheme every OS accepts; authCallbackScheme() refuses it too.`);
      continue;
    }
    const scheme = `${SCHEME_PREFIX}${id}`;
    const decl = /\bkAuthCallbackTargets\s*=\s*(?:const\s*)?<TargetPlatform>\s*\{([^}]*)\}/.exec(app.providers);
    const declared = new Set(decl ? [...decl[1].matchAll(/TargetPlatform\.(\w+)/g)].map((m) => m[1]) : []);
    if (decl && !/\bregisteredCallbacks\s*:\s*kAuthCallbackTargets\b/.test(app.providers)) {
      problems.push(`${app.providersRel}: kAuthCallbackTargets is declared but not passed as AuthCapabilities.current(registeredCallbacks: …) — the login screen would not know which targets can finish OAuth.`);
    }
    for (const t of declared) {
      if (!TARGET_DIRS.has(t)) problems.push(`${app.providersRel}: kAuthCallbackTargets names TargetPlatform.${t}, which has no native callback registration this guard knows how to read.`);
    }
    let any = false;
    for (const [target, dir] of TARGET_DIRS) {
      const hasDir = existsSync(join(app.dir, dir));
      if (declared.has(target) && !hasDir) {
        problems.push(`${app.providersRel}: kAuthCallbackTargets names TargetPlatform.${target}, but apps/${app.name}/${dir}/ does not exist — the capability claims a registration nobody made.`);
      }
      if (!hasDir) continue;
      any = true;
      if (!declared.has(target)) {
        problems.push(`${app.providersRel}: apps/${app.name}/${dir}/ ships, but kAuthCallbackTargets does not name TargetPlatform.${target} — declare it once the registration below is in place.`);
      }
      const ok =
        target === 'android'
          ? checkAndroid(root, app, scheme, problems, coverageLost)
          : target === 'iOS' || target === 'macOS'
            ? checkApple(root, app, scheme, target, problems, coverageLost)
            : target === 'windows'
              ? checkWindows(root, app, scheme, problems, coverageLost)
              : checkLinux(root, app, scheme, problems, coverageLost);
      if (ok === true) targets.push({ app: app.name, target });
    }
    if (any) schemes.set(app.name, scheme);
  }
  return { problems, targets, schemes };
}

// ── the allow list ───────────────────────────────────────────────────────────
export function checkAllowList(root, schemes, markers) {
  const problems = [];
  const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
  const raw = read(join(root, MAIL_TRANSPORT));
  let doc = null;
  try {
    doc = raw === null ? null : JSON.parse(raw);
  } catch {
    doc = null;
  }
  const list = doc?.supabaseAuth?.uri_allow_list;
  if (typeof list !== 'string' && !Array.isArray(list)) {
    coverageLost(`${MAIL_TRANSPORT} supabaseAuth.uri_allow_list is ${raw === null ? 'unreadable (file missing)' : 'absent or not a string/array'}, so what gotrue admits cannot be checked.`);
    return problems;
  }
  const entries = (Array.isArray(list) ? list : list.split(',')).map((s) => String(s).trim()).filter(Boolean);
  for (const [app, scheme] of schemes) {
    const base = `${scheme}://${CALLBACK_HOST}`;
    const want = [base, ...[...markers.values()].map((m) => `${base}?${MARKER_KEY}=${m}`)];
    for (const w of want) {
      if (!entries.includes(w)) {
        problems.push(`${MAIL_TRANSPORT}: supabaseAuth.uri_allow_list has no exact "${w}" (apps/${app}) — gotrue matches the query too, so that link would be replaced with the Site URL and open the web app.`);
      }
    }
    for (const e of entries) {
      if (e.startsWith(`${scheme}:`) && e.includes('*')) {
        problems.push(`${MAIL_TRANSPORT}: supabaseAuth.uri_allow_list entry "${e}" is a wildcard on a custom scheme — list each marker exactly.`);
      }
    }
  }
  return problems;
}

// ── the link-sending calls ───────────────────────────────────────────────────
function dartFiles(dir, out = []) {
  for (const e of listDir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) dartFiles(p, out);
    else if (e.name.endsWith('.dart')) out.push(p);
  }
  return out;
}

/** Every GoTrue link-sending call in the auth package passes its redirect.
 *  Returns { problems, calls }. */
export function checkLinkCalls(root, markers) {
  const problems = [];
  const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
  const lib = join(root, AUTH_LIB);
  if (!existsSync(lib)) {
    coverageLost(`${AUTH_LIB}/ is missing, so the link-sending calls cannot be read.`);
    return { problems, calls: 0 };
  }
  let calls = 0;
  const methods = [...LINK_CALLS.keys()].map(escapeRe).join('|');
  for (const file of dartFiles(lib)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    const src = stripDart(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(new RegExp(`\\.\\s*(${methods})\\s*\\(`, 'g'))) {
      const method = m[1];
      const args = balanced(src, m.index + m[0].length - 1);
      if (args === null) continue;
      if (method === 'updateUser' && !/\bemail\s*:/.test(args)) continue; // a password or profile update sends no link
      calls++;
      const [param, flow] = LINK_CALLS.get(method);
      const line = lineAt(src, m.index);
      const value = namedArg(args, param);
      if (value === null) {
        problems.push(`${rel}:${line}: .${method}( passes no \`${param}\` — gotrue then sends the link to the project's Site URL, which is ONE app's web page for the whole portfolio.`);
        continue;
      }
      const got = /^redirects\(AuthFlow\.(\w+)\)$/.exec(value);
      if (!got) {
        problems.push(`${rel}:${line}: .${method}( passes \`${param}: ${value}\` — it has to be \`redirects(AuthFlow.${flow ?? '<flow>'})\`, the one derivation that sends each app's users back to that app.`);
      } else if (flow !== null && got[1] !== flow) {
        problems.push(`${rel}:${line}: .${method}( passes redirects(AuthFlow.${got[1]}) — this call's link is AuthFlow.${flow}.`);
      } else if (markers.size > 0 && !markers.has(got[1])) {
        // (With no markers read, the derivation limb already reported COVERAGE
        // LOST; naming every call as undeclared would bury it under noise.)
        problems.push(`${rel}:${line}: .${method}( names AuthFlow.${got[1]}, which enum AuthFlow does not declare.`);
      }
    }
  }
  if (calls < MIN_LINK_CALLS) {
    coverageLost(`found ${calls} link-sending GoTrue call(s) in ${AUTH_LIB}/, below the floor of ${MIN_LINK_CALLS} — the scan stopped reaching them.`);
  }
  return { problems, calls };
}

// ── the wiring ───────────────────────────────────────────────────────────────
export function checkWiring(root, apps) {
  const problems = [];
  const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
  const sites = apps.map((a) => [a.providersRel, a.providers]);
  const brick = read(join(root, BRICK_PROVIDERS));
  if (brick === null) coverageLost(`${BRICK_PROVIDERS} is missing, so what a stamped app wires cannot be read.`);
  else sites.push([BRICK_PROVIDERS, stripDart(brick)]);
  for (const [rel, src] of sites) {
    const at = src.indexOf('SupabaseAuthRepository(');
    if (at < 0) {
      problems.push(`${rel}: constructs no SupabaseAuthRepository( — expected the one call that passes \`redirects:\`.`);
      continue;
    }
    const args = balanced(src, at + 'SupabaseAuthRepository'.length) ?? '';
    const v = namedArg(args, 'redirects');
    if (v === null || !v.startsWith('AuthRedirects.current(')) {
      problems.push(`${rel}:${lineAt(src, at)}: SupabaseAuthRepository( is built without \`redirects: AuthRedirects.current(…)\` — the default sends no redirect, so every link lands on the Site URL.`);
    }
  }
  return problems;
}

// ── the provider policy ──────────────────────────────────────────────────────
// ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT · limb PROVIDER-POLICY. The Google
// door is built and gated on `AuthProviders.configured.google`. App Store Review
// Guideline 4.8 requires Sign in with Apple beside any third-party sign-in on
// iOS, so `google: true` with `apple: false` is a rejected build — and nothing
// else in the tree would notice until review. The flags are read as LITERALS:
// anything but `true`/`false` is COVERAGE LOST, never a guess.
export const AUTH_PROVIDERS = 'packages/auth_supabase/lib/src/auth_providers.dart';

export function checkProviderPolicy(root) {
  const problems = [];
  const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
  const text = read(join(root, AUTH_PROVIDERS));
  if (text === null) {
    coverageLost(`${AUTH_PROVIDERS} is missing, so which providers ship cannot be read.`);
    return { problems, providers: null };
  }
  const src = stripDart(text);
  const m = /\bstatic\s+const\s+AuthProviders\s+configured\s*=\s*AuthProviders\s*\(/.exec(src);
  if (!m) {
    coverageLost(`${AUTH_PROVIDERS}: no \`static const AuthProviders configured = AuthProviders(\` — the declaration this limb reads moved or was renamed.`);
    return { problems, providers: null };
  }
  const args = balanced(src, m.index + m[0].length - 1) ?? '';
  const providers = {};
  for (const name of ['apple', 'google']) {
    const v = namedArg(args, name);
    if (v !== 'true' && v !== 'false') {
      coverageLost(`${AUTH_PROVIDERS}:${lineAt(src, m.index)}: \`${name}:\` is ${v === null ? 'absent' : `\`${v}\``}, not a literal true/false — the policy cannot be judged on a value it cannot read.`);
      continue;
    }
    providers[name] = v === 'true';
  }
  if (providers.google === true && providers.apple === false) {
    problems.push(`${AUTH_PROVIDERS}:${lineAt(src, m.index)}: \`google: true\` with \`apple: false\` — App Store Review Guideline 4.8 requires Sign in with Apple beside any third-party sign-in on iOS. Enable Apple first, or keep Google off.`);
  }
  return { problems, providers };
}

// ── everything ───────────────────────────────────────────────────────────────
export function checkAll(root) {
  const d = readDerivation(root);
  const apps = appsInScope(root);
  const reg = checkRegistrations(root);
  const allow = checkAllowList(root, reg.schemes, d.markers);
  const links = checkLinkCalls(root, d.markers);
  const wiring = checkWiring(root, apps);
  const policy = checkProviderPolicy(root);
  const problems = [...d.problems, ...reg.problems, ...allow, ...links.problems, ...wiring, ...policy.problems];
  return { problems, apps: apps.length, targets: reg.targets, markers: d.markers, calls: links.calls, providers: policy.providers };
}

/** For assert-screen-set: has the native auth callback SHIPPED? True only when
 *  the whole check is clean AND it proved at least one native target. */
export function authCallbacksShipped(root) {
  const r = checkAll(root);
  return r.problems.length === 0 && r.targets.length > 0;
}

// ── main ─────────────────────────────────────────────────────────────────────
const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
const IS_MAIN = Boolean(process.argv[1]) && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));

if (IS_MAIN) {
  const ROOT = process.cwd();
  const r = checkAll(ROOT);
  const problems = [...r.problems];
  const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
  if (r.apps === 0) coverageLost('no app under apps/ constructs SupabaseAuthRepository, so there is nothing whose callback could be checked.');
  else if (r.targets.length === 0) coverageLost(`${r.apps} app(s) in scope but 0 native targets proved — the target scan read nothing.`);

  console.log(`${NAME}: ${r.apps} app(s) · ${r.targets.length} native target(s) [${r.targets.map((t) => `${t.app}/${t.target}`).join(', ')}] · ${r.markers.size} flow marker(s) [${[...r.markers.values()].join(', ')}] · ${r.calls} link-sending call(s) · providers apple=${r.providers?.apple} google=${r.providers?.google}`);
  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error('');
    console.error('  The auth link for sign-up, OAuth, linking, reset and email change has to come back to the app that');
    console.error('  asked for it. Each line above is a place it would not. Scheme: authCallbackScheme() in');
    console.error(`  ${AUTH_REDIRECT}.`);
    console.error(`\n${NAME}: FAILED`);
    process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
  }
  console.log(`${NAME}: OK — every native target registers its callback, the allow list admits every flow, every link-sending call passes its redirect`);
}
