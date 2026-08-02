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
// Pipeline requirement: company/pipeline/01-foundation.md → F-5b, and
// [pipeline 10]D-9 for the store half below.
//
// ── THE STORE HALF, DECIDED BEFORE THE FIRST SUBMISSION — [10]D-9 ────────────
// A web deploy has one state ("live") and a fixed URL, so a prose description
// was enough. A STORE submission is not that: it has a REVIEW STATE that is not
// "live" for most of its life, and a LISTING URL the store issues, which is the
// only address anybody can open. `--state` and `--listing-url` carry both, in
// the round-trippable encoding declared once in tooling/ci/deployment-record.mjs.
//
// Deciding this shape after the first submission would mean re-writing a record
// that is by then the ONLY copy of what happened — the console history is
// behind an account, and D-9's question gets asked at exactly the moment nobody
// can log in.
//
// 🔴 A STORE ENVIRONMENT WITHOUT A LISTING URL IS REFUSED. The channel's `kind`
// is resolved from tooling/channel-register.json rather than guessed from the
// name, so this cannot be satisfied by renaming an environment. A store record
// whose listing nobody can open is the second source of truth D-9 exists to
// prevent: it says something shipped and gives no way to look at it.
//
// Usage:
//   node tooling/ci/record-deployment.mjs <environment> [environment-url]
//   node tooling/ci/record-deployment.mjs <environment> [url] \
//        --state <in_review|live|rejected|pulled> --listing-url <url>
//   env:  GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY, GITHUB_SHA
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeDescription, resolveEnvironment, STATES } from './deployment-record.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

/** A flag's value, or null. Written out rather than pulled from a dependency:
 *  this script runs at the end of a real deploy and must not be able to fail
 *  for a reason unrelated to the deploy. */
function flagValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`--${name} was given with no value`);
  return v;
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
  const argv = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { i++; continue; }
    positional.push(argv[i]);
  }
  const [environment, environmentUrl] = positional;
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  if (!environment) return fail('no environment given — usage: record-deployment.mjs <environment> [url] [--state <s>] [--listing-url <u>]');
  if (!repo) return fail('GITHUB_REPOSITORY is not set');
  if (!sha) return fail('GITHUB_SHA is not set');
  if (!token) return fail('GH_TOKEN / GITHUB_TOKEN is not set — the job needs `permissions: deployments: write`');

  // ── [10]D-9: the record's SHAPE, resolved before anything is written ───────
  let description;
  let state;
  let listingUrl;
  try {
    state = flagValue(argv, 'state') ?? 'live';
    listingUrl = flagValue(argv, 'listing-url');
    if (!STATES.includes(state)) {
      return fail(
        `--state "${state}" is not one of ${STATES.join(', ')}. A free-text state is a state nobody can ` +
          'query, which is the whole of what [10]D-9 asks for.',
      );
    }
    // Is this a STORE environment? Resolved from the register, never from the
    // name — otherwise renaming an environment is how you skip the rule.
    const regAbs = join(ROOT, REGISTER_REL);
    if (!existsSync(regAbs)) {
      return fail(
        `${REGISTER_REL} does not exist, so this script cannot tell a store channel from a web one and ` +
          'cannot enforce the listing-URL rule. Refusing rather than writing a record whose completeness ' +
          'nothing checked.',
      );
    }
    const register = JSON.parse(readFileSync(regAbs, 'utf8'));
    const resolved = resolveEnvironment(register, environment);
    if (resolved === null) {
      return fail(
        `no row in ${REGISTER_REL} has a \`deploymentEnvironment\` template matching "${environment}". ` +
          'An environment no channel claims is a record filed under a channel that does not exist.',
      );
    }
    if (resolved.channel.kind === 'store' && !listingUrl) {
      return fail(
        `"${environment}" is the ${resolved.channel.id} channel (kind: store) and no --listing-url was given. ` +
          'A store record whose listing nobody can open says something shipped and gives no way to look at ' +
          'it — the second source of truth [10]D-9 exists to prevent.',
      );
    }
    description = encodeDescription({ state, sha, listingUrl });
  } catch (err) {
    return fail(`could not build the deployment record: ${err.message}`);
  }

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
      // The GitHub Deployment Status `state` and [10]D-9's REVIEW state are two
      // different things and both are needed. This one says the RECORDING
      // succeeded; the encoded description says what the store thinks. A
      // submission sitting `in_review` is a successfully recorded fact.
      state: 'success',
      ...(environmentUrl ? { environment_url: environmentUrl } : {}),
      description,
    });

    console.log(
      `ok  recorded ${environment} ${state} at ${sha.slice(0, 8)}` +
        `${listingUrl ? ` · listing ${listingUrl}` : ''}${environmentUrl ? ` → ${environmentUrl}` : ''}`,
    );

    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `**${environment} ${state} sha:** \`${sha}\`${listingUrl ? ` · [listing](${listingUrl})` : ''}` +
          `${environmentUrl ? ` → ${environmentUrl}` : ''}\n`,
      );
    }
  } catch (err) {
    return fail(`could not record the deployment: ${err.message}`);
  }
}

await main();
