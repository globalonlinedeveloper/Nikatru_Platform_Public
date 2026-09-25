#!/usr/bin/env node
// ───────────────────────────────────────────────────────────
// assert-deploy-ref.mjs — a publishing job refuses to run from any ref but the one
// its trigger allows (row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 2).
//
// Usage (the FIRST step of a publishing job, after checkout; no setup-node needed):
//   node tooling/ci/assert-deploy-ref.mjs --allow main
//   node tooling/ci/assert-deploy-ref.mjs --allow 'tag:fullshot-v[0-9]+.[0-9]+.[0-9]+'
//
//   --allow main          GITHUB_REF must be exactly refs/heads/main
//   --allow tag:<filter>  GITHUB_REF must be refs/tags/<name>, <name> matched by the
//                         GitHub tag-filter reading in workflow-scan.mjs (the same one
//                         the trigger's own `tags:` list is read with)
//   --allow is repeatable; the ref passes when ANY one allows it.
//
// It reads two environment variables the runner sets on every job, GITHUB_EVENT_NAME
// and GITHUB_REF. In a reusable workflow both are the CALLER's, so a deploy callee
// that ci.yml calls on a push to main sees `push` and `refs/heads/main`.
//
// Only `push` and `workflow_dispatch` may publish. Every other event is refused BY
// NAME: a `schedule` or `workflow_run` runs whatever the default branch holds, a
// `pull_request*` runs contributor code, and none of them is an owner deciding to ship.
//
// Why a step and not only `environment:` (ADR 031 class A): an `environment:` that
// names an environment nobody created is created by GitHub on the first run, with no
// protection rules and no branch policy, and the job runs. Until the owner sets the
// environment's deployment branches, this step is the refusal.
//
// Exit: 0 the ref is allowed · 1 it is not (a finding: NOTHING publishes) ·
//       2 usage, an unreadable --allow value, or a variable the runner did not set.
// Tests: tooling/ci/test/deploy-ref.test.mjs
// ───────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refFilterToRegExp } from './workflow-scan.mjs';

export const PUBLISH_EVENTS = ['push', 'workflow_dispatch'];

/** Thrown for anything that is not a verdict: exit 2, never 1. */
export class DeployRefUsage extends Error {}

/**
 * The --allow values, read. Returns `[{ kind: 'main' } | { kind: 'tag', filter, re }]`.
 * A negative (`!`) filter is refused: a lone negative allows nothing, which would
 * make a job that can never publish look like a guarded one.
 */
export function parseAllow(argv) {
  const allow = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let value;
    if (a === '--allow') {
      value = argv[++i];
      if (value === undefined) throw new DeployRefUsage('--allow needs a value: main, or tag:<filter>');
    } else if (a.startsWith('--allow=')) {
      value = a.slice('--allow='.length);
    } else {
      throw new DeployRefUsage(`unknown argument "${a}"`);
    }
    if (value === 'main') {
      allow.push({ kind: 'main' });
    } else if (value.startsWith('tag:')) {
      const filter = value.slice('tag:'.length);
      if (filter.startsWith('!')) throw new DeployRefUsage(`--allow ${value}: a negative tag filter allows nothing`);
      let re;
      try {
        re = refFilterToRegExp(filter);
      } catch (e) {
        throw new DeployRefUsage(`--allow ${value}: ${e.message}`);
      }
      allow.push({ kind: 'tag', filter, re });
    } else {
      throw new DeployRefUsage(`--allow ${value}: expected main, or tag:<filter>`);
    }
  }
  if (allow.length === 0) throw new DeployRefUsage('no --allow given: a check that allows nothing is not a check');
  return allow;
}

/** `{ ok, why }` for one event/ref pair against the parsed allow list. */
export function decide(allow, event, ref) {
  if (!event) throw new DeployRefUsage('GITHUB_EVENT_NAME is not set: this is not a GitHub Actions job');
  if (!ref) throw new DeployRefUsage('GITHUB_REF is not set: this is not a GitHub Actions job');
  if (!PUBLISH_EVENTS.includes(event)) {
    return { ok: false, why: `the event is "${event}"; only ${PUBLISH_EVENTS.join(' and ')} may publish` };
  }
  for (const a of allow) {
    if (a.kind === 'main' && ref === 'refs/heads/main') return { ok: true, why: `${ref} is main` };
    if (a.kind === 'tag' && ref.startsWith('refs/tags/') && a.re.test(ref.slice('refs/tags/'.length))) {
      return { ok: true, why: `${ref} matches tag:${a.filter}` };
    }
  }
  const wanted = allow.map((a) => (a.kind === 'main' ? 'refs/heads/main' : `refs/tags/${a.filter}`)).join(' or ');
  return { ok: false, why: `${ref} is not ${wanted}` };
}

function main() {
  let allow;
  let verdict;
  try {
    allow = parseAllow(process.argv.slice(2));
    verdict = decide(allow, process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF);
  } catch (e) {
    if (!(e instanceof DeployRefUsage)) throw e;
    console.error(`assert-deploy-ref: REFUSED — ${e.message}`);
    process.exit(2);
  }
  if (!verdict.ok) {
    console.error(`::error::assert-deploy-ref: this job publishes, and ${verdict.why}. Nothing publishes from this run.`);
    console.error('  Re-run it from the ref its trigger allows. A dispatch from any other branch or tag is refused');
    console.error('  here even before the environment\'s own deployment-branch policy exists (row O-DEPLOY-IS-NOT-ONE-GATED-LANE).');
    process.exit(1);
  }
  console.log(`assert-deploy-ref: ok — ${process.env.GITHUB_EVENT_NAME}, ${verdict.why}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
