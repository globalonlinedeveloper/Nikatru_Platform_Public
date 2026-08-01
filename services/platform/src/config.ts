// ─────────────────────────────────────────────────────────────────────────────
// CFG-1 config chassis. Pure resolution: compiled-in per-app defaults overlaid
// with a KV override document (`config:<app>`). Served by GET /config/<app>.
// Keys mirror requirement §CFG: api_base_url, features.*, paywall, content_pack,
// copy.*, min_supported_version, optional theme. DATA/flags only — never UI.
// ─────────────────────────────────────────────────────────────────────────────
import type { AppConfig } from './types';

/**
 * Compiled-in defaults per known app. The app ALSO ships its own fallback
 * (packages/core) so it works offline if this host is unreachable; these are the
 * server's authoritative defaults, overlaid by KV overrides.
 */
export const DEFAULT_CONFIGS: Readonly<Record<string, AppConfig>> = {
  subly: {
    app_id: 'subly',
    api_base_url: 'https://api.nikatru.com/v1',
    features: { renewals: true, budgets: true, exports: true },
    flags: {},
    // ── THE RAIL CONFIG — [pipeline 5]M-11 ────────────────────────────────
    //
    // 🔴 THE PRICE LIVES HERE, NOT IN THE APP. It used to live in
    // `apps/subly/lib/services/purchases/purchases_service.dart` as the literals
    // `$2.99` and `$24.99` — compiled into a binary, shipped to a store, and
    // ALREADY WRONG: the owner decided $4.99/mo + $19.99/yr with a 30-day trial
    // on 2026-07-27, and nothing could have told us, because a hardcoded string
    // is consistent with itself forever. Serving it means a price change is a
    // config edit rather than six store releases.
    //
    // An AMOUNT and a CURRENCY, never a display string: the client formats it
    // from ICU data, so the number the buyer reads and the number they are
    // charged cannot disagree.
    //
    // ⚠️ `checkout_url_template` IS DELIBERATELY ABSENT, and its absence is the
    // honest state rather than an omission. The merchant of record's
    // hosted-checkout URL shape is an UNVERIFIED vendor fact — the only note
    // carrying one is dated 2026-07-28 and has never been re-fetched, and no
    // seller account exists to check it against (OWNER_QUEUE A-1, PENDING).
    // Encoding a guessed shape would ship a button that opens a 404 for the
    // first real buyer. With it absent, `RailConfig.canCheckout` is false and
    // the paywall says purchases are unavailable, which is true.
    paywall: {
      enabled: false,
      offerings: [
        { product_id: 'pro_monthly', amount_minor: 499, currency_code: 'USD', term: 'month', trial_days: 30 },
        { product_id: 'pro_yearly', amount_minor: 1999, currency_code: 'USD', term: 'year', trial_days: 30 },
      ],
    },
    content_pack: null,
    copy: {},
    min_supported_version: '1.0.0',
  },
};

/**
 * The app-id grammar: lowercase, starts with a letter, `[a-z0-9_]` thereafter —
 * the same shape the brick's `pre_gen.dart` enforces when it stamps an app.
 *
 * ⚠️ THIS IS AN INVARIANT ON THE REGISTRY ABOVE, **NOT** A RUNTIME LIMB, and the
 * distinction was established by mutation rather than assumed. The first version
 * of this fix put the pattern inside `isKnownApp` and claimed both limbs had
 * teeth. Replacing the pattern with a bare `typeof appId === 'string'` left the
 * ENTIRE 120-test suite green — because an own-property lookup against an object
 * literal already answers false for `__proto__`, `constructor`, `toString` and
 * `valueOf` alike. A check whose failing input cannot be written is worse than
 * none: it inflates apparent coverage. So it is re-pointed at the thing it CAN
 * fail on — every key of DEFAULT_CONFIGS, asserted in test/config.test.ts. That
 * is what keeps `config:${appId}` an unambiguous KV key: register an app as
 * `config:evil` or `My App` and the build goes red.
 */
export const APP_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** Is `v` syntactically an app id? Used to police the registry, not the request. */
export function isValidAppId(v: unknown): v is string {
  return typeof v === 'string' && APP_ID_PATTERN.test(v);
}

/**
 * Is `appId` an app this Worker actually serves?
 *
 * 🔴 `hasOwnProperty`, NOT `DEFAULT_CONFIGS[appId]`, AND THAT IS THE WHOLE FIX.
 * A plain index reads straight through to `Object.prototype`, so at HEAD:
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

// ── internals ────────────────────────────────────────────────────────────────

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
