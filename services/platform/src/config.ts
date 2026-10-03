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
//       subscriptiontracker: { app_id: 'subscriptiontracker', api_base_url: 'https://subscriptiontracker-api.nikatru.com/v1', … },
//     };
//
// so the set of apps this Worker serves was a SOURCE EDIT away from changing.
// Measured live 2026-08-06:
//
//     GET https://config.nikatru.com/config/subscriptiontracker  → 200
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
import type { AppConfig, StoredAppConfig } from './types';
import catalogueJson from '../../../catalog/apps.json';
import configDataJson from './app-config-data.json';
import { BUNDLE_KIND, isProductKind } from '../../../contracts/entitlement/bundle.js';
import { type RegisterProduct, channelIdsFromRegister, productsFromRegisters } from './lib/bundle/availability';

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
  // contract, not the catalogue's. subscriptiontracker's row carried `https://api.nikatru.com`
  // and was served `https://api.nikatru.com/v1` — byte-identical to the literal
  // this file held before B-2, which is the property that made that a refactor.
  // Since [ADR 079] the row carries `https://subscriptiontracker-api.nikatru.com`.
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
export function buildRegistry(catalogue: unknown, data: ConfigData): Record<string, StoredAppConfig> {
  const shared = typeof data.sharedApiBaseUrl === 'string' ? data.sharedApiBaseUrl : '';
  const defaults = isPlainObject(data.defaults) ? data.defaults : {};
  const perApp = isPlainObject(data.apps) ? data.apps : {};
  const out: Record<string, StoredAppConfig> = {};
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
    // the same bytes, which is what "preserve subscriptiontracker exactly" has to mean.
    out[slug] = { app_id: slug, api_base_url: apiBaseUrl(row, shared), ...merged } as unknown as StoredAppConfig;
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
export const DEFAULT_CONFIGS: Readonly<Record<string, StoredAppConfig>> = buildRegistry(
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

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE BUNDLE IS PRODUCTS, NOT APPS — apps, extensions, and scripts when one
// ships (contracts/entitlement/bundle.js PRODUCT_REGISTERS). An entitlement
// question can be asked about ANY of them: a bundle grant unlocks the extension
// as much as the app, and `GET /v1/entitlements?app_id=fullshot` gated on
// `isKnownApp` — whose domain is catalog/apps.json alone — answered 404 to a
// customer holding a live grant. The known-PRODUCT set below is the union of
// every register, read through the one reader the Worker already has.
//
// ⚠️ TWO REGISTERS, TWO BEHAVIOURS ON A BAD SLUG, AND THE DIFFERENCE IS STATED:
//   · an APP row that fails APP_ID_PATTERN is DROPPED by `buildRegistry` above,
//     silently at the edge and loudly in CI (tooling/ci/assert-config-registry.mjs
//     limb 4 reads the same pattern over catalog/apps.json). That is a released
//     behaviour with a guard, and it stays.
//   · an EXTENSION (or script) row that fails it is an ERROR — `buildKnownProducts`
//     throws, naming the register and the slug, at module load. The pattern is
//     the one grammar every product id shares (`feature_set_members.product_slug`
//     carries the same rule, migration 0009), and a row that vanished through a
//     silent filter here would 404 a product nobody could see was missing. The
//     suite imports this module (test/config.test.ts drives the throw with a
//     hyphenated extension slug), so the error is a red build before it is a
//     Worker that fails to start.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slug → kind for every product in every register. `apps` are taken from the
 * registry `buildRegistry` already filtered, so the app half of this set is
 * exactly the served set; every other kind is taken from its register row and
 * MUST pass the pattern.
 */
export function buildKnownProducts(
  products: readonly RegisterProduct[],
  apps: readonly string[],
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const slug of apps) out.set(slug, 'app');
  for (const p of products) {
    if (p.kind === 'app') continue; // the served app set is the filtered registry above
    if (!isProductKind(p.kind)) {
      throw new Error(`product register row "${String(p.slug)}" carries kind ${JSON.stringify(p.kind)}, which PRODUCT_KINDS does not declare`);
    }
    if (!isValidAppId(p.slug)) {
      throw new Error(
        `${p.kind} register row has slug ${JSON.stringify(p.slug)}, which APP_ID_PATTERN rejects. A product id ` +
          'shares the app-id grammar (no hyphens; ^[a-z][a-z0-9_]{0,31}$). Refusing to build the known-product ' +
          'set rather than dropping the row: a product that vanished here would 404 on /v1/entitlements with nothing said.',
      );
    }
    if (out.has(p.slug) && out.get(p.slug) !== p.kind) {
      throw new Error(`product slug ${JSON.stringify(p.slug)} appears in two registers with different kinds`);
    }
    out.set(p.slug, p.kind);
  }
  return out;
}

/** Every product this Worker knows, resolved once at module load. */
export const KNOWN_PRODUCTS: ReadonlyMap<string, string> = buildKnownProducts(
  productsFromRegisters(),
  Object.keys(DEFAULT_CONFIGS),
);

/**
 * Is `id` a product in ANY register — app, extension, script or bundle?
 *
 * A `Map` lookup: no prototype to read through, so `__proto__` and friends are
 * simply absent, the same honest false `isKnownApp` reaches by `hasOwnProperty`.
 */
export function isKnownProduct(id: unknown): id is string {
  return typeof id === 'string' && KNOWN_PRODUCTS.has(id);
}

/** The register kind of a known product, or null for an unknown id. */
export function productKindOf(id: unknown): string | null {
  return isKnownProduct(id) ? (KNOWN_PRODUCTS.get(id) ?? null) : null;
}

/**
 * Is `id` a product a PER-PRODUCT row can belong to — a known product that is
 * not a bundle? Two callers ask it: the money path, attributing a notification,
 * and the per-product read `GET /v1/entitlements?app_id=`.
 *
 * 🔴 WHY NOT `isKnownProduct`. Since 2026-09-26 the bundle register is a product
 * register (O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST), so `isKnownProduct` names
 * `nikatru_all`.
 *   · THE MONEY PATH attributes a notification by a client-settable
 *     `nikatru_app_id` and writes a PER-APP `entitlements` row for it; a bundle
 *     id there would write a per-app row for a bundle, which unlocks no member
 *     and is a row belonging to no single product ([4]B-4a). A bundle purchase
 *     is a `bundle_grants` row written by lib/mor/bundle-store.ts, never this
 *     path.
 *   · THE PER-PRODUCT READ would answer a bundle id 200 `is_pro:false`, since no
 *     per-app row can exist for it: a false NO to a bundle owner. A bundle is
 *     read through the subject route's `bundles[]`.
 * So both refuse a bundle id exactly as they refused it before the bundle was a
 * product: attribution drops it, and the read stays 404.
 */
export function isAttributableProduct(id: unknown): id is string {
  return isKnownProduct(id) && KNOWN_PRODUCTS.get(id) !== BUNDLE_KIND;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE FLOOR AND THE EXIT ARE PER CHANNEL — O-UPDATE-FLOOR-HAS-NO-CHANNEL.
//
// `min_supported_version` and `update_url` were one value per app. The web build
// reloads itself; a store build waits for its store to approve the version the
// wall asks for. So raising the floor for web walled every store build with it,
// and one `update_url` had to serve a direct download and a store listing alike.
//
// Each of the two may now be a MAP in app-config-data.json or in a KV override,
// keyed by a channel id from tooling/channel-register.json, with `default`
// answering every channel the map does not name (types.ts `PerChannel`). A
// scalar still means every channel, so every override written before this
// change keeps its meaning. The WIRE STAYS SCALAR: `forChannel` collapses both
// fields to the requesting channel's value, and a request with no `?channel=`
// is served `default`.
//
// ⚠️ THE MERGE IS THE ONE `deepMerge` ABOVE. Two maps merge key-wise — a KV map
// naming one channel keeps every other channel's committed value — and a scalar
// replaces a map whole. tooling/ci/release-manifest.mjs `servedFloor` and
// tooling/ci/assert-stamp-properties.mjs `servedByChannel` read the file the same
// way; assert-stamp-properties refuses a map key that is not a channel id and a
// merged map with no `default`.
// ─────────────────────────────────────────────────────────────────────────────

/** The map key every channel falls back to, and what a request with no `?channel=` is served. */
export const DEFAULT_CHANNEL = 'default';

/** The AppConfig fields a map may key by channel. Everything else is one value for every build. */
export const CHANNEL_KEYED_FIELDS = ['min_supported_version', 'update_url'] as const;

/**
 * The channel ids `?channel=` accepts: every id the register declares.
 *
 * Exported so a test can hand it a register it wrote. A row named `default`
 * THROWS at module load, for the reason `buildKnownProducts` throws: it would
 * collide with the fallback key, so that channel's own map entry and every other
 * channel's fallback would be one key. The suite imports this module, so the
 * throw is a red build before it is a Worker that fails to start.
 */
export function buildReleaseChannels(ids: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (id === DEFAULT_CHANNEL) {
      throw new Error(
        `tooling/channel-register.json declares a channel "${DEFAULT_CHANNEL}", which is the per-channel maps' ` +
          'fallback key (O-UPDATE-FLOOR-HAS-NO-CHANNEL). Rename the channel; refusing to serve an ambiguous map.',
      );
    }
    out.add(id);
  }
  return out;
}

/** Every channel this Worker resolves, read once at module load. */
export const RELEASE_CHANNELS: ReadonlySet<string> = buildReleaseChannels(channelIdsFromRegister());

/** Is `v` a channel id the register declares? A `Set` lookup: `__proto__` and friends are simply absent. */
export function isKnownChannel(v: unknown): v is string {
  return typeof v === 'string' && RELEASE_CHANNELS.has(v);
}

/**
 * The value `channel` is served out of one per-channel field: a scalar as it
 * is; a map's own entry for the channel, else its `default`; `undefined` when a
 * map names neither.
 */
export function channelValue(v: unknown, channel: string): unknown {
  if (!isPlainObject(v)) return v;
  if (Object.prototype.hasOwnProperty.call(v, channel)) return v[channel];
  if (Object.prototype.hasOwnProperty.call(v, DEFAULT_CHANNEL)) return v[DEFAULT_CHANNEL];
  return undefined;
}

/**
 * Collapse a stored config to the scalar config `channel` is served.
 *
 * Key ORDER is kept — each field is overwritten in place, never re-added — so
 * the bytes of a no-channel response are the bytes this route served before the
 * fields became maps. A field an override left with no value for this channel
 * (a KV map with neither the channel nor `default`, laid over a committed
 * scalar) is answered from `base`, the committed config, rather than dropped
 * from the response.
 */
export function forChannel(
  stored: StoredAppConfig,
  channel: string,
  base: StoredAppConfig = stored,
): AppConfig {
  const out: Record<string, unknown> = { ...stored };
  for (const field of CHANNEL_KEYED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(out, field)) continue;
    const v = channelValue(out[field], channel);
    out[field] = v === undefined ? channelValue(base[field], channel) : v;
  }
  return out as unknown as AppConfig;
}

