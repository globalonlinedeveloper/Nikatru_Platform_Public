#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-catalog-contract.mjs — catalog/apps.json is the PUBLISHED catalogue,
// so its shape is a contract, not a convention.
//
// WHY THIS EXISTS AT ALL. Until the catalogue inversion the app list lived in
// `sites/_shared/_data/apps.json`, hand-kept, and the only thing that ever
// checked its shape was whatever happened to read it next — Eleventy rendering
// a card, a Worker inlining it at build time, a release script looking up a
// slug. Each of those reads a DIFFERENT subset of the fields, so a row missing
// `tagline` broke the website while every guard stayed green, and a row missing
// `api` broke the CORS allowlist while the website rendered perfectly. There
// was no single place that said what a catalogue row IS.
//
// Now there is one. `catalog/apps.json` is written by the stamp
// (tooling/bricks/app/hooks/post_gen.dart) and `sites/_shared/_data/apps.json`
// is GENERATED from it, which means a malformed row no longer breaks one
// consumer — it propagates to every consumer at once, including the public
// website. That is precisely when a shape needs a guard rather than a habit.
//
// ── THE COVERAGE FLOOR IS THE POINT, NOT A DETAIL ────────────────────────────
// 🔴 A GUARD THAT PASSES OVER AN EMPTY OR ABSENT SUBJECT HAS CHECKED NOTHING,
// and this repository has paid for that lesson more times than any other:
// `check-migrations.mjs` silently dropped from 5 files to 4 and reported PASS.
// The failure mode here is exact and cheap to reach — an empty array `[]` is
// valid JSON, is an array, and satisfies every per-row assertion below
// vacuously, because there are no rows to violate them. It would print `ok`
// while the catalogue advertised nothing at all.
//
// So zero rows REFUSES, and it refuses as COVERAGE LOST rather than as a
// content failure, because "the catalogue is empty" is a statement about this
// guard's domain having disappeared, not about a row being wrong. Same for the
// file being absent: absent is not "nothing to check", it is "the thing I
// exist to check is gone".
//
// ── WHY THE PLATFORM VOCABULARY IS DERIVED, NEVER TYPED HERE ─────────────────
// The obvious implementation hard-codes `['web','android','ios','macos',
// 'windows','linux']`. That would be a SECOND declaration of which platforms
// this factory publishes to, free to drift from the first
// (tooling/channel-register.json) in the one direction that reports clean: this
// guard would keep accepting a platform the factory no longer ships, or start
// rejecting one it just added. The register already answers "what platforms
// does this factory serve" for the signing seams and the release lanes, so it
// answers it here too.
//
// If the register cannot be read, the platform limb is NOT quietly skipped —
// it is COVERAGE LOST. A vocabulary check against an empty vocabulary accepts
// everything while looking like it accepted nothing untoward.
//
// ── `listings` — [ADR 055]'s DATA HALF, AND WHY IT IS DERIVED TWICE OVER ─────
// [ADR 055] (LOCKED 2026-08-18) gives a product exactly ONE indexable page and
// makes every store a LINK on it. Every URL that decision locks — the product
// page's buttons, the `/<store>/apps` collection pages, the `/get/<store>/<slug>`
// redirect targets — reads ONE catalogue field: `listings`, an object keyed by
// storefront with a URL where a listing exists and `null` where it does not.
// `catalog/extensions.json` in the sibling extension factory already ships that
// exact shape (`{"chrome":null,"edge":null,"firefox":null}`); this is the apps
// catalogue catching up, and nothing about the URL shape ships with it.
//
// THE KEY SET IS NOT TYPED HERE, for the reason the platform vocabulary is not:
// it is the non-null `storefrontKey` values in tooling/channel-register.json,
// which is already the one declaration of what this factory releases to.
// tooling/bricks/app/hooks/post_gen.dart derives the block it PUBLISHES from the
// same field, so producer and grader cannot disagree about which stores exist —
// and the day a store is added, it is a row in the register and nothing else.
// A register that yields no storefront keys is COVERAGE LOST, not an empty
// vocabulary quietly accepting every key including nonsense.
//
// 🔴 `listings.web` AND `url` ARE THE SAME FACT WRITTEN TWICE, so this file
// CHECKS THEM. They have to be two fields — `url` is the card link every
// existing consumer already reads, `listings.web` is what [ADR 055]'s renderer
// enumerates alongside the stores — but two spellings of one URL is exactly the
// pair that drifts, and drifts silently, because each side has a reader that
// never sees the other. A non-null `listings.web` that is not byte-equal to
// `url` fails.
//
// And a non-null listing is a PROMISE: it says a stranger can install this app
// from that storefront. So a listing is only accepted when the row also declares
// a platform that storefront's channel serves — the same rule
// tooling/ci/assert-channel-claims.mjs enforces on the sites, applied to the
// catalogue that feeds them. `null` is always legal; it is the honest state for
// every store this factory is not yet on, and it is the state of all five today.
//
// ── WHAT IS DELIBERATELY *NOT* REQUIRED ──────────────────────────────────────
// `markets` and `audience`: post_gen writes both on every stamp, but the one
// row in the catalogue today (subly) predates them and carries neither.
// Requiring them would fail the real repository on day one — an assertion whose
// only effect is to be switched off. They are printed in the summary instead,
// so their absence is visible without being fatal.
//
// `api` is required to be PRESENT but is allowed to be EMPTY. That is not
// laxity: post_gen.dart writes `''` deliberately for a client-only app, because
// such an app has no API host of its own and publishing `api-<app>.nikatru.com`
// would advertise a hostname that never resolves ([ADR 020]). An empty string
// is the declaration "this app calls the shared platform Worker"; a MISSING key
// is an unanswered question, and those are different.
//
// Usage:  node tooling/ci/assert-catalog-contract.mjs [repoRoot]
// Exit:   0 = the catalogue parses, is non-empty, and every row is complete
//         1 = absent · unparseable · not an array · empty · a malformed row
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? process.cwd());

