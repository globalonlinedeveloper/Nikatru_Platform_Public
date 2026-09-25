#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-bundle-availability.mjs — THE COMING-SOON GATE CANNOT BE FLIPPED BY A
// STRING. Invariant G9 of the bundle design (2026-09-09); [ADR 057] is the
// mechanism this gate hangs off.
//
// 🔴 THE FAILURE THIS EXISTS TO STOP. The bundle ships "coming soon" and becomes
// buyable when a SECOND product goes live. The cheap way to build that is a
// boolean in a config file. It is also the way that, one careless edit later,
// advertises a subscription that cannot be delivered — which is a store
// rejection cause (advertising an unavailable subscription), not a cosmetic
// slip, and the edit that causes it looks like a one-word diff.
//
// So the answer is DERIVED from registers that already exist and are already
// graded by other guards, and this file asserts SIX things about that:
//
//   A · NO LITERAL. `purchasable` (and its siblings) never appear as a boolean
//       literal in the register, in either derivation, or in anything that
//       renders them. Failing input: write `"purchasable": true` into
//       catalog/bundles.json.
//
//   B · NEITHER COPY RETYPES THE NUMBER. Both derivations import
//       MIN_LIVE_PRODUCTS_FOR_BUNDLE and PRODUCT_REGISTERS from
//       contracts/entitlement/bundle.js. A literal `2` in either is a second
//       place to change and the one nobody would remember.
//
//   C · TODAY'S REGISTERS YIELD `false`, and for the RIGHT REASON. Not just
//       "false" — the evidence must say the live-product count is below the
//       floor. A derivation that threw and returned false would satisfy a bare
//       `=== false`.
//
//   D · 🔴 A FIXTURE WITH A SECOND LIVE PRODUCT YIELDS `true`. THIS IS THE LIMB
//       THAT MATTERS. Without it, `return false` passes every other limb
//       forever, the gate is a constant, and the day the owner flips FullShot to
//       `live` nothing happens and nothing is red. Both directions or neither.
//
//   E · THE TWO COPIES AGREE. The Worker cannot import a repo-relative .mjs, so
//       services/platform/src/lib/bundle/availability.ts is a TWIN. Its
//       conjunct set is compared to the .mjs's, on the model of limb 4 of
//       assert-entitlement-contract.mjs — which already holds one set across
//       four runtimes for exactly this reason.
//
//   F · EVERY CATALOGUE PRODUCT IS A MEMBER OR IS EXCLUDED, BY NAME.
//       O-BUNDLE-MEMBERSHIP-UNGRADED. `membersAllLive` reads only the slugs the
//       bundle names, so a product added to catalog/apps.json or
//       extensions/catalog/extensions.json and never added to `members` left the
//       "every Nikatru product" bundle silently short of it. The slugs of both
//       catalogues must equal the bundle's `members` ∪ `excluded`; each
//       `excluded` entry is `{ slug, why }` with a non-empty why; a member or an
//       exclusion naming no catalogue product is refused. A missing `excluded`
//       reads as []. Reading zero catalogue slugs is COVERAGE LOST.
//
// Limb C prints every conjunct of `purchasable` with its value, so the reason
// the gate is shut is read off the log rather than inferred.
//
// ⚠️ COVERAGE LOST IS NOT A PASS. A missing register, an unparseable one, or a
// derivation that could not be imported all REFUSE. An empty product set makes
// `purchasable` false, which looks like the correct conservative answer and is
// in fact this guard having stopped reading.
//
// Usage:  node tooling/ci/assert-bundle-availability.mjs [repoRoot]
// Exit 0 = the gate is derived and moves in both directions, 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const DERIVATION = 'tooling/bundle-availability.mjs';
const TWIN = 'services/platform/src/lib/bundle/availability.ts';
const BUNDLES = 'catalog/bundles.json';
const CONTRACT = 'contracts/entitlement/bundle.js';
const APPS = 'catalog/apps.json';
const EXTENSIONS = 'extensions/catalog/extensions.json';

