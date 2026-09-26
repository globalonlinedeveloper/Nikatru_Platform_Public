// ─────────────────────────────────────────────────────────────────────────────
// required-providers.test.mjs — the cases for tooling/legal/required-providers.mjs,
// the one evaluator of the provider register's `requiredWhen` field.
//
// assert-app-yaml.mjs limb 9 holds every apps/<id>/privacy.yaml to the set this
// module returns (O-APP-PRIVACY-OMITS-STORE-BILLING), so a kind that silently
// returned nothing would turn that limb green over an app that declares a store
// rail and names no store. Each kind therefore has a case that FIRES and a case
// that does not, written out one by one, plus the two refusals the limb maps to
// exit codes: an unknown or missing kind (UNKNOWN_KIND, exit 2) and a known kind
// with a wrong shape (MALFORMED, exit 1).
//
// The last block runs the resolver against the REAL register, channel register
// and app.yaml, as the positive control: those are the inputs the limb reads.
//
// Run:  node --test tooling/ci/test/required-providers.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../app-yaml/yaml.mjs';
import {
  RAIL_KINDS,
  REQUIRED_WHEN_KINDS,
  RequiredWhenError,
  gradeRequiredWhen,
  jsonIdLine,
  neverProviders,
  providersOnRail,
  resolveRequiredProviders,
  yamlKeyLine,
} from '../../legal/required-providers.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A channel register with the real rail vocabulary and the channels given. */
const channelsWith = (...channels) => ({
  purchaseRails: { rails: { paddle: {}, 'play-billing': {}, 'apple-iap': {}, razorpay: {}, none: {} } },
  channels,
});
const register = (...providers) => ({ providers });
const ids = (required) => required.map((r) => r.id);

const APP_WITH_IAP = { id: 'demo', billing: { mobileIap: { provider: 'revenuecat', entitlementId: 'pro' } } };
const APP_WITHOUT_IAP = { id: 'demo', billing: {} };
const LANE = { workflow: 'release.yml', job: 'build' };

describe('required-providers — the vocabulary', () => {
  test('the five kinds, in the order the register documents them', () => {
    assert.deepEqual([...REQUIRED_WHEN_KINDS], ['always', 'appYaml', 'mobileIapRail', 'channelRail', 'never']);
    assert.ok(Object.isFrozen(REQUIRED_WHEN_KINDS));
  });
});

describe('required-providers — always', () => {
  test('an always row is required of an app that declares nothing else', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: { id: 'demo' },
      channelRegister: channelsWith(),
      providerRegister: register({ id: 'host', requiredWhen: { kind: 'always' } }),
    });
    assert.deepEqual(ids(out), ['host']);
    assert.equal(out[0].kind, 'always');
  });
});

describe('required-providers — appYaml', () => {
  test('fires when the dotted key carries the value', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITH_IAP,
      channelRegister: channelsWith(),
      providerRegister: register({ id: 'rc', requiredWhen: { kind: 'appYaml', path: 'billing.mobileIap.provider', equals: 'revenuecat' } }),
    });
    assert.deepEqual(ids(out), ['rc']);
    assert.equal(out[0].appYamlPath, 'billing.mobileIap.provider');
    assert.match(out[0].trigger, /billing\.mobileIap\.provider is "revenuecat"/);
  });

  test('does not fire on another value', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: { id: 'demo', billing: { mobileIap: { provider: 'other' } } },
      channelRegister: channelsWith(),
      providerRegister: register({ id: 'rc', requiredWhen: { kind: 'appYaml', path: 'billing.mobileIap.provider', equals: 'revenuecat' } }),
    });
    assert.deepEqual(ids(out), []);
  });

  test('does not fire when the key is absent', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITHOUT_IAP,
      channelRegister: channelsWith(),
      providerRegister: register({ id: 'rc', requiredWhen: { kind: 'appYaml', path: 'billing.mobileIap.provider', equals: 'revenuecat' } }),
    });
    assert.deepEqual(ids(out), []);
  });
});

describe('required-providers — mobileIapRail', () => {
  test('fires when the app declares billing.mobileIap and a laned app channel sells on the rail', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITH_IAP,
      channelRegister: channelsWith({ id: 'ios-appstore', surface: 'app', lane: LANE, purchaseRail: { rail: 'apple-iap' } }),
      providerRegister: register({ id: 'apple-app-store', requiredWhen: { kind: 'mobileIapRail', rail: 'apple-iap' } }),
    });
    assert.deepEqual(ids(out), ['apple-app-store']);
    assert.deepEqual(out[0].channels, [{ id: 'ios-appstore', via: 'purchaseRail.rail' }]);
    assert.equal(out[0].appYamlPath, 'billing.mobileIap');
  });

  test('does not fire for an app without billing.mobileIap, even with the channel laned', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITHOUT_IAP,
      channelRegister: channelsWith({ id: 'ios-appstore', surface: 'app', lane: LANE, purchaseRail: { rail: 'apple-iap' } }),
      providerRegister: register({ id: 'apple-app-store', requiredWhen: { kind: 'mobileIapRail', rail: 'apple-iap' } }),
    });
    assert.deepEqual(ids(out), []);
  });

  test('does not fire when the only channel on the rail has lane null', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITH_IAP,
      channelRegister: channelsWith({ id: 'ios-appstore', surface: 'app', lane: null, purchaseRail: { rail: 'apple-iap' } }),
      providerRegister: register({ id: 'apple-app-store', requiredWhen: { kind: 'mobileIapRail', rail: 'apple-iap' } }),
    });
    assert.deepEqual(ids(out), []);
  });
});

