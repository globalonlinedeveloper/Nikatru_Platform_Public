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

/** The event names in a workflow's `on:`, as a Set. Both YAML forms: the flow
 *  form `on: [push, pull_request]` and the block form with indented event keys.
 *
 *  ⏱ ADDED 2026-09-08, MOVED HERE RATHER THAN WRITTEN AGAIN. This was a private
 *  limb of `assert-app-dod.mjs`'s own `parseWorkflow`, which is being retired into
 *  this module — and it could not come along as a caller-side re-parse without
 *  becoming the thing this file exists to prevent. The region it reads sits ABOVE
 *  `jobs:`, which is exactly why `parseWorkflow` returns the WHOLE comment-blanked
 *  file as `lines`: so a caller needing `on:` / `env:` / `defaults:` does not
 *  re-read and re-strip the file with a second reduction that drifts from this one.
 *  It takes the PARSED object for that reason, never a path — there is one read of
 *  a workflow in this tree and this is a view over it, not a second one.
 *
 *  ⚠️ THE FLOW FORM IS SINGLE-LINE, and that is inherited rather than chosen: the
 *  limb this replaces matched `/^on:\s*\[([^\]]*)\]/m`, so a flow list broken over
 *  two lines was already invisible to it. Stated rather than silently carried —
 *  widening it is a behaviour change that needs its own case, and no workflow in
 *  this repository writes one today.
 *
 *  ⚠️ AND `on` IS A YAML 1.1 BOOLEAN. A schema-aware loader reads the key `on:` as
 *  `true`, which is one of the reasons this whole module is line-anchored text
 *  rather than a YAML load: the shape GitHub actually reads is the shape on disk. */
export function workflowEvents(parsed) {
  const events = new Set();
  if (parsed === null) return events;
  const lines = parsed.lines;
  for (let i = 0; i < lines.length; i += 1) {
    const flow = lines[i].text.match(/^on:\s*\[([^\]]*)\]/);
    if (flow) { for (const e of flow[1].split(',')) { const t = e.trim(); if (t) events.add(t); } continue; }
    if (!/^on:\s*$/.test(lines[i].text)) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\S/.test(lines[j].text)) break;
      const m = lines[j].text.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):/);
      if (m) events.add(m[1]);
    }
  }
  return events;
}

/**
 * The `tags:` filter under `on: push:`, or null: `{ line, items }`, where `line`
 * is the 1-based line of the `tags:` key and `items` is every pattern it lists,
 * in file order, as `{ n, pattern }` with the YAML quotes removed. All three YAML
 * forms are read: flow (`tags: ['a', 'b']`), scalar (`tags: a`) and block (one
 * `- a` per line below the key).
 *
 * Parsed by INDENT rather than matched with one regex over the whole header:
 * `on:` legitimately holds `workflow_dispatch`, `schedule` and blanked comment
 * lines between the `push:` key and its `tags:` child (build-platforms.yml has
 * all three), and a single regex either tolerates that by being loose enough to
 * match a `tags:` belonging to some other trigger, or is strict enough to miss
 * the real one. `tags-ignore:` is deliberately NOT a release trigger — it is an
 * exclusion.
 *
 * ⏱ MOVED HERE 2026-09-22 from assert-release-durable.mjs (it was that guard's
 * `releaseTriggerLine`, returning the line only), because tooling/ci/tag-owner.mjs
 * needs the same reading AND the patterns, and a second reader of the same
 * three lines is the drift this module exists to prevent. The guard imports
 * `releaseTriggerLine` below, which is this function's `line`.
 */
export function releaseTrigger(wf) {
  return triggerFilter(wf, 'push', 'tags');
}

/**
 * The `branches:` filter under `on: push:`, or null — the same `{ line, items }`
 * shape as releaseTrigger, read by the same indent walk.
 *
 * ⏱ ADDED 2026-09-23 for tooling/ops/redeploy-stranded.mjs, which derives the
 * set of DEPLOY LANES a red ci-gate can strand (push to main + a gate step)
 * from the workflow files instead of listing them. Here rather than there for
 * the reason releaseTrigger moved here: one reading of `on: push:`.
 */
export function pushBranches(wf) {
  return triggerFilter(wf, 'push', 'branches');
}

/**
 * The `workflows:` list under `on: workflow_run:`, or null. Same shape again.
 * Read by redeploy-stranded.mjs to hold the recovery lane's trigger to the
 * deploy lanes it is meant to hear — derived set on one side, declared list on
 * the other, compared by the test rather than trusted.
 */
export function workflowRunSources(wf) {
  return triggerFilter(wf, 'workflow_run', 'workflows');
}

/**
 * The 1-based line of the `inputs:` key under `on: workflow_dispatch:`, or null
 * when the dispatch takes none (or the workflow is not dispatchable at all).
 *
 * ⏱ ADDED 2026-09-23 for tooling/ops/redeploy-stranded.mjs, whose re-entry is a
 * dispatch that POSTs `{ref: 'main'}` and nothing else. A lane that declares
 * inputs is never reproduced by that POST — and inputs are how every store
 * publish in this tree takes the owner's word (assert-publish-steps-guarded.mjs
 * limb 2), so "declares no inputs" is what keeps a publisher out of that tool's
 * lane set by structure rather than by a list. Read by the same indent walk as
 * `on: push: branches:`: the key is the event's own child, never a deeper one.
 */
