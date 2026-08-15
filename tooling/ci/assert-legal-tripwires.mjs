#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-legal-tripwires.mjs — the duty matrix cannot silently rot.
//
// [pipeline K-13] "The per-market duty matrix cannot silently rot."
//
// A compliance corpus decays in three ways and all three are quiet:
//   · a duty stops having a row (the requirement did not go away; the row did);
//   · a row's source turns out to be a summary of a summary, and cannot be
//     re-checked by anyone later;
//   · a "we will look at this again in six months" passes and nobody looks.
// Every one of those still reads as a complete, authoritative document.
//
// 🔴 THE SOURCE-HOST ALLOWLIST IS THE HIGHEST-VALUE RULE HERE AND IT IS ABOUT
// FOUR LINES OF CODE. A row's source must be the body that WROTE the rule or the
// platform that ENFORCES it. A law firm's client alert, a compliance vendor's
// blog, a checklist site or a news report FAILS THE ROW. Not because they are
// always wrong — because a claim sourced to one cannot be re-verified, and
// roughly thirty dead claims entered this project's corpus from exactly that
// shape, each of them reading as authoritative. The allowlist lives in the
// REGISTER, not in this file: a host list inside the guard would be a second
// source of truth, and the register is where a reviewer looks.
//
// 🔴 AND THE RULE THAT MAKES `COULD-NOT-ESTABLISH` MEAN SOMETHING: a row marked
// that way MAY NOT CARRY A SOURCE URL. The mark exists to say "nobody has read
// the primary text"; a plausible URL beside it converts an honest gap into a
// false citation, which is strictly worse than the gap. This is the same rule
// assert-store-metadata.mjs enforces for numeric limits — an invented limit
// fires on CORRECT input while looking authoritative.
//
// ⚠️ OWNER-GATED ROWS PRINT, THEY DO NOT FAIL. A duty blocked on an account, a
// translation or a decision only the owner can take must not turn every CI run
// red: a guard that cries wolf on work nobody in the loop can do is one somebody
// switches off, and then the rows that CAN fail stop being read too.
//
// Usage:  node tooling/ci/assert-legal-tripwires.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const MATRIX = join(repoRoot, 'tooling', 'legal', 'duty-matrix.json');

/** "Today" is the run date. A review date is a promise to look again, and the
 *  only way a promise like that is kept is if something notices when it passes. */
const TODAY = new Date().toISOString().slice(0, 10);

const problems = [];
const prints = [];
const rel = (p) => relative(repoRoot, p).split(sep).join('/');

const coverageLost = (msg, ...detail) => {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const d of detail) console.error(`  ${d}`);
  process.exit(1);
};

if (!existsSync(MATRIX)) {
  coverageLost(
    `${rel(MATRIX)} does not exist.`,
    'The matrix IS the subject of every check below. Absent, this guard validates nothing and prints',
    'ok — see tooling/legal/README.md for why it lives in-tree and not under Private/company/, which is',
    'gitignored and therefore invisible to CI.',
  );
}
let matrix;
try {
  matrix = JSON.parse(readFileSync(MATRIX, 'utf8'));
} catch (err) {
  coverageLost(`${rel(MATRIX)} is not valid JSON (${err.message}).`);
}

const duties = Array.isArray(matrix.duties) ? matrix.duties : [];
const requirements = matrix.requirements && typeof matrix.requirements === 'object' ? matrix.requirements : {};
const declaredIds = Object.keys(requirements).filter((k) => !k.startsWith('_'));
const statuses = matrix.statuses && typeof matrix.statuses === 'object' ? matrix.statuses : {};
const verificationKinds =
  matrix.verificationKinds && typeof matrix.verificationKinds === 'object' ? matrix.verificationKinds : {};
const allowedHosts = new Set((matrix.sourceHosts?.allowed ?? []).map((h) => String(h).toLowerCase()));

if (duties.length === 0) {
  coverageLost(
    'the duty matrix declares no duties.',
    'Every limb below quantifies over that array. An empty matrix satisfies "every row has a source",',
    '"every row has a trigger" and "no review date has passed" — perfectly, and over nothing.',
  );
}
if (declaredIds.length === 0) {
  coverageLost(
    'the duty matrix declares no `requirements`.',
    'That map is the coverage set: it is what makes "a duty with no row fails" a RELATIONSHIP rather',
    'than a number somebody lowers. With it empty, no duty can ever be found missing.',
  );
}
if (allowedHosts.size === 0) {
  coverageLost(
    'the duty matrix declares no `sourceHosts.allowed`.',
    'The allowlist is the single highest-value rule in this file. Empty, every URL is rejected; absent,',
    'every URL is accepted. Neither is a pass.',
  );
}

