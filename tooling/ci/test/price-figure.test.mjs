// ─────────────────────────────────────────────────────────────────────────────
// price-figure.test.mjs — the shared price matcher must be able to FAIL.
//
// O-PRICE-GUARD-IS-DART-ONLY. tooling/ci/price-figure.mjs is the UNION of the
// two matchers that assert-no-price-literals.mjs (dart) and
// assert-store-metadata.mjs (the apps-gov-in listing) each carried until
// 2026-09-24. Each case below reds on a named mutation of the module: drop a
// symbol, a notation or the `i` flag and the case that spells it goes red.
//
// Every case is written out by hand (assert-no-loop-cases.mjs).
//
// Run:  node --test tooling/ci/test/price-figure.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRICE, LIFETIME } from '../price-figure.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The figure the matcher reports — what a guard quotes in its finding. */
const figure = (text) => PRICE.exec(text)?.[0] ?? null;

describe('PRICE — the shapes the dart matcher read', () => {
  test('a dollar raw string, the literal the M-11 defect shipped', () => {
    assert.equal(figure("r'$2.99'"), '$2.99');
  });

  test('a rupee symbol', () => {
    assert.equal(figure("'₹399'"), '₹399');
  });

  test('a euro symbol', () => {
    assert.equal(figure('€4.99'), '€4.99');
  });

  test('a pound symbol with thousands commas', () => {
    assert.equal(figure("'£1,299.00'"), '£1,299.00');
  });

  test('a yen symbol', () => {
    assert.equal(figure('¥500'), '¥500');
  });

  test('a code-first price', () => {
    assert.equal(figure("'USD 4.99'"), 'USD 4.99');
  });

  test('a code-last price', () => {
    assert.equal(figure("'19.99 EUR'"), '19.99 EUR');
  });
});

describe('PRICE — the shapes the apps-gov-in listing matcher read', () => {
  test('`Rs` with a space and thousands commas', () => {
    assert.equal(figure('Lifetime Rs 2,499 once'), 'Rs 2,499');
  });

  test('`Rs.` with a dot', () => {
    assert.equal(figure('Pro is Rs. 499 a year.'), 'Rs. 499');
  });

  test('`INR` with a space', () => {
    assert.equal(figure('INR 499 a year'), 'INR 499');
  });

  test('a lower-case code: the listing matcher was case-insensitive', () => {
    assert.equal(figure('pro for usd 4.99'), 'usd 4.99');
  });

  test('a lower-case `rs`', () => {
    assert.equal(figure('only rs 99'), 'rs 99');
  });

  test('`INR` with two spaces: the listing matcher took any run of blanks', () => {
    assert.equal(figure('INR  499'), 'INR  499');
  });

  test('the figure quoted is the price, not the sentence around it', () => {
    assert.equal(figure('Pro is ₹499 a year.\n'), '₹499');
  });
});

describe('PRICE — what is not a price', () => {
  test('a version string', () => {
    assert.equal(figure("'v1.0.0'"), null);
  });

  test('a date', () => {
    assert.equal(figure("'2026-08-01'"), null);
  });

  test('a bare number with no currency marker', () => {
    assert.equal(figure("'4.99'"), null);
  });

  test('a width', () => {
    assert.equal(figure("'width: 24.99'"), null);
  });

  test('a hex colour', () => {
    assert.equal(figure("'#4CAF50'"), null);
  });

  test('a count of days and devices, and a build number', () => {
    assert.equal(figure('Reminds you 7 days ahead, across 3 devices. Version 1.0.101.'), null);
  });

  test('a code glued to a word is not a price (`CADENCE 5`)', () => {
    assert.equal(figure('CADENCE 5'), null);
  });

  test('`Rs` inside a word is not a price (`hours 5`)', () => {
    assert.equal(figure('two hours 5 minutes'), null);
  });
});

describe('PRICE — carries no state between calls', () => {
  test('no global or sticky flag, so a second test gives the same answer', () => {
    assert.doesNotMatch(PRICE.flags, /[gy]/);
    assert.equal(PRICE.test('$4.99'), true);
    assert.equal(PRICE.test('$4.99'), true);
  });
});

describe('LIFETIME — the plan no listing names ([ADR 093] §2, §11.2)', () => {
  test('the word, capitalised', () => {
    assert.equal(LIFETIME.test('Lifetime ₹2,499'), true);
  });

  test('the word, upper case', () => {
    assert.equal(LIFETIME.test('A LIFETIME PLAN'), true);
  });

  test('the word inside a sentence', () => {
    assert.equal(LIFETIME.test('A lifetime plan is available.'), true);
  });

  test('not a longer word that contains it', () => {
    assert.equal(LIFETIME.test('lifetimes'), false);
  });
});

describe('the two guards read THIS matcher and carry none of their own', () => {
  const code = (name) => stripSourceComments(readFileSync(join(CI_DIR, name), 'utf8'), '.mjs');

  test('assert-no-price-literals.mjs imports PRICE and LIFETIME from ./price-figure.mjs', () => {
    const src = code('assert-no-price-literals.mjs');
    assert.match(src, /import \{[^}]*\bPRICE\b[^}]*\} from '\.\/price-figure\.mjs'/);
    assert.match(src, /import \{[^}]*\bLIFETIME\b[^}]*\} from '\.\/price-figure\.mjs'/);
  });

  test('assert-no-price-literals.mjs declares no currency class of its own', () => {
    assert.doesNotMatch(code('assert-no-price-literals.mjs'), /\[\$€£¥₹\]/);
  });

  test('assert-store-metadata.mjs imports PRICE and LIFETIME from ./price-figure.mjs', () => {
    const src = code('assert-store-metadata.mjs');
    assert.match(src, /import \{[^}]*\bPRICE\b[^}]*\} from '\.\/price-figure\.mjs'/);
    assert.match(src, /import \{[^}]*\bLIFETIME\b[^}]*\} from '\.\/price-figure\.mjs'/);
  });

  test('assert-store-metadata.mjs declares no `Rs` matcher and no lifetime regex of its own', () => {
    const src = code('assert-store-metadata.mjs');
    assert.doesNotMatch(src, /\\bRs\\\.\?/);
    assert.doesNotMatch(src, /\/\\blifetime\\b\/i/);
  });
});