/** The stored default config for a known app, or null if the app is unregistered. */
function storedConfig(appId: string): StoredAppConfig | null {
  if (!isKnownApp(appId)) return null;
  return structuredCloneSafe(DEFAULT_CONFIGS[appId]);
}

/**
 * Base default config for a known app as `channel` is served it (no channel ⇒
 * `default`), or null if the app is unregistered.
 */
export function baseConfig(appId: string, channel: string = DEFAULT_CHANNEL): AppConfig | null {
  const stored = storedConfig(appId);
  return stored === null ? null : forChannel(stored, channel);
}

/** Deep-merge a partial override onto a base config (override wins). */
export function mergeConfig<T extends AppConfig | StoredAppConfig>(
  base: T,
  override: Record<string, unknown> | null | undefined,
): T {
  if (!override || typeof override !== 'object') return base;
  return deepMerge(base as unknown as Record<string, unknown>, override) as unknown as T;
}

/**
 * Resolve the config for `appId` given the raw KV value (JSON string or null),
 * as `channel` is served it. Returns null for an unregistered app. Malformed KV
 * JSON is ignored (defaults win) so a bad override can never take an app down.
 *
 * The override is merged onto the STORED config and only then collapsed, so a
 * KV map naming one channel lands beside the committed map's other channels
 * instead of replacing a value that was already collapsed. `channel` is NOT
 * validated here: the route refuses an unknown one before it reads KV, and an
 * unknown id here would only ever be answered `default`.
 */