describe('required-providers — channelRail', () => {
  test('fires when a laned app channel sells on the rail', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITHOUT_IAP,
      channelRegister: channelsWith({ id: 'web', surface: 'app', lane: LANE, purchaseRail: { rail: 'paddle' } }),
      providerRegister: register({ id: 'paddle', requiredWhen: { kind: 'channelRail', rail: 'paddle' } }),
    });
    assert.deepEqual(ids(out), ['paddle']);
    assert.deepEqual(out[0].channels, [{ id: 'web', via: 'purchaseRail.rail' }]);
  });

  test('does not fire on an extension channel, whose surface is not the app', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITHOUT_IAP,
      channelRegister: channelsWith({ id: 'chrome-webstore', surface: 'extension', lane: LANE, purchaseRail: { rail: 'paddle' } }),
      providerRegister: register({ id: 'paddle', requiredWhen: { kind: 'channelRail', rail: 'paddle' } }),
    });
    assert.deepEqual(ids(out), []);
  });

  test('regionToo fires on a laned app channel whose regionRails names the rail', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITHOUT_IAP,
      channelRegister: channelsWith({
        id: 'web',
        surface: 'app',
        lane: LANE,
        purchaseRail: { rail: 'paddle', regionRails: [{ region: 'IN', rail: 'razorpay' }] },
      }),
      providerRegister: register({ id: 'razorpay', requiredWhen: { kind: 'channelRail', rail: 'razorpay', regionToo: true } }),
    });
    assert.deepEqual(ids(out), ['razorpay']);
    assert.deepEqual(out[0].channels, [{ id: 'web', via: 'purchaseRail.regionRails IN' }]);
  });

  test('without regionToo, a regionRails entry does not fire', () => {
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITHOUT_IAP,
      channelRegister: channelsWith({
        id: 'web',
        surface: 'app',
        lane: LANE,
        purchaseRail: { rail: 'paddle', regionRails: [{ region: 'IN', rail: 'razorpay' }] },
      }),
      providerRegister: register({ id: 'razorpay', requiredWhen: { kind: 'channelRail', rail: 'razorpay' } }),
    });
    assert.deepEqual(ids(out), []);
  });
});

describe('required-providers — never', () => {
  test('a never row is not required, even of an app with every trigger', () => {
    const reg = register({ id: 'old-mor', requiredWhen: { kind: 'never', why: 'Retired; no channel sells through it any more.' } });
    const out = resolveRequiredProviders('demo', {
      appYaml: APP_WITH_IAP,
      channelRegister: channelsWith({ id: 'web', surface: 'app', lane: LANE, purchaseRail: { rail: 'paddle' } }),
      providerRegister: reg,
    });
    assert.deepEqual(ids(out), []);
    assert.deepEqual(neverProviders(reg), ['old-mor']);
  });
});

describe('required-providers — refusals', () => {
  test('an unknown kind throws UNKNOWN_KIND (the limb maps it to exit 2)', () => {
    assert.throws(
      () => resolveRequiredProviders('demo', {
        appYaml: APP_WITH_IAP,
        channelRegister: channelsWith(),
        providerRegister: register({ id: 'x', requiredWhen: { kind: 'sometimes' } }),
      }),
      (e) => e instanceof RequiredWhenError && e.code === 'UNKNOWN_KIND' && /provider "x".*"sometimes"/.test(e.message),
    );
  });

  test('a row with no requiredWhen throws UNKNOWN_KIND', () => {
    assert.throws(
      () => resolveRequiredProviders('demo', {
        appYaml: APP_WITH_IAP,
        channelRegister: channelsWith(),
        providerRegister: register({ id: 'x' }),
      }),
      (e) => e instanceof RequiredWhenError && e.code === 'UNKNOWN_KIND' && /provider "x" has no requiredWhen/.test(e.message),
    );
  });

  test('a never row whose why is under 20 characters throws MALFORMED (exit 1)', () => {
    assert.throws(
      () => resolveRequiredProviders('demo', {
        appYaml: APP_WITH_IAP,
        channelRegister: channelsWith(),
        providerRegister: register({ id: 'x', requiredWhen: { kind: 'never', why: 'not used' } }),
      }),
      (e) => e instanceof RequiredWhenError && e.code === 'MALFORMED' && /requiredWhen\.why/.test(e.message),
    );
  });

  test('a rail that is not a selling rail of the channel register is MALFORMED', () => {
    const g = gradeRequiredWhen(register({ id: 'x', requiredWhen: { kind: 'channelRail', rail: 'none' } }), channelsWith());
    assert.deepEqual(g.unknown, []);
    assert.equal(g.malformed.length, 1);
    assert.match(g.malformed[0], /requiredWhen\.rail is "none"/);
  });

  test('a key the kind does not read is MALFORMED; a _comment key is allowed', () => {
    const g = gradeRequiredWhen(
      register({ id: 'x', requiredWhen: { kind: 'always', rail: 'paddle', _why: 'a comment' } }),
      channelsWith(),
    );
    assert.deepEqual(g.unknown, []);
    assert.equal(g.malformed.length, 1);
    assert.match(g.malformed[0], /carries "rail"/);
  });

  test('an unknown kind outranks a malformed row: the resolver refuses with UNKNOWN_KIND', () => {
    assert.throws(
      () => resolveRequiredProviders('demo', {
        appYaml: APP_WITH_IAP,
        channelRegister: channelsWith(),
        providerRegister: register(
          { id: 'a', requiredWhen: { kind: 'never', why: 'short' } },
          { id: 'b', requiredWhen: { kind: 'sometimes' } },
        ),
      }),
      (e) => e instanceof RequiredWhenError && e.code === 'UNKNOWN_KIND',
    );
  });
});