export function dispatchInputs(wf) {
  const lines = wf.lines.slice(0, wf.jobsAt ?? wf.lines.length);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(/^(\s*)workflow_dispatch:\s*$/);
    if (!m) continue;
    let child = null;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') continue;
      const at = t.match(/^ */)[0].length;
      if (at <= m[1].length) break;
      child ??= at;
      if (at === child && /^\s*inputs:/.test(t)) return lines[j].n;
    }
  }
  return null;
}

/** `on: <event>: <key>:` as `{ line, items }`, or null. One indent walk for all
 *  three readers above; the event key is matched at any indent above `jobs:`,
 *  which is where every workflow in this tree writes its `on:` block. */
function triggerFilter(wf, event, key) {
  const lines = wf.lines.slice(0, wf.jobsAt ?? wf.lines.length);
  const eventRe = new RegExp(`^(\\s*)${event}:\\s*$`);
  const keyRe = new RegExp(`^(\\s*)${key}:(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(eventRe);
    if (!m) continue;
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') continue;
      if (t.match(/^ */)[0].length <= indent) break;
      const k = t.match(keyRe);
      if (!k) continue;
      return { line: lines[j].n, items: tagItems(lines, j, k[1].length, k[2].trim()) };
    }
  }
  return null;
}

/** The line of the `tags:` filter under `on: push:`, or null. See releaseTrigger. */
export function releaseTriggerLine(wf) {
  const t = releaseTrigger(wf);
  return t === null ? null : t.line;
}

const unquote = (s) => {
  const v = s.trim();
  const q = v.match(/^'(.*)'$/) ?? v.match(/^"(.*)"$/);
  return q ? q[1] : v;
};

function tagItems(lines, at, keyIndent, rest) {
  const n = lines[at].n;
  if (rest.startsWith('[')) {
    const body = rest.replace(/^\[/, '').replace(/\]\s*$/, '');
    return body.split(',').map((s) => unquote(s)).filter((s) => s !== '').map((pattern) => ({ n, pattern }));
  }
  if (rest !== '') return [{ n, pattern: unquote(rest) }];
  const items = [];
  for (let j = at + 1; j < lines.length; j++) {
    const t = lines[j].text;
    if (t.trim() === '') continue;
    if (t.match(/^ */)[0].length <= keyIndent) break;
    const m = t.match(/^\s*-\s+(.*)$/);
    if (!m) break;
    items.push({ n: lines[j].n, pattern: unquote(m[1]) });
  }
  return items;
}

/**
 * ONE reading of a GitHub branch/tag filter pattern, as an anchored RegExp.
 * The leading `!` of a negative pattern is NOT part of the body: pass the
 * pattern whole to refFilterMatches, which applies the ordering rule.
 *
 *   `*`   zero or more characters, never `/`
 *   `**`  zero or more of any character
 *   `?`   zero or one of the PRECEDING character (or bracket class)
 *   `+`   one or more of the PRECEDING character (or bracket class)
 *   `[]`  one character listed in the brackets, ranges a-z / A-Z / 0-9 only
 *   `\`   the next character is literal
 * Every other character, `.` included, is itself.
 *
 * 🔴 NOT `globToRe` in assert-deploy-triggers.mjs. That one is a path glob: it
 * escapes `+` and `[`, so `[0-9]+` — the shape the extension lane's tag filter
 * is written in — matches nothing, and it reads `?` as "any one character",
 * which is the shell's meaning and not GitHub's. A pattern this cannot read is
 * THROWN, never guessed: a matcher that quietly reads an unknown shape as a
 * literal is how a filter that fires on everything reads as one that fires on
 * nothing.
 */
export function refFilterToRegExp(pattern) {
  const src = String(pattern).replace(/^!/, '');
  if (src === '') throw new Error(`ref filter "${pattern}" is empty`);
  const atoms = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '*') {
      if (src[i + 1] === '*') {
        atoms.push('.*');
        i++;
      } else {
        atoms.push('[^/]*');
      }
    } else if (c === '?' || c === '+') {
      if (atoms.length === 0) throw new Error(`ref filter "${pattern}" starts with "${c}", which quantifies nothing`);
      atoms[atoms.length - 1] = `(?:${atoms[atoms.length - 1]})${c}`;
    } else if (c === '[') {
      const end = src.indexOf(']', i + 1);
      if (end === -1) throw new Error(`ref filter "${pattern}" opens "[" at ${i} and never closes it`);
      const body = src.slice(i + 1, end);
      if (!/^(?:[a-z]-[a-z]|[A-Z]-[A-Z]|[0-9]-[0-9]|[A-Za-z0-9])+$/.test(body)) {
        throw new Error(`ref filter "${pattern}" has the class "[${body}]", which is not alphanumerics and a-z / A-Z / 0-9 ranges`);
      }
      atoms.push(`[${body}]`);
      i = end;
    } else if (c === '\\') {
      if (i + 1 >= src.length) throw new Error(`ref filter "${pattern}" ends in an escape that escapes nothing`);
      atoms.push(src[i + 1].replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'));
      i++;
    } else {
      atoms.push(c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'));
    }
  }
  return new RegExp(`^${atoms.join('')}$`);
}

/**
 * Does a filter LIST select `name`? GitHub's ordering rule: the patterns are
 * read in order, a positive match selects, a later `!pattern` match deselects,
 * and a later positive match selects again. A list of negatives alone selects
 * nothing.
 */
export function refFilterMatches(patterns, name) {
  let selected = false;
  for (const p of patterns) {
    const negative = String(p).startsWith('!');
    if (refFilterToRegExp(p).test(name)) selected = !negative;
  }
  return selected;
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

/**
 * THE SHELL A STEP'S `run:` ACTUALLY RUNS UNDER, for the step holding line
 * `lineNo` of a parsed workflow. GitHub's order: the step's own `shell:`, else
 * the job's `defaults.run.shell`, else the workflow's, else the RUNNER's
 * default — `pwsh` on a Windows runner, `bash` on a Linux or macOS one.
 *
 * Returns `{ shell, family, from, n }`: `shell` as written, `family` its first
 * word (`bash -e {0}` is `bash`), `from` which of the four decided it, and `n`
 * the line that decided it. A shell this cannot name comes back as
 * `{ shell: null, family: null, from: 'unknown', n, why }` — never a guess.
 *
 * ⏱ ADDED 2026-09-23. submit-windows-store.yml's [10]D-9 recorder step declared
 * no `shell:` inside a `runs-on: windows-2025` job, so it ran under pwsh. There
 * the bash-written `"$LISTING_URL"` is an unset PowerShell VARIABLE, not the
 * step's `env:` entry: the recorder got no listing URL and exited 1 before any
 * POST, so the first real Store submission would have been recorded nowhere.
 * The test that read that step looked only for an explicit `shell:` key, and a
 * missing key read as "a plain shell". A missing key IS a shell, chosen by the
 * runner, so the runner is part of the answer.
 *
 * ⚠️ A `runs-on:` that is an expression, a block (`group:` / `labels:`), or a
 * label set naming no OS is UNKNOWN when nothing above it declares a shell. The
 * caller decides what a shell nobody can name means for its own question.
 */
export function stepShell(wf, lineNo) {
  const unknown = (why) => ({ shell: null, family: null, from: 'unknown', n: lineNo, why });
  const job = [...wf.jobs.values()].find((j) => j.lines.some((l) => l.n === lineNo));
  if (!job) return unknown(`line ${lineNo} is in no job`);
  const named = (shell, from, n) => ({ shell, family: shell.split(/\s+/)[0], from, n });
  const lines = job.lines;
  const at = lines.findIndex((l) => l.n === lineNo);
  // The step, by the module's one step-boundary rule (stepItemAround), so a line
  // inside a `run: |` block resolves to the step that runs it.
  const item = stepItemAround(lines, at);
  if (item) {
    for (let j = item.start; j < item.end; j++) {
      const sh = lines[j].text.replace(/^(\s*)-\s/, '$1  ').match(/^(\s+)shell:\s*(\S.*?)\s*$/);
      if (sh && sh[1].length === item.indent + 2) return named(unquote(sh[2]), 'step', lines[j].n);
    }
  }
  const jobDefault = defaultsShell(lines, 4);
  if (jobDefault) return named(jobDefault.shell, 'job defaults', jobDefault.n);
  const wfDefault = defaultsShell(wf.lines.slice(0, wf.jobsAt ?? wf.lines.length), 0);
  if (wfDefault) return named(wfDefault.shell, 'workflow defaults', wfDefault.n);
  const runsOn = lines.find((l) => /^ {4}runs-on:/.test(l.text));
  if (!runsOn) return unknown(`job "${job.name}" has no runs-on`);
  const label = runsOn.text.replace(/^ {4}runs-on:\s*/, '').trim();
  if (label === '' || /\$\{\{/.test(label)) {
    return unknown(`job "${job.name}" runs on \`${label || '(a block)'}\`, which names its runner only at run time, and no shell is declared`);
  }
  const from = `runner default, runs-on: ${label}`;
  if (/windows/i.test(label)) return named('pwsh', from, runsOn.n);
  if (/ubuntu|macos|linux/i.test(label)) return named('bash', from, runsOn.n);
  return unknown(`job "${job.name}" runs on \`${label}\`, which names no OS, and no shell is declared`);
}