export function resolveConfig(
  appId: string,
  kvValue: string | null,
  channel: string = DEFAULT_CHANNEL,
): AppConfig | null {
  const stored = storedConfig(appId);
  if (!stored) return null;
  if (!kvValue) return forChannel(stored, channel);
  let override: Record<string, unknown>;
  try {
    override = JSON.parse(kvValue) as Record<string, unknown>;
  } catch {
    return forChannel(stored, channel);
  }
  return forChannel(mergeConfig(stored, override), channel, stored);
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · EXM-01. AN EXTENSION IS SOLD, NOT SERVED.
//
// FullShot Pro is bought on the nikatru.com checkout (decisions/ext/015), and
// POST /v1/checkout asked `isKnownApp` — whose domain is catalog/apps.json — so
// an extension had no purchase path at all. An extension is not served a
// config (no `GET /config/fullshot`: the extension reads none), so it does not
// join DEFAULT_CONFIGS. What it has is a PAYWALL: app-config-data.json
// `apps.<id>.paywall` for an id the EXTENSION register names, merged over
// `defaults.paywall` exactly as an app's is, and switched by the same KV key
// (`config:<id>`, its `paywall` member only). An `apps.<id>` entry for an id in
// neither register is still dead data, and tooling/ci/assert-config-registry.mjs
// limb 3 still fails it.
// ─────────────────────────────────────────────────────────────────────────────

/** The committed paywall of every extension that has one, keyed by product id. */
export function buildExtensionPaywalls(
  data: ConfigData,
  known: ReadonlyMap<string, string>,
): Readonly<Record<string, AppConfig['paywall']>> {
  const out: Record<string, AppConfig['paywall']> = {};
  const perApp = isPlainObject(data.apps) ? data.apps : {};
  const defaults = isPlainObject(data.defaults) && isPlainObject(data.defaults.paywall) ? data.defaults.paywall : {};
  for (const [id, kind] of known) {
    if (kind !== 'extension' || !Object.prototype.hasOwnProperty.call(perApp, id)) continue;
    const entry = perApp[id];
    if (!isPlainObject(entry) || !isPlainObject(entry.paywall)) continue;
    out[id] = deepMerge(defaults, entry.paywall) as unknown as AppConfig['paywall'];
  }
  return out;
}

/** Every extension paywall, resolved once at module load. */
export const EXTENSION_PAYWALLS = buildExtensionPaywalls(configDataJson as ConfigData, KNOWN_PRODUCTS);

/** Is `id` an extension with a committed paywall — a product the checkout may sell? */
export function isSellableExtension(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(EXTENSION_PAYWALLS, id);
}

/**
 * The paywall the checkout sells under for an app OR an extension, or null for
 * neither. An app's is its resolved config's; an extension's is its committed
 * paywall with the KV override's `paywall` member merged over it. Malformed KV
 * JSON is ignored, as resolveConfig ignores it.
 */
export function resolvePaywall(id: string, kvValue: string | null): AppConfig['paywall'] | null {
  if (isKnownApp(id)) return resolveConfig(id, kvValue)?.paywall ?? null;
  if (!isSellableExtension(id)) return null;
  const stored = structuredCloneSafe(EXTENSION_PAYWALLS[id]);
  if (!kvValue) return stored;
  let override: unknown;
  try {
    override = JSON.parse(kvValue);
  } catch {
    return stored;
  }
  const paywall = isPlainObject(override) ? override.paywall : undefined;
  return isPlainObject(paywall)
    ? (deepMerge(stored as unknown as Record<string, unknown>, paywall) as unknown as AppConfig['paywall'])
    : stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · fix-india-rail-tax-data · O-WEB-INR-PRICE-BOOK (business-017).
// THE RUPEE PRICE BOOK, SERVED TO A BUYER WHO SAYS THEY ARE IN INDIA.
//
// The served paywall carries `amount_minor` in USD and nothing else, so every
// buyer was told USD — including the India buyer whose checkout is Razorpay, in
// rupees, GST-inclusive ([ADR 076] §10.1, [ADR 093]). `GET /config/:app?market=IN`
// now serves each offering at its India web price, `prices.apps.<id>.<offering>
// .webInrMinor` in app-config-data.json (the one place a price lives; the price
// book's `rails.razorpay.taxMode` says it includes GST), in `currency_code: 'INR'`.
//
// 🔴 THE MARKET IS THE BUYER'S OWN DECLARATION, NEVER `cf.country` (Q2, ruled): an
// IP's country is not where a buyer is taxed, and an edge-derived answer would put
// a traveller on the wrong rail with no way to say otherwise. The backstop for a
// false declaration is Razorpay's: it takes domestic instruments only.
//
// FAIL CLOSED: an India response re-prices EVERY offering or serves none of them
// in rupees — an offering with no India price in the book is DROPPED from that
// response, never left at its USD amount under an INR label or beside INR ones.
// ⏱ 2026-10-02 · PR #1149 ruling item 5: the drop is REACHED from the committed
// tree for a one-time (lifetime) offering, which carries no `webInrMinor` until the
// Razorpay order path exists (render-rail-prices.mjs limb J), so an India buyer is
// never shown a plan the India rail cannot sell; every recurring offering is priced
// (limb J). It also covers a KV override that adds an offering the book does not
// price. The KV override cannot move an India price: the rupee amount is read from
// the committed book only.
// ─────────────────────────────────────────────────────────────────────────────

/** Each market with its own web price book: its currency, and the price-book field that holds the amount. */
export const MARKET_PRICE_BOOKS = Object.freeze({
  IN: Object.freeze({ currency: 'INR', field: 'webInrMinor' }),
} as const);
export type PricedMarket = keyof typeof MARKET_PRICE_BOOKS;

/** A buyer-declared market: ISO 3166-1 alpha-2, upper case. Anything else is refused by the route. */
export const MARKET_PATTERN = /^[A-Z]{2}$/;

/** Is `v` a market with its own price book? (A well-formed market without one is served the default book.) */
export function isPricedMarket(v: unknown): v is PricedMarket {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MARKET_PRICE_BOOKS, v);
}

/** `appId → offeringId → amount in minor units` for one price-book field, from app-config-data.json `prices.apps`. */
export function buildMarketPrices(data: unknown, field: string): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const out: Record<string, Record<string, number>> = {};
  const prices = isPlainObject(data) && isPlainObject(data.prices) && isPlainObject(data.prices.apps) ? data.prices.apps : {};
  for (const [appId, entries] of Object.entries(prices)) {
    if (NON_DATA_KEYS.has(appId) || appId.startsWith('_') || !isPlainObject(entries)) continue;
    const row: Record<string, number> = {};
    for (const [offeringId, entry] of Object.entries(entries)) {
      if (NON_DATA_KEYS.has(offeringId) || !isPlainObject(entry)) continue;
      const v = entry[field];
      if (Number.isInteger(v) && (v as number) > 0) row[offeringId] = v as number;
    }
    out[appId] = row;
  }
  return out;
}

