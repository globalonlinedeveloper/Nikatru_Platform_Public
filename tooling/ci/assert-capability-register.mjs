#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-capability-register.mjs — the chassis must know what it provides.
//
// [pipeline C-1] "Every shared capability has exactly one declared home."
// [pipeline C-2] "A capability with no consumer is not built."
// [pipeline C-3] widened — "a register-assigned capability may not be
//                implemented in an app" (00-RECONCILIATION-DECISIONS item 15).
//
// WHY. "Every capability" cannot be checked against a list that does not exist.
// THREE notification implementations were written because nobody had a place to
// look that would have said one already existed — and the third is STILL in the
// tree, which is why check 5 below exists.
//
// v1 of this guard (2026-07-28, same day) shipped with two structural mistakes,
// found by researching C-1 against decisions already on record rather than by any
// test:
//   · it pointed every `seam` at a package BARREL FILE, so it asserted nothing
//     about the actual contract. The real architecture is that packages/core
//     DECLARES the interfaces and other packages IMPLEMENT them.
//   · it had no concept of a seam METHOD, so it could not carry decision item 12
//     (the NotificationService tap surface), and no concept of LOCATION, so both
//     the Subly notification fork and the misplaced AnalyticsFunnel passed clean.
// Rebuilt rather than patched, per owner instruction.
//
// Checks, in order:
//   1. coverage self-check — the scan still finds packages
//   2. every packages/* dir on disk is owned by some capability          [C-1]
//   3. every path named exists; every declared seam SYMBOL is really declared
//      in the file claiming it; every declared METHOD is really declared on
//      THAT class — matched against comment- and string-stripped source, so a
//      doc comment cannot stand in for a contract                         [C-1]
//   4. consumers verified in BOTH directions against real pubspecs        [C-1]
//   5. no registered seam symbol is implemented under apps/ unless it is
//      DECLARED as a violation, and a declared violation whose file has
//      gone must be removed from the register                            [C-3]
//   6. every capability has a consumer, or a recorded reason              [C-2]
//   7. every DEMAND-GATED module is in exactly one of two legal states: no app
//      declares it and it does not exist, or an app declares it and it exists as
//      shared code with a register entry. Both violations fail.       [13]T-12
//
// ⚠️ VIOLATIONS AND MISSING SEAM METHODS ARE PRINTED ON EVERY RUN, pass or fail —
// the posture assert-seams-wired.mjs takes for owner-gated gaps. A known gap
// nobody sees becomes permanent. They do NOT fail the build: both current entries
// are blocked by 39-CHASSIS cut 1's freeze on apps/subly, which is an agreed cut
// the agent may not reverse. Undeclared ones DO fail.
//
// Usage:  node tooling/ci/assert-capability-register.mjs [repoRoot]
// Exit 0 = the register and the tree agree, 1 = they do not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

/**
 * Blank Dart comments and string literals, preserving offsets and newlines.
 *
 * A hand-rolled scanner rather than a regex: a regex cannot tell `//` inside a
 * string from a comment, and getting that backwards is how a guard ends up
 * matching its own documentation. It lives here rather than in a shared module
 * because every `.mjs` directly under tooling/ci is a GUARD to
 * assert-guard-coverage.mjs, and any `.mjs` in a subdirectory of tooling/ci is a
 * hard COVERAGE LOST — there is nowhere shared to put it.
 */
function stripDart(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; out += '  '; i += 2; if (depth === 0) break; continue; }
        out += blank(src[i]); i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      const start = i;
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') break;
        j++;
      }
      for (const ch of src.slice(start, j)) out += blank(ch);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * The body of `class <symbol>` in already-stripped source, or null.
 *
 * Scoping matters as much as stripping: without it, ANY class, extension or call
 * site in the same file satisfies the interface's method claim. Proven by
 * mutation — deleting `scheduleDaily` from `abstract interface class
 * NotificationService` while the sibling `NoOpNotificationService` in the same
 * file kept its override left this guard reporting the method "verified in place".
 */
function classBody(code, symbol) {
  const decl = new RegExp(`\\bclass\\s+${symbol}\\b`).exec(code);
  if (!decl) return null;
  const open = code.indexOf('{', decl.index);
  if (open === -1) return null; // `class X = A with B;` — no body to scope to
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}') { depth--; if (depth === 0) return code.slice(open, k + 1); }
  }
  return code.slice(open);
}

/** A member DECLARATION of `method`, not merely the name followed by a paren. */
const declaresMethod = (body, method) =>
  new RegExp(
    `(?:^|[;{}])\\s*(?:@\\w+\\s+)*(?:(?:static|external|abstract|covariant)\\s+)*` +
      `[A-Za-z_$][\\w<>,?\\[\\]$. ]*\\s+${method}\\s*\\(`,
  ).test(body);

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'capability-register.json');
const PACKAGES_DIR = join(ROOT, 'packages');
// Check 5's app roots are declared with the check itself, as FORK_SCAN_ROOTS —
// one entry per root, each with its own floor. A bare `APPS_DIR` const lived here
// and was the whole of that domain, floorless.
/** Whether the tree being scanned is the one this script lives in. Some checks
 *  name real seams of THIS repository and must not be asserted against the
 *  synthetic registers the guard tests build. */
const SCANNING_OWN_REPO = (dirname(fileURLToPath(import.meta.url)) + sep).startsWith(ROOT + sep);

/** A scan that matches nothing reports perfect coverage over an empty set. */
const MIN_EXPECTED_PACKAGES = 5;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── 0. the register ──────────────────────────────────────────────────────────
if (!existsSync(REGISTER)) {
  fail([
    `✗ COVERAGE LOST — no capability register at ${REGISTER}.`,
    '  [pipeline C-1] requires a machine-readable register of every shared capability.',
  ]);
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  fail([`✗ capability register is not valid JSON: ${err.message}`]);
}
const capabilities = Array.isArray(register.capabilities) ? register.capabilities : null;
if (!capabilities) fail(['✗ capability register has no `capabilities` array — nothing to enforce.']);
const consumerRoots = Array.isArray(register.consumerRoots) ? register.consumerRoots : [];
if (consumerRoots.length === 0) {
  fail(['✗ capability register declares no `consumerRoots` — direction (b) could never fail.']);
}

// ── 1. packages on disk ──────────────────────────────────────────────────────
let onDisk = [];
if (existsSync(PACKAGES_DIR) && statSync(PACKAGES_DIR).isDirectory()) {
  onDisk = listDir(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => `packages/${e.name}`)
    .sort();
}
if (onDisk.length < MIN_EXPECTED_PACKAGES) {
  fail([
    `✗ COVERAGE LOST — found only ${onDisk.length} package dir(s) under packages/,`,
    `  expected at least ${MIN_EXPECTED_PACKAGES}. The scan is broken, not the tree.`,
    `  repo root used: ${ROOT}`,
  ]);
}

const problems = [];

// ── 2. every package dir is owned by SOME capability ─────────────────────────
// Several capabilities may share an owner: `core` and `analytics_funnel` both
// live in packages/core, which is correct — one package can host more than one
// capability. So this is a set membership test, not a 1:1 map.
const owners = new Set(capabilities.map((c) => c.owner).filter(Boolean));
for (const dir of onDisk) {
  if (!owners.has(dir)) {
    problems.push(
      `${dir} — on disk but no capability register entry owns it. [C-1] An unregistered package is ` +
        'one nobody can discover before writing a second copy.',
    );
  }
}

