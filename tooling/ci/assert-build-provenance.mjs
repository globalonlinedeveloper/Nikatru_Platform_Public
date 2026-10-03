#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-build-provenance.mjs — every file a release publishes is ATTESTED and
// VERIFIED before it is described, and no other job can sign anything.
//
// ⏱ ADDED 2026-10-03 (O-RELEASES-HAVE-NO-PROVENANCE, build-provenance). There
// were zero `actions/attest*` steps in .github/, so nothing tied a release file
// to the workflow, commit and run that built it: SHA256SUMS proves the bytes
// match a list, and whoever can change a file can change the list beside it.
//
// THE SUBJECT IS DERIVED, never listed: a RELEASE JOB is a job that runs
// `release-manifest.mjs --emit-release-json <dir>` — the one step that describes
// what a Release carries. `<dir>` is what that job publishes. Each one must:
//   A  run actions/attest-build-provenance (or actions/attest), SHA-pinned, with
//      `subject-path: <dir>/*`, BEFORE the describe step — so every file the
//      record names was attested, whatever its format;
//   B  run tooling/release/verify-provenance.mjs `--dir <dir>` after the attest and
//      before the describe — an attestation nobody verified is a claim;
//   C  pass `--provenance` to the describe step, so release.json records the
//      attestation per artefact (the emitter refuses a file the verify did not name);
//   D  grant `id-token: write` and `attestations: write` at job level.
// And across every workflow:
//   E  a job that runs `gh release create` is a release job (a Release published by
//      a job that describes nothing carries files nobody attested);
//   F  no job that attests nothing grants `id-token: write` or `attestations: write`,
//      and no workflow grants either at workflow level (that reaches every job).
//
// RECORDED FAILING CASES (tooling/ci/test/build-provenance.test.mjs, and the real
// tree mutated by hand on 2026-10-03): the attest step deleted from
// build-platforms.yml `release` → exit 1 (F, A); `id-token: write` added to
// build-platforms.yml `apple` → exit 1 (F); `--provenance` dropped from
// extensions.yml's describe step → exit 1 (C); its verify step pointed at another
// directory → exit 1 (B). The unmutated tree → exit 0.
//
// Usage: node tooling/ci/assert-build-provenance.mjs [--root <dir>]
// Exit 0 = clean. 1 = a finding. 2 = COVERAGE LOST (no workflow parsed, or no
// release job found: a classifier that stopped matching would report clean).
// ─────────────────────────────────────────────────────────────────────────────
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllWorkflows } from './workflow-scan.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const ATTEST_USES = /^actions\/attest(?:-build-provenance)?@[0-9a-f]{40}$/;
const EMIT = /release-manifest\.mjs\s+--emit-release-json\s+(\S+)/;
const VERIFY = /tooling\/release\/verify-provenance\.mjs\b/;
const SIGNING_SCOPES = ['id-token', 'attestations'];

function coverageLost(...lines) {
  console.error(`✗ COVERAGE LOST — ${lines.join('\n  ')}`);
  process.exit(2);
}

