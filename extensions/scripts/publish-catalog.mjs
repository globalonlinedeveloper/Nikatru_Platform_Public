/* publish-catalog.mjs — derive catalog/extensions.json from the tool.json files.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/publish-catalog.mjs            rewrite catalog/extensions.json
     node scripts/publish-catalog.mjs --check    fail if it is out of date (CI)
     node scripts/publish-catalog.mjs --print    print the bytes, touch nothing

   WHAT THIS FILE IS, AND WHY IT IS NOT gen-catalog.mjs

   gen-catalog.mjs writes a table into README.md — a catalogue for a HUMAN
   reading this repository. This writes catalog/extensions.json — a catalogue in
   the shape a MACHINE in another repository consumes.

   🔴 CORRECTION 2026-08-22 — NOTHING FETCHES THIS FILE TODAY, AND THIS HEADER
   CLAIMED SOMETHING DID. The sentence that stood immediately above read:

     "The storefront (Nikatru_Storefront_Public) fetches this path over https and
      byte-compares its vendored copy against it, so the bytes here are a
      published interface, not an internal convenience."

   Every clause of it is false as of this date, measured rather than assumed:

     · THE NAMED CONSUMER IS NOT A REPOSITORY ANY MORE.
       `gh repo list globalonlinedeveloper --limit 100` returns 13 repositories
       and none is called Nikatru_Storefront_Public. It was deleted from the org
       on 2026-08-19 after the one-repo/one-pipeline lock; Platform_Public's
       catalog/store-matrix.json records the deletion, and the only surviving
       copy is a git bundle.

     · NO READER EXISTS IN ANY LANGUAGE. Searched for the literal
       `extensions.json`, for `Nikatru_Extensions`, for `Storefront`, and for the
       storefront's own helper names (readVendored, sync-vendor,
       generate-apps-data), over ALL FILE TYPES — not just .mjs/.js — with
       gitignored trees included, in five roots:

         Projects/Nikatru_Extensions_Public   hits in FIVE files, every one
                                              internal to this repo:
                                              .github/workflows/ci.yml,
                                              .gitignore,
                                              scripts/check-catalog.mjs,
                                              scripts/README.md, and THIS FILE.
                                              ⚠️ NO HIT COUNT IS QUOTED FOR THIS
                                              CELL, on purpose — see the note
                                              below. It said "13 hits", which was
                                              exact at HEAD and false by the time
                                              it was committed.
         Projects/Nikatru_Extensions_Private   1 hit — a .gitignore line about
                                              .vscode/extensions.json, quoted in
                                              TOOLS-PIPELINE.md:1192
         Projects/Nikatru_Platform_Public      2 hits, BOTH PROSE COMMENTS:
                                              catalog/store-matrix.json:163 and
                                              tooling/ci/assert-catalog-contract.mjs:56
         Projects/Nikatru_Platform_Private    12 hits, all notes/decisions/plans
         Claude/nikatru (the business brain)   0 hits

       Zero of those is a read. The generator that would be the plausible reader,
       Platform_Public tooling/sites/generate-apps-data.mjs, reads catalog/apps.json
       and writes sites/_shared/_data/apps.json; that directory holds apps.json and
       site.json and nothing else. Platform_Private notes/HANDOFF-2026-08-21.md:311
       says it outright: "The platform repo has no reader for that file — only
       comments."

       ⚠️ PRECISION ON THE LAST CELL OF THAT TABLE — `Claude/nikatru  0 hits` —
       measured 2026-08-22 and appended rather than folded into the cell, so that
       what the record claimed stays visible. A PUBLISHED ZERO IS ONLY A
       MEASUREMENT WHEN ITS DOMAIN IS STATED, and the domain this bullet states
       is the whole term list, not one term of it. The zero is exact for the
       literal `extensions.json`; it is NOT the number for the list:

         cd Claude
         grep -rniI -E "extensions\.json" nikatru          ->  0 hits
         grep -rniI -E "extensions\.json|Nikatru_Extensions|Storefront|readVendored|sync-vendor|generate-apps-data" nikatru
                                                          ->  7 hits

       All seven are the word "Storefront", in prose, in two files:
       nikatru/README.md (:33, :68, :76, :98, :104, :106) and
       nikatru/vendors/cloudflare.md (:138). Not one is a read, so the finding
       above is untouched — what was wrong was the WIDTH of the claim, not the
       claim.

       ⚠️ AND THE EXTENSIONS_PUBLIC CELL NO LONGER QUOTES A NUMBER AT ALL,
       CORRECTED 2026-08-22. It read "13 hits". That was exact against HEAD and
       it was WRONG IN THE WORKING TREE THE MOMENT IT WAS WRITTEN, under a
       "CORRECTION 2026-08-22" header, i.e. presented as a measurement of the
       day. The count in the tree that shipped it was 19, and the whole of the
       +6 was prose added by that same edit — five new occurrences inside THIS
       comment block plus one in scripts/README.md. A paragraph that counts the
       occurrences of a string, in a file, by adding occurrences of that string
       to that file, cannot publish a stable count; the FILE LIST can, and does.

       An earlier version of this note blamed the instability on whether the
       walk descends into .git. MEASURED 2026-08-22: with .git it is one higher
       than without — a delta of 1. That was the minor cause named as the cause,
       while the dominant mover (this comment) went unmentioned.

       TO RE-DERIVE ANY CELL, one root at a time, from Projects/ (or from
       Claude/ for the last one):

         grep -rniI --exclude-dir=.git -E "extensions\.json" <root>

       The two `nikatru`-scoped commands above answer only for the last cell;
       they were offered as the way to re-derive all five and they cannot. The
       Platform_Public cell also needs its own exclusion: node_modules carries a
       binary-extensions.json whose name matches, which is why that cell names
       both prose files rather than quoting a raw total.

       And one thing those seven hits expose, in nobody's ownership this round:
       nikatru/README.md:33 still lists `Projects/Nikatru_Storefront_Public/` as
       the live web-presence directory. Measured 2026-08-22, `ls Projects/`
       returns exactly four entries — Nikatru_Extensions_Private,
       Nikatru_Extensions_Public, Nikatru_Platform_Private and
       Nikatru_Platform_Public — and that is not one of them. The same disease
       this correction treats, one root over.

     · THE VENDORED COPY EXISTED AND DID NOT SURVIVE THE CUTOVER.
       Platform_Private notes/ARCHIVED-CUTOVER-RUNBOOK-2026-08-19.md:303 records
       "Only in ./sites/_shared/_data: extensions.json".

   WHAT IS STILL TRUE, AND WHY NOTHING BELOW IS RELAXED. The SHAPE is depended on
   even though the FETCH is not: Platform_Private decisions/055 specifies
   catalog/apps.json gaining "a `listings` block of the shape catalog/extensions.json
   ALREADY HAS", and decisions/056 §3 keeps the two factories symmetrical on the
   strength of it — a symmetry, it notes, "that no guard in either repository can
   see". So this file is a published SHAPE with no live reader: determinism and the
   BOM refusal below stay exactly as they are, because they cost nothing and the day
   a consumer returns is the worst day to discover the bytes drifted. What this
   correction removes is the opposite error — a file that reads as load-bearing when
   nothing loads from it, which hides the real loss rather than recording it.

   Two catalogues, two shapes, ONE source: every field below is read out of a
   tool.json. Neither generator holds a fact the other does not.

   🔴 catalog/extensions.json IS GENERATED. DO NOT HAND-EDIT IT.
   `--check` compares byte for byte, so an edit here is not a merge conflict
   later — it is a red build on the next run, which is the cheap version of the
   same conversation. An orphan hand-written copy of this file existed before
   this script did; it carried fields nothing in the tree could confirm, and that
   is exactly the state this script exists to make impossible.

   ── WHERE EVERY PUBLISHED FIELD COMES FROM ───────────────────────────────────

     slug       tool.json  id          the stable public handle (spec §1.1)
     name       tool.json  name        the product name users see
     tagline    tool.json  summary     the one-sentence catalogue line
     platforms  tool.json  targets     chromium.stores, then firefox if present
     listings   tool.json  listings    verbatim; null stays null
     status     DERIVED    see below

   Nothing here composes a plausible store URL, invents a description, or reads
   the manifest's marketing strings. A field that cannot be derived is a field
   this file refuses to publish.

   ── STATUS IS DERIVED FROM INSTALLABILITY, NOT FROM tool.json's OWN STATUS ────

       status = "live"     if at least one listings.<store> is a URL
       status = "preview"  otherwise

   The published vocabulary is {live, preview} because that is what the sibling
   catalogue publishes — catalog/apps.json in the repository now called
   Nikatru_Platform_Public, graded by its tooling/ci/assert-catalog-contract.mjs,
   whose own comment at :56 cites this file for the shape. One vocabulary means
   one reader can take both. A third spelling would be silently skipped by any
   such consumer while looking deliberate here.

   tool.json's own vocabulary is {idea, wip, shipping, archived} and it is
   INTERNAL — it describes how far the work has got. `live` is not that: it is a
   promise to a stranger that a store page answers. So the only thing that can
   make this file say `live` is a listing URL, and FullShot has none — it
   publishes `preview` today, which is true.

   ONE SOURCE STATUS IS REFUSED RATHER THAN MAPPED. `archived` means withdrawn,
   and neither published value carries that: `preview` reads as "coming soon",
   which is the opposite claim, and `live` would be worse. When the first tool is
   archived this script stops and asks for a deliberate decision instead of
   quietly picking the friendlier lie.

   ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────────

     · publish a tool whose surface is not "extension" — this file is named
       extensions.json and has nowhere to put a `web` or `cli` tool. Dropping it
       silently would be a catalogue that is quietly incomplete, which is the one
       failure this repository has paid for most often.
     · publish a tool that targets no store at all.
     · publish when tool.json's `listings` keys and its `targets` do not agree —
       two fields describing the same set, free to drift, is the defect.
     · replace a non-empty catalogue with an empty one (--allow-empty to mean it).

   DETERMINISM: no timestamps, no environment, no commit sha, no digest. Same
   tree, same bytes, forever — which is what would make a consumer's byte-compare
   able to mean "current" rather than "regenerated".

   ── 🔴 A UTF-8 BOM IS REFUSED HERE, ON THE RAW BYTES ─────────────────────────

   Three bytes — EF BB BF — in front of the `[` are the cheapest way this file
   has of being wrong while every gate in this repository says it is right.
   Measured, on the real catalogue:

     node scripts/publish-catalog.mjs --check    EXIT 0   (before this refusal)
     node scripts/check-catalog.mjs              EXIT 0   (before its refusal)
     node scripts/lint.mjs                       EXIT 0

   ...while a consumer cannot read it at all. `JSON.parse` throws on a leading
   U+FEFF in every path Node offers — string OR Buffer, measured on v24 — so a
   vendoring reader reports "not valid JSON", refuses to vendor the body, and
   renders nothing. A whole catalogue section goes dark on three bytes no gate
   here objected to. (The storefront that ran exactly that chain — readVendored,
   sync-vendor.mjs, generate-apps-data.mjs — is gone; see the correction at the
   top. The failure mode is not, and it is why this refusal stays.)

   The reason it passed is not an oversight in the comparison — it is a helper
   working exactly as designed one layer down. `readText()` in lib/toolinfo.mjs
   STRIPS a BOM on read, deliberately, so that a BOM'd tool.json reports as a BOM
   rather than as "corrupt JSON". Every read in this repository inherits that,
   including the `existing === bytes` comparison below, which therefore compared
   the file's CONTENT and never its BYTES. For an internal file that is right.
   For the one file whose bytes are the contract it is exactly wrong: a
   byte-comparing consumer sees what was WRITTEN, so a byte this contract does
   not allow must never be written, not merely tolerated on read.

   So the BOM is tested on the raw Buffer, before any decode, and it is named in
   the failure — a consumer's "Unexpected token" names neither the BOM nor the
   file. `lib/toolinfo.mjs` already makes this exact refusal for tool.json
   (`hadBom`, used by `loadTool`); this extends it to the file where it matters
   most. PowerShell 5.1 writes a BOM by default from `Out-File -Encoding utf8`,
   so this is a keystroke away on the machine this repository is built on.

   Exit codes: 0 written / already correct · 1 --check found it stale or BOM'd, or
   a tool.json cannot be published · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die, EXIT_FAIL } from './lib/report.mjs';
/* readText() is deliberately NOT imported here. It strips a UTF-8 BOM, and this
   is the one file in the repository whose raw bytes are the contract — see the
   header and the read below. */