// ── [pipeline 13]T-9a · A DECLARED GAP THAT CAN BE DELETED IS NOT A GAP ──────
//
// 🔴 THE FINDING (2026-08-02). `missingMethods` was READ in exactly one place —
// the print loop at the bottom — and validated NOWHERE. No required-field
// check (contrast `violations`, which are validated), and nothing that stopped
// the entry being deleted. Deleting the notification-tap entry made CI QUIETER,
// not redder. That is this repo's own recurring failure: a guard that stopped
// guarding, still printing "ok".
//
// Three things now hold, and each one has a recorded failing input:
//   (a) shape — surface / why / fixOwner, and `fixOwner` must name a live
//       PIPELINE ID rather than a sentence. `[G-7]` stayed open for months
//       because its owner was prose;
//   (b) it may not go STALE — every entry declares `closedIf`, the evidence
//       whose arrival means the gap is closed. If any of it now matches, the
//       entry is a stale waiver and the build says so. Same shape as the
//       declared-violation staleness check at [5] below;
//   (c) it may not DISAPPEAR — a seam on the list below owes a declared gap
//       until the gap is really closed, and deleting the entry fails the build.
//
// (c) is a REQUIRED_COVERAGE list, the idiom this repo already uses wherever a
// domain must not be allowed to shrink (assert-seams-wired.mjs,
// check-migrations.mjs). It is deliberately NOT derived: the whole point is
// that the tree cannot tell you a surface is missing — absence is exactly what
// a derivation cannot see, which is why the gap needed declaring in the first
// place.
const SEAMS_OWING_A_DECLARED_GAP = [
  // 🔴 EMPTY, AND THAT IS NOT THE LIST BEING SWITCHED OFF.
  //
  // It held exactly one row — `NotificationService` owing a /tap/i gap — and
  // [13]T-9 CLOSED that gap on 2026-08-07, which is the one condition under
  // which a row here is supposed to leave: the register's own `closedIf`
  // clauses both match now (the seam declares `notificationTaps()`, the adapter
  // registers `onDidReceiveNotificationResponse`), so keeping the waiver would
  // have failed this guard as the stale waiver it had become.
  //
  // The protection did not leave with it. A closed gap needs the OPPOSITE
  // check — not "is the absence still declared" but "is the feature still
  // there" — and that is WIRED_SURFACES_THAT_MAY_NOT_REGRESS below, which is
  // strictly stronger: this list could only notice a WAIVER being deleted; that
  // one notices the FEATURE being deleted. Both directions of the same
  // question, and the tree is only ever in one of the two states.
  //
  // The machinery stays because the next declared gap goes here, and because an
  // empty list is still exercised: the fixtures in
  // tooling/ci/test/capability-register-seams.test.mjs drive it with synthetic
  // rows, so the code path is covered whether or not this tree owes anything.
];

// ── [13]T-9 · A CLOSED GAP MAY NOT QUIETLY RE-OPEN ───────────────────────────
//
// The mirror image of the list above, and the reason this file did not simply
// get one row shorter. `notification_opened` was unemittable for months and
// NOTHING WENT RED, because a seam that refuses to deliver a tap is
// indistinguishable from a seam nobody tapped — this repo's "fail-closed seam
// with no proven open path" shape. Having paid to close it, the three links of
// the chain are now pinned INDEPENDENTLY, because each one can be removed on its
// own while the other two keep the tree looking wired:
//
//   `seamMethod`      — delete it from the seam and every consumer loses the
//                       surface. Caught by the `methods` check above too; named
//                       here so the chain is one readable thing.
//   `adapterPattern`  — the REGISTRATION. Delete `onDidReceiveNotificationResponse`
//                       from the adapter and the seam still compiles, every
//                       outbound test stays green, and no tap ever reaches Dart
//                       again. This is the mutation the increment was proven
//                       against, and this line is what makes it loud.
//   `emitter`         — the far end. If `onNotificationOpened(` loses its last
//                       caller the tap is delivered and then dropped on the
//                       floor, which is the original defect wearing a new hat.
//
// Same REQUIRED_COVERAGE idiom and the same reason for living in the .mjs rather
// than in the register: a requirement stored in the file it protects is
// removable by one edit to one file.
const WIRED_SURFACES_THAT_MAY_NOT_REGRESS = [
  {
    label: 'notification tap / open ([13]T-9)',
    seamSymbol: 'NotificationService',
    seamMethod: 'notificationTaps',
    adapter: 'packages/notifications/lib/src/local_notification_service_io.dart',
    adapterPattern: /onDidReceiveNotificationResponse|onDidReceiveBackgroundNotificationResponse/,
    emitter: { file: 'apps/subly/lib/state/analytics_funnel.dart', call: 'onNotificationOpened(' },
    why:
      'a scheduled reminder that opens nothing when tapped is a dead feature that reports healthy, and ' +
      'the `notification_opened` event goes back to zero emitters with no test red anywhere.',
  },
];

/** `[<stage 1-14>]<Letter>-<number>` — the pipeline id form used across the
 *  register and the plans. This checks the SHAPE and the stage range only, and
 *  says so: the requirement corpus (Private/requirements/, since the pipeline prose
 *  was folded into it 2026-08-15) is gitignored, so CI cannot resolve an id to a
 *  real requirement. A shape check still rules out the failure that mattered —
 *  a fix owner that is a sentence nobody is accountable for. */
const PIPELINE_ID = /\[(?:[1-9]|1[0-4])\][A-Z]-\d+/;

/** A declared violation's `fixOwner` must name a TRACKABLE work item, in one of
 *  the two forms this corpus actually uses: a pipeline id (`[2]C-3`) or an
 *  owner-queue row (`OWNER_QUEUE D-8`). Same deliberate ceiling as PIPELINE_ID
 *  above, for the same reason — Private/ is gitignored, so CI can check the
 *  FORM and never the EXISTENCE of the thing named.
 *
 *  🔴 WHY THIS EXISTS (2026-08-12). `violations[].fixOwner` was checked for
 *  PRESENCE only, while the identically-named field on `missingMethods[]` got
 *  the shape check at the `PIPELINE_ID.test` call below. Two limbs, one field
 *  name, one of them unguarded — and the guarded one had ZERO subjects, because
 *  this register declares no missingMethods at all. Net effect: NO fixOwner in
 *  this file was validated against anything. Proven by mutation on the real
 *  tree, not a fixture: setting a violation's fixOwner to the sentence
 *  "somebody should get round to this eventually" passed at EXIT 0. That is
 *  exactly the failure the missingMethods message already names — "A gap whose
 *  owner is a sentence is how G-7 stayed open" — reached through the other door.
 *
 *  ⚠️ WHAT A GREEN RUN HERE STILL DOES NOT MEAN. This cannot tell that a
 *  well-formed id points at a ticket that is CLOSED. All three violations named
 *  `[2]C-3` for four and a half months; C-3 is real, VERIFIED at
 *  02-shared-chassis.md:193, and its locked scope (02-STAGE-2-LOCKED.md:18) was
 *  one act — write assert-no-seam-forks.mjs — which shipped. A pointer at a
 *  finished ticket satisfies every mechanical check there is, and reads as
 *  legitimate on every pass. Resolving an id to a LIVE work item is a human
 *  control by necessity (OWNER_QUEUE D-8), not an oversight here. */
const FIX_OWNER_FORM = /(?:\[(?:[1-9]|1[0-4])\][A-Z]-\d+|OWNER_QUEUE\s+[A-Z]{1,3}-\d+[a-z]?)/;

let missingMethodEntries = 0;
const declaredGapSurfaces = new Map(); // seam symbol -> [surface strings]
const gapPrints = [];
/** One line per closed-and-pinned surface, printed for the same reason the gaps
 *  are: "nothing to report" and "reached nothing" print identically otherwise. */
const wiredPrints = [];

/** Every .dart file under the trees a caller could live in — apps, the shared
 *  packages and the brick template. Memoised; `dartFilesUnder` is a hoisted
 *  function declaration further down this file. Tests are INCLUDED here on
 *  purpose, and the difference matters: assert-seams-wired.mjs excludes them
 *  because a seam whose only caller is a test is dead, whereas here a test
 *  caller is still proof that a route to the method exists. */
let _allDart = null;
function allDartFiles() {
  if (_allDart) return _allDart;
  const out = [];
  for (const top of ['apps', 'packages', join('tooling', 'bricks')]) {
    const abs = join(ROOT, top);
    if (existsSync(abs)) dartFilesUnder(abs, top.split(/[\\/]/).join('/'), out);
  }
  _allDart = out;
  return out;
}

