// ─────────────────────────────────────────────────────────────────────────────
// worker-shared-modules.mjs — THE ONE READING OF "this Worker module was emptied
// into `services/_shared/src/`, and here is the file that now carries it".
//
// [ADR 067] decision 2 gives the Worker chassis one home. `health.ts` and
// `error-sink.ts` used to exist three times — `services/platform`,
// `services/subscriptiontracker-api` and the brick's Worker template — at 333/333/334 and
// 200/196 lines with different hashes. Each carrier is now a five-line
// re-export, and the property a path-pinned guard used to read at
// `services/<w>/src/lib/<m>.ts` moved with the body.
//
// 🔴 WHY A MODULE AND NOT A COPY IN EACH GUARD. `chassis-delegation.mjs`'s
// header records what the copy-per-guard version of exactly this idea cost on
// 2026-09-05: ten `delegationOf` bodies, seven distinct implementations by
// sha256, three signatures, nothing comparing them, and a one-line change to the
// rule costing twelve edits. `assert-guard-coverage.mjs` names the shape that
// answers it — "a shared pure-function module that every caller's own self-check
// already covers" — which is what `tree-walk.mjs` and `text-reductions.mjs`
// already are.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULE, STATED ONCE HERE:
//
//   A Worker module DELEGATES when, with comments stripped and lines trimmed,
//   its ENTIRE source is one `export * from '<relative path>';` whose target
//   resolves to a file under `services/_shared/src/`.
//
//   "ENTIRE", not "contains". A file that re-exports the shared home AND
//   declares one more thing of its own is a FORK WEARING A DELEGATION: it reads
//   as delegated to every guard that follows delegations, while the declaration
//   it added is judged by nobody. That is the failure `chassis-delegation.mjs`
//   was rewritten twice to close, arriving here already closed because a
//   TypeScript re-export has no body to hide anything in.
//
//   There are exactly THREE answers and the caller must keep them apart:
//     · `null`      — this file does not delegate. Judge it where it is.
//     · `{ lost }`  — it looks delegated and the delegation could not be
//                     followed. The caller reports COVERAGE LOST. Never `null`:
//                     a resolvable-looking import that resolves to nothing is
//                     dead code that reads exactly like a delegation, and
//                     answering "no delegation" is the silent-pass shape.
//     · `{ target, source }` — the repo-relative shared file, and its text.
//
// IT SCANS NOTHING AND OWNS NO COVERAGE CLAIM. Pure functions plus the one file
// read its caller asked for: paths in, an answer out. "Did my scan still reach
// the tree" belongs to the importers, each of which carries its own COVERAGE
// LOST over what it read and reports every `lost` this module returns.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { stripSourceComments } from './text-reductions.mjs';

/** The one home. Repo-relative, POSIX, no trailing slash. */
export const SHARED_DIR = 'services/_shared/src';

/** How many whole-file re-exports a delegation may pass through inside the home
 *  before it is COVERAGE LOST (carrier → home module → adapter is two). */
export const MAX_DELEGATION_HOPS = 4;

/** The one shape a delegation may take. Anchored at both ends on purpose — see
 *  the "ENTIRE, not contains" paragraph in the header. */
const WHOLE_FILE_REEXPORT = /^export\s+\*\s+from\s+'([^']+)';$/;

/** A `export * from '…_shared/…'` line sitting among OTHER code: the fork
 *  wearing a delegation. Line-anchored, so it cannot match inside a template. */