import { repoRoot, loadAllTools } from './lib/toolinfo.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['check', 'print', 'allow-empty', 'out', 'repo-root']);
const root = repoRoot(args);

const outRel = typeof args.get('out') === 'string' ? args.get('out') : 'catalog/extensions.json';
const outAbs = path.join(root, outRel);

/* The published status vocabulary. Kept here as the one place it is written,
   and deliberately the same two values the sibling apps catalogue publishes. */
const LIVE = 'live';
const PREVIEW = 'preview';

/* ---------------- load ---------------- */
const { tools, errors, warnings } = loadAllTools(root);
if (errors.length) {
  console.error('CANNOT PUBLISH THE CATALOGUE — ' + errors.length + ' tool.json problem(s):');
  for (const e of errors) console.error('  - ' + e);
  process.exit(EXIT_FAIL);
}
for (const w of warnings) console.log('WARN  ' + w);

/* ---------------- derive one row ---------------- */
const problems = [];
const refuse = (t, why) => problems.push(t.rel + '/tool.json: ' + why);

/* Store targets, in declaration order: the chromium stores as tool.json lists
   them, then firefox if the tool builds one. Derived from `targets` rather than
   from `listings` so that the two remain independent statements this script can
   compare — a platform list read out of the listings object would agree with it
   by construction and check nothing. */