// ── 3. paths, seam symbols and seam methods are real ─────────────────────────
const seamSymbols = new Map(); // symbol -> capability id that declares it
for (const cap of capabilities) {
  const label = cap.id ?? cap.owner ?? '<unnamed>';
  if (!cap.owner) {
    problems.push(`${label} — entry has no \`owner\` path.`);
    continue;
  }
  if (!existsSync(join(ROOT, cap.owner))) {
    problems.push(`${label} — owner \`${cap.owner}\` does not exist on disk.`);
  }
  // legacy single-path seam, used by the two non-Dart capabilities
  if (cap.seam && !existsSync(join(ROOT, cap.seam))) {
    problems.push(`${label} — seam \`${cap.seam}\` does not exist on disk.`);
  }
  const seams = Array.isArray(cap.seams) ? cap.seams : [];
  if (seams.length === 0 && !cap.seam) {
    // Not every capability declares an interface (an adapter may only implement
    // one). Require it to say so explicitly rather than leaving the field absent.
    // Some capabilities genuinely have no interface: design_system is a widget
    // library, analytics_funnel is a concrete wrapper. That is legitimate, so it
    // must be STATED rather than left as an absent field.
    if (!Array.isArray(cap.implementsSeams) && !cap.unconsumedReason && !String(cap.noSeamReason ?? '').trim()) {
      problems.push(
        `${label} — declares no \`seams\`, no \`implementsSeams\` and no \`noSeamReason\`. Say which ` +
          'contract it owns or satisfies, or state why it has none; an unnamed seam is one nobody can code against.',
      );
    }
  }
  for (const s of seams) {
    if (!s.file || !existsSync(join(ROOT, s.file))) {
      problems.push(`${label} — seam file \`${s.file ?? '<missing>'}\` does not exist on disk.`);
      continue;
    }
    // 🔴 STRIP COMMENTS AND STRING LITERALS FIRST. Both checks below used to run
    // against the RAW file, so a doc comment satisfied them — the sibling
    // assert-no-seam-forks.mjs already carried a warning that this repo had
    // shipped exactly that bug ("the pattern had spanned out of a doc comment")
    // and this guard never got the same treatment. Mutation-proven 2026-08-01: a
    // complete, compile-clean rename of `scheduleDaily` to `scheduleReminder`
    // that left the old name in ONE house-style doc comment
    // (`/// Renamed 2026-08-01: scheduleDaily(...) is now scheduleReminder().`)
    // kept this guard at exit 0, still printing "seam symbol(s) verified in
    // place" for a method the interface no longer has. The register would have
    // gone on describing a contract that no longer existed. Delete that one
    // comment line and the guard fails — the comment was the entire difference.
    const src = stripDart(readFileSync(join(ROOT, s.file), 'utf8'));
    if (!s.symbol) {
      problems.push(`${label} — seam in \`${s.file}\` names no \`symbol\`.`);
      continue;
    }
    // The claim is that this file DECLARES the symbol, not merely mentions it.
    if (!new RegExp(`\\bclass\\s+${s.symbol}\\b`).test(src)) {
      problems.push(
        `${label} — register says \`${s.file}\` declares \`${s.symbol}\`, but no class of that name is ` +
          'declared there. The register is describing a contract that does not exist.',
      );
      continue;
    }
    seamSymbols.set(s.symbol, cap.id);
    const body = classBody(src, s.symbol);
    for (const m of s.methods ?? []) {
      // Scoped to the DECLARING CLASS and required to be a declaration, not any
      // `name(` anywhere in the file. `tooling/capability-register.json`'s own
      // _readme claims "every declared seam METHOD really appears in THAT
      // INTERFACE"; a bare `\bname\s*\(` over the whole file made good on
      // neither half of that sentence.
      if (body === null || !declaresMethod(body, m)) {
        problems.push(
          `${label} — register says \`${s.symbol}\` has method \`${m}\`, which is not declared in that ` +
            `class in \`${s.file}\` (comments, string literals and other classes in the same file do not ` +
            'count). [decision item 12] Naming a seam method is only useful if it is checked.',
        );
      }
    }

    // ── [13]T-9a — the gap this seam DOES NOT have ───────────────────────────
    for (const mm of s.missingMethods ?? []) {
      missingMethodEntries++;
      if (!declaredGapSurfaces.has(s.symbol)) declaredGapSurfaces.set(s.symbol, []);
      declaredGapSurfaces.get(s.symbol).push(String(mm.surface ?? ''));

      for (const field of ['surface', 'why', 'fixOwner']) {
        if (!String(mm[field] ?? '').trim()) {
          problems.push(
            `${label} — seam \`${s.symbol}\` declares a missing surface with no \`${field}\`. A gap with ` +
              'no owner and no reason is a note, and a note is what this entry exists instead of.',
          );
        }
      }
      if (mm.fixOwner && !PIPELINE_ID.test(mm.fixOwner)) {
        problems.push(
          `${label} — seam \`${s.symbol}\`'s missing-surface \`fixOwner\` is ${JSON.stringify(mm.fixOwner)}, ` +
            'which names no pipeline id (form `[2]C-3`). A gap whose owner is a sentence is how G-7 stayed ' +
            'open: nobody is accountable for a paragraph.',
        );
      }
      if (!Array.isArray(mm.closedIf) || mm.closedIf.length === 0) {
        problems.push(
          `${label} — seam \`${s.symbol}\`'s missing-surface entry declares no \`closedIf\` evidence. ` +
            'Without it the waiver outlives the thing it waives: the surface gets built somewhere else and ' +
            'the register goes on saying it is missing, forever.',
        );
        continue;
      }
      for (const c of mm.closedIf) {
        if (!c?.file || !c?.pattern || !c?.meaning) {
          problems.push(`${label} — a \`closedIf\` clause on \`${s.symbol}\` needs \`file\`, \`pattern\` and \`meaning\`.`);
          continue;
        }
        const p = join(ROOT, c.file);
        if (!existsSync(p)) {
          problems.push(
            `${label} — \`closedIf\` on \`${s.symbol}\` watches \`${c.file}\`, which does not exist. The ` +
              'evidence file moved and the waiver is now unfalsifiable.',
          );
          continue;
        }
        // Stripped, for the same reason every other check here is: the doc
        // comments in these files DISCUSS the missing tap surface at length, so
        // a raw-text match would report the gap closed by the prose describing it.
        if (new RegExp(c.pattern).test(stripDart(readFileSync(p, 'utf8')))) {
          problems.push(
            `${label} — the declared gap on \`${s.symbol}\` (${mm.surface}) is CLOSED: \`${c.file}\` now ` +
              `matches /${c.pattern}/ in code. ${c.meaning}. A stale waiver is how a closed gap keeps ` +
              'excusing a new one.',
          );
        }
      }
      // The other half of the same staleness question, pointed at the caller
      // side: a stranded emitter that gains a caller means somebody found a
      // route the register does not know about.
      const se = mm.strandedEmitter;
      if (se) {
        if (!se.file || !se.call || !se.why) {
          problems.push(`${label} — \`strandedEmitter\` on \`${s.symbol}\` needs \`file\`, \`call\` and \`why\`.`);
        } else if (!existsSync(join(ROOT, se.file))) {
          problems.push(`${label} — \`strandedEmitter\` on \`${s.symbol}\` names \`${se.file}\`, which does not exist.`);
        } else {
          const declaring = posix.normalize(se.file.replace(/\\/g, '/'));
          const callers = [];
          for (const rel of allDartFiles()) {
            if (rel === declaring) continue; // the declaration is not a caller
            if (stripDart(readFileSync(join(ROOT, rel), 'utf8')).includes(se.call)) callers.push(rel);
          }
          if (callers.length > 0) {
            problems.push(
              `${label} — the declared gap on \`${s.symbol}\` says \`${se.call}\` has no emitter, and it now ` +
                `has ${callers.length} (${callers.slice(0, 3).join(', ')}). ${se.why}`,
            );
          } else {
            gapPrints.push(
              `${label} — \`${s.symbol}\`: ${se.call.replace(/\($/, '')} has ZERO emitters tree-wide. ` +
                `The event exists, the funnel method exists, and nothing can call it until ${mm.fixOwner}.`,
            );
          }
        }
      }
    }
  }
}

