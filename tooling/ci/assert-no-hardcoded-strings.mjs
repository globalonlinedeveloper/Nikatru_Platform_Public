#!/usr/bin/env node
// [pipeline C-12, second clause] ZERO HARDCODED USER-FACING STRINGS (DoD §4-E).
//
// A string baked into a widget cannot be translated, and retrofitting l10n
// across 50 shipped apps is the expensive path — `architecture.md` §16 says so
// in as many words. The brick is where this is nearly free, and it is the one
// place a fix reaches every app the factory will ever stamp.
//
// ── WHY THIS IS A CI GUARD AND NOT A LINT (owner decision 2026-07-28) ────────
// The obvious home is a custom analyzer rule. It was rejected on two checked
// facts, not on preference:
//
//   1. custom_lint DOES NOT RUN under `dart analyze` / `flutter analyze`. Its
//      own docs: "running `dart analyze` does not pick up our newly defined
//      lints. We need a separate command for this." So it needs its own CI step
//      exactly like this guard does — there is no simplicity to be won.
//   2. It is a NEW PACKAGE, and under [pipeline C-4] a package must be earned by
//      a native payload, a licence exposure, or a codegen step. A lint plugin is
//      none of those, so it would arrive GRANDFATHERED — the C-4 rule
//      grandfathering its very next package.
//
// The one genuine loss is inline IDE feedback while typing, which a CI guard
// cannot give. For a single founder with CI as the gate, that did not justify a
// package plus a second lint toolchain.
//
// ── SCOPE, AND WHY IT IS NARROW ON PURPOSE ──────────────────────────────────
// Scanning every string literal produces mostly noise: keys, asset paths, MIME
// types, locale codes. This scans the places a string is actually SHOWN TO A
// PERSON — `Text('…')` and the labelling parameters — which is a domain small
// enough to be exact and large enough to matter.
//
// `apps/subly` is EXCLUDED and dated. It holds ~49 such literals across 46
// files, and `39-CHASSIS` cut 1 froze it as a legacy rail-prover, so including
// it would ship this guard red on day one — and a guard that is red on day one
// gets switched off, which is the failure this repository keeps recording.
// Retrofitting Subly is `architecture.md` §16's own work item.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';

// Dated exclusions. Each names WHY, so it stays reviewable rather than becoming
// permanent by accident.
const EXCLUDED_ROOTS = {
  'apps/subly': '2026-07-28 · frozen as a legacy rail-prover by 39-CHASSIS cut 1; ~49 literals across 46 files. Retrofit is architecture.md §16\'s work item, and including it here would ship this guard red on day one.',
};

// Where a string reaches a person. Captures the literal so it can be reported.
const SHOWN_TO_A_PERSON = [
  { re: /\bText\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g, what: 'Text(…)' },
  { re: /\b(?:label|title|subtitle|tooltip|hintText|labelText|helperText|semanticsLabel|semanticLabel|applicationLegalese)\s*:\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g, what: 'a labelling parameter' },
];

// Not user-facing, even inside those positions. Each entry is a real category
// seen in this tree, not a hypothetical.
const NOT_USER_FACING = [
  { re: /^\s*$/, why: 'empty or whitespace' },
  // 🔴 TIGHTENED 2026-08-01 (full-corpus triage). This read `^[a-z][a-z0-9_]*$`
  // — ANY bare lowercase word — so `Text('settings')`, `Text('loading')`,
  // `Text('delete')` and `Text('subscriptions')` were every one of them filed as
  // "a key" and the guard printed "the brick is clean". Mutation-proven against
  // the real brick: those four literals added, exit 0. They are not keys; they
  // are the commonest labels an app ships, in the one tree that multiplies by 50.
  //
  // The distinguishing fact is a SEPARATOR: an identifier has one, a word does
  // not. So the exemption now requires at least one `_`. `analytics_opt_in`
  // stays silent; `settings` no longer does. An exemption broad enough that you
  // cannot write the input it should have caught is a hole, not a filter.
  { re: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/, why: 'a snake_case key — it carries a separator, so it is an identifier and not prose' },
  { re: /^[A-Z][A-Z0-9_]+$/, why: 'a CONSTANT_KEY' },
  { re: /^#?[0-9a-fA-F]{3,8}$/, why: 'a hex colour' },
  { re: /^(?:https?:|mailto:|tel:|package:|asset|assets\/)/i, why: 'a URL or asset path' },
  { re: /^\{\{.*\}\}$/, why: 'a mustache token — substituted at stamp time' },
  { re: /^[^a-zA-Z]*$/, why: 'no letters at all (punctuation, digits, symbols)' },
];

function scan(dir) {
  const hits = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.dart')) continue;
      // Generated localisations are the OUTPUT of l10n, not a violation of it.
      if (/app_localizations/.test(entry)) continue;
      const rel = relative(ROOT, full).replace(/\\/g, '/');
      // Strip comments first — a literal quoted in prose is not shown to anyone,
      // and this repo has already shipped one guard that matched its own
      // explanatory comment.
      const src = readFileSync(full, 'utf8')
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      for (const { re, what } of SHOWN_TO_A_PERSON) {
        re.lastIndex = 0;
        for (const m of src.matchAll(re)) {
          const literal = m[2];
          if (NOT_USER_FACING.some((x) => x.re.test(literal))) continue;
          hits.push({ file: rel, literal, what });
        }
      }
    }
  };
  walk(join(ROOT, dir));
  return hits;
}

