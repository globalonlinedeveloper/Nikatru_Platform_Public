// ─────────────────────────────────────────────────────────────────────────────
// CFG-1 config chassis. Pure resolution: per-app defaults overlaid with a KV
// override document (`config:<app>`). Served by GET /config/<app>.
// Keys mirror requirement §CFG: api_base_url, features.*, paywall, content_pack,
// copy.*, min_supported_version, optional theme. DATA/flags only — never UI.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 [pipeline 4]B-2 — THE SERVED APP SET IS DATA. IT USED TO BE THIS FILE.
//
// Until 2026-08-07 the registry was an object literal here:
//
//     export const DEFAULT_CONFIGS: Readonly<Record<string, AppConfig>> = {
//       subly: { app_id: 'subly', api_base_url: 'https://api.nikatru.com/v1', … },
//     };
//
// so the set of apps this Worker serves was a SOURCE EDIT away from changing.
// Measured live 2026-08-06:
//
//     GET https://config.nikatru.com/config/subly  → 200
//     GET https://config.nikatru.com/config/lingo  → 404 {"error":"unknown_app"}
//
// `lingo` is a real content pack in this repo (tooling/content_pipeline/examples/
// lingo-phrases/). Onboarding it meant editing and redeploying the ONE shared
// Worker — the per-app manual step this factory exists to abolish, sitting on the
// launch path of all fifty apps at once.
//
// ── WHY catalog/apps.json AND NOT tooling/channel-register.json ───
// Both were candidates. The catalogue wins on three grounds, and the reason is
// written here rather than in a session note because the next person to touch
// this line needs it:
//
//   1. THE STAMP ALREADY WRITES IT. `tooling/bricks/app/hooks/post_gen.dart`
//      (`_appendToAppsJson`, SHOW-1) appends a row for every app it stamps, and
//      has since stage 3. Onboarding therefore produces the row with no further
//      human action. Any other source would need a SECOND write that nobody
//      performs — and a registry nobody updates is the hardcoded literal again,
//      wearing a JSON extension.
//   2. THE CHANNEL REGISTER IS ABOUT CHANNELS, NOT APPS. Its rows are
//      `windows-store`, `android-play`, `web` … and its own `_readme` says
//      `served: true` licenses a PLATFORMS claim *in apps.json*. It has no
//      per-app row, so it cannot answer "is `lingo` an app" at all.
//   3. IT IS ALREADY THE PORTFOLIO'S RIGHT-HAND SIDE. assert-app-dod,
//      assert-catalog-reachable, assert-channel-claims, assert-channel-register,
//      assert-listing-assets, assert-monitor-coverage and assert-publish-records
//      all derive their domain from it. An eighth reader is one more agreement;
//      a second registry would be one more thing to disagree.
//
// ⚠️ WHAT THIS DOES **NOT** BUY. Both files are bundled at BUILD time — a Worker
// has no filesystem — so a catalogue row still needs a `wrangler deploy` before
// the edge stops answering 404. The step that is gone is the SOURCE EDIT, which
// is what B-2 asks for; a redeploy is CI's job and already automated.
// ─────────────────────────────────────────────────────────────────────────────
import type { AppConfig } from './types';
import catalogueJson from '../../../catalog/apps.json';
import configDataJson from './app-config-data.json';

/**
 * A row of the public catalogue, as post_gen.dart writes it. Declared as the
 * MINIMUM this module reads, not as the full row: the catalogue is a public
 * document with its own consumers (the Eleventy sites, seven CI guards), and a
 * field added for one of them must not be a breaking change here.
 */
interface CatalogueRow {
  slug?: unknown;
  /**
   * The app's OWN API host, or `''`. Empty is the normal case and not a gap:
   * post_gen writes `api: ''` for a client-only app because it has no host of
   * its own — it calls the shared platform Worker. See `apiBaseUrl` below.
   */
  api?: unknown;
}