/**
 * Everything that must exist for a single limb below to be a MEASUREMENT rather
 * than a silence. Derived-set-plus-required-members: the derivation sweeps the
 * registers itself, and this list is what stops the sweep from finding NONE and
 * printing ok.
 */
const REQUIRED_COVERAGE = [
  { file: DERIVATION, why: 'the one derivation — absent, every answer below is a guess' },
  { file: TWIN, why: 'the Worker twin — absent, the edge derives from nothing and limb E compares one copy to itself' },
  { file: BUNDLES, why: 'the bundle register — absent, there is no feature set to be visible or purchasable' },
  { file: CONTRACT, why: 'the shared constants — absent, both copies would have to retype the floor' },
  { file: APPS, why: 'the app register — absent, the live-product count is not a measurement' },
  { file: EXTENSIONS, why: 'the extension register — absent, an extension can never be counted live and the gate can never open' },
];

/**
 * The names the gate is spelled with. A boolean literal assigned to any of them
 * is the defect: the whole point is that they are COMPUTED.
 *
 * `visible` is NOT in this list on purpose — a register may legitimately carry
 * per-channel visibility as data once the anti-steering research lands, and
 * conflating "may be shown" with "may be sold" is the exact collapse the
 * three-boolean split exists to prevent.
 */
const DERIVED_KEYS = ['purchasable', 'bundlePurchasable', 'bundle_purchasable', 'steerable'];

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
const ok = (m) => notes.push(m);

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

function done() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-bundle-availability: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    // ⏱ 2026-09-16 — O-EXIT2-CONVENTION-GAP. Exit 2 when EVERY problem is a COVERAGE LOST: the run did
    // not check enough to be evidence. Exit 1 when any is a finding — a proven defect outranks a blind
    // limb. This exited 1 for both until today. assert-guard-coverage.mjs reads this exact idiom.
    process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
  }
  console.log('✓ assert-bundle-availability: the coming-soon gate is derived, and it moves in both directions.');
  process.exit(0);
}

// ── COVERAGE, BEFORE ANY CONTENT CLAIM ───────────────────────────────────────
const sources = new Map();
for (const { file, why } of REQUIRED_COVERAGE) {
  const raw = read(file);
  if (raw === null) {
    coverageLost(`${file} does not exist — ${why}.`);
    continue;
  }
  sources.set(file, raw);
}
if (problems.length) done();

// ── A · NO BOOLEAN LITERAL DECIDES THE GATE ──────────────────────────────────
// Strips line and block comments first: a comment that SAYS `purchasable: true`
// while explaining why it may not exist is documentation, and failing on it
// would make the guard punish the file that explains itself.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

{
  const surfaces = [
    { file: BUNDLES, label: 'the bundle register' },
    { file: DERIVATION, label: 'the node derivation' },
    { file: TWIN, label: 'the Worker twin' },
  ];
  let checked = 0;
  for (const { file, label } of surfaces) {
    const src = stripComments(sources.get(file) ?? '');
    checked += 1;
    for (const key of DERIVED_KEYS) {
      // `"purchasable": true` / `purchasable = false` / `purchasable: true`.
      const re = new RegExp(`["']?${key}["']?\\s*[:=]\\s*(true|false)\\b`);
      const m = re.exec(src);
      if (m !== null) {
        fail(
          `${file} (${label}) assigns the boolean literal \`${m[1]}\` to \`${key}\`. The coming-soon gate is DERIVED ` +
            'or it is not a gate: a literal here is one careless edit away from advertising a subscription that ' +
            'cannot be delivered, which is a store rejection cause and not a cosmetic slip.',
        );
      }
    }
  }
  if (checked === 0) {
    coverageLost('limb A read ZERO surfaces, so "no literal decides the gate" was asserted over nothing.');
  } else {
    ok(`no boolean literal decides the gate, across ${checked} surface(s)`);
  }
}

