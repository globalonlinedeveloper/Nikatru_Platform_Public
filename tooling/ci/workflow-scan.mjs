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
 * 🔴 NOT the path glob `globToRe` assert-deploy-triggers.mjs once carried: it
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

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ ADDED 2026-09-25 (O-RELEASE-EMITTER-WRITES-UNCHECKED): THE RELEASE-RECORD
// EMITTER'S CALL SITES, read once. assert-release-json.test.mjs executed every
// step it found with a private finder, and assert-release-durable.mjs matched a
// narrower private regex (`release-manifest.mjs --emit-release-json <dir>`) that
// missed the flag in another order, on a continuation line, or behind a script
// held in a variable. One finder now serves both. Its step model is
// `workflowSteps` above: the test's own `jobSteps` walk was measured against it
// over every job in .github/workflows (86 jobs, 830 steps) and agreed on every
// boundary, so it was dropped rather than moved.
// ─────────────────────────────────────────────────────────────────────────────

/** The emitter's own name for the mode. release-manifest.mjs selects it with
 *  `has('emit-release-json')` — the flag at ANY position of its argv. */
export const EMIT_RELEASE_JSON_MODE = 'emit-release-json';

/** The directory a text hands the emitter: the token after `--emit-release-json`,
 *  read the way release-manifest.mjs's `positionalAfter` reads its argv (a
 *  following `--flag` is no directory), across a `\` continuation. As written,
 *  quotes kept, like the `--write`/`--verify` directories callers compare it with.
 *  Null when the text names no directory. */
export function emitOutputDir(text) {
  const m = joinShellContinuations(text).match(new RegExp(`--${EMIT_RELEASE_JSON_MODE}\\s+(\\S+)`));
  return m && !m[1].startsWith('--') ? m[1] : null;
}

/**
 * Every STEP of `parsed` (default: every workflow under `wfRoot`) that names the
 * emit mode anywhere, in file order, as `{ wf, job, step, n, dir }`: `step` is a
 * `workflowSteps` entry (`first`/`last` are its file lines), `n` the first
 * LOGICAL line naming the mode (a block scalar's is its `run:` key's line), and
 * `dir` that line's `emitOutputDir`. A mention outside every step (a job-level
 * `env:`) is in no step and is not returned; a caller that must account for
 * every mention re-reads the file flat.
 */
