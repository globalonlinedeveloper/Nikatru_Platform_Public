#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-policy-archive.mjs — the text a user consented to is still retrievable.
//
// [pipeline K-4] A consent record that names "policy version 2026-07-26" is
// worth exactly as much as our ability to produce the bytes of 2026-07-26. This
// site publishes ONE privacy policy at ONE URL and edits it in place: on
// 2026-08-01 the version moved from `2026-07-26` to `2026-08-01` with no
// archive, and the superseded text survived only in git history. Every consent
// artifact collected before that bump cited a document nobody could serve.
//
// `assert-seams-wired.mjs` already pins the OTHER half — that the version string
// in the apps equals the version string on the page, so a record cannot cite a
// policy the user was never shown. This file is the half that makes the citation
// resolvable: for every version that has ever been in force, a snapshot.
//
// THE SCHEMA IS `<version>/<locale>`, decided now and not later:
//     sites/nikatru/legal/<YYYY-MM-DD>/<locale>/privacy.html
// K-14 wants a notice per locale the app already supports. If the archive were
// keyed on version alone, the day a Tamil notice ships every existing consent
// artifact from a Tamil reader would resolve to English bytes — which is the
// exact defect this file exists to prevent, reopened by our own schema. The
// locale segment costs one directory today and is unmigratable later.
//
// 🔴 HOW THE HISTORICAL SET IS DERIVED, AND THE WAY THAT DOES NOT WORK.
// The obvious command is `git log -S kPrivacyPolicyVersion`. IT DOES NOT WORK
// AND IT FAILS SILENTLY. `-S` counts OCCURRENCES of a string, so a value edited
// in place leaves the count unchanged and the commit is invisible. Measured on
// this repository: `-S` returns 6 commits and misses BOTH bumps (`d70004a`,
// `89ac2bd`); `-G`, which matches the diff text, returns 8 and finds them. A
// guard built on `-S` would compute "one version ever, one snapshot required"
// forever, while going green. So the derivation below reads `git log -p` over
// each declaring file and extracts every value that was ever ADDED.
//
// ⚠️ THIS NEEDS REAL HISTORY. `actions/checkout` clones at depth 1 by default,
// and in a depth-1 clone `git log -p` shows one commit that "adds" the current
// file wholesale — which looks exactly like a complete history containing
// exactly one version. That is why a shallow repository is COVERAGE LOST here
// rather than a pass, and why ci.yml passes `fetch-depth: 0` to the lane that
// runs this.
//
// Usage:  node tooling/ci/assert-policy-archive.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { visibleText } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());

const LIVE_POLICY = 'sites/nikatru/privacy.html';
const ARCHIVE_ROOT = 'sites/nikatru/legal';
/** The archived document's filename inside `<version>/<locale>/`. Same name as
 *  the live page on purpose: the archive URL is the live URL with a prefix. */
const DOC = 'privacy.html';

/** Every file that has ever declared which policy version is in force, with the
 *  pattern that reads the value out of it. This is the SAME set
 *  `assert-seams-wired.mjs` pins — add a file to both, or the two halves of K-4
 *  stop describing the same thing. */
const VERSION_SOURCES = [
  { path: LIVE_POLICY, re: /data-policy-version="(\d{4}-\d{2}-\d{2})"/g },
  { path: 'apps/subly/lib/state/analytics_providers.dart', re: /kPrivacyPolicyVersion\s*=\s*'(\d{4}-\d{2}-\d{2})'/g },
  {
    path: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart',
    re: /kPrivacyPolicyVersion\s*=\s*'(\d{4}-\d{2}-\d{2})'/g,
  },
];

const problems = [];
/** Owner-gated gaps: printed every run, never a build failure. [pipeline C-6] */
const prints = [];
/** The K-14 locale line, printed with the summary rather than mid-scan. */
let localeSummary = null;
const rel = (p) => relative(repoRoot, p).split(sep).join('/');
const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const git = (args) =>
  spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// `visibleText` is imported from tooling/ci/text-reductions.mjs (top of file). The
