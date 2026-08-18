#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-matrix.mjs — catalog/store-matrix.json is the PRIMARY KEY of the
// store matrix, so the tree and the registry must be made to agree out loud.
//
// WHAT IT CHECKS, and each one names the failure it exists to prevent:
//
//   1. EVERY DECLARED SLOT EXISTS. A row naming a directory pair that is not on
//      disk is a slot the copy script, the pipeline generator and the storefront
//      collection pages will all enumerate and then fail to find, each in its own
//      way, at its own time.
//   2. EVERY SLOT DIRECTORY ON DISK IS DECLARED. This is the direction a one-way
//      checker cannot see, and it is the one that matters: a slot created behind
//      the registry's back ships from a tree nothing declares. `mkdir` is how
//      this matrix grows, and `mkdir` leaves no other trace.
//   3. THE PRIVATE NAME IS THE PUBLIC NAME WITH `_Public` -> `_Private`. That
//      swap is how tooling/scripts/spec-guards.mjs reaches the private corpus from
//      the public repo, and the registry stores no `privateDir` precisely because
//      it is derived. So the assertion is made against the DISK, not against the
//      row: each slot path must hold exactly ONE public and ONE private directory,
//      and the private one must be the public one swapped. Checking the row
//      against itself here would be an assertion that cannot fail — the derivation
//      and the thing derived would be the same expression twice.
//   4. NO TWO SLOTS CLAIM THE SAME GITHUB REPO NAME. 🔴 THIS CLASS HAS ALREADY
//      BITTEN THIS TREE: four Apple pairs collided before the owner renamed them.
//      A GitHub owner has ONE flat, case-insensitive namespace, so two slots whose
//      intended names differ only in case are one repo, and the second slot to be
//      created silently becomes the first slot's repo. Public and private names
//      share that namespace and are therefore checked in ONE map, not two.
//   5. EVERY `state` IS IN THE DOCUMENTED VOCABULARY, and the vocabulary is read
//      OUT OF THE REGISTRY rather than re-typed here — a second copy of the
//      vocabulary drifts in the one direction that reports clean.
//   6. A FLOOR. 🔴 THE FLOOR IS THE POINT, NOT A DETAIL. `slots: []` is valid
//      JSON, satisfies every per-row assertion vacuously, and would print `ok`
//      over a registry that declares nothing. So: zero rows REFUSES, and fewer
//      rows than there are slot paths on disk REFUSES, and both refuse as
//      COVERAGE LOST rather than as a content finding, because "the registry
//      emptied" is a statement about this guard's subject disappearing.
//
// WHAT THE FAILURES MEAN, in the order you are likely to meet them:
//   · "slot directory on disk with NO ROW"  — someone made a directory. Add the
//     row, or delete the directory. Nothing is auto-created and nothing is
//     auto-deleted; a registry that edits itself to agree with reality can never
//     report that reality drifted.
//   · "registry row names a directory that is not on disk" — the row is ahead of
//     the tree, or the tree moved. A human decides which is wrong.
//   · "two slots claim the same GitHub repo name" — one of them will not exist.
//   · "state ... derives ..."               — the row's summary of the disk is
//     stale. Fix the row; the disk is the authority on existence.
//   · "COVERAGE LOST"                       — this guard did not check what it
//     claims to check. Never read it as a content failure, and never as a pass.
//
// ── THE TWO ABSENCES ARE ANSWERED BY TWO DIFFERENT TESTS ─────────────────────
// 🔴 A subject absent because THE CHECKOUT DOES NOT CONTAIN IT and a subject
// absent because A PATH IS WRONG must never be answered by the same test
// (STORE-MATRIX-PLAN.md section 4.3). A CI checkout holds ONE repo and never the
// store tree, so the anchor is genuinely unreachable there; a local run with a
// mistyped path is a defect. So:
//   · anchor not found and nothing declared     -> REFUSE, exit 2, naming every
//     directory walked. Refusal is the DEFAULT.
//   · `--registry-only` DECLARED                -> the tree limbs do not run, the
//     count of assertions NOT made is printed, and the run says so in capitals.
//   · `--registry-only` declared AND THE TREE IS ACTUALLY THERE -> REFUSE, exit 2.
//     The declaration is self-policing: the day the tree becomes reachable where
//     the flag is passed, the flag fails loudly instead of suppressing the check
//     forever. A waiver that outlives its reason is how a guard dies quietly.
//
// GitHub existence is a NETWORK fact and is NOT checked unless `--github` is
// passed. When it is not checked, that is PRINTED on every run. Silence is not
// success.
//
// Usage:  node tooling/ci/assert-store-matrix.mjs [--registry-only] [--github]
//                                                 [--projects <dir>] [--registry <file>]
//         `--projects` / `--registry` exist so the negative tests in
//         tooling/ci/test/store-matrix.test.mjs can point this guard at a
//         fixture. Both are PRINTED when used, so an overridden run can never be
//         mistaken in a log for a run against the real tree.
// Exit:   0 = registry and tree agree
//         1 = findings (each named)
//         2 = COVERAGE LOST — anchor, registry or vocabulary not resolvable.
//             Never 0. See tooling/scripts/spec-guards.mjs for what a locator
//             that answers 0 costs.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// 2026-08-18 · Both listings in this file come from tree-walk.mjs, and they
// answer DIFFERENT questions on purpose:
//   · `listDir`                        — "what is in this directory", bounded to
//                                        the tree under test. The default, and
//                                        what every other guard in tooling/ci uses.
//   · `listCheckoutsAcrossWorkspace`   — "which entries here are OTHER
//                                        REPOSITORIES". Used at ONE call site
//                                        below, because the thirty slot
//                                        directories this guard exists to
//                                        enumerate are separate checkouts and
//                                        `listDir` is built to hide precisely
//                                        those. Each use is argued at its site.
import { listDir, listCheckoutsAcrossWorkspace } from './tree-walk.mjs';