const CATALOGUE = 'catalog/apps.json';
const REGISTER = 'tooling/channel-register.json';

/** A scanner needs a test that it is still scanning what it thinks. These two
 *  files ARE the subject: with the catalogue unread every per-row limb is
 *  vacuously true, and with the register unread the platform limb is. */
const REQUIRED_COVERAGE = [CATALOGUE, REGISTER];

/** The slug shape is pre_gen.dart's `app_id` rule (`^[a-z][a-z0-9_]*$`), not a
 *  new invention. A catalogue slug IS the app id — it is what every store
 *  identity, every subdomain and every directory name is derived from — so a
 *  slug the stamper could never have produced means the row was hand-written,
 *  which is the case this guard is most useful against. */
const SLUG = /^[a-z][a-z0-9_]*$/;

/** `preview` is what post_gen writes as a constant; `live` is the promotion an
 *  owner makes once the surface actually answers. assert-catalog-reachable.mjs
 *  treats exactly these two as meaningful — `live` is binding, `preview` is
 *  skipped — so a third spelling would be silently skipped by that guard while
 *  looking deliberate here. */
const STATUS = ['live', 'preview'];

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

function done() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-catalog-contract: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  console.log('✓ assert-catalog-contract: the published catalogue is complete and singly shaped.');
  process.exit(0);
}

// ── COVERAGE, BEFORE ANY CONTENT CLAIM ───────────────────────────────────────
const rawCatalogue = read(CATALOGUE);
if (rawCatalogue === null) {
  coverageLost(
    `there is no catalogue at ${CATALOGUE}. This is the published record of what this factory ships — ` +
      `absent is not "nothing to check", it is the subject being gone, and every assertion below would ` +
      `pass over it in silence.`,
  );
  done();
}

let catalogue;
try {
  catalogue = JSON.parse(rawCatalogue);
} catch (e) {
  fail(`${CATALOGUE} is not valid JSON (${e.message}). Every consumer parses this file; none of them can.`);
  done();
}

if (!Array.isArray(catalogue)) {
  fail(
    `${CATALOGUE} is a ${catalogue === null ? 'null' : typeof catalogue}, not a JSON array. The stamp ` +
      `appends to an array and every reader iterates one; any other top-level shape means no consumer ` +
      `sees any app at all.`,
  );
  done();
}

