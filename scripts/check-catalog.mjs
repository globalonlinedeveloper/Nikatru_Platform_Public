/* check-catalog.mjs — the published catalogue is a contract, so grade it as one.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-catalog.mjs
     node scripts/check-catalog.mjs --warnings-as-errors --owner-actions-fatal

   THE DIVISION OF LABOUR, STATED SO NEITHER SCRIPT IS MISTAKEN FOR THE OTHER

     node scripts/publish-catalog.mjs --check   DRIFT: are the committed bytes
                                                what the tool.json files derive?
     node scripts/check-catalog.mjs             TRUTH: is what they derive an
                                                honest thing to publish?

   Run BOTH. Neither implies the other, and the gap between them is the whole
   reason this file exists: `--check` compares the catalogue against the
   generator, so the one thing it can never notice is the generator and the
   catalogue being wrong together. Two ways that happens, both cheap to reach:

     · zero rows on both sides. `[]` is valid JSON, is an array, and satisfies
       every per-row assertion below vacuously. Regenerate an empty catalogue
       over an empty committed one and `--check` says "up to date" while the
       storefront advertises nothing at all.
     · a generator that quietly drops a tool. Its output then matches its output.
       This file re-derives the SET of tools from the tool.json files on disk,
       through the same loader but not through the generator, so a tool that
       exists and is not published is red here and green there.

   ── WHAT IS GRADED ───────────────────────────────────────────────────────────

     0  COVERAGE   the catalogue exists, carries no UTF-8 BOM, parses, is a
                   non-empty array; the store vocabulary derives from
                   scripts/schema/tool.schema.json; the repo holds at least one
                   tool to publish
     1  SET        published slugs == extension-surface tool ids on disk
     2  SHAPE      every row carries slug/name/tagline/listings/platforms/status,
                   and listings is keyed by exactly the platforms it publishes
     3  STATUS     "live" if and only if the row carries at least one listing URL
     4  URL        every listing URL is https and points at that store's own host
     5  SOURCE     a tool.json is "shipping" if and only if it has a listing —
                   which is the rule Extension/Full_Screen_Shot/tool.json writes
                   down about itself, and nothing enforced it

   ── WHY THE STORE VOCABULARY IS DERIVED AND THE HOSTS ARE NOT ────────────────

   scripts/schema/tool.schema.json already declares which stores exist — the
   `listings` properties and the `targets.chromium.stores` enum. Typing that list
   again here would be a second declaration of one fact, free to drift in the
   direction that reports clean: this guard would go on accepting a store the
   repo dropped, or reject one it just added. So it is read from the schema, and
   read relative to THIS FILE rather than to --repo-root, because the vocabulary
   belongs to the toolchain while the tree is the subject being graded. If it
   cannot be read the run REFUSES: a vocabulary check against an empty vocabulary
   accepts everything while looking like it accepted nothing untoward.

   The store HOSTS are not derived, because nothing in this repository declares
   them — this is their first machine-readable statement, and it says so rather
   than pretending to be a copy. A store key with no host here is a FAIL, not a
   skip: an unverifiable URL published to a storefront is exactly the case this
   limb exists for.

   ── 🔴 WHY LIMB 0 GRADES BYTES BEFORE IT GRADES CONTENT ──────────────────────

   Everything below this point reads the catalogue through `readJson`, which goes
   through `readText`, which STRIPS a UTF-8 BOM. That is deliberate and correct
   for a tool.json — a byte order mark should report as a byte order mark, not as
   "corrupt JSON". But it means every content limb in this file is blind to the
   file's actual first three bytes — and those bytes are what any consumer of
   this catalogue parses. (Whether one exists: scripts/publish-catalog.mjs:16.)

   Measured on the real tree: prepend EF BB BF to catalog/extensions.json and
   `publish-catalog.mjs --check`, this script, and `lint.mjs` all exited 0, while
   the storefront's reader, its vendoring script and its site generator each
   failed to parse it — `JSON.parse` throws on a leading U+FEFF in every path
   Node offers. Three bytes, every gate green, the consumer dark.

   So the BOM is tested on the raw Buffer, first, and named in the failure. A
   consumer's "Unexpected token '﻿'" names neither the BOM nor the file, and
   PowerShell 5.1 writes one by default from `Out-File -Encoding utf8`, which is
   the shell this repository is built in.

   ── WHY LIMB 3 IS A BICONDITIONAL ────────────────────────────────────────────

   `live` is a promise to a stranger that a store page answers. A row that says
   `live` with no listing is the lie this guard was written to prevent. The other
   direction matters just as much and is easier to reach by accident: a row that
   carries a real store URL while still saying `preview` publishes a card the
   storefront will render without an install button, so a listing that exists
   reaches nobody. Both directions are wrong; both are red.

   ── 🔴 NOT YET WIRED INTO CI, AND THAT IS THE ONE THING WRONG WITH IT ────────

   `.github/workflows/ci.yml` does not call this script or publish-catalog.mjs.
   Until it does, both are notes rather than gates: they help a session that
   remembers to run them and nobody else, which is the weaker half of the rule
   this repository is built on. Nothing here is blocked on a decision — the
   wiring was simply out of scope for the change that added these two files.

   The two steps to add, in the `gates` job beside the other per-tool calls (they
   are repo-wide, not per-tool, so they belong once rather than in the matrix):

       - run: node scripts/publish-catalog.mjs --check
       - run: node scripts/check-catalog.mjs

   Both are plain `node scripts/<name>.mjs` calls with no arguments, so the
   `gate-inventory` job picks them up from the workflow text automatically and
   will report them PRESENT.

   Exit codes: 0 every limb passed · 1 something is wrong · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, loadAllTools, readJson, RE_TOOL_ID } from './lib/toolinfo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['repo-root', 'file', 'warnings-as-errors', 'owner-actions-fatal']);
const root = repoRoot(args);

const catalogueRel = typeof args.get('file') === 'string' ? args.get('file') : 'catalog/extensions.json';
const catalogueAbs = path.join(root, catalogueRel);

const PUBLISHED_STATUS = ['live', 'preview'];

/* The first machine-readable statement of these in this repository. Keyed by the
   store names the schema declares, and checked against them below so that a
   store gaining a listing before it gains a host cannot pass unverified. */