const SELF = fileURLToPath(import.meta.url);
const ARGV = process.argv.slice(2);
const has = (n) => ARGV.includes(n);
const val = (n) => {
  const i = ARGV.indexOf(n);
  return i >= 0 && i + 1 < ARGV.length ? ARGV[i + 1] : null;
};

const WANT_GITHUB = has('--github');
const PROJECTS_OVERRIDE = val('--projects');
const REGISTRY_OVERRIDE = val('--registry');
const REGISTRY_ONLY = has('--registry-only');

/** Every refusal goes through here, so the marker, the exit code and the shape
 *  of the message cannot drift apart between limbs. */
function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

// ── anchor: walk UP for the directory holding BOTH `Projects/` and `nikatru/` ──
// Ported from tooling/scripts/spec-guards.mjs. It never counts `..` levels, which
// is the whole point: fifteen slots sit at varying depths and a fixed level count
// is wrong the moment any one of them moves.
function findAnchor(startDir) {
  const walked = [];
  let cur = startDir;
  for (;;) {
    walked.push(cur);
    if (existsSync(join(cur, 'Projects')) && existsSync(join(cur, 'nikatru'))) {
      return { root: join(cur, 'Projects'), walked };
    }
    const up = dirname(cur);
    if (up === cur) return { root: null, walked };
    cur = up;
  }
}

let PROJECTS = null;
let walked = [];
if (PROJECTS_OVERRIDE) {
  PROJECTS = resolve(PROJECTS_OVERRIDE);
  console.log(`!! --projects OVERRIDE IN USE: ${PROJECTS} — this is NOT the anchored tree.`);
  if (!existsSync(PROJECTS)) {
    coverageLost([
      `--projects was given ${PROJECTS}, which does not exist.`,
      'A wrong path is a defect, not an absence, and is refused rather than read as "no tree here".',
    ]);
  }
} else {
  ({ root: PROJECTS, walked } = findAnchor(dirname(SELF)));
}

