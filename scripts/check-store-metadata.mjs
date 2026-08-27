/* check-store-metadata.mjs — one directory per STORE, and the store axis is not
   the build axis.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-store-metadata.mjs fullshot
     node scripts/check-store-metadata.mjs --all

   🔴 TWO BUILDS, THREE STORES. Measured 2026-08-20 by running the packer:
   `pack.mjs` emits exactly `chromium` and `firefox`, and `tool.json` declares
   `targets.chromium.stores = ["chrome","edge"]`. The chromium zip ships to
   Chrome Web Store AND Edge Add-ons byte-identical — `release.yml` says so in as
   many words, "the identical file goes to both".

   So there are two artifacts and three listings, and they are different axes.
   A directory tree that put a build under each store name would store two
   artifacts three times. A directory tree that puts a LISTING under each store
   name stores three genuinely different things: the name limits are 75 / 45 /
   50, the store icons are 128x128 / 300x300 / 32+64, Chrome takes one category
   and AMO takes two, and each store issues its own permanent id.

   ── WHY THE `target` FIELD IS THE LOAD-BEARING ONE ──────────────────────────
   `chrome` and `edge` both name `chromium`. That is what makes the shared build
   a DECLARATION rather than a coincidence: this guard asserts every store's
   `target` is a real entry of `targets`, and that every target is claimed by at
   least one store. A third build cannot appear behind a third store name without
   `targets` gaining a third entry, in the open, in a diff.

   ── THE STORE VOCABULARY IS NOT DECLARED IN tool.json ───────────────────────
   It comes from `scripts/schema/tool.schema.json` -> `properties.listings
   .properties`, which `check-catalog.mjs` already treats as authoritative for
   its host table. This guard derives the SAME set and holds three declarations
   to each other — the schema, `storeMetadata.stores`, and the tool's own
   `listings`. A fourth list of store names would be the second declaration and
   the first to drift, which is the defect this repository names in its own
   README: "a hand-typed row is a second place for the same fact to be written,
   and the second place is the one that goes stale."

   ── THE PRINT / FAIL SPLIT IS A RELATIONSHIP, NOT A MOOD ────────────────────
     directory missing, store `served: false`   -> PRINT   (this is today)
     directory missing, store `served: true`    -> FAIL
     a non-null `listings.<store>` URL, `served: false` -> FAIL (see §1b)
     directory present but a required file empty-> FAIL, at any served state
     a directory no store declares              -> FAIL    (an orphan listing)
     a limit with no `source`                   -> FAIL    (see below)
     a URL file that is not an https URL        -> OWNER while unserved, FAIL once served
     a URL file that disagrees with identity.json-> FAIL, at any served state
     screenshots/ with no images                -> OWNER while unserved, FAIL once served
     zero stores graded                         -> CANNOT RUN, exit 2

   What is owner-gated is CREATING a listing, not KEEPING one. A guard that only
   printed would let anyone empty `store/chrome/title.txt` and stay green.

   ── A LIMIT WITH NO SOURCE IS REFUSED, NOT ENFORCED ─────────────────────────
   Every `max`/`min` in `storeMetadata` must carry a URL. An invented limit fires
   on CORRECT input, and this factory has already rejected its own fixture at 129
   characters against a made-up "120 or fewer". Three real limits are recorded as
   `_unverified` and deliberately NOT enforced — Edge's 45-character name, AMO's
   50, and Chrome's long-description maximum — because none could be read from
   the store's own documentation. MDN states two of them; MDN is a secondary
   source for another vendor's rule.

   ⚠️ WHAT IT CANNOT SEE: whether the listing copy is any good, and whether the
   store would accept it. It checks that the fields exist, are non-empty, and sit
   inside the limits somebody actually sourced.

   Exit codes: 0 everything agrees · 1 something disagrees · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, loadAllTools, readText } from './lib/toolinfo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_REL = 'scripts/schema/tool.schema.json';

/* Files every store listing needs, whatever the store. The NAMES are shared on
   purpose even where the stores' own vocabulary differs (AMO calls the short one
   a "summary"): what differs between stores is the LIMITS, not which fields
   exist, and one vocabulary is what lets a reader diff two listings. */
