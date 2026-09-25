#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// lane-detect.mjs — does this change affect a CI lane? [ADR 095]
//
// Each lane callee (.github/workflows/lane-<name>.yml, `on: workflow_call` only)
// owns a `detect` job, and that job's one step is this script. ci.yml calls the
// callee with no `if:` (assert-green-means-ran A6), so the CALL always runs and the
// decision to do the lane's work is taken inside the callee, where lane-verdict.mjs
// can tell a licensed skip from a lane that went dark.
//
// ONE MAP, ONE DETECTOR. The paths each lane answers to are in
// tooling/ci/lane-map.json. deploy-workers.yml's dorny/paths-filter block (gone
// 2026-09-25) was the shape this replaced: a filter list per workflow, each kept honest by its
// own guard, is five lists for five lanes. This reads one register.
//
//   node tooling/ci/lane-detect.mjs --lane <name> [--root <dir>]
//     Writes `affected=true|false` and `reason=<why>` to $GITHUB_OUTPUT (and prints
//     both). affected=true when ANY of:
//       · the event is not a pull_request (a push to main, a dispatch, a schedule):
//         there is no PR diff to narrow the work, and main is never narrowed;
//       · a changed path matches the lane's globs;
//       · a changed path matches NO entry in the map at all — unmapped runs every
//         lane, because a path nobody has placed is a path nobody has reasoned about;
//       · the diff cannot be computed, or names zero paths. It FAILS OPEN and says why:
//         a detector that cannot see the change must not be the reason work was skipped.
//     The diff is `git diff --name-only <base.sha>...<head.sha>` from the
//     pull_request payload ($GITHUB_EVENT_PATH); the detect job checks out with
//     fetch-depth: 0 so the merge base is present. No third-party filter action.
//
//   node tooling/ci/lane-detect.mjs --check [--root <dir>]
//     The map's guard, run by guard-meta. Exit 1 when a tracked file matches no lane
//     and no `unclaimed` glob (a path added without placing it), when a glob matches
//     no tracked file (a dead claim that reads as coverage), or when a lane's
//     `callee` is missing or its detect step names another lane.
//
// Exit 0 = decided (or map clean). Exit 1 = a finding (--check). Exit 2 = COVERAGE
// LOST: the map is unreadable, the lane is not in it, or `git ls-files` listed
// nothing — the detector could not decide, which is never a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from './workflow-scan.mjs';

export const MAP_REL = 'tooling/ci/lane-map.json';

class CoverageLost extends Error {}

/** One glob as an anchored RegExp. `**` spans any number of path segments
 *  (including none), `*` and `?` stay inside one segment. Nothing else is special:
 *  a map that needs more syntax should say so by failing here, not by matching
 *  something unexpected. */
export function globToRegExp(glob) {
  if (typeof glob !== 'string' || glob === '' || glob.startsWith('/') || /[[\]{}]/.test(glob)) {
    throw new CoverageLost(`glob ${JSON.stringify(glob)} is not in the supported syntax (relative path, ** and * and ? only)`);
  }
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slashAfter = glob[i + 2] === '/';
      re += slashAfter ? '(?:.*/)?' : '.*';
      i += slashAfter ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The map, validated. Throws CoverageLost on anything the detector cannot use. */
export function readMap(root) {
  const p = join(root, MAP_REL);
  if (!existsSync(p)) throw new CoverageLost(`${MAP_REL} does not exist under ${root}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new CoverageLost(`${MAP_REL} could not be parsed (${e.message})`);
  }
  const lanes = raw?.lanes;
  if (lanes === null || typeof lanes !== 'object' || Array.isArray(lanes) || Object.keys(lanes).length === 0) {
    throw new CoverageLost(`${MAP_REL} has no \`lanes\` object, so no lane could be decided`);
  }
  if (!Array.isArray(raw.unclaimed)) throw new CoverageLost(`${MAP_REL} has no \`unclaimed\` array`);
  const out = { lanes: new Map(), unclaimed: [] };
  for (const [name, lane] of Object.entries(lanes)) {
    if (!Array.isArray(lane?.globs) || lane.globs.length === 0) {
      throw new CoverageLost(`${MAP_REL} lane "${name}" has no globs: a lane that claims nothing would never run on a pull request`);
    }
    out.lanes.set(name, {
      callee: typeof lane.callee === 'string' ? lane.callee : null,
      globs: lane.globs.map((g) => ({ glob: g, re: globToRegExp(g) })),
    });
  }
  out.unclaimed = raw.unclaimed.map((g) => ({ glob: g, re: globToRegExp(g) }));
  return out;
}

