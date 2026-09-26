import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIGS,
  KNOWN_PRODUCTS,
  baseConfig,
  buildKnownProducts,
  buildRegistry,
  isKnownApp,
  isKnownProduct,
  isValidAppId,
  mergeConfig,
  productKindOf,
  resolveConfig,
} from '../src/config';
import catalogue from '../../../catalog/apps.json';
import extensions from '../../../extensions/catalog/extensions.json';
import configData from '../src/app-config-data.json';
import { productsFromRegisters } from '../src/lib/bundle/availability';
import {
  DEFAULT_CHANNEL,
  RELEASE_CHANNELS,
  buildReleaseChannels,
  channelValue,
  forChannel,
  isKnownChannel,
} from '../src/config';
import channelRegister from '../../../tooling/channel-register.json';

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE KNOWN-PRODUCT SET IS THE UNION OF EVERY REGISTER — apps, extensions,
// scripts when one ships — because the bundle is products, and a bundle grant
// unlocks the extension as much as the app. `isKnownApp` stays what it was (the
// served /config set, apps only); `isKnownProduct` is what an entitlement
// question is gated on.
// ─────────────────────────────────────────────────────────────────────────────
describe('the known-PRODUCT set spans every register', () => {
  it('the committed extension is a known product but NOT a known app', () => {
    for (const row of extensions as Array<{ slug: string }>) {
      expect(isKnownProduct(row.slug), row.slug).toBe(true);
      expect(productKindOf(row.slug), row.slug).toBe('extension');
      // No /config is served for an extension; the app set is unchanged.
      expect(isKnownApp(row.slug), row.slug).toBe(false);
    }
  });

  it('every committed app is a known product of kind app, and the set is exactly the registers', () => {
    for (const row of catalogue as Array<{ slug: string }>) {
      expect(isKnownProduct(row.slug), row.slug).toBe(true);
      expect(productKindOf(row.slug), row.slug).toBe('app');
    }
    const fromRegisters = productsFromRegisters().map((p) => p.slug).sort();
    expect([...KNOWN_PRODUCTS.keys()].sort()).toEqual(fromRegisters);
    // Not vacuous: at least one row of each shipping kind.
    expect(fromRegisters.length).toBeGreaterThanOrEqual(2);
  });

  it('an inherited member of Object.prototype is not a product either', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(isKnownProduct(id), id).toBe(false);
      expect(productKindOf(id), id).toBeNull();
    }
    expect(isKnownProduct(42)).toBe(false);
    expect(isKnownProduct('not_a_product')).toBe(false);
  });

  it('🔴 an EXTENSION slug that violates APP_ID_PATTERN is an ERROR, never a silent drop', () => {
    // The app half is the filtered registry (a bad app row is dropped and the
    // CI guard reports it); an extension row has no such guard, so the only
    // loud option is to refuse to build the set at all — naming the register
    // and the slug. MUTATION PROOF: replace the throw with `continue` and this
    // goes RED.
    expect(() =>
      buildKnownProducts([{ slug: 'full-shot', kind: 'extension', status: 'preview' }], ['subscriptiontracker']),
    ).toThrow(/extension register row has slug "full-shot", which APP_ID_PATTERN rejects/);
    expect(() =>
      buildKnownProducts([{ slug: '__proto__', kind: 'extension', status: 'preview' }], []),
    ).toThrow(/APP_ID_PATTERN rejects/);
    // A kind the contract does not declare is an error too.
    expect(() =>
      buildKnownProducts([{ slug: 'thing', kind: 'gadget', status: 'live' }], []),
    ).toThrow(/PRODUCT_KINDS does not declare/);
    // One slug, two registers, two kinds: an error, not "last one wins".
    expect(() =>
      buildKnownProducts([{ slug: 'subscriptiontracker', kind: 'extension', status: 'live' }], ['subscriptiontracker']),
    ).toThrow(/two registers with different kinds/);
  });

  it('a well-formed extension row builds; the app half comes from the filtered registry', () => {
    const set = buildKnownProducts(
      [
        { slug: 'good_ext', kind: 'extension', status: 'preview' },
        // An APP row in the products list is ignored in favour of `apps` — the
        // served set already filtered by buildRegistry.
        { slug: 'My App', kind: 'app', status: 'live' },
      ],
      ['good_app'],
    );
    expect([...set.entries()].sort()).toEqual([
      ['good_app', 'app'],
      ['good_ext', 'extension'],
    ]);
  });
});

