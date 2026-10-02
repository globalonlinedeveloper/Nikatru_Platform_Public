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
// graded by other guards, and this file asserts EIGHT things about that:
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
//       ⏱ 2026-10-01 (rv2-newproduct-011, O-BUNDLE-MEMBER-INSERT-UNLOCKED): a
//       STAMP excludes the product it stamps, with a why that opens with
//       STAMPED_EXCLUSION_MARK (tooling/catalog/read.mjs) — the placeholder that
//       keeps app #2's first commit green without a decision nobody made. On a
//       product whose catalogue status is `live` that placeholder is a finding:
//       going live is when the bundle must say in or out (new-product step 12).
//
//   G · THE DIRECT catalog/*.json READERS STAY AT OR BELOW A FLOOR THAT ONLY
//       FALLS. O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST. New code reads the
//       catalogue through tooling/catalog/read.mjs or
//       services/platform/src/lib/catalog.ts; every other source file naming a
//       catalog/*.json path is counted against tooling/catalog/reader-floor.json,
//       and a floor above the base branch's is refused. The count prints on
//       every run, so CI's log carries it.
//
//   H · A VERSION'S MEMBERSHIP IS LOCKED. O-BUNDLE-MEMBER-INSERT-UNLOCKED.
//       Every bundle row's members equal its featureSet@version entry in
//       catalog/bundle-membership.lock.json; an entry the base branch carries is
//       never edited or removed; a new entry names only live members.
//
//   I · A LIVE MEMBER CAN READ ITS ENTITLEMENT. ⏱ 2026-09-29, EXM-05. A member
//       counted live from its catalogue status alone may still be unable to ask
//       the platform whether its buyer owns the bundle: an extension reaches only
//       the hosts its tool.json `policy.networkAllowlist` names. Every extension
//       member is read by memberEntitlementReach() in the derivation; one that is
//       LIVE and cannot reach the entitlement host makes the bundle NOT
//       PURCHASABLE and this guard exit 1. One that is not live yet is printed,
//       so the gap is on screen before the day it would bite. Not a conjunct of
//       `purchasable` (the Worker twin cannot read a tool.json; see the
//       derivation): the tree is refused instead, so neither copy meets the state.
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
import { join, resolve, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { BUNDLE_LOCK, bundleKey, isStampedExclusion, lockEntriesOf, memberSlugsOf, readBundleLock, readBundles } from '../catalog/read.mjs';

// argv: an optional repo root, plus flags.
//   --list-readers        print every direct catalog/*.json reader limb G counts
//   --base-root=<dir>     read the BASE copies limbs G and H compare against from
//                         <dir> instead of `git show refs/remotes/origin/main:<path>`
//                         (a test seam: a fixture tree has no git history)
const ARGS = process.argv.slice(2);
const FLAGS = new Set(ARGS.filter((a) => a.startsWith('--') && !a.includes('=')));
const OPTS = Object.fromEntries(
  ARGS.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
);
const ROOT = resolve(ARGS.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const DERIVATION = 'tooling/bundle-availability.mjs';
const TWIN = 'services/platform/src/lib/bundle/availability.ts';
const BUNDLES = 'catalog/bundles.json';
const CONTRACT = 'contracts/entitlement/bundle.js';
const APPS = 'catalog/apps.json';
const EXTENSIONS = 'extensions/catalog/extensions.json';
/** The two catalogue readers new code imports (R-3). Limb G does not count them. */
const NODE_READER = 'tooling/catalog/read.mjs';
const WORKER_READER = 'services/platform/src/lib/catalog.ts';
/** The committed floor limb G counts the direct readers against. */
const READER_FLOOR = 'tooling/catalog/reader-floor.json';
/** Limb I's entitlement host lives in its `sharedApiBaseUrl`. */
const PLATFORM_CONFIG = 'services/platform/src/app-config-data.json';

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
  { file: NODE_READER, why: 'the Node catalogue reader — absent, limb G counts readers of a reader that does not exist' },
  { file: WORKER_READER, why: 'the Worker catalogue reader — absent, the Worker twin reads the bundle register from nowhere' },
  { file: READER_FLOOR, why: 'the committed reader floor — absent, limb G has nothing to hold the count against' },
  { file: BUNDLE_LOCK, why: 'the minted-membership lock — absent, a member can be added to a minted version with nothing red' },
  { file: PLATFORM_CONFIG, why: 'the served config — absent, limb I cannot name the host an entitlement is read from' },
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

// ── the derivation, imported once and used by limbs C, D and H ───────────────
let bundleAvailability = null;
let readProducts = null;
let liveSlugs = null;
let memberEntitlementReach = null;
try {
  ({ bundleAvailability, readProducts, liveSlugs, memberEntitlementReach } = await import(pathToFileURL(join(ROOT, DERIVATION)).href));
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

// ── C · TODAY'S REGISTERS YIELD false, FOR THE RIGHT REASON — EVERY BUNDLE ───
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
  if (today.byFeatureSet.size === 0) {
    coverageLost(`the derivation returned ZERO bundles from ${BUNDLES}, so no verdict was graded.`);
    done();
  }
  for (const [featureSet, v] of today.byFeatureSet) {
    if (v.purchasable !== false) {
      fail(
        `[${featureSet}] the real registers derive \`purchasable: ${v.purchasable}\`. As of this commit ${APPS} carries ` +
          `${v.why.liveProducts.length} live product(s) (${v.why.liveProducts.join(', ') || 'none'}) and the ` +
          `floor is ${v.why.minLiveProducts}. If a second product really did go live, this line is the review ` +
          `that says so — it is not a line to edit past. Conjuncts: ${conjunctsOf(v.why)}.`,
      );
    } else if (v.why.enoughLive !== false) {
      fail(
        `[${featureSet}] the gate is closed but NOT because there are too few live products — the evidence says the ` +
          'floor is met. That means something else is holding it shut and the "one more live product opens it" story ' +
          `is false. Conjuncts: ${conjunctsOf(v.why)}.`,
      );
    } else {
      ok(
        `today's registers derive purchasable=false because ${v.why.liveProductCount} live product(s) < ` +
          `${v.why.minLiveProducts} (live: ${v.why.liveProducts.join(', ') || 'none'}) [${featureSet}]`,
      );
      ok(`limb C conjuncts: ${conjunctsOf(v.why)} [${featureSet}]`);
    }
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
    // 🔴 THE TWO-BUNDLE FIXTURE (O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST). A second
    // row whose answer DIFFERS from the first — the same members, no price — so a
    // derivation that reads only the first row loses it, and one that mixes the
    // two rows up answers it wrong. Neither can pass this limb.
    const SECOND = 'fixture_second_bundle';
    const second = { ...bundles[0], featureSet: SECOND, version: 1, priceIds: {} };
    writeFileSync(join(tmp, BUNDLES), JSON.stringify([...priced, second], null, 2));

    const after = bundleAvailability(tmp);
    const opened = [...after.byFeatureSet].filter(([fs]) => fs !== SECOND);
    const two = after.byFeatureSet.get(SECOND);
    if (after.problems.length > 0) {
      coverageLost(
        `the fixture tree could not be read (${after.problems.join(' · ')}), so the OPENING direction of the ` +
          'gate was never measured — and a derivation that always returns false passes every other limb.',
      );
    } else if (opened.length !== priced.length) {
      fail(
        `the derivation returned ${opened.length} of the fixture's ${priced.length} committed bundle row(s) ` +
          `(${[...after.byFeatureSet.keys()].join(', ') || 'none'}). Every row is a bundle, and a row the derivation ` +
          'does not return is a bundle nothing can show or sell.',
      );
    } else if (two === undefined) {
      fail(
        `EVERY BUNDLE IS SEEN, AND THE SECOND ONE WAS NOT. The fixture's second bundle row \`${SECOND}\` is absent ` +
          `from the derivation's answer (${[...after.byFeatureSet.keys()].join(', ')}): it reads only the first row. ` +
          'A second bundle, or a bundle that includes app #2, would then be invisible and unsellable with every guard green.',
      );
    } else if (two.purchasable !== false || two.why.priced !== false) {
      fail(
        `the fixture's second bundle \`${SECOND}\` has no price and derives purchasable=${two.purchasable} ` +
          `(priced=${two.why.priced}). Its verdict was computed from another row.`,
      );
    } else {
      for (const [featureSet, v] of opened) {
        if (v.purchasable !== true) {
          fail(
            `[${featureSet}] A SECOND LIVE PRODUCT DID NOT OPEN THE GATE. With every register flipped to the state the ` +
              `enable trigger describes, the derivation still answers \`purchasable: ${v.purchasable}\` ` +
              `(live: ${v.why.liveProducts.join(', ')}, members: ${v.why.members.join(', ')}, ` +
              `missing: ${v.why.missingMembers.join(', ') || 'none'}, priced: ${v.why.priced}). ` +
              'A gate that only ever closes is a constant, and on the day the owner promotes the second product ' +
              'nothing would happen and nothing would be red.',
          );
        } else {
          ok(
            'a fixture with a second live product and a resolvable price derives purchasable=true — the gate moves ' +
              `in BOTH directions [${featureSet}]`,
          );
        }
      }
      ok(`the two-bundle fixture returns every row, each with its own verdict (${SECOND}: priced=false, purchasable=false)`);
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
  // 🔴 NEITHER COPY READS ONE ROW. Limb D runs the node derivation over a
  // two-bundle fixture; the Worker twin cannot be run from node (it imports JSON
  // as modules), so its half is this read of the source plus its own vitest
  // (services/platform/test/config.test.ts, `availabilityFor`). A first-element
  // read — `[0]`, `.at(0)`, `.slice(0, 1)`, `const [x] = …` — anywhere in either
  // derivation is the O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST defect. The two
  // catalogue readers are scanned too: the Worker twin and the mint take their
  // rows from catalog.ts's BUNDLE_ROWS, so a first-element read THERE starves
  // both with every derivation above still iterating what it was handed.
  const FIRST_ONLY = /\[\s*0\s*\]|\.at\(\s*0\s*\)|\.slice\(\s*0\s*,\s*1\s*\)|\b(?:const|let|var)\s*\[\s*\w+\s*\]\s*=/;
  let firstOnly = 0;
  for (const [file, label] of [
    [DERIVATION, 'the node derivation'],
    [TWIN, 'the Worker twin'],
    [WORKER_READER, 'the Worker catalogue reader'],
    [NODE_READER, 'the Node catalogue reader'],
  ]) {
    const m = FIRST_ONLY.exec(stripComments(sources.get(file)));
    if (m !== null) {
      firstOnly += 1;
      fail(
        `${file} (${label}) reads a first element (\`${m[0].trim()}\`). Both derivations answer for EVERY bundle ` +
          'row, keyed by featureSet; a first-element read is how a second bundle went unseen with this guard green.',
      );
    }
  }
  if (firstOnly === 0) {
    ok('neither derivation nor catalogue reader reads a first element: both answer for every bundle row');
  }
}

// ── F · EVERY CATALOGUE PRODUCT IS A MEMBER OR IS EXCLUDED, BY NAME ───────────
// O-BUNDLE-MEMBERSHIP-UNGRADED. EVERY bundle row is graded: until 2026-09-26
// only the first was, the same first-row read the derivations had
// (O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST).
{
  const before = problems.length;
  const catalog = new Set();
  /** slug → its catalogue `status`, for the stamp's placeholder exclusion. */
  const statusOf = new Map();
  for (const file of [APPS, EXTENSIONS]) {
    let rows;
    try {
      rows = JSON.parse(sources.get(file));
    } catch (e) {
      coverageLost(`limb F could not parse ${file} (${e.message}), so its products were never held against the bundle.`);
      continue;
    }
    for (const r of Array.isArray(rows) ? rows : []) {
      if (typeof r?.slug === 'string' && r.slug) {
        catalog.add(r.slug);
        statusOf.set(r.slug, r.status);
      }
    }
  }
  let rows = [];
  try {
    const bundles = JSON.parse(sources.get(BUNDLES));
    rows = Array.isArray(bundles) ? bundles.filter((b) => b !== null && typeof b === 'object') : [];
  } catch (e) {
    coverageLost(`limb F could not parse ${BUNDLES} (${e.message}).`);
  }
  if (catalog.size === 0) {
    coverageLost(`limb F read ZERO product slugs from ${APPS} and ${EXTENSIONS}, so membership was asserted over nothing.`);
  } else if (rows.length === 0) {
    coverageLost(`limb F found no bundle row in ${BUNDLES} to hold the ${catalog.size} catalogue product(s) against.`);
  }
  for (const bundle of catalog.size === 0 ? [] : rows) {
    const tag = `[${typeof bundle.featureSet === 'string' ? bundle.featureSet : '?'}] `;
    const beforeRow = problems.length;
    const members = (Array.isArray(bundle.members) ? bundle.members : []).map((m) => m?.slug);
    const excludedRaw = bundle.excluded ?? [];
    const excluded = [];
    if (!Array.isArray(excludedRaw)) {
      fail(`${tag}${BUNDLES} \`excluded\` is not an array of { slug, why }.`);
    } else {
      for (const [i, x] of excludedRaw.entries()) {
        if (typeof x?.slug !== 'string' || !x.slug) {
          fail(`${tag}${BUNDLES} excluded[${i}] names no \`slug\`.`);
          continue;
        }
        if (typeof x.why !== 'string' || x.why.trim() === '') {
          fail(`${tag}${BUNDLES} excludes \`${x.slug}\` with no \`why\`. An exclusion from "every product" is a decision, and a decision states its reason.`);
        }
        excluded.push(x.slug);
        if (isStampedExclusion(x) && statusOf.get(x.slug) === 'live') {
          fail(
            `${tag}${BUNDLES} still excludes \`${x.slug}\` with the STAMP's placeholder why, and \`${x.slug}\` is live. ` +
              'Going live is when the bundle says in or out: list it as a member of a NEW featureSet version (limb H), ' +
              'or replace the placeholder with the reason it stays out (new-product step 12, bundle join).',
          );
        }
      }
    }
    for (const s of members) {
      if (typeof s !== 'string' || !catalog.has(s)) {
        fail(`${tag}${BUNDLES} lists member \`${s}\`, which neither ${APPS} nor ${EXTENSIONS} carries — an unknown member can never be live.`);
      }
      if (excluded.includes(s)) fail(`${tag}${BUNDLES} lists \`${s}\` as a member AND excludes it.`);
    }
    for (const s of excluded) {
      if (!catalog.has(s)) fail(`${tag}${BUNDLES} excludes \`${s}\`, which neither ${APPS} nor ${EXTENSIONS} carries.`);
    }
    for (const s of catalog) {
      if (!members.includes(s) && !excluded.includes(s)) {
        fail(
          `${tag}\`${s}\` is a catalogue product and ${BUNDLES} neither lists it in \`members\` nor names it in \`excluded\` ` +
            'with a `why`. A bundle states, for every Nikatru product, whether it is in or out; add it to one of the two.',
        );
      }
    }
    if (problems.length === beforeRow) {
      ok(
        `the ${catalog.size} catalogue product(s) equal members ∪ excluded ` +
          `(members: ${members.join(', ') || 'none'}; excluded: ${excluded.join(', ') || 'none'}) ${tag.trim()}`,
      );
    }
  }
  if (problems.length === before && rows.length > 0) ok(`limb F graded all ${rows.length} bundle row(s)`);
}

// ── the BASE copy of a file, for the two limbs that only let a file move one way ──
/**
 * `refs/remotes/origin/main:<rel>` — or `<--base-root>/<rel>` under the test seam.
 * `{ ok: false }` when there is no base to read (no git, no origin/main, or the
 * file does not exist at the base); the caller then compares the file against
 * itself and SAYS so, which is the brief's rule for a file this PR creates.
 */
function baseCopy(rel) {
  if (OPTS['base-root'] !== undefined) {
    const p = join(resolve(OPTS['base-root']), rel);
    return existsSync(p) ? { ok: true, text: readFileSync(p, 'utf8'), from: `--base-root ${rel}` } : { ok: false, why: `--base-root carries no ${rel}` };
  }
  const r = spawnSync('git', ['-C', ROOT, 'show', `refs/remotes/origin/main:${rel}`], { encoding: 'utf8', timeout: 30_000 });
  if (r.status === 0) return { ok: true, text: r.stdout, from: `origin/main:${rel}` };
  return { ok: false, why: `git show refs/remotes/origin/main:${rel} exited ${r.status ?? r.signal ?? 'with no status'}` };
}

// ── G · THE DIRECT catalog/*.json READERS, AGAINST A FLOOR THAT ONLY FALLS ────
// O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST (R-3). New code reads the catalogue
// through tooling/catalog/read.mjs (Node) or services/platform/src/lib/catalog.ts
// (the Worker). Every OTHER source file that names a catalog/*.json path is a
// direct reader, and the count of them may not rise above
// tooling/catalog/reader-floor.json. The floor was measured at e154dc60 and is
// not the target: migrating a reader to the reader lowers the count, and this
// limb then says how far the floor can fall. The floor itself only falls — a
// value above the base branch's floor is refused.
//
// A reader is a code file (.mjs .cjs .js .ts .dart .sh .py) whose CODE — comments
// stripped — names `catalog/<file>.json` as a root-relative or `../`-relative
// path, or joins a `'catalog'` segment to a `'<file>.json'` segment, for a
// `<file>` that exists under catalog/. `extensions/catalog/…` is another
// directory and is not counted. A file counts once, however many it names.
{
  const before = problems.length;
  const SKIP_DIRS = new Set(['node_modules', '.git', '.dart_tool', 'build', '.wrangler', 'dist', 'coverage']);
  const CODE = /\.(mjs|cjs|js|ts|dart|sh|py)$/;
  const SANCTIONED = new Set([NODE_READER, WORKER_READER]);
  let names = [];
  try {
    names = listDir(join(ROOT, 'catalog')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length));
  } catch (e) {
    coverageLost(`limb G could not list catalog/ (${e.message}), so no reader could be recognised.`);
  }
  let floor = null;
  try {
    const doc = JSON.parse(sources.get(READER_FLOOR));
    if (Number.isInteger(doc?.floor) && doc.floor >= 0) floor = doc.floor;
    else coverageLost(`${READER_FLOOR} carries no non-negative integer \`floor\`, so the count was held against nothing.`);
  } catch (e) {
    coverageLost(`limb G could not parse ${READER_FLOOR} (${e.message}).`);
  }
  if (names.length === 0 && problems.length === before) {
    coverageLost('limb G found no catalog/*.json file, so "a direct reader of the catalogue" names nothing.');
  }
  if (problems.length === before) {
    const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
    const pathRe = new RegExp(`(?<![A-Za-z0-9_.-])(?<![A-Za-z0-9_-]/)catalog/(${alt})\\.json`);
    const joinRe = new RegExp(`['"\`]catalog['"\`]\\s*,\\s*['"\`](${alt})\\.json['"\`]`);
    // A block comment opens only where a comment can: at a line start or after
    // whitespace or punctuation. The glob spelling `catalog/*.json`, which
    // files about the catalogue write in prose and in messages, is then not a
    // comment opener that swallows the file up to the next `*/`.
    const strip = (file, src) =>
      /\.(sh|py)$/.test(file)
        ? src.replace(/^\s*#[^\n]*/gm, '')
        : src.replace(/(^|[\s;,(){}[\]])\/\*[\s\S]*?\*\//g, '$1').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    const readers = [];
    let scanned = 0;
    const walk = (dir) => {
      for (const e of listDir(dir, { withFileTypes: true })) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(abs);
          continue;
        }
        if (!CODE.test(e.name)) continue;
        scanned += 1;
        const rel = relative(ROOT, abs).split(sep).join('/');
        if (SANCTIONED.has(rel)) continue;
        const code = strip(e.name, readFileSync(abs, 'utf8'));
        if (pathRe.test(code) || joinRe.test(code)) readers.push(rel);
      }
    };
    walk(ROOT);
    readers.sort();
    if (FLAGS.has('--list-readers')) for (const r of readers) console.log(`  reader  ${r}`);
    let baseFloor = null;
    const base = baseCopy(READER_FLOOR);
    if (base.ok) {
      try {
        const n = JSON.parse(base.text)?.floor;
        if (Number.isInteger(n)) baseFloor = n;
      } catch {
        // An unparseable base copy is no base: the floor is held against itself below.
      }
    }
    if (scanned === 0) {
      coverageLost('limb G scanned ZERO code files, so the reader count is a count of nothing.');
    } else if (readers.length > floor) {
      fail(
        `${readers.length} source file(s) read catalog/*.json directly, above the floor of ${floor} in ${READER_FLOOR}. ` +
          `New code reads the catalogue through ${NODE_READER} (Node) or ${WORKER_READER} (the Worker). ` +
          'Run with --list-readers for the list.',
      );
    } else if (baseFloor !== null && floor > baseFloor) {
      fail(`${READER_FLOOR} raises the floor from ${baseFloor} (${base.from}) to ${floor}. The floor only falls.`);
    } else {
      ok(
        `limb G: ${readers.length} direct catalog/*.json reader(s) across ${scanned} code file(s), floor ${floor}` +
          (baseFloor === null ? ` (no base floor: ${base.why}; held against itself)` : ` (base ${baseFloor})`) +
          (readers.length < floor ? ` — the floor can fall to ${readers.length}` : ''),
      );
    }
  }
}

// ── H · A VERSION'S MEMBERSHIP IS LOCKED, AND THE LOCK ONLY GROWS ────────────
// O-BUNDLE-MEMBER-INSERT-UNLOCKED limb (1). Adding app #2 to `members` without a
// version bump would insert it into an already-minted version and change what
// existing buyers own ([ADR 057] §4). catalog/bundle-membership.lock.json keeps
// every version's members, and this limb holds three things:
//   1 · every bundle row's members EQUAL its featureSet@version entry;
//   2 · no entry the base branch's lock carries is edited or removed;
//   3 · a NEW entry (absent from the base) names only members that are `live`
//       in their register at this commit. Past entries are not re-graded:
//       nikatru_all@1 is a draft that was never sold, written as it stands.
// With no base copy (this PR creates the lock, or no git), the lock is compared
// against itself, and the line below says so.
{
  const before = problems.length;
  const lock = readBundleLock(ROOT);
  const register = readBundles(ROOT);
  if (!lock.ok) coverageLost(`limb H could not read the lock: ${lock.why}.`);
  if (!register.ok) coverageLost(`limb H could not read the bundle register: ${register.why}.`);
  if (lock.ok && register.ok && register.rows.length === 0) {
    coverageLost(`limb H found no bundle row in ${BUNDLES}, so no version was held against the lock.`);
  }
  if (problems.length === before) {
    const sorted = (xs) => [...xs].sort();
    const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
    // 1 · the register against the lock
    for (const row of register.rows) {
      const key = bundleKey(row.featureSet, row.version);
      const members = memberSlugsOf(row);
      const entry = lock.entries[key];
      if (entry === undefined) {
        fail(
          `${BUNDLES} carries ${key} and ${BUNDLE_LOCK} has no entry for it. A version's membership is locked when the ` +
            `version is written: add "${key}": ${JSON.stringify(sorted(members))} to the lock in the same commit.`,
        );
      } else if (!same(members, entry)) {
        fail(
          `the members of ${key} in ${BUNDLES} (${sorted(members).join(', ') || 'none'}) differ from its lock entry ` +
            `(${sorted(entry).join(', ') || 'none'}). A minted version's membership never changes: bump the version and ` +
            'add a lock entry for the new one ([ADR 057] §4).',
        );
      }
    }
    // 2 · the lock against its base
    const baseRaw = baseCopy(BUNDLE_LOCK);
    let base = null;
    if (baseRaw.ok) {
      try {
        const parsed = lockEntriesOf(JSON.parse(baseRaw.text), baseRaw.from);
        if (parsed.ok) base = parsed.entries;
        else fail(`the base copy of the lock is unreadable (${parsed.why}), so an edit to it could not be seen.`);
      } catch (e) {
        fail(`the base copy of the lock (${baseRaw.from}) is not valid JSON (${e.message}).`);
      }
    }
    const against = base ?? lock.entries;
    for (const [key, members] of Object.entries(against)) {
      const now = lock.entries[key];
      if (now === undefined) {
        fail(`${BUNDLE_LOCK} no longer carries ${key}. The lock only grows: a minted version's members are a record, never removed.`);
      } else if (!same(now, members)) {
        fail(
          `${BUNDLE_LOCK} edits ${key} from (${sorted(members).join(', ')}) to (${sorted(now).join(', ')}). The lock only ` +
            'grows: a new membership is a new version, never an edit to a minted one.',
        );
      }
    }
    // 3 · a new entry names only live members
    const { products, problems: productProblems } = readProducts(ROOT);
    if (productProblems.length > 0) {
      coverageLost(`limb H could not read the product registers (${productProblems.join(' · ')}), so liveness was not measured.`);
    } else {
      const live = new Set(liveSlugs(products));
      const fresh = Object.keys(lock.entries).filter((k) => !(k in against));
      for (const key of fresh) {
        const notLive = lock.entries[key].filter((s) => !live.has(s));
        if (notLive.length > 0) {
          fail(
            `the NEW lock entry ${key} names ${notLive.join(', ')}, which ${notLive.length === 1 ? 'is' : 'are'} not \`live\` ` +
              'in its register at this commit. A product joins a bundle only after it is live.',
          );
        }
      }
      if (problems.length === before) {
        ok(
          `limb H: ${register.rows.length} bundle row(s) equal their lock entries; ${Object.keys(lock.entries).length} lock ` +
            `entr${Object.keys(lock.entries).length === 1 ? 'y' : 'ies'}, ${fresh.length} new, every new one all-live` +
            (base === null ? ` (no base lock: ${baseRaw.why}; held against itself)` : ` (base: ${baseRaw.from})`),
        );
      }
    }
  }
}

// ── I · A LIVE MEMBER CAN READ ITS ENTITLEMENT (EXM-05) ─────────────────────
{
  if (typeof memberEntitlementReach !== 'function') {
    coverageLost(`${DERIVATION} exports no \`memberEntitlementReach\`, so no member's entitlement reach was read.`);
  } else {
    const before = problems.length;
    const { products, problems: productProblems } = readProducts(ROOT);
    let rows = [];
    try {
      const parsed = JSON.parse(sources.get(BUNDLES));
      rows = Array.isArray(parsed) ? parsed.filter((b) => b !== null && typeof b === 'object') : [];
    } catch (e) {
      coverageLost(`limb I could not parse ${BUNDLES} (${e.message}).`);
    }
    if (productProblems.length > 0) {
      coverageLost(`limb I could not read the product registers (${productProblems.join(' · ')}), so liveness was not measured.`);
    } else if (rows.length === 0) {
      coverageLost(`limb I read ZERO bundle rows from ${BUNDLES}, so no member's reach was graded.`);
    } else {
      const live = new Set(liveSlugs(products));
      let extensionsRead = 0;
      let host = null;
      for (const row of rows) {
        const reach = memberEntitlementReach(ROOT, row.members);
        host = reach.entitlementHost ?? host;
        extensionsRead += reach.extensionsRead;
        for (const p of reach.problems) coverageLost(`limb I [${row.featureSet}]: ${p}`);
        for (const u of reach.unreadable) {
          if (live.has(u.slug)) {
            fail(
              `[${row.featureSet}] NOT PURCHASABLE: member \`${u.slug}\` is live and cannot read its entitlement. ${u.why} ` +
                'Selling the bundle would deliver nothing for that member; add the host to its allowlist (and its CSP, which ' +
                'policy-check.mjs holds to the allowlist) before it goes live.',
            );
          } else {
            ok(`⬜ limb I [${row.featureSet}]: \`${u.slug}\` is not live yet and cannot read its entitlement — ${u.why} This goes red the day it goes live as it stands.`);
          }
        }
      }
      if (problems.length === before) {
        ok(`limb I: every live bundle member can read its entitlement from ${host} (${extensionsRead} extension member(s) read)`);
      }
    }
  }
}

done();
