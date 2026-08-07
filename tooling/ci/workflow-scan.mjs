#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// workflow-scan.mjs — ONE reading of "what does this workflow actually run".
//
// 🔴 THIS IS NOT A GUARD. It is the single implementation of the workflow parse
// that four guards need, and it lives here for the same reason
// tooling/ci/text-reductions.mjs does: the alternative is four copies that
// drift, and the FIRST thing that drifts in a workflow parser is which lines it
// can see at all — a failure that reports "clean".
//
// It was EXTRACTED from assert-release-provenance.mjs (2026-08-03) rather than
// written beside it. That guard's parser had already absorbed four recorded
// defects, each found the hard way, and a second implementation would inherit
// none of them:
//
//   · `run: >` folds ONE command over a dozen lines, so a line-anchored regex
//     sees `--build-number=${{` and nothing else (deploy-web.yml's release
//     build is written exactly that way).
//   · `run: |` is the OPPOSITE — each line is its own shell command — so those
//     are joined with ` ; ` and never with a space, or line one's `--dry-run`
//     exonerates line two's real deploy.
//   · `needs:` has THREE forms (flow, scalar, block) and QUOTED entries in all
//     three; missing the scalar form made a correctly-gated workflow look
//     ungated, and a "fix" on the strength of that would have been the defect.
//   · comments are BLANKED, not deleted, so reported line numbers still point
//     into the real file.
//
// ⚠️ IT SCANS NOTHING AND OWNS NO COVERAGE CLAIM. Every function here is a pure
// text transform over a path the caller chose. "Did my scan still reach the
// tree" belongs to the callers, each of which carries its own self-check over
// what it read — which is why the marker phrase assert-guard-coverage.mjs looks
// for is deliberately not written out in this file. That guard reaches this
// module through the import graph (a workflow runs the guards, the guards
// import this), so deleting the last import makes it unreached and FAILS,
// which is exactly when it has stopped being covered.
//
// It is FLAT in tooling/ci, not in a lib/ subdirectory: assert-guard-coverage
// treats any .mjs below tooling/ci as a guard that has escaped its scan.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';

export const WORKFLOW_DIR = '.github/workflows';

/**
 * LOGICAL LINES — a `run: >` block is ONE command that YAML happens to fold, so
 * its continuation lines are joined with a space before any pattern looks at
 * them. A `run: |` block is the opposite — each line is its OWN shell command —
 * so those lines are joined with ` ; `, a separator every segment splitter in
 * this repo already understands, and two commands can never blur into one.
 * The joined entry keeps the `run:` line's number, so a report still points
 * into the real file.
 */
export function joinBlockScalars(jobLines) {
  const out = [];
  for (let i = 0; i < jobLines.length; i++) {
    const line = jobLines[i];
    const m = line.text.match(/^(\s*)(?:-\s+)?run:\s*([|>])[+-]?[0-9]*\s*$/);
    if (!m) {
      out.push(line);
      continue;
    }
    const keyIndent = m[1].length;
    const parts = [];
    let contentIndent = null;
    let j = i + 1;
    while (j < jobLines.length) {
      const t = jobLines[j].text;
      if (t.trim() === '') {
        j++; // blank (or comment-blanked) lines are legal inside a block scalar
        continue;
      }
      const indent = t.match(/^ */)[0].length;
      if (contentIndent === null) {
        if (indent <= keyIndent) break;
        contentIndent = indent;
      }
      if (indent < contentIndent) break;
      parts.push(t.trim());
      j++;
    }
    out.push({ n: line.n, text: line.text.replace(/[|>][+-]?[0-9]*\s*$/, parts.join(m[2] === '>' ? ' ' : ' ; ')) });
    i = j - 1;
  }
  return out;
}

