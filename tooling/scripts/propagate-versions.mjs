#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// propagate-versions.mjs — write tooling/versions.json out to every call site
// the drift guard already knows about.
//
// 🔴 THE DEFECT THIS EXISTS FOR, AND IT IS THE ROUTINE ONE, NOT THE EXOTIC ONE.
// Renovate's customManagers (renovate.json) move ONE line: the value in
// tooling/versions.json. GitHub Actions cannot interpolate a file into `with:`,
// so the same version is also WRITTEN at each call site, and
// tooling/ci/assert-version-consistency.mjs refuses the build until every one of
// them follows. That refusal is correct and deliberate — it is the whole reason
// versions.json is a single declaration rather than a wish.
//
// What it is not, is finished. Every toolchain bump this repo has taken —
// PR #364 (flutter), #406, #527, #528 (melos) — arrived RED and needed a hand
// commit on the bot's own branch that did nothing but re-type the value the
// guard had just printed. The guard names the file, the line, the current value
// and the wanted value. Everything needed to do the edit is already on the
// screen; only the typing was left to a person, and a step that is left to a
// person on every single bump is the step that eventually gets skipped or
// mistyped.
//
// So this writes it. And it writes it from THE GUARD'S OWN TABLE — it imports
// `RULES` and `collectTargets` from assert-version-consistency.mjs rather than
// carrying a second copy. A second copy would agree with the guard right up
// until the day somebody widens one of them, which is the exact shape of every
// drift this repo has recorded. There is one table; the guard reads it to
// refuse, this reads it to write.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHAT IT REFUSES, AND WHY REFUSING IS THE POINT
//
// Some call sites CANNOT HOLD the value versions.json declares, and writing one
// anyway would be worse than leaving the build red. renovate.json's own policy
// block spells this out for the `java` and `node` toolchain FLOORS: both are
// declared as a bare major on purpose, the installer resolves the patch at
// runtime, and of java's eight call sites FIVE cannot express a patch in any
// syntax — `JavaVersion.VERSION_17` (twice) and `JvmTarget.JVM_17` are enum
// constants with no `VERSION_17_0_20` spelling, while `openjdk-17-jdk-headless`
// and `java-17-openjdk-amd64` are an apt package name and a JVM directory. That
// is not a formatting problem: three of the five decide what the Android build
// EMITS and the other two decide which JDK a local build runs on at all.
//
// This script does not carry that list. It DERIVES the property, per site, by
// round-tripping the rule that found the site: splice the declared value into
// the capture the rule matched, then run the SAME rule over the result and ask
// whether it captures back exactly what was written. `JavaVersion.VERSION_` +
// `17.0.20+8` re-reads as `17`, so the round trip fails and the site is refused
// BY NAME. Nothing is hand-maintained, so nothing can go stale, and a rule that
// gains a call site tomorrow gets the same test for free.
//
// A refusal fails the WHOLE run (exit 2) and writes nothing, even to the sites
// that could have taken the value. A partial propagation is the worst of the
// three outcomes: it produces a tree where some sites moved and some did not,
// which is drift with a commit behind it.
//
// ─────────────────────────────────────────────────────────────────────────────
// Usage:
//   node tooling/scripts/propagate-versions.mjs [repoRoot]            # dry run
//   node tooling/scripts/propagate-versions.mjs [repoRoot] --write    # apply
//
// Exit 0 = in sync, or (with --write) brought into sync.
// Exit 2 = REFUSED. Either a site cannot hold the declared value, or a rule
//          names a key versions.json does not declare, or the scan matched
//          nothing at all. Nothing was written in any of those cases.
// (Exit 1 comes only from the shared `collectTargets`, which refuses on its own
//  COVERAGE LOST limbs with the guard's own wording — a required target that
//  vanished is the guard's finding, not this script's.)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, collectTargets, stripComments } from '../ci/assert-version-consistency.mjs';

/** Sites whose value must move by HAND even though the syntax would accept it,
 *  each with the reason the table itself gives. This is the one hand-maintained
 *  thing in the file, so it is kept to claims that survive being read aloud —
 *  and it is CHECKED against RULES at startup, below, so an entry naming a rule
 *  that no longer exists is a refusal rather than a silent no-op. */
