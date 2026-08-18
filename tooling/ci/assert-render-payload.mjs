#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-render-payload.mjs — the published render payload
// (`catalog/apps-landing.json`) must be a CURRENT projection of its sources, and
// must not have become a second copy of them.
//
// The payload is written by `tooling/sites/generate-landing-payload.mjs` and
// exists so a repository that holds the sites but NOT the rail config can still
// reproduce `sites/nikatru/apps/<slug>.html` byte for byte. That makes it a
// published contract between two repositories, and two different things can go
// wrong with it — each silent, each with a different shape:
//
//   1. IT GOES STALE. Someone changes a price, or a store listing, and does not
//      regenerate. The payload still parses, still renders a complete-looking
//      page, and every byte comparison downstream keeps agreeing with it —
//      because they all compare against the stale file. The landing page then
//      advertises one number while checkout charges another, which is the exact
//      defect `generate-discovery.mjs` was written to prevent.
//
//   2. IT BECOMES A SECOND SOURCE. Someone adds `amount_minor` "next to the id,
//      so the guard can check it". That is two copies of a price arriving with a
//      good reason attached. `services/platform/src/app-config-data.json` is THE
//      ONE PLACE A PRICE LIVES; the payload carries the RENDERED projection
//      (`"$4.99"`) precisely so a consumer cannot disagree with the config about
//      499, having never seen 499.
//
// ── 🔴 WHY THIS GUARD DOES ITS OWN ARITHMETIC ────────────────────────────────
// The drift limb (I, last) re-runs the generator and diffs. On its own that is a
// tautology dressed as a check: it proves the file equals what the generator
// produces, and says nothing about whether the generator projects the config
// correctly. `assert-discovery-surface.mjs` limb G records what that costs — its
// FIRST version imported `commerceFor()` and printed
//
//     ok — 2 rendered price(s) equal what the config declares
//
// over a page quoting $5.99 against a config saying 499, because both sides of
// the comparison came from the same formatter.
//
// So limbs D–H below PARSE `app-config-data.json` and divide by 100 THEMSELVES,
// with their own symbol table, and never import the publisher's. Limb I is the
// currency check; limbs D–H are the correctness check. Deleting either leaves a
// guard that still prints ok over the defect the other one catches — and both
// deletions are exercised as recorded failing cases in
// `tooling/ci/test/render-payload.test.mjs`.
//
// ── WHAT IT DELIBERATELY DOES NOT DUPLICATE ──────────────────────────────────
// The term VOCABULARY ("Monthly", "Renews every month until you cancel.") is NOT
// copied here. A second copy of three sentences would have to be edited in
// lockstep with `TERM_NAMES`, by hand, and the copy is exactly as likely to be
// wrong as the original. Limb F checks the property that does not need the
// words: the term fields must be a FUNCTION of the config's `term` value —
// same term ⇒ same rendering everywhere, different terms ⇒ different headings,
// and a non-null unit must appear inside its own renewal sentence. That catches
// a yearly offering rendered as monthly without this file knowing what "yearly"
// is called.
//
// Usage:  node tooling/ci/assert-render-payload.mjs [repoRoot]
// Exit:   0 = the payload is current, complete, and carries no pricing source
//         1 = stale · absent · empty · BOM · a leaked source field · a rendered
//             price that is not what the config declares
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planLandingPayload } from '../sites/generate-landing-payload.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const PAYLOAD = 'catalog/apps-landing.json';
const CATALOGUE = 'catalog/apps.json';
const RAIL_CONFIG = 'services/platform/src/app-config-data.json';

/** 🔴 A GUARD THAT PASSES OVER AN EMPTY OR ABSENT SUBJECT HAS CHECKED NOTHING.
 *  These three files ARE the subject: with the payload unread every limb is
 *  vacuous, with the catalogue unread the slug-set identity is, and with the
 *  rail config unread the independent arithmetic is — and that last one is the
 *  only limb standing between a rendered price and the number a stranger is
 *  actually charged. */
const REQUIRED_COVERAGE = [PAYLOAD, CATALOGUE, RAIL_CONFIG];

