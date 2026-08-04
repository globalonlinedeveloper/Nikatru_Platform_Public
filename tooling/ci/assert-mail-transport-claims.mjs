#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-mail-transport-claims.mjs — one record of how mail is sent, and no
// document allowed to restate the superseded one without the correction.
//
// 🔴 WHY THIS EXISTS — a false 🔴🔴 store-submission blocker, 2026-08-03.
// An audit agent concluded that the shared identity project could not deliver
// auth mail to any real user, and escalated that to a blocker on the first store
// submission. It was wrong. It had read FOUR repo documents that all agreed with
// each other — and `SUPABASE_PAT`, the credential that answers the question in
// one GET, was in the vault the whole time.
//
// 📌 FOUR AGREEING DOCUMENTS ARE NOT EVIDENCE. THEY ARE ONE STALE FACT COPIED
// FOUR TIMES. That is the failure this guard exists to make mechanical, and it
// is the same class as everything else in tooling/ci: a thing that reported a
// state confidently while nothing was checking whether the state was real.
//
// The repair has two halves and neither is sufficient:
//   1. ONE HOME FOR THE FACT — `tooling/mail-transport.json`, parsed here, so
//      the architecture is a structure a machine can check instead of N prose
//      copies that drift independently while reinforcing each other.
//   2. NO SILENT RE-ASSERTION — a unit of text that states the SUPERSEDED
//      transport must also state the current one.
//
// ⚠️ WHY THE RULE IS "STATE THE CORRECTION", NOT "NEVER SAY THE WORDS".
// ADR 029, `company/PROJECT_STATE.md` and both Supabase guards describe the old
// state ON PURPOSE — the incident is worth recording. A guard that forbade the
// phrases outright would fire on correct input, and this repository has already
// recorded what happens next: `assert-supabase-templates.mjs` failed its own
// baseline on the real tree, and the note reads "a guard that fires on correct
// input is worse than no guard — the next person to hit it deletes it".
//
// So the phrases are not banned; being alone is. And because the rule is
// satisfied by CONTENT rather than by an entry in a list, THERE IS NO EXEMPTION
// LIST HERE AT ALL — nothing to add a file to, nothing to go stale, no judgement
// recorded over something that has since moved.
//
// 🔬 THE UNIT IS A MARKDOWN SECTION, NOT THE FILE, and not a line window.
// A correction 2,000 lines away in `PROJECT_STATE.md` is not a correction anyone
// reading the claim will see; a fixed line window would be an invented number of
// exactly the kind `assert-store-metadata.mjs` refuses. A heading-delimited
// section is a unit the document itself declares. Non-Markdown files have no
// such structure, so there the unit is the file, and that is stated rather than
// pretended otherwise.
//
// ⚠️ WHAT THIS GUARD CANNOT DO — stated plainly so green is not mistaken for safe:
//   · IT CANNOT SEE LIVE DRIFT. It holds no credential; CI has no `SUPABASE_PAT`.
//     Everything in `supabaseAuth` is a RECORD of a reading, not the reading.
//     `tooling/ops/verify-supabase-templates.mjs` is the half that can look.
//   · IT CANNOT JUDGE WHICH OF TWO ADJACENT SENTENCES A READER WILL BELIEVE. It
//     enforces that the correction is PRESENT, never that the stale claim was
//     removed. A document can satisfy it and still mislead.
//   · IN CI IT SEES ONLY THE TRACKED TREE. `knowledge/` and `company/` are
//     gitignored — the public repo does not carry them — and three of the four
//     documents behind the incident lived there. On a machine that has them it
//     scans them too, and it PRINTS which of the two situations it was in on
//     every run, because "I did not look there" must never read as "it is clean".
//
// Usage:  node tooling/ci/assert-mail-transport-claims.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
// ⚠️ NOT `readdirSync` — see tree-walk.mjs. A raw listing descends into agent
// worktrees under `.claude/` and reads another checkout's files as this tree's,
// which is green in CI and red on the one machine actually looking at it.
import { listDir } from './tree-walk.mjs';

const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());
/** No argument means CI's own invocation against the real repository, where the
 *  git manifest MUST be readable. A caller pointing this at a fixture root is a
 *  weaker situation and says so out loud rather than silently relaxing. */
