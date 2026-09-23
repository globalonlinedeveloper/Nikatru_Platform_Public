// ─────────────────────────────────────────────────────────────────────────────
// render-payload.test.mjs — `assert-render-payload.mjs` and its publisher must
// be able to FAIL, and must be able to say YES.
//
// 🔴 EVERY FIXTURE HERE IS A BYTE COPY OF THE REAL TREE, MUTATED. Not a
// hand-written toy catalogue and not a hand-written toy config: the subjects are
// `catalog/apps.json`, `catalog/apps-landing.json`,
// `services/platform/src/app-config-data.json` and
// `apps/subscriptiontracker/store/android-play/long-description.txt` exactly as they are on
// disk. `assert-seams-wired.mjs` shipped with its caller check matching the
// function's own declaration and ALL SIX of its hand-written fixtures passed
// against the broken version; only breaking the real repository exposed it. A
// fixture you wrote encodes the same misunderstanding as the guard you wrote.
//
// ⚠️ AND EVERY MUTATION ASSERTS ITS OWN ANCHOR WAS FOUND. `edit()` throws when
// the text it is asked to replace is absent, so a mutation that drifted out of
// the tree FAILS LOUDLY instead of quietly testing nothing — which is the shape
// that lets a suite go on passing over a subject that moved.
//
// ── WHAT THE SUITE IS FOR, STATED SO IT CAN BE CHECKED ───────────────────────
// The payload is a published contract between two repositories, and it has two
// distinct failure modes, both silent:
//
//   STALE   — a price or a store listing changed and nobody republished. The
//             file still parses and still renders a complete-looking page.
//   SOURCE  — someone put `amount_minor` in it. Two copies of a price is how a
//             landing page comes to advertise one number while checkout charges
//             another.
//
// The guard has seven independent limbs against those, and this file's job is to
// prove each one is LOAD-BEARING rather than decorative. 🔴 THAT CLAIM WAS
// MEASURED, NOT ASSERTED: on 2026-08-18 each limb was neutered in the REAL guard
// (`if (…) {` -> `if (false) {`, `node --check`ed first) and this whole suite
// re-run. The number of tests that went red:
//
//   the guard gutted (exits 0 immediately)                   30 red
//   limb I (drift) off                                        2 red
//   limb E (own arithmetic) off                               2 red
//   limb D (leak check) off                                   2 red
//   limb H (canary) + the offerings-compared floor off         1 red
//   the publisher's rail-absent refusal off                    1 red
//
// Re-measured the same way on 2026-09-22 for the three limbs added that day,
// each neutered on its own and this suite re-run:
//
//   limb J (one currency per app) off                          1 red
//   limb K (no price figure in prose) off                      2 red
//   limb L (no trial on a term that never renews) off          1 red
//
// Limb K's two are the pair that matter: the `_readme` case and the SERVED COPY
// case. A limb that only read the readme would leave the second green, so the
// count is what says the walk reaches every string rather than one array.
//
// 🔴 THE FIRST RUN OF THAT MATRIX FOUND A HOLE, AND IT IS WHY TWO OF THE CASES
// BELOW MUTATE THE TOOLING INSTEAD OF THE DATA. With limb D neutered, only ONE
// test went red — every hand-edited-payload case was still being caught by the
// drift limb, because adding a field changes the bytes. A data fixture cannot
// isolate an independent limb from the drift limb, EVER: drift catches every
// data mutation by construction. So the two cases marked "A PUBLISHER THAT …"
// copy the real executables into a temp tree and break the PUBLISHER, which is
// the one shape where the payload is exactly what a fresh publish produces and
// still wrong.
//
// An earlier attempt EXCISED limb D wholesale and the guard died with
// `ReferenceError: rail is not defined` — the `rail` parse lives inside that
// block. A crash looks exactly like a caught mutation, which is why `refuses()`
// below fails on a stack trace and why every mutant is `node --check`ed.
//
// 🔴 LIMB E IS NOT ALLOWED TO IMPORT THE PUBLISHER'S FORMATTER, and the test for
// that is case "a hand-edited price with the config untouched". If someone ever
// re-points limb E at `commerceFor()`, both sides of the comparison come from
// one formatter and that case goes green — which is precisely what
// `assert-discovery-surface.mjs` limb G records happening to its own first
// version, printing `ok — 2 rendered price(s) equal what the config declares`
// over a page quoting $6.99 against a config saying 599.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spiedRun, racyOn, pathKey } from './fixtures/fs-spy-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-render-payload.mjs');
const PUBLISHER = join(REPO, 'tooling', 'sites', 'generate-landing-payload.mjs');

const REL = {
  catalogue: 'catalog/apps.json',
  payload: 'catalog/apps-landing.json',
  rail: 'services/platform/src/app-config-data.json',
  lede: 'apps/subscriptiontracker/store/android-play/long-description.txt',
};

