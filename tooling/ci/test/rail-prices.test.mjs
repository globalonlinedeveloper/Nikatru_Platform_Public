// ─────────────────────────────────────────────────────────────────────────────
// rail-prices.test.mjs — tooling/catalog/render-rail-prices.mjs must be able to FAIL.
//
// O-RAIL-PRICE-IDS-HAND-KEPT: the rail price ids render from the price register
// (services/platform/src/app-config-data.json `prices`) into
// services/platform/src/routes/rail-price-ids.ts, and the store column is graded
// by [ADR 093] §2. Every limb of the renderer has a case here that turns it red
// on a fixture copied from the real tree (ADR 072: fixtures only in os.tmpdir()),
// beside a green control on the unmutated copy.
//
// Run:  node --test tooling/ci/test/rail-prices.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BUNDLES_REGISTER } from '../../catalog/read.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'catalog', 'render-rail-prices.mjs');
const REGISTER = 'services/platform/src/app-config-data.json';
const RENDERED = 'services/platform/src/routes/rail-price-ids.ts';
const CHECKOUT = 'services/platform/src/routes/checkout.ts';
const APP = 'subscriptiontracker';
const APP_YAML = `apps/${APP}/app.yaml`;

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-rp-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A copy of exactly the files the renderer reads, from the real tree. */
function fixture() {
  const root = join(TMP, `f${++seq}`);
  for (const rel of [REGISTER, RENDERED, CHECKOUT, BUNDLES_REGISTER, APP_YAML]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(root, rel));
  }
  return root;
}

/** Rewrite the fixture's register through `fn(data)`. */
function mutate(root, fn) {
  const p = join(root, REGISTER);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  fn(data);
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function run(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...(root ? [root] : []), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}

const monthly = (d) => d.prices.apps[APP].pro_monthly;
const lifetime = (d) => d.prices.apps[APP].pro_lifetime;

describe('the real tree', () => {
  test('--check exits 0, and the run says Razorpay is pending until PR B', () => {
    const r = run(null, '--check');
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /ok {3}render-rail-prices --check/);
    assert.match(r.out, /razorpay: \d+ of \d+ offering\(s\) pending .*Razorpay PR B \(designed, not briefed\)/);
  });
});

describe('green control and rendering', () => {
  test('an unmutated copy of the real tree is green under --check', () => {
    const root = fixture();
    const r = run(root, '--check');
    assert.equal(r.code, 0, r.all);
  });

  test('RC12 (the row): one id edited in the rendered file is exit 1 under --check, naming it', () => {
    const root = fixture();
    const p = join(root, RENDERED);
    const text = readFileSync(p, 'utf8');
    const edited = text.replace(/pri_[a-z0-9]{26}/, 'pri_01aaaaaaaaaaaaaaaaaaaaaaaa');
    assert.notEqual(edited, text, 'the fixture must carry a Paddle id to edit');
    writeFileSync(p, edited);
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /rail-price-ids\.ts is not what .* renders/);
  });

  test('render writes a missing rendered file, and a second run leaves it byte-identical', () => {
    const root = fixture();
    const want = readFileSync(join(root, RENDERED), 'utf8');
    rmSync(join(root, RENDERED));
    const first = run(root);
    assert.equal(first.code, 0, first.all);
    assert.match(first.out, /wrote services\/platform\/src\/routes\/rail-price-ids\.ts/);
    assert.equal(readFileSync(join(root, RENDERED), 'utf8'), want);
    const second = run(root);
    assert.equal(second.code, 0, second.all);
    assert.match(second.out, /render-rail-prices — unchanged/);
    assert.equal(readFileSync(join(root, RENDERED), 'utf8'), want);
  });

  test('a finding writes nothing, even in render mode', () => {
    const root = fixture();
    rmSync(join(root, RENDERED));
    mutate(root, (d) => {
      monthly(d).store.USD = 1;
    });
    const r = run(root);
    assert.equal(r.code, 1, r.all);
    assert.equal(existsSync(join(root, RENDERED)), false);
  });
});

describe('limb D — the store column, [ADR 093] §2', () => {
  test('RC13: a store price at web × 1.15 is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      const web = d.apps[APP].paywall.offerings.find((o) => o.product_id === 'pro_monthly').amount_minor;
      monthly(d).store.USD = Math.ceil((web * 115) / 100);
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /pro_monthly\.store\.USD is \d+, below the web price \d+ × 1\.20/);
  });

  test('an INR store price below web × 1.20 is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      monthly(d).store.INR = monthly(d).webInrMinor;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /pro_monthly\.store\.INR is \d+, below the web price/);
  });

  test('a bundle store price below its web price × 1.20 is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      const b = d.prices.bundles['bundle-yearly'];
      b.store.USD = b.amount_minor;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /bundle-yearly\.store\.USD is \d+, below the web price/);
  });

  test('a store read-back BELOW the store price is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      monthly(d).store.readBack.apple = { USD: monthly(d).store.USD - 1 };
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /readBack\.apple\.USD is \d+, below the store price/);
  });

  test('a store read-back ABOVE the store price is accepted (the next valid point up)', () => {
    const root = fixture();
    mutate(root, (d) => {
      monthly(d).store.readBack.google = { USD: monthly(d).store.USD + 20 };
    });
    const r = run(root);
    assert.equal(r.code, 0, r.all);
  });

  test('a third currency in the store column is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      monthly(d).store.EUR = 700;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /store carries "EUR"/);
  });

  test('a store column on the lifetime plan is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      lifetime(d).store = { USD: 99999, INR: 999999, readBack: { apple: null, google: null } };
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /pro_lifetime is the lifetime plan and carries a `store` price/);
  });

  test('a store-sold plan with no store column is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      delete monthly(d).store;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /pro_monthly has no `store` object/);
  });
});