function platformsOf(t) {
  const targets = t.targets || {};
  const out = [];
  const seen = new Set();
  const add = (p, where) => {
    if (typeof p !== 'string' || !p.trim()) {
      refuse(t, 'targets' + where + ' contains ' + JSON.stringify(p) + '; a store name must be a non-empty string.');
      return;
    }
    if (seen.has(p)) {
      refuse(t, 'targets names the store "' + p + '" twice. The published `platforms` array is rendered as one chip per entry.');
      return;
    }
    seen.add(p);
    out.push(p);
  };

  if (targets.chromium !== undefined && targets.chromium !== null) {
    if (typeof targets.chromium !== 'object' || Array.isArray(targets.chromium)) {
      refuse(t, 'targets.chromium is ' + (Array.isArray(targets.chromium) ? 'an array' : typeof targets.chromium) + ', expected an object like { "stores": ["chrome", "edge"] }.');
    } else {
      const stores = targets.chromium.stores;
      if (!Array.isArray(stores) || stores.length === 0) {
        refuse(t, 'targets.chromium is declared but targets.chromium.stores is empty or missing. A chromium build that reaches no store is not a published channel.');
      } else for (const s of stores) add(s, '.chromium.stores');
    }
  }
  if (targets.firefox !== undefined && targets.firefox !== null) add('firefox', '.firefox');

  if (out.length === 0) {
    refuse(t, 'declares no store target at all (targets is ' + JSON.stringify(t.targets || {}) + '). ' +
      'An extension nobody can install anywhere has no honest row in a storefront catalogue.');
  }
  return out;
}

