#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-store-bundle-copy.mjs — invariant G6. WHILE THE BUNDLE CANNOT BE
// BOUGHT, NOTHING IN A STORE TREE MAY MENTION IT.
//
// 🔴 THE RISK, NAMED PRECISELY. Advertising a subscription that cannot be
// delivered is a store REJECTION cause, not a cosmetic slip — and a listing
// string outlives the review that let it through: it sits in a console, in a
// screenshot and in a cached storefront long after the repo has moved on. The
// cheapest way never to take that risk is for the string not to exist in any
// store tree while `purchasable` is false.
//
// ── IT IS CONDITIONAL, AND THE CONDITION IS DERIVED ─────────────────────────
// This guard does not carry an opinion about whether the bundle is sellable. It
// asks tooling/bundle-availability.mjs — the SAME derivation the site and the
// Worker read — and enforces the ban only while that derivation says
// `purchasable === false`. So the day a second product goes live and the gate
// opens, this guard stops banning the copy WITH NO EDIT HERE. A guard that had
// to be deleted on launch day is a guard that teaches people to delete guards.
//
// ⚠️ AND IT REFUSES TO DECIDE FROM A BROKEN READING. If the derivation cannot
// read its registers, that is COVERAGE LOST — not "assume purchasable" and not
// "assume banned". An unreadable register makes `purchasable` false, which looks
// exactly like the conservative answer and is in fact this guard grading a state
// nobody is in.
//
// ── WHAT COUNTS AS A STORE TREE ─────────────────────────────────────────────
// Derived, not listed: every `store/` directory under `apps/` and `extensions/`,
// plus the served paywall copy in the app config. A hard-coded list of five
// channels is a list that misses the sixth.
//
// Usage:  node tooling/ci/assert-no-store-bundle-copy.mjs [repoRoot]
// Exit 0 = no store surface promises what cannot be delivered, 1 = one does.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const DERIVATION = 'tooling/bundle-availability.mjs';
/** The roots whose `store/` subtrees are listing metadata. */
const PRODUCT_ROOTS = ['apps', 'extensions'];
/** Served paywall copy — not a store tree, but it reaches a store build's screen. */
const SERVED_COPY = 'services/platform/src/app-config-data.json';

/**
 * The phrases that would constitute a promise. Deliberately NARROW: the bare word
 * "bundle" appears in build tooling, in dependency names and in honest English
 * ("bundle size"), and a guard that fired on it would be turned off within a week.
 * What is banned is the OFFER — the product name and the subscription claim.
 */
const BANNED = [
  { re: /\bnikatru\s+bundle\b/i, why: 'the bundle by name' },
  { re: /\ball[- ]access\s+(?:pass|plan|subscription|bundle)\b/i, why: 'the bundle by its marketing shape' },
  { re: /\bevery\s+nikatru\s+(?:app|product|tool)\b/i, why: 'the "everything we make" claim, which is the promise itself' },
  { re: /\bone\s+subscription\s+for\s+(?:all|every)\b/i, why: 'the bundle proposition in words' },
  { re: /\bnikatru_all\b/, why: 'the feature-set identifier — a machine name that reached a human-facing tree' },
];

/** Extensions worth reading. A PNG cannot be grepped and is not claimed to be. */
const TEXTUAL = ['.json', '.txt', '.md', '.html', '.xml', '.yml', '.yaml'];

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
const ok = (m) => notes.push(m);

function done() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-no-store-bundle-copy: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error('');
    console.error('  A store listing that advertises a subscription the buyer cannot buy is a rejection cause,');
    console.error('  and the string outlives the review that let it through.');
    // ⏱ 2026-09-16 — O-EXIT2-CONVENTION-GAP. Exit 2 when EVERY problem is a COVERAGE LOST: the run did
    // not check enough to be evidence. Exit 1 when any is a finding — a proven defect outranks a blind
    // limb. This exited 1 for both until today. assert-guard-coverage.mjs reads this exact idiom.
    process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
  }
  console.log('✓ assert-no-store-bundle-copy: no store surface promises a bundle that cannot be bought.');
  process.exit(0);
}