// (c) the entry may not simply DISAPPEAR.
//
// Enforced only when scanning THIS repository, the same split check-site-integrity.mjs
// uses for REQUIRED_LEGAL_ROOTS: the list names a seam of this tree, and the guard
// fixtures are synthetic registers that legitimately owe nothing. The list lives in
// this .mjs rather than in the register on purpose — a requirement stored in the same
// JSON file as the entry it protects is removable by one edit to one file, which is
// exactly the deletion this check exists to make loud. Weakening it here is a guard
// edit, and assert-no-gate-weakening.mjs watches those.
for (const owed of SCANNING_OWN_REPO ? SEAMS_OWING_A_DECLARED_GAP : []) {
  if (!seamSymbols.has(owed.symbol)) {
    problems.push(
      `COVERAGE LOST — the register no longer declares a seam \`${owed.symbol}\`, so its required missing-surface ` +
        'gap cannot even be looked for. Re-point this list or remove the seam deliberately.',
    );
    continue;
  }
  const surfaces = declaredGapSurfaces.get(owed.symbol) ?? [];
  if (!surfaces.some((sf) => owed.surface.test(sf))) {
    problems.push(
      `\`${owed.symbol}\` must declare a missing surface matching ${owed.surface} and does not. ${owed.why} ` +
        'Deleting the entry does not close the gap — it only stops anyone hearing about it, which is the ' +
        'exact reason this check exists.',
    );
  }
}

// ── [13]T-9 · the closed gap, pinned link by link ────────────────────────────
//
// Own-repo only, same split as the list above: the guard fixtures are synthetic
// registers whose trees have no notifications adapter to point at.
for (const w of SCANNING_OWN_REPO ? WIRED_SURFACES_THAT_MAY_NOT_REGRESS : []) {
  // link 1 — the seam still declares the surface. Checked against the register
  // AND the source, because a `methods` entry that was quietly deleted takes the
  // section-3 check with it: the loop above can only verify methods it is told
  // about, so a deletion there is silent by construction.
  const owning = capabilities.find((c) => (c.seams ?? []).some((s) => s.symbol === w.seamSymbol));
  const seam = (owning?.seams ?? []).find((s) => s.symbol === w.seamSymbol);
  if (!seam) {
    problems.push(
      `COVERAGE LOST — ${w.label}: the register declares no seam \`${w.seamSymbol}\`, so its wired ` +
        'surface cannot even be looked for. Re-point this list or remove the seam deliberately.',
    );
  } else if (!(seam.methods ?? []).includes(w.seamMethod)) {
    problems.push(
      `${w.label} — the register no longer lists \`${w.seamMethod}\` among \`${w.seamSymbol}\`'s methods. ` +
        `${w.why} Un-declaring the surface is how it stops being checked.`,
    );
  } else {
    const body = classBody(stripDart(readFileSync(join(ROOT, seam.file), 'utf8')), w.seamSymbol);
    if (body === null || !declaresMethod(body, w.seamMethod)) {
      problems.push(
        `${w.label} — \`${w.seamSymbol}\` no longer declares \`${w.seamMethod}\` in \`${seam.file}\`. ${w.why}`,
      );
    }
  }

  // link 2 — THE REGISTRATION. Stripped first, for the reason every scan in this
  // file is: the adapter's doc comments discuss the callback by name at length,
  // so a raw-text match would report the registration present in a tree where
  // only the prose describing it survived.
  const adapterPath = join(ROOT, w.adapter);
  if (!existsSync(adapterPath)) {
    problems.push(
      `COVERAGE LOST — ${w.label}: the adapter \`${w.adapter}\` does not exist, so the registration ` +
        'check is unfalsifiable. The file moved; re-point this list.',
    );
  } else if (!w.adapterPattern.test(stripDart(readFileSync(adapterPath, 'utf8')))) {
    problems.push(
      `${w.label} — \`${w.adapter}\` no longer matches ${w.adapterPattern}. THE REGISTRATION IS GONE: ` +
        `the seam still compiles and every outbound test still passes, and no tap reaches Dart. ${w.why}`,
    );
  }

  // link 3 — the far end still has a caller. `allDartFiles()` includes tests on
  // purpose (see its doc), so this asks "does a route exist", not "does
  // production use it"; assert-seams-wired.mjs owns the stricter question.
  const declaring = posix.normalize(w.emitter.file.replace(/\\/g, '/'));
  if (!existsSync(join(ROOT, declaring))) {
    problems.push(`COVERAGE LOST — ${w.label}: emitter file \`${w.emitter.file}\` does not exist.`);
  } else {
    const callers = allDartFiles().filter(
      (rel) => rel !== declaring && stripDart(readFileSync(join(ROOT, rel), 'utf8')).includes(w.emitter.call),
    );
    if (callers.length === 0) {
      problems.push(
        `${w.label} — \`${w.emitter.call}\` is back to ZERO callers tree-wide. The tap is delivered and ` +
          `then dropped, which is the original defect in a new costume. ${w.why}`,
      );
    } else {
      wiredPrints.push(
        `${w.label} — seam method \`${w.seamMethod}\`, registration in \`${w.adapter}\`, ` +
          `${callers.length} emitter(s) of \`${w.emitter.call.replace(/\($/, '')}\`.`,
      );
    }
  }
}

// implementsSeams must name a contract that some capability actually declares
for (const cap of capabilities) {
  for (const sym of cap.implementsSeams ?? []) {
    if (!seamSymbols.has(sym)) {
      problems.push(
        `${cap.id} — claims to implement seam \`${sym}\`, which no register entry declares. ` +
          'Either the contract is unregistered or the name is wrong.',
      );
    }
  }
}

// ── 4. consumers, both directions ────────────────────────────────────────────
function declaredNikatruDeps(rel) {
  const p = join(ROOT, rel, 'pubspec.yaml');
  if (!existsSync(p)) return null;
  const found = new Set();
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const m = raw.replace(/#.*$/, '').match(/^\s+(nikatru_[a-z0-9_]+)\s*:/);
    if (m) found.add(m[1]);
  }
  return found;
}
const consumerDeps = new Map();
for (const root of consumerRoots) {
  const deps = declaredNikatruDeps(root);
  if (deps === null) {
    problems.push(`consumerRoots names \`${root}\`, which has no pubspec.yaml — direction (b) cannot run against it.`);
    continue;
  }
  consumerDeps.set(root, deps);
}

for (const cap of capabilities) {
  if (!cap.package) continue;
  for (const consumer of cap.consumers ?? []) {
    const deps = consumerDeps.get(consumer);
    if (!deps) {
      problems.push(`${cap.id} — claims consumer \`${consumer}\`, which is not a readable consumerRoot.`);
    } else if (!deps.has(cap.package)) {
      problems.push(
        `${cap.id} — register claims \`${consumer}\` consumes \`${cap.package}\`, but that pubspec does ` +
          'not declare it. The register is describing a dependency that no longer exists.',
      );
    }
  }
}
// (b) a package a consumer depends on must be registered, and SOME capability
//     with that package must list that consumer.
for (const [consumer, deps] of consumerDeps) {
  for (const dep of deps) {
    const caps = capabilities.filter((c) => c.package === dep);
    if (caps.length === 0) {
      problems.push(
        `${consumer} — depends on \`${dep}\`, which has no capability register entry. [C-1] A package ` +
          'wired into an app but never registered is invisible to the next person looking for it.',
      );
      continue;
    }
    if (!caps.some((c) => (c.consumers ?? []).includes(consumer))) {
      problems.push(
        `${dep} — \`${consumer}\` depends on it, but no capability entry lists that consumer. ` +
          'The register has fallen behind the tree.',
      );
    }
  }
}

