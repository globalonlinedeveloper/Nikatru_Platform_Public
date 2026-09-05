/* changelog-section.mjs — one version's notes, on stdout, for the release body.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/changelog-section.mjs fullshot 1.10.1
     node scripts/changelog-section.mjs Extension/Full_Screen_Shot 1.10.1
     node scripts/changelog-section.mjs fullshot 1.10.1 --repo-root <dir>

   The only caller, .github/workflows/release.yml:

     node scripts/changelog-section.mjs \
       ${{ steps.tag.outputs.id }} ${{ steps.tag.outputs.version }} > notes.md

   and the step that follows appends the Install block to the same file, which
   `gh release create --notes-file notes.md` then publishes. So what this script
   writes to stdout is not a report about a release — it IS the release, the one
   paragraph a user reads to decide whether to update.

   STDOUT IS THE ARTIFACT, WHICH IS WHY THIS GATE DOES NOT PRINT THROUGH Report

   Every other script here reports with lib/report.mjs, and report.mjs writes to
   stdout on purpose (report.mjs:45-46: a CI log then reads top to bottom in
   order) with only the aborting `die()` on stderr, "because a caller may be
   piping stdout". This is that caller. A verdict line printed through Report
   would land inside notes.md and be published as the notes — a gate's own
   output shipped as the thing it was grading. So the verdicts here go to
   stderr in Report's shape, and the EXIT CODES are Report's exactly:

     0  the section was found and written to stdout
     1  the CHANGELOG was read and what it says is wrong for this release
     2  could not run — bad usage, missing file, nothing that parses

   AN EMPTY ANSWER IS THE FAILURE THIS FILE EXISTS TO PREVENT

   The cheap version of this script is eight lines of regex that prints whatever
   it matched. Its failure mode is silence: no heading matched, or the section
   under the heading is blank, and it writes nothing, exits 0, and the release
   goes out with a body consisting of the Install boilerplate alone. Nobody
   notices, because a release body is not something CI can miss the absence of —
   and a published release cannot be un-published. So every empty outcome here
   is fatal, and the three of them are told apart rather than collapsed:

     - the file is missing, unreadable, or holds NO `## [x.y.z]` heading at all
       -> 2, a parse failure. It is not "this version has no notes", it is "this
       is not a file I can read notes out of", and those must never print the
       same sentence.
     - the file parses and every heading in it is [Unreleased], or none of them
       is the requested version, or the requested version is there twice
       -> 1, read and wrong.
     - the heading is there and the lines under it are blank
       -> 1, and this is the one a naive implementation reports as success.

   The subject set is the version headings this file actually holds; its floor
   is one, and the count is printed on every run rather than assumed. The floor
   cannot drift because it is derived from the file, not written down beside it.

   WHAT IT DELIBERATELY DOES NOT CHECK

   That the manifest, the CHANGELOG top entry and the tag agree. That is
   check-version.mjs's entire job, release.yml runs it three steps earlier with
   --expect, and a second gate grading the same fact is a second gate that can
   disagree with the first about a release. This script asks one question: what
   does the CHANGELOG say about this version? */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, die, EXIT_OK, EXIT_FAIL } from './lib/report.mjs';
import { repoRoot, resolveTool, readText, versionProblem, changelogTop } from './lib/toolinfo.mjs';

/* Report's shape (report.mjs:57-70), on stderr. `die()` already goes to stderr
   and exits 2, so it is used unchanged. */
const note = text => console.error('        ' + text);
function refuse(label, why) {
  console.error('  FAIL  ' + label);
  for (const line of String(why).split('\n')) console.error('        ' + line);
  process.exit(EXIT_FAIL);
}

const USAGE = 'usage: node scripts/changelog-section.mjs <tool-id|Category/Tool_Dir> <version> [--repo-root <dir>]';

/* ---------------- 1. arguments ---------------- */
const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['repo-root']);
const root = repoRoot(args);

/* A third positional is a quoting accident, not a request. Refusing it is the
   same rule as rejecting a mistyped flag: the caller redirects this into a file
   nobody reads before it is public, so a misunderstood argument must stop the
   run rather than change what gets published. */
if (args.positional.length > 2) {
  die('expected exactly two positional arguments, got ' + args.positional.length + ': ' +
    args.positional.map(p => '"' + p + '"').join(', ') + '\n' + USAGE);
}

const tool = resolveTool(root, args.positional[0]);
const version = args.positional[1];
if (!version) die('no version given.\n' + USAGE);
const vp = versionProblem(version);
if (vp) {
  die('the version argument "' + version + '" is ' + vp + '\n' +
    'release.yml derives it from the tag (fullshot-v1.10.1 -> 1.10.1), so it arrives here with no\n' +
    'leading "v" and no pre-release suffix. Pass it the same way by hand.\n' + USAGE);
}