const STORE_HOSTS = {
  chrome: ['chromewebstore.google.com', 'chrome.google.com'],
  edge: ['microsoftedge.microsoft.com'],
  firefox: ['addons.mozilla.org'],
};

const r = new Report('check-catalog · ' + catalogueRel);

/* ── LIMB 0: COVERAGE, BEFORE ANY CONTENT CLAIM ───────────────────────────── */

/* The vocabulary, from the schema, relative to this script. */
const schemaAbs = path.join(HERE, 'schema', 'tool.schema.json');
if (!fs.existsSync(schemaAbs)) {
  die('scripts/schema/tool.schema.json does not exist, so the set of stores this repo knows about cannot be derived.\n' +
    'Checking each row against an empty vocabulary would accept every value including nonsense, which reads exactly like a clean run.');
}
const schemaParsed = readJson(schemaAbs);
if (schemaParsed.error) die(schemaParsed.error);
const listingProps = schemaParsed.value?.properties?.listings?.properties;
const KNOWN_STORES = listingProps && typeof listingProps === 'object' && !Array.isArray(listingProps)
  ? Object.keys(listingProps)
  : [];
if (KNOWN_STORES.length === 0) {
  die('scripts/schema/tool.schema.json declares no stores under properties.listings.properties, so the vocabulary is empty.\n' +
    'Every platform and listing key below would be accepted, and the run would look clean.');
}

/* A host for every store the schema knows. Stated as a check rather than an
   assumption: the day a fourth store is added to the schema, this is what says
   so, instead of that store's URLs going out unverified. */
const hostless = KNOWN_STORES.filter((s) => !Array.isArray(STORE_HOSTS[s]) || STORE_HOSTS[s].length === 0);