// ── LIMB 1 · the coverage relation, both directions ─────────────────────────
const covered = new Set();
const seenRowIds = new Set();
for (const d of duties) {
  if (typeof d.id !== 'string' || d.id.trim() === '') {
    problems.push(`a duty row carries no \`id\`. Rows are referred to by id in failure messages and in review notes.`);
    continue;
  }
  if (seenRowIds.has(d.id)) {
    problems.push(`two duty rows share the id ${JSON.stringify(d.id)}. One duty, one id.`);
  }
  seenRowIds.add(d.id);
  if (!Object.prototype.hasOwnProperty.call(requirements, d.requirement)) {
    problems.push(
      `duty ${JSON.stringify(d.id)} names requirement ${JSON.stringify(d.requirement ?? null)}, which is not in the ` +
        `matrix's own \`requirements\` map (${declaredIds.join(', ')}). A row filed against a requirement nobody ` +
        'declared is a row nobody will find when that requirement is reviewed.',
    );
    continue;
  }
  covered.add(d.requirement);
}
for (const id of declaredIds) {
  if (!covered.has(id)) {
    problems.push(
      `requirement ${id} (${requirements[id]}) has NO row in tooling/legal/duty-matrix.json. The duty did not go ` +
        'away; the row did. This direction is what stops the matrix shrinking quietly — the requirement list can ' +
        'only be reduced by deleting an id, which is a visible act somebody reviews.',
    );
  }
}

// ── LIMB 2 · every source is a primary source ───────────────────────────────
let sourcedRows = 0;
for (const d of duties) {
  if (!d.source) continue;
  const url = d.source.url;
  if (typeof url !== 'string' || url.trim() === '') {
    problems.push(`duty ${JSON.stringify(d.id)} carries a \`source\` with no \`url\`.`);
    continue;
  }
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    problems.push(`duty ${JSON.stringify(d.id)} has a source url that is not a URL: ${JSON.stringify(url)}.`);
    continue;
  }
  if (!allowedHosts.has(host)) {
    problems.push(
      `duty ${JSON.stringify(d.id)} cites ${host}, which is not on the primary-source allowlist ` +
        `(${[...allowedHosts].sort().join(', ')}). A compliance claim has to come from the body that WROTE the rule ` +
        'or the platform that ENFORCES it. A law firm, a vendor blog or a summary site cannot be re-checked later, ' +
        'and roughly thirty dead claims entered this corpus from exactly that shape.',
    );
    continue;
  }
  if (typeof d.source.fetched !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.source.fetched)) {
    problems.push(
      `duty ${JSON.stringify(d.id)} cites ${host} with no \`fetched\` date (YYYY-MM-DD). A rule read at an unknown ` +
        'time cannot be known to be current, and store policies change without notice.',
    );
    continue;
  }
  sourcedRows++;
}
// ⚠️ THE COVERAGE CHECKS IN THIS FILE ARE GATED ON `problems.length === 0`, AND
// THAT IS NOT A LOOPHOLE. `coverageLost` exits immediately, so a coverage check
// that fires while a SPECIFIC fault is already recorded replaces "this row cites
// a law firm" with "no row carried a source at all" — the vague message wins and
// the fix goes to the wrong file. Reporting the wrong fault is the failure mode
// this repository keeps recording; each of these was caught by its own
// regression test doing exactly that. The coverage claim is only meaningful when
// every shape was fine and the domain was STILL empty.
if (sourcedRows === 0 && problems.length === 0) {
  coverageLost(
    'NOT ONE duty row carried a checkable source URL, so the allowlist ran over an empty set.',
    'The highest-value rule in this file would be reporting clean while checking nothing.',
  );
}

