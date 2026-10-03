#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// flutter-release-build.mjs — the ONE composition of a release `flutter build`.
//
// 🔴 TWENTY-ONE HAND-TYPED COPIES OF ONE COMMAND. Every release lane typed its
// own `flutter build … --dart-define=…` line: build-platforms.yml, deploy-web.yml,
// the submit-* dry runs and submits, and ci.yml's PR-lane Android builds. Each
// copy carried the same eleven decisions (the channel stamp, the store SDK key of
// the channel's rail, the symbols directory, the API base, which secrets reach
// the binary) and each decision could drift in one copy alone. The census in
// workflow-scan.mjs graded the copies after the fact; this module makes the
// decisions once (row O-FLUTTER-BUILD-TYPED-PER-LINE, part 1 of 3).
//
// WHAT IT DECIDES, and from what:
//   · RELEASE_CHANNEL        — the channel id, a row of tooling/channel-register.json
//   · REVENUECAT_KEY         — `purchaseRails.storeKeyDefine`: the define, passed from `$<env>`
//                              for a rail `secretFieldByRail` keys; no define at all for a
//                              rail it does not. ⏱ 12a (O-BRICK-SELLS-NOTHING-IN-A-STORE): the
//                              secret NAME is each app's own, resolved by the step before the
//                              build (tooling/ci/store-key-secret.mjs), which the step env maps
//                              into `<env>` — so this module names one variable for every app.
//   · API_BASE_URL           — `apiBaseUrl`, below: the app's `hosts.api` from its
//                              app.yaml, else the shared platform API. The stamp guard
//                              (assert-stamp-text-fidelity.mjs) imports the same function.
//   · the symbols directory  — per target, `--obfuscate --split-debug-info=<dir>`
//   · --build-number         — every target but linux, whose stores order by name
//   · `--lane pr`            — the backend secrets and the crash sink are blanked and
//                              APP_VERSION ends `+pr`; the store SDK key stays, because
//                              storeKeyDefine requires it of a store-rail stamp.
//
// 🔴 SECRETS BY NAME, NEVER BY VALUE. The composed argv names an environment
// variable (`$SUPABASE_URL`); the workflow step's `env:` maps it from
// `${{ secrets.SUPABASE_URL }}`. This module never sees a `${{ }}` expression and
// never holds a value it did not read from its own process environment at run time.
// Its unit test fails if any composed argv element contains `${{`.
//
// THE CENSUS FOLLOWS THE CALL. workflow-scan.mjs's `flutterReleaseBuilds`
// recognises `node tooling/ci/flutter-release-build.mjs <app> <target> <channel>`,
// composes it with `composeReleaseBuild`, resolves each `$NAME` through the step's
// `env:` and emits the same record a literal `flutter build` line would, so every
// census reader keeps grading the build it always graded.
//
// Usage:
//   node tooling/ci/flutter-release-build.mjs <app> <target> <channel> [--lane release|pr]
//        runs `flutter build` in apps/<app>, each `$NAME` read from this process's env
//   node tooling/ci/flutter-release-build.mjs <app> <target> <channel> [--lane …] --print
//        prints the composed command, secrets as `$NAME`, and runs nothing
//   node tooling/ci/flutter-release-build.mjs --emit-env API_BASE_URL <app>
//        prints `API_BASE_URL=<url>`, for a step that appends it to $GITHUB_ENV
//   `--root <dir>` reads another tree (tests). The default is this file's repository.
// Exit 0 = composed (and, without --print, flutter exited 0). 1 = a refusal or a
// failed build: the first line names the input it could not compose from.
//
// ⏱ 2026-10-01 · THE ONE BUILD-TIME REFUSAL OF THE RUNTIME SIGNATURE CHECK
// (row O-APPS-GOV-IN-VAPT-CHECKLIST). The binary compiles in the expected signer
// digests of its RELEASE_CHANNEL (packages/core/lib/src/integrity/
// signer_pins.g.dart, generated from tooling/channel-register.json
// `runtimeSignerCheck` by assert-runtime-signer-check.mjs). A channel whose
// `unpinnedReleaseBuild` is `refused` may not be RELEASE-SIGNED while one of its
// pins is null: that binary could not recognise its own signer. The decision is
// `unpinnedReleaseRefusal`, made on the run path only — `--print` and the census
// compose the same argv whatever the signing — and only when Gradle's four
// signing variables are all set, so the debug-signed NOT-FOR-UPLOAD build of the
// same channel still builds.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseYaml } from '../app-yaml/yaml.mjs';
// ⚠️ A CYCLE, deliberately: workflow-scan.mjs imports composeReleaseBuild for its
// census. Neither module reads the other's bindings at load time, only inside
// functions, which is the one shape an ES module cycle evaluates safely.
import { BUILD_TARGET_PLATFORM } from './workflow-scan.mjs';