/* The catalogue itself. */
if (!fs.existsSync(catalogueAbs)) {
  die(catalogueRel + ' does not exist. It is the catalogue the storefront fetches, and absent is not "nothing to check" —\n' +
    'it is the subject being gone, and every assertion in this file would pass over it in silence.\n' +
    'Run:  node scripts/publish-catalog.mjs');
}
/* 🔴 THE BYTES, BEFORE THE PARSE — and before anything that reads through
   readJson()/readText(), which strip a BOM and would hide this. See the header.
   This is a FAIL rather than a `die()`: the file is gradeable once the three
   bytes come off, so the run is not "could not run" — it is "what you are
   publishing is not what you said you would publish". It stops here anyway,
   because every limb below would grade the stripped bytes and print PASS about a
   file no consumer can read. */
const rawCatalogueBytes = fs.readFileSync(catalogueAbs);
if (rawCatalogueBytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))) {
  r.fail(catalogueRel + ' starts with a UTF-8 byte order mark (EF BB BF)',
    'The first three bytes are EF BB BF, before the opening `[`.\n' +
    '`JSON.parse` throws on a leading U+FEFF in every path Node offers — string and Buffer alike — so a\n' +
    'consumer that fetches these bytes reports "not valid JSON" and reads no extensions at all.\n' +
    '(Which consumer, if any: see the dated CORRECTION at scripts/publish-catalog.mjs:16.)\n' +
    'No other gate in this repository sees it: readJson() reads through readText(), which strips a BOM by\n' +
    'design so that a BOM\'d tool.json reports as a BOM rather than as corrupt JSON. Right for tool.json,\n' +
    'wrong for the one file whose raw bytes are the contract — hence this limb, on the Buffer, first.\n' +
    'PowerShell 5.1 writes a BOM by default from `Out-File -Encoding utf8`.\n' +
    'Fix:  node scripts/publish-catalog.mjs      (it rewrites the file without one)');
  process.exit(r.finish());
}

const parsed = readJson(catalogueAbs);
if (parsed.error) die(parsed.error + '\nEvery consumer parses this file; none of them can.');
const catalogue = parsed.value;

if (!Array.isArray(catalogue)) {
  r.fail(catalogueRel + ' is not a JSON array',
    'Found ' + (catalogue === null ? 'null' : typeof catalogue) + '. The sibling catalogue is a bare array and every reader\n' +
    'iterates one; any other top-level shape means no consumer sees any extension at all.');
  process.exit(r.finish());
}

/* 🔴 THE COVERAGE FLOOR. Zero rows satisfies every per-row limb below because
   there are no rows, and it is the single cheapest way for this guard to stop
   checking while still printing green. */
if (catalogue.length === 0) {
  r.fail('COVERAGE LOST — ' + catalogueRel + ' holds zero rows',
    'An empty catalogue satisfies every per-row assertion in this file vacuously, so passing here would mean this\n' +
    'guard had checked nothing while reporting success — and it would mean the storefront advertises no extensions.\n' +
    'Note that `publish-catalog.mjs --check` cannot catch this: regenerating an empty catalogue over an empty one\n' +
    'is not drift.');
  process.exit(r.finish());
}

/* The tools on disk, loaded through the one loader every gate reads through —
   NOT through the generator, which is the point. */
