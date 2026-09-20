#!/usr/bin/env node
/* check-listing-assets.mjs — the PICTURES in a store listing, graded on their
   pixels rather than on their existence.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-listing-assets.mjs fullshot
     node scripts/check-listing-assets.mjs --all

   ── WHAT WAS UNGUARDED BEFORE THIS FILE, MEASURED 2026-09-20 ───────────────
   `check-store-metadata.mjs` grades the listing TEXT field by field and sourced
   limit by sourced limit, and its screenshot limb counts images — "Count only,
   deliberately: dimensions and colour depth are asserted nowhere because
   nothing here has ever read a store's own written limit for them, and this
   guard REFUSES a limit with no source." That sentence was correct when it was
   written and it is the reason this file exists rather than an edit to that
   one: the limits have now been read, from the stores' own pages, with URLs and
   a fetch date, and they live in `scripts/store-graphics.json`. A number with a
   source can be enforced; that was the only thing missing.

   So the split between the two guards is a RELATIONSHIP, not a duplication:

     check-store-metadata.mjs  the listing TEXT, the directory topology, the
                               store/target/vocabulary triangle, and "is there
                               at least one screenshot at all".
     this file                 every listing PICTURE: does the required asset
                               exist, is it a PNG, is it the exact size the
                               store states, is its colour type one the store
                               accepts, and is the screenshot COUNT inside the
                               band all three stores leave open.

   ── THE THREE THINGS THIS CATCHES THAT NOTHING ELSE COULD ──────────────────
   1. A MISSING REQUIRED ASSET. Chrome refuses a submission with no 440x280
      promotional tile and no 128x128 icon; Edge refuses one with no 1:1 logo.
      Until 2026-09-20 no slot for any of the three existed in the tree, so
      "missing" was indistinguishable from "not a thing we do".
   2. A WRONG SIZE. "1276 pixels wide because I cropped it by hand" is an upload
      rejection, not a nag, and it is invisible in a file listing. Every asset's
      IHDR is read and compared against the sourced number.
   3. A WRONG COLOUR TYPE. Chrome's 128x128 icon is specified with sixteen
      pixels of TRANSPARENT padding per side — unrepresentable in colour type 2.
      A file that is right in every other respect and has no alpha channel looks
      perfect in a viewer.

   ── FAIL, NOT OWNER, AND THE DOCTRINE THIS FOLLOWS ─────────────────────────
   check-store-metadata.mjs states the rule this file obeys: "What is
   owner-gated is CREATING a listing, not KEEPING one." Creating these assets
   was owner-shaped while nothing could make them; they are now DERIVED by
   `scripts/render-extension-graphics.mjs` from the extension's own icon and its
   own accent colours, one command, no judgement. Deleting one, or committing
   one at the wrong size, is therefore a FAILURE at any `served` state — not an
   OWNER print that would let the slot silently empty again. A tool that adds a
   `store/` listing tree runs the renderer once; that is the whole cost.

   ── A LIMIT WITH NO SOURCE IS REFUSED, NOT ENFORCED ────────────────────────
   Every row of `store-graphics.json` is checked for an https `source` and a
   `fetched` date BEFORE any pixel is read, and a row without them FAILS. An
   invented limit fires on CORRECT input — this factory has already rejected its
   own fixture at 129 characters against a made-up "120 or fewer".

   ── AND THE EFFECTIVE SCREENSHOT BAND IS RECOMPUTED, NOT TRUSTED ───────────
   `screenshots.effective` in the spec is a convenience for the capture script.
   It is also a second declaration of a fact the three `perStore` blocks already
   carry, so this guard DERIVES it from those blocks and fails if the two
   disagree. That is the same treatment the store/target/vocabulary triangle
   already gets next door, for the same reason.

   ⚠️ WHAT IT CANNOT SEE: whether a screenshot shows the product, whether it is
   honest, or whether a store would accept the listing. It grades pixels against
   sourced numbers.

   Exit codes: 0 everything agrees · 1 something disagrees · 2 could not run. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, loadAllTools } from './lib/toolinfo.mjs';
import { readHeader } from './lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_REL = 'scripts/store-graphics.json';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['all', 'repo-root']);
const root = repoRoot(args);

/* Resolved against THIS FILE, not --repo-root: a fixture tree must not be able
   to supply its own idea of what a store requires. Same reasoning, same words,
   as check-store-metadata.mjs's schema resolution. */