// comparison below is on VISIBLE TEXT rather than bytes, and that is deliberate.
// An archived copy differs from the published page in three places, none of
// which is text a reader saw (see sites/nikatru/legal/README.md):
//   · robots → noindex,
//   · no <link rel="canonical"> — one would tell a crawler the archive IS the
//     current policy,
//   · same-site .html links rewritten to the root-relative form, because a
//     document-relative footer link resolves under /legal/<version>/<locale>/
//     and 404s — a dead link in the one document that has to still work.
// What has to be identical is the thing a person read and agreed to, so that is
// what is compared. A byte comparison would have to forbid all three.

const coverageLost = (msg, ...detail) => {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const d of detail) console.error(`  ${d}`);
  process.exit(1);
};

// ── what is published right now ─────────────────────────────────────────────
const liveSrc = read(join(repoRoot, LIVE_POLICY));
if (liveSrc === null) {
  coverageLost(
    `cannot read ${LIVE_POLICY}.`,
    'The page whose versions this archive tracks is gone or moved, so every comparison below',
    'would range over nothing. That is a broken scan, not a clean tree.',
  );
}
const published = liveSrc.match(/data-policy-version="(\d{4}-\d{2}-\d{2})"/)?.[1];
if (!published) {
  coverageLost(
    `${LIVE_POLICY} declares no data-policy-version.`,
    'Nothing identifies which text is currently in force, so no consent record can name it and',
    'no snapshot can be matched to it.',
  );
}