// ── The brick: must be clean. ───────────────────────────────────────────────
if (!existsSync(join(ROOT, BRICK))) {
  problems.push(`COVERAGE LOST — ${BRICK} does not exist, so this guard scanned the one tree it exists to protect and found nothing to protect.`);
} else {
  const hits = scan(BRICK);
  for (const h of hits) {
    problems.push(
      `${h.file} shows a hardcoded string in ${h.what}: "${h.literal}". Move it to lib/l10n/app_en.arb and read it through AppLocalizations. Every app the factory stamps inherits this file, and retrofitting l10n across 50 shipped apps is the expensive path (architecture.md §16).`,
    );
  }
  if (hits.length === 0) ok('the brick template shows no hardcoded user-facing strings');
}

// ── COVERAGE SELF-CHECK, and this one is not optional. ──────────────────────
// The brick is clean, so every assertion above passes over an empty result set
// — which is indistinguishable from a scanner that has stopped matching. This
// stage has already shipped three checks that ranged over nothing. So the
// matchers are proven against a tree KNOWN to contain violations: apps/subly,
// which is excluded from enforcement precisely because it is full of them.
const canary = existsSync(join(ROOT, 'apps/subly/lib')) ? scan('apps/subly/lib') : [];
const MIN_CANARY = 20;
if (canary.length < MIN_CANARY) {
  problems.push(
    `COVERAGE LOST — the matchers found only ${canary.length} hardcoded string(s) in apps/subly, expected >= ${MIN_CANARY}. That tree is known to be full of them, so a low count means these patterns have stopped matching and the brick's clean result above proves nothing.`,
  );
} else {
  ok(`matchers verified against a known-dirty tree: ${canary.length} literal(s) found in apps/subly (excluded from enforcement, see below)`);
}

// 🔴 AND A RELATIONSHIP, NOT ONLY A COUNT (2026-08-01 corpus triage).
// MIN_CANARY is deliberately left FAR below the measured total — apps/subly
// yields ~59 — and it must stay that way: re-pinning a floor at whatever the
// tree happens to measure today is the stale-floor defect PR #85 removed from
// assert-guard-coverage. But a total floor is also blind in the other
// direction: ~47 of those hits come from the `Text(…)` matcher, so DELETING THE
// LABELLING MATCHER OUTRIGHT still clears any total floor by a wide margin and
// prints "matchers verified".
//
// So the real coverage claim is derived from the matcher list itself: every
// family must show its own evidence that it still matches. Add a matcher and it
// must earn evidence too — there is no number to tune and nothing to go stale.
for (const { what } of SHOWN_TO_A_PERSON) {
  if (canary.length >= MIN_CANARY && !canary.some((h) => h.what === what)) {
    problems.push(
      `COVERAGE LOST — the "${what}" matcher found NOTHING in apps/subly, a tree known to be dirty in exactly that way. One matcher family has stopped matching while the others carry the total over the floor, so the brick's clean result proves nothing about ${what}.`,
    );
  }
}

for (const [root, why] of Object.entries(EXCLUDED_ROOTS)) {
  console.log(`\n⬜ EXCLUDED · ${root}\n   ${why}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-no-hardcoded-strings: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-no-hardcoded-strings: ok — the brick is clean, and the matchers are proven to still match');
}