const scanningRealRepo = process.argv[2] === undefined;

const REGISTER_REL = 'tooling/mail-transport.json';
const REGISTER = join(repoRoot, 'tooling', 'mail-transport.json');

/** Text this guard can meaningfully read. A claim about mail transport lives in
 *  prose or in a comment; it does not live in a PNG or a lockfile. */
const TEXT_EXT = new Set([
  '.md', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.json', '.jsonc',
  '.yml', '.yaml', '.dart', '.html', '.txt', '.sql', '.toml', '.sh', '.ps1',
]);

/** Pruned from the walk: generated, vendored, or not part of the tree's meaning.
 *  `.claude` and nested checkouts are already excluded by tree-walk.mjs. */
const PRUNE = new Set([
  'node_modules', '.git', 'build', 'dist', '_site', 'coverage',
  '.dart_tool', '.wrangler', '.bundles', '.mason', 'Pods', '.idea', '.vscode',
]);

/** The gitignored private trees. Present on the owner's machine, absent in CI,
 *  and three of the four documents behind the incident lived in them. */
const PRIVATE_TREES = ['knowledge', 'company'];

const problems = [];
const prints = [];

const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── the register ────────────────────────────────────────────────────────────
if (!existsSync(REGISTER)) {
  coverageLost([
    `${REGISTER_REL} does not exist.`,
    'It is the ONE record of how this factory sends mail. Without it every check below ranges over',
    'nothing and would print ok — which is precisely the shape of the defect this guard exists for.',
  ]);
}

let reg;
try {
  reg = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (e) {
  coverageLost([`${REGISTER_REL} could not be parsed (${e.message}).`]);
}
if (typeof reg !== 'object' || reg === null || Array.isArray(reg)) {
  coverageLost([`${REGISTER_REL} is not a JSON object.`]);
}

const rails = Array.isArray(reg.rails) ? reg.rails : [];
const auth = typeof reg.supabaseAuth === 'object' && reg.supabaseAuth !== null ? reg.supabaseAuth : {};
const superseded =
  typeof reg.supersededTransportClaims === 'object' && reg.supersededTransportClaims !== null
    ? reg.supersededTransportClaims
    : {};
const patternRows = Array.isArray(superseded.patterns) ? superseded.patterns : [];
const markerRows = Array.isArray(superseded.correctionMarkers) ? superseded.correctionMarkers : [];

if (rails.length === 0) {
  coverageLost([`${REGISTER_REL} declares no rails, so every architectural invariant below is vacuous.`]);
}
if (patternRows.length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no superseded-claim patterns.`,
    'The corpus scan would then range over nothing and report a clean tree for any document at all.',
  ]);
}
if (markerRows.length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no correction markers.`,
    'With nothing able to SATISFY the rule, every historical mention becomes a failure — the guard',
    'would fire on correct input, which is how a guard gets switched off.',
  ]);
}

let patterns;
try {
  patterns = patternRows.map((row) => {
    if (!row?.id || !row?.pattern || !row?.why) {
      throw new Error(`a pattern row is missing id/pattern/why: ${JSON.stringify(row)}`);
    }
    return { ...row, re: new RegExp(row.pattern, 'gi') };
  });
} catch (e) {
  coverageLost([`${REGISTER_REL}: ${e.message}`]);
}
const markers = markerRows.map((row) => {
  if (!row?.marker) coverageLost([`${REGISTER_REL}: a correctionMarkers row has no \`marker\`.`]);
  return String(row.marker);
});

// ── LIMB A · the architecture is STRUCTURALLY what ADR 029 decided ──────────
// Parsed fields, not grepped prose. This repo has a recorded bug where a grep
// for `"r2_buckets"` matched the comment explaining why there is no r2_buckets.
const mailboxRails = rails.filter((r) => r.sendsAutomatedMail === false);
const machineRails = rails.filter((r) => r.sendsAutomatedMail === true);