// ── what is archived ────────────────────────────────────────────────────────
const archiveDir = join(repoRoot, ARCHIVE_ROOT);
/** version → Map(locale → { file, declared }) */
const archived = new Map();
if (existsSync(archiveDir)) {
  for (const v of listDir(archiveDir, { withFileTypes: true })) {
    if (!v.isDirectory()) continue;
    const locales = new Map();
    for (const l of listDir(join(archiveDir, v.name), { withFileTypes: true })) {
      if (!l.isDirectory()) continue;
      const file = join(archiveDir, v.name, l.name, DOC);
      const src = read(file);
      if (src === null) {
        problems.push(
          `${ARCHIVE_ROOT}/${v.name}/${l.name}/ contains no ${DOC}. An archive directory with no document is a URL ` +
            'a consent record can cite and nothing can serve.',
        );
        continue;
      }
      locales.set(l.name, { file, src, declared: src.match(/data-policy-version="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? null });
    }
    archived.set(v.name, locales);
  }
}

// A schema check, because the directory name is the KEY every consent record
// resolves through. A snapshot filed under the wrong version is worse than a
// missing one: it answers the question, wrongly.
for (const [version, locales] of archived) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
    problems.push(
      `${ARCHIVE_ROOT}/${version}/ is not a version directory. The archive is keyed <version>/<locale>, and a ` +
        'stray directory here is either a mis-filed snapshot or a second layout nobody taught this guard.',
    );
    continue;
  }
  if (locales.size === 0) {
    problems.push(`${ARCHIVE_ROOT}/${version}/ holds no <locale>/ directory. The key is <version>/<locale>, never <version> alone.`);
  }
  for (const [locale, snap] of locales) {
    if (!/^[a-z]{2}(-[A-Za-z]{2,8})*$/.test(locale)) {
      problems.push(`${ARCHIVE_ROOT}/${version}/${locale}/ is not a locale tag. Expected e.g. "en", "ta", "pt-BR".`);
    }
    if (snap.declared !== version) {
      problems.push(
        `${rel(snap.file)} declares data-policy-version="${snap.declared ?? '(none)'}" but is filed under ${version}. ` +
          'The directory is the key a consent record resolves through; if the two disagree the archive answers the ' +
          'question with the wrong document.',
      );
    }
    // An archived policy that is still indexable competes with the live one for
    // the same search, and its canonical (if it kept the live page's) would tell
    // a crawler the two are the same document.
    if (!/<meta\s+name=["']robots["'][^>]*noindex/i.test(snap.src)) {
      problems.push(
        `${rel(snap.file)} is not marked noindex. A superseded policy that is still indexable is a second live ` +
          'policy, and a reader who lands on it from a search has no way to know it was replaced.',
      );
    }
    if (/rel=["']canonical["']/i.test(snap.src)) {
      problems.push(
        `${rel(snap.file)} still carries a <link rel="canonical">. Pointing an archived version at the current URL ` +
          'tells a crawler the two documents are the same one — the exact confusion this archive exists to prevent.',
      );
    }
  }
}

// ── LIMB 1 · the current version is archived, and it MATCHES ────────────────
const currentSnaps = archived.get(published);
if (!currentSnaps || currentSnaps.size === 0) {
  problems.push(
    `the published policy version ${published} has NO snapshot under ${ARCHIVE_ROOT}/${published}/<locale>/${DOC}. ` +
      'Publish the archive copy in the same commit as the version bump — the bytes are only trivially recoverable ' +
      'while they are still the live page.',
  );
} else {
  const live = visibleText(liveSrc);
  for (const [locale, snap] of currentSnaps) {
    // Only the notice the live page IS can be compared to it. Other locales are
    // translations; K-14 owns whether they exist and whether they are reviewed.
    if (locale !== 'en') continue;
    if (visibleText(snap.src) !== live) {
      problems.push(
        `${rel(snap.file)} and ${LIVE_POLICY} do not carry the same text, and both claim version ${published}. ` +
          'One of them was edited without a version bump, so the "exact text the user consented to" is now two ' +
          'different documents wearing one version number.',
      );
    }
  }
  if (!currentSnaps.has('en')) {
    problems.push(
      `${ARCHIVE_ROOT}/${published}/ has no en/ snapshot, and ${LIVE_POLICY} is the English notice. Nothing can be ` +
        'compared against the page actually in force.',
    );
  }
}

// ── LIMB 2 · every version ever in force has a snapshot ─────────────────────
const inside = git(['rev-parse', '--is-inside-work-tree']);
if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
  coverageLost(
    'this is not a git work tree, so "every version ever in force" could not be derived.',
    'The historical set lives only in history; without it this guard can only check the present,',
    'which is the one thing that is never the problem.',
  );
}
const shallow = git(['rev-parse', '--is-shallow-repository']);
if (shallow.stdout.trim() === 'true') {
  coverageLost(
    'the repository is a SHALLOW clone, so the version history is not present.',
    'In a depth-1 clone `git log -p` reports one commit that adds the whole file, which is',
    'indistinguishable from "there has only ever been one version" — it would pass, forever.',
    'The lane that runs this guard must check out with `fetch-depth: 0`.',
  );
}

/** Every value this file has ever had, read from added diff lines. `-p` over the
 *  path, not `-S` over the string: see the header. */
function everAdded({ path, re }) {
  const r = git(['log', '-p', '--follow', '--format=', '--', path]);
  if (r.status !== 0) return null;
  const out = new Set();
  for (const line of r.stdout.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const m of line.matchAll(re)) out.add(m[1]);
  }
  return out;
}

const historical = new Set();
let sourcesRead = 0;
for (const source of VERSION_SOURCES) {
  const values = everAdded(source);
  if (values === null) {
    problems.push(`git log over ${source.path} failed, so its version history contributed nothing.`);
    continue;
  }
  if (values.size === 0 && existsSync(join(repoRoot, source.path))) {
    problems.push(
      `${source.path} exists and declares a policy version, and its history yielded none. The walk over it is ` +
        'broken — a source that contributes zero values silently shrinks the set of versions that need archiving.',
    );
    continue;
  }
  sourcesRead++;
  for (const v of values) historical.add(v);
}

// COVERAGE, and it is a RELATIONSHIP rather than a floor: whatever the history
// walk returns, it has to contain the version the COMMITTED page declares. A
// walk that cannot see the present certainly cannot see the past.
//
// ⚠️ Anchored on HEAD, not on the working tree. `git log` reads committed
// history and the working tree may be ahead of it — the version bump that is
// still uncommitted is precisely the moment this guard is most useful, and
// anchoring on the working tree turned that case into "COVERAGE LOST: the walk
// is broken" when the walk was fine and the SNAPSHOT was missing. A guard that
// reports the wrong fault sends the fix to the wrong file. (Found by mutation:
// bumping the live version with no snapshot printed a coverage error instead of
// the missing-snapshot error it exists to print.)
const headPolicy = git(['show', `HEAD:${LIVE_POLICY}`]);
const headVersion =
  headPolicy.status === 0 ? headPolicy.stdout.match(/data-policy-version="(\d{4}-\d{2}-\d{2})"/)?.[1] : undefined;
if (!headVersion) {
  coverageLost(
    `could not read a data-policy-version out of HEAD:${LIVE_POLICY}.`,
    'The committed page is the anchor the history walk is checked against; without it the walk could',
    'return the empty set and still look complete.',
  );
}
if (!historical.has(headVersion)) {
  coverageLost(
    `the history walk found ${historical.size} version(s) (${[...historical].sort().join(', ') || 'none'}) and the ` +
      `version committed at HEAD (${headVersion}) is not among them.`,
    'Either a declaring file moved and VERSION_SOURCES was not updated, or the diff parse broke.',
  );
}
if (sourcesRead === 0) {
  coverageLost('no version source could be read, so the historical set was derived from nothing.');
}

// The working tree can be AHEAD of history — an uncommitted bump. It still owes
// a snapshot, and demanding it here is what makes "archive in the same commit as
// the bump" enforceable at the moment the bump is written rather than after.
historical.add(published);

for (const version of [...historical].sort()) {
  if (!archived.has(version) || archived.get(version).size === 0) {
    problems.push(
      `version ${version} was in force at some point (it appears in the history of ` +
        `${VERSION_SOURCES.map((s) => s.path.split('/').pop()).join(' / ')}) and has NO snapshot under ` +
        `${ARCHIVE_ROOT}/${version}/. Every consent record citing it names a document nobody can produce. ` +
        `Recover the bytes with \`git log -p -- ${LIVE_POLICY}\` — this only gets harder.`,
    );
  }
}

if (archived.size === 0) {
  coverageLost(
    `no snapshot resolved under ${ARCHIVE_ROOT}/.`,
    'An archive guard with an empty archive has nothing to check and would report clean on a tree',
    'that has lost every superseded policy.',
  );
}

// ── LIMB 3 · [pipeline K-14] a notice per locale the app already supports ───
//
// The apps ship in more than one language. The notice ships in one. A user shown
// a consent prompt in Tamil is consenting to a document they were never offered
// in a language they read, and their consent artifact resolves to English bytes.
//
// 🔴 THIS LIMB EXISTS BECAUSE THE SCHEMA MADE IT CHEAP. The archive key is
// `<version>/<locale>` (see the header), decided in the increment BEFORE this
// one precisely so that the first Tamil notice could land without migrating
// every existing consent record. Keyed on version alone, this limb would have
// been unbuildable without a schema change.
//
// ⚠️ IT PRINTS, IT DOES NOT FAIL, and that is not timidity. An unreviewed
// machine translation of a statutory notice is itself a legal-accuracy exposure,
// so the missing document needs a native review (propose OWNER_QUEUE O-4) — work
// only the owner can commission. Failing CI on it would block every other lane
// for weeks, and a guard that cries wolf is one somebody switches off. It flips
// to a real comparison the moment the document lands: a notice whose
// data-policy-version disagrees with the English one FAILS, because that is a
// translation of a document that is no longer current, which is worse than none.
//
// ⚠️ NOT A RE-IMPORT OF THE 22-LANGUAGE APP-UI PROGRAMME that this project
// deliberately cut. The domain is the locale list the app ALREADY has — adding a
// notice for a language we already ship, not adding languages.
{
  const L10N_DIR = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/l10n';
  const l10nAbs = join(repoRoot, ...L10N_DIR.split('/'));
  let locales = [];
  if (existsSync(l10nAbs)) {
    locales = listDir(l10nAbs)
      .map((f) => f.match(/^app_([A-Za-z0-9_-]+)\.arb$/)?.[1])
      .filter((v) => typeof v === 'string')
      .map((v) => v.replace(/_/g, '-'))
      .sort();
  }
  // Gated on `problems.length === 0` like the other coverage checks added in
  // this pass: coverageLost exits immediately, so firing it while a specific
  // fault is already recorded replaces the precise message with a vague one and
  // sends the fix to the wrong file. Caught by its own regression test, where a
  // broken version-history walk was reported as a missing locale list.
  if (locales.length === 0 && problems.length === 0) {
    coverageLost(
      `no locale resolved from ${L10N_DIR}/app_<locale>.arb.`,
      'The app\'s own locale list IS the domain of this limb — it cannot be shrunk without deleting a',
      "locale, and deleting one fails the brick's own supportedLocales.length >= 2 property test. Zero",
      'locales means the derivation broke, and "every supported language has a notice" would then be',
      'vacuously true forever.',
    );
  }
  const current = archived.get(published) ?? new Map();
  const missing = locales.filter((l) => !current.has(l));
  for (const locale of locales) {
    const snap = current.get(locale);
    if (!snap) continue;
    if (snap.declared !== published) {
      problems.push(
        `${ARCHIVE_ROOT}/${published}/${locale}/${DOC} declares version ${snap.declared ?? '(none)'} while the ` +
          `English notice in force is ${published}. A translation of a superseded document, served as the current ` +
          'notice, is worse than no translation: the reader believes they have read the policy, and they have read ' +
          'a different one.',
      );
    }
  }
  if (missing.length) {
    prints.push(
      `NO NOTICE IN ${missing.join(', ')} (owner-gated, propose O-4) — the brick ships ${locales.length} locale(s) ` +
        `(${locales.join(', ')}) and version ${published} of the notice exists in ${[...current.keys()].sort().join(', ') || 'none'}. ` +
        `A reader whose app is in ${missing[0]} is asked to consent to a document they were never offered in a ` +
        'language they read. PRINTED, NOT FAILED: an unreviewed machine translation of a statutory notice is itself ' +
        `a legal-accuracy exposure, so the missing document needs native review before it is published. Put it at ` +
        `${ARCHIVE_ROOT}/${published}/<locale>/${DOC} — the archive key is already <version>/<locale>, so nothing ` +
        'has to migrate — and this limb becomes a version comparison that can fail.',
    );
  } else {
    prints.push(
      `PROMOTE ME: every locale the brick supports (${locales.join(', ')}) now has a notice for version ` +
        `${published}. The owner-gated print in this limb has nothing left to report — turn the missing-notice ` +
        'case into a build failure, so a NEW locale cannot ship without one.',
    );
  }
  localeSummary =
    `    notice locales — ${locales.length} supported (${locales.join(', ')}), ` +
    `${current.size} notice(s) at version ${published} [pipeline K-14]`;
}

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ policy archive — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline K-4] A consent record is only worth the bytes it can still point at.');
  process.exit(1);
}

console.log(
  `ok  policy archive — ${archived.size} version(s) snapshotted (${[...archived.keys()].sort().join(', ')}), ` +
    `covering every one of the ${historical.size} version(s) ever in force; ${published} matches ${LIVE_POLICY}`,
);
if (localeSummary) console.log(localeSummary);
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (a statutory notice needs a human translator; a guard cannot supply one) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