/**
 * The app-id grammar: lowercase, starts with a letter, `[a-z0-9_]` thereafter —
 * the same shape the brick's `pre_gen.dart` enforces when it stamps an app.
 *
 * 🔴 THIS IS NOW A RUNTIME FILTER WITH TEETH, WHICH IT PREVIOUSLY WAS NOT.
 * The old comment here recorded, correctly, that the pattern could not fail as a
 * limb of `isKnownApp`: an own-property lookup against a hand-written object
 * literal already answers false for `__proto__`, `constructor`, `toString` and
 * `valueOf`, so replacing the pattern with a bare `typeof === 'string'` left the
 * whole suite green. It was therefore re-pointed at the registry as an invariant.
 *
 * That changed with the source. The registry is now built from a JSON array a
 * mason HOOK writes, so a slug is parsed input rather than a literal somebody
 * typed in this file — and `{"slug": "__proto__"}` in the catalogue would, with
 * a plain `out[slug] = …`, produce an own `__proto__` key that `isKnownApp`
 * accepts and `GET /config/__proto__` then serves. `buildRegistry` filters on
 * this pattern for that reason, and test/config.test.ts writes exactly that
 * catalogue row as its failing input.
 */
export const APP_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** Is `v` syntactically an app id? */
export function isValidAppId(v: unknown): v is string {
  return typeof v === 'string' && APP_ID_PATTERN.test(v);
}

/** The per-app value document — `src/app-config-data.json`, parsed. */
interface ConfigData {
  sharedApiBaseUrl?: unknown;
  defaults?: unknown;
  apps?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── internals ────────────────────────────────────────────────────────────────
//
// ⚠️ THESE SIT ABOVE `DEFAULT_CONFIGS` AND MUST STAY THERE, AND THE REASON IS A
// REAL FAILURE RATHER THAN A STYLE PREFERENCE. `DEFAULT_CONFIGS` is now built by
// CALLING `buildRegistry` at module load instead of being an object literal, and
// `buildRegistry` → `deepMerge` → `NON_DATA_KEYS`. With the internals left in
// their old place at the bottom of the file, that call ran while the `const` was
// still in its temporal dead zone: `ReferenceError: Cannot access
// 'NON_DATA_KEYS' before initialization`, thrown at IMPORT time, which takes
// down every route on the Worker — not just /config — because the module never
// finishes loading. It failed 7 of 17 test files on the first run, so the suite
// caught it; the note is here because the next person to tidy this file into
// "public API first, helpers last" will reintroduce it silently.
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Keys that are not data. `JSON.parse` produces `__proto__` as an OWN property,
 * but assigning it back onto a plain object runs the inherited setter and
 * repoints the object's prototype instead of storing a key — so a KV override
 * document could reshape the config object it was merely supposed to overlay.
 * `constructor`/`prototype` are here for the same reason: they are the other two
 * names on the walk from a plain object to `Object.prototype`.
 *
 * It now filters `app-config-data.json` as well as KV, and that is not
 * belt-and-braces: the value document is committed, but it is still parsed JSON
 * reaching the same recursive merge, and a merge that is safe for one input and
 * not the other is a distinction nobody maintains.
 */
const NON_DATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Recursive merge; objects merge key-wise, everything else is replaced. */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (NON_DATA_KEYS.has(k)) continue;
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out;
}

/** Clone that works on the Workers runtime and in the test env. */
function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Where an app whose catalogue row has no `api` host sends its API calls.
 *
 * 🔴 THE SHARED WORKER, AND THE STRING IS NOT TYPED TWICE. `pre_gen.dart` sets
 * `api_base_url` to `'https://platform.nikatru.com/v1'` for a client-only stamp,
 * so this is the value that app's binary already compiles in as its fallback.
 * The two spellings agreeing is enforced, not hoped for:
 * `tooling/ci/assert-config-registry.mjs` compares this key to that literal —
 * because "the server serves one host and the client falls back to another" is a
 * divergence that shows up as a working app in every test and a dead one in
 * production, which is the exact shape [pipeline C-6] exists for.
 */
function apiBaseUrl(row: CatalogueRow, shared: string): string {
  const api = typeof row.api === 'string' ? row.api.trim() : '';
  // `/v1` is appended rather than stored: the catalogue's `api` is a HOST (it is
  // rendered as a link on the public site), and the API VERSION is this Worker's
  // contract, not the catalogue's. subly's row carries `https://api.nikatru.com`
  // and is served `https://api.nikatru.com/v1` — byte-identical to the literal
  // this file held before B-2, which is the property that makes this a refactor.
  return api === '' ? shared : `${api.replace(/\/+$/, '')}/v1`;
}