/** Slugs whose payload row MUST carry at least one priced offering.
 *
 *  Without this, the empty-subject trap is open BY CONSTRUCTION: a payload whose
 *  `offerings` vanished, published from a config whose `offerings` also
 *  vanished, satisfies every comparison limb below — they would compare two
 *  empty lists and agree — and renders a landing page with no prices at all.
 *  This is the one place the chain needs an anchor to a literal rather than to
 *  another file. Same construction, and the same reason, as
 *  `REQUIRED_PRICED_LANDINGS` in assert-discovery-surface.mjs.
 *
 *  Adding an app here is a decision about that app being sold; removing one
 *  requires saying so out loud, which is the intended cost. */
const REQUIRED_PRICED_ROWS = ['subly'];

/** This guard's OWN currency table — deliberately not imported. See the header:
 *  a comparison whose two sides share a formatter agrees with itself about a
 *  wrong answer. Only the codes this repository actually carries are mapped;
 *  an unmapped code renders as `CODE 4.99`, matching the documented fallback. */
const SYMBOLS = new Map([
  ['USD', '$'],
  ['INR', '₹'],
]);

/** The four terms whose vocabulary this guard does NOT hold. Listed only so an
 *  offering carrying a term nobody has decided a rendering for FAILS here rather
 *  than being compared against whatever the publisher happened to emit. */
const KNOWN_TERMS = new Set(['month', 'year', 'one_time']);

/** UTF-8 BOM. `JSON.parse` throws on a leading one, so a BOM'd payload is
 *  unreadable to every consumer — and the place it would surface is a storefront
 *  build in another repository, after the bytes had already been vendored.
 *  PowerShell 5.1 writes one from `Out-File -Encoding utf8`, which is how this
 *  repository has shipped a BOM before. */
const BOM = '﻿';

/** Payload keys that legitimately share a NAME with a rail-config key, with the
 *  reason. Everything else in the config's key vocabulary is forbidden in the
 *  payload — see limb D, where the forbidden set is DERIVED from the config
 *  rather than typed, so a new config field cannot leak silently. */
const SHARED_KEY_NAMES = new Map([
  [
    'features',
    'names the same concept on both sides but carries the opposite shape: the config holds a FLAG MAP ({"renewals": true}), the payload holds an ARRAY of reader-facing {title, blurb}. Limb D asserts that difference, so a flag map arriving under this name still fails.',
  ],
  [
    'offerings',
    'names the same list on both sides, and must: `id` is the config\'s `product_id` verbatim, because `data-offering=` on the page and the thing a checkout keys on have to refer to the same product. What must NOT cross is the price — limb D forbids every numeric field except `trialDays`, which is what stops `amount_minor` arriving "next to the id".',
  ],
]);

const problems = [];
const notes = [];
const read = (rel) => readFileSync(join(ROOT, ...rel.split('/')), 'utf8');
const has = (rel) => existsSync(join(ROOT, ...rel.split('/')));

/** Structural failure — the scan itself has no subject, so nothing below it
 *  would mean anything. Exits immediately rather than joining the problem list,
 *  because a partial verdict over a missing subject is the failure this guard is
 *  named after. */
function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
}

// ── limb A · THE SUBJECT EXISTS ─────────────────────────────────────────────
for (const rel of REQUIRED_COVERAGE) {
  if (!has(rel)) {
    coverageLost([
      `${rel} does not exist under ${ROOT}.`,
      'Every limb below reads it. Absent is not "nothing to check" — it is "the thing I exist to check',
      'is gone", and the failure it hides is a landing page that silently loses its About, feature and',
      `pricing blocks. Regenerate with: node tooling/sites/generate-landing-payload.mjs`,
    ]);
  }
}

// ── limb B · NO BOM ─────────────────────────────────────────────────────────
const payloadRaw = read(PAYLOAD);
if (payloadRaw.startsWith(BOM)) {
  console.error(`✗ ${PAYLOAD} starts with a UTF-8 BOM.`);
  console.error(`  JSON.parse THROWS on a leading BOM, so this payload is unreadable to every consumer that`);
  console.error(`  vendors it — and the build that discovers this is in another repository, after the bytes`);
  console.error(`  have already been copied. The generator never writes one; something else rewrote the file.`);
  console.error(`  Rewrite it without a BOM: node tooling/sites/generate-landing-payload.mjs`);
  process.exit(1);
}