/**
 * Jobs, their `needs`, and every line inside them — with comments stripped but
 * LINE NUMBERS PRESERVED, so a reported line still points at the real file.
 * Blanking a comment rather than deleting it is what keeps those in step.
 *
 * Returns `null` when the file is not there, so a caller decides whether an
 * absent workflow is a coverage loss or simply not its business.
 *
 * `lines` is the WHOLE comment-blanked file, jobs and header alike, because a
 * workflow's `env:` and `defaults:` blocks sit ABOVE `jobs:` and are therefore
 * in none of the per-job line arrays. A caller that needs them would otherwise
 * re-read and re-strip the file itself — a second reduction, drifting from this
 * one in the way this module's header says such copies always drift: which
 * lines it can see. [pipeline 9]R-1 needs exactly that region to expand
 * `${{ env.X }}` before deciding which app a lane resolves to.
 */
export function parseWorkflow(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  const rawLines = raw.split('\n');
  const lines = rawLines.map((l) => (/^\s*#/.test(l) ? '' : l.replace(/\s#.*$/, '')));

  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = new Map();
  if (jobsAt !== -1) {
    let current = null;
    for (let i = jobsAt + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break;
      const m = lines[i].match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
      if (m) {
        current = m[1];
        jobs.set(current, { name: current, needs: [], lines: [], logical: [], jobIf: null, continueOnError: null, displayName: null });
      } else if (current !== null) {
        jobs.get(current).lines.push({ n: i + 1, text: lines[i] });
      }
    }
  }

  // 🔴 `needs:` HAS THREE FORMS AND THE FIRST VERSION PARSED ONLY TWO.
  // `deploy-workers.yml` writes the SCALAR form — `needs: detect` — and its two
  // deploy jobs are correctly gated through that dependency. Missing the scalar
  // form made a properly-wired production workflow look ungated, and "fixing"
  // the tree on the strength of that would have been the actual defect. Flow,
  // scalar, block — all three, or a graph walk over this is reading a lie.
  //
  // Triage 2026-07-31 (mutation-proven): all three forms must also strip
  // QUOTES. `needs: ["gate"]` is the same edge in YAML GitHub happily runs,
  // but reading the dep as `"gate"` — quotes included — made `jobs.get()` miss
  // and the walk silently drop the edge, so a correctly-gated workflow drew an
  // ungated complaint. A false red on a right tree is the scalar-form lesson
  // above, relearned one quoting level down.
  for (const job of jobs.values()) {
    const body = job.lines.map((l) => l.text).join('\n');
    const flow = body.match(/needs:\s*\[([^\]]*)\]/);
    const scalar = body.match(/^\s*needs:\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*$/m);
    if (flow) {
      job.needs = flow[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else if (scalar) {
      job.needs = [scalar[2]];
    } else {
      const idx = job.lines.findIndex((l) => /^\s*needs:\s*$/.test(l.text));
      if (idx !== -1) {
        for (const l of job.lines.slice(idx + 1)) {
          const m = l.text.match(/^\s*-\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*$/);
          if (!m) break;
          job.needs.push(m[2]);
        }
      }
    }

    // Job-level `if:` / `continue-on-error:` / `name:`. Job keys sit at exactly
    // 4 spaces (jobs at 2, steps at 6), so the ` {4}` anchor is what keeps a
    // STEP's `if:` — 8 spaces — from being mistaken for a job condition.
    // `continue-on-error` is taken at ANY depth on purpose: on a gate STEP it
    // swallows a red verdict inside the job, at job level it swallows it from
    // `needs` — either placement disarms the edge.
    for (const l of job.lines) {
      let m;
      if (job.jobIf === null && (m = l.text.match(/^ {4}if:\s*(\S.*?)\s*$/))) job.jobIf = { n: l.n, cond: m[1] };
      if (job.continueOnError === null && /^\s*continue-on-error:\s*true\b/.test(l.text)) job.continueOnError = { n: l.n };
      if (job.displayName === null && (m = l.text.match(/^ {4}name:\s*(\S.*?)\s*$/))) job.displayName = m[1].replace(/^['"]|['"]$/g, '');
    }

    job.logical = joinBlockScalars(job.lines);
  }

  const rawStepCount = (raw.match(/^\s+-\s+(name|run|uses):/gm) ?? []).length;
  const strippedStepCount = lines.join('\n').match(/^\s+-\s+(name|run|uses):/gm)?.length ?? 0;
  return {
    rel,
    jobs,
    rawStepCount,
    strippedStepCount,
    lines: lines.map((text, i) => ({ n: i + 1, text })),
    jobsAt: jobsAt === -1 ? null : jobsAt + 1,
  };
}

/** Every workflow under `.github/workflows`, parsed, sorted by filename. */
export function parseAllWorkflows(root) {
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) return [];
  return listDir(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => parseWorkflow(root, `${WORKFLOW_DIR}/${f}`))
    .filter(Boolean);
}

/** Shell command segments of one logical line. `&&`, `||`, `;` and `|` all end
 *  a command, so each segment answers for itself — a `--dry-run` on one segment
 *  must never exonerate a real publish on the next. */
export const shellSegments = (text) => text.split(/&&|\|\||[;|]/);

// ─────────────────────────────────────────────────────────────────────────────
// THE `record-deployment.mjs <env>` CALL SITE — one reader, three callers.
//
// 🔴 THERE WERE FOUR COPIES OF THIS REGEX and they did not agree. [10]D-2b made
// `deploy-web.yml` a matrix over the workspace app set (2026-08-07), so its
// record step reads `record-deployment.mjs ${{ matrix.app }}-web`, and each copy
// broke DIFFERENTLY on that one line:
//   · assert-publish-records.mjs's `[A-Za-z0-9._{}$-]+` stopped at the space
//     inside the expression and produced the environment `${{`, so the required
//     `<app>-web` matched nothing and a correctly-recording lane was reported as
//     never recording — a FALSE RED, the kind that gets a guard switched off;
//   · assert-ops-register.mjs's `[A-Za-z0-9._-]+` matched NOTHING, so the job
//     left [14]O-7's domain entirely: five deploy jobs became four and the
//     guard printed the smaller number as a pass — a SILENT SHRINK, which is
//     strictly worse;
//   · deployment-record.test.mjs's copy did the same and tripped its own
//     "have I lost sight of the workflows" floor, which is the only reason the
//     third copy was found at all.
// Three readings of one line, two of them wrong in opposite directions. The
// repair is not a wider character class in three files.
// ─────────────────────────────────────────────────────────────────────────────

/** Every `record-deployment.mjs <env>` call in a blob of workflow text, with the
 *  environment argument AS WRITTEN. Whole `${{ … }}` expressions are part of the
 *  token because they legally contain spaces. Global — callers use `matchAll`. */
export const RECORD_CALL = /record-deployment\.mjs\s+((?:\$\{\{[^}]*\}\}|[A-Za-z0-9._-])+)/g;

/**
 * A matrix-parameterised environment, expanded over the app set: with
 * `appSlugs = ['subly']`, `${{ matrix.app }}-web` → `['subly-web']`. Anything
 * else is returned unchanged, so a literal environment costs nothing.
 *
 * ⚠️ IT DOES NOT CHECK THE MATRIX KEY IS DECLARED. GitHub expands an undeclared
 * matrix context to the EMPTY STRING rather than erroring, and limb A′ of
 * assert-release-lane-generic.mjs fails the build on exactly that for every
 * graded lane, on every run. This is the shared READER; that is the check.
 */
export function expandMatrixEnvironment(raw, appSlugs) {
  const m = raw.match(/^\$\{\{\s*matrix\.[A-Za-z_][A-Za-z0-9_-]*\s*\}\}(.*)$/);
  if (!m) return [raw];
  return (appSlugs ?? []).map((s) => `${s}${m[1]}`);
}