/** The real bytes. Read once, per subject, so every fixture below starts from
 *  what actually ships. */
const real = (rel) => readFileSync(join(REPO, ...rel.split('/')), 'utf8');

/** 🔴 A MUTATION THAT FINDS NO ANCHOR IS A TEST THAT ASSERTS NOTHING. */
function edit(text, from, to) {
  if (!text.includes(from)) {
    throw new Error(`fixture anchor not found: ${JSON.stringify(from)} — the real tree moved under this test`);
  }
  return text.split(from).join(to);
}

const BOM = '﻿';

/**
 * A tree carrying byte copies of the four real subjects, with any of them
 * replaced or omitted. `undefined` keeps the real bytes; `null` omits the file.
 */
function tree(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renderpayload-'));
  mkdirSync(join(root, 'catalog'), { recursive: true });
  mkdirSync(join(root, 'services', 'platform', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'subscriptiontracker', 'store', 'android-play'), { recursive: true });
  for (const [key, rel] of Object.entries(REL)) {
    const value = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : real(rel);
    if (value === null) continue;
    writeFileSync(join(root, ...rel.split('/')), value);
  }
  return root;
}

/**
 * The transitive closure a copied guard needs to run: the entry points below and
 * every LOCAL module they reach, directly or indirectly.
 *
 * 🔴 DERIVED, NOT LISTED — changed 2026-09-09, and the list it replaces recorded
 * its own reason. It was hand-maintained, and its comment noted that it had
 * already fallen behind TWICE: once when the shared-chrome splice added
 * `chrome.mjs`, once when [ADR 075] added `apex.mjs`. Both times the mutation
 * cases went red with ERR_MODULE_NOT_FOUND instead of the finding they exist to
 * prove. It fell behind a THIRD time on the change that brought this comment in,
 * when generate-discovery.mjs began importing `availability.mjs` to render the
 * register row — and a note saying "this list is hand-maintained and it DID fall
 * behind" is a description of a defect, not a defence against it.
 *
 * A closure IS computable from the source, so it is computed. The walk follows
 * only RELATIVE specifiers: a bare specifier is a package, which the fixture root
 * resolves through the real node_modules, and 'node:' builtins need no copy. The
 * hand-written list held 6 files; the derived one holds 12, so half the closure
 * was missing and only did not bite because nothing had yet imported through the
 * gap in a way these cases exercise.
 *
 * ⚠️ IT REFUSES ON A MISSING FILE rather than skipping it. A specifier that does
 * not resolve means the walk has stopped early, and a closure that quietly stops
 * early is exactly the failure this replaces — the fixture would be built, the
 * mutation applied, and the case would report a module-resolution error while
 * appearing to test a smaller tree.
 *
 * Copying the EXECUTABLES rather than pointing the real ones at a fixture root is
 * what moves `import.meta.url` with them — the same reason
 * assert-guards-refuse-empty.mjs copies its subjects instead of arguing with them
 * (twenty guards sailed past an empty root and re-scanned the real repository
 * when it did not).
 */
const CLOSURE_ENTRIES = [
  'tooling/ci/assert-render-payload.mjs',
  'tooling/sites/generate-landing-payload.mjs',
  'tooling/sites/generate-discovery.mjs',
];

/** Every relative `from '…'` specifier in one module's source. */
const LOCAL_IMPORT = /(?:^|\n)\s*(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]/g;

function toolingClosure(entries) {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const abs = join(REPO, ...rel.split('/'));
    if (!existsSync(abs)) {
      throw new Error(
        `the tooling closure reaches ${rel}, which does not exist. The walk has stopped early, so any ` +
          'fixture built from it would be missing modules and every mutation case would report a ' +
          'module-resolution error instead of the finding it exists to prove.',
      );
    }
    const src = readFileSync(abs, 'utf8');
    LOCAL_IMPORT.lastIndex = 0;
    for (const m of src.matchAll(LOCAL_IMPORT)) {
      visit(relative(REPO, resolve(dirname(abs), m[1])).split(sep).join('/'));
    }
  };
  for (const e of entries) visit(e);
  return [...seen].sort();
}

const TOOLING_CLOSURE = toolingClosure(CLOSURE_ENTRIES);

/**
 * 🔴 A TREE WHERE THE TOOLING ITSELF IS MUTATED, NOT THE DATA.
 *
 * Every data mutation in this file is caught by the drift limb on its own, so
 * none of them can tell whether the independent limbs do any work. A tree whose
 * PUBLISHER is wrong is the case that separates them: the payload then equals a
 * fresh publish exactly, drift is satisfied, and only the guard's own reading of
 * the rail config is left. `mutate(rel, text)` returns the bytes to write.
 */