// ── 5. [C-3 widened] a registered seam may not be implemented in an app ──────
const declaredViolations = new Map();
for (const cap of capabilities) {
  for (const v of cap.violations ?? []) {
    if (!v.path) {
      problems.push(`${cap.id} — a violation entry has no \`path\`.`);
      continue;
    }
    if (!existsSync(join(ROOT, v.path))) {
      problems.push(
        `${cap.id} — declared violation \`${v.path}\` no longer exists. It was fixed; REMOVE it from the ` +
          'register. A stale waiver is how a closed gap keeps excusing a new one.',
      );
      continue;
    }
    if (!v.detail || !v.fixOwner) {
      problems.push(`${cap.id} — violation \`${v.path}\` needs both \`detail\` and \`fixOwner\`.`);
    } else if (!FIX_OWNER_FORM.test(v.fixOwner)) {
      problems.push(
        `${cap.id} — violation \`${v.path}\`'s \`fixOwner\` is ${JSON.stringify(v.fixOwner)}, which names ` +
          'no trackable work item. Expected a pipeline id (`[2]C-3`) or an owner-queue row ' +
          '(`OWNER_QUEUE D-8`). A violation whose owner is a sentence is one nobody can ever schedule: ' +
          'it prints on every run and reads as managed. See FIX_OWNER_FORM for what this does NOT catch.',
      );
    }
    declaredViolations.set(posix.normalize(v.path.replace(/\\/g, '/')), { cap: cap.id, ...v });
  }
}

/** Every .dart file under `dir`, reported at `rel`. Used by check 5's per-root
 *  walk below and, hoisted, by `allDartFiles()` far above. */
function dartFilesUnder(dir, rel, out) {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'build' || e.name === '.dart_tool') continue;
    const abs = join(dir, e.name);
    const r = posix.join(rel, e.name);
    if (e.isDirectory()) dartFilesUnder(abs, r, out);
    else if (e.name.endsWith('.dart')) out.push(r);
  }
}
// ── check 5's DOMAIN, the floor under it, and what it deliberately delegates ─
//
// 🔴 THE FINDING (2026-09-05). This scan had NO FLOOR OF ANY KIND. Measured on
// the real tree, not argued: with `APPS_DIR` re-pointed at a real but Dart-free
// directory — the one-line shape of an app tree that is renamed, relocated, or
// grows a second source root — the guard printed
// `ok … 0 app file(s) scanned for forks` and EXITED 0. Check 1 has carried the
// sentence "a scan that matches nothing reports perfect coverage over an empty
// set" since day one and carried it about packages/ ONLY; the fork scan, whose
// entire job is to assert an ABSENCE, was the limb without it.
//
// ⚠️ WHAT WAS HOLDING IT UP INSTEAD, AND WHY THAT IS NOT A FLOOR. Emptying
// apps/*/lib on today's tree does go red — but only through three ACCIDENTS of
// the current register: the two declared violations at apps/subly/lib/… stop
// existing (the stale-waiver limb of this very check), and the [13]T-9 emitter
// pin names a third file under the same tree. Every one of those is a thing the
// de-forking increment (OWNER_QUEUE D-8) exists to REMOVE. The protection would
// have walked out with the thing it was protecting, and nothing would have said
// so — which is this repo's recurring failure, arriving on a schedule.
//
// ── WHY THE BRICK TEMPLATE IS NOT IN THIS DOMAIN ─────────────────────────────
// `isPerApp` below calls `__brick__/apps/` per-app territory while this scan
// reads apps/ alone, and that reads like one file disagreeing with itself. It
// was raised as exactly that, and it is not one. MEASURED 2026-09-05: a
// `class NotificationService` planted in
// tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart left
// THIS guard at exit 0 and turned assert-no-seam-forks.mjs RED — naming the
// file, the contract, and "THE TEMPLATE — every stamped app inherits this".
// Both guards run in the same ci.yml `platform` lane, so that is live coverage
// and not a plan. That guard's own header records this file's brick-blindness
// as the reason it was written, and its matcher is strictly stronger over the
// same tree: it also catches a RENAMED implementer, which name-matching cannot.
// Widening this scan to the template would therefore add a second red on every
// input the first one already reddens, and nothing else — an assertion whose
// domain is already covered inflates apparent coverage exactly the way the
// empty-domain one at [13]T-12 does.
//
// So the template is DELEGATED, not overlooked, and the delegation is now
// DECLARED, CHECKED AND PRINTED rather than left as an unwritten assumption
// discoverable only by reading a sibling guard. The residual risk is the one a
// root list always has — not an emptied root but an UNLISTED one — so every
// app-shaped `consumerRoot` must be under a scanned root or on the delegated
// list, and a root in neither fails the build.

/** Is this path a PER-APP location? apps/, or the brick's per-app template tree
 *  (stamping a capability into every app is per-app duplication wearing a
 *  template's clothes, which is precisely what "never per app" forbids).
 *  ONE definition, TWO readers: check 5's domain immediately below, and the
 *  demand gate's "never per app" limb at check 7. It used to sit beside check 7
 *  alone, 100-odd lines from the scan that most needed to agree with it. */
const isPerApp = (rel) => rel.startsWith('apps/') || rel.includes('__brick__/apps/');

/** Check 5's domain: ONE ENTRY PER ROOT, EACH CARRYING ITS OWN FLOOR — never a
 *  single floor over the union. A union floor is satisfied by whichever root is
 *  fattest while the others empty in silence; assert-no-tls-pinning.mjs:85-92
 *  records that guard printing ok over 12% of its subject for exactly that
 *  reason, and assert-workspace-coverage.mjs:130-136 records a union floor
 *  staying satisfied over an emptied apps/. The list shape is the protection:
 *  a second root cannot be added without being given a floor of its own. */
const FORK_SCAN_ROOTS = [
  {
    dir: 'apps',
    sub: 'lib',
    floor: 30,
    label: 'the shipped apps — where a forked seam reaches a real install (73 .dart under apps/*/lib today)',
  },
];

/** Per-app roots this check deliberately does NOT read, each naming the guard
 *  that does and the evidence that it really does.
 *
 *  A row here is a claim about ANOTHER FILE, so it states its ceiling: the
 *  delegate's EXISTENCE is checked here, its BEHAVIOUR is not. Nothing in this
 *  file can tell that assert-no-seam-forks.mjs still walks tooling/bricks — that
 *  is a guard edit, and assert-no-gate-weakening.mjs is what watches guard edits.
 *
 *  🔴 BUT THE SUBJECT IS CHECKED HERE, and it has to be, because the delegate
 *  cannot do it. assert-no-seam-forks.mjs:118 floors `sharedFiles.length +
 *  suspectFiles.length` at 10 — a UNION over packages/ AND apps/ AND
 *  tooling/bricks/. packages/ alone supplies 181 of today's 358 files, so the
 *  brick template could empty completely and that guard would still print ok
 *  over the rest. Delegating a root to a guard whose floor cannot notice the
 *  root emptying is delegating to nobody, so each row carries its OWN floor over
 *  its OWN tree — the same one-per-root rule the scanned roots follow. */
const FORK_SCAN_DELEGATED = [
  {
    root: 'tooling/bricks/app/__brick__/apps/{{app_id}}',
    to: 'tooling/ci/assert-no-seam-forks.mjs',
    floor: 10,
    why:
      'the brick template is that guard\'s C-9 limb ("a seam implementation never lives in the brick ' +
      'template"), it runs in the same ci.yml `platform` lane, and its matcher is strictly stronger over ' +
      'this tree because it also catches a renamed implementer. Measured 2026-09-05: a planted `class ' +
      'NotificationService` in the template leaves THIS guard at exit 0 and turns that one red.',
  },
];

const appFiles = [];
/** dir -> { present, appDirs, found } — kept per root so the passing line can
 *  print a SPLIT. A single total is still literally true of a collapsed tree,
 *  which is how a reader confirms coverage from a number that no longer has any. */