/** The India web price book, read once at module load. */
const MARKET_PRICES: Readonly<Record<PricedMarket, ReturnType<typeof buildMarketPrices>>> = {
  IN: buildMarketPrices(configDataJson, MARKET_PRICE_BOOKS.IN.field),
};

/**
 * `cfg` as a buyer in `market` is served it: every paywall offering at that market's
 * web price, in its currency, or dropped when the book has no price for it. A market
 * without its own book is served `cfg` unchanged (the USD book).
 */
export function priceForMarket(cfg: AppConfig, appId: string, market: string): AppConfig {
  if (!isPricedMarket(market)) return cfg;
  const offerings = cfg.paywall?.offerings;
  if (!Array.isArray(offerings)) return cfg;
  const book = MARKET_PRICES[market][appId] ?? {};
  const { currency } = MARKET_PRICE_BOOKS[market];
  const priced: unknown[] = [];
  for (const o of offerings) {
    if (!isPlainObject(o) || typeof o.product_id !== 'string') continue;
    const amount = Object.prototype.hasOwnProperty.call(book, o.product_id) ? book[o.product_id] : undefined;
    if (amount === undefined) continue;
    priced.push({ ...o, amount_minor: amount, currency_code: currency });
  }
  return { ...cfg, paywall: { ...cfg.paywall, offerings: priced } };
}