const REQUIRED_PER_STORE = ['title.txt', 'short-description.txt', 'long-description.txt', 'category.txt'];
/* Material all three stores accept, kept once. 1280x800 is the only screenshot
   size Chrome, Edge and AMO all take — measured from their own docs. */
const REQUIRED_SHARED = ['privacy-policy-url.txt', 'support-url.txt', 'screenshots/README.md'];

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['all', 'repo-root']);
const root = repoRoot(args);

/* 🔴 `--all` HAD NEVER RUN, AND IT IS IN THIS FILE'S OWN USAGE LINE.
   FOUND AND FIXED 2026-08-22 by running the documented invocation. loadAllTools
   returns `{ tools, errors, warnings, byId }` — an OBJECT, with no `.length` —
   so `!tools.length` was `!undefined`, always true, and
   `node scripts/check-store-metadata.mjs --all` died with
   "CANNOT RUN — no tool resolved — nothing to grade." on a tree holding one
   perfectly good tool. Every other caller in scripts/ destructures — the
   searchable form is `loadAllTools(root)` preceded by `const { tools`, and
   `grep -n "= loadAllTools(root)" scripts/*.mjs` lists every caller on the day
   you run it, which is what a line number cannot do. Six did (check-catalog,
   discover, gen-catalog, lint, new-tool, publish-catalog); this file and
   check-store-packages.mjs did not.
   ⚠️ CORRECTED 2026-08-22, later pass: this sentence used to cite each caller
   by line — "lint.mjs :148, discover.mjs:66, check-catalog.mjs:219,
   gen-catalog.mjs:52, new-tool.mjs:92, publish-catalog.mjs:193". Five were
   exact; `publish-catalog.mjs:193` was never right in ANY state a reader can
   check out. The one anchor that cannot rot is HEAD, so use it:
   `git show HEAD:scripts/publish-catalog.mjs | grep -n "= loadAllTools(root)"`
   -> 137. It has only moved further down since, because publish-catalog.mjs was
   being edited by another pass while this comment was written and by this one
   afterwards. No working-tree number is quoted here on purpose: the grep above
   answers for whatever day it is run on. A citation into a moving file is the
   defect this file's own fix exists to teach. check-store-packages.mjs was carrying the identical `--all`
   bug and it was fixed the same day; see its own note. It exits 2 rather than 0, so it never
   passed over an empty subject — but a documented flag that cannot run is a
   record of a capability that does not exist.
   `errors` is surfaced rather than dropped, on lint.mjs's shape: a tool.json
   that will not load must not read as a tool that is not there. */
let tools;
if (args.bool('all')) {
  const all = loadAllTools(root);
  if (all.errors.length) {
    die('tool.json problems, so the tool set is not the tree:\n' + all.errors.map((e) => '  - ' + e).join('\n'));
  }
  tools = all.tools;
} else {
  tools = [resolveTool(root, args.positional[0])];
}
if (!tools.length) die('no tool resolved — nothing to grade.');

/* ── the store vocabulary, from the schema ──────────────────────────────────
   Read relative to THIS FILE rather than to --repo-root, for the reason
   check-catalog.mjs already states about the same file: the vocabulary belongs
   to the TOOLCHAIN while the tree is the SUBJECT being graded. Resolving it
   against the subject would mean a fixture tree could supply its own idea of
   which stores exist, which is the second declaration this guard exists to
   prevent. */
const schemaAbs = path.join(HERE, 'schema', 'tool.schema.json');
if (!fs.existsSync(schemaAbs)) {
  die(SCHEMA_REL + ' does not exist, so the store vocabulary is derived from nothing.\n' +
    'That file is where the store ids live; without it this guard would accept any set of names.');
}
let VOCAB;
try {
  const schema = JSON.parse(fs.readFileSync(schemaAbs, 'utf8'));
  VOCAB = Object.keys(schema?.properties?.listings?.properties ?? {});
} catch (e) {
  die('could not parse ' + SCHEMA_REL + ': ' + e.message);
}
if (!VOCAB.length) {
  die(SCHEMA_REL + ' declares no store ids under properties.listings.properties.\n' +
    'An empty vocabulary would make every storeMetadata block trivially correct.');
}