const specAbs = path.join(HERE, 'store-graphics.json');
if (!fs.existsSync(specAbs)) {
  die(SPEC_REL + ' does not exist, so every asset check below would range over nothing.');
}
let SPEC;
try { SPEC = JSON.parse(fs.readFileSync(specAbs, 'utf8')); }
catch (e) { die('could not parse ' + SPEC_REL + ': ' + e.message); }

let tools;
if (args.bool('all')) {
  const all = loadAllTools(root);
  if (all.errors.length) die('tool.json problems, so the tool set is not the tree:\n' + all.errors.map((e) => '  - ' + e).join('\n'));
  tools = all.tools;
} else {
  tools = [resolveTool(root, args.positional[0])];
}
if (!tools.length) die('no tool resolved — nothing to grade.');

const r = new Report('check-listing-assets · ' + tools.map((t) => t.id).join(', '));

/* ── 0. the spec itself, before any pixel ────────────────────────────────── */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function gradeProvenance(label, row) {
  let ok = true;
  if (typeof row?.source !== 'string' || !row.source.startsWith('https://')) {
    r.fail(label + ' carries an https source',
      'the row declares ' + JSON.stringify(row?.source) + '. An invented limit fires on CORRECT input.\n' +
      'Add the URL the number was read from, or delete the row.');
    ok = false;
  }
  if (typeof row?.fetched !== 'string' || !ISO_DATE.test(row.fetched)) {
    r.fail(label + ' carries a fetch date',
      'the row declares ' + JSON.stringify(row?.fetched) + '. A store page that was read on no particular\n' +
      'day cannot be re-read to see whether it moved.');
    ok = false;
  }
  return ok;
}

const shots = SPEC.screenshots;
if (!shots || typeof shots !== 'object' || !shots.perStore || !shots.effective) {
  die(SPEC_REL + ' declares no screenshots.perStore / screenshots.effective block.');
}
if (!Array.isArray(SPEC.assets) || !SPEC.assets.length) {
  die(SPEC_REL + ' declares no `assets`, so every asset limb below would range over nothing.');
}

let specOk = true;
for (const [store, row] of Object.entries(shots.perStore)) {
  if (!gradeProvenance('screenshots.perStore.' + store, row)) specOk = false;
}
for (const a of SPEC.assets) {
  if (!gradeProvenance('assets["' + a.id + '"]', a)) specOk = false;
}

/* ── 0b. the effective band, DERIVED and then compared ───────────────────── */
const perStore = Object.entries(shots.perStore);
const sizeKey = (wh) => wh[0] + 'x' + wh[1];
let commonSizes = null;
let derivedMin = 0, derivedMax = Infinity;
const maxFrom = [];
for (const [store, row] of perStore) {
  const keys = new Set((row.sizes || []).map(sizeKey));
  commonSizes = commonSizes === null ? keys : new Set([...commonSizes].filter((k) => keys.has(k)));
  if (row.required && Number.isInteger(row.min)) derivedMin = Math.max(derivedMin, row.min);
  if (Number.isInteger(row.max) && row.max < derivedMax) { derivedMax = row.max; maxFrom.length = 0; maxFrom.push(store); }
  else if (Number.isInteger(row.max) && row.max === derivedMax) maxFrom.push(store);
}
const eff = shots.effective;
const declaredSizes = new Set((eff.sizes || []).map(sizeKey));
r.check('screenshots.effective.sizes is the intersection of the per-store lists',
  commonSizes && commonSizes.size === declaredSizes.size && [...declaredSizes].every((k) => commonSizes.has(k)),
  [...declaredSizes].join(', '),
  'declared [' + [...declaredSizes].join(', ') + '], derived [' + [...(commonSizes || [])].join(', ') + '].\n' +
  'Two declarations of one fact. The per-store blocks carry the sources, so they are the truth.');