/** Which entries claim one path: the lane names, and whether `unclaimed` does. */
export function claimsOf(map, path) {
  const lanes = [];
  for (const [name, lane] of map.lanes) if (lane.globs.some((g) => g.re.test(path))) lanes.push(name);
  return { lanes, unclaimed: map.unclaimed.some((g) => g.re.test(path)) };
}

/**
 * The decision, as a pure function of what the job can see.
 *   event    GITHUB_EVENT_NAME
 *   changed  the PR's changed paths, or null when they could not be read
 *   diffWhy  why they could not be read (with changed === null)
 */
export function decide({ map, lane, event, changed, diffWhy }) {
  if (!map.lanes.has(lane)) throw new CoverageLost(`lane "${lane}" is not in ${MAP_REL} (lanes: ${[...map.lanes.keys()].join(', ')})`);
  if (event !== 'pull_request') {
    return { affected: true, reason: `event is ${event || '(unset)'}, not a pull_request: every lane runs` };
  }
  if (changed === null) return { affected: true, reason: `the diff could not be computed (${diffWhy}): failing open` };
  if (changed.length === 0) return { affected: true, reason: 'the diff named zero paths, which is not read as "nothing changed": failing open' };
  const unmapped = [];
  const inLane = [];
  for (const p of changed) {
    const c = claimsOf(map, p);
    if (c.lanes.length === 0 && !c.unclaimed) unmapped.push(p);
    if (c.lanes.includes(lane)) inLane.push(p);
  }
  if (unmapped.length) {
    return { affected: true, reason: `unmapped ${unmapped.slice(0, 5).join(', ')}${unmapped.length > 5 ? ` (+${unmapped.length - 5} more)` : ''}: a path the map does not name runs every lane` };
  }
  if (inLane.length) {
    return { affected: true, reason: `${inLane.length} changed path(s) in lane ${lane}, first ${inLane[0]}` };
  }
  return { affected: false, reason: `none of ${changed.length} changed path(s) is in lane ${lane}, and every one is mapped` };
}

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The PR's changed paths, or { changed: null, why } — never a throw. */
export function changedPaths(root, eventPath) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (e) {
    return { changed: null, why: `the event payload ${eventPath || '(GITHUB_EVENT_PATH unset)'} could not be read: ${e.message}` };
  }
  const base = payload?.pull_request?.base?.sha;
  const head = payload?.pull_request?.head?.sha;
  if (!SHA.test(String(base)) || !SHA.test(String(head))) {
    return { changed: null, why: `the payload carries no pull_request.base.sha / head.sha (got ${String(base)} / ${String(head)})` };
  }
  try {
    const out = execFileSync('git', ['-C', root, 'diff', '--name-only', '-z', `${base}...${head}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { changed: out.split('\0').filter(Boolean), why: null };
  } catch (e) {
    const err = String(e.stderr ?? e.message).trim().split('\n')[0];
    return { changed: null, why: `git diff ${base.slice(0, 12)}...${head.slice(0, 12)} failed: ${err}` };
  }
}

/** --check: every tracked file is claimed, every glob is alive, every callee names its lane. */
export function checkMap(root, map, tracked) {
  const problems = [];
  const unclaimedFiles = tracked.filter((p) => {
    const c = claimsOf(map, p);
    return c.lanes.length === 0 && !c.unclaimed;
  });
  if (unclaimedFiles.length) {
    problems.push(
      `${unclaimedFiles.length} tracked file(s) match no lane and no \`unclaimed\` glob in ${MAP_REL}: ${unclaimedFiles.slice(0, 10).join(', ')}` +
        `${unclaimedFiles.length > 10 ? ` (+${unclaimedFiles.length - 10} more)` : ''}. ` +
        'Every one of them runs EVERY lane on every pull request that touches it. Place it: add it to the lane(s) whose jobs read it, or to `unclaimed` if no lane does.',
    );
  }
  const entries = [
    ...[...map.lanes].flatMap(([name, lane]) => lane.globs.map((g) => ({ where: `lane "${name}"`, ...g }))),
    ...map.unclaimed.map((g) => ({ where: '`unclaimed`', ...g })),
  ];
  for (const e of entries) {
    if (tracked.some((p) => e.re.test(p))) continue;
    problems.push(`${MAP_REL} ${e.where} glob "${e.glob}" matches no tracked file. A dead claim reads as coverage; delete it or correct it.`);
  }
  for (const [name, lane] of map.lanes) {
    if (lane.callee === null) continue;
    // Through workflow-scan, which blanks comments: a commented-out detect step
    // names no lane.
    const wf = parseWorkflow(root, lane.callee);
    if (wf === null) {
      problems.push(`${MAP_REL} lane "${name}" names callee ${lane.callee}, which does not exist.`);
      continue;
    }
    const text = wf.lines.map((l) => l.text).join('\n');
    const named = [...text.matchAll(/lane-detect\.mjs\s+--lane[ =]+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    if (!named.includes(name)) {
      problems.push(
        `${lane.callee} is lane "${name}"'s callee in ${MAP_REL}, but its detect step runs lane-detect.mjs for ${named.length ? named.map((n) => `"${n}"`).join(', ') : 'no lane'}. ` +
          'The callee would be deciding its work from another lane\'s globs.',
      );
    }
  }
  return problems;
}

function trackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  if (i !== -1) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq === undefined ? undefined : eq.slice(name.length + 1);
}

function main(argv, env) {
  const root = resolve(arg(argv, '--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const map = readMap(root);
  if (argv.includes('--check')) {
    const tracked = trackedFiles(root);
    if (tracked.length === 0) throw new CoverageLost(`git ls-files listed ZERO tracked files under ${root}, so no claim could be checked`);
    const problems = checkMap(root, map, tracked);
    if (problems.length) {
      for (const p of problems) console.error(`FAIL ${p}`);
      console.error('\nlane-detect --check: FAILED');
      return 1;
    }
    const globs = [...map.lanes.values()].reduce((n, l) => n + l.globs.length, 0) + map.unclaimed.length;
    console.log(
      `ok  lane map — ${tracked.length} tracked file(s) each claimed by a lane or \`unclaimed\`, ` +
        `${globs} path pattern(s) over ${map.lanes.size} lane(s) each matching a tracked file, ` +
        `${[...map.lanes.values()].filter((l) => l.callee !== null).length} callee(s) naming their own lane`,
    );
    return 0;
  }
  const lane = arg(argv, '--lane');
  if (!lane) throw new CoverageLost('neither --lane <name> nor --check was given');
  const event = env.GITHUB_EVENT_NAME ?? '';
  const { changed, why } = event === 'pull_request' ? changedPaths(root, env.GITHUB_EVENT_PATH) : { changed: null, why: null };
  const { affected, reason } = decide({ map, lane, event, changed, diffWhy: why });
  const oneLine = reason.replace(/[\r\n]+/g, ' ');
  console.log(`lane ${lane}: affected=${affected}`);
  console.log(`reason: ${oneLine}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `affected=${affected}\nreason=${oneLine}\n`);
  return 0;
}

/** The detector could not decide: exit 2, never a pass. */
function coverageLost(why) {
  console.error(`FAIL COVERAGE LOST — ${why}`);
  console.error('\nlane-detect: FAILED (exit 2 — the detector could not decide, which is never a pass)');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2), process.env);
  } catch (e) {
    if (!(e instanceof CoverageLost)) throw e;
    coverageLost(e.message);
  }
}