/* `listings` verbatim, but only after proving it describes the same set of
   stores `targets` does. Two fields that name the same thing and are never
   compared is how a catalogue ends up advertising a Firefox button for a tool
   that has no Firefox build. */
function listingsOf(t, platforms) {
  const raw = t.listings || {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    refuse(t, '"listings" is ' + (Array.isArray(raw) ? 'an array' : typeof raw) + ', expected an object keyed by store name.');
    return null;
  }
  const declared = Object.keys(raw).sort();
  const expected = platforms.slice().sort();
  if (declared.join(',') !== expected.join(',')) {
    refuse(t, '"listings" is keyed by [' + declared.join(', ') + '] but `targets` builds for [' + expected.join(', ') + ']. ' +
      'These two describe the same set of stores; when they disagree, one of them is wrong and nothing else in this repo compares them.');
    return null;
  }
  const out = {};
  for (const p of platforms) {
    const v = raw[p];
    if (v === null) { out[p] = null; continue; }
    if (typeof v === 'string' && v.trim()) { out[p] = v; continue; }
    refuse(t, 'listings.' + p + ' is ' + JSON.stringify(v) + '. A listing is either a store URL or null — ' +
      'null is the honest answer until the listing exists, and an empty string is a URL nobody can follow.');
    out[p] = null;
  }
  return out;
}