if (REGISTRY_ONLY && PROJECTS) {
  coverageLost([
    '--registry-only was declared, and the store tree IS reachable from here.',
    `Found: ${PROJECTS}`,
    'The flag exists for a checkout that holds one repo and never the matrix. Passing it where the tree',
    'is present would silently suppress every disk assertion. Drop the flag and run the tree limbs.',
  ]);
}
if (!REGISTRY_ONLY && !PROJECTS) {
  coverageLost([
    'ANCHOR NOT FOUND — no ancestor holds both Projects/ and nikatru/, and --registry-only was not declared.',
    'This is refused rather than skipped: "the tree is not in this checkout" and "the path is wrong" are',
    'different facts, and answering both with one test is how seven guards were disarmed by name once already.',
    'Walked:',
    ...walked.map((w) => `  ${w}`),
  ]);
}

// ── the registry ──────────────────────────────────────────────────────────────
const REGISTRY = REGISTRY_OVERRIDE
  ? resolve(REGISTRY_OVERRIDE)
  : resolve(dirname(SELF), '..', '..', 'catalog', 'store-matrix.json');
if (REGISTRY_OVERRIDE) console.log(`!! --registry OVERRIDE IN USE: ${REGISTRY}`);

if (!existsSync(REGISTRY)) {
  coverageLost([
    `the registry is ABSENT at ${REGISTRY}.`,
    'Absent is not "nothing to check" — it is "the thing I exist to check is gone".',
  ]);
}
let reg;
try {
  reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
} catch (e) {
  coverageLost([`the registry at ${REGISTRY} is UNPARSEABLE — ${e.message}`]);
}
if (!Array.isArray(reg.slots)) {
  coverageLost(['the registry has no `slots` ARRAY.']);
}
if (reg.slots.length === 0) {
  coverageLost([
    'the registry declares ZERO slots.',
    'An empty array is valid JSON and satisfies every per-row assertion below vacuously, because there',
    'are no rows left to violate them. It would print ok over a matrix that declares nothing at all.',
  ]);
}

const findings = [];
const fail = (m) => findings.push(m);

// ── derivations. ONE definition each, used everywhere below. ──────────────────
const pathOf = (s) => `${s.store}/${s.target}/${s.type}`;
const privateDirOf = (s) => s.publicDir.replace(/_Public$/, '_Private');
const publicPathOf = (s) => `${pathOf(s)}/${s.publicDir}`;
const privatePathOf = (s) => `${pathOf(s)}/${privateDirOf(s)}`;

// The naming template is READ OUT OF THE REGISTRY, never re-typed here. Typing
// `Nikatru_<target>_<type>_Public` into this file would be a second declaration of
// the naming rule, free to drift from `naming.directoryRule` in the one direction
// that reports clean — this guard would go on enforcing a rule the registry no
// longer states. If the rule cannot be read that is COVERAGE LOST: a name check
// against a template nobody could parse checks nothing.
const RULE = String(reg.naming?.directoryRule ?? '');
const TEMPLATE = (/([A-Za-z0-9_]*<target>[A-Za-z0-9_]*<type>[A-Za-z0-9_]*<Public\|Private>)/.exec(RULE) ?? [])[1];
if (!TEMPLATE) {
  coverageLost([
    'naming.directoryRule does not contain a parseable template.',
    `Read: ${RULE.slice(0, 120) || '(nothing)'}`,
    'Expected a token of the shape Nikatru_<target>_<type>_<Public|Private>. Without it the per-row name',
    'check has no rule to check against, and would accept every name silently.',
  ]);
}
const fromTemplate = (s, side) =>
  TEMPLATE.replace('<target>', s.target).replace('<type>', s.type).replace('<Public|Private>', side);

