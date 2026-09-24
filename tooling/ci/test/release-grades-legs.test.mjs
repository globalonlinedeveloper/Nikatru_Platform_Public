// The extension release grades the workflow that actually runs the per-tool legs.
//
// O-EXTENSION-RELEASE-GRADES-THE-WRONG-WORKFLOW: the release job's grading step
// asked GitHub for ci.yml runs and looked in them for `gates · <id>`,
// `sims · <id> · …` and `package · <id> · …`. Those jobs are defined in
// extensions.yml and in no other workflow, so the query could never find them:
// the step refused every real tag, and a skipped leg list was the only thing
// it was ever going to see.
//
// This file reads the release job's step as TEXT — the workflow(s) it queries
// and the job-name families its grade() recognises — and fails when a queried
// workflow does not define (itself, or through a local call one level deep) a job
// for every graded family. ⏱ 2026-09-24: the legs moved to extensions-ci.yml,
// which ci.yml calls, so the red control now points the query at deploy-web.yml.
// No tag is pushed to prove it: pushing a tag is the owner's act.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LANE = '.github/workflows/extensions.yml';
/** ⏱ 2026-09-24: the per-tool legs moved here; ci.yml and extensions.yml both call it. */
const CALLEE = '.github/workflows/extensions-ci.yml';

/** The text of one top-level job, from its key to the next job key. */
function jobText(workflowText, job) {
  const lines = workflowText.split('\n');
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** What the release job's grading step queries, and what it grades. */
function gradingOf(releaseJob) {
  const targets = [...new Set([...releaseJob.matchAll(/actions\/workflows\/([A-Za-z0-9._-]+)\/runs\?([^"'\s]*)/g)].map((m) => `${m[1]}?${m[2]}`))];
  const families = [...new Set([...releaseJob.matchAll(/"(gates|sims|package) · \$id"\|/g)].map((m) => m[1]))].sort();
  return { targets, families };
}

/** Findings for one release job text, reading workflows through `read(rel)`. */
function findings(releaseJob, read) {
  const out = [];
  const { targets, families } = gradingOf(releaseJob);
  if (targets.length === 0) out.push('the release job queries no actions/workflows/<file>/runs at all, so there is nothing to hold');
  if (families.join(',') !== 'gates,package,sims') out.push(`grade() recognises [${families.join(', ')}], expected gates, package, sims`);
  for (const t of targets) {
    const [file, query] = t.split('?');
    if (!/(^|&)head_sha=/.test(query)) out.push(`${file} is queried without head_sha=, so the run it grades is not pinned to a SHA`);
    const own = read(`.github/workflows/${file}`);
    if (own === null) {
      out.push(`${file} is queried and does not exist`);
      continue;
    }
    // ⏱ 2026-09-24: a called workflow's jobs run INSIDE the caller's run, so a queried
    // workflow defines what it defines plus what its local call jobs call, one level.
    let text = own;
    for (const m of own.matchAll(/^ {4}uses: \.\/(\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml)\s*$/gm)) {
      const callee = read(m[1]);
      if (callee === null) out.push(`${file} calls ${m[1]}, which does not exist`);
      else text += `\n${callee}`;
    }
    const names = [...text.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim());
    for (const fam of families) {
      if (!names.some((n) => n.startsWith(`${fam} · \${{ matrix.tool }}`))) {
        out.push(`${file} is queried for "${fam} · <id>" legs and defines no job named "${fam} · \${{ matrix.tool }}…"`);
      }
    }
    if (families.includes('package') && !/windows-2022/.test(jobText(text, 'package') ?? '')) {
      out.push(`${file}'s package job has no windows-2022 leg, and grade() requires one`);
    }
  }
  return out;
}

const readReal = (rel) => (existsSync(join(REPO, rel)) ? readFileSync(join(REPO, rel), 'utf8') : null);

describe('the extension release grades where the legs run', () => {
  const release = jobText(readReal(LANE), 'release');

  test('the release job and its grading step are found', () => {
    assert.ok(release, `${LANE} has no top-level release job`);
    const { targets, families } = gradingOf(release);
    assert.ok(targets.length >= 1, 'no runs query found in the release job');
    assert.deepEqual(families, ['gates', 'package', 'sims']);
  });

  test('every queried workflow defines every graded family', () => {
    assert.deepEqual(findings(release, readReal), []);
  });

  // ⏱ 2026-09-24 — INVERTED. Until today the legs were jobs of extensions.yml and a
  // query at ci.yml was the defect; now ci.yml CALLS the lane, so ci.yml is right and
  // a workflow that neither defines nor calls the legs is the defect.
  test('the query asks ci.yml, which runs the legs through its call job', () => {
    assert.ok(gradingOf(release).targets.some((t) => t.startsWith('ci.yml?')), gradingOf(release).targets.join('\n'));
  });

  test('red control: the query pointed at a workflow that neither defines nor calls the legs is caught', () => {
    const before = release.split('actions/workflows/ci.yml/runs').length - 1;
    assert.ok(before >= 1, 'the fixture edit would hit nothing');
    const mutated = release.replaceAll('actions/workflows/ci.yml/runs', 'actions/workflows/deploy-web.yml/runs');
    const f = findings(mutated, readReal);
    assert.ok(f.some((x) => /deploy-web\.yml is queried for "gates · <id>" legs and defines no job/.test(x)), f.join('\n'));
  });

  test('red control: a graded family the called workflow does not define is caught', () => {
    const lane = readReal(CALLEE).replace(/^ {4}name: sims · /m, '    name: simulations · ');
    const f = findings(release, (rel) => (rel === CALLEE ? lane : readReal(rel)));
    assert.ok(f.some((x) => /defines no job named "sims/.test(x)), f.join('\n'));
  });

  test('red control: a call to a workflow that is missing is caught', () => {
    const f = findings(release, (rel) => (rel === CALLEE ? null : readReal(rel)));
    assert.ok(f.some((x) => /calls \.github\/workflows\/extensions-ci\.yml, which does not exist/.test(x)), f.join('\n'));
  });

  test('red control: an unpinned query is caught', () => {
    const f = findings(release.replaceAll('head_sha=', 'branch='), readReal);
    assert.ok(f.some((x) => /without head_sha=/.test(x)), f.join('\n'));
  });
});