// ── limb C · SHAPE, AND THE SLUG-SET IDENTITY ───────────────────────────────
let payload;
try {
  payload = JSON.parse(payloadRaw);
} catch (e) {
  console.error(`✗ ${PAYLOAD} is not valid JSON — ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(payload)) {
  console.error(`✗ ${PAYLOAD} must be a JSON ARRAY of rows; found ${typeof payload}.`);
  console.error(`  An object keyed by slug is rejected at the storefront's door by its vendored-catalogue`);
  console.error(`  reader, which requires a non-empty array of objects each with a unique string "slug".`);
  process.exit(1);
}
if (payload.length === 0) {
  coverageLost([
    `${PAYLOAD} contains zero rows.`,
    'An empty array is valid JSON, is an array, and satisfies every per-row assertion below VACUOUSLY,',
    'because there are no rows to violate them. It would print ok while the payload described no app at',
    'all — and the pages built from it would lose their About, feature and pricing blocks in silence.',
  ]);
}

let catalogue;
try {
  catalogue = JSON.parse(read(CATALOGUE));
} catch (e) {
  coverageLost([`${CATALOGUE} could not be parsed (${e.message}); the slug-set identity below reads it.`]);
}
if (!Array.isArray(catalogue) || catalogue.length === 0) {
  coverageLost([`${CATALOGUE} is not a non-empty array; the slug-set identity below reads it.`]);
}

const bySlug = new Map();
payload.forEach((row, i) => {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    problems.push(`${PAYLOAD}[${i}] is not an object.`);
    return;
  }
  if (typeof row.slug !== 'string' || row.slug.trim() === '') {
    problems.push(`${PAYLOAD}[${i}] has no non-empty string "slug".`);
    return;
  }
  if (bySlug.has(row.slug)) problems.push(`${PAYLOAD} carries slug "${row.slug}" more than once.`);
  bySlug.set(row.slug, row);
  if (typeof row.checkoutOpen !== 'boolean') {
    problems.push(
      `${PAYLOAD}[${i}] (${row.slug}) has no boolean "checkoutOpen". It selects which of two sentences the ` +
        `renderer prints, so an ABSENT key and false must not be the same thing to a consumer.`,
    );
  }
});
if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) in ${PAYLOAD}:`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

const catalogueSlugs = catalogue.map((r) => r?.slug).filter((s) => typeof s === 'string' && s !== '');
const missing = catalogueSlugs.filter((s) => !bySlug.has(s));
const extra = [...bySlug.keys()].filter((s) => !catalogueSlugs.includes(s));
if (missing.length) {
  problems.push(
    `${PAYLOAD} carries no row for ${missing.join(', ')}, which ${CATALOGUE} lists. A slug with no row ` +
      `renders a landing page with no About, no features and no prices, and nothing else fails.`,
  );
}
if (extra.length) {
  problems.push(
    `${PAYLOAD} carries row(s) for ${extra.join(', ')}, which ${CATALOGUE} does not list. A payload row for ` +
      `an app the catalogue dropped is data nobody renders, and a price nobody can see is a price nobody ` +
      `re-checks.`,
  );
}

// ── limb D · NO PRICING SOURCE CROSSED THE LINE ─────────────────────────────
// 🔴 THE FORBIDDEN SET IS DERIVED FROM THE CONFIG, NEVER TYPED. A hand list only
// ever forbids what somebody remembered to add, so a NEW config field would be
// free to leak on the day it was introduced — which is exactly when nobody is
// looking for it.
let rail;
try {
  rail = JSON.parse(read(RAIL_CONFIG));
} catch (e) {
  coverageLost([
    `${RAIL_CONFIG} could not be parsed (${e.message}).`,
    'It is the ONE place a price lives, and both the leak check and the independent arithmetic below',
    'read it. Unparseable means every rendered price goes unchecked while this guard prints ok.',
  ]);
}

const collectKeys = (v, into) => {
  if (Array.isArray(v)) return v.forEach((el) => collectKeys(el, into));
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      into.add(k);
      collectKeys(val, into);
    }
  }
  return into;
};

// ⚠️ THE COLLECTOR'S OWN CANARY IS SYNTHETIC, AND THAT IS THE WHOLE POINT.
// The first version of this check asserted the REAL config yields `amount_minor`
// — which conflates "the walker stopped descending" with "this config declares
// no offerings today". Emptying `paywall.offerings` in the real tree made it cry
// COVERAGE LOST about a walk that was working perfectly, and, worse, it would
// have MASKED the canary in limb H that is supposed to catch exactly that. A
// self-test on a fixture answers the question that is actually being asked —
// does this function still descend through objects AND arrays — and it cannot be
// switched off by the contents of the file under test.
{
  const probe = collectKeys({ apps: { x: { paywall: { offerings: [{ amount_minor: 1 }] } } } }, new Set());
  if (!probe.has('amount_minor') || !probe.has('offerings')) {
    coverageLost([
      'the rail-config key walk no longer descends through nested objects and arrays.',
      'The forbidden-key set below is DERIVED from that walk, so an under-reaching walk forbids nothing',
      'and this limb would print ok over a payload that had copied the whole config verbatim.',
    ]);
  }
}

const railKeys = collectKeys(rail, new Set());
// A structural floor on the real file, separate from the canary above: this
// config always declares `apps` and `defaults`, whatever any app is selling.
if (!railKeys.has('apps') || !railKeys.has('defaults') || railKeys.size < 10) {
  coverageLost([
    `${RAIL_CONFIG} yielded ${railKeys.size} key(s) and is missing "apps"/"defaults".`,
    'That is not a config this guard can derive a forbidden-key set from, so every leak check below',
    'would range over a near-empty vocabulary and forbid almost nothing.',
  ]);
}

const forbiddenKeys = new Set([...railKeys].filter((k) => !SHARED_KEY_NAMES.has(k)));
/** The only numeric leaf the payload is allowed to carry. Everything a price is
 *  made of is a number, so "no numbers except this one" forbids `amount_minor`
 *  under ANY key name — including a key name nobody has thought of yet. */
const NUMERIC_FIELDS = new Set(['trialDays']);

for (const [slug, row] of bySlug) {
  (function walkRow(v, path) {
    if (Array.isArray(v)) return v.forEach((el, i) => walkRow(el, `${path}[${i}]`));
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (forbiddenKeys.has(k)) {
          problems.push(
            `${PAYLOAD} ${path}.${k} — "${k}" is a key of ${RAIL_CONFIG}, and the payload publishes the ` +
              `PROJECTION of that file, never a copy of it. Two copies of a price is how a landing page ` +
              `comes to advertise one number while checkout charges another.`,
          );
        }
        walkRow(val, `${path}.${k}`);
      }
      return;
    }
    if (typeof v === 'number') {
      const field = path.slice(path.lastIndexOf('.') + 1);
      if (!NUMERIC_FIELDS.has(field)) {
        problems.push(
          `${PAYLOAD} ${path} is the number ${v}. The only numeric field the payload may carry is ` +
            `${[...NUMERIC_FIELDS].join(', ')}; a price crosses this boundary RENDERED ("$4.99"), never as ` +
            `minor units, so that a consumer cannot disagree with ${RAIL_CONFIG} about a number it never saw.`,
        );
      }
    }
  })(row, slug);

  // The shape half of the two shared names: a flag map arriving as `features` is
  // the raw config leaking under a permitted key.
  if (row.features !== undefined) {
    if (!Array.isArray(row.features)) {
      problems.push(
        `${PAYLOAD} ${slug}.features is ${Array.isArray(row.features) ? 'an array' : typeof row.features}, ` +
          `not an array. The config's \`features\` is a FLAG MAP; the payload's is an array of ` +
          `reader-facing {title, blurb}. Same name, opposite shape — a map here is the flags leaking.`,
      );
    } else {
      row.features.forEach((f, i) => {
        if (!f || typeof f !== 'object' || typeof f.title !== 'string' || typeof f.blurb !== 'string') {
          problems.push(`${PAYLOAD} ${slug}.features[${i}] must be an object with string title and blurb.`);
          return;
        }
        if (f.title.trim() === '' || f.blurb.trim() === '') {
          problems.push(`${PAYLOAD} ${slug}.features[${i}] has an empty title or blurb.`);
        }
      });
    }
  }
}

// ── limb E · THE INDEPENDENT ARITHMETIC ─────────────────────────────────────
// Own parse, own division by 100, own symbol table. This is the only limb that
// can tell a correct projection from a self-consistent wrong one.
const money = (minor, code) => {
  const symbol = SYMBOLS.get(code);
  const amount = (minor / 100).toFixed(2);
  return symbol ? `${symbol}${amount}` : `${code} ${amount}`;
};
const zeroOf = (code) => {
  const symbol = SYMBOLS.get(code);
  return symbol ? `${symbol}0` : `${code} 0`;
};

let offeringsCompared = 0;
let featuresCompared = 0;
const termRenderings = new Map(); // config term id -> the payload triple, seen once
const headingOwners = new Map(); // payload heading -> the config term id that claimed it

for (const slug of catalogueSlugs) {
  const row = bySlug.get(slug);
  if (!row) continue; // already reported by limb C
  const entry = rail.apps && typeof rail.apps === 'object' ? rail.apps[slug] : undefined;
  const defaults = rail.defaults ?? {};
  const flags = entry?.features ?? defaults.features ?? {};
  const paywall = entry?.paywall ?? defaults.paywall ?? {};
  const declared = Array.isArray(paywall.offerings) ? paywall.offerings : [];

  // checkoutOpen is `paywall.enabled` with no transform — the one field where
  // projection and source coincide. It is a SWITCH STATE, not a term of sale:
  // nothing charges from it, it only selects which sentence the renderer prints.
  const expectedOpen = paywall.enabled === true;
  if (row.checkoutOpen !== expectedOpen) {
    problems.push(
      `${slug}.checkoutOpen is ${row.checkoutOpen} and ${RAIL_CONFIG} apps.${slug}.paywall.enabled is ` +
        `${expectedOpen}. The page prints "paid checkout is not open yet" off this field.`,
    );
  }

  // features: the COUNT is derivable without knowing the wording, and a title
  // that IS a raw flag name means an internal switch name reached a public page.
  const enabled = Object.entries(flags)
    .filter(([, on]) => on === true)
    .map(([flag]) => flag);
  const rowFeatures = Array.isArray(row.features) ? row.features : [];
  if (rowFeatures.length !== enabled.length) {
    problems.push(
      `${slug} carries ${rowFeatures.length} feature(s) and ${RAIL_CONFIG} enables ${enabled.length} ` +
        `(${enabled.join(', ') || 'none'}). A payload that quietly loses one renders a shorter "What you ` +
        `get" list and nothing else fails.`,
    );
  }
  for (const f of rowFeatures) {
    if (typeof f?.title === 'string' && enabled.includes(f.title)) {
      problems.push(
        `${slug} feature title "${f.title}" IS the raw config flag name. The flag is an internal switch; ` +
          `printing it describes the product in words nobody chose.`,
      );
    }
  }
  featuresCompared += rowFeatures.length;

  // offerings: order, id, and the rendered amount, all against the config.
  const rowOfferings = Array.isArray(row.offerings) ? row.offerings : [];
  if (rowOfferings.length !== declared.length) {
    problems.push(
      `${slug} carries ${rowOfferings.length} offering(s) and ${RAIL_CONFIG} declares ${declared.length}. ` +
        `A dropped offering is a plan the landing page stops selling while checkout still sells it.`,
    );
  }
  declared.forEach((o, i) => {
    const got = rowOfferings[i];
    if (!got) return; // count mismatch already reported
    if (
      typeof o?.product_id !== 'string' ||
      o.product_id === '' ||
      typeof o?.currency_code !== 'string' ||
      o.currency_code === '' ||
      !Number.isInteger(o?.amount_minor) ||
      o.amount_minor < 0 ||
      !KNOWN_TERMS.has(o?.term)
    ) {
      problems.push(
        `${RAIL_CONFIG} apps.${slug}.paywall.offerings[${i}] is not a projectable offering ` +
          `(${JSON.stringify({ product_id: o?.product_id, amount_minor: o?.amount_minor, currency_code: o?.currency_code, term: o?.term })}). ` +
          `It needs a non-empty product_id and currency_code, an integer amount_minor >= 0, and a term among ` +
          `${[...KNOWN_TERMS].join(', ')}.`,
      );
      return;
    }
    if (got.id !== o.product_id) {
      problems.push(
        `${slug}.offerings[${i}].id is ${JSON.stringify(got.id)} and the config's product_id is ` +
          `${JSON.stringify(o.product_id)}. That string is what \`data-offering=\` on the page and the ` +
          `checkout both key on; they must refer to the same product.`,
      );
    }
    const expected = money(o.amount_minor, o.currency_code);
    if (got.amount !== expected) {
      problems.push(
        `${slug}.offerings[${i}] (${o.product_id}) renders ${JSON.stringify(got.amount)} and ` +
          `${RAIL_CONFIG} declares amount_minor ${o.amount_minor} ${o.currency_code}, which is ` +
          `${JSON.stringify(expected)}. THIS IS THE MONEY DEFECT: the page would quote one number and the ` +
          `charge would be another.`,
      );
    }
    const expectedTrial = Number.isInteger(o.trial_days) && o.trial_days > 0 ? o.trial_days : 0;
    if (got.trialDays !== expectedTrial) {
      problems.push(
        `${slug}.offerings[${i}] (${o.product_id}) advertises a ${got.trialDays}-day trial and the config ` +
          `declares ${expectedTrial}. A trial length on a public page is a term of sale.`,
      );
    }
    // limb F, folded in where the pairing is available: the term fields must be
    // a FUNCTION of the config's term id. No vocabulary is copied here.
    const triple = JSON.stringify([got.termHeading, got.termUnit, got.termRenews]);
    const first = termRenderings.get(o.term);
    if (first === undefined) termRenderings.set(o.term, { triple, where: `${slug}.offerings[${i}]` });
    else if (first.triple !== triple) {
      problems.push(
        `term "${o.term}" renders as ${triple} at ${slug}.offerings[${i}] and as ${first.triple} at ` +
          `${first.where}. The same billing period must render the same way everywhere, or one of the two ` +
          `pages is mislabelling what a buyer is signing up for.`,
      );
    }
    if (typeof got.termHeading !== 'string' || got.termHeading.trim() === '') {
      problems.push(`${slug}.offerings[${i}] has no non-empty termHeading.`);
    } else {
      // The other half of "the term fields are a FUNCTION of the config's term
      // id": the mapping must be INJECTIVE. Two billing periods sharing one
      // heading is a page offering a reader "Monthly" twice at two prices, and
      // no amount of per-offering checking notices it, because each offering is
      // individually correct.
      const owner = headingOwners.get(got.termHeading);
      if (owner === undefined) headingOwners.set(got.termHeading, { term: o.term, where: `${slug}.offerings[${i}]` });
      else if (owner.term !== o.term) {
        problems.push(
          `terms "${o.term}" (at ${slug}.offerings[${i}]) and "${owner.term}" (at ${owner.where}) BOTH render ` +
            `as ${JSON.stringify(got.termHeading)}. Two different billing periods under one heading is a ` +
            `price list a buyer cannot read correctly.`,
        );
      }
    }
    if (typeof got.termRenews !== 'string' || got.termRenews.trim() === '') {
      problems.push(`${slug}.offerings[${i}] has no non-empty termRenews.`);
    } else if (typeof got.termUnit === 'string' && got.termUnit !== '' && !got.termRenews.includes(got.termUnit)) {
      problems.push(
        `${slug}.offerings[${i}] renders the unit ${JSON.stringify(got.termUnit)} beside the price and the ` +
          `sentence ${JSON.stringify(got.termRenews)}, which does not mention it. The page would read ` +
          `"$X / ${got.termUnit}" over a renewal promise about something else.`,
      );
    } else if (got.termUnit !== null && typeof got.termUnit !== 'string') {
      problems.push(`${slug}.offerings[${i}].termUnit must be a string or null; found ${typeof got.termUnit}.`);
    }
    offeringsCompared++;
  });

  // currencies + zeroAmount: the payload exists so a consumer holds NO currency
  // knowledge at all, which makes these two the whole of what it knows.
  if (rowOfferings.length) {
    const expectedCurrencies = [...new Set(declared.map((o) => o?.currency_code))];
    if (JSON.stringify(row.currencies) !== JSON.stringify(expectedCurrencies)) {
      problems.push(
        `${slug}.currencies is ${JSON.stringify(row.currencies)} and the config's offerings use ` +
          `${JSON.stringify(expectedCurrencies)}. The page prints "Prices are shown in <these>".`,
      );
    }
    const expectedZero = zeroOf(declared[0]?.currency_code);
    if (row.zeroAmount !== expectedZero) {
      problems.push(
        `${slug}.zeroAmount is ${JSON.stringify(row.zeroAmount)} and zero in the first offering's currency ` +
          `(${declared[0]?.currency_code}) is ${JSON.stringify(expectedZero)}. It is the Free card's price.`,
      );
    }
  }

  // ── limb G · THE LEDE IS THE APP'S OWN PUBLISHED WORDS ────────────────────
  // Verified against the store listing on disk, not against the publisher. An
  // invented paragraph and a stale one look identical in the payload.
  const channels = ['android-play', 'ios-appstore', 'linux-snap', 'macos-appstore', 'windows-store'];
  let listing = null;
  for (const channel of channels) {
    const rel = `apps/${slug}/store/${channel}/long-description.txt`;
    if (has(rel)) {
      listing = { rel, text: read(rel).replace(/\s+/g, ' ').trim() };
      break;
    }
  }
  if (listing === null) {
    if (row.lede !== undefined) {
      problems.push(
        `${slug} carries a "lede" and no store listing exists under apps/${slug}/store/*/long-description.txt. ` +
          `The About paragraphs are the app's PUBLISHED words, reused rather than rewritten; copy with no ` +
          `source is copy nobody reviewed.`,
      );
    }
    notes.push(`${slug} — no store listing on disk, so no About lede is owed.`);
  } else if (!Array.isArray(row.lede) || row.lede.length === 0) {
    problems.push(
      `${slug} carries no "lede" and ${listing.rel} exists. The About block would be empty on a page whose ` +
        `copy is sitting in the repository — the silent-shortening failure this payload exists to close.`,
    );
  } else {
    row.lede.forEach((p, i) => {
      if (typeof p !== 'string' || p.trim() === '') {
        problems.push(`${slug}.lede[${i}] is not a non-empty string.`);
        return;
      }
      if (!listing.text.includes(p.replace(/\s+/g, ' ').trim())) {
        problems.push(
          `${slug}.lede[${i}] does not appear in ${listing.rel}. Either the listing changed and the payload ` +
            `was not regenerated, or the paragraph was written straight into the payload — and a public ` +
            `page's opening words would then have no reviewed source.`,
        );
      }
    });
  }
}

