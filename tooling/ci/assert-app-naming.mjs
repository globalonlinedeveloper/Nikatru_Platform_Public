#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-app-naming.mjs — an app's two names are checkable BEFORE a store reads
// them, and the check is offline.
//
// THE DECISION THIS SERVES IS [ADR 074] AND IS NOT RE-ARGUED HERE. The name a
// store shows and the name an operating system shows are two fields with two
// readers and two limits; the declaration carries both (`name`, `shortName`) and
// `tooling/app-yaml/render.mjs` plus `tooling/store/render-linux-icons.mjs`
// render them. This file is what stops the pair from being wrong.
//
// ── WHY A GUARD AND NOT A CHECKLIST ─────────────────────────────────────────
// Every rule below is one a store applies AFTER a submission, at a cost measured
// in weeks. Apple's App Name Dispute form does not require a trademark
// registration, so a same-name incumbent can have a listing pulled for free;
// Play and Apple both refuse ranking and price claims in metadata ("#1", "Free",
// "Best") and both refuse emoji in a name; and Apple QA1892 asks that the name
// on the device and the name in the store be SIMILAR, which a launcher label
// naming a different product is not. Each of those is a rejection that arrives
// once the submission is already made, which is the most expensive possible
// place to learn it. All five are decidable from two strings.
//
// ── THE LIMBS ────────────────────────────────────────────────────────────────
//   1 · `name` is ≤ 30 characters. Play's title cap and the tightest of the five
//       channels. tooling/app-yaml/schema/app.schema.json ALSO caps it, and that
//       is not a duplicate: the schema is what a declaration is validated
//       against and this is what survives the schema being loosened. The cap is
//       written once, HERE, and read from the schema — so the two cannot drift.
//   2 · `name` is not GENERIC. A name every one of whose words is a category
//       word ("Subscription Tracker") is a name a store can refuse and that no
//       trademark can ever protect. The test is deliberately weak — it refuses
//       only a name with NO distinctive word at all — because a strong one would
//       be an opinion about branding rather than a rule about rejections.
//   3 · `shortName` is PRESENT, ≤ 15 characters, and shares a word with `name`.
//       Present, because an app without one ships its store title under its icon
//       and every OS truncates it: iOS at about 12-13 glyphs, Android at about
//       11-14. Sharing a word, because of QA1892 — a common STEM of four
//       characters or more counts, so a plural is similar and "Subs" does not
//       reach "Submarine".
//   4 · `shortName` is UNIQUE across apps/*. The whole reason a portfolio brand
//       needs a second name is that "Nikatru Subs…" under four icons is four
//       apps a user cannot tell apart. A portfolio-wide field checked per app
//       would pass every app individually and fail the only thing it is for.
//   5 · NO BANNED TOKEN in either name — `#1`, `Free`, `Best`, or any emoji.
//   6 · A NAME CLEARANCE EXISTS and is not BLOCKED. Conditional, and the
//       condition is PRINTED rather than skipped: the mechanism
//       (tooling/store/name-clearance.mjs, apps/<app>/name-clearance.json) is in
//       flight on PR #554 at the time of writing, so this limb names what it is
//       waiting for on every run and arms itself the day the file exists. The
//       DEEP reading of a clearance record — staleness, per-channel controls,
//       the name triple — belongs to assert-name-clearance.mjs and is not
//       re-implemented here; this limb asks only the question that belongs with
//       the other five: does this name have a record, and does that record say
//       somebody else holds it.
//
// ⚠️ THE ONE FLOOR IS A COVERAGE FLOOR, NOT A QUALITY ONE. Zero graded apps is
// COVERAGE LOST (exit 2), because every limb above quantifies over a set and a
// run over an empty set satisfies all five while checking nothing. That is this
// repository's single most repeated failure and it is what killed a guard that
// reported "no per-app D1 name appears" whether it had read 200 files or 0.
//
// OFFLINE AND FAST BY CONSTRUCTION: it opens `apps/*/app.yaml`, the app schema
// and, if present, `apps/*/name-clearance.json`. No network, no git, no spawn —
// which is what lets it run in the pre-commit hook as well as in CI.
//
// Usage:  node tooling/ci/assert-app-naming.mjs [repoRoot]
// Exit 0 = both names are shippable. 1 = a finding. 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(HERE, '..', '..'));

const APPS_DIR = 'apps';
const SCHEMA_REL = 'tooling/app-yaml/schema/app.schema.json';
const CLEARANCE_ENGINE = 'tooling/store/name-clearance.mjs';