if (machineRails.length !== 1) {
  problems.push(
    `${REGISTER_REL}: ${machineRails.length} rail(s) carry \`sendsAutomatedMail: true\`, expected exactly 1. ` +
      'ADR 029 §2 pools ALL machine mail onto one identifier: splitting it yields identifiers that never ' +
      'reach the volume to leave "unknown", which receivers treat as similar to bad.',
  );
}
if (mailboxRails.length === 0) {
  problems.push(
    `${REGISTER_REL}: no rail is declared as the mailbox (\`sendsAutomatedMail: false\`). ` +
      'ADR 029 §1 turns on there being a rail that sends nothing automated — that is what keeps the ' +
      'Workspace account, which owns Play Console and Apple, out of the blast radius of mail to strangers.',
  );
}

const machine = machineRails[0];
const mailbox = mailboxRails[0];
if (machine && mailbox) {
  if (machine.domain === mailbox.domain) {
    problems.push(
      `${REGISTER_REL}: the machine-mail rail and the mailbox rail share the domain \`${machine.domain}\`. ` +
        'The whole decision is that they do not: human mail on the organizational domain, machine mail on ' +
        'its own subdomain, no overlap.',
    );
  } else if (!String(machine.domain ?? '').endsWith(`.${mailbox.domain}`)) {
    problems.push(
      `${REGISTER_REL}: the machine-mail domain \`${machine.domain}\` is not a subdomain of the mailbox ` +
        `domain \`${mailbox.domain}\`. ADR 029 §2 pools machine mail under the organizational domain so it ` +
        'inherits an existing reputation instead of starting from unknown.',
    );
  }
}

// The Supabase transport, checked for INTERNAL CONSISTENCY. A record that says
// "custom SMTP" and names no host is the same nothing the stale docs were.
const transport = auth.transport;
if (transport !== 'custom-smtp' && transport !== 'provider-default') {
  problems.push(
    `${REGISTER_REL}: \`supabaseAuth.transport\` is ${JSON.stringify(transport)}; expected ` +
      '"custom-smtp" or "provider-default". An unrecognised value would leave every check below undecided.',
  );
} else if (transport === 'custom-smtp') {
  if (!auth.smtp_host) {
    problems.push(`${REGISTER_REL}: transport is "custom-smtp" and \`smtp_host\` is empty. That is not a transport, it is a claim.`);
  }
  if (auth.external_email_enabled !== true) {
    problems.push(`${REGISTER_REL}: transport is "custom-smtp" and \`external_email_enabled\` is not true — the project would send no mail to anyone outside the team.`);
  }
  // 🔴 THE ONE THAT WOULD HAVE CAUGHT THE PRE-2026-08-04 STATE. The sender was
  // `support@nikatru.com` — the MAILBOX domain — which is exactly the overlap
  // ADR 029 removed. A sender on the mailbox domain puts machine mail back on
  // the account that owns the store identities.
  const sender = String(auth.smtp_admin_email ?? '');
  if (machine && sender && !sender.endsWith(`@${machine.domain}`)) {
    problems.push(
      `${REGISTER_REL}: \`smtp_admin_email\` is \`${sender}\`, which is not on the machine-mail domain ` +
        `\`${machine.domain}\`. Auth mail is machine mail; sending it from the mailbox domain is the ` +
        'overlap ADR 029 exists to remove.',
    );
  }
  // No invented floor on the rate limit. The only honest statement is that a
  // number was recorded, and what it was — a threshold made up here would fire
  // on a correct value somebody deliberately chose.
  if (!Number.isInteger(auth.rate_limit_email_sent)) {
    problems.push(`${REGISTER_REL}: \`rate_limit_email_sent\` is not an integer, so the recorded reading is unusable.`);
  }
}

// ── the corpus ──────────────────────────────────────────────────────────────
const walked = [];
const walk = (absDir, relDir) => {
  for (const entry of listDir(absDir, { withFileTypes: true })) {
    if (PRUNE.has(entry.name)) continue;
    const abs = join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(abs, rel);
    else if (entry.isFile() && TEXT_EXT.has(extname(entry.name).toLowerCase())) walked.push(rel);
  }
};
walk(repoRoot, '');

if (walked.length === 0) {
  coverageLost([
    `nothing readable was found under ${repoRoot}.`,
    'The scan is broken, not the tree. A corpus scan over zero files reports every document clean.',
  ]);
}