// ── B · NEITHER COPY RETYPES THE FLOOR ───────────────────────────────────────
{
  for (const [file, label] of [
    [DERIVATION, 'the node derivation'],
    [TWIN, 'the Worker twin'],
  ]) {
    const src = stripComments(sources.get(file) ?? '');
    if (!/MIN_LIVE_PRODUCTS_FOR_BUNDLE/.test(src)) {
      fail(
        `${file} (${label}) does not use MIN_LIVE_PRODUCTS_FOR_BUNDLE. The one number that decides whether a ` +
          'bundle is an offer at all must exist once, in contracts/entitlement/bundle.js — a literal here is a ' +
          'second place to change and the place nobody would remember.',
      );
    }
    if (!/PRODUCT_REGISTERS/.test(src)) {
      fail(
        `${file} (${label}) does not read PRODUCT_REGISTERS. Both copies must derive the live-product set from ` +
          'the SAME list of registers, or adding a product category becomes two edits and one of them gets missed.',
      );
    }
  }
  if (problems.length === 0) ok('both copies import the floor and the register list rather than retyping them');
}

// ── the derivation, imported once and used by limbs C and D ──────────────────
let bundleAvailability = null;
try {
  ({ bundleAvailability } = await import(pathToFileURL(join(ROOT, DERIVATION)).href));
} catch (e) {
  coverageLost(`${DERIVATION} could not be imported (${e.message}), so neither direction of the gate was measured.`);
  done();
}
if (typeof bundleAvailability !== 'function') {
  coverageLost(`${DERIVATION} exports no \`bundleAvailability\` function, so neither direction was measured.`);
  done();
}

/** Every conjunct of `purchasable` beyond `visible`, with its value. */
const conjunctsOf = (why) =>
  `enoughLive=${why.enoughLive} (${why.liveProductCount} live, floor ${why.minLiveProducts}), ` +
  `missingMembers=[${why.missingMembers.join(', ')}], membersAllLive=${why.membersAllLive}, priced=${why.priced}`;

// ── C · TODAY'S REGISTERS YIELD false, FOR THE RIGHT REASON ──────────────────
{
  const today = bundleAvailability(ROOT);
  if (today.problems.length > 0) {
    coverageLost(
      `the derivation could not read its own registers on the real tree: ${today.problems.join(' · ')}. ` +
        'An unreadable register makes `purchasable` false, which LOOKS like the correct conservative answer and ' +
        'is in fact this guard having stopped reading.',
    );
    done();
  }
  if (today.purchasable !== false) {
    fail(
      `the real registers derive \`purchasable: ${today.purchasable}\`. As of this commit ${APPS} carries ` +
        `${today.why.liveProducts.length} live product(s) (${today.why.liveProducts.join(', ') || 'none'}) and the ` +
        `floor is ${today.why.minLiveProducts}. If a second product really did go live, this line is the review ` +
        `that says so — it is not a line to edit past. Conjuncts: ${conjunctsOf(today.why)}.`,
    );
  } else if (today.why.enoughLive !== false) {
    fail(
      'the gate is closed but NOT because there are too few live products — the evidence says the floor is met. ' +
        'That means something else is holding it shut and the "one more live product opens it" story is false. ' +
        `Conjuncts: ${conjunctsOf(today.why)}.`,
    );
  } else {
    ok(
      `today's registers derive purchasable=false because ${today.why.liveProductCount} live product(s) < ` +
        `${today.why.minLiveProducts} (live: ${today.why.liveProducts.join(', ') || 'none'})`,
    );
    ok(`limb C conjuncts: ${conjunctsOf(today.why)}`);
  }
}