/** The shared platform API, for an app that runs no Worker of its own. */
export const PLATFORM_API_BASE = 'https://platform.nikatru.com/v1';

/** THE API base rule: an app's own API host, else the shared platform API.
 *  assert-stamp-text-fidelity.mjs imports this to grade a stamped app's
 *  config/defaults.json, and this module applies it to every release build. */
export function apiBaseUrl(apiHost) {
  const host = String(apiHost ?? '').trim();
  return host === '' ? PLATFORM_API_BASE : `https://${host}`;
}

/** The symbols directory each target writes, under `build/symbols/`. `web` is
 *  absent: a web build is not obfuscated, it ships source maps. */
const SYMBOLS_BY_TARGET = new Map([
  ['apk', 'android-apk'],
  ['appbundle', 'android-aab'],
  ['ios', 'ios'],
  ['ipa', 'ios'],
  ['macos', 'macos'],
  ['windows', 'windows'],
  ['linux', 'linux'],
]);

/** A channel whose build shares a job with another channel's build of the same
 *  target, and so needs its own symbols directory: build-platforms.yml builds the
 *  android-play apk and the apps-gov-in apk in one job, and one directory would
 *  keep only the second build's symbols. */
const SYMBOLS_BY_CHANNEL = new Map([['apps-gov-in', 'android-apk-apps-gov-in']]);

/** Flags a target needs after `--release`, before the symbols. Env names only. */
const TARGET_FLAGS = new Map([
  ['web', ['--pwa-strategy=none', '--source-maps', '--no-web-resources-cdn', '--base-href', '$BASE_HREF']],
  ['ipa', ['--export-options-plist', '$APPLE_EXPORT_OPTIONS_PLIST']],
  ['ios', ['--no-codesign']],
]);

/** Targets that pass no `--build-number`: no store orders a linux build by it. */
const NO_BUILD_NUMBER = new Set(['linux']);

/** The lanes. `pr` is a build that is inspected and discarded, never shipped. */
export const LANES = ['release', 'pr'];

/** The defines `--lane pr` blanks: the backend and the crash sink. */
export const PR_BLANKED = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL', 'GLITCHTIP_DSN']);

/** The version the binary reports: `<release line>.<run number>+<commit>`, or
 *  `+pr` on the PR lane. The build name is the part before `+`. */
const BUILD_NAME = '$RELEASE_LINE.$GITHUB_RUN_NUMBER';
const SHA7 = '${GITHUB_SHA::7}';

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** The app's declared API host, or null. Throws when apps/<app>/app.yaml is absent. */
export function appApiHost(root, app) {
  const p = join(root, 'apps', app, 'app.yaml');
  // One read, no existsSync first (CodeQL js/file-system-race).
  let text;
  try {
    text = readFileSync(p, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'EISDIR') throw new Error(`apps/${app}/app.yaml does not exist, so there is no app to compose a build for.`);
    throw e;
  }
  const doc = parseYaml(text);
  const host = doc?.hosts?.api;
  return typeof host === 'string' && host.trim() !== '' ? host.trim() : null;
}