const { tools, errors } = loadAllTools(root);
if (errors.length) {
  console.error('CANNOT RUN — tool.json problems must be fixed before the catalogue can be graded:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(2);
}
const extensions = tools.filter((t) => t.surface === 'extension');
if (tools.length === 0) {
  r.fail('COVERAGE LOST — no tool.json was found under ' + root,
    'The catalogue holds ' + catalogue.length + ' row(s) and the tree holds no tool to justify any of them. That is a search\n' +
    'failure or a catalogue of ghosts, and both are red.');
  process.exit(r.finish());
}

r.pass('coverage', catalogue.length + ' row(s) · ' + extensions.length + ' extension tool(s) on disk · ' +
  KNOWN_STORES.length + ' store(s) in the schema vocabulary (' + KNOWN_STORES.join(', ') + ')');

r.check('every store in the vocabulary has a known host',
  hostless.length === 0,
  KNOWN_STORES.map((s) => s + '→' + STORE_HOSTS[s].join('/')).join(' · '),
  'scripts/schema/tool.schema.json declares store(s) this guard has no host for: ' + hostless.join(', ') + '.\n' +
  'A listing URL for such a store could not be verified, and an unverifiable URL published to a storefront is the\n' +
  'exact case limb 4 exists for. Add the store host to STORE_HOSTS in this file.');

/* ── LIMB 1: THE SET ──────────────────────────────────────────────────────── */
const published = catalogue
  .map((row, i) => (row && typeof row === 'object' && !Array.isArray(row) && typeof row.slug === 'string' ? row.slug : '#' + i))
  .sort();
const onDisk = extensions.map((t) => t.id).sort();

const missing = onDisk.filter((id) => !published.includes(id));
const extra = published.filter((id) => !onDisk.includes(id));

r.check('the catalogue publishes exactly the extensions on disk',
  missing.length === 0 && extra.length === 0,
  onDisk.join(', '),
  (missing.length ? 'on disk but NOT published: ' + missing.join(', ') + '\n' : '') +
  (extra.length ? 'published but NOT on disk: ' + extra.join(', ') + '\n' : '') +
  'This limb is re-derived from the tool.json files rather than from the generator, so it is the one that still\n' +
  'bites when the generator itself is what dropped a tool — a case where `publish-catalog.mjs --check` compares the\n' +
  'generator against its own output and reports up-to-date.\n' +
  'Run:  node scripts/publish-catalog.mjs');

/* ── LIMBS 2-4: THE ROWS ──────────────────────────────────────────────────── */
const byId = new Map(extensions.map((t) => [t.id, t]));
const shapeProblems = [];
const statusProblems = [];
const urlProblems = [];
const slugsSeen = new Map();
const unlistedRows = [];
let rowsChecked = 0;
let listedRows = 0;

const str = (v) => typeof v === 'string' && v.trim() !== '';

catalogue.forEach((row, i) => {
  const at = catalogueRel + '[' + i + ']';
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    shapeProblems.push(at + ' is ' + (Array.isArray(row) ? 'an array' : row === null ? 'null' : 'a ' + typeof row) +
      ', not an object. Every reader does row.slug.');
    return;
  }
  rowsChecked += 1;
  const label = str(row.slug) ? '"' + row.slug + '"' : '#' + i;

  if (!str(row.slug) || !RE_TOOL_ID.test(row.slug)) {
    shapeProblems.push(at + ' has slug ' + JSON.stringify(row.slug) + ', which is not the lowercase-kebab tool id shape ' +
      RE_TOOL_ID.source + '. The slug is what a git tag, a zip name and a storefront URL are all built from.');
  } else if (slugsSeen.has(row.slug)) {
    shapeProblems.push(at + ' repeats slug "' + row.slug + '", already used at index ' + slugsSeen.get(row.slug) +
      '. Consumers index by slug and silently keep whichever row they saw last.');
  } else {
    slugsSeen.set(row.slug, i);
  }

  if (!str(row.name)) shapeProblems.push(at + ' (' + label + ') has an empty or non-string `name` — the storefront renders it as the card heading.');
  if (!str(row.tagline)) shapeProblems.push(at + ' (' + label + ') has an empty or non-string `tagline` — it is the one line under the name, and the description the discovery pages publish.');

  /* platforms — non-empty, every value a store the schema knows. */
  const platforms = row.platforms;
  if (!Array.isArray(platforms) || platforms.length === 0) {
    shapeProblems.push(at + ' (' + label + ') has an empty or non-array `platforms`. An extension shipped to no store is not shipped.');
  } else {
    for (const p of platforms) {
      if (!str(p)) shapeProblems.push(at + ' (' + label + ') lists a non-string platform ' + JSON.stringify(p) + '.');
      else if (!KNOWN_STORES.includes(p)) {
        shapeProblems.push(at + ' (' + label + ') lists platform ' + JSON.stringify(p) + ', which is not a store ' +
          'scripts/schema/tool.schema.json declares (' + KNOWN_STORES.join(', ') + '). The storefront has no chip and no ' +
          'install route for a store nobody named.');
      }
    }
  }

  /* listings — an object keyed by exactly the platforms this row publishes. */
  const listings = row.listings;
  let listedHere = 0;
  if (listings === null || typeof listings !== 'object' || Array.isArray(listings)) {
    shapeProblems.push(at + ' (' + label + ') has a `listings` that is ' +
      (Array.isArray(listings) ? 'an array' : listings === null ? 'null' : 'a ' + typeof listings) +
      ', expected an object keyed by store name. `null` is not the way to say "no listings" — ' +
      'every store key must be present with a null value, so a reader can tell "no listing yet" from "store not targeted".');
  } else {
    const keys = Object.keys(listings).sort();
    const wanted = Array.isArray(platforms) ? platforms.slice().sort() : [];
    if (keys.join(',') !== wanted.join(',')) {
      shapeProblems.push(at + ' (' + label + ') publishes platforms [' + wanted.join(', ') + '] but listings keyed by [' +
        keys.join(', ') + ']. A store with no listing key is a store the storefront cannot render at all, and a listing ' +
        'key with no platform is a button for a build that does not exist.');
    }
    for (const [store, url] of Object.entries(listings)) {
      if (url === null) continue;
      listedHere += 1;
      if (!str(url)) {
        urlProblems.push(at + ' (' + label + ') has listings.' + store + ' = ' + JSON.stringify(url) +
          '. A listing is a store URL or null; an empty string is a link nobody can follow.');
        continue;
      }
      let parsedUrl = null;
      try { parsedUrl = new URL(url); } catch (_) { parsedUrl = null; }
      if (!parsedUrl || parsedUrl.protocol !== 'https:') {
        urlProblems.push(at + ' (' + label + ') has listings.' + store + ' = ' + JSON.stringify(url) +
          ', which is not an https:// URL. This file is public and every entry in it is a link somebody will follow.');
        continue;
      }
      const hosts = STORE_HOSTS[store];
      if (!Array.isArray(hosts) || hosts.length === 0) {
        urlProblems.push(at + ' (' + label + ') has a listing for store "' + store + '", which this guard has no host for, ' +
          'so the URL cannot be verified to point at that store at all.');
        continue;
      }
      if (!hosts.includes(parsedUrl.hostname)) {
        urlProblems.push(at + ' (' + label + ') has listings.' + store + ' on host ' + parsedUrl.hostname +
          ', but a ' + store + ' listing lives on ' + hosts.join(' or ') + '. A store button that leaves the store is either ' +
          'a typo or a landing page standing in for a listing that does not exist yet — and the second is the more expensive one.');
      }
    }
  }
  if (listedHere > 0) listedRows += 1;
  else unlistedRows.push(str(row.slug) ? row.slug : '#' + i);

  /* ── LIMB 3: STATUS ── */
  if (!PUBLISHED_STATUS.includes(row.status)) {
    statusProblems.push(at + ' (' + label + ') has status ' + JSON.stringify(row.status) + '; the published vocabulary is ' +
      PUBLISHED_STATUS.map((s) => '"' + s + '"').join(' and ') + '. The sibling apps catalogue publishes exactly these two and ' +
      'the storefront reads both with one reader, so a third spelling is silently skipped by every consumer while looking deliberate here.');
  } else if (row.status === 'live' && listedHere === 0) {
    statusProblems.push(at + ' (' + label + ') says status "live" while every listing is null. "live" is a promise to a stranger ' +
      'that a store page answers; with no listing there is nothing to open. It must be "preview" until a store URL exists.');
  } else if (row.status === 'preview' && listedHere > 0) {
    statusProblems.push(at + ' (' + label + ') says status "preview" while carrying ' + listedHere + ' store listing(s). The storefront ' +
      'renders no install route for a preview row, so a listing that exists would reach nobody.');
  }
});