// ── D · 🔴 A FIXTURE WITH A SECOND LIVE PRODUCT YIELDS true ──────────────────
// The limb a constant cannot pass. It builds a THROWAWAY tree carrying only the
// registers the derivation reads, flips the extension to `live`, gives the
// bundle a price id, and requires the answer to move.
{
  const tmp = mkdtempSync(join(tmpdir(), 'bundle-availability-'));
  try {
    for (const rel of ['catalog', 'extensions/catalog', 'tooling', 'contracts/entitlement']) {
      mkdirSync(join(tmp, rel), { recursive: true });
    }
    // The contract and the derivation itself are copied verbatim — the fixture
    // changes the REGISTERS, never the code under test.
    cpSync(join(ROOT, CONTRACT), join(tmp, CONTRACT));
    cpSync(join(ROOT, 'tooling/channel-register.json'), join(tmp, 'tooling/channel-register.json'));

    const apps = JSON.parse(sources.get(APPS));
    const exts = JSON.parse(sources.get(EXTENSIONS));
    // The ENABLE TRIGGER, exactly as the design states it: a second product's
    // `status` flips to "live" in its own catalogue. Nothing else changes.
    const extsLive = exts.map((r) => ({ ...r, status: 'live' }));
    writeFileSync(join(tmp, APPS), JSON.stringify(apps, null, 2));
    writeFileSync(join(tmp, EXTENSIONS), JSON.stringify(extsLive, null, 2));

    const bundles = JSON.parse(sources.get(BUNDLES));
    const priced = bundles.map((b) => ({
      ...b,
      priceIds: { paddle: { monthly: 'pri_fixture_monthly', yearly: 'pri_fixture_yearly' } },
    }));
    writeFileSync(join(tmp, BUNDLES), JSON.stringify(priced, null, 2));

    const after = bundleAvailability(tmp);
    if (after.problems.length > 0) {
      coverageLost(
        `the fixture tree could not be read (${after.problems.join(' · ')}), so the OPENING direction of the ` +
          'gate was never measured — and a derivation that always returns false passes every other limb.',
      );
    } else if (after.purchasable !== true) {
      fail(
        'A SECOND LIVE PRODUCT DID NOT OPEN THE GATE. With every register flipped to the state the enable ' +
          `trigger describes, the derivation still answers \`purchasable: ${after.purchasable}\` ` +
          `(live: ${after.why.liveProducts.join(', ')}, members: ${after.why.members.join(', ')}, ` +
          `missing: ${after.why.missingMembers.join(', ') || 'none'}, priced: ${after.why.priced}). ` +
          'A gate that only ever closes is a constant, and on the day the owner promotes the second product ' +
          'nothing would happen and nothing would be red.',
      );
    } else {
      ok(
        'a fixture with a second live product and a resolvable price derives purchasable=true — the gate moves ' +
          'in BOTH directions',
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── E · THE TWO COPIES DECIDE THE SAME CONJUNCTION ───────────────────────────
// The Worker cannot import a repo-relative .mjs, so there are two copies of one
// derivation — the drift this repo has already paid for once. They cannot be
// byte-compared across two languages; what has to agree is the CONJUNCTION.
{
  const CONJUNCTS = [
    ['enoughLive', 'the live-product floor'],
    ['membersAllLive', 'every member of the pinned set is live'],
    ['priced', 'the feature set resolves to at least one price id'],
    ['visible', 'a feature set is declared at all'],
  ];
  let compared = 0;
  let disagreed = 0;
  for (const [name, why] of CONJUNCTS) {
    const inMjs = new RegExp(`\\b${name}\\b`).test(stripComments(sources.get(DERIVATION)));
    const inTs = new RegExp(`\\b${name}\\b`).test(stripComments(sources.get(TWIN)));
    compared += 1;
    if (inMjs !== inTs) {
      disagreed += 1;
      fail(
        `the two derivations disagree about \`${name}\` (${why}): ${DERIVATION} ${inMjs ? 'has' : 'lacks'} it and ` +
          `${TWIN} ${inTs ? 'has' : 'lacks'} it. The edge and the site would then answer differently about whether ` +
          'the same bundle can be bought.',
      );
    }
  }
  if (compared === 0) {
    coverageLost('limb E compared ZERO conjuncts, so the two derivations were never held together.');
  } else if (disagreed === 0) {
    ok(`both derivations decide the same ${compared} conjuncts`);
  }
}

// ── F · EVERY CATALOGUE PRODUCT IS A MEMBER OR IS EXCLUDED, BY NAME ───────────
// O-BUNDLE-MEMBERSHIP-UNGRADED. The row graded is bundles[0], the one the
// derivation reads.
{
  const before = problems.length;
  const catalog = new Set();
  for (const file of [APPS, EXTENSIONS]) {
    let rows;
    try {
      rows = JSON.parse(sources.get(file));
    } catch (e) {
      coverageLost(`limb F could not parse ${file} (${e.message}), so its products were never held against the bundle.`);
      continue;
    }
    for (const r of Array.isArray(rows) ? rows : []) {
      if (typeof r?.slug === 'string' && r.slug) catalog.add(r.slug);
    }
  }
  let bundle = null;
  try {
    const bundles = JSON.parse(sources.get(BUNDLES));
    bundle = Array.isArray(bundles) && bundles.length > 0 ? bundles[0] : null;
  } catch (e) {
    coverageLost(`limb F could not parse ${BUNDLES} (${e.message}).`);
  }
  if (catalog.size === 0) {
    coverageLost(`limb F read ZERO product slugs from ${APPS} and ${EXTENSIONS}, so membership was asserted over nothing.`);
  } else if (bundle === null) {
    coverageLost(`limb F found no bundle row in ${BUNDLES} to hold the ${catalog.size} catalogue product(s) against.`);
  } else {
    const members = (Array.isArray(bundle.members) ? bundle.members : []).map((m) => m?.slug);
    const excludedRaw = bundle.excluded ?? [];
    const excluded = [];
    if (!Array.isArray(excludedRaw)) {
      fail(`${BUNDLES} \`excluded\` is not an array of { slug, why }.`);
    } else {
      for (const [i, x] of excludedRaw.entries()) {
        if (typeof x?.slug !== 'string' || !x.slug) {
          fail(`${BUNDLES} excluded[${i}] names no \`slug\`.`);
          continue;
        }
        if (typeof x.why !== 'string' || x.why.trim() === '') {
          fail(`${BUNDLES} excludes \`${x.slug}\` with no \`why\`. An exclusion from "every product" is a decision, and a decision states its reason.`);
        }
        excluded.push(x.slug);
      }
    }
    for (const s of members) {
      if (typeof s !== 'string' || !catalog.has(s)) {
        fail(`${BUNDLES} lists member \`${s}\`, which neither ${APPS} nor ${EXTENSIONS} carries — an unknown member can never be live.`);
      }
      if (excluded.includes(s)) fail(`${BUNDLES} lists \`${s}\` as a member AND excludes it.`);
    }
    for (const s of excluded) {
      if (!catalog.has(s)) fail(`${BUNDLES} excludes \`${s}\`, which neither ${APPS} nor ${EXTENSIONS} carries.`);
    }
    for (const s of catalog) {
      if (!members.includes(s) && !excluded.includes(s)) {
        fail(
          `\`${s}\` is a catalogue product and ${BUNDLES} neither lists it in \`members\` nor names it in \`excluded\` ` +
            'with a `why`. The bundle is sold as every Nikatru product; add it to one of the two.',
        );
      }
    }
    if (problems.length === before) {
      ok(
        `the ${catalog.size} catalogue product(s) equal members ∪ excluded ` +
          `(members: ${members.join(', ') || 'none'}; excluded: ${excluded.join(', ') || 'none'})`,
      );
    }
  }
}

done();