// 🔴 THE COVERAGE FLOOR. `[]` parses, is an array, and satisfies every per-row
// check below because there are no rows. This is the single cheapest way for
// this guard to stop checking while still printing ok.
if (catalogue.length === 0) {
  coverageLost(
    `${CATALOGUE} holds zero rows. An empty catalogue satisfies every per-row assertion in this file ` +
      `vacuously, so passing here would mean this guard had checked nothing while reporting success — ` +
      `and it would mean the website advertises no apps.`,
  );
  done();
}

// ── THE PLATFORM VOCABULARY, AND THE STOREFRONT ONE, BOTH DERIVED ────────────
const rawRegister = read(REGISTER);
let vocabulary = null;
/** storefront key -> the channel that owns it, in the register's ROW ORDER.
 *  Null (not an empty map) until derivation succeeds, so that "no vocabulary"
 *  and "a vocabulary containing nothing" cannot be confused by the limb below. */
let storefronts = null;
if (rawRegister === null) {
  coverageLost(
    `${REGISTER} is missing, so the platform vocabulary cannot be derived. Checking each row's ` +
      `\`platforms\` against an empty set would accept every value including nonsense, which reads ` +
      `exactly like a clean run.`,
  );
} else {
  try {
    const register = JSON.parse(rawRegister);
    const channels = Array.isArray(register?.channels) ? register.channels : [];
    const seen = new Set();
    for (const c of channels) {
      for (const p of Array.isArray(c?.platforms) ? c.platforms : []) {
        if (typeof p === 'string' && p.trim() !== '') seen.add(p);
      }
    }
    if (seen.size === 0) {
      coverageLost(
        `${REGISTER} yielded no platforms, so the vocabulary is empty and the platform limb below would ` +
          `accept anything. The register's channels are the one declaration of what this factory ships to.`,
      );
    } else {
      vocabulary = seen;
      notes.push(`platform vocabulary derived from ${REGISTER}: ${[...seen].sort().join(', ')}`);
    }

    // ── the storefront vocabulary [ADR 055] ─────────────────────────────────
    // A channel row must ANSWER the question. A string is "this is the key"; an
    // explicit null is "this channel is not a storefront a listing can point
    // at" (the two self-distribution rows). A MISSING key is neither, and
    // treating it as "not a storefront" would let a new store join the register
    // and silently never appear in `listings` — the shrink this repo pays for.
    const unanswered = [];
    const byKey = new Map();
    const duplicated = [];
    for (const c of channels) {
      const id = typeof c?.id === 'string' ? c.id : '(unnamed)';
      if (!Object.hasOwn(c ?? {}, 'storefrontKey')) {
        unanswered.push(id);
        continue;
      }
      const k = c.storefrontKey;
      if (k === null) continue;
      if (typeof k !== 'string' || k.trim() === '') {
        problems.push(
          `${REGISTER} channel "${id}" has a \`storefrontKey\` of ${JSON.stringify(k)} — it must be a ` +
            `non-empty string, or null to declare "not a storefront".`,
        );
        continue;
      }
      if (byKey.has(k)) duplicated.push(`${k} (channels "${byKey.get(k).id}" and "${id}")`);
      // `kind` travels with the key because the URL-equality limb below needs to
      // know WHICH storefront is our own site, and asking "is the key spelled
      // web?" would hard-code a name the register is free to change.
      else byKey.set(k, { id, kind: c.kind, platforms: Array.isArray(c.platforms) ? c.platforms : [] });
    }
    if (unanswered.length) {
      coverageLost(
        `${REGISTER} channel(s) ${unanswered.map((s) => `"${s}"`).join(', ')} carry no \`storefrontKey\` ` +
          `key at all. It is the one declaration of the \`listings\` key set [ADR 055], and a channel that ` +
          `does not answer would be read as "not a storefront" — so a store could join the register and ` +
          `never appear in the catalogue, with every limb below still reporting clean.`,
      );
    } else if (duplicated.length) {
      problems.push(
        `${REGISTER} reuses storefront key(s) ${duplicated.join('; ')}. A \`listings\` object is keyed by ` +
          `this value, so two channels sharing one key can only ever publish one listing between them.`,
      );
    } else if (byKey.size === 0) {
      coverageLost(
        `${REGISTER} yielded no storefront keys, so the \`listings\` vocabulary is empty and the limb ` +
          `below would accept any key including nonsense — and would accept a row with an EMPTY ` +
          `\`listings\` object as complete.`,
      );
    } else {
      storefronts = byKey;
      notes.push(
        `storefront vocabulary derived from ${REGISTER} (\`storefrontKey\`, register row order): ` +
          `${[...byKey.keys()].join(', ')}`,
      );
    }
  } catch (e) {
    coverageLost(`${REGISTER} is not valid JSON (${e.message}), so the platform vocabulary cannot be derived.`);
  }
}