// ── THE CONDITION, DERIVED ───────────────────────────────────────────────────
let availability = null;
if (!existsSync(join(ROOT, DERIVATION))) {
  coverageLost(
    `${DERIVATION} does not exist, so whether the bundle is purchasable could not be derived. This guard ` +
      'enforces a ban that is CONDITIONAL on that answer; without it, it would be banning copy on a guess.',
  );
  done();
}
try {
  const mod = await import(pathToFileURL(join(ROOT, DERIVATION)).href);
  availability = mod.bundleAvailability(ROOT);
} catch (e) {
  coverageLost(`${DERIVATION} could not be imported (${e.message}), so the ban's condition is unknown.`);
  done();
}
if (availability.problems.length > 0) {
  coverageLost(
    `the availability derivation could not read its own registers (${availability.problems.join(' · ')}). ` +
      'An unreadable register makes `purchasable` false, which LOOKS like the conservative answer and is in ' +
      'fact this guard grading a state nobody is in.',
  );
  done();
}

if (availability.purchasable === true) {
  // 🔴 THE GUARD STANDS DOWN BY DERIVATION, NOT BY DELETION. The day the gate
  // opens, store copy about the bundle becomes legitimate — and this file needs
  // no edit for that to happen. It still PRINTS, so "the ban is off" is a visible
  // event in the build log rather than a silence.
  console.log(
    `  ok  the bundle IS purchasable (${availability.why.liveProductCount} live product(s), members all live, ` +
      'priced), so store copy about it is legitimate and this ban stands down. Nothing was scanned, and that ' +
      'is stated rather than implied.',
  );
  console.log('✓ assert-no-store-bundle-copy: the ban does not apply — the bundle can be bought.');
  process.exit(0);
}

// ── THE SUBJECT ──────────────────────────────────────────────────────────────
/** Every `store/` directory under the product roots. Derived, never listed. */
function storeTrees() {
  const out = [];
  for (const root of PRODUCT_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const entry of listDir(abs)) {
      const s = join(abs, entry, 'store');
      if (existsSync(s) && statSync(s).isDirectory()) out.push(s);
    }
  }
  return out;
}

const trees = storeTrees();
if (trees.length === 0) {
  coverageLost(
    `no \`store/\` directory was found under ${PRODUCT_ROOTS.join('/ or ')}/, so the ban was enforced over ZERO ` +
      'listing trees. Nothing mentioning the bundle would have been found because nothing was read.',
  );
  done();
}

let filesRead = 0;
function scan(dir, label) {
  for (const de of listDir(dir, { withFileTypes: true })) {
    const p = join(dir, de.name);
    // The listing's own dirent, not a second look at the path (CodeQL #299).
    if (de.isDirectory()) {
      scan(p, label);
      continue;
    }
    if (!TEXTUAL.some((e) => p.toLowerCase().endsWith(e))) continue;
    filesRead += 1;
    const rel = p.replace(ROOT, '').replace(/^[\\/]/, '').replaceAll('\\', '/');
    const text = readFileSync(p, 'utf8');
    for (const { re, why } of BANNED) {
      const m = re.exec(text);
      if (m !== null) {
        fail(
          `${rel} contains ${JSON.stringify(m[0])} — ${why}. The bundle is NOT purchasable today ` +
            `(${availability.why.liveProductCount} live product(s), the floor is ${availability.why.minLiveProducts}), ` +
            'so this is a promise of a subscription the buyer cannot buy.',
        );
      }
    }
  }
}

for (const t of trees) scan(t, 'store listing');

// The served paywall copy reaches a store build's SCREEN, which is the same
// exposure as the listing and a different file, so it is scanned too.
const served = join(ROOT, SERVED_COPY);
if (existsSync(served)) {
  filesRead += 1;
  const text = readFileSync(served, 'utf8');
  for (const { re, why } of BANNED) {
    const m = re.exec(text);
    if (m !== null) {
      fail(
        `${SERVED_COPY} contains ${JSON.stringify(m[0])} — ${why}. This file is SERVED to every build, store ` +
          'builds included, so a bundle string here reaches a store screen without any listing change at all.',
      );
    }
  }
} else {
  ok(`${SERVED_COPY} is absent, so the served-copy limb had nothing to read — recorded rather than assumed clean`);
}

if (filesRead === 0) {
  coverageLost(
    `${trees.length} store tree(s) were found but ZERO readable files were scanned inside them. The ban was ` +
      'enforced over nothing.',
  );
} else {
  ok(
    `${filesRead} textual file(s) across ${trees.length} store tree(s) plus the served config carry none of the ` +
      `${BANNED.length} banned phrase(s), while the bundle is not purchasable`,
  );
}

done();