console.error('changelog-section · ' + tool.id + ' (' + tool.rel + ') → [' + version + ']');

/* ---------------- 2. the file ---------------- */
/* Same path check-version.mjs reads, so the gate that asserts the CHANGELOG is
   in step and the script that publishes out of it can never be looking at two
   different files. */
const clRel = tool.rel + '/CHANGELOG.md';
const clAbs = path.join(tool.dirAbs, 'CHANGELOG.md');

if (!fs.existsSync(clAbs)) {
  die(clRel + ' does not exist, so there is nothing to publish as the notes for v' + version + '.\n' +
    'The tag is already pushed and the packages are already built at this point in release.yml —\n' +
    'stopping here is the cheap outcome. Write the section, or delete the tag; a release whose body\n' +
    'is the Install boilerplate and nothing else cannot be corrected after the fact.');
}

let text;
try { text = readText(clAbs).replace(/\r\n/g, '\n'); }
catch (e) {
  die('cannot read ' + clAbs + ': ' + e.code + ' — ' + e.message + '\n' +
    'That is a read failing, not a changelog being empty, and the two must not print the same\n' +
    'sentence: one of them is a permissions problem and the other is a missing release note.');
}

/* ---------------- 3. what is a heading, and what is an example ---------------- */
/* A markdown file that documents this format carries a version heading inside a
   fenced block as an EXAMPLE, and this repo already holds one: docs/RELEASING.md
   §3 "CHANGELOG" fences `## [1.10.1] — 2026-08-14` to show the form. The day
   that block is pasted into a CHANGELOG — which is what it is there to be — a
   fence-blind extractor ends the section at the example, and the release body
   is truncated with nothing anywhere saying so. That is this corpus's recurring
   shape: not a check that broke, a check that quietly stopped seeing part of
   its subject.

   Deliberately narrow, for the reason globToRegExp in lib/toolinfo.mjs is
   narrow: an opening fence is three or more backticks or tildes at column 0-3,
   and it closes on a line of the same character, at least as long, carrying
   nothing else. A fence rule nobody can predict is worse than no fence rule.
   An unterminated fence hides every heading after it, so it is reported. */
function fenceMap(lines) {
  const inFence = new Array(lines.length).fill(false);
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      if (m) { open = { char: m[1][0], len: m[1].length }; inFence[i] = true; }
      continue;
    }
    inFence[i] = true;
    if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === '') open = null;
  }
  return { inFence, unterminated: open !== null };
}

const lines = text.split('\n');
const { inFence, unterminated } = fenceMap(lines);
if (unterminated) {
  note('warning: an unterminated code fence starts in ' + clRel + '. Every heading below it is ' +
    'invisible to this script, and to any other markdown reader.');
}

/* The heading shape is changelogTop()'s, character for character (toolinfo.mjs:256),
   so the two readers of this file cannot drift on what a version heading looks
   like. `##(?!#)` is the section terminator: `### Added` belongs to the section,
   a second `##` of any kind ends it. */
const RE_VERSION_HEADING = /^##\s*\[([^\]]+)\]/;
const RE_ANY_H2 = /^##(?!#)/;

const headings = [];
for (let i = 0; i < lines.length; i++) {
  if (inFence[i]) continue;
  const m = RE_VERSION_HEADING.exec(lines[i]);
  if (m) headings.push({ label: m[1].trim(), line: i });
}

/* THE FLOOR. Zero headings is not an empty changelog, it is a file this script
   cannot read as one, and the numbers are printed so "it found nothing" can
   never be mistaken for "there was nothing". */
if (headings.length === 0) {
  die(clRel + ' was read — ' + lines.length + ' line(s), ' + text.length + ' byte(s) — and not one ' +
    '"## [x.y.z]" heading matched.\n' +
    'That is a parse failure, not an empty changelog: this file is either not Keep-a-Changelog form\n' +
    'or its headings are inside a code fence. Either way nothing can be extracted from it, and\n' +
    'exiting 0 with empty output here would publish a release with no notes.');
}

const released = headings.filter(h => !/^unreleased$/i.test(h.label));
note(headings.length + ' version heading(s) read from ' + clRel + ', ' + released.length + ' released: ' +
  (released.length ? released.map(h => '[' + h.label + ']').join(', ') : 'NONE'));

if (released.length === 0) {
  refuse('the CHANGELOG has a released version',
    clRel + ' parses, and every one of its ' + headings.length + ' heading(s) is [Unreleased].\n' +
    'A tag exists for v' + version + ' but the changelog has never released anything. Promote the\n' +
    '[Unreleased] block to "## [' + version + '] — ' + new Date().toISOString().slice(0, 10) + '" and re-tag.');
}