/**
 * THE composition. Pure: it reads the app's app.yaml and the channel register
 * under `root`, and nothing else — no environment, no clock, no process.
 *
 * @param {{root: string, app: string, channel: string, target: string, lane?: string}} args
 * @returns {{argv: string[], env: string[], symbolsDir: string|null}}
 *   `argv` follows `flutter`, and names each secret and run value as `$NAME`
 *   (the commit as `${GITHUB_SHA::7}`); `env` lists every NAME the argv reads,
 *   in first-use order — the names the calling step must put in its environment.
 */
export function composeReleaseBuild({ root, app, channel, target, lane = 'release' }) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(app ?? ''))) throw new Error(`"${app}" is not an app id.`);
  if (!LANES.includes(lane)) throw new Error(`--lane "${lane}" is not one of ${LANES.join(', ')}.`);
  const platform = BUILD_TARGET_PLATFORM.get(target);
  if (platform === undefined) {
    throw new Error(`"${target}" is not a flutter build target this factory ships (${[...BUILD_TARGET_PLATFORM.keys()].join(', ')}).`);
  }
  const register = readJson(join(root, 'tooling', 'channel-register.json'));
  const row = (register.channels ?? []).find((c) => c.id === channel);
  if (row === undefined) throw new Error(`"${channel}" is not a channel row of tooling/channel-register.json.`);
  if (!(row.platforms ?? []).includes(platform)) {
    throw new Error(
      `channel "${channel}" ships ${JSON.stringify(row.platforms ?? [])}, and \`flutter build ${target}\` produces ${platform}.`,
    );
  }
  const keyed = register.purchaseRails?.storeKeyDefine;
  if (!keyed?.define || keyed.secretFieldByRail === null || typeof keyed.secretFieldByRail !== 'object') {
    throw new Error('tooling/channel-register.json purchaseRails.storeKeyDefine names no define and no secretFieldByRail map.');
  }
  const apiBase = apiBaseUrl(appApiHost(root, app));

  const argv = ['build', target, '--release', ...(TARGET_FLAGS.get(target) ?? [])];
  const symbolsBase = SYMBOLS_BY_CHANNEL.get(channel) ?? SYMBOLS_BY_TARGET.get(target) ?? null;
  const symbolsDir = symbolsBase === null ? null : `build/symbols/${symbolsBase}`;
  if (symbolsDir !== null) argv.push('--obfuscate', `--split-debug-info=${symbolsDir}`);
  argv.push(`--build-name=${BUILD_NAME}`);
  if (!NO_BUILD_NUMBER.has(target)) argv.push('--build-number=$GITHUB_RUN_NUMBER');

  const pr = lane === 'pr';
  const define = (name, value) => argv.push(`--dart-define=${name}=${pr && PR_BLANKED.has(name) ? '' : value}`);
  define('SUPABASE_URL', '$SUPABASE_URL');
  define('SUPABASE_ANON_KEY', '$SUPABASE_ANON_KEY');
  define('API_BASE_URL', apiBase);
  define('APP_VERSION', `${BUILD_NAME}+${pr ? 'pr' : SHA7}`);
  define('RELEASE_CHANNEL', channel);
  if (Object.hasOwn(keyed.secretFieldByRail, row.purchaseRail?.rail ?? '')) {
    if (typeof keyed.env !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(keyed.env)) {
      throw new Error('tooling/channel-register.json purchaseRails.storeKeyDefine keys this rail and names no `env` to pass the key from.');
    }
    define(keyed.define, `$${keyed.env}`);
  }
  define('GLITCHTIP_DSN', '$GLITCHTIP_DSN');
  if (platform === 'web') {
    define('TURNSTILE_SITE_KEY', '$TURNSTILE_SITE_KEY');
    define('APP_ENV', 'production');
  }

  const env = [];
  for (const a of argv) {
    for (const m of a.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)/g)) if (!env.includes(m[1])) env.push(m[1]);
  }
  return { argv, env, symbolsDir };
}