/** The icon-label cap. Not a store's number and not pretending to be one: it is
 *  the width a home screen gives a label. iOS truncates around 12-13 glyphs and
 *  Android around 11-14, so 15 is already generous — the point of the cap is to
 *  refuse a label that cannot do its job, not to model a console field. */
const SHORT_NAME_MAX = 15;

/** ⚠️ THE 30 IS NOT WRITTEN TWICE. It is READ from the app schema's own
 *  `name.maxLength`, so loosening the schema cannot silently loosen this guard
 *  and tightening it here cannot contradict the declaration everything else is
 *  validated against. If the schema stops capping it at all, that is COVERAGE
 *  LOST rather than "no cap to check". */
function nameCapFrom(schema) {
  const cap = schema?.properties?.name?.maxLength;
  return typeof cap === 'number' && cap > 0 ? cap : null;
}

/** Category words. A name made ENTIRELY of these is generic.
 *
 *  🔴 THIS LIST IS A FLOOR, AND SAYING SO IS THE POINT. It is not a store's
 *  vocabulary and there is no published one to copy; a longer list would start
 *  refusing legitimate names on my opinion of them. What it catches is the
 *  failure that actually happened in the research this ADR records: a candidate
 *  name that was a plain description of the category, which any competitor may
 *  use, which no registration can protect, and which Apple's own naming guidance
 *  calls out. Add a word here only when a real name was refused for it. */
const GENERIC_WORDS = new Set([
  'app', 'apps', 'application', 'bill', 'bills', 'budget', 'calendar', 'cost', 'costs',
  'expense', 'expenses', 'finance', 'list', 'log', 'manager', 'money', 'monitor', 'notes',
  'organiser', 'organizer', 'payment', 'payments', 'planner', 'pro', 'recurring', 'reminder',
  'reminders', 'renewal', 'renewals', 'spend', 'spending', 'subscription', 'subscriptions',
  'the', 'tracker', 'tracking', 'utility', 'wallet',
]);

/** Ranking and price claims both consoles refuse in a title, plus emoji. Matched
 *  on WORD boundaries, never as substrings: "Freedom" is not "Free" and refusing
 *  it would be a guard people route around rather than obey. */
const BANNED_WORDS = new Set(['#1', 'no1', 'best', 'top', 'free', 'sale', 'new']);
const EMOJI = /\p{Extended_Pictographic}/u;

/** The words of a name, lowercased. An intra-word hyphen or apostrophe is part
 *  of the word ("E-Book", "Traveler's"); everything else separates. The `#1`
 *  case is why `#` survives tokenisation. */
const tokens = (s) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9'\-#]+/)
    .map((t) => t.replace(/^['\-]+|['\-]+$/g, ''))
    .filter(Boolean);

/** Do two names share a word? A COMMON STEM OF AT LEAST FOUR CHARACTERS counts,
 *  which is what makes "Subscriptions" similar to "Subscription Tracker": an
 *  exact-equality rule would refuse a plural, and a rule that refuses the
 *  obviously-similar case is one people route around rather than obey. Four is
 *  the floor at which a shared prefix stops being an accident of the alphabet —
 *  "Sub" would marry "Subway" to "Submarine"; "Subs" does not reach "Submarine".
 *
 *  ⚠️ THE SAME RULE IS IMPLEMENTED IN `_sharesToken` in
 *  tooling/bricks/app/hooks/pre_gen.dart, and it is a second implementation
 *  rather than a second copy: that one is Dart, runs at stamp time and refuses
 *  the spec before anything is written, while this one is the gate. They are
 *  held together by tooling/ci/test/app-naming.test.mjs, which asserts the pair
 *  agrees on the cases where a hand-written rule would diverge. */
export function sharesToken(a, b) {
  for (const x of tokens(a)) {
    for (const y of tokens(b)) {
      const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
      if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
    }
  }
  return false;
}

export function isGeneric(name) {
  const t = tokens(name);
  return t.length > 0 && t.every((w) => GENERIC_WORDS.has(w));
}

export function bannedIn(name) {
  const hits = tokens(name).filter((w) => BANNED_WORDS.has(w));
  if (EMOJI.test(name)) hits.push('an emoji');
  return hits;
}

/* ------------------------------------------------------------------ */

/**
 * Grade every declaration. Returns `{ problems, lost, notes, graded }` — nothing
 * is printed here, so the test suite can assert on the findings rather than on
 * the shape of a console line.
 */