function rowFor(t) {
  if (t.surface !== 'extension') {
    refuse(t, 'has surface "' + t.surface + '". ' + outRel + ' publishes extensions; there is nowhere in it to put this tool, ' +
      'and dropping it silently would publish a catalogue that is quietly incomplete. Give this surface its own catalogue file.');
    return null;
  }
  if (t.status === 'archived') {
    refuse(t, 'has status "archived", and the published vocabulary is {' + LIVE + ', ' + PREVIEW + '}. Neither means "withdrawn": ' +
      '"' + PREVIEW + '" reads as coming-soon, which is the opposite claim. Decide what the storefront should say about an archived ' +
      'extension and extend this script deliberately — do not let it pick the friendlier of two wrong answers.');
    return null;
  }

  const platforms = platformsOf(t);
  if (platforms.length === 0) return null;
  const listings = listingsOf(t, platforms);
  if (listings === null) return null;

  const listed = platforms.filter((p) => typeof listings[p] === 'string');
  const status = listed.length > 0 ? LIVE : PREVIEW;

  /* Field order is fixed here rather than left to object-literal accident: it is
     the byte order a consumer's diff would run against. */
  return {
    slug: t.id,
    name: t.name,
    tagline: t.summary,
    listings,
    platforms,
    status,
  };
}

const rows = [];
for (const t of tools) {
  const row = rowFor(t);
  if (row) rows.push(row);
}
rows.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

if (problems.length) {
  console.error('CANNOT PUBLISH THE CATALOGUE — ' + problems.length + ' tool(s) cannot be turned into a row:');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nNothing was written. A catalogue missing the tool it could not describe is worse than no catalogue:');
  console.error('the gap is invisible to every consumer, because a consumer only ever sees the rows that are there.');
  process.exit(EXIT_FAIL);
}

const bytes = JSON.stringify(rows, null, 2) + '\n';

if (args.bool('print')) {
  process.stdout.write(bytes);
  process.exit(0);
}

/* ---------------- write / check ---------------- */

/* Read the BYTES first and derive the text from them, rather than calling
   readText() and never seeing them. readText() strips a UTF-8 BOM by design (see
   the header), so `existing` below is the file's CONTENT — the right subject for
   the drift comparison and the line diff, and the wrong subject for the one
   question a published interface also has to answer: are these the bytes we
   said we would serve? That question is answered here, on the Buffer. */
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const existingBytes = fs.existsSync(outAbs) ? fs.readFileSync(outAbs) : null;
const existingHasBom = existingBytes !== null && existingBytes.subarray(0, 3).equals(BOM);
const existing = existingBytes === null
  ? null
  : (existingHasBom ? existingBytes.subarray(3) : existingBytes).toString('utf8');

/* Named once so the --check failure and the rewrite notice cannot drift apart. */
const BOM_WHY =
  'The first three bytes of ' + outRel + ' are EF BB BF — a UTF-8 byte order mark — before the opening `[`.\n' +
  'This file is a published SHAPE: its bytes are held to an interface standard even though no consumer\n' +
  'fetches them today (measured 2026-08-22 — see the correction at the top of this script). `JSON.parse`\n' +
  'throws on a leading U+FEFF in every path Node offers (string and Buffer alike), so with the BOM\n' +
  'present any consumer that ever does read this catalogue cannot parse it at all — it would report\n' +
  '"not valid JSON", vendor nothing, and render no extensions.\n' +
  'Nothing else in this repository notices, because readText() in lib/toolinfo.mjs strips a BOM on read\n' +
  'and every gate here reads through it. That is correct for an internal file and wrong for this one.\n' +
  'PowerShell 5.1 writes a BOM by default from `Out-File -Encoding utf8`; use `Set-Content -Encoding utf8NoBOM`,\n' +
  'or just regenerate — this script writes the file without one.';