export function emitInvocations(wfRoot, parsed = parseAllWorkflows(wfRoot)) {
  const found = [];
  for (const wf of parsed) {
    for (const job of wf.jobs.values()) {
      const steps = workflowSteps(job);
      for (const l of job.logical) {
        if (!l.text.includes(EMIT_RELEASE_JSON_MODE)) continue;
        const step = steps.find((s) => s.first <= l.n && l.n <= s.last);
        if (step && !found.some((f) => f.wf === wf && f.step.first === step.first)) {
          found.push({ wf, job, step, n: l.n, dir: emitOutputDir(l.text) });
        }
      }
    }
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RESOLVED VIEW — every workflow with its LOCAL references followed, once.
//
// ⏱ ADDED 2026-09-24 (O-GUARDS-DO-NOT-FOLLOW-LOCAL-USES). The release and publish
// guards read only the top-level files, so a step moved behind
// `uses: ./.github/actions/<x>` or a job moved behind
// `uses: ./.github/workflows/<f>.yml` left their view while every one of them
// kept printing ok: moved code silences guards. This is the one resolver they
// read through instead. It is built on resolveLocalCalls above (the call jobs)
// and on parseWorkflow (the one comment reduction, used for action.yml too), and
// it adds no parse of its own beyond locating a composite's `runs.steps`.
//
// parseAllWorkflows is deliberately NOT changed: it has 37 importers, and every
// inlined line would move the `wf:line` a finding prints. A reader opts in here,
// and tooling/workflow-readers.json records which readers must.
//
// THE LINE NUMBERS. An inlined line keeps a NUMERIC `n` so every "is X before Y"
// comparison a guard already makes still orders it correctly, but that `n` is a
// fraction and names no real line: composite lines sit at `<the calling step's
// first line> + k·1e-8`, callee lines at `<the call job's uses: line> +
// <callee line>·1e-4`. Its real place is `wf.origin.get(n)` — `<file>:<line>` —
// and lineAt / placeOf below are how a finding prints it. A finding that printed
// the bare fraction would send its reader to a line that does not hold the text.
//
// ⚠️ STILL NOT A GUARD. It never exits: a reference it cannot follow comes back
// as `refusal`, and each reader turns that into its own COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────

const COMPOSITE_STEP_SCALE = 1e-8;
const CALLEE_LINE_SCALE = 1e-4;
const INPUT_EXPR = /\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;

/** A STEP-level `uses: ./<path>` on this job line, or null. Job-level `uses:`
 *  (exactly four spaces, no dash) is a call job and belongs to resolveLocalCalls. */
function localStepUses(text) {
  const m = text.match(/^(\s*)(-\s+)?uses:\s*(['"]?)(\.\/[^'"\s]*?)\3\s*$/);
  if (!m) return null;
  if (!m[2] && m[1].length <= 4) return null;
  return m[4];
}

/** `./.github/actions/x` → `.github/actions/x/action.yml` (or `.yaml`, if only that exists). */
function localActionRel(root, ref) {
  const dir = ref.replace(/^\.\//, '').replace(/\/+$/, '');
  const yml = `${dir}/action.yml`;
  const yaml = `${dir}/action.yaml`;
  return !existsSync(join(root, yml)) && existsSync(join(root, yaml)) ? yaml : yml;
}

/**
 * A local action's `runs.steps` lines and its input defaults, read through
 * parseWorkflow (so comments are blanked by the same reduction every workflow
 * gets). Returns `{ rel, kind: 'ok', steps, defaults }`, or `{ rel, kind }` with
 * `kind` `missing` or `not-composite`.
 */
function readComposite(root, ref) {
  const rel = localActionRel(root, ref);
  const parsed = parseWorkflow(root, rel);
  if (parsed === null) return { rel, kind: 'missing' };
  const lines = parsed.lines;
  const block = (key, from, indent) => {
    const head = new RegExp(`^ {${indent}}${key}:\\s*$`);
    const at = lines.findIndex((l, i) => i >= from && head.test(l.text));
    if (at === -1) return null;
    let end = at + 1;
    while (end < lines.length && !(lines[end].text.trim() !== '' && indentOf(lines[end].text) <= indent)) end += 1;
    return { at, end };
  };
  const runs = block('runs', 0, 0);
  if (runs === null) return { rel, kind: 'not-composite' };
  const using = lines.slice(runs.at + 1, runs.end).find((l) => /^ {2}using:/.test(l.text));
  if (!using || !/^ {2}using:\s*(['"]?)composite\1\s*$/.test(using.text)) return { rel, kind: 'not-composite' };
  const steps = block('steps', runs.at + 1, 2);
  if (steps === null || steps.at >= runs.end) return { rel, kind: 'not-composite' };
  const defaults = new Map();
  const inputs = block('inputs', 0, 0);
  if (inputs !== null) {
    for (const input of keysBelow(lines, inputs.at + 1, inputs.end, 0)) {
      const def = keysBelow(lines, input.i + 1, inputs.end, indentOf(lines[input.i].text)).find((k) => k.key === 'default');
      if (def) defaults.set(input.key, def.value);
    }
  }
  return { rel, kind: 'ok', steps: lines.slice(steps.at + 1, Math.min(steps.end, runs.end)), defaults };
}

/** The `KEY: value` lines directly below a key at `keyIndent`, as
 *  `[{ key, value, i }]` (`i` the index into `lines`). Unlike mappingBelow it
 *  keeps a `-` in a key: action inputs are named `cache-dependency-path`. */
function keysBelow(lines, from, to, keyIndent) {
  const out = [];
  let childIndent = null;
  for (let j = from; j < to; j++) {
    const t = lines[j].text;
    if (t.trim() === '') continue;
    const at = indentOf(t);
    if (at <= keyIndent) break;
    if (childIndent === null) childIndent = at;
    if (at !== childIndent) continue;
    const m = t.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (m) out.push({ key: m[1], value: unquote(m[2]), i: j });
  }
  return out;
}

/**
 * A job with every step-level `uses: ./…` replaced, at its index, by that
 * composite's steps. Returns `{ lines, added, refusal }`, where `added` is the
 * inlined lines' `[n, from]` pairs. The composite's items are re-indented to
 * the calling step's, `${{ inputs.X }}` becomes the caller's `with: X` text (or
 * the action's `default:`), and the calling step's `if:` is written onto each
 * inlined step that has none of its own. A composite that itself uses a local
 * action is `nested`: this follows one level, never two.
 */
function inlineComposites(wf, lines, read, placeOfN) {
  const out = [];
  const added = [];
  let refusal = null;
  // A step item's own keys, `- ` read as two spaces: `[{ key, value, j }]`.
  const itemKeys = (ls, item) => {
    const keys = [];
    for (let j = item.start; j < item.end; j++) {
      const text = j === item.start ? ls[j].text.replace(/^(\s*)-\s/, '$1  ') : ls[j].text;
      const k = text.match(/^( *)([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
      if (k && k[1].length === item.indent + 2) keys.push({ key: k[2], value: k[3], j });
    }
    return keys;
  };
  for (let i = 0; i < lines.length; i++) {
    const ref = localStepUses(lines[i].text);
    if (ref === null) {
      out.push(lines[i]);
      continue;
    }
    const item = stepItemAround(lines, i);
    const comp = read(ref);
    if (comp.kind !== 'ok' || item === null) {
      refusal ??= { kind: comp.kind === 'ok' ? 'not-composite' : comp.kind, at: placeOfN(lines[i].n), path: comp.rel };
      out.push(lines[i]);
      continue;
    }
    // The calling step's own keys: `with:` feeds the inputs, `if:` gates every inlined step.
    const own = itemKeys(lines, item);
    const withKey = own.find((k) => k.key === 'with' && k.value === '');
    const withMap = new Map(
      withKey ? keysBelow(lines, withKey.j + 1, item.end, item.indent + 2).map((k) => [k.key, k.value]) : [],
    );
    const ifKey = own.find((k) => k.key === 'if');
    const cond = ifKey ? { text: ifKey.value, from: placeOfN(lines[ifKey.j].n) } : null;
    const nestedAt = comp.steps.find((l) => localStepUses(l.text) !== null);
    if (nestedAt) refusal ??= { kind: 'nested', at: `${comp.rel}:${nestedAt.n}`, path: localStepUses(nestedAt.text) };
    const itemIndent = indentOf(comp.steps.find((l) => isStepItem(l.text))?.text ?? '');
    const shift = item.indent - itemIndent;
    const reindent = (t) => (t.trim() === '' ? '' : shift >= 0 ? ' '.repeat(shift) + t : t.slice(Math.min(-shift, indentOf(t))));
    const subst = (t) =>
      t.replace(INPUT_EXPR, (all, name) => (withMap.has(name) ? withMap.get(name) : comp.defaults.has(name) ? comp.defaults.get(name) : all));
    const body = [];
    for (let s = 0; s < comp.steps.length; ) {
      const l = comp.steps[s];
      if (!(isStepItem(l.text) && indentOf(l.text) === itemIndent)) {
        body.push({ text: subst(reindent(l.text)), from: `${comp.rel}:${l.n}` });
        s += 1;
        continue;
      }
      // One composite step: its lines, then the caller's `if:` LAST when it has
      // none of its own — last, so it never lands inside a `run: |` block.
      const span = stepItemAround(comp.steps, s);
      for (let x = span.start; x < span.end; x++) {
        body.push({ text: subst(reindent(comp.steps[x].text)), from: `${comp.rel}:${comp.steps[x].n}` });
      }
      if (cond !== null && !itemKeys(comp.steps, span).some((k) => k.key === 'if')) {
        body.push({ text: `${' '.repeat(item.indent + 2)}if: ${cond.text}`, from: cond.from });
      }
      s = span.end;
    }
    // The calling step's lines BEFORE its `uses:` were already pushed; the step is replaced whole.
    out.splice(out.length - (i - item.start), i - item.start);
    const base = lines[item.start].n;
    body.forEach((b, k) => {
      const n = base + (k + 1) * COMPOSITE_STEP_SCALE;
      out.push({ n, text: b.text });
      added.push([n, b.from]);
    });
    i = item.end - 1;
  }
  return { lines: out, added, refusal };
}

/** A job object shaped like parseWorkflow's, over new `lines`, with the
 *  logical lines recomputed by the one joinBlockScalars. */
function rebuildJob(job, lines, extra = {}) {
  return { ...job, lines, logical: joinBlockScalars(lines), ...extra };
}

/**
 * Every workflow under `.github/workflows`, RESOLVED:
 *   · a step `uses: ./.github/actions/<x>` is replaced at its index by that
 *     composite's `runs.steps` (inlineComposites above);
 *   · a job `uses: ./.github/workflows/<f>.yml` (resolveLocalCalls) keeps its
 *     call job and gains one child per callee job, named `<caller>/<calleeJob>`,
 *     in the CALLER's workflow — so it is graded under the caller's `on:` — with
 *     the caller job's `needs` added to its own (rewritten to child names) and
 *     the caller job's `if:` when it has one. Each child carries `calledBy` (the
 *     call job) and `callee` (the callee file, repo-relative). `environment:`
 *     stays the callee job's own: a call job cannot carry one;
 *   · a workflow whose only trigger is `workflow_call` is not returned on its
 *     own: it runs only as its callers' children.
 *
 * Returns `{ workflows, filesRead, refusal }`. `filesRead` is every workflow and
 * action.yml this read (repo-relative). `refusal` is null or the FIRST of
 * `{ kind, at, path }`, `kind` one of:
 *   `nested`        a composite that uses a local action, or a callee that calls again;
 *   `missing`       a local action or callee that is not in the tree;
 *   `remote`        a job-level `uses:` that is not `./` (a step-level third-party
 *                   `uses:` is an ordinary action, never a refusal);
 *   `not-composite` a local action whose `runs.using` is not `composite`;
 *   `orphan-callee` a `workflow_call`-only workflow no workflow here calls.
 */
export function parseResolvedWorkflows(root) {
  const all = parseAllWorkflows(root);
  const filesRead = all.map((w) => w.rel);
  let refusal = null;
  const composites = new Map();
  const read = (ref) => {
    if (!composites.has(ref)) {
      const comp = readComposite(root, ref);
      composites.set(ref, comp);
      if (comp.kind !== 'missing' && !filesRead.includes(comp.rel)) filesRead.push(comp.rel);
    }
    return composites.get(ref);
  };
  const called = new Set();
  const resolved = [];
  for (const wf of all) {
    const origin = new Map();
    const jobs = new Map();
    const inline = (lines) => {
      const r = inlineComposites(wf, lines, read, (n) => origin.get(n) ?? `${wf.rel}:${n}`);
      for (const [n, from] of r.added) origin.set(n, from);
      refusal ??= r.refusal;
      return r.lines;
    };
    const { calls, remote, refusal: callRefusal } = resolveLocalCalls(wf, all);
    if (callRefusal) refusal ??= { kind: callRefusal.kind, at: `${wf.rel}:${callRefusal.n}`, path: callRefusal.callee };
    for (const r of remote) refusal ??= { kind: 'remote', at: `${wf.rel}:${r.n}`, path: r.ref };
    for (const job of wf.jobs.values()) {
      jobs.set(job.name, rebuildJob(job, inline(job.lines)));
      const call = calls.find((c) => c.job === job.name);
      if (!call) continue;
      called.add(call.callee.rel);
      const at = (n) => call.n + n * CALLEE_LINE_SCALE;
      for (const cj of call.callee.jobs.values()) {
        const mapped = cj.lines.map((l) => {
          origin.set(at(l.n), `${call.callee.rel}:${l.n}`);
          return { n: at(l.n), text: l.text };
        });
        const moved = (v) => (v === null ? null : { ...v, n: at(v.n) });
        jobs.set(`${job.name}/${cj.name}`, rebuildJob(cj, inline(mapped), {
          name: `${job.name}/${cj.name}`,
          needs: [...job.needs, ...cj.needs.map((d) => `${job.name}/${d}`)],
          jobIf: job.jobIf ?? moved(cj.jobIf),
          continueOnError: job.continueOnError ?? moved(cj.continueOnError),
          calledBy: job.name,
          callee: call.callee.rel,
        }));
      }
    }
    resolved.push({ ...wf, jobs, origin });
  }
  const callOnly = (wf) => {
    const events = workflowEvents(wf);
    return events.size === 1 && events.has('workflow_call');
  };
  for (const wf of all) {
    if (callOnly(wf) && !called.has(wf.rel)) {
      refusal ??= { kind: 'orphan-callee', at: `${wf.rel}:1`, path: wf.rel };
    }
  }
  return { workflows: resolved.filter((wf) => !callOnly(wf)), filesRead, refusal };
}

/** Where line `n` of a resolved workflow really is, for a finding that already
 *  names `wf.rel`: `:<n>` for the file's own line, `<file>:<line>` for a line
 *  inlined from a composite or a callee. */
export const lineAt = (wf, n) => wf?.origin?.get(n) ?? `:${n}`;

/** The same, as a full `<file>:<line>` in both cases. */
export const placeOf = (wf, n) => wf?.origin?.get(n) ?? `${wf.rel}:${n}`;

/** The one sentence a reader prints when parseResolvedWorkflows refused. */
export const refusalText = (r) =>
  `workflow-scan could not resolve a local reference (${r.kind}) at ${r.at}: ${r.path}. ` +
  'A step or job it cannot follow is a step or job this guard cannot see.';

// ─────────────────────────────────────────────────────────────────────────────
// STORE PUBLISH STEPS — the one definition the three guards import.
//
// ⏱ MOVED 2026-09-24 (EXT-3, O-STORE-PUBLISH-STEP-DEFINED-THREE-WAYS) out of
// assert-publish-steps-guarded.mjs limb 2, AS IT WAS: no pattern below was
// widened or narrowed in the move. Until then limb 2 classified store steps with
// this code, assert-release-provenance.mjs limb 4 keyed on the `--submit` verb
// alone, and assert-publish-records.mjs ranged over the register's submittable
// rows — three answers to "which step publishes to a store", and a Chrome or Edge
// step fell outside two of them. assert-publish-steps-guarded (limb 2),
// assert-release-provenance (limb 4) and assert-publish-records (rule 2b) now
// call storePublishSteps() and nothing else to find them.
//
// A STORE PUBLISH STEP is any step, in any job of any workflow, that
//   · runs a `node … .mjs --submit` verb (the submission scripts' mode flag),
//   · runs a script some channel row in the register declares as `publishScript`, or
//   · names a store CLI verb or a store host (STORE_CLI, STORE_HOST_PARTS).
// A command segment carrying `--dry-run` publishes nothing and is not one.
// ─────────────────────────────────────────────────────────────────────────────

/** A host pattern that admits only real SUBDOMAINS of the given host, and ends at
 *  a path, port, query or fragment. (CodeQL js/regex/missing-regexp-anchor,
 *  2026-09-07: the unanchored class admitted `evil-addons.mozilla.org.attacker.test`.) */
export const storeHost = (h) => `https?://(?:[A-Za-z0-9-]+\\.)*${h}(?:[/:?#]|$)`;

/** The STORE hosts — the hosts that address a store rather than a GitHub Release. */
export const STORE_HOST_PARTS = [
  storeHost('addons[.]mozilla[.]org'),
  storeHost('chromewebstore[.]googleapis[.]com'),
  `${storeHost('googleapis[.]com')}?upload`,
  storeHost('clients2[.]google[.]com'),
  storeHost('addons[.]microsoftedge[.]microsoft[.]com'),
];

/** Store CLIs whose verb hands a package to a store. Matched per command segment. */
export const STORE_CLI = [
  /\bsnapcraft\s+(?:upload|push|release)\b/,
  /\bfastlane\s+(?:deliver|supply|pilot)\b/,
  /\bxcrun\s+altool\b/,
  /\bmsstore\s+publish\b/,
  /\bweb-ext(?:@\S+)?\s+(?:sign|submit)\b/,
  /\bchrome-webstore-(?:upload|api)\b/,
];
/** Store-submitting third-party actions, matched on `uses:`. */
export const STORE_ACTIONS = [/^r0adkll\/upload-google-play$/];
const STORE_HOSTS = STORE_HOST_PARTS.map((s) => new RegExp(s));

/** The mode flag of a submission script — the exact token assert-release-provenance
 *  limb 4 keys on, so the guards cannot disagree about which invocation submits. */
export const SUBMIT_FLAG = /(?:^|\s)--submit(?=\s|$)/;
const STORE_DRY_RUN = /--dry-run\b/;

/** A publish-script basename, as a regex source with no backslash in it: every
 *  dot is a literal `[.]`. */
export const basenameSource = (p) => p.split('/').pop().split('.').join('[.]');

/** The step bullet is the literal six-space "      - ", under `jobs:` → `<job>:` →
 *  `steps:`. Each step keeps its raw (comment-blanked) lines. */
export function readSteps(job) {
  const steps = [];
  let current = null;
  for (const line of job.lines) {
    if (/^ {6}- /.test(line.text)) {
      current = { n: line.n, lines: [] };
      steps.push(current);
    }
    if (current !== null) current.lines.push(line);
  }
  return steps;
}

/** `env:` entries directly under a key at `indent` spaces, from comment-blanked lines. */
export function envAt(lines, indent) {
  const env = new Map();
  const key = new RegExp(`^ {${indent}}(?:- )?env:\\s*$`);
  const at = lines.findIndex((l) => key.test(l.text) || (indent === 8 && /^ {6}- env:\s*$/.test(l.text)));
  if (at === -1) return env;
  for (const l of lines.slice(at + 1)) {
    if (l.text.trim() === '') continue;
    const ind = l.text.match(/^ */)[0].length;
    if (ind <= indent) break;
    const m = l.text.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (m && ind === indent + 2) env.set(m[1], m[2]);
  }
  return env;
}

/** One step: name, own `if:`, `uses:`, step `env:`, and the `run:` body as ONE
 *  logical line (joinBlockScalars — a `|` block joined with ` ; `). */
export function stepModel(raw) {
  const s = { n: raw.n, name: null, cond: null, uses: null, env: envAt(raw.lines, 8), run: '' };
  for (const line of raw.lines) {
    let m;
    if (s.name === null && (m = line.text.match(/^ {6}(?:- | {2})name:\s*(.+?)\s*$/))) s.name = m[1];
    if (s.cond === null && (m = line.text.match(/^ {6}(?:- | {2})if:\s*(.+?)\s*$/))) s.cond = m[1];
    if (s.uses === null && (m = line.text.match(/^ {6}(?:- | {2})uses:\s*(\S+)/))) s.uses = m[1].split('@')[0];
  }
  for (const l of joinBlockScalars(raw.lines)) {
    const m = l.text.match(/^ {6}(?:- | {2})run:\s*(.*)$/);
    if (m) {
      s.run = m[1];
      break;
    }
  }
  return s;
}

/** What makes this step a store publish, and which scripts it runs to do it. */
export function storeSurfaces(step, publishBasenames) {
  const hits = [];
  const scripts = new Set();
  if (step.uses !== null && STORE_ACTIONS.some((re) => re.test(step.uses))) hits.push(`store action ${step.uses}`);
  for (const seg of shellSegments(step.run)) {
    if (STORE_DRY_RUN.test(seg)) continue;
    const mjs = seg.match(/(\S+[.]mjs)\b/);
    if (/\bnode\b/.test(seg) && SUBMIT_FLAG.test(seg) && mjs) {
      hits.push(`--submit verb  ${seg.trim()}`);
      scripts.add(mjs[1].replace(/^["']/, ''));
    }
    for (const [base, rel] of publishBasenames) {
      if (new RegExp(`(?<![A-Za-z0-9._-])${basenameSource(base)}`).test(seg)) {
        hits.push(`register publishScript  ${seg.trim()}`);
        scripts.add(rel);
      }
    }
    for (const re of [...STORE_CLI, ...STORE_HOSTS]) if (re.test(seg)) hits.push(`store CLI or host  ${seg.trim()}`);
  }
  return { hits, scripts: [...scripts] };
}

/** basename -> repo-relative path, for every register row that declares a `publishScript`. */
export function publishBasenamesOf(register) {
  const rows = (register?.channels ?? []).filter((c) => typeof c?.publishScript === 'string' && c.publishScript.trim() !== '');
  return new Map(rows.map((c) => [c.publishScript.trim().split('/').pop(), c.publishScript.trim()]));
}

/**
 * Every store publish step across `workflows` (the three guards pass
 * parseResolvedWorkflows' resolved view, so a step behind a local `uses:` is
 * still found), in file order: `{ wf, job, raw, step, hits, scripts }`. `step` is stepModel(raw);
 * `scripts` are the repo-relative publish scripts it runs (a register path, or
 * the `.mjs` a `--submit` verb names as written). What an empty answer means is
 * the caller's to say: each caller turns zero into its own COVERAGE LOST.
 */
export function storePublishSteps(workflows, register) {
  const publishBasenames = publishBasenamesOf(register);
  const out = [];
  for (const wf of workflows) {
    for (const job of wf.jobs.values()) {
      for (const raw of readSteps(job)) {
        const step = stepModel(raw);
        const { hits, scripts } = storeSurfaces(step, publishBasenames);
        if (hits.length === 0) continue;
        out.push({ wf, job, raw, step, hits, scripts });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH — what hands an artifact to something outside the run, per job.
//
// ⏱ MOVED 2026-09-25 (pd2c, O-DEPLOY-IS-NOT-ONE-GATED-LANE limb 2) out of
// assert-release-provenance.mjs, AS IT WAS: no pattern was widened or narrowed
// and classifyPublishes' two passes are byte for byte what provenance ran. It
// moved because a second guard now needs the same answer —
// assert-workflow-hardening limb 10 requires `environment:` and a first-step ref
// check on every job this classifies — and provenance is a script that runs on
// import, so it cannot be imported. Provenance imports these three names from
// here; every comment below travelled with the code it explains.

/**
 * A PUBLISH hands an artifact to something outside the run. Deliberately a
 * NAMED list rather than a heuristic: a heuristic that stops matching reports
 * "clean", and the whole point of this guard is that silence is not success.
 * `actions/upload-artifact` is EXCLUDED on purpose — see the header of
 * assert-release-provenance.mjs.
 */
export const PUBLISH = [
  { re: /wrangler[^\n]*\bdeploy\b|pages\s+deploy/, what: 'a Cloudflare deploy' },
  // `cloudflare/wrangler-action` is classified from its `with: command:` line,
  // NOT from the `uses:` line — triage 2026-07-31 (mutation-proven): the verb
  // lives on the `command:` line, so classifying the `uses:` line called a
  // correctly-gated `command: deploy --dry-run` typecheck a publish and
  // demanded a ledger entry for a deployment that never happened — the exact
  // fabrication the header calls worse than recording nothing. `viaCommand`
  // routes these steps through the command classifier below; a step with NO
  // `command:` still counts, because the action's default command is `deploy`.
  { re: /cloudflare\/wrangler-action/, what: 'a Cloudflare deploy action', viaCommand: true },
  // `upload` as well as `create` — review 2026-07-31: the register's own
  // linux-appimage row locks the AppImage flow to Releases-as-origin, and a lane
  // adding assets to an existing release says `gh release upload`. Missing it
  // meant the exact flow the register prescribes escaped this guard.
  { re: /gh\s+release\s+(create|upload)|softprops\/action-gh-release|actions\/upload-release-asset/, what: 'a GitHub Release publish' },
  // `r2 object put` — dl.nikatru.com is R2 behind a domain ([ADR 015] §4), so
  // pushing an object there IS publishing a user-receivable artifact.
  { re: /wrangler[^\n]*\br2\s+object\s+put\b/, what: 'an R2 artifact upload' },
  { re: /snapcraft\s+upload|fastlane\s+(deliver|supply|pilot)|xcrun\s+altool/, what: 'a store submission' },
  // The stores the register marks submittable that fastlane cannot reach:
  // Microsoft's CLI/action, and the community Play-upload action.
  { re: /msstore\s+publish|store-submission|r0adkll\/upload-google-play/, what: 'a store submission action' },
];

/**
 * 🔴 A DRY RUN PUBLISHES NOTHING, AND MISSING THIS COST THE FIRST VERSION FIVE
 * FALSE FAILURES. `ci.yml` typechecks both Workers with `npx wrangler deploy
 * --dry-run` — RE-MEASURED 2026-08-21,
 * `grep -cE "npx wrangler deploy --dry-run" .github/workflows/ci.yml` prints 3
 * (:63, :1731 and :2225, the last inside the `run: |` block opened at :2222) — the
 * word `deploy` is right there and not one byte leaves the runner. Demanding a
 * gate check and a deployment marker around a dry run would have written three
 * deployments that never happened into [10]D-9's ledger. Checked against the actual lines before believing the guard,
 * which is the only reason this is a comment and not a commit.
 *
 * Triage 2026-07-31 (mutation-proven): the exclusion then over-rotated — it
 * dropped the WHOLE LINE, so `npx wrangler deploy --dry-run && npx wrangler
 * deploy`, a real publish, vanished on the strength of the dry run beside it.
 * Lines are now split on the shell separators and each command segment answers
 * for itself: only the segment that carries `--dry-run` is excluded, and any
 * segment that publishes without it still counts.
 */
export const DRY_RUN = /--dry-run/;

/**
 * The publish set for one job. Two passes: `cloudflare/wrangler-action` steps
 * are classified from their `with: command:` line — synthesized back into a
 * `wrangler …` command so the SAME publish patterns and the SAME per-segment
 * dry-run rule judge it, rather than a second vocabulary that could drift —
 * and every other pattern is matched per shell segment of each logical line.
 * A `command:` line the action pass consumed is skipped by the generic pass,
 * so one deploy is never reported twice.
 */
export function classifyPublishes(job) {
  const found = [];
  const consumed = new Set();
  for (let i = 0; i < job.logical.length; i++) {
    const line = job.logical[i];
    if (!/cloudflare\/wrangler-action/.test(line.text)) continue;
    let command = null;
    for (let k = i + 1; k < job.logical.length; k++) {
      const t = job.logical[k].text;
      if (/^\s*-\s/.test(t)) break; // next step — this step's `with:` block is over
      const m = t.match(/^\s*command:\s*(\S.*?)\s*$/);
      if (m) {
        command = { n: job.logical[k].n, text: m[1].replace(/^['"]|['"]$/g, '') };
        break;
      }
    }
    if (command === null) {
      // No `command:` key — the action's DEFAULT command is `deploy`, so
      // silence here IS a publish, reported at the `uses:` line.
      found.push({ n: line.n, what: 'a Cloudflare deploy action' });
      continue;
    }
    consumed.add(command.n);
    const cmd = `wrangler ${command.text}`;
    // 🔴 A `!p.viaCommand &&` CONJUNCT STOOD HERE AND WAS DELETED 2026-08-22.
    // THE PROOF WRITTEN BESIDE THE DELETION WAS FALSE, AND I MEASURED IT FALSE
    // ON 2026-08-24. What stood here, verbatim, was that the conjunct "could
    // only change the verdict if a `viaCommand` pattern matched the command this
    // line just synthesized", that any such line is re-entered by this loop and
    // "pushed as the action's DEFAULT deploy at the same line with the same
    // label", and so "MEASURED on such a tree: identical output, conjunct or
    // not". A tree distinguishes them. A step whose `with: command:` value IS
    // the literal `cloudflare/wrangler-action`, with a nested `command: deploy`
    // below it, is re-entered as a second wrangler-action step that DOES find a
    // `command:` — the nested one — so the two runs disagree about WHICH line
    // carries the first publish, and limb 2's same-job order test flips on it.
    // Measured on one such tree: shipped EXIT 1 ("calls assert-gate-passed.mjs
    // at :12, AFTER its first publish at :11"), conjunct restored EXIT 0.
    //
    // THE DELETION STANDS, for the reason that is actually true rather than the
    // one that was written: dropping the conjunct can only ADD a publish entry,
    // never remove one, so nothing went blind — the guard got stricter on this
    // shape, not blinder. And it is now HELD instead of argued: the case
    // 'a `command:` naming the action ITSELF is a publish at its own line' in
    // release-provenance.test.mjs goes RED the moment the conjunct comes back.
    // The partition the conjunct expressed also survives where it can fail —
    // the generic pass's `if (p.viaCommand) continue;`, which the sweep reddens.
    const publishes = PUBLISH.some((p) => shellSegments(cmd).some((s) => p.re.test(s) && !DRY_RUN.test(s)));
    if (publishes) found.push({ n: command.n, what: 'a Cloudflare deploy action' });
  }
  for (const p of PUBLISH) {
    if (p.viaCommand) continue;
    for (const l of job.logical) {
      if (consumed.has(l.n)) continue;
      if (shellSegments(l.text).some((s) => p.re.test(s) && !DRY_RUN.test(s))) found.push({ n: l.n, what: p.what });
    }
  }
  return found.sort((a, b) => a.n - b.n);
}

/** THE POST-GATE PREDICATE, byte for byte. ⏱ 2026-09-25 [ADR 095 §4] A job that
 *  `needs` its workflow's aggregator runs only after it, and this is the ONE `if:`
 *  that makes such a job post-gate: a push to main, nothing wider. Exported once:
 *  assert-green-means-ran rule A9 grades the class and assert-ops-register admits
 *  its RED-SINCE rows by it, and two spellings would shrink that domain unseen. */
export const POST_GATE_IF = "github.event_name == 'push' && github.ref == 'refs/heads/main'";

/**
 * Every job of `wf` that touches the post-gate class of aggregator job `gateJob`,
 * in file order, as `{ id, kind, cond }`:
 *   `post`     it needs `gateJob` and its job-level `if:` is exactly POST_GATE_IF;
 *   `wide-if`  it needs `gateJob` and its `if:` is anything else, or absent;
 *   `ungated`  its `if:` is POST_GATE_IF and it does not need `gateJob`.
 * `cond` is the job-level `if:` text, or null. Jobs in none of the three are
 * left out. A call job's children (`calledBy`, from parseResolvedWorkflows) are
 * graded through their call job, never on their own.
 */
export function postGateClass(wf, gateJob) {
  const out = [];
  for (const [id, job] of wf.jobs) {
    if (id === gateJob || job.calledBy) continue;
    const cond = job.jobIf === null ? null : job.jobIf.cond;
    const needsGate = job.needs.includes(gateJob);
    if (needsGate && cond === POST_GATE_IF) out.push({ id, kind: 'post', cond });
    else if (needsGate) out.push({ id, kind: 'wide-if', cond });
    else if (cond === POST_GATE_IF) out.push({ id, kind: 'ungated', cond });
  }
  return out;
}

/** The ids of `wf`'s post-gate jobs after aggregator `gateJob` (postGateClass `post`). */
export const postGateJobs = (wf, gateJob) => postGateClass(wf, gateJob).filter((c) => c.kind === 'post').map((c) => c.id);

/**
 * WHERE A LANE FILE RUNS. ⏱ 2026-09-25 [ADR 095 §4] A lane names the file that
 * holds its steps. A `workflow_call`-only file never runs on its own: it runs as
 * the children of the ONE call job that calls it, under that caller's `on:`, run
 * number and run id. `scan` is parseResolvedWorkflows(root). Returns one of:
 *   `{ workflow: file, callJob: null, children: null }`  `file` runs as itself;
 *   `{ workflow, callJob, children }`  exactly one call job runs it: `workflow` is
 *       the caller, `children` its resolved `<callJob>/<job>` jobs;
 *   `{ refusal: { kind, at, path, hosts } }`  `kind` is `orphan-callee` (no call
 *       job runs it), `ambiguous-callee` (two or more do: reading one would leave
 *       the other ungraded) or `missing` (no such workflow).
 * The one derivation every lane reader uses; laneRefusalText is its sentence.
 */
export function laneRunHost(scan, file) {
  if (scan.workflows.some((w) => w.rel === file)) return { workflow: file, callJob: null, children: null };
  const hosts = new Map();
  for (const wf of scan.workflows) {
    for (const job of wf.jobs.values()) {
      if (job.callee !== file) continue;
      const key = `${wf.rel}#${job.calledBy}`;
      if (!hosts.has(key)) hosts.set(key, { workflow: wf.rel, callJob: job.calledBy, children: [] });
      hosts.get(key).children.push(job);
    }
  }
  if (hosts.size === 1) return [...hosts.values()][0];
  const kind = hosts.size > 1 ? 'ambiguous-callee' : scan.filesRead.includes(file) ? 'orphan-callee' : 'missing';
  return { refusal: { kind, at: hosts.size > 1 ? [...hosts.keys()].join(', ') : `${file}:1`, path: file, hosts: hosts.size } };
}

/** The one sentence a lane reader prints when laneRunHost refused. */
export const laneRefusalText = (r) =>
  r.kind === 'ambiguous-callee'
    ? `${r.path} is \`workflow_call\`-only and ${r.hosts} call job(s) run it (${r.at}). A lane has ONE run host; grading one of them would leave the other unread.`
    : r.kind === 'orphan-callee'
      ? `${r.path} is \`workflow_call\`-only and no call job runs it (orphan-callee), so the lane it names never runs.`
      : `${r.path} is not a workflow in this tree (missing).`;