/* ---------------- 4. the two readers must agree ---------------- */
/* changelogTop() is the reader every other gate uses, and it is deliberately
   fence-blind. If the fence-aware scan above disagrees with it about which
   entry is newest, then check-version.mjs graded one heading and this script is
   about to publish another — and one of the two is reading an example. Two
   implementations only catch what one cannot when the disagreement is fatal;
   resolving it silently here would make this a single reader with an audit
   trail. */
const topByLoader = changelogTop(text);
if (topByLoader !== released[0].label) {
  refuse('both readers of this file agree on its newest entry',
    'changelogTop() in lib/toolinfo.mjs reads the newest entry as [' + topByLoader + '], this script ' +
    'reads it as\n[' + released[0].label + '] (' + clRel + ' line ' + (released[0].line + 1) + ').\n' +
    'The difference is a code fence: one of those headings is an EXAMPLE inside a fenced block. ' +
    'Every\nother gate — check-version.mjs above all — believes the first answer, so a release built on the\n' +
    'second would be graded against a heading nobody meant. Move the example out of the fence or\n' +
    'stop fencing the real heading.');
}

/* ---------------- 5. this version's section ---------------- */
const matches = headings.filter(h => h.label === version);

if (matches.length === 0) {
  const near = headings.find(h => h.label.replace(/^v/i, '').trim() === version);
  refuse('the CHANGELOG has a [' + version + '] section',
    clRel + ' holds no "## [' + version + ']" heading.\n' +
    'It holds: ' + headings.map(h => '[' + h.label + ']').join(', ') + '.\n' +
    (near ? 'Closest is [' + near.label + '] on line ' + (near.line + 1) + ' — the heading label is the version ' +
      'and nothing else,\nso drop the "v".\n' : '') +
    'release.yml already asserted manifest == CHANGELOG top == tag three steps ago, so reaching here\n' +
    'means the section for this version is titled something the format does not describe. Fix the\n' +
    'heading; do not work around it by publishing the wrong section.');
}

if (matches.length > 1) {
  refuse('[' + version + '] appears exactly once',
    clRel + ' carries the heading "## [' + version + ']" ' + matches.length + ' times, on lines ' +
    matches.map(h => h.line + 1).join(', ') + '.\n' +
    'There is no way to choose between them that is not a guess, and a guess published as release\n' +
    'notes is indistinguishable from the right answer until somebody reads the wrong one. A version\n' +
    'is also never reused: two packages under one number is unrecoverable in public.');
}

const start = matches[0].line;
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (!inFence[i] && RE_ANY_H2.test(lines[i])) { end = i; break; }
}
const body = lines.slice(start + 1, end);

/* Keep a Changelog parks its compare links in one block at the very bottom of
   the file — `[1.10.1]: https://…/compare/…` — which belongs to no section but
   sits inside whichever one is last. Only a TRAILING run of them is dropped,
   and how many is printed: a rule that quietly deletes lines from a release
   body is a rule that will one day delete a real one. */
const RE_LINK_DEF = /^\[[^\]]+\]:\s*\S+/;
let droppedLinkDefs = 0;
while (body.length) {
  const last = body[body.length - 1];
  if (last.trim() === '') { body.pop(); continue; }
  if (RE_LINK_DEF.test(last)) { body.pop(); droppedLinkDefs++; continue; }
  break;
}
while (body.length && body[0].trim() === '') body.shift();

/* THE SECOND FLOOR, and the one a naive implementation reports as success: the
   heading is right there, so the extraction "worked", and what it extracted is
   nothing. */
if (body.length === 0) {
  refuse('the [' + version + '] section says something',
    clRel + ' line ' + (start + 1) + ' has the heading "## [' + version + ']" and nothing under it' +
    (droppedLinkDefs ? ' but ' + droppedLinkDefs + ' link definition(s)' : '') + '.\n' +
    'The next heading is on line ' + (end === lines.length ? 'EOF' : String(end + 1)) + '. An empty section publishes a release whose entire body is the\n' +
    'Install boilerplate — which reads as if the release changed nothing, forever. Write the entry\n' +
    'for the person reading it in a year, who is you.');
}

/* ---------------- 6. emit ---------------- */
const payload = body.join('\n') + '\n';
process.stdout.write(payload);

if (released[0].label !== version) {
  note('[' + version + '] is not the newest entry in ' + clRel + ' — [' + released[0].label + '] is. ' +
    'That is legal (an old tag can be re-released) but it is rarely what was meant.');
}
if (droppedLinkDefs) {
  note('dropped ' + droppedLinkDefs + ' trailing link definition(s) — Keep-a-Changelog compare links, ' +
    'which belong to the file rather than to this section.');
}
note('emitted [' + version + '] — heading on ' + clRel + ' line ' + (start + 1) + ', section ends at ' +
  (end === lines.length ? 'end of file' : 'line ' + (end + 1)) + ' — ' +
  body.length + ' line(s), ' + payload.length + ' byte(s) on stdout.');

process.exit(EXIT_OK);