describe('required-providers — line helpers', () => {
  test('yamlKeyLine finds a nested key at its own depth, not a deeper namesake', () => {
    const text = ['billing:', '  other:', '    provider: nope', '  mobileIap:', '    provider: revenuecat', 'name: x', ''].join('\n');
    assert.equal(yamlKeyLine(text, 'billing.mobileIap'), 4);
    assert.equal(yamlKeyLine(text, 'billing.mobileIap.provider'), 5);
    assert.equal(yamlKeyLine(text, 'billing.provider'), null);
  });

  test('jsonIdLine searches from the anchor line', () => {
    const text = ['{', '  "ciSecretRegister": [{ "id": "web" }],', '  "channels": [', '    {', '      "id": "web"', '    }', '  ]', '}'].join('\n');
    assert.equal(jsonIdLine(text, 'web'), 2);
    assert.equal(jsonIdLine(text, 'web', '"channels": ['), 5);
    assert.equal(jsonIdLine(text, 'absent', '"channels": ['), null);
  });
});

describe('required-providers — the provider a rail resolves to', () => {
  test('the rail-carrying kinds are the two that read a `rail` key', () => {
    assert.deepEqual([...RAIL_KINDS], ['mobileIapRail', 'channelRail']);
    assert.ok(Object.isFrozen(RAIL_KINDS));
  });

  test('a channelRail row and a mobileIapRail row each resolve their own rail', () => {
    const reg = register(
      { id: 'mor', requiredWhen: { kind: 'channelRail', rail: 'paddle' } },
      { id: 'store', requiredWhen: { kind: 'mobileIapRail', rail: 'apple-iap' } },
      { id: 'host', requiredWhen: { kind: 'always' } },
    );
    assert.deepEqual(ids(providersOnRail(reg, 'paddle')), ['mor']);
    assert.deepEqual(ids(providersOnRail(reg, 'apple-iap')), ['store']);
  });

  test('a rail no row names resolves to nothing, and a never row never resolves', () => {
    const reg = register(
      { id: 'mor', requiredWhen: { kind: 'channelRail', rail: 'paddle' } },
      { id: 'retired', requiredWhen: { kind: 'never', why: 'no channel sells on it any more' } },
    );
    assert.deepEqual(providersOnRail(reg, 'razorpay'), []);
    assert.deepEqual(providersOnRail(register(), 'paddle'), []);
  });
});

describe('required-providers — the real register (positive control)', () => {
  const providerRegister = JSON.parse(readFileSync(join(REPO, 'tooling', 'legal', 'provider-register.json'), 'utf8'));
  const channelRegister = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));

  test('each selling rail of the real channel register resolves to exactly one provider row', () => {
    assert.deepEqual(ids(providersOnRail(providerRegister, 'paddle')), ['paddle']);
    assert.deepEqual(ids(providersOnRail(providerRegister, 'razorpay')), ['razorpay']);
    assert.deepEqual(ids(providersOnRail(providerRegister, 'apple-iap')), ['apple-app-store']);
    assert.deepEqual(ids(providersOnRail(providerRegister, 'play-billing')), ['google-play']);
  });

  test('every row of the real register carries a requiredWhen this module can judge', () => {
    assert.ok(providerRegister.providers.length > 0);
    assert.deepEqual(gradeRequiredWhen(providerRegister, channelRegister), { unknown: [], malformed: [] });
  });

  test('subscriptiontracker is required to declare the stack, its billing providers and its stores', () => {
    const appYaml = parseYaml(readFileSync(join(REPO, 'apps', 'subscriptiontracker', 'app.yaml'), 'utf8'));
    const out = resolveRequiredProviders('subscriptiontracker', { appYaml, channelRegister, providerRegister });
    assert.deepEqual(ids(out).sort(), [
      'apple-app-store',
      'cloudflare',
      'google-play',
      'hostinger',
      'oracle-cloud',
      'paddle',
      'razorpay',
      'resend',
      'revenuecat',
      'supabase',
    ]);
  });
});