/** `defaults: run: shell:` among `lines`, the `defaults:` key at `base`
 *  spaces, as `{ shell, n }` — or null. Block and flow forms. A `defaults.run`
 *  that sets only `working-directory` declares no shell. */
function defaultsShell(lines, base) {
  const indent = (t) => t.match(/^ */)[0].length;
  const flow = (text) => text.match(/shell:\s*([^,}]+?)\s*[,}]/);
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].text.match(/^( *)defaults:\s*(.*?)\s*$/);
    if (!d || d[1].length !== base) continue;
    if (d[2].startsWith('{')) {
      const f = flow(d[2]);
      return f ? { shell: unquote(f[1]), n: lines[i].n } : null;
    }
    let runIndent = null;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') continue;
      const at = indent(t);
      if (at <= base) break;
      if (runIndent !== null && at <= runIndent) runIndent = null;
      const r = t.match(/^( *)run:\s*(.*?)\s*$/);
      if (r && runIndent === null) {
        if (r[2].startsWith('{')) {
          const f = flow(r[2]);
          if (f) return { shell: unquote(f[1]), n: lines[j].n };
          continue;
        }
        runIndent = r[1].length;
        continue;
      }
      const s = runIndent !== null && t.match(/^\s*shell:\s*(\S.*?)\s*$/);
      if (s && at > runIndent) return { shell: unquote(s[1]), n: lines[j].n };
    }
    return null;
  }
  return null;
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