// SCAN vs MANIFEST — the assert-workflow-hardening pattern. `git ls-files` is the
// committed truth about what the repo carries; `walked` is what this scan opened.
// A tracked text file the walk never saw takes its claims with it, and the scan
// still prints ok. (Fixture roots are usually not git repositories; there the
// manifest is simply unavailable and the walk stands alone.)
const ls = spawnSync('git', ['-C', repoRoot, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked =
  ls.status === 0
    ? ls.stdout.split('\n').map((l) => l.trim()).filter((l) => l && TEXT_EXT.has(extname(l).toLowerCase()))
    : [];
if (tracked.length === 0 && scanningRealRepo) {
  coverageLost([
    `\`git ls-files\` returned no tracked text file under ${repoRoot}.`,
    'That manifest is the only way to tell "the walk covered the repository" from "the walk found a',
    'few files". Without it the corpus scan below cannot say how much it missed.',
  ]);
}
const walkedSet = new Set(walked);
const unseen = tracked.filter((t) => !walkedSet.has(t));
if (unseen.length) {
  coverageLost([
    `git tracks ${tracked.length} text file(s) and this walk opened ${walked.length}; it never saw ${unseen.length}:`,
    ...unseen.slice(0, 10).map((u) => `    ${u}`),
    ...(unseen.length > 10 ? [`    … and ${unseen.length - 10} more`] : []),
    'Every unseen file takes its claims with it and the scan still prints ok.',
  ]);
}

const privateVisible = PRIVATE_TREES.filter((d) => existsSync(join(repoRoot, d)) && statSync(join(repoRoot, d)).isDirectory());
const privateMissing = PRIVATE_TREES.filter((d) => !privateVisible.includes(d));

// ── LIMB B · no unit restates the superseded transport alone ────────────────
/** Split a document into the units a reader actually reads. Markdown declares
 *  its own: a heading and everything under it until the next heading. Fenced
 *  code is tracked so a `# comment` inside a shell block is not read as one. */
function units(text, ext) {
  if (ext !== '.md') return [{ label: '(whole file)', startLine: 1, text }];
  const lines = text.split('\n');
  const out = [];
  let cur = { label: '(before the first heading)', startLine: 1, lines: [] };
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{0,3}(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^#{1,6}\s/.test(line)) {
      out.push(cur);
      cur = { label: line.trim().slice(0, 90), startLine: i + 1, lines: [] };
    }
    cur.lines.push(line);
  }
  out.push(cur);
  return out.map((u) => ({ label: u.label, startLine: u.startLine, text: u.lines.join('\n') }));
}

const matchCount = new Map(patterns.map((p) => [p.id, 0]));
let unitsScanned = 0;
let filesRead = 0;

for (const rel of walked) {
  // 🔴 THE REGISTER IS THE DECLARATION, NOT A CLAIM, AND SKIPPING IT IS LOAD-
  // BEARING RATHER THAN TIDY. It necessarily CONTAINS every pattern — they are
  // its own `pattern` strings — and it necessarily contains a correction marker,
  // since `smtp_host` is one. So it matched every pattern and satisfied every
  // one of them, single-handedly, which made the aggregate non-vacuity check
  // below IMPOSSIBLE TO FAIL: a scan that had stopped reading the corpus
  // entirely would still find its matches here and report a healthy tree.
  //
  // Found by the fixture suite, not by reasoning: two tests that asserted a
  // clean corpus is NOT a pass, and that a dead pattern is reported dead, both
  // failed because the register was quietly answering for the whole repository.
  // An assertion that cannot fail is worse than none — it inflates apparent
  // coverage. It stays in `walked` so the tracked-manifest identity above still
  // accounts for it; it is only excluded from the CLAIM scan.
  if (rel === REGISTER_REL) continue;
  let text;
  try {
    text = readFileSync(join(repoRoot, rel.split('/').join(sep)), 'utf8');
  } catch {
    continue; // unreadable/binary-ish; the manifest check above owns completeness
  }
  filesRead += 1;
  const ext = extname(rel).toLowerCase();
  for (const unit of units(text, ext)) {
    unitsScanned += 1;
    if (!unit.text) continue;
    const corrected = markers.some((m) => unit.text.includes(m));
    for (const p of patterns) {
      p.re.lastIndex = 0;
      const hit = p.re.exec(unit.text);
      if (!hit) continue;
      // Count EVERY occurrence, corrected or not: the per-pattern totals below
      // are how a pattern that has quietly stopped matching anything shows up.
      p.re.lastIndex = 0;
      matchCount.set(p.id, matchCount.get(p.id) + (unit.text.match(p.re)?.length ?? 1));
      if (corrected) continue;
      const line = unit.startLine + unit.text.slice(0, hit.index).split('\n').length - 1;
      problems.push(
        `${rel}:${line} — states the superseded transport (\`${p.id}\`) and the ${
          ext === '.md' ? `section ${JSON.stringify(unit.label)}` : 'file'
        } never states the current one.\n` +
          `        why it is superseded: ${p.why}\n` +
          `        fix: correct the claim, or state the current transport in the same ${ext === '.md' ? 'section' : 'file'} — ` +
          `naming ${markers.map((m) => `\`${m}\``).join(' or ')} satisfies this.`,
      );
    }
  }
}

// AGGREGATE NON-VACUITY, and deliberately NOT per-pattern. Zero matches across
// the WHOLE corpus means the scan is almost certainly not reading what it thinks:
// the incident history is recorded on purpose in ADR 029, PROJECT_STATE.md and
// both Supabase guards, so the phrases are always present somewhere. A single
// pattern falling to zero is different — that can happen honestly when the last
// historical mention is edited away — so it is PRINTED, never failed. Failing it
// would make the guard fire on correct input, which is how a guard gets deleted.
const totalMatches = [...matchCount.values()].reduce((a, b) => a + b, 0);
if (totalMatches === 0) {
  coverageLost([
    `not one of the ${patterns.length} declared patterns matched anywhere in ${filesRead} file(s).`,
    'The incident history is recorded on purpose in several places, so zero matches means this scan has',
    'stopped reading the corpus rather than that the corpus became clean. Re-point it before trusting it.',
  ]);
}

// ── LIMB C · the live half is still wired to THIS record ────────────────────
// A live checker that hardcodes its expectations has stopped checking the record
// and become a second copy of it — the exact N-drifting-copies defect the
// register removes.
//
// 🔴 THIS WAS A TEXT MATCH AND THE TEXT MATCH DID NOT WORK. It read the source
// with comments stripped and asked whether `mail-transport.json` appeared in it.
// Six fixture tests passed against that version. Then the mutation run against
// the REAL tree repointed the checker's one actual read at a different file and
// the guard STAYED GREEN — because the checker names the register in its ERROR
// MESSAGES too, and a string literal is not a comment. That is this repository's
// oldest recorded bug wearing new clothes: `grep '"r2_buckets"'` matching the
// comment explaining why there is no r2_buckets. Stripping string literals as
// well is no repair either, because the path IS a string literal — the check
// would then be unsatisfiable and fire on correct input.
//
// So it does not read the source at all. IT RUNS THE CHECKER AND OBSERVES
// WHETHER THE REGISTER CHANGES ITS BEHAVIOUR — two probes against a temp root,
// one with the register present and one without. A checker that has stopped
// depending on it answers both the same way. `assert-walks-bounded.mjs` already
// builds a real nested checkout in a temp directory on every run; this is the
// same move.
//
// ⚠️ THE PROBES CAN MAKE NO NETWORK CALL. `SUPABASE_PAT`/`SUPABASE_PROJECT_REF`
// are deleted from the child environment and the temp root holds no
// `.claude/secrets.env`, so the checker exits on the missing credential long
// before it would reach Supabase. That is also what makes exit 2 the expected
// "wiring intact" answer.
const checkerRel = reg.liveChecker?.path;
if (!checkerRel) {
  problems.push(`${REGISTER_REL}: no \`liveChecker.path\`. Nothing then claims to compare this record against the live project, and drift becomes unobservable.`);
} else {
  const checkerAbs = join(repoRoot, checkerRel.split('/').join(sep));
  if (!existsSync(checkerAbs)) {
    problems.push(`${REGISTER_REL}: \`liveChecker.path\` names ${checkerRel}, which does not exist. The only thing that can see drift is gone.`);
  } else {
    const probeRoot = mkdtempSync(join(tmpdir(), 'nikatru-mailtx-probe-'));
    try {
      mkdirSync(join(probeRoot, 'tooling'), { recursive: true });
      const probeRegister = join(probeRoot, 'tooling', 'mail-transport.json');
      copyFileSync(REGISTER, probeRegister);
      const env = { ...process.env };
      delete env.SUPABASE_PAT;
      delete env.SUPABASE_PROJECT_REF;
      const probe = () => spawnSync(process.execPath, [checkerAbs, probeRoot], { env, encoding: 'utf8', timeout: 60_000 });

      const withRegister = probe();
      rmSync(probeRegister);
      const withoutRegister = probe();

      // PRECONDITION. With the register present and no credential the checker
      // must reach its credential check — exit 2, which it documents as
      // "distinct from 0 (match) and 1 (drift)". Anything else means the probe
      // is uninformative, and an uninformative probe must say so rather than
      // let the comparison below read as evidence.
      if (withRegister.status !== 2) {
        problems.push(
          `the wiring probe could not be run: ${checkerRel} exited ${withRegister.status} with the register present ` +
            'and no credential, where 2 (no credential) was expected. Until that is understood, nothing below it ' +
            `proves the checker still reads ${REGISTER_REL}.\n        it said: ${(withRegister.stderr || withRegister.stdout || '').trim().split('\n')[0] ?? '(nothing)'}`,
        );
      } else if (withoutRegister.status === withRegister.status) {
        problems.push(
          `${checkerRel} behaves IDENTICALLY with and without ${REGISTER_REL} (both exit ${withRegister.status}), ` +
            'so it is no longer reading it. It is then asserting its own hardcoded expectations, and this register ' +
            'could drift from live and from the checker at the same time with nothing red.',
        );
      } else {
        prints.push(`live checker wiring PROVEN behaviourally: ${checkerRel} exits ${withRegister.status} with the register and ${withoutRegister.status} without it`);
      }
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
prints.push(
  `scanned ${filesRead} text file(s) / ${unitsScanned} unit(s); ${rails.length} rail(s), ` +
    `transport "${transport}" recorded from live on ${reg.verifiedLiveOn ?? '(no date)'}`,
);
prints.push(
  `superseded-claim patterns: ${patterns.map((p) => `${p.id}=${matchCount.get(p.id)}`).join(' · ')} ` +
    '(occurrences found; each one sits beside a correction or this guard would be red)',
);
for (const p of patterns) {
  if (matchCount.get(p.id) === 0) {
    prints.push(`⬜ pattern \`${p.id}\` matched NOTHING. Printed, not failed — it may be honestly dead, or it may have stopped matching. Re-read it before the next edit relies on it.`);
  }
}
prints.push(
  privateVisible.length === PRIVATE_TREES.length
    ? `private trees VISIBLE and scanned: ${privateVisible.join(', ')} — this run covered the corpus where three of the four stale documents lived`
    : `⬜ private trees NOT visible: ${privateMissing.join(', ')}${privateVisible.length ? ` (saw ${privateVisible.join(', ')})` : ''}. They are gitignored, so CI never sees them and this run did NOT check them. "I did not look" is not "it is clean".`,
);
prints.push('DRIFT vs the live Supabase config is NOT checked here (needs SUPABASE_PAT) — run tooling/ops/verify-supabase-templates.mjs');
prints.push('this guard enforces that a correction is PRESENT, never that a stale claim was removed — it cannot judge which of two adjacent sentences a reader believes');

if (problems.length) {
  console.error(`assert-mail-transport-claims: FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  console.error(`  The architecture is recorded ONCE, in ${REGISTER_REL}, and by ${reg.recordedBy ?? 'the ADR it names'}.`);
  console.error('  A false store-submission blocker was raised on 2026-08-03 from four repo documents that');
  console.error('  agreed with each other and were all stale. Four agreeing documents are not evidence.');
  for (const p of prints) console.error(`  · ${p}`);
  process.exit(1);
}

console.log('assert-mail-transport-claims: OK');
for (const p of prints) console.log(`  · ${p}`);
