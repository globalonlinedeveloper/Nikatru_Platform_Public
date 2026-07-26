#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// record-deployment.mjs — leave a machine-readable marker of what went live.
//
// "What is in production right now?" was answerable only by inference: no
// deploy recorded the SHA it shipped. CLAUDE.md is explicit that done/live/
// working must never be asserted from memory, and this is the missing half of
// that rule on the deploy side.
//
// Writes a GitHub Deployment + a success status, so the answer is queryable:
//   gh api repos/<owner>/<repo>/deployments?environment=platform --jq '.[0].sha'
//
// If this step fails the job goes red AFTER a successful deploy. That is
// deliberate and it means exactly one thing: the code shipped but we cannot say
// what shipped. Treat it as a real failure — an unrecorded deploy is the state
// this script exists to abolish.
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-5b.
//
// Usage:  node tooling/ci/record-deployment.mjs <environment> [environment-url]
//   env:  GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY, GITHUB_SHA
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync } from 'node:fs';

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

async function api(path, token, repo, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'nikatru-record-deployment',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const [environment, environmentUrl] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  if (!environment) return fail('no environment given — usage: record-deployment.mjs <environment> [url]');
  if (!repo) return fail('GITHUB_REPOSITORY is not set');
  if (!sha) return fail('GITHUB_SHA is not set');
  if (!token) return fail('GH_TOKEN / GITHUB_TOKEN is not set — the job needs `permissions: deployments: write`');

  try {
    // required_contexts: [] — the gate was already enforced by
    // assert-gate-passed.mjs before anything deployed. Leaving this unset makes
    // GitHub re-derive its own contexts and reject the record, which would turn
    // a successful deploy into a red job for no real reason.
    const deployment = await api('deployments', token, repo, {
      ref: sha,
      environment,
      description: `${environment} deploy`,
      auto_merge: false,
      required_contexts: [],
      transient_environment: false,
      production_environment: true,
    });

    await api(`deployments/${deployment.id}/statuses`, token, repo, {
      state: 'success',
      ...(environmentUrl ? { environment_url: environmentUrl } : {}),
      description: `live at ${sha.slice(0, 8)}`,
    });

    console.log(`ok  recorded ${environment} live at ${sha.slice(0, 8)}${environmentUrl ? ` → ${environmentUrl}` : ''}`);

    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `**${environment} live sha:** \`${sha}\`${environmentUrl ? ` → ${environmentUrl}` : ''}\n`,
      );
    }
  } catch (err) {
    return fail(`could not record the deployment: ${err.message}`);
  }
}

await main();