// ── LIMB 3 · a status from the vocabulary, and a stateable trigger ──────────
for (const d of duties) {
  if (!Object.prototype.hasOwnProperty.call(statuses, d.status)) {
    problems.push(
      `duty ${JSON.stringify(d.id)} has status ${JSON.stringify(d.status ?? null)}, which is not in the matrix's own ` +
        `\`statuses\` dictionary (${Object.keys(statuses).filter((k) => !k.startsWith('_')).join(', ')}).`,
    );
  }
  if (typeof d.trigger !== 'string' || d.trigger.trim() === '') {
    problems.push(
      `duty ${JSON.stringify(d.id)} carries no \`trigger\`. A tripwire with no stateable trigger condition is ` +
        'decoration: it records that somebody thought about the duty once, and nothing tells anyone when it starts ' +
        'to bite. "The day an ad SDK enters a pubspec" is a trigger; "ongoing" is not.',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(verificationKinds, d.verification)) {
    problems.push(
      `duty ${JSON.stringify(d.id)} has verification ${JSON.stringify(d.verification ?? null)}, which is not in the ` +
        "matrix's own `verificationKinds` dictionary. The kind is what decides whether a source URL is required, " +
        'forbidden, or irrelevant — an unknown one is silently treated as the weakest.',
    );
  }
}

// ── LIMB 4 · COULD-NOT-ESTABLISH may not carry a citation ───────────────────
let unestablished = 0;
for (const d of duties) {
  if (d.verification !== 'COULD-NOT-ESTABLISH') continue;
  unestablished++;
  if (d.source) {
    problems.push(
      `duty ${JSON.stringify(d.id)} is marked COULD-NOT-ESTABLISH and carries a source URL. The mark MEANS nobody ` +
        'has read the primary text; a URL beside it turns an honest gap into a false citation, which is strictly ' +
        'worse than the gap. Read the source and change the mark, or drop the URL.',
    );
  }
  if (typeof d.wouldNeed !== 'string' || d.wouldNeed.trim() === '') {
    problems.push(
      `duty ${JSON.stringify(d.id)} is marked COULD-NOT-ESTABLISH and does not say what would have to be read. ` +
        '"We could not find out" is only useful with "here is what to open".',
    );
  }
}

// ── LIMB 5 · an `implemented` row names an artefact that exists ─────────────
let artefacts = 0;
for (const d of duties) {
  if (d.status !== 'implemented' && !d.artefact) continue;
  if (d.status === 'implemented' && (typeof d.artefact !== 'string' || d.artefact.trim() === '')) {
    problems.push(
      `duty ${JSON.stringify(d.id)} claims status \`implemented\` and names no \`artefact\`. "Done" with nothing to ` +
        'point at is the claim this whole matrix exists to make impossible.',
    );
    continue;
  }
  if (typeof d.artefact !== 'string') continue;
  artefacts++;
  if (!existsSync(join(repoRoot, ...d.artefact.split('/')))) {
    problems.push(
      `duty ${JSON.stringify(d.id)} names artefact ${d.artefact} and that artefact does not exist. The row still ` +
        'reads as discharged; the thing discharging it is gone.',
    );
  }
}
if (artefacts === 0 && problems.length === 0) {
  coverageLost(
    'NOT ONE duty row named an artefact, so the "implemented means something exists" limb ran over nothing.',
  );
}

// ── LIMB 6 · a passed review date FAILS ─────────────────────────────────────
let reviewed = 0;
for (const d of duties) {
  if (typeof d.reviewBy !== 'string') continue;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.reviewBy)) {
    problems.push(`duty ${JSON.stringify(d.id)} has a reviewBy that is not a YYYY-MM-DD date: ${JSON.stringify(d.reviewBy)}.`);
    continue;
  }
  reviewed++;
  if (d.reviewBy < TODAY) {
    problems.push(
      `duty ${JSON.stringify(d.id)} was due for review on ${d.reviewBy} and today is ${TODAY}. A review date is a ` +
        'promise to look again, and the only way that promise is ever kept is if something notices when it passes. ' +
        'Re-read the source, then move the date — moving the date without re-reading is the failure this catches.',
    );
  }
}

// ── owner-gated rows PRINT ──────────────────────────────────────────────────
for (const d of duties) {
  if (d.status !== 'owner-gated') continue;
  if (typeof d.ownerItem !== 'string' || d.ownerItem.trim() === '') {
    problems.push(
      `duty ${JSON.stringify(d.id)} is owner-gated and names no \`ownerItem\`. A duty blocked on nobody in ` +
        'particular is a duty that stays blocked.',
    );
    continue;
  }
  prints.push(`OWNER-GATED (${d.ownerItem}) · ${d.id} [${d.requirement}] — ${d.duty} TRIGGER: ${d.trigger}`);
}
// And so do the unread rules, every run, so "we never got round to reading it"
// cannot quietly become "we decided it did not apply".
for (const d of duties) {
  if (d.verification !== 'COULD-NOT-ESTABLISH') continue;
  prints.push(`UNVERIFIED · ${d.id} [${d.requirement}] — ${d.duty} WOULD NEED: ${d.wouldNeed ?? '(unrecorded)'}`);
}

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ legal tripwires — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline K-13] A compliance corpus decays quietly and goes on reading as authoritative.');
  process.exit(1);
}

const byStatus = new Map();
for (const d of duties) byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);
console.log(
  `ok  legal tripwires — ${duties.length} duty row(s) covering all ${declaredIds.length} declared requirement(s) ` +
    `(${[...byStatus].map(([s, n]) => `${n} ${s}`).join(', ')})`,
);
console.log(
  `    ${sourcedRows} row(s) cite a primary source on the allowlist; ${unestablished} honestly marked ` +
    `COULD-NOT-ESTABLISH and carrying no citation; ${artefacts} artefact(s) exist; ${reviewed} review date(s) still ahead`,
);
console.log(
  '    ⚠️ nobody here is a lawyer. Rows record what can be observed and where an external rule was read from.',
);
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (owner-gated, or a rule nobody has read yet; both must stay visible) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