/** The four variables Gradle's `releaseSigningEnv` reads. All four set is a
 *  release-signed build; none is the debug-signed build proof (a partial set
 *  fails in Gradle itself). */
export const RELEASE_SIGNING_ENV = ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];

/** The value at a dotted `path` of `row`, or `undefined` when a step is absent. */
export function fieldAt(row, path) {
  let at = row;
  for (const step of String(path).split('.')) {
    if (at === null || typeof at !== 'object' || !Object.hasOwn(at, step)) return undefined;
    at = at[step];
  }
  return at;
}

/** The runtime signature check's pins for `channel`: `null` when the register's
 *  `runtimeSignerCheck` has no entry for it, else each declared pin path with
 *  the value it holds (`null` when the pin is not yet set). Throws when the
 *  entry names a path the row does not have.
 *
 *  ⏱ 2026-10-03 (ruling on PR #1198, ADR 030: Play App Signing holds ONE KEY PER
 *  APP). An entry may also name `perAppPin`, a dotted path into
 *  apps/<app>/app.yaml (`stores.android-play.appSigningSha256`): a list of
 *  fingerprints only that app's installs carry. The caller reads it and passes
 *  it as `appPins` — an array, or null when the app records none. Without an
 *  app (`appPins` undefined) the set is the CHANNEL DEFAULT: the factory-wide
 *  pins only, and never complete while a per-app pin is declared, so no app is
 *  ever blocked for lacking a key that is not its own. */
export function signerPinsOf(register, channel, appPins = undefined) {
  const entry = register?.runtimeSignerCheck?.channels?.[channel];
  if (entry === undefined) return null;
  const row = (register.channels ?? []).find((c) => c.id === channel);
  if (row === undefined) throw new Error(`runtimeSignerCheck names "${channel}", which is not a channel row.`);
  const pins = (entry.pins ?? []).map((path) => {
    const value = fieldAt(row, path);
    if (value === undefined) throw new Error(`runtimeSignerCheck.channels.${channel} names pin "${path}", which row "${channel}" does not have.`);
    return { path, value };
  });
  const perAppPin = typeof entry.perAppPin === 'string' && entry.perAppPin !== '' ? entry.perAppPin : null;
  const own = perAppPin !== null && Array.isArray(appPins) && appPins.length > 0 ? appPins : null;
  const factoryComplete = pins.length > 0 && pins.every((p) => p.value !== null);
  return {
    pins,
    perAppPin,
    appPins: own,
    unpinnedReleaseBuild: entry.unpinnedReleaseBuild,
    complete: factoryComplete && (perAppPin === null || own !== null),
  };
}

/** The per-app pin `path` (a dotted path into apps/<app>/app.yaml) for `app`:
 *  its list, or null when the app records none. Throws when app.yaml is absent
 *  or does not parse — an app whose declaration cannot be read has no answer. */
export function appPinsAt(root, app, path) {
  const p = join(root, 'apps', app, 'app.yaml');
  const decl = parseYaml(readFileSync(p, 'utf8'));
  const v = fieldAt(decl, path);
  return Array.isArray(v) && v.length > 0 ? v : null;
}

/** Why a RELEASE-SIGNED build of `channel` must not run, or null when it may.
 *  `env` is the build's environment; release-signed means every
 *  RELEASE_SIGNING_ENV name is set and non-empty. */