const r = new Report('check-store-metadata · ' + tools.map((t) => t.id).join(', '));
r.note('store vocabulary, from ' + SCHEMA_REL + ': ' + VOCAB.join(', '));

let storesGraded = 0;
let filesChecked = 0;

const charCount = (text) => [...text.trim()].length; // code points, not UTF-16 units

/* ── 🔴 THE SHARED FILES GET GRADED ON CONTENT, NOT ON EXISTENCE ────────────
   ADDED 2026-08-22, and the defect that produced it was live in this tree for
   the whole life of the limb above. `privacy-policy-url.txt` was checked for
   existence and non-blankness only — so it printed

     PASS  Extension/Full_Screen_Shot/store/_shared/privacy-policy-url.txt

   while the file's entire content was the word NOT-YET-HOSTED plus a comment
   saying "No store submission can proceed until it is reachable". A file whose
   only purpose is to hold a URL passed a green gate while holding the refusal
   of one, and `publish/identity.json` had carried the real URL since
   2026-08-21. Existence checks on a file whose whole content IS the fact are
   the assertion-that-cannot-fail shape this repository names in its own README.

   The shape assertion is not invented here — `templates/tool/publish/
   preflight.mjs` already grades identity.json's privacyPolicyUrl with
   /^https:\/\// and a placeholder test. This is the same test, moved to the
   copy a human actually pastes into three dashboards.

   TWO DECLARATIONS OF ONE FACT, SO THEY ARE HELD TO EACH OTHER. The URL exists
   in `publish/identity.json` AND in this file. That is the duplication this
   guard exists to catch everywhere else (the schema/storeMetadata/listings
   triangle, and STORE-LISTING.md against store/chrome), so it gets the same
   treatment rather than an exception.

   AND IT DOES NOT GO PERMANENTLY RED ON OWNER WORK. Hosting a policy is owner
   work. So an unfilled URL is an OWNER verdict while no store is served, and a
   FAILURE the moment one is — the same print/fail split `served` already
   governs for a missing directory. What it can never be again is a PASS. */
const SHARED_URL_FILES = {
  /* file -> the publish/identity.json field it must agree with, or null */
  'privacy-policy-url.txt': 'privacyPolicyUrl',
  'support-url.txt': null,
};

/* The file may carry `#` comment lines — FullShot's does, and the dated
   correction of a stale record belongs beside the value it corrects. The URL is
   the first line that is neither blank nor a comment, and there must be exactly
   one of those: a store field takes one URL, and a second line is a second
   answer to a question that has one. */
function urlLinesOf(body) {
  return body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}