const STAR_REEXPORT_LINE = /^export\s+\*(\s+as\s+[A-Za-z_$][\w$]*)?\s+from\s+'([^']*_shared\/[^']*)';$/m;

/** A whole file that re-exports only PART of the shared home's surface. Also a
 *  fork: what it does not name is not this carrier's, and a guard following the
 *  delegation would certify a surface the carrier does not actually expose. */
const WHOLE_FILE_NAMED_REEXPORT = /^export\s*\{[^}]*\}\s*from\s*'([^']*_shared\/[^']*)';$/;

/**
 * 🔴 IMPORTING FROM THE SHARED HOME IS NOT DELEGATING TO IT, and conflating the
 * two was a real defect in this module's first version — caught by case R2 of
 * its own test on 2026-09-06, before either importer shipped.
 *
 * `services/platform/src/middleware/auth.ts` imports six names from
 * `services/_shared/src/auth.ts` and keeps its whole `jose`/`hono` body, because
 * `services/_shared/` can carry no bare import. A predicate that answered
 * `{ lost }` for "the text mentions _shared" would have made every guard reading
 * that file report COVERAGE LOST on a correct tree — and a limb that fires on
 * correct input is a limb somebody deletes.
 *
 * So the question is not "does this file mention the shared home" but "does this
 * file claim its BODY is there": a `export * from` line, or a whole file that is
 * one named re-export. An ordinary consumer answers `null` and is judged where
 * it stands, which is where its body is.
 */
function claimsItsBodyMoved(code) {
  return STAR_REEXPORT_LINE.test(code) || WHOLE_FILE_NAMED_REEXPORT.test(code);
}

/** Comments out, blank lines out, indentation out. Everything INSIDE a line is
 *  kept byte for byte, so a specifier is never silently normalised. */
function codeOnly(source) {
  return stripSourceComments(source, '.ts')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/**
 * Does `relFile` delegate to the shared home, and to what?
 *
 * @param repoRoot absolute path of the repository root
 * @param relFile  repo-relative path of the Worker's module
 * @returns null | { lost: string } | { target: string, source: string }
 */
export function sharedHomeOf(repoRoot, relFile) {
  const abs = join(repoRoot, ...relFile.split('/'));
  if (!existsSync(abs)) return null; // the caller already reports a missing file
  const code = codeOnly(readFileSync(abs, 'utf8'));
  const m = WHOLE_FILE_REEXPORT.exec(code);
  if (m === null) {
    if (!claimsItsBodyMoved(code)) return null;
    return {
      lost:
        `${relFile} claims its body moved to ${SHARED_DIR} but is not WHOLLY a re-export of it. Its code is ` +
        `${JSON.stringify(code.split('\n').join(' ⏎ ')).slice(0, 200)}. A file that delegates AND declares ` +
        'something of its own reads as delegated to every guard that follows delegations, while what it ' +
        'added is judged by nobody.',
    };
  }
  const spec = m[1];
  const rel = posix.normalize(`${posix.dirname(relFile)}/${spec}`);
  const candidates = [rel, `${rel}.ts`, `${rel}/index.ts`];
  const found = candidates.find((c) => {
    const p = join(repoRoot, ...c.split('/'));
    return existsSync(p) && statSync(p).isFile();
  });
  if (found === undefined) {
    return {
      lost:
        `${relFile} re-exports '${spec}', which resolves to no file (tried ${candidates.join(', ')}). ` +
        'The delegation cannot be followed, so nothing here is being checked.',
    };
  }
  if (found !== SHARED_DIR && !found.startsWith(`${SHARED_DIR}/`)) {
    return {
      lost:
        `${relFile} re-exports '${spec}', which resolves to \`${found}\` — outside ${SHARED_DIR}. This ` +
        'module answers only for the one shared home; a delegation anywhere else is a relationship nothing ' +
        'in this repository grades.',
    };
  }
  return { target: found, source: readFileSync(join(repoRoot, ...found.split('/')), 'utf8') };
}

/**
 * The source a guard should judge for `relFile`, and where it lives.
 *
 * The ordinary case is "this file, as it is". When the file is wholly a
 * re-export of the shared home, it is that home's path and text instead — the
 * body moved, so the property moved with it.
 *
 * @returns { relPath, source, delegated } | { lost: string }
 */
export function workerModuleSource(repoRoot, relFile) {
  const home = sharedHomeOf(repoRoot, relFile);
  if (home !== null && 'lost' in home) return home;
  if (home !== null) {
    // ⏱ 2026-10-01 (port-telemetry) — THE CHAIN IS FOLLOWED INSIDE THE HOME. A
    // shared module may itself be wholly a re-export of another shared module:
    // services/_shared/src/error-sink.ts now re-exports the telemetry port's
    // `sentry-envelope` adapter (adapters/telemetry/sentry-envelope.ts), where the
    // body moved. The property moves with the body, so the walk goes on to it —
    // bounded, every hop still inside SHARED_DIR (sharedHomeOf refuses any other),
    // and a cycle or an over-long chain is COVERAGE LOST, never a pass.
    let at = home;
    const visited = [relFile, at.target];
    for (;;) {
      const next = sharedHomeOf(repoRoot, at.target);
      if (next === null) break;
      if ('lost' in next) return next;
      if (visited.includes(next.target) || visited.length > MAX_DELEGATION_HOPS) {
        return {
          lost:
            `${relFile} delegates through ${visited.join(' → ')} → ${next.target}, which ${visited.includes(next.target) ? 'is a cycle' : `is longer than ${MAX_DELEGATION_HOPS} hops`}. ` +
            'No file in the chain holds a body, so nothing here is being checked.',
        };
      }
      visited.push(next.target);
      at = next;
    }
    return { relPath: at.target, source: at.source, delegated: true };
  }
  const abs = join(repoRoot, ...relFile.split('/'));
  if (!existsSync(abs)) {
    return { lost: `${relFile} does not exist, so there is nothing to read and nothing to certify.` };
  }
  return { relPath: relFile, source: readFileSync(abs, 'utf8'), delegated: false };
}
