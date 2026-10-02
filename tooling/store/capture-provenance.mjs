// ─────────────────────────────────────────────────────────────────────────────
// capture-provenance.mjs — WHICH COMMIT a store screenshot set photographed,
// and whether the screens it shows have changed since.
//
// Two callers, one reading: tooling/store/capture-play-screenshots.mjs writes
// `capturedSha` and `capturedAt` into every CAPTURE.json it records, and
// `tooling/ci/assert-listing-assets.mjs --for-submission` refuses a set whose
// screens moved after that commit. A private copy in either would be the
// second definition of "the screens this set shows" and the first to drift.
//
// ── WHY, 2026-10-01 (row O-STORE-SCREENSHOTS) ─
// The only committed sets (Play phone and tablet, and apps.gov.in derived from
// Play) were captured on 2026-09-22, before the truth pass (#1061 aa1fa424),
// the soft-cap removal (35da94b2) and the design foundation (b1f933ef) redrew
// the screens they show. CAPTURE.json recorded the posture, the board and the
// pixels, and NOT the commit, so nothing could tell a stale set from a fresh
// one: every guard passed a listing of screens the app no longer draws.
//
// ── WHAT "THE SCREENS IT SHOWS" MEANS HERE ──────────────────────────────────
// Each frame resolves to its screen's source file through capture-suite-scan
// .mjs (the suite asserts `find.byType(<Screen>)` on the line above every
// capture). The watched paths are each such file's DIRECTORY — a screen is
// drawn by its feature folder, not one file — plus the register's
// `storeMetadataContract.screenProvenance.alsoWatched` (the shared widgets, the
// strings and the design system every screen paints with). The foundation
// commit b1f933ef touched only packages/design_system/lib, which is why that
// is on the list.
//
// ── 🔴 CONTENT, NOT ANCESTRY ─────────────────────────────────────────────────
// "Older than the last commit touching the screens" is asked as `git diff
// --quiet <capturedSha> HEAD -- <watched>`: did any watched file change between
// the photographed commit and this one. Ancestry is the wrong question in a
// squash-merge repository: a PR that redraws a screen and re-captures it in the
// same branch photographs a branch commit, and the squash lands a NEW commit on
// main that is not its descendant, so an ancestry test would call the fresh set
// stale forever. The diff asks what a reader means.
//
// A `capturedSha` whose commit object is not in this clone (a shallow CI
// checkout, a deleted branch never fetched) cannot be compared, which is
// COVERAGE LOST, not a pass: `git fetch origin <sha>` brings it, since every PR
// head stays fetchable by id.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { posix } from 'node:path';

import { scanCaptureSuite } from './capture-suite-scan.mjs';

const git = (root, args) => {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), raw: r.stdout ?? '', err: (r.stderr ?? '').trim(), status: r.status };
};

/** The commit a capture run is photographing, and when. In CI that is
 *  GITHUB_SHA, which is the commit actions/checkout checked out; off CI it is
 *  HEAD, and any uncommitted change under the watched paths is recorded as
 *  `capturedTreeDirty`, because then the frames show a tree no commit holds. */
export function captureProvenance({ root, watched, env = process.env, now = new Date() }) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const capturedSha = env.GITHUB_SHA || (head.ok ? head.out : null);
  const out = { capturedSha, capturedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z') };
  if (!env.GITHUB_SHA && watched.length > 0) {
    // `-z`: one NUL-terminated "XY path" per entry, untrimmed — the status
    // columns are positional, and a trimmed " M path" loses its first letter.
    const dirty = git(root, ['status', '--porcelain', '-z', '--', ...watched]);
    const paths = dirty.ok ? dirty.raw.split('\0').filter((l) => l.length > 3).map((l) => l.slice(3)) : ['(git status failed)'];
    if (paths.length > 0) out.capturedTreeDirty = paths.slice(0, 20);
  }
  return out;
}

/** The repository-relative paths whose change makes a set of `frameNames`
 *  stale, or `{ unresolved }` naming the frames no screen could be found for. */
export function watchedPaths({ root, app, frameNames, rule }) {
  const scan = scanCaptureSuite({ root, app });
  const byFrame = new Map((scan.frames ?? []).map((f) => [f.frame, f.file]));
  const unresolved = frameNames.filter((n) => !byFrame.has(n));
  const dirs = new Set(frameNames.filter((n) => byFrame.has(n)).map((n) => posix.dirname(byFrame.get(n))));
  for (const p of rule?.alsoWatched ?? []) dirs.add(p.replaceAll('{app}', app));
  return { paths: [...dirs].sort(), unresolved, suitePresent: scan.present === true };
}

/** Whether the screens under `paths` changed between `sha` and HEAD.
 *  → { verdict: 'fresh' | 'stale' | 'unknown', changed?, why? } */
export function screensChangedSince({ root, sha, paths }) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
    return { verdict: 'unknown', why: `capturedSha ${JSON.stringify(sha ?? null)} is not a full commit id` };
  }
  if (!git(root, ['cat-file', '-e', `${sha}^{commit}`]).ok) {
    const shallow = git(root, ['rev-parse', '--is-shallow-repository']).out === 'true';
    return {
      verdict: 'unknown',
      why: `commit ${sha.slice(0, 12)} is not in this clone${shallow ? ' (it is SHALLOW)' : ''}; run \`git fetch origin ${sha}\` and re-run`,
    };
  }
  const diff = git(root, ['diff', '--name-only', sha, 'HEAD', '--', ...paths]);
  if (!diff.ok) return { verdict: 'unknown', why: `git diff ${sha.slice(0, 12)} HEAD failed: ${diff.err.split('\n')[0]}` };
  const changed = diff.out.split('\n').filter(Boolean);
  return changed.length === 0 ? { verdict: 'fresh' } : { verdict: 'stale', changed };
}