if (rowsChecked === 0) {
  r.fail('COVERAGE LOST — not one entry in ' + catalogueRel + ' was an object this guard could check',
    catalogue.length + ' entr(ies) present. Every field assertion above was skipped, which is indistinguishable from a clean run.');
}

r.check('every row is completely shaped', shapeProblems.length === 0,
  rowsChecked + ' row(s) × slug, name, tagline, platforms, listings',
  shapeProblems.join('\n'));

r.check('status is true of the listings it sits beside', statusProblems.length === 0,
  rowsChecked + ' row(s) · ' + listedRows + ' with a store listing · ' + (rowsChecked - listedRows) + ' without',
  statusProblems.join('\n'));

r.check('every listing URL points at that store', urlProblems.length === 0,
  listedRows === 0 ? 'no listing URL is published yet — nothing to point wrong' : listedRows + ' listed row(s)',
  urlProblems.join('\n'));

/* ── LIMB 5: THE SOURCE'S OWN RULE ────────────────────────────────────────── */
/* Extension/Full_Screen_Shot/tool.json, NOTES.status, writes this down about
   itself: "shipping means listed in a store ... Flip this the day the first
   store URL exists, not the day the zip does." Nothing enforced it, so it was a
   sentence rather than a rule. The published status is derived from listings and
   cannot disagree with them — which means a tool.json drifting the other way is
   invisible in the catalogue, and this is where it becomes visible. */