const isHttpsUrl = (v) => /^https:\/\/[^\s<>"']+$/.test(v);

/* A read that FAILS is not a result that is EMPTY — the rule policy-check and
   lib/toolinfo.mjs both state above their own walks. An identity.json that does
   not parse would otherwise disarm the agreement check below in silence and
   leave every URL file graded as "nothing to compare against", so it is a
   FAILURE by name rather than a null.

   🔴 CORRECTED 2026-08-22: PARSING IS NOT THE ONLY WAY THAT READ CAN FAIL.
   Until this line, the limb caught only a `JSON.parse` throw. `null`, `[]`,
   `"x"` and `3` are all valid JSON and none of them throws — and every one of
   them makes `identity[field]` `undefined`, which `gradeUrlFile` below reads as
   "identity.json declares no URL". That is the disarmed-in-silence state this
   very comment forbids, reached by the one door it did not watch. Anything that
   is not a JSON OBJECT is therefore the same named failure.

   The marker is a Symbol, not the `_unparseable` PROPERTY it used to be: a
   property name can be spelled inside identity.json itself, so a hand-edited
   file could carry `"_unparseable": "..."` and forge this failure. A Symbol key
   cannot appear in parsed JSON at all, so the marker can only come from here.

   policy-check.mjs grades the same file with the same two limbs (it fails
   "publish/identity.json parses" and "publish/identity.json is a JSON object",
   at its `const idRel = 'publish/identity.json'` block). That is deliberate
   duplication, not redundancy to be removed: this guard is run on its own by
   CI and by hand, and a check that only holds when a DIFFERENT script is also
   run is not a check this script can rely on. */
const UNUSABLE = Symbol('identity.json unusable');
function identityOf(tool) {
  const p = path.join(tool.dirAbs, 'publish', 'identity.json');
  if (!fs.existsSync(p)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return { [UNUSABLE]: 'it exists and is not valid JSON: ' + e.message }; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const what = parsed === null ? 'null' : Array.isArray(parsed) ? 'an array' : 'a JSON ' + typeof parsed;
    return { [UNUSABLE]: 'it is valid JSON but not a JSON object — it parses as ' + what + ',\n' +
      'so every field this guard reads from it is `undefined`.' };
  }
  return parsed;
}

function gradeUrlFile(label, body, identityField, identity, anyServed) {
  const lines = urlLinesOf(body);
  if (lines.length > 1) {
    return r.fail(label + ' holds one URL',
      'it holds ' + lines.length + ' non-comment lines: ' + lines.map((l) => '"' + l + '"').join(', ') + '\n' +
      'This file is pasted into a store field verbatim. Two lines is two answers.');
  }
  const found = lines[0] || '';
  const declared = identity && !identity[UNUSABLE] && identityField
    ? String(identity[identityField] ?? '') : '';

  if (!isHttpsUrl(found)) {
    const why = label + ' holds "' + found + '", which is not an https URL.\n' +
      'Every store requires a reachable https URL here and pastes it into a public listing.';
    if (anyServed) {
      return r.fail(label + ' holds an https URL',
        why + '\nA store is `served: true` — the listing is live and this field is already public.');
    }
    if (declared) {
      return r.fail(label + ' agrees with publish/identity.json ' + identityField,
        why + '\npublish/identity.json already declares ' + identityField + ' = "' + declared + '".\n' +
        'Two declarations of one fact have drifted, and this is the copy a human pastes into the store\n' +
        'dashboards. Put the URL here, or clear identity.json if it is not really hosted.');
    }
    return r.owner(label + ' is not filled in yet',
      why + '\nNo store is served yet, so this prints rather than blocking the build. Host the policy,\n' +
      'then write the URL here AND in publish/identity.json' + (identityField ? '.' + identityField : '') + '.');
  }

  if (declared && declared !== found) {
    return r.fail(label + ' agrees with publish/identity.json ' + identityField,
      'store file: "' + found + '"\nidentity.json: "' + declared + '"\n' +
      'One URL, two files, two values. The store dashboards get this file; every publish/ script gets\n' +
      'identity.json. Divergent policy URLs across stores are themselves a policy-mismatch finding.');
  }
  if (declared) return r.pass(label, found + ' — agrees with publish/identity.json ' + identityField);
  return r.pass(label, found);
}

/* ── 🔴 AND THE SCREENSHOTS DIRECTORY IS GRADED ON IMAGES, NOT ON ITS README ──
   REQUIRED_SHARED lists `screenshots/README.md`, so the whole screenshot
   requirement was satisfied by a text file explaining that there are no
   screenshots. `store/_shared/README.md` calls that state a hard blocker in as
   many words — "No store accepts a listing without at least one screenshot, and
   there are none" — and nothing could see it. The day a row flips to
   `served: true`, CI would have stayed green over zero images.

   Count only, deliberately: dimensions and colour depth are asserted nowhere
   because nothing here has ever read a store's own written limit for them, and
   this guard REFUSES a limit with no source (see above). One image is the claim
   that can be sourced — every store's submission form requires it. */
const SCREENSHOT_EXT = /\.(png|jpe?g)$/i;
function gradeScreenshots(rel, abs, anyServed) {
  const dir = path.join(abs, 'screenshots');
  if (!fs.existsSync(dir)) return; // the README limb above already failed by name
  const shots = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SCREENSHOT_EXT.test(e.name)).map((e) => e.name);
  if (shots.length) return r.pass(rel + '/screenshots holds at least one image', shots.length + ' image(s): ' + shots.slice(0, 5).join(', '));
  if (anyServed) {
    return r.fail(rel + '/screenshots holds at least one image',
      'the directory holds no .png/.jpg, and a store row is `served: true`.\n' +
      'No store accepts a listing without at least one screenshot, so a live listing with none here means\n' +
      'either the images were uploaded and never committed — the listing is now unreproducible — or the\n' +
      'row was flipped to served before the listing existed.');
  }
  return r.owner(rel + '/screenshots holds no images yet',
    'zero .png/.jpg in the directory. No store row is served, so this prints rather than blocking.\n' +
    'Capturing them is owner work; every store requires at least one before a listing can be submitted.');
}