describe('limb C — the rails', () => {
  test('a pending rail with no reason is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      monthly(d).rails.razorpay = { pending: '' };
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /rails\.razorpay\.pending is "". A pending rail carries its reason/);
  });

  test('an entry that omits a rail is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      delete monthly(d).rails.razorpay;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /pro_monthly\.rails\.razorpay is missing/);
  });

  test('a Paddle amount that disagrees with the served web price is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      monthly(d).rails.paddle.amountMinor += 100;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /rails\.paddle\.amountMinor is \d+ while the web USD price it sells is \d+/);
  });

  test('a malformed Paddle id is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      monthly(d).rails.paddle.priceId = 'price_monthly';
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /rails\.paddle\.priceId is "price_monthly", not a paddle id/);
  });

  test('one Paddle id on two offerings is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      const yearly = d.prices.apps[APP].pro_yearly;
      yearly.rails.paddle.priceId = monthly(d).rails.paddle.priceId;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /both name pri_[a-z0-9]{26}\. One rail id sells one offering/);
  });

  test('a bundle plan carrying rails is exit 1 (its handles live in the bundle register)', () => {
    const root = fixture();
    mutate(root, (d) => {
      d.prices.bundles['bundle-monthly'].rails = { paddle: { pending: 'no bundle offer exists on Paddle yet' } };
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /bundle-monthly carries `rails`/);
  });
});

describe('limbs A and B — the join and the plan', () => {
  test('a served offering with no price-book entry is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      delete d.prices.apps[APP].pro_yearly;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /serves offering "pro_yearly" and prices\.apps\.subscriptiontracker has no entry for it/);
  });

  test('a price-book entry for an offering nobody serves is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      d.prices.apps[APP].pro_weekly = structuredClone(monthly(d));
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /prices\.apps\.subscriptiontracker\.pro_weekly prices an offering apps\.subscriptiontracker does not serve/);
  });

  test('a plan that disagrees with the served term is exit 1', () => {
    const root = fixture();
    mutate(root, (d) => {
      monthly(d).plan = 'single-yearly';
    });
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /pro_monthly\.plan is "single-yearly"; its served term "month" makes it "single-monthly"/);
  });
});

describe('limb E — one home for a rail id', () => {
  test('RC14: a Paddle id re-added to checkout.ts is exit 1', () => {
    const root = fixture();
    const p = join(root, CHECKOUT);
    writeFileSync(p, `${readFileSync(p, 'utf8')}\nconst LEGACY = 'pri_01m346p0fjtaffk6waj5x5vz1c';\n`);
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /routes\/checkout\.ts carries the rail id\(s\) pri_01m346p0fjtaffk6waj5x5vz1c/);
  });

  test('a hand RAIL_PRICE_AMOUNTS_MINOR declared in checkout.ts is exit 1', () => {
    const root = fixture();
    const p = join(root, CHECKOUT);
    writeFileSync(p, `${readFileSync(p, 'utf8')}\nconst RAIL_PRICE_AMOUNTS_MINOR = { subscriptiontracker: {} };\n`);
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /routes\/checkout\.ts declares RAIL_PRICE_AMOUNTS_MINOR/);
  });
});

describe('COVERAGE LOST', () => {
  test('a register with no prices section is exit 2', () => {
    const root = fixture();
    mutate(root, (d) => {
      delete d.prices;
    });
    const r = run(root, '--check');
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /COVERAGE LOST — .* has no `prices` section/);
  });

  test('a register that serves zero offerings is exit 2, not a clean pass', () => {
    const root = fixture();
    mutate(root, (d) => {
      d.apps[APP].paywall.offerings = [];
      d.prices.apps = {};
    });
    const r = run(root, '--check');
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /serves zero offerings/);
  });
});

describe('--store-sheet', () => {
  test('prints each store product id with its store price, and writes nothing', () => {
    const root = fixture();
    const before = readFileSync(join(root, RENDERED), 'utf8');
    const data = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
    const r = run(root, '--store-sheet', APP);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /store sheet — subscriptiontracker/);
    assert.match(r.out, /apple-iap/);
    assert.match(r.out, /play-billing/);
    assert.ok(r.out.includes(`plan single-monthly  USD ${monthly(data).store.USD} minor  INR ${monthly(data).store.INR} minor`), r.out);
    assert.doesNotMatch(r.out, /single-lifetime/);
    assert.equal(readFileSync(join(root, RENDERED), 'utf8'), before);
  });

  test('a store product whose plan has no store price is exit 1', () => {
    const root = fixture();
    const p = join(root, APP_YAML);
    writeFileSync(p, readFileSync(p, 'utf8').replace('- plan: single-yearly', '- plan: bundle-yearly'));
    const r = run(root, '--store-sheet', APP);
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /storeProducts plan "bundle-yearly" has no store price/);
  });
});
