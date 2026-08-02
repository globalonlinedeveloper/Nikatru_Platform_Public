import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIGS,
  baseConfig,
  isKnownApp,
  isValidAppId,
  mergeConfig,
  resolveConfig,
} from '../src/config';

describe('CFG-1 config resolution', () => {
  it('returns compiled defaults for a known app', () => {
    const cfg = baseConfig('subly');
    expect(cfg).not.toBeNull();
    expect(cfg!.app_id).toBe('subly');
    expect(cfg!.api_base_url).toBe('https://api.nikatru.com/v1');
    expect(cfg!.features.renewals).toBe(true);
    expect(cfg!.paywall.enabled).toBe(false);
    expect(cfg!.min_supported_version).toBe('1.0.0');
  });

  it('returns null for an unregistered app', () => {
    expect(baseConfig('nope')).toBeNull();
    expect(resolveConfig('nope', null)).toBeNull();
    expect(resolveConfig('nope', '{"paywall":{"enabled":true}}')).toBeNull();
  });

  it('resolves to defaults when there is no KV override', () => {
    expect(resolveConfig('subly', null)).toEqual(baseConfig('subly'));
  });

  it('deep-merges a KV override over defaults (override wins, siblings kept)', () => {
    const merged = resolveConfig(
      'subly',
      JSON.stringify({
        paywall: { enabled: true, plan: 'pro' },
        features: { exports: false },
        min_supported_version: '1.2.0',
      }),
    )!;
    // overridden
    expect(merged.paywall.enabled).toBe(true);
    expect(merged.paywall.plan).toBe('pro');
    expect(merged.features.exports).toBe(false);
    expect(merged.min_supported_version).toBe('1.2.0');
    // siblings preserved from defaults
    expect(merged.features.renewals).toBe(true);
    expect(merged.features.budgets).toBe(true);
    expect(merged.api_base_url).toBe('https://api.nikatru.com/v1');
  });

  it('ignores malformed KV JSON and falls back to defaults (never takes an app down)', () => {
    expect(resolveConfig('subly', '{not valid json')).toEqual(baseConfig('subly'));
  });

  it('does not mutate the shared defaults across calls', () => {
    const a = resolveConfig('subly', JSON.stringify({ paywall: { enabled: true } }))!;
    expect(a.paywall.enabled).toBe(true);
    // a second, override-free resolve must still see the pristine default
    expect(resolveConfig('subly', null)!.paywall.enabled).toBe(false);
  });

  it('mergeConfig with a nullish override returns the base unchanged', () => {
    const base = baseConfig('subly')!;
    expect(mergeConfig(base, null)).toEqual(base);
    expect(mergeConfig(base, undefined)).toEqual(base);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE APP ID IS AN OBJECT KEY, SO IT IS AN INPUT.
//
// `DEFAULT_CONFIGS[appId]` with an unvalidated `appId` is a lookup that can
// return things that are not configs. Measured on the live route at HEAD:
// `/config/__proto__` answered 200 with the body `{}` (the JSON of
// `Object.prototype`), and `/config/constructor`, `/config/toString` and
// `/config/valueOf` answered 500 — `JSON.stringify` of a function is `undefined`
// and `JSON.parse(undefined)` throws inside the clone.
//
// The fix is an OWN-PROPERTY test. `DEFAULT_CONFIGS[appId]` reads through to
// `Object.prototype`; `hasOwnProperty` does not, so every inherited member
// collapses into the same honest 404 the registry always meant to give.
//
// ⚠️ WHAT THIS DELIBERATELY DOES NOT CLAIM. The first attempt also ran the app
// id through `APP_ID_PATTERN` here and the comment said both limbs had teeth.
// Mutation says otherwise: replacing the pattern with a bare `typeof === string`
// left all 120 tests green, because an own-property lookup on an object literal
// already answers false for every one of these names. A check nobody can write a
// failing input for inflates coverage, so the pattern was re-pointed at the
// REGISTRY (below), where a failing input is one line long.
// ─────────────────────────────────────────────────────────────────────────────
describe('an inherited member of Object.prototype is not an app', () => {
  it('every one of them resolves to null instead of throwing or leaking', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(isKnownApp(id), id).toBe(false);
      expect(() => baseConfig(id), id).not.toThrow();
      expect(baseConfig(id), id).toBeNull();
      expect(resolveConfig(id, null), id).toBeNull();
      expect(resolveConfig(id, '{"paywall":{"enabled":true}}'), id).toBeNull();
    }
  });

  it('and `constructor` in particular no longer throws inside the clone', () => {
    // Called out on its own because it is the 500: `JSON.stringify` of a
    // function is `undefined`, and `JSON.parse(undefined)` throws — so an
    // anonymous caller could make this Worker raise at will.
    expect(() => baseConfig('constructor')).not.toThrow();
    expect(baseConfig('constructor')).toBeNull();
  });

  it('isKnownApp answers from the registry, not from a hardcoded list', () => {
    for (const id of Object.keys(DEFAULT_CONFIGS)) expect(isKnownApp(id), id).toBe(true);
    expect(isKnownApp('nope')).toBe(false);
    for (const notAString of [null, undefined, 42, {}, ['subly']]) {
      expect(isKnownApp(notAString), String(notAString)).toBe(false);
    }
  });
});

describe('APP_ID_PATTERN is an invariant on the REGISTRY, and it can fail', () => {
  it('every registered app id is a well-formed app id', () => {
    // 🔴 THE FAILING INPUT, so this is not another assertion nobody can break:
    // add `'config:evil'` or `'My App'` as a key of DEFAULT_CONFIGS and this
    // goes red. That is what keeps `config:${appId}` an unambiguous KV key —
    // the route only ever composes it from a key of this object.
    const ids = Object.keys(DEFAULT_CONFIGS);
    expect(ids.length, 'COVERAGE LOST — the registry is empty, so this ranges over nothing').toBeGreaterThan(0);
    for (const id of ids) expect(isValidAppId(id), `registered app id \`${id}\` is malformed`).toBe(true);
  });

  it('the grammar accepts what the brick stamps and rejects what it never would', () => {
    for (const id of ['subly', 'a', 'my_app2', 'a'.repeat(32)]) {
      expect(isValidAppId(id), id).toBe(true);
    }
    for (const id of [
      'config:subly', // would make the KV key ambiguous
      'My App',
      '2fast', // leading digit
      '',
      'a'.repeat(33), // over length
      '../secrets',
      '__proto__',
    ]) {
      expect(isValidAppId(id), id).toBe(false);
    }
  });
});

describe('a KV override document cannot reshape the object it overlays', () => {
  // The override is admin-authored, but it is still parsed JSON reaching a
  // recursive merge — and `JSON.parse` produces `__proto__` as an OWN property,
  // so `out[k] = v` runs the inherited setter and repoints the prototype instead
  // of storing a key.
  it('ignores __proto__ / constructor / prototype keys in the override', () => {
    const merged = resolveConfig(
      'subly',
      '{"__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true},"min_supported_version":"9.9.9"}',
    )!;
    // The legitimate sibling key still merged — this is not a blanket refusal.
    expect(merged.min_supported_version).toBe('9.9.9');
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect((merged as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(merged)).not.toContain('polluted');
  });

  it('nested overrides are filtered at every depth, not only the top', () => {
    const merged = resolveConfig(
      'subly',
      '{"paywall":{"__proto__":{"polluted":true},"plan":"pro"}}',
    )!;
    expect(merged.paywall.plan).toBe('pro');
    expect(Object.getPrototypeOf(merged.paywall)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contract drift. `packages/core` pins the Dart side against these values; this
// is the mirror, so adding a field on EITHER side fails the other's lane. The
// `flags` asymmetry (parsed by the Dart client, untyped on the server, reaching
// clients only through an unvalidated KV override) is exactly what this catches.
// ─────────────────────────────────────────────────────────────────────────────
describe('AppConfig contract (mirrors packages/core AppConfig)', () => {
  const REQUIRED_KEYS = [
    'app_id',
    'api_base_url',
    'features',
    'flags',
    'paywall',
    'content_pack',
    'copy',
    'min_supported_version',
    // [pipeline 13]T-6. Present here BEFORE anything sends a promotional touch,
    // because the lever only exists while both sides are cheap to change: with
    // the key in this list, adding it to the Dart AppConfig alone fails this
    // test for every compiled-in default, and adding it to the server alone
    // without listing it here fails the stray-key assertion below. One key, two
    // writable failing inputs, both live today.
    'max_promos_per_week',
    // [pipeline 9]R-10 / [10]D-8, and it is here for the SAME lever as the row
    // above, applied to a seam that was already half-built and reporting
    // healthy. packages/core's Dart AppConfig has parsed `update_url` since the
    // force-update work landed and the brick's app.dart prefers it over the
    // compiled-in constant — against a server that had no such field, so the
    // runtime branch was unreachable in production while every test passed,
    // because falling back is the correct behaviour when the value is absent.
    // Listing it here is what makes deleting it from types.ts turn this lane
    // red instead of quietly re-opening that gap.
    'update_url',
  ] as const;

  it('every compiled-in default carries the full key set', () => {
    for (const [appId, cfg] of Object.entries(DEFAULT_CONFIGS)) {
      const keys = Object.keys(cfg);
      for (const k of REQUIRED_KEYS) {
        expect(keys, `${appId} is missing "${k}"`).toContain(k);
      }
      // No stray keys: an untyped extra here would ship to every client.
      for (const k of keys) {
        expect([...REQUIRED_KEYS, 'theme'], `${appId} has unexpected "${k}"`).toContain(k);
      }
    }
  });

  it('flags is a typed percentage map that a KV override can set', () => {
    expect(baseConfig('subly')!.flags).toEqual({});
    const merged = resolveConfig('subly', JSON.stringify({ flags: { new_home: 25 } }))!;
    expect(merged.flags.new_home).toBe(25);
    // and the default stays pristine for the next resolve
    expect(baseConfig('subly')!.flags).toEqual({});
  });
});
