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
    paywall: { enabled: false },
    content_pack: null,
    copy: {},
    min_supported_version: '1.0.0',
  },
};

/** Base default config for a known app, or null if the app is unregistered. */
export function baseConfig(appId: string): AppConfig | null {
  const cfg = DEFAULT_CONFIGS[appId];
  return cfg ? structuredCloneSafe(cfg) : null;
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

/** Recursive merge; objects merge key-wise, everything else is replaced. */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out;
}

/** Clone that works on the Workers runtime and in the test env. */
function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