export function unpinnedReleaseRefusal({ root, channel, env, app = null }) {
  const releaseSigned = RELEASE_SIGNING_ENV.every((n) => String(env?.[n] ?? '').trim() !== '');
  if (!releaseSigned) return null;
  const register = readJson(join(root, 'tooling', 'channel-register.json'));
  const perAppPin = register?.runtimeSignerCheck?.channels?.[channel]?.perAppPin;
  const appPins = typeof perAppPin === 'string' && app !== null ? appPinsAt(root, app, perAppPin) : undefined;
  const pins = signerPinsOf(register, channel, appPins);
  if (pins === null || pins.unpinnedReleaseBuild !== 'refused') return null;
  const unset = pins.pins.filter((p) => p.value === null).map((p) => p.path);
  if (pins.pins.length === 0) unset.push('(no pin declared)');
  if (pins.perAppPin !== null && pins.appPins === null) unset.push(`apps/${app ?? '<app>'}/app.yaml ${pins.perAppPin}`);
  if (unset.length === 0) return null;
  return (
    `channel "${channel}" is being RELEASE-SIGNED and its runtime signature pin ${unset.join(', ')} is not set in ` +
    'tooling/channel-register.json, so the binary could not recognise its own signer. Pin the fingerprint ' +
    '(`keytool -list -v`), run `node tooling/ci/assert-runtime-signer-check.mjs --write`, and build again — ' +
    'or build without the signing variables for a debug-signed NOT-FOR-UPLOAD proof.'
  );
}

/** The command as one line, the way a workflow types it. */
export const printed = (argv) => ['flutter', ...argv].join(' ');

/** Each `$NAME` (and `${GITHUB_SHA::7}`) in `argv`, replaced through `lookup(name)`.
 *  `lookup` returns the text to put in place, or null to refuse the name. */
export function substitute(argv, lookup) {
  const missing = [];
  const out = argv.map((a) =>
    a.replace(/\$\{GITHUB_SHA::7\}|\$([A-Z_][A-Z0-9_]*)/g, (whole, name) => {
      const v = name === undefined ? lookup('GITHUB_SHA::7') : lookup(name);
      if (v === null || v === undefined) {
        missing.push(name ?? 'GITHUB_SHA');
        return whole;
      }
      return v;
    }),
  );
  return { argv: out, missing };
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function main(args) {
  const rootAt = args.indexOf('--root');
  const root = rootAt === -1 ? REPO_ROOT : resolve(args[rootAt + 1] ?? '');
  const rest = rootAt === -1 ? args : args.filter((_, i) => i !== rootAt && i !== rootAt + 1);

  if (rest[0] === '--emit-env') {
    const [, name, app] = rest;
    if (name !== 'API_BASE_URL' || !app) {
      console.error('usage: flutter-release-build.mjs --emit-env API_BASE_URL <app> — API_BASE_URL is the one value it emits.');
      return 1;
    }
    console.log(`API_BASE_URL=${apiBaseUrl(appApiHost(root, app))}`);
    return 0;
  }

  const print = rest.includes('--print');
  const laneAt = rest.indexOf('--lane');
  const lane = laneAt === -1 ? 'release' : rest[laneAt + 1];
  const positional = rest.filter((a, i) => !a.startsWith('--') && (laneAt === -1 || i !== laneAt + 1));
  if (positional.length !== 3) {
    console.error('usage: flutter-release-build.mjs <app> <target> <channel> [--lane release|pr] [--print] [--root <dir>]');
    return 1;
  }
  const [app, target, channel] = positional;
  const composed = composeReleaseBuild({ root, app, channel, target, lane });
  if (print) {
    console.log(printed(composed.argv));
    return 0;
  }

  const refusal = unpinnedReleaseRefusal({ root, channel, env: process.env, app });
  if (refusal !== null) {
    console.error(`FAIL ${refusal}`);
    return 1;
  }

  // Run: every `$NAME` from this process's environment. A NAME the step never put
  // in the environment is refused — an unset name is a step that forgot to map
  // it, and would build a binary missing that value.
  const { argv, missing } = substitute(composed.argv, (name) => {
    if (name === 'GITHUB_SHA::7') return process.env.GITHUB_SHA === undefined ? null : process.env.GITHUB_SHA.slice(0, 7);
    return process.env[name] ?? null;
  });
  if (missing.length) {
    console.error(`FAIL the environment does not set ${[...new Set(missing)].join(', ')}; map each in the step's env: block.`);
    return 1;
  }
  const r = spawnSync('flutter', argv, { cwd: join(root, 'apps', app), stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error) {
    console.error(`FAIL flutter did not start: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`FAIL ${e.message}`);
    process.exit(1);
  }
}
