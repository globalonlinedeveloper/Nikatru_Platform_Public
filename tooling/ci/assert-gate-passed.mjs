#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-gate-passed.mjs — no commit deploys unless the gate passed on IT.
//
// Deploy workflows trigger on `push: branches:[main]` with no dependency on CI,
// so the deploy and the tests start at the same instant and the deploy finishes
// first (~3 min vs ~6). Nothing ever asked the gate for its verdict. The manual
// `workflow_dispatch` "redeploy / rollback button" consulted nothing at all —
// and that is the button you press when something is already wrong.
//
// This POLLS rather than reads once, precisely because at deploy time `ci-gate`
// is usually still running. It FAILS CLOSED: unknown, timed out, cancelled or
// absent all exit non-zero. A deploy blocked by a slow API is recoverable; a
// deploy that shipped an unverified commit to production is not.
//
// ⚠️ NEVER call `process.exit()` in this file. Exiting while a fetch handle is
// still closing aborts Node on Windows with
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
// and returns 127 for BOTH outcomes — which in a fail-closed check silently
// blocks every deploy, including the ones that passed. Found by negative-testing
// this script before wiring it up. Set `process.exitCode` and return instead.
//
// Pipeline requirement: Private/requirements/ → F-5b.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/assert-gate-passed.mjs <sha> [--timeout-seconds N]
//   env:  GITHUB_TOKEN (or GH_TOKEN), GITHUB_REPOSITORY (owner/repo)
// Exit 0 = the gate passed for this exact SHA. 1 = anything else.
// ─────────────────────────────────────────────────────────────────────────────

/** The required check. Verified against the live check-run list before this was
 *  wired up: a wrong name here would block every deploy forever while looking
 *  like a legitimate failure. It must match `ci.yml` → job `ci-gate` → `name:`. */
const GATE = 'ci-gate';

const POLL_SECONDS = 15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg, hint) {
  console.error(`✗ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exitCode = 1;
}

async function fetchGate(repo, sha, token) {
  const url = `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'nikatru-assert-gate-passed',
      },
    });
  } catch (err) {
    // Network blip — retry rather than reading it as "no gate" either way.
    return { transient: true, status: String(err?.message ?? err), run: null };
  }
  if (!res.ok) return { transient: true, status: res.status, run: null };
  const body = await res.json();
  const run = (body.check_runs ?? []).find((c) => c.name === GATE) ?? null;
  return { transient: false, status: res.status, run };
}

async function main() {
  const args = process.argv.slice(2);
  const timeoutIdx = args.indexOf('--timeout-seconds');
  const timeoutSeconds = timeoutIdx >= 0 ? Number(args[timeoutIdx + 1]) : 1200;
  // Skip the flag AND its value, else `--timeout-seconds 10` with no SHA parses
  // "10" as the commit and reports a confusing timeout instead of "no SHA given".
  // ⚠️ Guard the -1: `indexOf` returns -1 when the flag is ABSENT, and -1 + 1 = 0
  // would then discard argv[0] — the SHA — on the exact invocation CI uses.
  // That shipped once and failed both deploys; it was not caught locally because
  // every local test passed the flag. Always test the no-flag form too.
  const skipIdx = timeoutIdx >= 0 ? timeoutIdx + 1 : -1;
  const positional = args.filter((a, i) => !a.startsWith('--') && i !== skipIdx);
  const sha = positional[0];

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (!sha) return fail('no commit SHA given', 'usage: assert-gate-passed.mjs <sha>');
  if (!repo) return fail('GITHUB_REPOSITORY is not set');
  if (!token) return fail('GITHUB_TOKEN / GH_TOKEN is not set', 'the job needs `permissions: checks: read`');
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return fail('--timeout-seconds must be a positive number');
  }

  console.log(`waiting for "${GATE}" on ${sha.slice(0, 8)} (timeout ${timeoutSeconds}s)`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastSeen = 'not started';

  while (Date.now() < deadline) {
    const { transient, status, run } = await fetchGate(repo, sha, token);

    if (transient) {
      console.log(`  … github api returned ${status}, retrying`);
    } else if (!run) {
      lastSeen = 'not started';
      console.log('  … no ci-gate check on this commit yet');
    } else if (run.status !== 'completed') {
      lastSeen = run.status;
      console.log(`  … ci-gate is ${run.status}`);
    } else if (run.conclusion === 'success') {
      console.log(`ok  ci-gate passed for ${sha.slice(0, 8)} — deploy may proceed`);
      return;
    } else {
      // Completed and not success: decided, and the answer is no. Do not wait.
      return fail(
        `ci-gate concluded "${run.conclusion}" for ${sha.slice(0, 8)} — refusing to deploy`,
        run.html_url ?? '',
      );
    }

    if (Date.now() + POLL_SECONDS * 1000 >= deadline) break;
    await sleep(POLL_SECONDS * 1000);
  }

  return fail(
    `timed out after ${timeoutSeconds}s waiting for "${GATE}" on ${sha.slice(0, 8)} (last seen: ${lastSeen})`,
    'Failing closed. If CI genuinely does not run for this commit, that is the bug — not this check.',
  );
}

await main();