/**
 * Build the served registry from the catalogue (WHICH apps) and the value
 * document (WHAT each is served).
 *
 * Exported so a test can drive it with a catalogue it wrote. That is not a
 * convenience: every interesting failure of this function — a malformed slug, a
 * duplicate row, an `apps` key for an app nobody stamped — is a property of an
 * INPUT this repo generates, and a test that could only ever see the committed
 * catalogue could not write one of them.
 */
export function buildRegistry(catalogue: unknown, data: ConfigData): Record<string, AppConfig> {
  const shared = typeof data.sharedApiBaseUrl === 'string' ? data.sharedApiBaseUrl : '';
  const defaults = isPlainObject(data.defaults) ? data.defaults : {};
  const perApp = isPlainObject(data.apps) ? data.apps : {};
  const out: Record<string, AppConfig> = {};
  if (!Array.isArray(catalogue)) return out;
  for (const row of catalogue as CatalogueRow[]) {
    if (!isPlainObject(row)) continue;
    const slug = row.slug;
    // The filter, not an assertion: see APP_ID_PATTERN. A row this rejects is
    // reported by tooling/ci/assert-config-registry.mjs, so it cannot be a
    // silent omission — an app that vanished from the served set with nothing
    // said is the failure mode this whole file was rewritten to remove.
    if (!isValidAppId(slug)) continue;
    const override = Object.prototype.hasOwnProperty.call(perApp, slug)
      ? (perApp as Record<string, unknown>)[slug]
      : undefined;
    const merged = deepMerge(defaults, isPlainObject(override) ? override : {});
    // `app_id` and `api_base_url` FIRST so the served key order is unchanged
    // from the literal this replaced — the response bytes a client caches are
    // the same bytes, which is what "preserve subly exactly" has to mean.
    out[slug] = { app_id: slug, api_base_url: apiBaseUrl(row, shared), ...merged } as unknown as AppConfig;
  }
  return out;
}

/**
 * The apps this Worker serves, resolved once at module load.
 *
 * ⚠️ THE SERVER'S DEFAULTS, NOT THE ONLY COPY. Each app ALSO ships its own
 * compiled-in fallback (`packages/core`) so it works offline when this host is
 * unreachable; these are the authoritative ones, overlaid by KV overrides.
 */
export const DEFAULT_CONFIGS: Readonly<Record<string, AppConfig>> = buildRegistry(
  catalogueJson,
  configDataJson as ConfigData,
);

/**
 * Is `appId` an app this Worker actually serves?
 *
 * 🔴 `hasOwnProperty`, NOT `DEFAULT_CONFIGS[appId]`, AND THAT IS THE WHOLE FIX.
 * A plain index reads straight through to `Object.prototype`, so before it:
 *   · `__proto__`    → `Object.prototype`, truthy, cloned to `{}` ⇒ 200 `{}`
 *   · `constructor` / `toString` / `valueOf` → functions, and
 *     `JSON.parse(JSON.stringify(fn))` is `JSON.parse(undefined)` ⇒ THROWS ⇒ 500
 * i.e. an anonymous caller could make this Worker throw at will. An own-property
 * test answers false for every inherited member, so all four collapse into the
 * same honest 404 the registry always meant to give.
 */
export function isKnownApp(appId: unknown): appId is string {
  return typeof appId === 'string' && Object.prototype.hasOwnProperty.call(DEFAULT_CONFIGS, appId);
}

/** Base default config for a known app, or null if the app is unregistered. */
export function baseConfig(appId: string): AppConfig | null {
  if (!isKnownApp(appId)) return null;
  return structuredCloneSafe(DEFAULT_CONFIGS[appId]);
}

/** Deep-merge a partial override onto a base config (override wins). */
export function mergeConfig(
  base: AppConfig,
  override: Record<string, unknown> | null | undefined,
): AppConfig {
  if (!override || typeof override !== 'object') return base;
  return deepMerge(base as unknown as Record<string, unknown>, override) as unknown as AppConfig;
}

/**
 * Resolve the config for `appId` given the raw KV value (JSON string or null).
 * Returns null for an unregistered app. Malformed KV JSON is ignored (defaults
 * win) so a bad override can never take an app down.
 */
export function resolveConfig(appId: string, kvValue: string | null): AppConfig | null {
  const base = baseConfig(appId);
  if (!base) return null;
  if (!kvValue) return base;
  try {
    const override = JSON.parse(kvValue) as Record<string, unknown>;
    return mergeConfig(base, override);
  } catch {
    return base;
  }
}