const forkScanPerRoot = new Map();
for (const r of FORK_SCAN_ROOTS) {
  const absRoot = join(ROOT, r.dir);
  const before = appFiles.length;
  let appDirs = 0;
  const present = existsSync(absRoot) && statSync(absRoot).isDirectory();
  if (present) {
    for (const e of listDir(absRoot, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      appDirs++;
      dartFilesUnder(join(absRoot, e.name, r.sub), `${r.dir}/${e.name}/${r.sub}`, appFiles);
    }
  }
  forkScanPerRoot.set(r.dir, { present, appDirs, found: appFiles.length - before });
}

// ── the floor, ONE PER ROOT ──────────────────────────────────────────────────
// Own-repo only, the same split every other coverage limb in this file takes and
// for the same reason: these numbers are measurements of THIS repository, and the
// guard's fixtures legitimately model a three-file tree. The sentinel is
// SCANNING_OWN_REPO, which is this script's own location — outside apps/, outside
// the brick, and therefore surviving any mutation OF a subject. WHICH BRANCH WAS
// TAKEN IS PRINTED ON EVERY RUN, at the bottom of this file, rather than implied.
if (SCANNING_OWN_REPO) {
  for (const r of FORK_SCAN_ROOTS) {
    const t = forkScanPerRoot.get(r.dir);
    if (!t.present) {
      problems.push(
        `COVERAGE LOST — check 5's root \`${r.dir}\` is not a directory under ${ROOT} — ${r.label}. This ` +
          'check asserts an ABSENCE, and an absence over an empty set is true of every tree including one ' +
          'where the walk is broken. There is no weaker pass than this one.',
      );
    } else if (t.found === 0) {
      problems.push(
        `COVERAGE LOST — check 5's root \`${r.dir}\` holds ${t.appDirs} app dir(s) and not one \`.dart\` ` +
          `file under \`${r.dir}/*/${r.sub}\` — ${r.label}. The source moved or the walk narrowed; neither ` +
          'is a clean tree, and both print identically to one.',
      );
    } else if (t.found < r.floor) {
      problems.push(
        `COVERAGE LOST — check 5's root \`${r.dir}\` yielded ${t.found} .dart file(s), below its floor of ` +
          `${r.floor} — ${r.label}. Either the scan narrowed or the tree really shrank; if it shrank, lower ` +
          'the floor in FORK_SCAN_ROOTS deliberately, in the same commit, with the new count in the message.',
      );
    }
  }
}

// ── the UNLISTED root — the failure a floor cannot see ───────────────────────
// A floor only ever asks "did the root I know about deliver?". It is blind to a
// per-app root that was never on the list, which is the same tree state and the
// quieter half of it. `consumerRoots` is this register's own machine-readable set
// of app roots, already verified against a real pubspec by check 4, so it is the
// honest place to ask the question from — and `isPerApp` decides what counts,
// which is the whole reason that predicate now lives above this check instead of
// beside check 7 only.
/** root -> .dart under it, so the printed line can show the delegated SUBJECT
 *  and not merely the fact that a delegation was declared. */
const delegatedCounts = new Map();
const forkScanCovers = (root) =>
  FORK_SCAN_ROOTS.some((r) => {
    const parts = root.split('/');
    return parts.length === 2 && parts[0] === r.dir;
  });
for (const root of consumerRoots) {
  if (!isPerApp(root)) continue; // packages/purchases is a consumerRoot and is not an app
  if (forkScanCovers(root)) continue;
  const delegated = FORK_SCAN_DELEGATED.find((d) => d.root === root);
  if (!delegated) {
    problems.push(
      `COVERAGE LOST — \`${root}\` is a per-app consumerRoot that check 5 does not scan and no entry in ` +
        'FORK_SCAN_DELEGATED hands to another guard. A seam forked under a per-app root nobody reads is ' +
        'invisible here, and if that root is a TEMPLATE it is forked into every app stamped from it. Put ' +
        'it under a scanned root with its own floor, or delegate it explicitly, naming the guard that ' +
        'covers it and the evidence that it does.',
    );
    continue;
  }
  // NOT own-repo gated, unlike the floors: "the guard I handed this root to is
  // on disk" is true or false in any tree, and a fixture that delegates to a
  // file it did not create is exactly the failure this limb exists to catch.
  if (!existsSync(join(ROOT, delegated.to))) {
    problems.push(
      `COVERAGE LOST — \`${root}\` is delegated to \`${delegated.to}\`, which does not exist. The ` +
        'delegation is now a promise to a file that is gone, and this check has been reading past that ' +
        `root on the strength of it. ${delegated.why}`,
    );
    continue;
  }
  // ── and the delegated SUBJECT must still be there ──────────────────────────
  // The delegate's own floor is a union it cannot un-pool (see the doc above),
  // so this root's emptiness is a thing only this file is positioned to notice.
  // Un-gated for the "not one .dart" case — true or false in any tree — and
  // own-repo gated for the count, which is a measurement of this repository.
  const delegatedFiles = [];
  dartFilesUnder(join(ROOT, ...root.split('/')), root, delegatedFiles);
  delegatedCounts.set(root, delegatedFiles.length);
  if (delegatedFiles.length === 0) {
    problems.push(
      `COVERAGE LOST — \`${root}\` is delegated to \`${delegated.to}\` and holds no \`.dart\` file at ` +
        'all. The delegation now covers an empty set, which reads exactly like a template with nothing ' +
        'wrong in it. Re-point the row or remove it deliberately.',
    );
  } else if (SCANNING_OWN_REPO && delegatedFiles.length < delegated.floor) {
    problems.push(
      `COVERAGE LOST — \`${root}\` yielded ${delegatedFiles.length} .dart file(s), below the floor of ` +
        `${delegated.floor} this row carries over the tree it delegates. ${delegated.to} floors its whole ` +
        'corpus as one union and cannot see this root shrink; that is why the floor lives here.',
    );
  }
}

for (const rel of appFiles) {
  // Stripped for the same reason as check 3, pointed the other way: here a
  // commented-out `class NotificationService` would falsely ACCUSE an app file
  // of forking a seam. Same rule either way — assert on code, never on prose.
  const src = stripDart(readFileSync(join(ROOT, rel), 'utf8'));
  for (const [symbol, capId] of seamSymbols) {
    // A concrete class of the same name as a registered seam, inside an app, is a
    // fork. `implements`/`extends` clauses are excluded: an app may legitimately
    // hold a class that IMPLEMENTS a seam only if the register says so, and the
    // declaration form is what distinguishes a fork from a wiring class.
    if (!new RegExp(`^\\s*(?:final\\s+|base\\s+)?class\\s+${symbol}\\b`, 'm').test(src)) continue;
    if (declaredViolations.has(rel)) continue;
    problems.push(
      `${rel} — declares \`class ${symbol}\`, which is a seam registered to \`${capId}\`. [C-3, widened] ` +
        'A register-assigned capability may not be implemented in an app. Move it, or declare it as a ' +
        'violation in the register with a detail and a fixOwner.',
    );
  }
}

// ── 6. [C-2] a capability with no consumer is not built ──────────────────────
const waived = [];
for (const cap of capabilities) {
  if ((cap.consumers ?? []).length > 0) continue;
  if (String(cap.unconsumedReason ?? '').trim()) {
    waived.push(cap);
    continue;
  }
  problems.push(
    `${cap.id} — ZERO consumers and no \`unconsumedReason\`. [C-2] Presence in packages/ is not delivery: ` +
      'it costs a pubspec, an analysis_options, a workspace entry, a test harness and a CI surface forever.',
  );
}

// ── 7. [13]T-12 — THE DEMAND GATE ────────────────────────────────────────────
//
// "No app declares a habit-module need ⇒ the module must not exist. The moment
// an app declares one ⇒ the module must exist as shared code with a register
// entry, and the build fails until it does."
//
// ── WHY THE DECLARATION SURFACE IS A REGISTER ROW AND NOT A BRICK VAR ────────
// The requirement quantifies over apps, so the guard needs a set of apps and a
// per-app fact. Two surfaces were available and the choice is not cosmetic:
//
//   · A BRICK VAR + app spec field. Rejected. A mason var is consumed at STAMP
//     time — mustache eats it — so unless it is written back into a new per-app
//     file there is nothing on disk to quantify over, and inventing a per-app
//     spec file to hold one boolean puts app metadata in a fourth place beside
//     pubspec.yaml, catalog/apps.json and the registers, which is
//     the [C-1] "one declared home" argument turned on itself. Worse, it would
//     be a domain that EXCLUDES THE ONLY SHIPPED APP: apps/subly was never
//     stamped by this brick and would carry no such field. A scan whose domain
//     silently omits the real app is this repo's recurring failure with a new
//     name — it prints ok over the set it can see.
//   · A ROW IN tooling/capability-register.json. Chosen. `consumerRoots` is
//     already the machine-readable set of apps here, each verified against a
//     real pubspec by check 4, so the domain is real, non-empty and typo-checked
//     for free. And this file is the ONLY one in the tree whose contract already
//     includes DESCRIBING ABSENCE — `missingMethods`, `violations`,
//     `unconsumedReason` all name things that are not there. A demand gate is a
//     statement about absence, so it belongs where absence is already speakable.
//
// A pubspec dependency was considered as the declaration and is not viable: a
// `path:` dependency on a package that does not exist breaks workspace
// resolution for the WHOLE tree before any guard runs, so the declaration could
// never be committed ahead of the module — which is the exact ordering the
// requirement asks for.
//
// ── WHAT IS DELIBERATELY NOT BUILT HERE ──────────────────────────────────────
// The same requirement denylists points / xp / coins / gems / currency / score
// from the module's public API. That limb is NOT built, and not from oversight:
// the module does not exist, so no input to this tree can make it fail. An
// assertion that cannot fail is worse than none — it inflates apparent coverage
// — so it lands with the module's first line.
//
// ── COVERAGE, which matters MORE here than anywhere else in this file ────────
// This guard's domain is deliberately near-empty: the correct answer today is
// "nothing found", and "nothing found" is exactly what a broken scanner also
// reports. So three things are asserted before the gate's verdict is believed:
//   (a) the app domain is non-empty — a gate over zero apps can never fail;
//   (b) a POSITIVE CONTROL through the very same matcher. `NotificationService`
//       is a class this tree certainly declares; if the module scanner cannot
//       find it, the scanner is broken and its "no habit module" is a false
//       negative rather than a fact. It is a safe anchor rather than one more
//       thing to keep in step, because a rename of that symbol ALREADY fails
//       this file twice over — check 3 verifies the register's seam entry and
//       SEAMS_OWING_A_DECLARED_GAP forbids losing it;
//   (c) the required rows may not simply be DELETED. Same REQUIRED_COVERAGE
//       idiom, and the same reason, as SEAMS_OWING_A_DECLARED_GAP above: the
//       list lives in this .mjs, not in the JSON it protects, so removing the
//       row is not a one-file edit that quietly empties the domain.
//
// ── MUTATIONS RUN AGAINST THE REAL TREE, 2026-08-07 (not fixtures) ───────────
// Each was `dart analyze`-clean first, so the red was this guard's verdict and
// not a broken tree, and each was reverted byte-identical:
//   1. `packages/habit` + `class StreakService`, nothing declaring   → RED (ii)
//   2. the same, PLUS a full `capabilities` entry with an accepted
//      `unconsumedReason` — i.e. checks 2 and 6 both satisfied       → RED (ii)
//      ALONE. That is the proof this limb is not redundant with what
//      was already here: the tree was correct by every pre-existing
//      rule and still had a capability nobody asked for.
//   3. `declaredBy: ["apps/subly"]` with no module                  → RED (iii)
//   4. the `habit` row deleted / the whole key deleted           → COVERAGE LOST
//   5. `class StreakService` under apps/subly/lib                    → RED (i)
//   6. the scanner's `class` regex broken to `clazz`              → COVERAGE LOST
//      while the module verdict still read "not built" — the exact false
//      negative (b) exists to catch.
// And the false-POSITIVE case, because a gate that fires on prose gets deleted:
// appending `// … class StreakService is deliberately NOT built here.` to a real
// Dart file left the guard green. Comments are stripped before the match.
const DEMAND_GATES_OWED = ['habit'];
const CONTROL_SYMBOL = 'NotificationService';

/** Consumer roots that can DECLARE demand: an app, or the brick template every
 *  future app is stamped from. `packages/purchases` is a consumerRoot too and is
 *  not an app — the requirement quantifies over apps, so it is not in the domain. */
const demandRoots = consumerRoots.filter((r) => r.startsWith('apps/') || r.includes('__brick__'));

// `isPerApp` — the "never per app" predicate this limb uses — is declared with
// check 5's domain above, because check 5 has to agree with it about what per-app
// territory is. It was defined here, and only here, while check 5 read apps/
// alone; the two never disagreed in fact, but nothing in the file said so.

/** Files declaring `class <symbol>` for any of `symbols`, in stripped source —
 *  so the prose in packages/core's notification seam, which discusses streaks and
 *  daily goals at length, cannot be mistaken for an implementation. */
function filesDeclaring(symbols) {
  const hits = [];
  if (!symbols.length) return hits;
  const re = new RegExp(`\\bclass\\s+(?:${symbols.join('|')})\\b`);
  for (const rel of allDartFiles()) {
    if (re.test(stripDart(readFileSync(join(ROOT, rel), 'utf8')))) hits.push(rel);
  }
  return hits;
}

const gatedModules = Array.isArray(register.demandGatedModules?.modules)
  ? register.demandGatedModules.modules
  : null;

if (SCANNING_OWN_REPO) {
  if (gatedModules === null) {
    problems.push(
      'COVERAGE LOST — the register declares no `demandGatedModules.modules` array. [13]T-12 is a gate ' +
        'over a domain, and the domain has gone: every demand-gated module would now pass by being absent ' +
        'from the list rather than by being correctly unbuilt.',
    );
  }
  if (demandRoots.length === 0) {
    problems.push(
      'COVERAGE LOST — the demand gate quantified over ZERO apps. `consumerRoots` names no app and no ' +
        'brick template, so no app could ever declare a need and the gate could never fail.',
    );
  }
  if (filesDeclaring([CONTROL_SYMBOL]).length === 0) {
    problems.push(
      `COVERAGE LOST — the module scanner cannot find \`class ${CONTROL_SYMBOL}\`, which this tree ` +
        'certainly declares. The scanner is broken, not the tree: every "the module does not exist" ' +
        'verdict below would be a false negative, and a demand gate whose scanner sees nothing reports ' +
        'the correct answer for the wrong reason, forever.',
    );
  }
  for (const owed of DEMAND_GATES_OWED) {
    if (!(gatedModules ?? []).some((m) => m?.id === owed)) {
      problems.push(
        `COVERAGE LOST — the demand-gate row for \`${owed}\` is gone. Deleting the row does not remove the ` +
          'requirement; it only stops anyone hearing about it, and leaves the module free to be built ' +
          'unasked. Remove it deliberately by removing it from DEMAND_GATES_OWED in this guard.',
      );
    }
  }
}

const gateStamp = new Date().toISOString().slice(0, 10);
const gatePrints = [];

for (const m of gatedModules ?? []) {
  const label = `demand-gate ${m?.id ?? '<unnamed>'}`;
  if (!m?.id || !m?.module?.owner || !m?.module?.package || !Array.isArray(m?.module?.symbols) || !m.module.symbols.length) {
    problems.push(
      `${label} — a demand-gate row needs \`id\` and a \`module\` with \`owner\`, \`package\` and a ` +
        'non-empty `symbols` list. Without the symbols there is nothing to look for, and the gate would ' +
        'report "not built" over an empty search.',
    );
    continue;
  }
  for (const field of ['requirement', 'capability', 'why']) {
    if (!String(m[field] ?? '').trim()) {
      problems.push(`${label} — declares no \`${field}\`. A deferral with no owner and no reason is a note.`);
    }
  }
  if (m.requirement && !PIPELINE_ID.test(m.requirement)) {
    problems.push(
      `${label} — \`requirement\` is ${JSON.stringify(m.requirement)}, which names no pipeline id ` +
        '(form `[13]T-12`). A deferral whose owner is a sentence is one nobody is accountable for.',
    );
  }

  const declaredBy = Array.isArray(m.declaredBy) ? m.declaredBy : [];
  for (const d of declaredBy) {
    if (!demandRoots.includes(d)) {
      problems.push(
        `${label} — \`${d}\` declares a need, but it is not one of this register's app consumerRoots ` +
          `(${demandRoots.join(', ') || 'none'}). A declaration from something that is not an app in the ` +
          'tree is a demand nobody can satisfy.',
      );
    }
  }

  const ownerOnDisk = existsSync(join(ROOT, m.module.owner));
  const entry = capabilities.find((c) => c.id === m.id || c.package === m.module.package) ?? null;
  const hits = filesDeclaring(m.module.symbols);
  const perAppHits = hits.filter(isPerApp);
  const sharedHits = hits.filter((h) => !isPerApp(h));
  const built = ownerOnDisk || entry !== null || hits.length > 0;

  // (i) "Never per app" — its own limb, checked whether or not demand exists.
  if (m.neverPerApp !== false && perAppHits.length) {
    problems.push(
      `${label} — implemented PER APP at ${perAppHits.join(', ')}. [13]T-12: the module is "built once ` +
        'when the first app that needs it is being built, and inherited thereafter. Never per app." ' +
        'Move it into shared code.',
    );
  }

  if (declaredBy.length === 0) {
    // (ii) direction one — a module nobody asked for.
    if (built) {
      const found = [
        ownerOnDisk ? `\`${m.module.owner}\` exists on disk` : null,
        entry ? `capability \`${entry.id}\` is registered for \`${m.module.package}\`` : null,
        hits.length ? `${hits.length} file(s) declare it (${hits.slice(0, 3).join(', ')})` : null,
      ].filter(Boolean);
      problems.push(
        `${label} — the ${m.id} module EXISTS and no app declares a need for it: ${found.join('; ')}. ` +
          '[2]C-2 — presence is not delivery. A capability with no consumer is wired, guarded, green and ' +
          `useless, and it costs a pubspec, an analysis_options, a workspace entry, a test harness and a ` +
          'CI surface forever. Either an app declares it in `demandGatedModules` and it becomes a real ' +
          'capability entry, or it does not get built.',
      );
    }
  } else {
    // (iii) direction two — demand declared, so the module is now owed.
    const missing = [];
    if (!ownerOnDisk) missing.push(`no \`${m.module.owner}\` directory`);
    if (!sharedHits.length) missing.push(`no shared code declaring ${m.module.symbols.join(' / ')} outside apps/`);
    if (!entry) missing.push(`no \`capabilities\` entry owning \`${m.module.package}\``);
    if (missing.length) {
      problems.push(
        `${label} — ${declaredBy.join(', ')} declare${declaredBy.length === 1 ? 's' : ''} a need for the ` +
          `${m.id} module, and it is not there: ${missing.join('; ')}. ${m.requirement ?? ''} The build ` +
          'fails until it exists as shared code with a register entry — that is what a demand gate is for.',
      );
    } else {
      for (const d of declaredBy) {
        if (!(entry.consumers ?? []).includes(d)) {
          problems.push(
            `${label} — \`${d}\` declares a need for the ${m.id} module, but capability \`${entry.id}\` does ` +
              'not list it as a consumer. The declaration and the register disagree about who it is for.',
          );
        }
      }
    }
  }

  // THE PRINT. Emitted here rather than in the block below the fail-exit, so it
  // appears on EVERY run — including a failing one. A gate whose status is only
  // visible when the build is already green is a gate nobody reads.
  if (declaredBy.length === 0 && !built) {
    gatePrints.push(`⬜ ${gateStamp} — no consumer declares the ${m.id} module.`);
    gatePrints.push(
      `     ${m.requirement ?? ''} not built, on purpose. Checked ${demandRoots.length} app root(s) and ` +
        `${allDartFiles().length} Dart file(s): \`${m.module.owner}\` absent, no \`${m.module.package}\` ` +
        `capability entry, zero files declaring ${m.module.symbols.join(' / ')}.`,
    );
  } else if (declaredBy.length > 0) {
    gatePrints.push(
      `⚠  ${gateStamp} — ${declaredBy.length} consumer(s) declare the ${m.id} module: ${declaredBy.join(', ')}.`,
    );
  }
}
for (const line of gatePrints) console.log(line);

if (problems.length) {
  console.error(`✗ capability register — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [C-1] one declared home per capability · [C-2] no capability without a consumer ·');
  console.error('  [C-3] no register-assigned capability implemented in an app.');
  console.error('  Register: tooling/capability-register.json');
  process.exit(1);
}

// ── the gaps print whether or not the build passes ───────────────────────────
for (const cap of waived) console.log(`⚠  ${cap.id} — no consumer. ${cap.unconsumedReason}`);
for (const [path, v] of declaredViolations) {
  console.log(`⚠  ${v.cap} — ${v.kind ?? 'violation'} at ${path} (declared ${v.declaredOn ?? '?'}) → fix owner: ${v.fixOwner}`);
}
for (const cap of capabilities) {
  for (const s of cap.seams ?? []) {
    for (const mm of s.missingMethods ?? []) {
      console.log(`⚠  ${cap.id} — seam \`${s.symbol}\` is MISSING the ${mm.surface} surface → ${mm.fixOwner}`);
    }
  }
}
// [13]T-9a. The uncomfortable half, printed EVERY run rather than left to be
// discovered: an event in the v1 set that nothing can emit. Printed, not failed,
// because closing it is a seam extension owned by another stage — and a guard
// that blocks all CI on work this branch may not do is one somebody switches off.
for (const g of gapPrints) console.log(`⬜ ${g}`);
// The closed ones, printed too. A surface this list protects is invisible while
// it holds, and an invisible check is one nobody notices has been re-pointed.
for (const w of wiredPrints) console.log(`✅ ${w}`);