// ── limb H · THE CANARY ─────────────────────────────────────────────────────
// 🔴 EMPTYING THE LIST IS NOT A WAY TO PASS. Deleting the anchor deletes the one
// limb that does not depend on another file, so it is refused here rather than
// silently honoured — the same reason a waiver that outlives its reason fails in
// assert-guards-refuse-empty.mjs.
if (REQUIRED_PRICED_ROWS.length === 0) {
  coverageLost([
    'REQUIRED_PRICED_ROWS is empty, so no row is required to carry a price.',
    'Every comparison limb above passes over an empty offerings list exactly as it passes over a correct',
    'one — payload and config agreeing that nothing is for sale is agreement, not correctness. This list',
    'is the anchor to a literal that stops the price checks going vacuous together with their subject.',
  ]);
}
for (const slug of REQUIRED_PRICED_ROWS) {
  const row = bySlug.get(slug);
  if (!row) {
    problems.push(
      `${slug} is named in REQUIRED_PRICED_ROWS and has no row in ${PAYLOAD}. Either it is still sold — in ` +
        `which case the payload lost it — or it is not, in which case say so by editing that list.`,
    );
    continue;
  }
  const priced = Array.isArray(row.offerings) && row.offerings.some((o) => typeof o?.amount === 'string' && o.amount);
  if (!priced) {
    problems.push(
      `${slug} carries no priced offering, and it is named in REQUIRED_PRICED_ROWS. Every comparison limb ` +
        `above would pass over an empty list exactly as it passes over a correct one — this is the anchor ` +
        `that stops the price checks going vacuous together with the thing they check.`,
    );
  }
}