export function gradeNames(root) {
  const problems = [];
  const lost = [];
  const notes = [];
  const graded = [];

  const appsAbs = join(root, APPS_DIR);
  if (!existsSync(appsAbs) || !statSync(appsAbs).isDirectory()) {
    lost.push(`${APPS_DIR}/ does not exist, so this run had no name to grade.`);
    return { problems, lost, notes, graded };
  }

  const schemaAbs = join(root, ...SCHEMA_REL.split('/'));
  if (!existsSync(schemaAbs)) {
    lost.push(`${SCHEMA_REL} is missing, so the \`name\` cap this guard enforces cannot be read and would have to be typed here — a second copy of the one number.`);
    return { problems, lost, notes, graded };
  }
  let nameCap;
  try {
    nameCap = nameCapFrom(JSON.parse(readFileSync(schemaAbs, 'utf8')));
  } catch (e) {
    lost.push(`${SCHEMA_REL} is not valid JSON (${e.message}); the \`name\` cap cannot be read.`);
    return { problems, lost, notes, graded };
  }
  if (nameCap === null) {
    lost.push(`${SCHEMA_REL} no longer caps \`name\` with a positive \`maxLength\`. That is not "no cap to check" — it is this guard's only source for the number, and inventing one here is how two numbers disagree.`);
    return { problems, lost, notes, graded };
  }

  const ids = listDir(appsAbs)
    .filter((id) => existsSync(join(appsAbs, id, 'app.yaml')))
    .sort();
  if (ids.length === 0) {
    lost.push(`no ${APPS_DIR}/<id>/app.yaml exists. Every limb below quantifies over the declarations, and all five pass over an empty set.`);
    return { problems, lost, notes, graded };
  }

  const clearanceEngine = existsSync(join(root, ...CLEARANCE_ENGINE.split('/')));

  for (const id of ids) {
    const rel = `${APPS_DIR}/${id}/app.yaml`;
    let doc;
    try {
      doc = parseYaml(readFileSync(join(appsAbs, id, 'app.yaml'), 'utf8'));
    } catch (e) {
      problems.push(`${rel}: does not parse (${e.message}), so neither name could be read.`);
      continue;
    }
    const name = typeof doc?.name === 'string' ? doc.name : null;
    const shortName = typeof doc?.shortName === 'string' ? doc.shortName : null;
    if (name === null || name.trim() === '') {
      problems.push(`${rel}: declares no \`name\`. It is the store title on all five channels.`);
      continue;
    }
    graded.push({ id, rel, name, shortName });

    // ── 1 · the store cap ────────────────────────────────────────────────
    if ([...name].length > nameCap) {
      problems.push(
        `${rel}: \`name\` is ${[...name].length} characters ("${name}") and the cap is ${nameCap}, read from ` +
          `${SCHEMA_REL}. Google Play is the tightest of the five channels and it truncates rather than refuses, ` +
          'so the first anyone would know is a listing with the end of its own name missing.',
      );
    }

    // ── 2 · not a category description ───────────────────────────────────
    if (isGeneric(name)) {
      problems.push(
        `${rel}: \`name\` ("${name}") is made entirely of category words. A name every competitor may truthfully ` +
          'use is one no registration can protect and one a store can refuse; add a word that is yours. ' +
          '"Nikatru" is a coined word and adds no collision surface, which is why it is the portfolio prefix.',
      );
    }

    // ── 3 · the icon label ───────────────────────────────────────────────
    if (shortName === null || shortName.trim() === '') {
      problems.push(
        `${rel}: declares no \`shortName\`. Without one this app ships "${name}" under its own icon, where iOS ` +
          'truncates at about 12-13 glyphs and Android at about 11-14 — a label nobody reads in full. It is one ' +
          'line in the declaration and tooling/app-yaml/render.mjs renders it into the five OS-level fields it ' +
          'owns, with tooling/store/render-linux-icons.mjs taking the .desktop `Name=`.',
      );
    } else {
      if ([...shortName].length > SHORT_NAME_MAX) {
        problems.push(
          `${rel}: \`shortName\` is ${[...shortName].length} characters ("${shortName}") and the cap is ` +
            `${SHORT_NAME_MAX}. That cap is a home screen's, not a store's — the STORE title is \`name\` and has its own.`,
        );
      }
      if (!sharesToken(shortName, name)) {
        problems.push(
          `${rel}: \`shortName\` ("${shortName}") shares no word with \`name\` ("${name}"). Apple QA1892 asks that ` +
            'the name shown on the device and the name shown in the App Store be similar; a device label naming a ' +
            'different product is a review risk rather than a style choice. A common stem of four characters or ' +
            'more counts, so a plural is fine — pick a word the listing already uses.',
        );
      }
      for (const hit of bannedIn(shortName)) {
        problems.push(`${rel}: \`shortName\` ("${shortName}") contains ${hit === 'an emoji' ? hit : `"${hit}"`}, which both consoles refuse in a name.`);
      }
    }

    // ── 5 · ranking and price claims ─────────────────────────────────────
    for (const hit of bannedIn(name)) {
      problems.push(
        `${rel}: \`name\` ("${name}") contains ${hit === 'an emoji' ? hit : `"${hit}"`}. Apple and Google both refuse ` +
          'a ranking claim, a price claim or an emoji in a store title, and the refusal arrives after the ' +
          'submission rather than before it.',
      );
    }

    // ── 6 · the clearance record ─────────────────────────────────────────
    const clearanceRel = `${APPS_DIR}/${id}/name-clearance.json`;
    const clearanceAbs = join(root, ...clearanceRel.split('/'));
    if (!clearanceEngine) {
      notes.push(
        `⬜ ${id} — the clearance limb is NOT ARMED: ${CLEARANCE_ENGINE} does not exist in this tree, so there is ` +
          'no mechanism to have produced a record. It arms itself the day that file lands (PR #554) with no edit ' +
          'here. Printed rather than skipped, because a limb nobody can see is a limb nobody restores.',
      );
    } else if (!existsSync(clearanceAbs)) {
      problems.push(
        `${clearanceRel} does not exist. ${CLEARANCE_ENGINE} is in this tree, so a name can be proved free before ` +
          'it is reserved — and a name nobody proved is the one that gets pulled by an incumbent two weeks after ' +
          'launch, for free, through a form that needs no trademark registration.',
      );
    } else {
      let record;
      try {
        record = JSON.parse(readFileSync(clearanceAbs, 'utf8'));
      } catch (e) {
        problems.push(`${clearanceRel} is not valid JSON (${e.message}), so no verdict could be read from it.`);
        record = null;
      }
      if (record) {
        const cleared = record?.name?.value;
        if (cleared !== name) {
          problems.push(
            `${clearanceRel} clears "${cleared}" and ${rel} declares "${name}". A clearance for a different ` +
              'string is not a clearance for this one.',
          );
        }
        if (record.overall === 'BLOCKED') {
          problems.push(
            `${clearanceRel} says overall BLOCKED — a record was READ holding "${name}" on a channel that refuses ` +
              'duplicates. Change the name; a submission under it is a listing somebody else can have pulled.',
          );
        }
        notes.push(`${id} — clearance ${record.overall ?? 'with no verdict'}, asOf ${record.asOf ?? 'unrecorded'}. The staleness, control and per-channel reading is assert-name-clearance.mjs's.`);
      }
    }
  }

  // ── 4 · uniqueness, which is the limb per-app checking cannot have ─────
  const byShort = new Map();
  for (const g of graded) {
    if (!g.shortName) continue;
    const key = g.shortName.trim().toLowerCase();
    if (!byShort.has(key)) byShort.set(key, []);
    byShort.get(key).push(g);
  }
  for (const [key, group] of byShort) {
    if (group.length < 2) continue;
    problems.push(
      `${group.length} apps declare the same \`shortName\` ("${group[0].shortName}"): ${group.map((g) => g.rel).join(', ')}. ` +
        'Two icons on one home screen with one label under them is precisely the failure a second name exists to ' +
        `prevent — the store titles may differ and the launcher shows neither. (compared lowercased: "${key}")`,
    );
  }

  if (graded.length === 0) {
    lost.push('every declaration was skipped before it could be graded, so no name was checked.');
  }
  return { problems, lost, notes, graded };
}

/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { problems, lost, notes, graded } = gradeNames(ROOT);

  if (lost.length) {
    console.error(`✗ COVERAGE LOST — assert-app-naming graded nothing it could stand behind:`);
    for (const l of lost) console.error(`    ${l}`);
    console.error('    A run over an empty set satisfies every limb without checking one name.');
    coverageLost();
  }

  for (const n of notes) console.log(`note ${n}`);

  if (problems.length) {
    console.error(`✗ ${problems.length} naming problem(s) across ${graded.length} app(s):`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }

  const shorts = graded.map((g) => `${g.name} / ${g.shortName}`).join(' · ');
  console.log(
    `assert-app-naming: ok — ${graded.length} app(s) graded on five limbs (store cap, not generic, icon label ` +
      `present + capped + sharing a word, unique across apps/*, no banned token): ${shorts}`,
  );
}

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-app-naming.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}