// ── THE ROW CONTRACT ─────────────────────────────────────────────────────────
/** Each entry is (field, predicate, why-a-violation-matters). Kept as data so
 *  that the count of enforced fields is a number this file can PRINT rather
 *  than a property of how many `if` blocks somebody remembered to write. */
const STRING_FIELDS = [
  ['name', (v) => typeof v === 'string' && v.trim() !== '', 'the website renders it as the card heading, and an empty heading is a card nobody can identify'],
  ['tagline', (v) => typeof v === 'string' && v.trim() !== '', 'the website renders it under the name, and the discovery pages publish it as the app description'],
];

/** Every field a row must CARRY. Named once because the summary line printed at
 *  the end needs both the COUNT and the LIST, and those were two typings of one
 *  fact — `STRING_FIELDS.length + 5` beside a hand-written parenthesis is
 *  exactly the arithmetic that goes stale the moment a field is added, which is
 *  what happened when `listings` landed. Derived now, so it cannot. */
const REQUIRED_FIELDS = [
  'slug',
  ...STRING_FIELDS.map(([field]) => field),
  'url',
  'api',
  'listings',
  'platforms',
  'status',
];

const slugsSeen = new Map();
let rowsChecked = 0;

catalogue.forEach((row, i) => {
  const at = `${CATALOGUE}[${i}]`;
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    fail(`${at} is a ${Array.isArray(row) ? 'array' : row === null ? 'null' : typeof row}, not an object. Every reader does \`row.slug\`.`);
    return;
  }
  rowsChecked += 1;
  const label = typeof row.slug === 'string' && row.slug !== '' ? `"${row.slug}"` : `#${i}`;

  // slug — the identity the whole factory derives from.
  if (!Object.hasOwn(row, 'slug')) {
    fail(`${at} has no \`slug\`. The slug is the app id every store identity, subdomain and directory name is derived from; a row without one cannot be matched to an app at all.`);
  } else if (typeof row.slug !== 'string' || !SLUG.test(row.slug)) {
    fail(
      `${at} has slug ${JSON.stringify(row.slug)}, which is not the app-id shape ${SLUG} that ` +
        `tooling/bricks/app/hooks/pre_gen.dart enforces at stamp time. A slug the stamper could not have ` +
        `produced means this row was written by hand.`,
    );
  } else {
    const prev = slugsSeen.get(row.slug);
    if (prev !== undefined) {
      fail(
        `${at} repeats slug "${row.slug}", already used at ${CATALOGUE}[${prev}]. The stamp's ` +
          `skip-if-already-present branch exists to make that impossible, so a duplicate means the file ` +
          `was hand-edited — and consumers that index by slug silently keep whichever row they saw last.`,
      );
    } else {
      slugsSeen.set(row.slug, i);
    }
  }

  for (const [field, ok, why] of STRING_FIELDS) {
    if (!Object.hasOwn(row, field)) fail(`${at} (${label}) has no \`${field}\` — ${why}.`);
    else if (!ok(row[field])) fail(`${at} (${label}) has an empty or non-string \`${field}\` — ${why}.`);
  }

  // url — a public promise, so it must at least be an https origin.
  if (!Object.hasOwn(row, 'url')) {
    fail(`${at} (${label}) has no \`url\`. It is the link the website puts on the card; a card that links nowhere is the first thing a stranger clicks.`);
  } else if (typeof row.url !== 'string' || !/^https:\/\/[^\s/]+/.test(row.url)) {
    fail(`${at} (${label}) has url ${JSON.stringify(row.url)}, which is not an https:// origin. This file is public and every entry in it is a link somebody will follow.`);
  }

  // api — REQUIRED PRESENT, ALLOWED EMPTY. See the header.
  if (!Object.hasOwn(row, 'api')) {
    fail(
      `${at} (${label}) has no \`api\` key. Empty is a valid ANSWER — it declares "this app calls the ` +
        `shared platform Worker" — but a missing key is an unanswered question, and ` +
        `tooling/ci/assert-cors-allowlist.mjs derives the allowlist from this field.`,
    );
  } else if (typeof row.api !== 'string') {
    fail(`${at} (${label}) has a non-string \`api\` (${typeof row.api}).`);
  } else if (row.api !== '' && !/^https:\/\/[^\s/]+/.test(row.api)) {
    fail(`${at} (${label}) has a non-empty \`api\` of ${JSON.stringify(row.api)}, which is not an https:// origin.`);
  }

  // platforms — non-empty, and every value known to the register.
  if (!Object.hasOwn(row, 'platforms')) {
    fail(`${at} (${label}) has no \`platforms\`. The website renders one chip per platform and the discovery pages publish them as schema.org \`operatingSystem\`.`);
  } else if (!Array.isArray(row.platforms) || row.platforms.length === 0) {
    fail(`${at} (${label}) has an empty or non-array \`platforms\`. An app shipped to no platform is not shipped.`);
  } else {
    for (const p of row.platforms) {
      if (typeof p !== 'string' || p.trim() === '') {
        fail(`${at} (${label}) lists a non-string platform ${JSON.stringify(p)}.`);
      } else if (vocabulary && !vocabulary.has(p)) {
        fail(
          `${at} (${label}) lists platform ${JSON.stringify(p)}, which no channel in ${REGISTER} serves. ` +
            `tooling/sites/generate-discovery.mjs has no schema.org name for an unknown platform and ` +
            `refuses to publish the entry, so this fails the sites lane too.`,
        );
      }
    }
  }

  // listings — [ADR 055]'s one data field. See the header.
  if (!Object.hasOwn(row, 'listings')) {
    fail(
      `${at} (${label}) has no \`listings\`. [ADR 055] makes it the ONE field every store link on the ` +
        `product page, every \`/<store>/apps\` collection page and every \`/get/<store>/<slug>\` redirect ` +
        `reads; a row without one is a product no storefront surface can place at all. An all-null block ` +
        `is the correct value until a real listing URL exists — that is a stated absence, not a gap.`,
    );
  } else if (row.listings === null || typeof row.listings !== 'object' || Array.isArray(row.listings)) {
    fail(
      `${at} (${label}) has a \`listings\` of ${Array.isArray(row.listings) ? 'array' : row.listings === null ? 'null' : typeof row.listings} — ` +
        `it must be an OBJECT keyed by storefront. Every reader does \`row.listings[store]\`.`,
    );
  } else if (storefronts !== null) {
    const have = Object.keys(row.listings);
    const missing = [...storefronts.keys()].filter((k) => !Object.hasOwn(row.listings, k));
    const unknown = have.filter((k) => !storefronts.has(k));
    if (missing.length) {
      fail(
        `${at} (${label}) has a \`listings\` missing key(s) ${missing.map((k) => `"${k}"`).join(', ')}, ` +
          `which ${REGISTER} declares as \`storefrontKey\`. Absent and null are NOT the same answer: null ` +
          `says "we are not on that store", absent says nobody has considered it, and the collection page ` +
          `for a missing key renders from \`undefined\` without anything failing.`,
      );
    }
    if (unknown.length) {
      fail(
        `${at} (${label}) has \`listings\` key(s) ${unknown.map((k) => `"${k}"`).join(', ')}, which no ` +
          `channel in ${REGISTER} declares as its \`storefrontKey\` (${[...storefronts.keys()].join(', ')}). ` +
          `There is no collection page, no \`/get/\` route and no button for a storefront nobody named.`,
      );
    }
    for (const [key, value] of Object.entries(row.listings)) {
      const meta = storefronts.get(key);
      if (value === null) continue; // the honest "not listed there" — always legal.
      if (typeof value !== 'string' || !/^https:\/\/[^\s/]+/.test(value)) {
        fail(
          `${at} (${label}) has \`listings.${key}\` of ${JSON.stringify(value)}, which is neither null nor ` +
            `an https:// URL. Empty string is NOT the "no listing" spelling here — \`null\` is — because a ` +
            `renderer testing truthiness and one testing \`!== null\` would disagree about the same row.`,
        );
        continue;
      }
      // 🔴 the one place `url` is written twice. See the header. WHICH key that
      // is comes from the register's `kind`, not from the key being spelled
      // "web" — the key is a storefront-facing name and is free to change.
      if (meta?.kind === 'web' && typeof row.url === 'string' && value !== row.url) {
        fail(
          `${at} (${label}) has \`listings.${key}\` = ${JSON.stringify(value)} but \`url\` = ` +
            `${JSON.stringify(row.url)}. These are the SAME fact — the app's own web address — and each ` +
            `has readers that never see the other (\`url\` renders the card, \`listings\` renders ` +
            `[ADR 055]'s store row), so nothing but this check would ever notice them diverge.`,
        );
      }
      // A listing is a promise a stranger can install from that storefront.
      if (meta && Array.isArray(row.platforms)) {
        const unclaimed = meta.platforms.filter((p) => !row.platforms.includes(p));
        if (unclaimed.length) {
          fail(
            `${at} (${label}) publishes a \`listings.${key}\` URL, but the row's \`platforms\` do not ` +
              `include ${unclaimed.map((p) => `"${p}"`).join(', ')} — the platform(s) channel ` +
              `"${meta.id}" serves. A store button with nothing behind it is a promise made to a ` +
              `stranger, and it rots into a lie without anyone editing it.`,
          );
        }
      }
    }
  }

  // status — the promotion switch assert-catalog-reachable.mjs reads.
  if (!Object.hasOwn(row, 'status')) {
    fail(`${at} (${label}) has no \`status\`. tooling/ci/assert-catalog-reachable.mjs only holds \`live\` rows to their promise; a row with no status is never checked for reachability at all.`);
  } else if (!STATUS.includes(row.status)) {
    fail(
      `${at} (${label}) has status ${JSON.stringify(row.status)}; the only two the factory uses are ` +
        `${STATUS.map((s) => `"${s}"`).join(' and ')}. A third spelling is skipped by the reachability ` +
        `guard while looking deliberate here.`,
    );
  }
});

