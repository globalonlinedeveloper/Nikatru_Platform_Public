#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-build-provenance.mjs — every file a release publishes is ATTESTED and
// VERIFIED before it is described, and no other job can sign anything.
//
// ⏱ ADDED 2026-10-03 (O-RELEASES-HAVE-NO-PROVENANCE (absent from open.json until the next Private pass records it), build-provenance). There
// were zero `actions/attest*` steps in .github/, so nothing tied a release file
// to the workflow, commit and run that built it: SHA256SUMS proves the bytes
// match a list, and whoever can change a file can change the list beside it.
//
// THE SUBJECT IS DERIVED, never listed: a RELEASE JOB R is a job that runs
// `release-manifest.mjs --emit-release-json <D>` — the one step that describes what
// a Release carries; <D> is the directory it publishes. ⏱ 2026-10-03 (review of
// #1187, findings 2 and 3) the signing moved OUT of R into an attest-only job, so
// no step of a long publishing job can mint an OIDC token, and release.json and
// SHA256SUMS are attested like every other release file. For each R:
//   C  R uploads <D> (actions/upload-artifact, `path: <D>`) AFTER its
//      `release-manifest.mjs --write <D>` step — so the directory handed on holds
//      release.json and SHA256SUMS, not only the installers;
//   A  a job J of the same workflow `needs` R, downloads that artifact (its `name:`
//      equal, `${{ … }}` read as a wildcard) into <P>, and then runs
//      actions/attest-build-provenance (or actions/attest), SHA-pinned, with
//      `subject-path: <P>/*`;
//   B  J runs tooling/ci/verify-provenance.mjs `--dir <P>` after the attest — an
//      attestation nobody verified is a claim;
//   D  J grants `id-token: write` and `attestations: write` at job level.
// And across every workflow:
//   E  a job that runs `gh release create` is a release job (a Release published by
//      a job that describes nothing carries files nobody attested);
//   F  no job that attests nothing grants `id-token: write` or `attestations: write`,
//      and no workflow grants either at workflow level (that reaches every job) —
//      R included.
//
// ⚠️ THE `if:` OF THESE STEPS AND JOBS IS NOT GRADED. extensions.yml skips the
// hand-over and the attest job on a dispatch rehearsal (`inputs.dry_run != true`,
// the rule assert-publish-steps-guarded.mjs holds for anything that leaves the run);
// extensions-lane-accounting requires the attest job to SUCCEED after every other
// successful release. The attestation is made after a tag's Release is published,
// so a release whose files did not verify is a RED run (all_platforms needs the job
// in build-platforms.yml), not an unpublished one.
//
// RECORDED FAILING CASES (tooling/ci/test/build-provenance.test.mjs, and the real
// tree mutated by hand on 2026-10-03, each restored): build-platforms.yml's attest
// job deleted → exit 1 (A); `id-token: write` added back to build-platforms.yml
// `release` → exit 1 (F); extensions.yml's hand-over moved before `--write`
// → exit 1 (C); the attest job's verify pointed at another directory → exit 1 (B).
// The unmutated tree → exit 0.
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
const VERIFY = /tooling\/ci\/verify-provenance\.mjs\b/;
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
    const withKeys = {};
    const flow = s.lines.map((l) => l.match(/^\s+with:\s*\{(.*)\}\s*$/)?.[1]).find(Boolean);
    if (flow) {
      for (const kv of flow.split(',')) {
        const m = kv.match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/);
        if (m) withKeys[m[1]] = m[2];
      }
    }
    const at = s.lines.findIndex((l) => /^\s+with:\s*$/.test(l));
    if (at !== -1) {
      const indent = s.lines[at].search(/\S/);
      for (const l of s.lines.slice(at + 1)) {
        if (l.trim() === '') continue;
        if (l.search(/\S/) <= indent) break;
        const m = l.match(/^\s+([a-z-]+):\s*(\S.*?)\s*$/);
        if (m) withKeys[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
    return { n: s.n, text, uses, subjectPaths, with: withKeys };
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

const unslash = (s) => String(s ?? '').replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
/** An artifact name with every `${{ … }}` read as a wildcard, for comparing an upload with a download. */
const artifactShape = (s) => unslash(s).replace(/\$\{\{[^}]*\}\}/g, '*');
const usesAction = (s, name) => s.uses !== null && s.uses.split('@')[0] === name;

/** PURE. `{ findings, releaseJobs }` over parsed workflows. */
export function gradeProvenance(workflows) {
  const findings = [];
  const releaseJobs = [];
  for (const wf of workflows) {
    const wg = workflowGrants(wf);
    for (const s of SIGNING_SCOPES) {
      if (wg.get(s) === 'write') {
        findings.push(`F  ${wf.rel}: grants \`${s}: write\` at WORKFLOW level, which reaches every job in it. Grant it on the attest job alone.`);
      }
    }
    const steps = new Map([...wf.jobs.values()].map((j) => [j.name, jobSteps(j)]));
    for (const job of wf.jobs.values()) {
      const where = `${wf.rel}#${job.name}`;
      const js = steps.get(job.name);
      const grants = jobGrants(job);
      const attests = js.filter((s) => s.uses !== null && /^actions\/attest(?:-build-provenance)?@/.test(s.uses));
      for (const a of attests) {
        if (!ATTEST_USES.test(a.uses)) findings.push(`A  ${where}:${a.n} uses ${a.uses}, which is not pinned to a 40-hex commit SHA.`);
      }
      if (attests.length === 0) {
        for (const s of SIGNING_SCOPES) {
          if (grants.get(s) === 'write') {
            findings.push(`F  ${where}: grants \`${s}: write\` and attests nothing. Only the attest job may hold it (an OIDC token signs as this repository).`);
          }
        }
      }
      const emits = js.filter((s) => EMIT.test(s.text));
      if (js.some((s) => /\bgh\s+release\s+create\b/.test(s.text)) && emits.length === 0) {
        findings.push(`E  ${where}: runs \`gh release create\` and describes nothing with release-manifest.mjs --emit-release-json, so the files it publishes carry no attested record.`);
      }
      for (const e of emits) {
        const dir = unslash(e.text.match(EMIT)[1]);
        releaseJobs.push(`${where} (${dir})`);
        const writeAt = js.findIndex((s) => /release-manifest\.mjs\s+--write\s+/.test(s.text) &&dirArgAfter(s.text, '--write') === dir);
        const handOver = js.find((s, i) => i > writeAt && usesAction(s, 'actions/upload-artifact') && unslash(s.with.path) === dir);
        if (writeAt === -1 || !handOver) {
          findings.push(`C  ${where}:${e.n} describes ${dir}/ and uploads no artifact with \`path: ${dir}\` after its \`release-manifest.mjs --write ${dir}\` step, so the attest job cannot sign release.json and SHA256SUMS with the rest.`);
          continue;
        }
        const shape = artifactShape(handOver.with.name);
        let signed = false;
        for (const other of wf.jobs.values()) {
          if (!other.needs.includes(job.name)) continue;
          const os = steps.get(other.name);
          const down = os.findIndex((s) => usesAction(s, 'actions/download-artifact') && artifactShape(s.with.name) === shape);
          if (down === -1) continue;
          const into = unslash(os[down].with.path);
          const at = os.findIndex((s, i) => i > down && s.uses !== null && /^actions\/attest(?:-build-provenance)?@/.test(s.uses) && s.subjectPaths.some((p) => p === `${into}/*` || p === `${into}/**`));
          const owhere = `${wf.rel}#${other.name}`;
          if (at === -1) {
            findings.push(`A  ${owhere} downloads ${where}'s release directory into ${into}/ and attests no \`subject-path: ${into}/*\` after it.`);
            continue;
          }
          signed = true;
          if (!os.some((s, i) => i > at && VERIFY.test(s.text) && dirArgOf(s.text) === into)) {
            findings.push(`B  ${owhere} attests ${into}/ and no step after it runs tooling/ci/verify-provenance.mjs --dir ${into}: an attestation nobody verified is a claim.`);
          }
          const og = jobGrants(other);
          for (const s of SIGNING_SCOPES) {
            if (og.get(s) !== 'write') findings.push(`D  ${owhere}: attests a release and does not grant \`${s}: write\`, so it cannot sign.`);
          }
        }
        if (!signed) {
          findings.push(`A  ${where}:${e.n} describes ${dir}/ and no job that needs it downloads that directory and attests it (actions/attest-build-provenance, \`subject-path: <dir>/*\`): its files were never attested.`);
        }
      }
    }
  }
  return { findings, releaseJobs };
}

/** PURE. The token after `flag`, unquoted, or null. */
function dirArgAfter(text, flag) {
  const words = text.split(/\s+/);
  const i = words.indexOf(flag);
  return i === -1 || i + 1 >= words.length ? null : unslash(words[i + 1]);
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
  console.log('ok   each hands its whole release directory to an attest-only job that signs and verifies every file; no other job can sign');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