// 🔴 AND IT DROPPED A SECOND JOB THE SAME WAY, FOUND 2026-08-26. The class above
// admitted neither `"` nor `$`, so build-platforms.yml's release job —
//     node tooling/ci/record-deployment.mjs "$environment" "$RELEASE_URL"
// looping over `release-manifest.mjs --emit-environments` — matched NOTHING, and
// assert-ops-register.mjs's `if (envs.length === 0) continue;` dropped it out of
// [14]O-7's domain in silence, exactly as the matrix leg had. The reader was
// widened for `${{ … }}` and never for a shell variable, and that `continue` was
// never turned into a floor — so the same regex-and-continue pair did the same
// thing to a different job. Both halves are repaired: the token below admits a
// shell variable, and that `continue` is now a coverage floor.
//
// ⚠️ A SHELL VARIABLE IS NOT A SURFACE NAME. `$environment` holds its value only
// when the job runs, so this reader returns it AS WRITTEN and the guard that owns
// the domain decides what an unresolvable one means. Seeing the call and being
// unable to name its environment is a state a reader can report; not seeing the
// call at all is not.

/** Every `record-deployment.mjs <env>` call in a blob of workflow text, with the
 *  environment argument AS WRITTEN. Whole `${{ … }}` expressions are part of the
 *  token because they legally contain spaces, and a shell variable — `$e`,
 *  `${e}`, or either wrapped in quotes the shell strips — is part of it because a
 *  reader that cannot see the call cannot report anything about it. Global —
 *  callers use `matchAll`. */