describe('CFG-1 config resolution', () => {
  it('returns compiled defaults for a known app', () => {
    const cfg = baseConfig('subscriptiontracker');
    expect(cfg).not.toBeNull();
    expect(cfg!.app_id).toBe('subscriptiontracker');
    expect(cfg!.api_base_url).toBe('https://subscriptiontracker-api.nikatru.com/v1');
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
    expect(resolveConfig('subscriptiontracker', null)).toEqual(baseConfig('subscriptiontracker'));
  });

  it('deep-merges a KV override over defaults (override wins, siblings kept)', () => {
    const merged = resolveConfig(
      'subscriptiontracker',
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
    expect(merged.api_base_url).toBe('https://subscriptiontracker-api.nikatru.com/v1');
  });

  it('ignores malformed KV JSON and falls back to defaults (never takes an app down)', () => {
    expect(resolveConfig('subscriptiontracker', '{not valid json')).toEqual(baseConfig('subscriptiontracker'));
  });

  it('does not mutate the shared defaults across calls', () => {
    const a = resolveConfig('subscriptiontracker', JSON.stringify({ paywall: { enabled: true } }))!;
    expect(a.paywall.enabled).toBe(true);
    // a second, override-free resolve must still see the pristine default
    expect(resolveConfig('subscriptiontracker', null)!.paywall.enabled).toBe(false);
  });

  it('mergeConfig with a nullish override returns the base unchanged', () => {
    const base = baseConfig('subscriptiontracker')!;
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
    for (const notAString of [null, undefined, 42, {}, ['subscriptiontracker']]) {
      expect(isKnownApp(notAString), String(notAString)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 4]B-2 — ONBOARDING AN APP IS A DATA EDIT.
//
// The registry used to be an object literal in src/config.ts, so `GET
// /config/lingo` answered 404 for a content pack that has been in this repo
// since the pipeline shipped, and app #2 could not exist without a Worker source
// edit. It is now built from the public catalogue (WHICH apps — the file
// post_gen.dart already writes) × the value document (WHAT each is served).
//
// These tests drive `buildRegistry` with catalogues they wrote, which is the
// only way to reach the interesting inputs: the committed catalogue has one row,
// and every failure worth pinning is a SECOND row somebody has not stamped yet.
// ─────────────────────────────────────────────────────────────────────────────
describe('the served app set comes from the catalogue, not from this Worker', () => {
  it('serves every app the public catalogue lists, and nothing else', () => {
    const slugs = (catalogue as Array<{ slug: string }>).map((r) => r.slug);
    expect(slugs.length, 'COVERAGE LOST — the catalogue is empty, so this ranges over nothing').toBeGreaterThan(0);
    expect(Object.keys(DEFAULT_CONFIGS).sort()).toEqual([...slugs].sort());
  });

  it('an app the value document says NOTHING about is still served, in full', () => {
    // 🔴 THE WHOLE REQUIREMENT, in one assertion. `lingo` is a real content pack
    // (tooling/content_pipeline/examples/lingo-phrases/) and the app the live
    // 404 was measured on. One catalogue row — no entry in app-config-data.json,
    // no line of Worker source — and it resolves to a complete config.
    const reg = buildRegistry(
      [...(catalogue as unknown[]), { slug: 'lingo', name: 'Lingo', api: '' }],
      configData,
    );
    expect(Object.keys(reg)).toContain('lingo');
    const cfg = reg.lingo;
    expect(cfg.app_id).toBe('lingo');
    // No `api` host of its own ⇒ the SHARED platform Worker, which is exactly
    // what pre_gen.dart compiles into a client-only stamp as its fallback.
    expect(cfg.api_base_url).toBe(configData.sharedApiBaseUrl);
    // Complete, not a stub: every key the Dart client parses is present.
    for (const k of Object.keys(configData.defaults)) expect(Object.keys(cfg)).toContain(k);
    // The registry holds the STORED shape (the floor is a per-channel map since
    // O-UPDATE-FLOOR-HAS-NO-CHANNEL); what a client is served is its collapse.
    expect(forChannel(cfg, DEFAULT_CHANNEL).min_supported_version).toBe('1.0.0');
    // And it inherits the portfolio default rather than another app's product
    // data — subscriptiontracker's two SKUs must not follow it.
    expect(cfg.paywall.offerings).toEqual([]);
    expect(cfg.features).toEqual({});
  });

  it('an app WITH its own api host is served that host, versioned', () => {
    const reg = buildRegistry([{ slug: 'withapi', api: 'https://withapi-api.nikatru.com' }], configData);
    expect(reg.withapi.api_base_url).toBe('https://withapi-api.nikatru.com/v1');
    // A trailing slash in the catalogue must not produce a double slash — the
    // catalogue is a public document edited by hand as well as by the stamp.
    const reg2 = buildRegistry([{ slug: 'withapi', api: 'https://withapi-api.nikatru.com/' }], configData);
    expect(reg2.withapi.api_base_url).toBe('https://withapi-api.nikatru.com/v1');
  });

  it('subscriptiontracker is served BYTE-IDENTICALLY to the literal this replaced', () => {
    // The refactor changed WHERE the set comes from, never what is served. The
    // whole document is pinned, key ORDER included: these are the exact bytes a
    // client caches for five minutes, and `toEqual` on a subset would not have
    // caught the key reordering a spread introduces.
    // ⏱ 2026-09-23 — pro_lifetime `trial_days` 30 -> 0, deliberately: ADR 093's
    // prices landed with the rule that a one-time offering carries no trial (a
    // trial delays the first renewal, and that offering never renews). Every
    // other byte is unchanged.
    expect(JSON.stringify(baseConfig('subscriptiontracker'))).toBe(
      '{"app_id":"subscriptiontracker","api_base_url":"https://subscriptiontracker-api.nikatru.com/v1",' +
        '"features":{"renewals":true,"budgets":true,"exports":true},"flags":{},' +
        '"paywall":{"enabled":false,"offerings":[' +
        '{"product_id":"pro_monthly","amount_minor":599,"currency_code":"USD","term":"month","trial_days":30},' +
        '{"product_id":"pro_yearly","amount_minor":3499,"currency_code":"USD","term":"year","trial_days":30},' +
        '{"product_id":"pro_lifetime","amount_minor":8900,"currency_code":"USD","term":"one_time","trial_days":0}]},' +
        '"content_pack":null,"copy":{},"min_supported_version":"1.0.0","max_promos_per_week":0,' +
        '"update_url":null}',
    );
  });
});

describe('APP_ID_PATTERN is a FILTER on the catalogue, and it can fail', () => {
  it('a catalogue row whose slug is not an app id is DROPPED, never served', () => {
    // 🔴 THE FAILING INPUT, and it is one line: delete the
    // `if (!isValidAppId(slug)) continue;` in buildRegistry and this goes red.
    //
    // ⚠️ WHY THIS MOVED. It used to range over `Object.keys(DEFAULT_CONFIGS)`
    // and assert every key was well formed — an invariant on a literal somebody
    // typed by hand, whose failing input was "type a bad key". The registry is
    // now built from JSON a mason HOOK writes, so a slug is parsed INPUT: the
    // pattern is a runtime filter with real teeth, and `__proto__` is the reason
    // it has to be. Without the filter, `out['__proto__'] = cfg` gives isKnownApp
    // an own property to find and `GET /config/__proto__` serves it.
    const reg = buildRegistry(
      [
        { slug: 'good', api: '' },
        { slug: 'My App', api: '' }, // a space — the brick would never stamp it
        { slug: 'config:evil', api: '' }, // would make the KV key ambiguous
        { slug: '2fast', api: '' }, // leading digit
        { slug: '__proto__', api: '' }, // the prototype-pollution row
        { slug: 42 }, // not a string at all
        null,
      ],
      configData,
    );
    expect(Object.keys(reg)).toEqual(['good']);
    expect(Object.getPrototypeOf(reg)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).app_id).toBeUndefined();
  });

  it('every slug in the COMMITTED catalogue survives that filter', () => {
    // The other direction: the filter above must not be silently eating a real
    // app. `tooling/ci/assert-config-registry.mjs` fails the build on the same
    // observation, because a drop nobody can see is the failure this repo pays
    // for over and over.
    for (const row of catalogue as Array<{ slug: string }>) {
      expect(isValidAppId(row.slug), `catalogue slug \`${row.slug}\` is malformed`).toBe(true);
    }
  });

  it('the grammar accepts what the brick stamps and rejects what it never would', () => {
    for (const id of ['subscriptiontracker', 'a', 'my_app2', 'a'.repeat(32)]) {
      expect(isValidAppId(id), id).toBe(true);
    }
    for (const id of [
      'config:subscriptiontracker', // would make the KV key ambiguous
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
      'subscriptiontracker',
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
      'subscriptiontracker',
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
      //
      // 🔴 `theme` USED TO BE WAVED PAST THIS LINE AS `[...REQUIRED_KEYS,
      // 'theme']`, unargued, in a block where every other entry carries a
      // paragraph. It is gone as of 2026-08-25, and removing it is a
      // TIGHTENING that changes no verdict today: measured this run, `"theme"`
      // occurs ZERO times in `app-config-data.json`, `DEFAULT_CONFIGS` is built
      // from that file alone by `buildRegistry`, and no compiled-in default
      // carries the key — so the allowance permitted something that never
      // arrives.
      //
      // What it buys is the lever the two keys above describe, pointed at the
      // one field that had escaped every one of them. `theme?` is OPTIONAL in
      // the TS interface, which is exactly how it slipped past
      // assert-config-registry limb 6 (its required set is built with
      // `.filter((k) => k[2] !== '?')`); limb 9 now covers the optional fields,
      // and this line is its other half. Serving `theme` from a compiled-in
      // default now turns THIS lane red the same day, which forces the decision
      // to be taken rather than merged.
      for (const k of keys) {
        expect([...REQUIRED_KEYS], `${appId} has unexpected "${k}"`).toContain(k);
      }
    }
  });

  it('flags is a typed percentage map that a KV override can set', () => {
    expect(baseConfig('subscriptiontracker')!.flags).toEqual({});
    const merged = resolveConfig('subscriptiontracker', JSON.stringify({ flags: { new_home: 25 } }))!;
    expect(merged.flags.new_home).toBe(25);
    // and the default stays pristine for the next resolve
    expect(baseConfig('subscriptiontracker')!.flags).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O-UPDATE-FLOOR-HAS-NO-CHANNEL — THE FLOOR AND THE EXIT ARE RESOLVED PER CHANNEL.
//
// `min_supported_version` was one string per app, so raising it for the web
// build walled every store build with it. The value document now keys it (and
// `update_url`) by channel id, `default` answering the rest; `forChannel`
// collapses both before anything reaches the wire. The route half — `?channel=`,
// the 400, the KV map — is in config-route.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
describe('the per-channel floor and update destination', () => {
  /** The committed value document with `defaults` changed in the named keys. */
  const withDefaults = (patch: Record<string, unknown>) => ({
    ...configData,
    defaults: { ...configData.defaults, ...patch },
  });

  it('the channel set is every id the register declares, and nothing else', () => {
    const ids = (channelRegister as { channels: Array<{ id: string }> }).channels.map((c) => c.id);
    expect(ids.length, 'COVERAGE LOST — the register declares no channel').toBeGreaterThan(0);
    expect([...RELEASE_CHANNELS].sort()).toEqual([...ids].sort());
    expect(isKnownChannel('web')).toBe(true);
    expect(isKnownChannel('android-play')).toBe(true);
  });

  it('the fallback key, a near-miss and a prototype name are not channels', () => {
    expect(isKnownChannel(DEFAULT_CHANNEL)).toBe(false);
    expect(isKnownChannel('androidplay')).toBe(false);
    expect(isKnownChannel('__proto__')).toBe(false);
    expect(isKnownChannel('')).toBe(false);
    expect(isKnownChannel(42)).toBe(false);
  });

  it('🔴 a register row named `default` is an ERROR, never a silent collision', () => {
    // MUTATION PROOF: replace the throw with `continue` and this goes RED.
    expect(() => buildReleaseChannels(['web', 'default'])).toThrow(/per-channel maps' fallback key/);
    expect([...buildReleaseChannels(['web', 'android-play'])]).toEqual(['web', 'android-play']);
  });

  it('RC1 (pure) — raising web to 9.0.0 in the value document leaves android-play on default', () => {
    // THE ROW'S CLOSES CONDITION, on the data file's own shape. With the scalar
    // this replaced, the only way to ask web for 9.0.0 walled android-play too.
    const reg = buildRegistry(
      [{ slug: 'x', api: '' }],
      withDefaults({ min_supported_version: { default: '1.0.0', web: '9.0.0' } }),
    );
    expect(forChannel(reg.x, 'android-play').min_supported_version).toBe('1.0.0');
    expect(forChannel(reg.x, 'web').min_supported_version).toBe('9.0.0');
    expect(forChannel(reg.x, DEFAULT_CHANNEL).min_supported_version).toBe('1.0.0');
  });

  it("an app's own map merges KEY-WISE over the defaults' map", () => {
    const data = {
      ...withDefaults({ min_supported_version: { default: '1.0.0', web: '9.0.0' } }),
      apps: { x: { min_supported_version: { 'android-play': '1.2.0' } } },
    };
    const reg = buildRegistry([{ slug: 'x', api: '' }], data);
    expect(forChannel(reg.x, 'android-play').min_supported_version).toBe('1.2.0');
    expect(forChannel(reg.x, 'web').min_supported_version).toBe('9.0.0');
    expect(forChannel(reg.x, 'ios-appstore').min_supported_version).toBe('1.0.0');
  });

  it("an app's own SCALAR replaces the map and means every channel", () => {
    const data = {
      ...withDefaults({ min_supported_version: { default: '1.0.0', web: '9.0.0' } }),
      apps: { x: { min_supported_version: '1.5.0' } },
    };
    const reg = buildRegistry([{ slug: 'x', api: '' }], data);
    expect(forChannel(reg.x, 'web').min_supported_version).toBe('1.5.0');
    expect(forChannel(reg.x, 'android-play').min_supported_version).toBe('1.5.0');
  });

  it('update_url is resolved per channel the same way', () => {
    const reg = buildRegistry(
      [{ slug: 'x', api: '' }],
      withDefaults({ update_url: { default: null, 'windows-direct': 'https://dl.example.invalid/win' } }),
    );
    expect(forChannel(reg.x, 'windows-direct').update_url).toBe('https://dl.example.invalid/win');
    expect(forChannel(reg.x, 'web').update_url).toBeNull();
  });

  it('channelValue: a scalar as it is; a map with neither the channel nor default is undefined', () => {
    expect(channelValue('1.0.0', 'web')).toBe('1.0.0');
    expect(channelValue(null, 'web')).toBeNull();
    expect(channelValue({ default: '1.0.0', web: '2.0.0' }, 'web')).toBe('2.0.0');
    expect(channelValue({ default: '1.0.0', web: '2.0.0' }, 'amo')).toBe('1.0.0');
    expect(channelValue({ web: '2.0.0' }, 'amo')).toBeUndefined();
  });

  it('the COMMITTED document serves every app a scalar floor and exit on every channel', () => {
    // The wire contract (types.ts `AppConfig`) is scalar; this is the property
    // over the real registry and the real register, not a fixture.
    const apps = Object.keys(DEFAULT_CONFIGS);
    expect(apps.length, 'COVERAGE LOST — no app is served').toBeGreaterThan(0);
    for (const appId of apps) {
      for (const channel of [DEFAULT_CHANNEL, ...RELEASE_CHANNELS]) {
        const cfg = baseConfig(appId, channel)!;
        expect(typeof cfg.min_supported_version, `${appId} on ${channel}`).toBe('string');
        expect(cfg.min_supported_version.length, `${appId} on ${channel}`).toBeGreaterThan(0);
        expect(cfg.update_url === null || typeof cfg.update_url === 'string', `${appId} on ${channel}`).toBe(true);
      }
    }
  });
});