export const HAND_ONLY = new Map([
  [
    'gitleaks (scan-secrets VALIDATED_AGAINST)',
    'tooling/ci/scan-secrets.mjs names the gitleaks release its `scanned ~N bytes` parser was ' +
      'MEASURED against, and that file states the consequence of moving it blind in its own words: ' +
      'when gitleaks rewords the line, "the volume floor below stops applying, and every scan ' +
      'afterwards passes with the coverage claim quietly missing". The constant moves together with ' +
      'the captured canary lines beside it, by somebody who re-ran the parser — never by a script ' +
      'that only knows the number changed.',
  ],
]);

/** The declared value spliced into the span the rule captured, then read back by
 *  the SAME rule. Returns true only if the site can hold the value verbatim. */
function roundTrips(rule, matchText, captureStart, captureEnd, declared) {
  const candidate = matchText.slice(0, captureStart) + declared + matchText.slice(captureEnd);
  const probe = new RegExp(rule.re.source, rule.re.flags.replace('g', ''));
  const m = probe.exec(candidate);
  return m !== null && (m[1] ?? '') === declared;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const positional = args.filter((a) => !a.startsWith('--'));
  const repoRoot = positional[0] ?? process.cwd();

  const declPath = join(repoRoot, 'tooling', 'versions.json');
  if (!existsSync(declPath)) {
    console.error(`✗ REFUSED — no tooling/versions.json under ${repoRoot}; there is nothing to propagate.`);
    process.exit(2);
  }
  const decl = JSON.parse(readFileSync(declPath, 'utf8'));

  // ── the exemption map must still describe rules that exist ─────────────────
  const labels = new Set(RULES.map((r) => r.label));
  const orphaned = [...HAND_ONLY.keys()].filter((l) => !labels.has(l));
  if (orphaned.length) {
    console.error('✗ REFUSED — HAND_ONLY names a rule assert-version-consistency.mjs no longer has:');
    for (const l of orphaned) console.error(`    ${l}`);
    console.error('  A stale exemption silently stops exempting anything. Delete it, or fix the label.');
    process.exit(2);
  }

  const TARGETS = collectTargets(repoRoot);

  /** rel -> line index -> [{start, end, declared}] — collected, then applied in
   *  reverse so earlier edits cannot move later offsets. */
  const edits = new Map();
  const moved = [];
  const refusals = [];
  let sites = 0;

  for (const rel of TARGETS) {
    const abs = join(repoRoot, rel);
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // 🔴 THE SAME STRIP THE GUARD USES, IMPORTED RATHER THAN RE-TYPED. Scanning
      // the raw line would rewrite versions quoted inside comments, and this is
      // not a hypothetical: pubspec.yaml's melos block enumerates three of the
      // six call sites in `#` prose, one of them character-for-character. The
      // stripped text is a PREFIX of the line, so every offset found in it is
      // still the right offset in the line the edit is applied to.
      const code = stripComments(rel, line);
      for (const rule of RULES) {
        const scanner = new RegExp(rule.re.source, `${rule.re.flags.replace('d', '')}d`);
        let m;
        while ((m = scanner.exec(code)) !== null) {
          if (m[0] === '') break; // a zero-width match would loop forever
          sites++;
          const span = m.indices?.[1];
          const actual = (m[1] ?? '').trim();
          const declared = decl[rule.key];
          const where = `${rel}:${i + 1} ${rule.label}`;

          if (declared === undefined) {
            refusals.push({
              kind: 'undeclared',
              text:
                `${where} — the rule reads versions.json key \`${rule.key}\`, which that file does not declare. ` +
                'Propagating would write "undefined" into a build input.',
            });
            continue;
          }
          if (span === undefined) {
            refusals.push({ kind: 'nocapture', text: `${where} — the rule matched but captured nothing to replace.` });
            continue;
          }
          if (actual === '') {
            refusals.push({
              kind: 'unpinned',
              text:
                `${where} — the site is UNPINNED (it takes whatever is newest on every run). The rule can say ` +
                `where the value goes but not what separates it from what precedes it, so writing \`${declared}\` ` +
                'here could produce a line that reads back correctly and installs nothing. Pin it by hand once.',
            });
            continue;
          }
          if (actual === String(declared)) continue;

          const handReason = HAND_ONLY.get(rule.label);
          if (handReason !== undefined) {
            refusals.push({ kind: 'handOnly', text: `${where} is "${actual}", declared "${declared}" — MOVES BY HAND. ${handReason}` });
            continue;
          }
          const [cs, ce] = span;
          if (!roundTrips(rule, m[0], cs - m.index, ce - m.index, String(declared))) {
            refusals.push({
              kind: 'cannotExpress',
              text:
                `${where} is "${actual}" and CANNOT EXPRESS "${declared}" — the site would not read back the ` +
                'value written into it.',
            });
            continue;
          }
          if (!edits.has(rel)) edits.set(rel, new Map());
          const perLine = edits.get(rel);
          if (!perLine.has(i)) perLine.set(i, []);
          perLine.get(i).push({ start: cs, end: ce, declared: String(declared) });
          moved.push(`${rel}:${i + 1}  ${rule.label}  ${actual} -> ${declared}`);
        }
      }
    });
  }

  // ── a propagator that matched nothing is not "in sync" ─────────────────────
  // The same property assert-version-consistency.mjs asserts with
  // MIN_OCCURRENCES, and for the same reason: silence and agreement look
  // identical from the outside, and only one of them is a result.
  if (sites === 0) {
    console.error(`✗ REFUSED — matched 0 version reference(s) across ${TARGETS.length} file(s).`);
    console.error('  Nothing was written. The scan is broken, not the tree.');
    process.exit(2);
  }

  if (refusals.length) {
    console.error(`✗ REFUSED — ${refusals.length} call site(s) cannot be propagated to, so NOTHING was written:`);
    for (const r of refusals) console.error(`    ${r.text}`);
    // The floor paragraph is printed ONLY when a site actually could not hold the
    // value. Printing it under an undeclared-key refusal would name the wrong
    // cause, and a message that explains the wrong thing is read once and then
    // stopped being read.
    if (refusals.some((r) => r.kind === 'cannotExpress')) {
    console.error('');
    console.error('  This is a HAND DECISION and refusing is the design, not a gap. renovate.json disables');
    console.error('  minor/patch/pin/digest for the `java-version` and `node-version` datasources for exactly');
    console.error('  this reason: both floors are declared as a bare major on purpose, the installer resolves');
    console.error('  the patch at run time, and five of java’s eight sites are enum constants, an apt package');
    console.error('  name and a JVM directory that have no patch spelling at all. A major (17 -> 21) IS');
    console.error('  expressible and this script will write it; a patch is not, and PR #316 is what a proposal');
    console.error('  that five sites cannot accept looks like — red forever, closable only by hand.');
    }
    if (moved.length) {
      console.error('');
      console.error(`  ${moved.length} other site(s) COULD have moved and deliberately did not — a tree where`);
      console.error('  some sites moved and some did not is drift with a commit behind it:');
      for (const m of moved) console.error(`    ${m}`);
    }
    process.exit(2);
  }

  if (moved.length === 0) {
    console.log(
      `ok  versions propagated — ${sites} reference(s) across ${TARGETS.length} file(s) already match ` +
        'tooling/versions.json, nothing to write',
    );
    return;
  }

  for (const m of moved) console.log(m);

  if (!write) {
    console.log('');
    console.log(`DRY RUN — ${moved.length} site(s) would move. Re-run with --write to apply.`);
    return;
  }

  for (const [rel, perLine] of edits) {
    const abs = join(repoRoot, rel);
    const lines = readFileSync(abs, 'utf8').split('\n');
    for (const [i, spans] of perLine) {
      let line = lines[i];
      for (const s of [...spans].sort((a, b) => b.start - a.start)) {
        line = line.slice(0, s.start) + s.declared + line.slice(s.end);
      }
      lines[i] = line;
    }
    writeFileSync(abs, lines.join('\n'));
  }
  console.log('');
  console.log(`wrote ${moved.length} site(s) across ${edits.size} file(s) from tooling/versions.json`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