export const RECORD_CALL =
  /record-deployment\.mjs\s+['"]?((?:\$\{\{[^}]*\}\}|\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z0-9._-])+)['"]?/g;

/** True when an environment token is a SHELL variable, whose value exists only
 *  when the job runs. Deliberately NOT the same thing as a `${{ … }}` matrix leg,
 *  which `expandMatrixEnvironment` resolves against a list this repository holds;
 *  the lookahead is what keeps the two apart. */
export const isShellVariableEnvironment = (raw) => /\$(?!\{\{)/.test(String(raw ?? ''));

/**
 * A matrix-parameterised environment, expanded over the app set: with
 * `appSlugs = ['subscriptiontracker']`, `${{ matrix.app }}-web` → `['subscriptiontracker-web']`. Anything
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

// ─────────────────────────────────────────────────────────────────────────────
// THE RELEASE-BUILD CENSUS — one reading of "which binaries does this factory
// actually produce", ⏱ ADDED 2026-09-22 (O-STORE-BUILD-GUARD-GRADES-DECLARED-
// JOBS-ONLY, O-SEAMS-WIRED-GRADES-DECLARED-LANES-ONLY, O-DIRECT-DOWNLOADS-
// NEVER-GRADED — three rows, one defect).
//
// 🔴 THREE GUARDS TOOK THEIR SUBJECT FROM THE JOB A REGISTER ROW NAMED, and the
// register's own `_why` says that field "NAMES THE DRY RUN AND IS A FLOOR, NOT A
// CENSUS". So each of them graded a floor and printed a census:
//   · assert-store-build-config walked `row.lane` and `row.submission`, so the
//     `submit` jobs of submit-play, submit-snap and submit-windows-store — the
//     jobs that build and UPLOAD the bundle a store receives — were graded by
//     nobody. Measured on a scratch extract: deleting SUPABASE_URL from
//     submit-play.yml#submit left it green.
//   · assert-seams-wired read `lane` ONLY, so every submission job was outside
//     its domain too, and it matched the define anywhere in the job BODY, so a
//     sibling step's define exonerated a build that carried none.
//   · assert-channel-register 6b-ii had a third, raw line scan of its own.
// A census keyed on what each BUILD declares — its RELEASE_CHANNEL stamp — has
// no floor to mistake for a domain: a job nobody names is graded exactly like a
// declared one, and a build that must not be graded has to be written down.
//
// ⚠️ IT IS STILL NOT A GUARD. `gradeDomain` returns the split; whether an empty
// `graded` set is COVERAGE LOST, and what a finding costs, belongs to each
// caller — as does the floor on how much it expected to see.
// ⏱ 2026-09-24: `defineValueIn` reads a define's VALUE per segment, for the reader that needs more than its name.
// ─────────────────────────────────────────────────────────────────────────────

/** `flutter build <target>` — a release build unless it says otherwise.
 *  `web-server` is a dev server, not an artifact. */
export const RELEASE_BUILD = /flutter\s+build\s+(?!web-server\b)(\S+)/;

/** Flutter builds RELEASE by default, so only an explicit flag takes a build out
 *  of the domain. Lifted from assert-channel-register.mjs 6b-ii, which is now one
 *  of this census's readers rather than its own third scan. */
export const NOT_RELEASE_BUILD = /--(?:debug|profile)(?=\s|$)/;

/** The channel a build compiles into itself. It is a fact ABOUT the binary. */
export const RELEASE_CHANNEL_STAMP = /--dart-define(?:=|\s+)RELEASE_CHANNEL=(\S+)/;

/** `flutter build <target>` → the platform it produces for. Lifted from
 *  assert-store-build-config.mjs's TARGET_PLATFORM so that "which platform is
 *  this" has one answer and not one per guard. */
export const BUILD_TARGET_PLATFORM = new Map([
  ['web', 'web'],
  ['apk', 'android'],
  ['appbundle', 'android'],
  ['ios', 'ios'],
  ['ipa', 'ios'],
  ['macos', 'macos'],
  ['windows', 'windows'],
  ['linux', 'linux'],
]);

// `unquote` is the module's one (above, beside tagItems): a PAIRED quote is
// stripped, a stray one is kept. A second definition here was a SyntaxError the
// day tag-owner's reader landed beside it — two helpers, one name, one module.

/** Every `--dart-define=NAME=` NAME in one shell segment, as a Set.
 *
 *  🔴 NO `#` BEFORE THE MATCH. A define behind a comment marker is prose, not a
 *  flag — and inside a folded `run: >` block that `#` is a SHELL comment that
 *  swallows the rest of the command. assert-seams-wired carries the scar: its
 *  raw-text match counted a commented-out define as supplied, and the shipped
 *  build initialised the no-op crash client with the guard printing ok. The
 *  segment is cut at the first `#` before the names are read. */
export function definesIn(segment) {
  const live = String(segment ?? '').split('#')[0];
  const out = new Set();
  for (const m of live.matchAll(/--dart-define(?:=|\s+)([A-Za-z_][A-Za-z0-9_]*)=/g)) out.add(m[1]);
  return out;
}

/** The VALUE one shell segment passes for `--dart-define=<name>=`, unquoted, or
 *  null when the segment passes no such define. `''` means the define is there
 *  with nothing in it — `NAME=`, `NAME=""` and `NAME=''` all read as `''`.
 *
 *  🔴 A NAME IS NOT A VALUE. `definesIn` answers "is the flag passed", and an
 *  empty `GLITCHTIP_DSN=` is passed: ci.yml's exempt android-artifacts builds
 *  carry exactly that, which is the NoOp crash client the seams-wired limb exists
 *  to catch. So that limb reads the value, cut at the first `#` as `definesIn`
 *  cuts — a define behind a comment marker is prose, and reads as null. */
export function defineValueIn(segment, name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw new Error(`defineValueIn: "${name}" is not a dart-define name`);
  const live = String(segment ?? '').split('#')[0];
  // A `${{ … }}` expression holds spaces, so it is read whole before the bare `\S*`.
  const m = live.match(new RegExp(`--dart-define(?:=|\\s+)${name}=("[^"]*"|'[^']*'|\\$\\{\\{.*?\\}\\}\\S*|\\S*)`));
  return m === null ? null : unquote(m[1]);
}

/**
 * EVERY RELEASE `flutter build` IN EVERY WORKFLOW, one record per shell SEGMENT.
 *
 * ⚠️ PER SEGMENT, NOT PER LOGICAL LINE, and that is the point. A `run: |` block
 * is joined with ` ; `, so two builds can share one logical line; a reader that
 * tests the whole line lets the first build's defines answer for the second.
 * Measured at f88912e5: deleting SUPABASE_URL from the aab step of
 * build-platforms.yml left assert-store-build-config green, because the apk step
 * beside it still carried one.
 *
 * `parsed` is accepted so a caller that already holds `parseAllWorkflows(root)`
 * does not pay for a second parse — two parses of one tree are two answers
 * waiting to disagree, which is this module's whole reason for existing.
 *
 * @returns {{workflow: string, job: string, runLine: number, segment: string,
 *            target: string, platform: string|null, stamp: string|null,
 *            defines: Set<string>}[]}
 */
export function flutterReleaseBuilds(root, parsed = null) {
  const workflows = parsed ?? parseAllWorkflows(root);
  const out = [];
  for (const wf of workflows) {
    for (const job of wf.jobs.values()) {
      for (const l of job.logical) {
        for (const seg of shellSegments(l.text)) {
          const m = RELEASE_BUILD.exec(seg);
          if (!m || NOT_RELEASE_BUILD.test(seg)) continue;
          const target = unquote(m[1]);
          const stamp = RELEASE_CHANNEL_STAMP.exec(seg);
          out.push({
            workflow: wf.rel,
            job: job.name,
            runLine: l.n,
            segment: seg,
            target,
            platform: BUILD_TARGET_PLATFORM.get(target) ?? null,
            stamp: stamp === null ? null : unquote(stamp[1]),
            defines: definesIn(seg),
          });
        }
      }
    }
  }
  return out;
}

/** Where a build is, written the one way every reader prints it. */
export const buildAt = (b) => `${b.workflow}:${b.runLine} (job "${b.job}", \`flutter build ${b.target}\`)`;

// ─────────────────────────────────────────────────────────────────────────────
// THE STEP READERS AND THE LIVE-DRIVE CENSUS — ⏱ ADDED 2026-09-23 for
// tooling/ci/assert-live-writer-provenance.mjs ([pipeline B-17]).
//
// A live `flutter drive` against production writes consent rows stamped with the
// build's APP_VERSION, and the purge after it must be handed the settings that
// find those rows. Both facts sit in STEP keys (`env:`, `if:`, `run:`) and in
// `$GITHUB_ENV` writes, so the guard needs steps as records, not lines.
//
// ⚠️ ONE STEP-BOUNDARY RULE. stepShell (above) walked its own step boundary
// inline; it now calls stepItemAround, and so does workflowSteps. Two walks of
// "where does this step end" would be two answers to one question.
//
// ⚠️ STILL NOT A GUARD. Pure text transforms over the parse; what an empty census
// means belongs to the caller.
// ─────────────────────────────────────────────────────────────────────────────

const indentOf = (t) => t.match(/^ */)[0].length;
const isStepItem = (t) => /^\s*-\s/.test(t);

/** The `- ` sequence item holding job line index `at`: the nearest item at or
 *  above it and shallower than it (the line itself when it is one). `end` is the
 *  first later non-blank line at or below the item's indent (exclusive). Null
 *  when the line sits in no item. */
export function stepItemAround(lines, at) {
  if (!Array.isArray(lines) || at < 0 || at >= lines.length) return null;
  const self = lines[at].text;
  let start = at;
  if (!isStepItem(self)) while (start > 0 && !(isStepItem(lines[start].text) && indentOf(lines[start].text) < indentOf(self))) start -= 1;
  if (!isStepItem(lines[start].text)) return null;
  const indent = indentOf(lines[start].text);
  let end = start + 1;
  while (end < lines.length && !(lines[end].text.trim() !== '' && indentOf(lines[end].text) <= indent)) end += 1;
  return { start, end, indent };
}

/** `KEY: value` entries directly below a mapping key, as Map KEY → {n, value}.
 *  Paired quotes are stripped; a `${{ … }}` value is kept verbatim.
 *
 *  `inputs: true` reads an action's `with:` instead of an `env:`, which differs in
 *  two ways. Its keys carry hyphens (`if-no-files-found`, `retention-days`). And a
 *  value may continue on deeper-indented lines: `path: |` (each line joined with a
 *  newline), `path: >` (joined with a space), or a plain scalar wrapped onto the
 *  next line (joined with a space). Those continuation lines belong to the key, so
 *  the value is what the action receives, not the key line's `|`. */
function mappingBelow(lines, from, to, keyIndent, { inputs = false } = {}) {
  const out = new Map();
  const KEY = inputs ? /^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/ : /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/;
  let childIndent = null;
  for (let j = from; j < to; j++) {
    const t = lines[j].text;
    if (t.trim() === '') continue;
    const at = indentOf(t);
    if (at <= keyIndent) break;
    if (childIndent === null) childIndent = at;
    if (at !== childIndent) continue;
    const m = t.match(KEY);
    if (!m) continue;
    if (!inputs) {
      out.set(m[1], { n: lines[j].n, value: unquote(m[2]) });
      continue;
    }
    const more = [];
    for (let k = j + 1; k < to; k++) {
      const c = lines[k].text;
      if (c.trim() === '') continue;
      if (indentOf(c) <= childIndent) break;
      more.push(c.trim());
    }
    const block = m[2].match(/^([|>])(?:[+-]?[0-9]?|[0-9][+-])$/);
    const value = block ? more.join(block[1] === '|' ? '\n' : ' ') : more.length ? [m[2], ...more].join(' ') : unquote(m[2]);
    out.set(m[1], { n: lines[j].n, value });
  }
  return out;
}

/** A one-line flow mapping — `with: { fetch-depth: 0, persist-credentials: false }` —
 *  as the same Map KEY → {n, value}, every entry at the `with:` line. A comma or a
 *  brace inside quotes or inside a `${{ … }}` expression does not split an entry. */
function flowMapping(text, n) {
  const out = new Map();
  const body = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  const entries = [];
  let depth = 0;
  let quote = null;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      entries.push(body.slice(from, i));
      from = i + 1;
    }
  }
  entries.push(body.slice(from));
  for (const e of entries) {
    const m = e.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (m) out.set(m[1], { n, value: unquote(m[2]) });
  }
  return out;
}

/**
 * Every step of a parsed job, in order: `{ index, first, last, id, name, cond,
 * env, run, uses, with }`. `first`/`last` are file line numbers, `cond` is the
 * step's `if:` as written (null when it has none), `env` is ONLY the step's `env:`
 * mapping (never `with:`), and `run` is `{ n, text }` taken from the job's LOGICAL
 * lines, so a `run: |` block arrives joined with ` ; ` and a `run: >` block folded.
 * `uses` is the action reference (null for a `run:` step), and `with` is the
 * step's inputs as Map KEY → {n, value}, where `n` is the key's line and a block
 * or wrapped value is joined as `mappingBelow` describes.
 *
 * ⏱ `uses` and `with` ADDED 2026-09-24 for assert-workflow-hardening.mjs limb 8,
 * which judges a failure-path action's inputs. Additive: no earlier field moved.
 */
export function workflowSteps(job) {
  const lines = job?.lines ?? [];
  const at = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l.text));
  if (at === -1) return [];
  const steps = [];
  let itemIndent = null;
  for (let i = at + 1; i < lines.length; i++) {
    const t = lines[i].text;
    if (t.trim() === '') continue;
    if (indentOf(t) <= 4) break;
    if (!isStepItem(t)) continue;
    if (itemIndent === null) itemIndent = indentOf(t);
    if (indentOf(t) !== itemIndent) continue;
    const item = stepItemAround(lines, i);
    const step = { index: steps.length, first: lines[i].n, last: lines[i].n, id: null, name: null, cond: null, env: new Map(), run: null, uses: null, with: new Map() };
    for (let j = item.start; j < item.end; j++) {
      if (lines[j].text.trim() !== '') step.last = lines[j].n;
      const text = j === item.start ? lines[j].text.replace(/^(\s*)-\s/, '$1  ') : lines[j].text;
      const k = text.match(/^( *)([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
      if (!k || k[1].length !== item.indent + 2) continue;
      if (k[2] === 'id') step.id = unquote(k[3]);
      else if (k[2] === 'name') step.name = unquote(k[3]);
      else if (k[2] === 'if') step.cond = k[3];
      else if (k[2] === 'env' && k[3] === '') step.env = mappingBelow(lines, j + 1, item.end, item.indent + 2);
      else if (k[2] === 'uses') step.uses = unquote(k[3]);
      else if (k[2] === 'with' && k[3] === '') step.with = mappingBelow(lines, j + 1, item.end, item.indent + 2, { inputs: true });
      else if (k[2] === 'with' && k[3].startsWith('{')) step.with = flowMapping(k[3], lines[j].n);
      else if (k[2] === 'run') {
        const logical = job.logical.find((l) => l.n === lines[j].n);
        step.run = { n: lines[j].n, text: (logical?.text ?? text).replace(/^\s*(?:-\s+)?run:\s*/, '') };
      }
    }
    steps.push(step);
    i = item.end - 1;
  }
  return steps;
}

/** A job's own `env:` (the key at 4 spaces), as Map KEY → {n, value}. */
export function jobEnv(job) {
  const lines = job?.lines ?? [];
  const at = lines.findIndex((l) => /^ {4}env:\s*$/.test(l.text));
  return at === -1 ? new Map() : mappingBelow(lines, at + 1, lines.length, 4);
}

/** `cmd \` continued on the next line of a `run: |` block arrives from
 *  joinBlockScalars as `cmd \ ; next`: ONE shell command, rejoined here. */
export const joinShellContinuations = (text) => String(text ?? '').replace(/\s\\\s+;\s/g, ' ');

/** A command in COMMAND POSITION of one shell segment: after optional `NAME=value`
 *  assignments and an optional `xvfb-run` wrapper with its flags (quoted
 *  arguments included — `-s "-screen 0 2560x1600x24"`). A command named inside
 *  an `echo` string is prose, not a command. */
export const COMMAND_PREFIX = /^\s*(?:[A-Z_][A-Z0-9_]*=\S+\s+)*(?:xvfb-run(?:\s+(?:"[^"]*"|'[^']*'|-\S+))*\s+)?/.source;
export const commandAt = (segment, command) => new RegExp(`${COMMAND_PREFIX}(?:${command})`).test(String(segment ?? ''));

/** Every `echo "NAME=expr" >> "$GITHUB_ENV"` in a job: `{ name, expr, n,
 *  stepIndex, cond }`. `$GITHUB_OUTPUT` and a bare echo are not env writes. */
export function githubEnvWrites(job) {
  const out = [];
  for (const step of workflowSteps(job)) {
    if (step.run === null) continue;
    for (const seg of shellSegments(joinShellContinuations(step.run.text))) {
      const m = seg.match(/^\s*echo\s+(?:-e\s+)?(["']?)([A-Za-z_][A-Za-z0-9_]*)=(.*?)\1\s*>>\s*"?\$\{?GITHUB_ENV\}?"?\s*$/);
      if (m) out.push({ name: m[2], expr: m[3], n: step.run.n, stepIndex: step.index, cond: step.cond });
    }
  }
  return out;
}

/**
 * EVERY `flutter drive` A WORKFLOW RUNS, one record per shell segment:
 * `{ workflow, job, stepIndex, runLine, segment, defines, appVersionExpr,
 * teeTarget }`. `appVersionExpr` is the `--dart-define=APP_VERSION=` value as
 * written with its quotes removed (null when the drive passes none), and
 * `teeTarget` the file the NEXT segment `tee`s the drive's output into (null
 * when it is not piped to one). `parsed` as in flutterReleaseBuilds.
 */
export function flutterDrives(root, parsed = null) {
  const workflows = parsed ?? parseAllWorkflows(root);
  const out = [];
  for (const wf of workflows) {
    for (const job of wf.jobs.values()) {
      for (const step of workflowSteps(job)) {
        if (step.run === null) continue;
        const segs = shellSegments(joinShellContinuations(step.run.text));
        segs.forEach((seg, i) => {
          if (!commandAt(seg, 'flutter\\s+drive\\b')) return;
          const av = seg.split('#')[0].match(/--dart-define(?:=|\s+)APP_VERSION=("[^"]*"|'[^']*'|\S+)/);
          const tee = (segs[i + 1] ?? '').match(/^\s*tee\s+(?:-a\s+)?("[^"]*"|\S+)/);
          out.push({
            workflow: wf.rel,
            job: job.name,
            stepIndex: step.index,
            runLine: step.run.n,
            segment: seg,
            defines: definesIn(seg),
            appVersionExpr: av ? unquote(av[1]) : null,
            teeTarget: tee ? unquote(tee[1]) : null,
          });
        });
      }
    }
  }
  return out;
}

/**
 * SPLIT THE CENSUS INTO {graded, exempt, findings} AGAINST THE REGISTER.
 *
 * · **exempt** — the build matches an entry of the register key
 *   `releaseBuildsNeverShipped` `{workflow, job, target?, why}`. Nothing else
 *   removes a build from the domain, and each entry's `why` is printed on every
 *   run: an exemption nobody reads is indistinguishable from an omission.
 * · **finding** — the build carries no RELEASE_CHANNEL stamp, or its stamp names
 *   no row, or `flutter build <target>` is a target this census cannot place, or
 *   the row's `platforms` does not list that platform. A stamp that RESOLVES is
 *   all 6b ever checked; a windows row stamped onto an apk resolved fine.
 * · **graded** — everything else, WHETHER OR NOT ANY ROW DECLARES ITS JOB.
 *
 * `staleExemptions` closes the excuse in the other direction: an entry that
 * matches no release build at all has outlived its subject.
 *
 * It grades nothing itself — each caller asks its own question of `graded`.
 */
export function gradeDomain(builds, register) {
  const rows = new Map((register?.channels ?? []).map((c) => [c?.id, c]));
  // `{_why, entries}` — the shape every explained block in the register uses, so the
  // reason travels with the list instead of in a comment beside a reader.
  const declaredExempt = register?.releaseBuildsNeverShipped?.entries;
  const exemptions = Array.isArray(declaredExempt) ? declaredExempt : [];
  const matches = (e, b) =>
    e?.workflow === b.workflow &&
    e?.job === b.job &&
    (e?.target === undefined || e?.target === null || e.target === b.target);
  const graded = [];
  const exempt = [];
  const findings = [];
  const used = new Set();
  for (const b of builds) {
    const i = exemptions.findIndex((e) => matches(e, b));
    if (i !== -1) {
      used.add(i);
      exempt.push({ ...b, why: exemptions[i].why });
      continue;
    }
    if (b.stamp === null) {
      findings.push({ build: b, kind: 'unstamped', why: 'passes no --dart-define=RELEASE_CHANNEL, so nothing says which channel this binary is for.' });
      continue;
    }
    const row = rows.get(b.stamp);
    if (row === undefined) {
      findings.push({ build: b, kind: 'unknown-channel', why: `stamps RELEASE_CHANNEL=${b.stamp}, which names no register row.` });
      continue;
    }
    if (b.platform === null) {
      findings.push({ build: b, kind: 'unknown-target', why: `builds target "${b.target}", which this census cannot map to a platform, so no row's \`platforms\` can be checked against it.` });
      continue;
    }
    if (!(row.platforms ?? []).includes(b.platform)) {
      findings.push({ build: b, kind: 'platform-mismatch', row, why: `stamps RELEASE_CHANNEL=${b.stamp}, whose \`platforms\` is [${(row.platforms ?? []).join(', ')}] and does not include "${b.platform}".` });
      continue;
    }
    graded.push({ ...b, row });
  }
  const staleExemptions = exemptions.filter((_, i) => !used.has(i));
  return { graded, exempt, findings, exemptions, staleExemptions };
}

/**
 * THE LOCAL REUSABLE-WORKFLOW CALLS a parsed workflow makes, followed ONE level.
 *
 * A job whose own key `uses:` (four spaces: a job's keys, never a step's) names
 * `./.github/workflows/<file>.yml` runs every job of that callee inside the
 * caller's run. A guard that reads a job's `needs:` or its `runs-on:` sees
 * nothing of that: the call job has no steps, no runner and no timeout of its
 * own. This is the one place that turns such a job into the callee's REL path.
 *
 * `parsedAll` is the set the caller already holds (`parseAllWorkflows`), so this
 * walks no tree and reads no file of its own: like `parseWorkflow`, it answers
 * only about what its caller handed it.
 *
 * Returns `{ calls, remote, refusal }`:
 *   · `calls`   — `[{ job, n, callee }]`, `callee` the callee's parsed workflow;
 *   · `remote`  — `[{ job, n, ref }]`, job-level `uses:` that are not local;
 *   · `refusal` — null, or `{ kind, job, n, callee }` with `kind`
 *     `missing` (no such file in `parsedAll`) or `nested` (the callee itself
 *     makes a local call). It RETURNS the refusal and never exits: each caller
 *     turns it into its own COVERAGE LOST.
 *
 * ⏱ ADDED 2026-09-24 (O-EXTENSIONS-CI-REQUIRED-GATES-NOTHING): ci.yml's
 * `extensions` job calls extensions-ci.yml, and ci-gate needs it.
 */
export function resolveLocalCalls(wf, parsedAll) {
  const calls = [];
  const remote = [];
  let refusal = null;
  const byRel = new Map((parsedAll ?? []).map((p) => [p.rel, p]));
  const jobCalls = (w) => {
    const out = [];
    for (const job of w.jobs.values()) {
      for (const l of job.lines) {
        const m = l.text.match(/^ {4}uses:\s*(['"]?)(\S+?)\1\s*$/);
        if (m) out.push({ job: job.name, n: l.n, ref: m[2] });
      }
    }
    return out;
  };
  for (const c of jobCalls(wf)) {
    const local = c.ref.match(/^\.\/(\.github\/workflows\/[^@\s]+\.ya?ml)$/);
    if (!local) {
      remote.push(c);
      continue;
    }
    const callee = byRel.get(local[1]);
    if (!callee) {
      refusal ??= { kind: 'missing', job: c.job, n: c.n, callee: local[1] };
      continue;
    }
    if (jobCalls(callee).some((d) => /^\.\//.test(d.ref))) {
      refusal ??= { kind: 'nested', job: c.job, n: c.n, callee: local[1] };
      continue;
    }
    calls.push({ job: c.job, n: c.n, callee });
  }
  return { calls, remote, refusal };
}