for (const tool of tools) {
  const sm = tool.raw?.storeMetadata ?? tool.storeMetadata;
  if (!sm || typeof sm !== 'object') {
    /* A tool that ships to no store is legitimate. A tool that declares
       `listings` or `targets` and no storeMetadata is a tool whose listings
       nothing checks. */
    if (tool.targets || tool.listings) {
      r.fail(tool.rel + ' declares storeMetadata',
        'tool.json has `targets` and/or `listings` but no `storeMetadata` block, so its store listings are\n' +
        'checked by nothing. Add one row per store id (' + VOCAB.join(', ') + ').');
    } else {
      r.note(tool.rel + ': no targets and no listings — ships to no store, nothing to grade.');
    }
    continue;
  }

  const rows = sm.stores;
  if (!rows || typeof rows !== 'object' || Array.isArray(rows) || !Object.keys(rows).length) {
    r.fail(tool.rel + ' storeMetadata.stores is a non-empty object',
      'found ' + (Array.isArray(rows) ? 'an array' : rows === undefined ? 'nothing' : typeof rows) + '.\n' +
      'The row set IS the subject of this guard; empty means every check below ranges over nothing.');
    continue;
  }

  /* ── 1. three declarations of the store set, held to each other ────────── */
  const declared = Object.keys(rows).sort();
  const vocab = [...VOCAB].sort();
  const listings = Object.keys(tool.listings ?? {}).sort();

  r.check(tool.rel + ' storeMetadata.stores matches the schema vocabulary',
    declared.join() === vocab.join(),
    declared.join(', '),
    'storeMetadata.stores is [' + declared.join(', ') + '] and the schema vocabulary is [' + vocab.join(', ') + '].\n' +
    'These are two declarations of one fact. Add the store to both, or to neither.');

  if (listings.length) {
    r.check(tool.rel + ' listings matches the schema vocabulary',
      listings.join() === vocab.join(),
      listings.join(', '),
      'tool.json listings is [' + listings.join(', ') + '] and the schema vocabulary is [' + vocab.join(', ') + '].');
  }

  /* ── 1b. 🔴 A LIVE LISTING URL AND `served` ARE ONE FACT ────────────────
     MEASURED 2026-08-27, before this limb existed: a tree with
     `listings.chrome` set to a live /detail/ URL and
     `storeMetadata.stores.chrome.served: false` exited 0 — "25 passed · 1 owner
     action(s)" — with the directory and screenshot limbs still PRINTing. Every
     limb above arms on `served`; `listings` is the field a human actually fills
     in the day a listing goes live. Nothing held them to each other, so the one
     field that arms this guard was the one field nobody had to touch.

     ONE-DIRECTIONAL ON PURPOSE. `served: true` with a null URL is the truthful
     state while a submission sits in review, and it arms MORE than it disarms.
     The reverse — a URL with `served: false` — is the only direction that turns
     a check off, so it is the only direction that fails.

     ⚠️ ZERO ANTECEDENTS TODAY: all three listings are null, so this ranges over
     nothing on main and would pass written backwards. The count is printed
     below rather than left silent, and the mutation fixtures are the evidence. */
  let listed = 0;
  for (const store of VOCAB) {
    const url = (tool.listings ?? {})[store];
    if (url === null || url === undefined || String(url).trim() === '') continue;
    listed++;
    r.check('listings.' + store + ' is live, so storeMetadata.stores.' + store + '.served is true',
      rows[store]?.served === true, String(url),
      'tool.json declares listings.' + store + ' = ' + JSON.stringify(url) + ' — a public listing anyone can install\n' +
      'from — while storeMetadata.stores.' + store + ' says served: ' + JSON.stringify(rows[store]?.served) + '.\n' +
      '`served` is what arms the directory, URL and screenshot limbs of this guard. A live listing behind\n' +
      'served: false leaves every one of them a PRINT, so the gates built for submission day are switched\n' +
      'off by the field nobody updates. Set served: true on the row, or clear the URL if it is not live.');
  }
  r.note(tool.rel + ': ' + listed + ' of ' + VOCAB.length + ' listing(s) carry a URL — the antecedent count for the check above.');

  /* ── 2. the build axis: every target claimed, no invented target ───────── */
  const targets = Object.keys(tool.targets ?? {});
  const claimed = new Set();
  for (const [id, row] of Object.entries(rows)) {
    if (!row || typeof row.target !== 'string') {
      r.fail(tool.rel + ' store "' + id + '" names a target',
        'every store row must say which entry of `targets` builds the artifact it receives.');
      continue;
    }
    claimed.add(row.target);
    r.check('store "' + id + '" builds from a real target',
      targets.includes(row.target), row.target,
      'store "' + id + '" names target "' + row.target + '", which is not in targets [' + targets.join(', ') + '].');
  }
  for (const t of targets) {
    r.check('target "' + t + '" is claimed by at least one store',
      claimed.has(t), [...Object.entries(rows)].filter(([, x]) => x?.target === t).map(([k]) => k).join(' + '),
      'targets."' + t + '" is built by pack.mjs and no store row names it, so nothing checks where that\n' +
      'artifact goes. Either a store row is missing or the target is dead.');
  }

  /* ── 3. per-store directories ──────────────────────────────────────────── */
  const seenDirs = new Set();
  for (const [id, row] of Object.entries(rows)) {
    if (!row || typeof row.dir !== 'string' || !row.dir) {
      r.fail(tool.rel + ' store "' + id + '" declares a dir', 'no `dir` on the row, so there is no directory to grade.');
      continue;
    }
    storesGraded++;
    seenDirs.add(row.dir.replace(/\/+$/, ''));
    const abs = path.join(tool.dirAbs, row.dir);
    const rel = tool.rel + '/' + row.dir;
    const served = row.served === true;

    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      const why = rel + ' does not exist.';
      if (served) {
        r.fail('store "' + id + '" listing directory exists',
          why + '\nThis store is `served: true` — the listing is live and nothing in this repo can diff it.');
      } else {
        r.note('NO TREE (not served): ' + why + ' Store "' + id + '" is `served: false`; creating a listing is ' +
          'owner work, so this prints rather than blocking the build.');
      }
      continue;
    }

    for (const f of REQUIRED_PER_STORE) {
      const fAbs = path.join(abs, f);
      if (!fs.existsSync(fAbs)) {
        r.fail(rel + '/' + f + ' exists', 'required for every store listing and it is absent.');
        continue;
      }
      const text = readText(fAbs);
      filesChecked++;
      if (!text.trim()) {
        r.fail(rel + '/' + f + ' is non-empty',
          'the file exists and is blank. An empty listing field is worse than a missing one — it passes a\n' +
          'presence check and ships as an empty store field.');
        continue;
      }
      /* limits — only where somebody sourced one */
      const lim = row.limits?.[f];
      if (lim) {
        if (typeof lim.source !== 'string' || !lim.source.startsWith('https://')) {
          r.fail(rel + '/' + f + ' limit carries a source',
            'storeMetadata.stores.' + id + '.limits["' + f + '"] declares a limit with no https `source`.\n' +
            'An invented limit fires on CORRECT input. Add the URL and the fetch date, or remove the limit.');
        } else {
          const n = charCount(text);
          if (Number.isInteger(lim.max) && n > lim.max) {
            r.fail(rel + '/' + f + ' within the store limit',
              n + ' characters against a maximum of ' + lim.max + '.\nSource: ' + lim.source);
          } else if (Number.isInteger(lim.min) && n < lim.min) {
            r.fail(rel + '/' + f + ' meets the store minimum',
              n + ' characters against a minimum of ' + lim.min + '.\nSource: ' + lim.source);
          } else {
            r.pass(rel + '/' + f, n + ' chars' +
              (Number.isInteger(lim.min) ? ', min ' + lim.min : '') +
              (Number.isInteger(lim.max) ? ', max ' + lim.max : ''));
          }
        }
      } else {
        r.pass(rel + '/' + f, charCount(text) + ' chars, no sourced limit');
      }
    }
  }

  /* ── 4. shared material ────────────────────────────────────────────────── */
  if (typeof sm.sharedDir === 'string' && sm.sharedDir) {
    seenDirs.add(sm.sharedDir.replace(/\/+$/, ''));
    const abs = path.join(tool.dirAbs, sm.sharedDir);
    const rel = tool.rel + '/' + sm.sharedDir;
    const anyServed = Object.values(rows).some((x) => x?.served === true);
    if (!fs.existsSync(abs)) {
      if (anyServed) r.fail(rel + ' exists', 'a store is served and the shared listing material is absent.');
      else r.note('NO TREE (no store served): ' + rel + ' — the material every store accepts.');
    } else {
      const identity = identityOf(tool);
      if (identity && identity[UNUSABLE]) {
        r.fail(tool.rel + '/publish/identity.json parses as a JSON object',
          identity[UNUSABLE] + '\n' +
          'The URL files below are graded against it. An identity.json this guard cannot read\n' +
          'must not read as "declares nothing", which would disarm that agreement check without saying so.');
      }
      for (const f of REQUIRED_SHARED) {
        const fAbs = path.join(abs, f);
        if (!fs.existsSync(fAbs)) { r.fail(rel + '/' + f + ' exists', 'required shared listing file, absent.'); continue; }
        filesChecked++;
        const body = readText(fAbs);
        if (!body.trim()) { r.fail(rel + '/' + f + ' is non-empty', 'exists and is blank.'); continue; }
        if (!(f in SHARED_URL_FILES)) { r.pass(rel + '/' + f); continue; }
        gradeUrlFile(rel + '/' + f, body, SHARED_URL_FILES[f], identity, anyServed);
      }
      gradeScreenshots(rel, abs, anyServed);
    }
  }

  /* ── 5. orphans — a listing directory no row declares ──────────────────── */
  const storeRootRel = 'store';
  const storeRootAbs = path.join(tool.dirAbs, storeRootRel);
  if (fs.existsSync(storeRootAbs) && fs.statSync(storeRootAbs).isDirectory()) {
    for (const name of fs.readdirSync(storeRootAbs)) {
      const child = path.join(storeRootAbs, name);
      if (!fs.statSync(child).isDirectory()) continue;
      const asDeclared = storeRootRel + '/' + name;
      if (!seenDirs.has(asDeclared)) {
        r.fail(tool.rel + '/' + asDeclared + ' is declared by a store row',
          'a listing directory that no row in storeMetadata names. Either a store was renamed and its\n' +
          'listing left behind — orphaned, unreachable, and still looking maintained — or a directory was\n' +
          'created for a store nobody declared. Declare the store or delete the directory.');
      }
    }
  }

  /* ── 5b. a listing must not send users to ANOTHER store's browser ───────
     🔴 FOUND BY AUDIT ON THE DAY THE STORE LAYER LANDED, WHICH IS THE WHOLE
     REASON THIS LIMB EXISTS. The Edge listing was extracted from the Chrome
     copy — correct for every word except one: it told Edge users to open
     `chrome://extensions/shortcuts`, a URL Edge does not have. The instruction
     was accurate, well-formed, and pointed at a browser the reader is not
     using.
     Nothing caught it. The character-limit checks passed, the drift check
     compares the Chrome tree against the Chrome document, and no limb looked
     at the copy as COPY. A per-store directory whose contents came from
     another store is the defect this whole layer was built to make visible,
     so it gets a check rather than a note. */
  const SCHEME = { chrome: 'chrome://', edge: 'edge://', firefox: 'about:' };
  for (const [id, row] of Object.entries(rows)) {
    if (!row || typeof row.dir !== 'string') continue;
    const abs = path.join(tool.dirAbs, row.dir);
    if (!fs.existsSync(abs)) continue;
    const mine = SCHEME[id];
    const foreign = Object.entries(SCHEME).filter(([k]) => k !== id);
    for (const f of REQUIRED_PER_STORE) {
      const fAbs = path.join(abs, f);
      if (!fs.existsSync(fAbs)) continue;
      const text = readText(fAbs);
      for (const [otherId, scheme] of foreign) {
        if (!text.includes(scheme)) continue;
        /* `about:` is a legitimate prefix in ordinary prose ("about the app"),
           so firefox's scheme only counts with a page after it. */
        if (scheme === 'about:' && !/about:[a-z]/.test(text)) continue;
        r.fail(tool.rel + '/' + row.dir + '/' + f + ' sends users to the ' + otherId + ' browser',
          'it contains "' + scheme + '", which is ' + otherId + "'s URL scheme, in the " + id + ' listing.\n' +
          (mine ? 'Use "' + mine + '" here.' : 'Remove it.') + ' A listing that names another browser\'s URL is an\n' +
          'instruction the reader cannot follow — and it is exactly what copying a sibling store\'s copy produces.');
      }
    }
  }

  /* ── 6. the copy has ONE home, and this is what keeps it that way ───────
     `publish/STORE-LISTING.md` holds the REASONING behind the listing — why the
     redaction bullet is worded as it is, which policy each claim answers to —
     and it quotes the copy in fenced blocks. The files under `store/` are the
     copy itself. That is two places for one string, which is the defect this
     repository names in its own README: "a hand-typed row is a second place for
     the same fact to be written, and the second place is the one that goes
     stale." The duplication is kept because the argument is worth reading beside
     the words it argues about — so it is CHECKED rather than removed. */
  const listingDoc = path.join(tool.dirAbs, 'publish', 'STORE-LISTING.md');
  if (fs.existsSync(listingDoc)) {
    const md = readText(listingDoc);
    const blockAfter = (heading) => {
      const i = md.indexOf(heading);
      if (i === -1) return null;
      const open = md.indexOf('```', i);
      if (open === -1) return null;
      const start = md.indexOf('\n', open) + 1;
      const close = md.indexOf('```', start);
      return close === -1 ? null : md.slice(start, close).trim();
    };
    const pairs = [
      ['## Product name', 'title.txt'],
      ['## Summary (short description', 'short-description.txt'],
      ['## Detailed description', 'long-description.txt'],
    ];
    /* Graded against the CHROME tree: that document is Chrome Web Store listing
       copy by its own title, so Chrome is the store it is a second copy of. */
    const chromeDir = rows.chrome?.dir;
    if (chromeDir && fs.existsSync(path.join(tool.dirAbs, chromeDir))) {
      for (const [heading, file] of pairs) {
        const quoted = blockAfter(heading);
        const fAbs = path.join(tool.dirAbs, chromeDir, file);
        if (quoted === null || !fs.existsSync(fAbs)) continue;
        r.check('publish/STORE-LISTING.md "' + heading.replace('## ', '') + '" matches ' + chromeDir + '/' + file,
          quoted === readText(fAbs).trim(), quoted.length + ' chars',
          'the block quoted in publish/STORE-LISTING.md and the file under ' + chromeDir + ' have drifted.\n' +
          'They are two copies of one string. The FILE is what a store receives; the document is the\n' +
          'argument for it. Re-sync whichever is stale — and if the document is now only commentary,\n' +
          'replace its fenced block with a pointer rather than leaving a second copy to rot.');
      }
    }
  }

  /* ── 7. the unverified list is carried, not quietly dropped ────────────── */
  if (Array.isArray(sm._unverified) && sm._unverified.length) {
    r.note(tool.rel + ': ' + sm._unverified.length + ' store limit(s) recorded as UNVERIFIED and deliberately not enforced.');
  }
}

/* 🔴 A FINDING OUTRANKS COVERAGE LOSS, AND THE ORDER IS LOAD-BEARING.
   Both paths are non-zero, so it is tempting to check reach first. This guard's
   own tests caught why not: "declares targets but no storeMetadata" and "the
   store set was emptied" BOTH raise a precise, actionable failure AND leave
   storesGraded at 0 — and a reach check running first replaced those sentences
   with the generic "zero rows were graded", which says nothing about what to do.
   Zero rows is only coverage loss when nothing else went wrong; otherwise the
   failures above explain it. (Same defect, same day, as
   assert-elf-page-alignment.mjs in the platform repo.) */
if (storesGraded === 0 && r.fails.length === 0) {
  die('zero store rows were graded across ' + tools.length + ' tool(s).\n' +
    'The subject set is empty, so a pass here would mean nothing.');
}

r.blank();
r.note(storesGraded + ' store row(s) graded, ' + filesChecked + ' listing file(s) read, across ' + tools.length + ' tool(s).');

process.exit(r.finish());