// ── THE SELF-CHECK, AND THE SUMMARY A SHRINK CANNOT HIDE IN ──────────────────
if (rowsChecked === 0) {
  coverageLost(
    `${CATALOGUE} holds ${catalogue.length} entr(ies) and not one of them was an object this guard could ` +
      `check. Every field assertion above was skipped, which is indistinguishable from a clean run.`,
  );
}

for (const rel of REQUIRED_COVERAGE) {
  if (read(rel) === null && rel !== REGISTER) {
    coverageLost(`${rel} went unread between the start of this run and its end.`);
  }
}

console.log(`published catalogue — ${catalogue.length} row(s) in ${CATALOGUE}:`);
for (const row of catalogue) {
  if (row === null || typeof row !== 'object') continue;
  const plats = Array.isArray(row.platforms) ? row.platforms.join('/') : '(none)';
  const api = typeof row.api === 'string' && row.api !== '' ? row.api : '(shared platform Worker)';
  // [ADR 055] Print the listings SPLIT, not just a count: "0 of 6 live" is the
  // number a reader needs to see shrink, and naming the live ones is how a
  // storefront link that appeared without anyone noticing becomes visible here.
  const listingEntries =
    row.listings !== null && typeof row.listings === 'object' && !Array.isArray(row.listings)
      ? Object.entries(row.listings)
      : null;
  const live = listingEntries ? listingEntries.filter(([, v]) => typeof v === 'string' && v !== '') : [];
  const listingsSummary =
    listingEntries === null
      ? 'listings=(none)'
      : `listings=${live.length}/${listingEntries.length} live${live.length ? ` [${live.map(([k]) => k).join(', ')}]` : ''}`;
  const extra = [
    listingsSummary,
    Array.isArray(row.markets) && row.markets.length ? `markets=${row.markets.join('/')}` : null,
    typeof row.audience === 'string' && row.audience !== '' ? `audience=${row.audience}` : null,
  ].filter(Boolean).join(' ');
  console.log(`      ${row.slug} [${row.status}] ${row.url} · ${plats} · api=${api}${extra ? ` · ${extra}` : ''}`);
}

notes.push(
  `${rowsChecked} of ${catalogue.length} row(s) checked against ${REQUIRED_FIELDS.length} required fields ` +
    `(${REQUIRED_FIELDS.join(', ')})`,
);

done();