// ── the state vocabulary, derived from the registry ───────────────────────────
// Only the META keys are named here, and their absence is a FINDING: if `note`
// were renamed, this guard would otherwise read it as a valid state and accept
// `"state": "note"` forever.
const VOCAB_META = ['note', 'derivedFrom'];
const vocabKeys = Object.keys(reg.stateVocabulary ?? {});
for (const m of VOCAB_META) {
  if (!vocabKeys.includes(m)) {
    fail(`stateVocabulary has no "${m}" key — this guard's meta-key exclusion list is stale, and a renamed meta key would be read as a valid state`);
  }
}
const VOCAB = vocabKeys.filter((k) => !VOCAB_META.includes(k));
if (VOCAB.length === 0) {
  coverageLost([
    'stateVocabulary declares no state values.',
    'A vocabulary check against an empty vocabulary either rejects every row or accepts every row,',
    'depending on which way it is written, and neither is checking the thing it names.',
  ]);
}
const seenVocab = new Map(VOCAB.map((v) => [v, 0]));

// ── is this directory an empty shell? null = it is not there at all ───────────
const isEmptyTree = (abs) => {
  if (!existsSync(abs)) return null;
  if (existsSync(join(abs, '.git'))) return false;
  const stack = [abs];
  while (stack.length) {
    const cur = stack.pop();
    // ⚠️ `listDir`, NOT the crossing primitive, and the distinction is the whole
    // point of the pair. This asks "does this directory hold a file of its own",
    // which is a question about ONE tree's contents; the `.git` test above has
    // already returned for a slot that is a real checkout, so anything `listDir`
    // prunes from here is a repository parked INSIDE a shell. Its files are its
    // own, and counting them as this shell's is exactly the substitution
    // tree-walk.mjs exists to prevent.
    for (const e of listDir(cur, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(join(cur, e.name));
      else return false;
    }
  }
  return true;
};

// ── per-row checks ────────────────────────────────────────────────────────────
const byPath = new Map();
const expectedDirs = new Set();
/** ONE map for both halves: a GitHub owner has one flat namespace, and it is
 *  case-insensitive, so `Nikatru_iOS_Apps_Public` and `nikatru_ios_apps_public`
 *  are the same repo. Keyed lowercase for exactly that reason. */
const repoNames = new Map();
let diskAssertionsSkipped = 0;

for (const s of reg.slots) {
  const p = pathOf(s);
  if (byPath.has(p)) fail(`duplicate slot row for ${p}`);
  byPath.set(p, s);

  if (!String(s.publicDir ?? '').endsWith('_Public')) {
    fail(`${p}: publicDir ${JSON.stringify(s.publicDir)} has no _Public suffix, so the private name cannot be derived from it`);
    continue;
  }

  // 3a. the rule, substituted.
  const wantPublic = fromTemplate(s, 'Public');
  if (s.publicDir !== wantPublic) {
    fail(`${p}: publicDir "${s.publicDir}" breaks naming.directoryRule — the rule derives "${wantPublic}"`);
  }
  const bySwap = privateDirOf(s);

  // 4. the collision class that already bit this tree.
  for (const [side, name] of [['public', s.publicDir], ['private', bySwap]]) {
    const key = name.toLowerCase();
    const prior = repoNames.get(key);
    if (prior) {
      fail(`two slots claim the same GitHub repo name "${name}" — ${prior} and ${p} (${side}). GitHub's namespace is flat and case-insensitive, so one of these repos cannot exist.`);
    } else {
      repoNames.set(key, `${p} (${side})`);
    }
  }

  expectedDirs.add(publicPathOf(s));
  expectedDirs.add(privatePathOf(s));

  // 5. the vocabulary.
  if (!seenVocab.has(s.state)) {
    fail(`${p}: state ${JSON.stringify(s.state)} is not in the documented vocabulary [${VOCAB.join(', ')}]`);
  } else {
    seenVocab.set(s.state, seenVocab.get(s.state) + 1);
  }

  // 1. the directories, and the state the disk derives. Tree limb only.
  if (!PROJECTS) {
    diskAssertionsSkipped += 3;
    continue;
  }
  const pubAbs = join(PROJECTS, ...publicPathOf(s).split('/'));
  const privAbs = join(PROJECTS, ...privatePathOf(s).split('/'));
  const pubEmpty = isEmptyTree(pubAbs);
  const privEmpty = isEmptyTree(privAbs);
  if (pubEmpty === null) fail(`${p}: public directory MISSING on disk — ${publicPathOf(s)}`);
  if (privEmpty === null) fail(`${p}: private directory MISSING on disk — ${privatePathOf(s)} (derived by _Public -> _Private)`);
  if (pubEmpty !== null && privEmpty !== null) {
    const empty = pubEmpty && privEmpty;
    const expect = !empty ? 'live' : s.backing ? 'shell-claimed' : 'shell-empty';
    if (expect !== s.state) {
      fail(`${p}: state says "${s.state}" but disk+backing derive "${expect}" (dirs ${empty ? 'empty' : 'NON-empty'}, backing ${s.backing ? 'present' : 'null'})`);
    }
  }
}

for (const [v, n] of seenVocab) {
  if (n === 0) fail(`state vocabulary value "${v}" has no member — a state nothing is in is a state nobody maintains`);
}

// ── 2. the other direction, and 6. the floor ──────────────────────────────────
let onDisk = null;
const onDiskSlotPaths = new Set();
if (PROJECTS) {
  onDisk = new Set();
  const misplaced = [];
  // Slot directories live at EXACTLY depth 4 under Projects/ —
  // <store>/<target>/<type>/<name>. The depth is not an optimisation, it is the
  // shape: a slot-shaped directory anywhere else is reported BY NAME rather than
  // ignored, because "put it one level up and the checker stops seeing it" is how
  // a slot gets created behind the registry's back. Projects/Project_Cross_
  // browser_Extensions_Private is deliberately NOT slot-shaped by this test — no
  // Nikatru_ prefix — which is why it sits outside the matrix without being a
  // finding, and why moving it INTO the tree would become one.
  const walk = (abs, rel, depth) => {
    let entries;
    try {
      // TWO QUESTIONS, ASKED SEPARATELY AT EVERY LEVEL, AND ONLY ONE OF THEM
      // LEAVES THE TREE. Merging them into one `readdirSync` — which is what
      // stood here until 2026-08-18 — is what let this walk descend into
      // Project_Web_Presence and Project_Cross_browser_Extensions and read
      // their directories as this tree's.
      //
      // (a) "WHAT IS IN THIS DIRECTORY" — `listDir`, the bounded listing every
      // walk in tooling/ci goes through. It carries the ordinary containers on
      // the way down (<store>/<target>/<type>) AND the slot directories that are
      // not checkouts: 28 of the 30 slots on this machine are shells with no
      // `.git` in them yet, so a level read through the crossing primitive alone
      // would report all 28 declared directories as missing from disk.
      const inTree = listDir(abs, { withFileTypes: true }).map((e) => [e, false]);

      // (b) 2026-08-18 · THE ONE CALL IN THIS FILE THAT CROSSES THE BOUNDARY.
      // It is allowed to leave the tree because THE SLOTS ARE THIS GUARD'S
      // SUBJECT and a slot that exists for real IS a separate repository —
      // being a checkout is the property that makes a directory a slot, not an
      // accident of this machine. `listDir` filters out precisely those, so this
      // walk routed through it alone would not see Nikatru_Android_Apps_Public
      // (this repo) or its private half at all, would find 28 of 30 directories,
      // and the registry's own two rows would read as "not on disk".
      // It crosses to the DOORSTEP ONLY: every entry it returns is NAMED and
      // never descended into (`!isCheckout` on the recursion below), so no other
      // repository's contents are ever read as this tree's. The question is
      // asked at every depth rather than only at depth 3 because a slot-shaped
      // checkout in the WRONG place — a `git clone` of a slot repo into
      // Projects/ — is the fault check 2 exists to name, and it is invisible to
      // `listDir` wherever it sits.
      const acrossWorkspace = listCheckoutsAcrossWorkspace(abs, { withFileTypes: true }).map((e) => [e, true]);

      entries = [...inTree, ...acrossWorkspace];
    } catch {
      return;
    }
    for (const [e, isCheckout] of entries) {
      if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const d = depth + 1;
      if (d === 4 && /_(Public|Private)$/.test(e.name)) onDisk.add(r);
      else if (d !== 4 && /^Nikatru_.+_(Public|Private)$/.test(e.name)) {
        misplaced.push(`${r} (depth ${d}; slots live at depth 4)`);
      }
      // A checkout is enumerated and then LEFT ALONE. Descending into one is the
      // defect itself — its files belong to its own repository — and it is also
      // what `listCheckoutsAcrossWorkspace` refuses to license.
      if (d < 5 && !isCheckout) walk(join(abs, e.name), r, d);
    }
  };
  walk(PROJECTS, '', 0);

  // 3. THE PAIRING, read off the disk rather than off the row. The registry
  // stores no `privateDir` — it is derived by the _Public -> _Private swap, and
  // that swap is how tooling/scripts/spec-guards.mjs reaches the private corpus.
  // So the assertion that matters is about the TREE: each slot path holds exactly
  // one public and one private directory, and the private one is the public one
  // swapped. A pair renamed in one half only leaves the resolver looking for a
  // name nothing carries.
  const halves = new Map();
  for (const d of onDisk) {
    const parts = d.split('/');
    const sp = parts.slice(0, 3).join('/');
    const e = halves.get(sp) ?? { pub: [], priv: [] };
    (parts[3].endsWith('_Public') ? e.pub : e.priv).push(parts[3]);
    halves.set(sp, e);
    onDiskSlotPaths.add(sp);
  }
  for (const [sp, e] of halves) {
    if (e.pub.length !== 1 || e.priv.length !== 1) {
      fail(`${sp}: a slot is ONE public + ONE private directory; disk holds ${e.pub.length} public [${e.pub.join(', ')}] and ${e.priv.length} private [${e.priv.join(', ')}]`);
      continue;
    }
    const want = e.pub[0].replace(/_Public$/, '_Private');
    if (e.priv[0] !== want) {
      fail(`${sp}: the private half on disk is "${e.priv[0]}", but the public half "${e.pub[0]}" swaps to "${want}" — spec-guards.mjs reaches the private corpus by that swap and would not find this pair`);
    }
  }

  for (const d of onDisk) if (!expectedDirs.has(d)) fail(`slot directory on disk with NO ROW in the registry — ${d}`);
  for (const d of expectedDirs) if (!onDisk.has(d)) fail(`registry row names a directory that is not a slot directory on disk — ${d}`);
  for (const m of misplaced) fail(`slot-shaped directory OUTSIDE the <store>/<target>/<type>/<name> shape — ${m}`);

  // 6. THE FLOOR, measured against the disk rather than against itself, so a
  // registry that silently empties fails instead of passing over nothing.
  if (reg.slots.length < onDiskSlotPaths.size) {
    console.error(`✗ COVERAGE LOST — the registry declares ${reg.slots.length} slot row(s); the tree holds ${onDiskSlotPaths.size} slot path(s).`);
    console.error('  Rows have gone without their directories going with them, so this run checked FEWER slots');
    console.error('  than exist. Every per-row assertion above is true and all of them are beside the point.');
    fail(`FLOOR BREACHED — ${reg.slots.length} row(s) < ${onDiskSlotPaths.size} slot path(s) on disk`);
  }
}

// ── backing: claimed slots must resolve, and must agree with the rows ─────────
const claimed = new Set();
for (const prod of reg.backing?.products ?? []) {
  for (const c of prod.claimsSlots ?? []) {
    const row = byPath.get(c);
    if (!row) {
      fail(`backing.products[${prod.product}].claimsSlots names "${c}", which matches no row`);
      continue;
    }
    if (!row.backing || row.backing.product !== prod.product) {
      fail(`${c}: claimed by product "${prod.product}" but the row's backing is ${JSON.stringify(row.backing)}`);
    } else claimed.add(c);
  }
}
for (const s of reg.slots) {
  if (s.backing && !claimed.has(pathOf(s))) {
    fail(`${pathOf(s)}: row declares backing "${s.backing.product}" but no product in backing.products claims this slot`);
  }
}
for (const c of reg.collisions ?? []) {
  if (c.slot && !byPath.get(c.slot)) fail(`collisions[${c.id}].slot "${c.slot}" matches no row`);
}

// ── counts are a summary OF the rows, never a claim beside them ───────────────
const actual = {
  slots: reg.slots.length,
  directories: expectedDirs.size,
  intendedReposExistingOnGitHub: reg.slots.reduce(
    (n, s) => n + (s.repos?.public?.existsOnGitHub ? 1 : 0) + (s.repos?.private?.existsOnGitHub ? 1 : 0),
    0,
  ),
};
for (const v of VOCAB) actual[v] = reg.slots.filter((s) => s.state === v).length;
for (const [k, v] of Object.entries(actual)) {
  if (!Object.prototype.hasOwnProperty.call(reg.counts ?? {}, k)) fail(`counts.${k} is absent; the rows say ${v}`);
  else if (reg.counts[k] !== v) fail(`counts.${k} says ${reg.counts[k]}, the rows say ${v}`);
}

// ── the network limb: opt-in, and its absence is printed, never silent ────────
if (WANT_GITHUB) {
  let list;
  try {
    list = JSON.parse(
      execFileSync('gh', ['repo', 'list', 'globalonlinedeveloper', '--limit', '100', '--json', 'name,visibility'], {
        encoding: 'utf8',
      }),
    );
  } catch (e) {
    coverageLost([
      '--github asked for the GitHub limb and it COULD NOT LOOK.',
      String(e.message).split('\n')[0],
      'This is a different message from "it is stale", and deliberately the same colour.',
    ]);
  }
  const have = new Map(list.map((r) => [r.name, r.visibility]));
  for (const s of reg.slots) {
    for (const [side, name] of [['public', s.publicDir], ['private', privateDirOf(s)]]) {
      const exists = have.has(name);
      const rec = s.repos?.[side] ?? {};
      if ((rec.existsOnGitHub ?? null) !== exists) {
        fail(`${pathOf(s)} ${side}: repos.${side}.existsOnGitHub says ${rec.existsOnGitHub}, GitHub says ${exists} for "${name}"`);
      }
      const vis = exists ? have.get(name) : null;
      if ((rec.visibility ?? null) !== vis) {
        fail(`${pathOf(s)} ${side}: visibility says ${JSON.stringify(rec.visibility)}, GitHub says ${JSON.stringify(vis)}`);
      }
    }
  }
  console.log('github limb: RAN against `gh repo list` (read-only).');
} else {
  console.log('github limb: NOT RUN. repos.*.existsOnGitHub and .visibility were NOT verified this run.');
  console.log('             Pass --github to check them. Until then this guard has verified structure, not GitHub.');
}

// ── report ────────────────────────────────────────────────────────────────────
if (PROJECTS) {
  console.log(`tree limb: RAN against ${PROJECTS} — ${onDisk.size} slot directories across ${onDiskSlotPaths.size} slot path(s).`);
} else {
  console.log('tree limb: NOT RUN — --registry-only was DECLARED, so the store tree was never opened.');
  console.log(`           ${diskAssertionsSkipped} disk assertion(s) over ${reg.slots.length} row(s) were NOT made, nor the`);
  console.log('           both-directions check, nor the on-disk floor. This run verified the REGISTRY only.');
}
console.log(`checked ${reg.slots.length} slot row(s) · ${expectedDirs.size} declared directories · ${repoNames.size} distinct intended repo names`);

if (findings.length) {
  console.error(`\nassert-store-matrix: ${findings.length} finding(s)`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('assert-store-matrix: ok');
process.exit(0);