/* Zero rows over a populated catalogue is indistinguishable from a broken
   discovery — the same refusal gen-catalog.mjs makes about the README table, for
   the same reason, and this repository has had a search silently miss an entire
   tree before. */
if (rows.length === 0 && existing !== null && existing.trim() !== '' && existing.trim() !== '[]' && !args.bool('allow-empty')) {
  die('no tool.json produced a catalogue row, so the generated catalogue is empty — and ' + outRel + ' currently\n' +
    'holds one with content. Overwriting it would publish "this factory ships nothing".\n\n' +
    'An empty result is indistinguishable from a broken search. If the catalogue really should be empty, pass --allow-empty.');
}

function firstDifference(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return 'first difference at line ' + (i + 1) + ':\n' +
        '  generated: ' + (la[i] === undefined ? '(end of file)' : JSON.stringify(la[i])) + '\n' +
        '  on disk:   ' + (lb[i] === undefined ? '(end of file)' : JSON.stringify(lb[i]));
    }
  }
  return 'the lines are identical, so the difference is in line endings or a trailing byte.';
}

const r = new Report('publish-catalog · ' + outRel);

if (args.bool('check')) {
  if (existing === null) {
    r.fail(outRel + ' does not exist',
      'It is the published catalogue, and this run derived ' + rows.length + ' row(s) that belong in it.\n' +
      'Run:  node scripts/publish-catalog.mjs');
    process.exit(r.finish());
  }
  /* 🔴 BEFORE the content comparison, not after. A BOM'd file whose content is
     otherwise perfect passes `existing === bytes` — that is the whole defect —
     so this must sit in front of the branch that would call it up to date. */
  if (existingHasBom) {
    r.fail(outRel + ' starts with a UTF-8 byte order mark (EF BB BF)', BOM_WHY);
    process.exit(r.finish());
  }
  if (existing === bytes) {
    r.pass(outRel + ' is up to date', rows.length + ' row(s): ' + rows.map((x) => x.slug + '[' + x.status + ']').join(', '));
    process.exit(r.finish());
  }
  r.fail(outRel + ' is out of date',
    'The committed catalogue does not match what the tool.json files on disk derive.\n' +
    'Either a tool.json changed and nobody regenerated, or this file was hand-edited — it is generated, so it must not be.\n' +
    'generated ' + Buffer.byteLength(bytes) + ' bytes · on disk ' + Buffer.byteLength(existing) + ' bytes\n' +
    firstDifference(bytes, existing) + '\n\n' +
    'Run:  node scripts/publish-catalog.mjs');
  process.exit(r.finish());
}

/* `&& !existingHasBom`: without it a BOM'd file is reported "already correct"
   and the three offending bytes survive the one command whose job is to remove
   them. The write below is a plain utf8 write, so regenerating IS the fix — and
   the run says which byte it removed rather than reporting a silent no-op. */
if (existing === bytes && !existingHasBom) {
  r.pass(outRel + ' was already correct', rows.length + ' row(s)');
  process.exit(r.finish());
}

fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, bytes, 'utf8');
if (existingHasBom) {
  r.pass('rewrote ' + outRel + ' WITHOUT its UTF-8 byte order mark',
    'The file on disk began EF BB BF; the content was otherwise correct. Removed — ' +
    Buffer.byteLength(bytes) + ' bytes written.');
} else {
  r.pass('wrote ' + outRel, rows.length + ' row(s): ' + (rows.map((x) => x.slug + ' [' + x.status + ']').join(', ') || 'none'));
}
process.exit(r.finish());