/** PURE. A job's steps: [{ n, text, uses, subjectPaths }], `text` its lines joined, continuations folded. */
export function jobSteps(job) {
  const steps = [];
  for (const l of job.lines) {
    if (/^ {6}- /.test(l.text)) steps.push({ n: l.n, lines: [] });
    if (steps.length) steps[steps.length - 1].lines.push(l.text);
  }
  return steps.map((s) => {
    const text = s.lines.join('\n').replace(/\\\n/g, ' ').replace(/\n\s+/g, ' ');
    const uses = s.lines.map((l) => l.match(/^\s+(?:- )?uses:\s*(\S+)/)?.[1]).find(Boolean) ?? null;
    const subjectPaths = [];
    for (const [i, l] of s.lines.entries()) {
      const m = l.match(/^(\s+)subject-path:\s*(.*)$/);
      if (!m) continue;
      if (/^[|>][-+]?$/.test(m[2].trim())) {
        for (const k of s.lines.slice(i + 1)) {
          if (k.trim() === '') continue;
          if (k.search(/\S/) <= m[1].length) break;
          subjectPaths.push(k.trim());
        }
      } else if (m[2].trim()) {
        subjectPaths.push(m[2].trim().replace(/^['"]|['"]$/g, ''));
      }
    }
    return { n: s.n, text, uses, subjectPaths };
  });
}

/** PURE. The value after a `--dir` token, unquoted, or null. */
function dirArgOf(text) {
  const words = text.split(/\s+/);
  const i = words.indexOf('--dir');
  return i === -1 || i + 1 >= words.length ? null : words[i + 1].replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
}

/** PURE. The scopes a `permissions:` block at `indent` grants, from the line after `at`. */
function grantsBelow(lines, at, indent) {
  const out = new Map();
  const flow = lines[at].text.match(/permissions:\s*\{([^}]*)\}/);
  if (flow) {
    for (const kv of flow[1].split(',')) {
      const m = kv.match(/^\s*([a-z-]+)\s*:\s*(\S+)\s*$/);
      if (m) out.set(m[1], m[2]);
    }
    return out;
  }
  for (const l of lines.slice(at + 1)) {
    if (l.text.trim() === '') continue;
    if (l.text.search(/\S/) <= indent) break;
    const m = l.text.match(/^\s+([a-z-]+):\s*(\S+)/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** PURE. The job-level scopes, from its ` {4}permissions:` block. */
export function jobGrants(job) {
  const at = job.lines.findIndex((l) => /^ {4}permissions:/.test(l.text));
  return at === -1 ? new Map() : grantsBelow(job.lines, at, 4);
}

/** PURE. The workflow-level scopes, from a top-level `permissions:` block above `jobs:`. */
export function workflowGrants(wf) {
  const head = wf.lines.slice(0, wf.jobsAt === null ? wf.lines.length : wf.jobsAt - 1);
  const at = head.findIndex((l) => /^permissions:/.test(l.text));
  return at === -1 ? new Map() : grantsBelow(head, at, 0);
}

/** PURE. `{ findings, releaseJobs }` over parsed workflows. */
export function gradeProvenance(workflows) {
  const findings = [];
  const releaseJobs = [];
  for (const wf of workflows) {
    const wg = workflowGrants(wf);
    for (const s of SIGNING_SCOPES) {
      if (wg.get(s) === 'write') {
        findings.push(`F  ${wf.rel}: grants \`${s}: write\` at WORKFLOW level, which reaches every job in it. Grant it on the release job alone.`);
      }
    }
    for (const job of wf.jobs.values()) {
      const where = `${wf.rel}#${job.name}`;
      const steps = jobSteps(job);
      const grants = jobGrants(job);
      const attests = steps.filter((s) => s.uses !== null && /^actions\/attest(?:-build-provenance)?@/.test(s.uses));
      const emits = steps.filter((s) => EMIT.test(s.text));
      const publishes = steps.some((s) => /\bgh\s+release\s+create\b/.test(s.text));
      for (const a of attests) {
        if (!ATTEST_USES.test(a.uses)) findings.push(`A  ${where}:${a.n} uses ${a.uses}, which is not pinned to a 40-hex commit SHA.`);
      }
      if (attests.length === 0) {
        for (const s of SIGNING_SCOPES) {
          if (grants.get(s) === 'write') {
            findings.push(`F  ${where}: grants \`${s}: write\` and attests nothing. Only a release job that attests may hold it (an OIDC token signs as this repository).`);
          }
        }
      }
      if (publishes && emits.length === 0) {
        findings.push(`E  ${where}: runs \`gh release create\` and describes nothing with release-manifest.mjs --emit-release-json, so the files it publishes carry no attested record.`);
      }
      for (const e of emits) {
        const dir = e.text.match(EMIT)[1].replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
        releaseJobs.push(`${where} (${dir})`);
        const at = steps.indexOf(e);
        const attest = attests.find((a) => steps.indexOf(a) < at && a.subjectPaths.some((p) => p === `${dir}/*` || p === `${dir}/**`));
        if (!attest) {
          findings.push(`A  ${where}:${e.n} describes ${dir}/ with no actions/attest-build-provenance step BEFORE it whose subject-path is \`${dir}/*\`: the files release.json names were never attested.`);
        }
        const from = attest ? steps.indexOf(attest) : -1;
        const verified = steps.some((s, i) => i > from && i < at && VERIFY.test(s.text) && dirArgOf(s.text) === dir);
        if (!verified) {
          findings.push(`B  ${where}:${e.n} describes ${dir}/ and no step between the attest and the describe runs tooling/release/verify-provenance.mjs --dir ${dir}: an attestation nobody verified is a claim.`);
        }
        if (!/--provenance\b/.test(e.text)) {
          findings.push(`C  ${where}:${e.n} describes ${dir}/ without --provenance, so release.json names no attestation for any artefact.`);
        }
        for (const s of SIGNING_SCOPES) {
          if (grants.get(s) !== 'write') findings.push(`D  ${where}: describes a release and does not grant \`${s}: write\`, so it cannot attest.`);
        }
      }
    }
  }
  return { findings, releaseJobs };
}

function main(argv) {
  // `--root <dir>`: another tree to grade (the tests' fixtures); the default is this checkout.
  const i = argv.indexOf('--root');
  const root = i === -1 ? ROOT : resolve(argv[i + 1] ?? '');
  const workflows = parseAllWorkflows(root);
  if (workflows.length === 0) coverageLost('no workflow under .github/workflows parsed, so no release job could be graded.');
  const { findings, releaseJobs } = gradeProvenance(workflows);
  if (releaseJobs.length === 0) {
    coverageLost(
      `${workflows.length} workflow(s) parsed and no job runs release-manifest.mjs --emit-release-json.`,
      'Either the release lanes moved or this classifier stopped matching; "every release file is attested" would be a claim about nothing.',
    );
  }
  console.log(`ok   ${releaseJobs.length} release job(s) graded: ${releaseJobs.join(' · ')}`);
  if (findings.length) {
    for (const f of findings) console.error(`FAIL ${f}`);
    console.error(`\nassert-build-provenance: FAILED (${findings.length} finding(s))`);
    return 1;
  }
  console.log('ok   each attests its release directory, verifies it, and records the attestation in release.json; no other job can sign');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