// ── limb I · CURRENCY · re-run the publisher and diff ───────────────────────
// A stale payload parses, renders and satisfies nothing above it if the SOURCE
// moved and the file did not. This limb is the only one that reads the store
// listings' full text and the whole config in the publisher's own terms — and on
// its own it is a tautology, which is why limbs D–H exist. Reported by FIELD,
// because "1378 bytes vs 1381" does not tell anyone what changed.
const regenerated = planLandingPayload(ROOT);
if (regenerated.problems.length) {
  console.error(`✗ the payload's sources no longer produce a payload at all:`);
  for (const p of regenerated.problems) console.error(`    ${p}`);
  process.exit(1);
}
if (regenerated.contents !== payloadRaw) {
  const fresh = JSON.parse(regenerated.contents);
  const freshBySlug = new Map(fresh.map((r) => [r.slug, r]));
  const drifted = [];
  const compare = (a, b, path) => {
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    if (ja === jb) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
      for (const k of keys) compare(a[k], b[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`);
      return;
    }
    drifted.push(`${path}: committed ${ja ?? 'absent'} · regenerated ${jb ?? 'absent'}`);
  };
  for (const slug of new Set([...bySlug.keys(), ...freshBySlug.keys()])) {
    compare(bySlug.get(slug), freshBySlug.get(slug), slug);
  }
  problems.push(
    `${PAYLOAD} is STALE — it is not what its sources produce today. ${drifted.length} field(s) differ:`,
  );
  for (const d of drifted.slice(0, 20)) problems.push(`      ${d}`);
  if (drifted.length > 20) problems.push(`      … and ${drifted.length - 20} more`);
  if (drifted.length === 0) {
    problems.push(
      `      the parsed rows are equal but the BYTES are not (${Buffer.byteLength(payloadRaw)} committed · ` +
        `${Buffer.byteLength(regenerated.contents)} regenerated) — formatting or key order changed.`,
    );
  }
  problems.push(`      Regenerate: node tooling/sites/generate-landing-payload.mjs`);
}

// ── verdict ────────────────────────────────────────────────────────────────
// Reported as a PROBLEM and not as an early exit, deliberately: when the
// offerings vanish from both sides at once, limb H's message is the one that
// says which app stopped being priced, and an early exit here would print this
// sentence INSTEAD of that one — hiding the more useful half of the same finding.
if (offeringsCompared === 0) {
  problems.push(
    'COVERAGE LOST — not one offering was compared against the rail config. Every price limb above ranged ' +
      'over an empty set, so a clean result would be a result from a check that checked nothing.',
  );
}

for (const n of notes) console.log(`   ⬜ ${n}`);

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) with ${PAYLOAD}:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error(`  ${PAYLOAD} is the render payload the storefront vendors to reproduce the landing pages.`);
  console.error(`  It is GENERATED from ${CATALOGUE}, ${RAIL_CONFIG} and the store listings — never hand-kept.`);
  process.exit(1);
}

console.log(
  `ok  render payload — ${payload.length} row(s) ≡ ${CATALOGUE}; ${offeringsCompared} offering(s) and ` +
    `${featuresCompared} feature(s) re-derived from ${RAIL_CONFIG} by this guard's own arithmetic; ` +
    `${forbiddenKeys.size} config key(s) forbidden in the payload and none present; ` +
    `${REQUIRED_PRICED_ROWS.length} required priced row(s) priced; bytes equal a fresh run of ` +
    `tooling/sites/generate-landing-payload.mjs`,
);