const sourceProblems = [];
for (const t of extensions) {
  const listings = t.listings && typeof t.listings === 'object' && !Array.isArray(t.listings) ? t.listings : {};
  const listed = Object.values(listings).filter((v) => typeof v === 'string' && v.trim() !== '').length;
  if (t.status === 'shipping' && listed === 0) {
    sourceProblems.push(t.rel + '/tool.json says status "shipping" with every listing null. Its own NOTES.status says ' +
      '"shipping means listed in a store" — flip it the day the first store URL exists, not the day the zip does.');
  }
  if (t.status !== 'shipping' && t.status !== 'archived' && listed > 0) {
    sourceProblems.push(t.rel + '/tool.json carries ' + listed + ' store listing(s) while its status is "' + t.status +
      '". A tool a stranger can install from a store is shipping, whatever the work left to do on it.');
  }
}
r.check('every tool.json status agrees with its own listings', sourceProblems.length === 0,
  extensions.map((t) => t.id + '=' + t.status).join(', '),
  sourceProblems.join('\n'));

/* ── THE GAP ONLY THE OWNER CAN CLOSE ─────────────────────────────────────── */
/* Counted from the parsed rows, not from the tool.json set, because the message
   is about the rows this file publishes and --file can point at a catalogue the
   tools on disk do not derive. */
if (rowsChecked > 0 && listedRows === 0) {
  r.owner('no row in ' + catalogueRel + ' carries a store listing, so the whole catalogue publishes "' + PUBLISHED_STATUS[1] + '"',
    'Every row a storefront would render from this file is a card with no install route. That is the true state and this\n' +
    'guard will not fail the build over it — creating store listings is owner work, and a build permanently red on work\n' +
    'only one person can do teaches everyone that red is negotiable.\n' +
    'Unlisted: ' + unlistedRows.join(', '));
}

r.blank();
r.note('drift — are these bytes what the tool.json files derive? — is graded separately:');
r.note('  node scripts/publish-catalog.mjs --check');
r.note('Neither command implies the other. This one cannot see a stale file; that one cannot see an empty catalogue.');

process.exit(r.finish({
  warningsAsErrors: args.bool('warnings-as-errors'),
  ownerActionsFatal: args.bool('owner-actions-fatal'),
}));