function brokenToolingTree(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'brokentooling-'));
  // Derived from the closure, not listed: a new module in a new directory is
  // copied without anybody remembering to add its `mkdir` here.
  for (const rel of TOOLING_CLOSURE) mkdirSync(join(root, dirname(rel)), { recursive: true });
  mkdirSync(join(root, 'catalog'), { recursive: true });
  mkdirSync(join(root, 'services', 'platform', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'subscriptiontracker', 'store', 'android-play'), { recursive: true });
  for (const rel of [REL.catalogue, REL.rail, REL.lede]) {
    writeFileSync(join(root, ...rel.split('/')), real(rel));
  }
  for (const rel of TOOLING_CLOSURE) {
    writeFileSync(join(root, ...rel.split('/')), mutate(rel, real(rel)));
  }
  return root;
}

/* Never through a pipe, and never `$?` beside a command substitution: this
   corpus has had a failing command read as exit 0 three times that way. */
function run(script, root, ...args) {
  const r = spawnSync(process.execPath, [script, root, ...args], { encoding: 'utf8' });
  return { code: r.status === null ? 2 : r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
const guard = (root) => run(GUARD, root);
const publish = (root, ...args) => run(PUBLISHER, root, ...args);

/** Parse the real payload fresh each time so a mutation cannot leak between
 *  cases through a shared object. */
const payloadRows = () => JSON.parse(real(REL.payload));
const asPayload = (rows) => `${JSON.stringify(rows, null, 2)}\n`;

function withRow(mutate) {
  const rows = payloadRows();
  mutate(rows[0], rows);
  return asPayload(rows);
}

/** A failure must NAME the thing that is wrong; a guard whose message does not
 *  identify the field sends its reader back to the whole file. */
const refuses = (result, needle, why) => {
  assert.notEqual(result.code, 0, `${why} — expected a refusal, got exit 0:\n${result.out}`);
  assert.ok(
    result.out.includes(needle),
    `${why} — refused, but the message never says ${JSON.stringify(needle)}:\n${result.out}`,
  );
  assert.ok(
    !/ReferenceError|SyntaxError|TypeError:/.test(result.out),
    `${why} — this is a CRASH, not a verdict, and a crash looks exactly like a caught mutation:\n${result.out}`,
  );
};

/* ════════════════════════════════════════════════════════════════════════════ */

describe('assert-render-payload — the published projection', () => {
  test('POSITIVE CONTROL: the real repository passes', () => {
    // Without this, every negative result below is consistent with a guard that
    // can only ever say no.
    const r = guard(REPO);
    assert.equal(r.code, 0, `the real tree must pass:\n${r.out}`);
    assert.match(r.out, /ok {2}render payload/);
  });

  test('POSITIVE CONTROL: an unmutated COPY of the real tree passes', () => {
    // Proves the fixture builder itself reproduces a valid subject; if it did
    // not, every refusal below could be about the fixture rather than the
    // mutation.
    const root = tree();
    try {
      assert.equal(guard(root).code, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the payload ABSENT is COVERAGE LOST, not "nothing to check"', () => {
    const root = tree({ payload: null });
    try {
      refuses(guard(root), 'COVERAGE LOST', 'a missing payload');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an EMPTY payload is COVERAGE LOST — every per-row limb is vacuous over it', () => {
    // The one that matters most. `[]` is valid JSON, is an array, and satisfies
    // every per-row assertion because there are no rows to violate them.
    const root = tree({ payload: '[]\n' });
    try {
      refuses(guard(root), 'COVERAGE LOST', 'an empty payload');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('COVERAGE LOST exits 2 — not 1, which is a finding, and not a killed process', () => {
    // O-COVERAGE-LOST-BRANCH-UNTESTED: the two cases above accept any non-zero,
    // so switching coverageLost's exit code changed nothing they could see. The
    // RAW status is read here, because `run` maps a null status to 2.
    for (const [why, overrides] of [
      ['a missing payload', { payload: null }],
      ['an empty payload', { payload: '[]\n' }],
      ['an unparseable rail config', { rail: '{ not json\n' }],
    ]) {
      const root = tree(overrides);
      try {
        const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
        const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        assert.equal(r.status, 2, `${why} — expected exit 2 (COVERAGE LOST), got ${r.status}:\n${out}`);
        assert.match(out, /COVERAGE LOST/, `${why} — exit 2 without the COVERAGE LOST line`);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });

  test('an OBJECT MAP keyed by slug is refused — the storefront rejects it at the door', () => {
    const root = tree({ payload: `${JSON.stringify({ subscriptiontracker: payloadRows()[0] }, null, 2)}\n` });
    try {
      refuses(guard(root), 'must be a JSON ARRAY', 'an object map');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a BOM is refused — JSON.parse throws on it and the discovery is in another repo', () => {
    const root = tree({ payload: BOM + real(REL.payload) });
    try {
      refuses(guard(root), 'BOM', 'a BOM');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('STALE after the PRICE SOURCE moves — refuses NAMING the field', () => {
    const root = tree({ rail: edit(real(REL.rail), '"amount_minor": 599', '"amount_minor": 699') });
    try {
      const r = guard(root);
      refuses(r, 'offerings[0].amount', 'a price change nobody republished');
      assert.ok(r.out.includes('STALE'), `it must say the payload is stale:\n${r.out}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('STALE after the STORE LISTING moves — refuses naming the lede', () => {
    // ⚠️ THE ANCHOR IS THE LISTING'S OWN FIRST WORDS, read here rather than
    // typed. It was the brand as a literal until the 2026-09-09 rename, at which
    // point `edit()` threw "fixture anchor not found" — which is the helper
    // working, and is why it throws instead of returning the text unchanged.
    const opening = real(REL.lede).split(/\s+/).slice(0, 3).join(' ');
    const root = tree({ lede: edit(real(REL.lede), opening, `${opening} now`) });
    try {
      refuses(guard(root), 'lede[0]', 'a store listing change nobody republished');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('🔴 A HAND-EDITED PRICE with the config UNTOUCHED — limb E, on its own arithmetic', () => {
    // This is the case that proves limb E does not import the publisher's
    // formatter. If it ever does, both sides of the comparison agree with each
    // other about a wrong answer and this goes green.
    // ⚠️ THE MUTANT MOVED ON 2026-09-09 AND HAD TO. It was `$5.99`, chosen
    // because the config declared 499 and so `$5.99` was a number no honest
    // publish could produce. The owner's price decision made 599 the real
    // monthly price, which turned this mutant into the CORRECT answer and the
    // case into one that could only ever pass. `$6.99` restores the property:
    // one step away from what the config declares, in the same shape.
    const root = tree({ payload: withRow((row) => { row.offerings[0].amount = '$6.99'; }) });
    try {
      const r = guard(root);
      refuses(r, 'MONEY DEFECT', 'a page quoting a price the config does not declare');
      assert.ok(r.out.includes('amount_minor 599'), `it must quote the config's own number:\n${r.out}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('🔴 amount_minor "next to the id, so the guard can check it" is REFUSED', () => {
    const root = tree({
      payload: withRow((row) => { row.offerings[0].amount_minor = 499; }),
      // republished so the drift limb cannot be what catches it
      rail: real(REL.rail),
    });
    try {
      refuses(guard(root), 'amount_minor', 'the price rule leaking through the id');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the forbidden-key set is DERIVED — a config field invented today cannot leak today', () => {
    // A hand list only forbids what somebody remembered to add. Invent a field
    // in the config, copy it into the payload, and the guard must object without
    // ever having heard of it.
    const rail = JSON.parse(real(REL.rail));
    rail.apps.subscriptiontracker.paywall.settlement_account = 'acct_live_x';
    const root = tree({
      rail: `${JSON.stringify(rail, null, 2)}\n`,
      payload: withRow((row) => { row.settlement_account = 'acct_live_x'; }),
    });
    try {
      refuses(guard(root), 'settlement_account', 'a brand-new config key copied into the payload');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a NUMBER under a new name is refused too — a price is made of numbers', () => {
    const root = tree({ payload: withRow((row) => { row.offerings[0].cents = 499; }) });
    try {
      refuses(guard(root), 'is the number 499', 'minor units smuggled under an unrelated key');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('🔴 THE EMPTY-SUBJECT TRAP: offerings gone from the payload AND the config', () => {
    // Both sides agree that nothing is for sale. Every comparison limb passes
    // over the empty list exactly as it passes over a correct one. Only the
    // anchor to a literal — REQUIRED_PRICED_ROWS — can refuse this.
    const rail = JSON.parse(real(REL.rail));
    rail.apps.subscriptiontracker.paywall.offerings = [];
    const root = tree({
      rail: `${JSON.stringify(rail, null, 2)}\n`,
      payload: withRow((row) => { delete row.offerings; delete row.currencies; delete row.zeroAmount; }),
    });
    try {
      refuses(guard(root), 'REQUIRED_PRICED_ROWS', 'a payload and a config that lost their prices together');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an INVENTED lede paragraph is refused — public copy needs a reviewed source', () => {
    const root = tree({
      payload: withRow((row) => { row.lede[0] = 'Subly is the best app anyone has ever made.'; }),
    });
    try {
      refuses(guard(root), 'does not appear in', 'a paragraph written straight into the payload');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a lede with NO store listing on disk is refused', () => {
    const root = tree({ lede: null });
    try {
      refuses(guard(root), 'no store listing exists', 'copy whose source is gone');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a MISSING lede while the listing exists is refused — the silent-shortening failure', () => {
    const root = tree({ payload: withRow((row) => { delete row.lede; }) });
    try {
      refuses(guard(root), 'carries no "lede"', 'a payload that dropped the About block');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a RAW CONFIG FLAG NAME as a feature title is refused', () => {
    const root = tree({ payload: withRow((row) => { row.features[0].title = 'renewals'; }) });
    try {
      refuses(guard(root), 'raw config flag name', 'an internal switch name on a public page');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a DROPPED feature is refused — the count is derivable without the wording', () => {
    const root = tree({ payload: withRow((row) => { row.features.pop(); }) });
    try {
      refuses(guard(root), 'feature(s) and services/platform', 'a shorter "What you get" list');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a FLAG MAP arriving under the permitted name `features` is refused', () => {
    const root = tree({ payload: withRow((row) => { row.features = { renewals: true }; }) });
    try {
      refuses(guard(root), 'a map here is the flags leaking', 'the config shape under a shared key name');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a SLUG-SET mismatch is refused in both directions', () => {
    const root = tree({ payload: withRow((row) => { row.slug = 'nope'; }) });
    try {
      const r = guard(root);
      refuses(r, 'carries no row for subscriptiontracker', 'a payload row that stopped matching the catalogue');
      assert.ok(r.out.includes('nope'), `the extra row must be named too:\n${r.out}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a flipped checkoutOpen is refused — the page prints a sentence off it', () => {
    const root = tree({ payload: withRow((row) => { row.checkoutOpen = true; }) });
    try {
      refuses(guard(root), 'paywall.enabled', 'a switch state that disagrees with the rail');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a MISSING checkoutOpen is refused — absent and false must not be the same thing', () => {
    const root = tree({ payload: withRow((row) => { delete row.checkoutOpen; }) });
    try {
      refuses(guard(root), 'checkoutOpen', 'an unanswered question about the paywall');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a wrong trial length is refused — a trial on a public page is a term of sale', () => {
    const root = tree({ payload: withRow((row) => { row.offerings[0].trialDays = 90; }) });
    try {
      refuses(guard(root), '90-day trial', 'a trial the config never granted');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('two billing periods under ONE heading are refused', () => {
    const root = tree({ payload: withRow((row) => { row.offerings[1].termHeading = 'Monthly'; }) });
    try {
      refuses(guard(root), 'BOTH render as', 'a price list a buyer cannot read correctly');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a unit that its own renewal sentence never mentions is refused', () => {
    const root = tree({ payload: withRow((row) => { row.offerings[0].termUnit = 'week'; }) });
    try {
      refuses(guard(root), 'does not mention it', 'a "$X / week" over a promise about months');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a wrong zeroAmount is refused — it is the Free card price', () => {
    const root = tree({ payload: withRow((row) => { row.zeroAmount = 'Free'; }) });
    try {
      refuses(guard(root), 'zeroAmount', 'a Free card that stopped quoting a currency');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a wrong currency list is refused', () => {
    const root = tree({ payload: withRow((row) => { row.currencies = ['INR']; }) });
    try {
      refuses(guard(root), 'currencies', 'a page telling readers the wrong currency');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // ── limbs J, K and L (2026-09-22, ADR 093) ────────────────────────────────
  // Each data case below PUBLISHES before it judges, so the payload is exactly
  // what its sources produce: the drift limb (I) and the arithmetic (E) both
  // agree with the mutation, and the limb under test is the only thing left to
  // refuse it. Without the publish, drift would catch every one of them and the
  // case would prove nothing about the new limb (the hole the header records).
  // Every amount here is a FIXTURE number, not a price anybody decided.

  /** The real config, parsed fresh, handed over with its one app's offerings. */
  const railWith = (mutate) => {
    const rail = JSON.parse(real(REL.rail));
    mutate(rail, rail.apps.subscriptiontracker.paywall.offerings);
    return `${JSON.stringify(rail, null, 2)}\n`;
  };

  test('🔴 A SECOND CURRENCY is refused even when every other limb agrees with it — limb J', () => {
    // Measured on main 2026-09-22 BEFORE this limb: a rupee offering added and
    // both generators run passed every guard, and the pricing page printed rupee
    // and dollar plans side by side over one Free card priced in dollars.
    const root = tree({
      payload: null,
      rail: railWith((_, offerings) => {
        offerings.push({ product_id: 'fixture_in', amount_minor: 12300, currency_code: 'INR', term: 'month', trial_days: 0 });
      }),
    });
    try {
      const p = publish(root);
      assert.equal(p.code, 0, `the publisher must accept the mixed list, or this case tests the publisher:\n${p.out}`);
      refuses(guard(root), 'O-WEB-INR-PRICE-BOOK', 'two currencies in one app’s book');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('limb J counts CURRENCIES, not offerings — a fourth offering in the same currency passes', () => {
    const root = tree({
      payload: null,
      rail: railWith((_, offerings) => {
        offerings.push({ product_id: 'fixture_usd', amount_minor: 12300, currency_code: 'USD', term: 'month', trial_days: 0 });
      }),
    });
    try {
      const p = publish(root);
      assert.equal(p.code, 0, p.out);
      const r = guard(root);
      assert.equal(r.code, 0, `four offerings in one currency are one book:\n${r.out}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('🔴 A PRICE FIGURE IN THE CONFIG’S PROSE is refused — limb K', () => {
    // Measured 2026-09-22: eleven `_readme` strings carried a figure, one of them
    // a regional price the owner had since changed, and nothing read any of them.
    // The payload is untouched by `_readme`, so drift cannot see these at all.
    const cases = [
      ['Rs1,234/yr', 'Rs1,234'],
      ['Rs. 1234', 'Rs. 1234'],
      ['$9.99', '$9.99'],
      ['₹100', '₹100'],
      ['12.30 USD', '12.30 USD'],
      ['EUR 5', 'EUR 5'],
      ['£4', '£4'],
    ];
    for (const [figure, hit] of cases) {
      const root = tree({ rail: railWith((rail) => { rail._readme.push(`The fixture plan costs ${figure}.`); }) });
      try {
        const r = guard(root);
        refuses(r, '_readme[', `a price figure (${figure}) written into prose`);
        assert.ok(r.out.includes(JSON.stringify(hit)), `the message must quote the figure ${JSON.stringify(hit)}:\n${r.out}`);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });

  test('limb K reaches EVERY string in the config — a served copy line quoting a price is refused', () => {
    const root = tree({
      rail: railWith((rail) => { rail.apps.subscriptiontracker.copy = { fixture_line: 'Go Pro for $9.99' }; }),
    });
    try {
      refuses(guard(root), 'apps.subscriptiontracker.copy.fixture_line', 'a price in served copy');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('limb K is NARROW — numbers that are not prices pass', () => {
    // Each of these is in the real corpus's prose today or was on 2026-09-22.
    const prose = ['ADR 093 §2 and §5', 'Rule 35', 'GST at 18%', 'a 30-day trial', 'USD only', 'INR', 'v1', '1.0.0'];
    const root = tree({ rail: railWith((rail) => { rail._readme.push(...prose); }) });
    try {
      const r = guard(root);
      assert.equal(r.code, 0, `prose with no price figure must pass:\n${r.out}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('🔴 A TRIAL ON A ONE-TIME OFFERING is refused — limb L', () => {
    // Until 2026-09-22 the one-time offering carried `trial_days: 30`, and the
    // pricing page promised a 30-day trial on a purchase that never renews.
    const root = tree({
      payload: null,
      rail: railWith((_, offerings) => {
        const once = offerings.find((o) => o.term === 'one_time');
        if (!once) throw new Error('fixture anchor not found: no one_time offering — the real tree moved under this test');
        once.trial_days = 30;
      }),
    });
    try {
      const p = publish(root);
      assert.equal(p.code, 0, p.out);
      refuses(guard(root), 'no recurring term', 'a trial on a purchase that never renews');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('🔴 A KEY-ORDER-ONLY change is refused — limb I, and nothing else, sees it', () => {
    // Structurally identical, different bytes. This is what makes the drift limb
    // load-bearing rather than a tautology beside limbs D–H: deleting limb I
    // makes exactly this case go green (measured 2026-08-18).
    const root = tree({
      payload: withRow((row, rows) => {
        const { checkoutOpen, ...rest } = row;
        rows[0] = { checkoutOpen, ...rest };
      }),
    });
    try {
      refuses(guard(root), 'catalog/apps-landing.json', 'a hand-reordered payload');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an unparseable rail config is COVERAGE LOST, never a quiet skip', () => {
    const root = tree({ rail: '{ "apps": { "subscriptiontracker": ' });
    try {
      refuses(guard(root), 'COVERAGE LOST', 'the price source becoming unreadable');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('🔴 A PUBLISHER THAT LEAKS A SOURCE FIELD IS CAUGHT — limb D, with limb I agreeing', () => {
    // The companion to the case below, and it exists because of a measured gap:
    // with limb D's forbidden-key check neutered, EVERY data-mutation case above
    // still went red — the drift limb caught them all, because a hand-added field
    // changes the bytes. So none of them was testing limb D.
    //
    // A leak that arrives through the PUBLISHER is the shape that separates them.
    // `currency_code` is deliberate: it is a rail key AND a string, so the
    // numeric rule cannot be what catches it, leaving only the derived
    // forbidden-key set. This is how "amount_minor, next to the id, so the guard
    // can check it" would actually arrive — in a publisher change with a good
    // reason attached, and republished, so nothing about the file looks stale.
    const t = brokenToolingTree((rel, text) =>
      rel === 'tooling/sites/generate-landing-payload.mjs'
        ? edit(text, '        id: o.id,\n', '        id: o.id,\n        currency_code: o.code,\n')
        : text,
    );
    try {
      const published = run(join(t, 'tooling', 'sites', 'generate-landing-payload.mjs'), t);
      assert.equal(published.code, 0, `the leaking publisher must still PUBLISH — that is the danger:\n${published.out}`);
      const wrote = readFileSync(join(t, ...REL.payload.split('/')), 'utf8');
      assert.ok(wrote.includes('"currency_code"'), `the mutation must actually reach the payload:\n${wrote}`);

      const r = run(join(t, 'tooling', 'ci', 'assert-render-payload.mjs'), t);
      refuses(r, 'currency_code', 'a source field published on purpose');
      assert.ok(
        r.out.includes('is a key of'),
        `it must say WHY — that the name belongs to the config's vocabulary:\n${r.out}`,
      );
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  test('🔴 A BROKEN PUBLISHER IS CAUGHT — the drift limb agrees with it, limb E does not', () => {
    // THE LIMB-G LESSON, ENCODED RATHER THAN WRITTEN DOWN.
    //
    // Every other case here mutates the DATA, and the drift limb catches those
    // on its own — so none of them can tell whether limb E is doing any work. The
    // case that separates them is a publisher that is itself wrong: the payload
    // then equals a fresh publish exactly, limb I is satisfied, and the only
    // thing left between a wrong number and a public page is limb E's own
    // arithmetic.
    //
    // So the TOOLING is mutated, not the fixture: a copy of the real guard, the
    // real publisher and the real renderer, with `money()`'s division broken so
    // 599 renders as $6.99. Republished through the broken copy, then checked by
    // the copied guard. It must FAIL, and it must name the config's own 599.
    const t = brokenToolingTree((rel, text) =>
      rel === 'tooling/sites/generate-discovery.mjs'
        ? edit(
            text,
            'const amount = (amountMinor / 100).toFixed(2);',
            'const amount = ((amountMinor + 100) / 100).toFixed(2);',
          )
        : text,
    );
    try {
      const published = run(join(t, 'tooling', 'sites', 'generate-landing-payload.mjs'), t);
      assert.equal(published.code, 0, `the broken publisher must still PUBLISH — that is the danger:\n${published.out}`);
      const wrote = readFileSync(join(t, ...REL.payload.split('/')), 'utf8');
      assert.ok(wrote.includes('$6.99'), `the mutation must actually reach the price:\n${wrote}`);

      const r = run(join(t, 'tooling', 'ci', 'assert-render-payload.mjs'), t);
      refuses(r, 'MONEY DEFECT', 'a payload that is exactly what a WRONG publisher produces');
      assert.ok(r.out.includes('amount_minor 599'), `the config's own number must be quoted:\n${r.out}`);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });
});

/* ════════════════════════════════════════════════════════════════════════════ */

describe('generate-landing-payload — the publisher', () => {
  test('writes the payload without a separate look at its path first (CodeQL #88)', () => {
    const root = tree({ payload: null });
    try {
      const { code, text, verdict } = spiedRun([PUBLISHER, root], { under: root });
      assert.equal(code, 0, text);
      const payload = '/' + REL.payload;
      assert.ok(verdict.uses.some((u) => u.endsWith(pathKey(payload))), 'the payload was never written');
      assert.deepEqual(racyOn(verdict, payload), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('POSITIVE CONTROL: the real sources reproduce the committed payload byte for byte', () => {
    const root = tree({ payload: null });
    try {
      const r = publish(root);
      assert.equal(r.code, 0, `the real sources must publish cleanly:\n${r.out}`);
      const got = readFileSync(join(root, ...REL.payload.split('/')));
      const committed = readFileSync(join(REPO, ...REL.payload.split('/')));
      assert.ok(
        got.equals(committed),
        `the published payload must be byte-identical to the committed one — got ${got.length} bytes, ` +
          `committed ${committed.length}`,
      );
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('IDEMPOTENT: two runs produce identical bytes', () => {
    // A drift check over an unstable generator fails at random and gets switched
    // off within a week, taking the real protection with it.
    const root = tree({ payload: null });
    try {
      assert.equal(publish(root).code, 0);
      const first = readFileSync(join(root, ...REL.payload.split('/')));
      assert.equal(publish(root).code, 0);
      const second = readFileSync(join(root, ...REL.payload.split('/')));
      assert.ok(first.equals(second), 'the publisher must be byte-stable across runs');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('it never writes a BOM', () => {
    const root = tree({ payload: null });
    try {
      assert.equal(publish(root).code, 0);
      const bytes = readFileSync(join(root, ...REL.payload.split('/')));
      assert.notEqual(bytes[0], 0xef, 'a BOM in front of a JSON array makes JSON.parse throw');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('🔴 THE RAIL CONFIG ABSENT REFUSES — it must not publish a price-free payload', () => {
    // readRailConfig() answers null for a missing file BY DESIGN, which is right
    // for a renderer and wrong for the publisher OF the price projection. This
    // is the exact silent degradation the payload exists to close: measured
    // 2026-08-18, the renderer in a tree without this file produces subscriptiontracker.html
    // at 7,782 bytes against 9,789 committed, with `problems: []`.
    const root = tree({ payload: null, rail: null });
    try {
      const r = publish(root);
      refuses(r, 'ONE place a price lives', 'a tree with no rail config');
      assert.ok(!existsSync(join(root, ...REL.payload.split('/'))), 'refusing means writing nothing');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the catalogue ABSENT refuses and writes nothing', () => {
    const root = tree({ payload: null, catalogue: null });
    try {
      const r = publish(root);
      refuses(r, 'does not exist', 'a tree with no catalogue');
      assert.ok(!existsSync(join(root, ...REL.payload.split('/'))), 'refusing means writing nothing');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an EMPTY catalogue refuses — it would blank every landing page at once', () => {
    const root = tree({ payload: null, catalogue: '[]\n' });
    try {
      refuses(publish(root), 'zero rows', 'an empty catalogue');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a MALFORMED catalogue refuses — no partial payload', () => {
    const root = tree({ payload: null, catalogue: '[ { "slug": "subscriptiontracker", ' });
    try {
      refuses(publish(root), 'not valid JSON', 'an unparseable catalogue');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('DUPLICATE slugs refuse', () => {
    const rows = JSON.parse(real(REL.catalogue));
    const root = tree({ payload: null, catalogue: `${JSON.stringify([...rows, rows[0]], null, 2)}\n` });
    try {
      refuses(publish(root), 'more than once', 'two rows claiming one slug');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a BOM on the CATALOGUE refuses', () => {
    const root = tree({ payload: null, catalogue: BOM + real(REL.catalogue) });
    try {
      refuses(publish(root), 'BOM', 'a BOM on the input');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a BOM on the RAIL CONFIG refuses', () => {
    const root = tree({ payload: null, rail: BOM + real(REL.rail) });
    try {
      refuses(publish(root), 'BOM', 'a BOM on the price source');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a BOM on the STORE LISTING refuses — it would reach a public page invisibly', () => {
    const root = tree({ payload: null, lede: BOM + real(REL.lede) });
    try {
      refuses(publish(root), 'BOM', 'a BOM on the copy');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an UNNAMED feature flag refuses rather than title-casing a switch onto a page', () => {
    const rail = JSON.parse(real(REL.rail));
    rail.apps.subscriptiontracker.features.reminders_v2 = true;
    const root = tree({ payload: null, rail: `${JSON.stringify(rail, null, 2)}\n` });
    try {
      refuses(publish(root), 'reminders_v2', 'a flag with no reader-facing name');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an offering with no currency refuses — there is no best-effort branch for a price', () => {
    const rail = JSON.parse(real(REL.rail));
    delete rail.apps.subscriptiontracker.paywall.offerings[0].currency_code;
    const root = tree({ payload: null, rail: `${JSON.stringify(rail, null, 2)}\n` });
    try {
      refuses(publish(root), 'will not put a price on', 'an offering the factory cannot price');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('--check is GREEN on an unmutated tree', () => {
    const root = tree();
    try {
      const r = publish(root, '--check');
      assert.equal(r.code, 0, `--check must pass on a current payload:\n${r.out}`);
      assert.match(r.out, /^ok {2}catalog\/apps-landing\.json matches its sources/m);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('--check goes RED on drift and WRITES NOTHING', () => {
    const root = tree({ rail: edit(real(REL.rail), '"amount_minor": 599', '"amount_minor": 699') });
    const before = real(REL.payload);
    try {
      refuses(publish(root, '--check'), 'DRIFTED', 'a source that moved without a republish');
      assert.equal(
        readFileSync(join(root, ...REL.payload.split('/')), 'utf8'),
        before,
        '--check must never write; it is the read-only half of the contract',
      );
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('--check goes RED on a BOM it did not write', () => {
    const root = tree({ payload: BOM + real(REL.payload) });
    try {
      refuses(publish(root, '--check'), 'BOM', 'a payload something else rewrote');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a BOM on the payload is REPAIRED by a plain run', () => {
    const root = tree({ payload: BOM + real(REL.payload) });
    try {
      const r = publish(root);
      assert.equal(r.code, 0, `a plain run must fix it:\n${r.out}`);
      const bytes = readFileSync(join(root, ...REL.payload.split('/')));
      assert.notEqual(bytes[0], 0xef, 'the repaired payload must carry no BOM');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