r.check('screenshots.effective.min is the largest REQUIRED per-store minimum',
  eff.min === derivedMin, String(eff.min),
  'declared ' + eff.min + ', derived ' + derivedMin + ' from the stores that require a screenshot at all.');
r.check('screenshots.effective.max is the smallest stated per-store maximum',
  eff.max === derivedMax, eff.max + ' (from ' + maxFrom.join(' + ') + ')',
  'declared ' + eff.max + ', derived ' + derivedMax + '.');

if (!specOk) {
  r.blank();
  r.note('The spec rows above are unsourced, so the pixel checks below are not evidence either way.');
}

/* ── the tools ───────────────────────────────────────────────────────────── */
const SHOT_EXT = /\.(png|jpe?g)$/i;
let assetsGraded = 0;

for (const tool of tools) {
  const sm = tool.raw?.storeMetadata ?? tool.storeMetadata;
  if (!sm || typeof sm !== 'object' || typeof sm.sharedDir !== 'string' || !sm.sharedDir) {
    /* A tool with no store listing tree ships to no store; that is legitimate
       and is check-store-metadata.mjs's subject, not this one's. */
    r.note(tool.rel + ': no storeMetadata.sharedDir — no listing tree, nothing to grade.');
    continue;
  }
  const sharedRel = sm.sharedDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const storeRootRel = path.posix.dirname(sharedRel);
  const storeRootAbs = path.join(tool.dirAbs, storeRootRel);
  if (!fs.existsSync(storeRootAbs)) {
    r.note('NO TREE: ' + tool.rel + '/' + storeRootRel + ' does not exist — creating a listing is owner work.');
    continue;
  }

  /* ── 1. every declared asset, by its sourced size and colour type ─────── */
  for (const asset of SPEC.assets) {
    const rel = storeRootRel + '/' + asset.path;
    const abs = path.join(tool.dirAbs, asset.path.split('/').reduce((p, s) => path.join(p, s), storeRootRel));
    const label = tool.rel + '/' + rel;
    const need = asset.width + 'x' + asset.height;
    const by = (asset.requiredBy || []).join(', ');
    assetsGraded++;

    if (!fs.existsSync(abs)) {
      r.fail(label + ' exists',
        'required by ' + (by || 'nobody, and yet declared') + ' at ' + need + '.\n' +
        'Source: ' + asset.source + ' (fetched ' + asset.fetched + ')\n' +
        (asset.verbatim ? 'Verbatim: ' + asset.verbatim + '\n' : '') +
        'It is DERIVED — `node scripts/render-extension-graphics.mjs ' + tool.id + '` writes it from the\n' +
        'extension\'s own icon and accent colours. Creating a listing is owner work; keeping one is not.');
      continue;
    }
    let head;
    try { head = readHeader(fs.readFileSync(abs)); }
    catch (e) {
      r.fail(label + ' is a readable PNG', String(e && e.message || e) +
        '\nEvery store states PNG for this asset, and a file this guard cannot read is a file the store cannot either.');
      continue;
    }
    if (head.width !== asset.width || head.height !== asset.height) {
      r.fail(label + ' is exactly ' + need,
        'it is ' + head.width + 'x' + head.height + '.\nSource: ' + asset.source + ' (fetched ' + asset.fetched + ')\n' +
        'Wrong dimensions are an upload rejection, not a warning, and nothing in a file listing shows them.');
      continue;
    }
    if (!asset.colorTypes.includes(head.colorType)) {
      r.fail(label + ' has an accepted PNG colour type',
        'it is colour type ' + head.colorType + ' and this asset accepts [' + asset.colorTypes.join(', ') + '].\n' +
        (asset.colorTypes.length === 1 && asset.colorTypes[0] === 6
          ? 'Colour type 6 carries the alpha channel the transparent padding needs; type 2 cannot express it,\n' +
            'so the file looks correct in a viewer and is wrong in the listing.\n'
          : '') +
        'Source: ' + asset.source + ' (fetched ' + asset.fetched + ')');
      continue;
    }
    if (head.bitDepth !== 8) {
      r.fail(label + ' is 8 bits per channel', 'the IHDR says bit depth ' + head.bitDepth + '.');
      continue;
    }
    r.pass(label, need + ', colour type ' + head.colorType + ', ' + head.bytes + ' bytes' +
      '  [required by: ' + (by || 'nobody') + ']');
  }

  /* ── 2. the shared screenshot set ─────────────────────────────────────── */
  const shotDirRel = sharedRel + '/' + (shots.dirUnderShared || 'screenshots');
  const shotDirAbs = path.join(tool.dirAbs, shotDirRel.split('/').join(path.sep));
  const shotLabel = tool.rel + '/' + shotDirRel;
  if (!fs.existsSync(shotDirAbs)) {
    r.fail(shotLabel + ' exists',
      'the shared screenshot directory is absent. check-store-metadata.mjs requires its README; this\n' +
      'guard requires the directory itself, because losing it loses the record that a listing needs them.');
    continue;
  }
  const files = fs.readdirSync(shotDirAbs, { withFileTypes: true })
    .filter((e) => e.isFile() && SHOT_EXT.test(e.name)).map((e) => e.name).sort();
  assetsGraded += files.length;

  r.check(shotLabel + ' holds at least ' + eff.min + ' image(s)',
    files.length >= eff.min, files.length + ' image(s)',
    'it holds ' + files.length + '. Chrome states "at least 1—and preferably the maximum allowed 5".\n' +
    'Source: ' + shots.perStore.chrome.source + ' (fetched ' + shots.perStore.chrome.fetched + ')');
  r.check(shotLabel + ' holds at most ' + eff.max + ' image(s)',
    files.length <= eff.max, files.length + ' image(s)',
    'it holds ' + files.length + ', and the smallest stated maximum across the three stores is ' + eff.max +
    ' (' + maxFrom.join(' + ') + ').\nOne shared set is uploaded to all three, so the strictest ceiling is the one that binds.');

  for (const name of files) {
    const abs = path.join(shotDirAbs, name);
    const label = shotLabel + '/' + name;
    if (!/\.png$/i.test(name)) {
      /* JPEG is accepted by all three stores for screenshots, so this is a note
         and not a failure — but this factory emits PNG, so a JPEG here came
         from somewhere else and that is worth saying out loud. */
      r.note(label + ' is not a PNG. All three stores accept JPEG, so this is legal; it is also not\n' +
        '        something any script in this repository produces.');
      continue;
    }
    let head;
    try { head = readHeader(fs.readFileSync(abs)); }
    catch (e) { r.fail(label + ' is a readable PNG', String(e && e.message || e)); continue; }
    const key = head.width + 'x' + head.height;
    if (!declaredSizes.has(key)) {
      r.fail(label + ' is a size all three stores accept',
        'it is ' + key + ' and the one size common to Chrome, Edge and AMO is ' + [...declaredSizes].join(', ') + '.\n' +
        'Chrome: ' + shots.perStore.chrome.source + '\nEdge: ' + shots.perStore.edge.source +
        '\nAMO: ' + shots.perStore.firefox.source + '\n(all fetched ' + shots.perStore.chrome.fetched + ')\n' +
        'A single set is uploaded to all three, so a size only one of them takes is a set that cannot be shared.');
      continue;
    }
    r.pass(label, key + ', colour type ' + head.colorType + ', ' + head.bytes + ' bytes');
  }
}

/* A finding outranks coverage loss, and the order is load-bearing: the reach
   check running first would replace a precise failure with the generic "zero
   assets were graded", which says nothing about what to do. Same shape, same
   reasoning, as check-store-metadata.mjs's closing block. */
if (assetsGraded === 0 && r.fails.length === 0) {
  die('zero listing assets were graded across ' + tools.length + ' tool(s).\n' +
    'The subject set is empty, so a pass here would mean nothing.');
}

r.blank();
r.note(assetsGraded + ' listing asset(s) graded across ' + tools.length + ' tool(s), against ' + SPEC_REL + '.');
if (Array.isArray(SPEC.unverified) && SPEC.unverified.length) {
  r.note(SPEC.unverified.length + ' store graphic rule(s) recorded as UNVERIFIED or OPTIONAL and deliberately not enforced.');
}

process.exit(r.finish());