const seamCount = seamSymbols.size;
// 🔴 THE SPLIT, NOT THE TOTAL. This line used to read "N app file(s) scanned for
// forks" — one number over a domain the reader had to take on trust, and a
// sentence that stayed literally true at N=0. A per-root breakdown with its floor
// beside it cannot be true of a collapsed tree.
const forkSplit = FORK_SCAN_ROOTS.map((r) => {
  const t = forkScanPerRoot.get(r.dir);
  return `${r.dir}/*/${r.sub}=${t.found}${SCANNING_OWN_REPO ? `/floor ${r.floor}` : ''}`;
}).join(', ');
console.log(
  `ok  capability register — ${capabilities.length} capability(ies) over ${onDisk.length} package dir(s); ` +
    `${seamCount} seam symbol(s) verified in place, ${appFiles.length} app file(s) scanned for forks ` +
    `[${forkSplit}], ${declaredViolations.size} declared violation(s), ${waived.length} unconsumed with a reason`,
);
// WHICH BRANCH THE FLOORS TOOK, on every run rather than implied — a floor that
// is silently skipped over a foreign root reads exactly like a floor that passed.
console.log(
  `    check 5 fork scan: ${forkSplit}; ${FORK_SCAN_DELEGATED.length} per-app root(s) delegated ` +
    `(${FORK_SCAN_DELEGATED.map(
      (d) => `${d.root}=${delegatedCounts.get(d.root) ?? 'not a consumerRoot here'} .dart → ${d.to}`,
    ).join('; ')})` +
    (SCANNING_OWN_REPO
      ? '; per-root floors APPLIED'
      : '; per-root floors NOT applied — this root is not a checkout of this repository, so only the ' +
        'unlisted-root and delegation limbs ran'),
);
// The COUNT, not merely the entries. Zero and one print identically once the
// loop above has nothing to iterate, which is precisely how `missingMethods`
// spent its whole life unvalidated: it was read once, printed, and an empty
// array looked exactly like a healthy one.
console.log(
  `    ${missingMethodEntries} declared missing-surface gap(s), each with a pipeline owner and the evidence ` +
    `that would close it; ${SEAMS_OWING_A_DECLARED_GAP.length} seam(s) may not have theirs deleted, ` +
    `${WIRED_SURFACES_THAT_MAY_NOT_REGRESS.length} closed surface(s) pinned link-by-link ` +
    `(${wiredPrints.length} verified)`,
);
// The demand gate's own counts, for the same reason the line above prints a
// COUNT: its correct state is "nothing found", which is indistinguishable from a
// scan that reached nothing unless the size of what it reached is printed.
console.log(
  `    ${(gatedModules ?? []).length} demand-gated module(s) evaluated over ${demandRoots.length} app root(s) ` +
    `and ${allDartFiles().length} Dart file(s); ${DEMAND_GATES_OWED.length} row(s) may not be deleted`,
);
