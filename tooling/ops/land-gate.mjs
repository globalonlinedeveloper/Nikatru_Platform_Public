#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// land-gate.mjs — the I/O around land-rules.mjs. The laptop lander asks it
// instead of re-deriving the rules inline, and main-healthy.yml runs it to post
// main's health as a commit status.
//
//   pr [--file <rollup.json>]   the verdict of a PR head's ci-gate (rule a). The
//                               input is `gh pr view <n> --json
//                               headRefOid,statusCheckRollup`, on stdin or in
//                               --file; an optional `runs` array beside it is
//                               the head's workflow runs.
//   main [--repo <owner/name>]  main's health (rule b): the newest main sha,
//                               then its `main-healthy` statuses. Two reads of
//                               single objects/one commit — no run listing.
//   freeze --file <path>        the freeze file (rule c): FROZEN or OPEN.
//   publish-main-health         main-healthy.yml only: posts the status for the
//                               completed CI run in GITHUB_EVENT_PATH.
//   timing [--last N] [--repo]  P-3: the serial minutes one landing costs over
//                               the last N merged PRs (default 30): p50/p90 of
//                               ci-gate green → merge and merge → main CI green,
//                               and `serialMinutesPerPr=<p50 sum>` on its own
//                               line, the value a platform-state row records.
//                               Reads by sha only (check-runs of the head, the
//                               main runs of the merge sha), never a listing
//                               filtered by branch. Exit 0, or 2 when fewer
//                               than half the PRs could be measured.
//
// ── EXIT CONTRACT (same three meanings as the guards) ───────────────────────
//   0  GREEN (pr, main) · OPEN (freeze) · posted, or nothing to post (publish)
//   1  RED (pr, main) · FROZEN (freeze) · the status could not be posted
//   2  NOT A VERDICT — PENDING, STALE, NONE, or the input/API was unreadable.
//      A caller waits on 2; it never merges on it and never stops on it.
// The first stdout line is always `<VERDICT> <why>`.
//
// ⚠️ NO `process.exit()` once a fetch has been made — an open undici handle
// crashes libuv on Windows and returns 127 for every outcome.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateVerdict, redChecks, mainHealth, readFreeze, statusForRun, serialTiming, GATE_CHECK, isMainWorkflowRun } from './land-rules.mjs';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';
import { POST_GATE_EVENTS } from './post-gate.mjs';

const API = 'https://api.github.com';
const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const EXIT = { GREEN: 0, OPEN: 0, RED: 1, FROZEN: 1, PENDING: 2, STALE: 2, NONE: 2 };

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? null);
}

/** PURE. The `pr` answer for one parsed `gh pr view` document. */
export function prAnswer(doc) {
  if (!doc || !Array.isArray(doc.statusCheckRollup)) {
    return { code: 2, lines: ['NONE the input carries no statusCheckRollup array (pass `gh pr view <n> --json headRefOid,statusCheckRollup`)'] };
  }
  const runs = Array.isArray(doc.runs) ? doc.runs : [];
  const g = gateVerdict(doc.statusCheckRollup, { runs });
  const reds = redChecks(doc.statusCheckRollup, { runs });
  const lines = [`${g.verdict} ${g.why}`];
  if (doc.headRefOid) lines.push(`head ${String(doc.headRefOid).slice(0, 8)}`);
  lines.push(`red checks of the newest runs: ${reds.length ? reds.join('; ') : 'none'}`);
  return { code: EXIT[g.verdict] ?? 2, lines, verdict: g.verdict, reds };
}

async function getJson(path, tok) {
  const res = await fetchWithBoundedRetry(
    ({ signal }) =>
      fetch(`${API}${path}`, {
        headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'user-agent': 'nikatru-land-gate' },
        signal,
      }),
    { describe: (s) => `GET ${path} — ${s}` },
  );
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function tokenFromEnvOrVault() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const { token } = await import('./safe-rerun.mjs');
    return token();
  } catch {
    return null;
  }
}

async function main(argv) {
  const [cmd] = argv;
  const say = (lines) => {
    for (const l of lines) console.log(l);
  };
  if (cmd === 'pr') {
    const file = arg(argv, '--file');
    let doc;
    try {
      doc = JSON.parse(readFileSync(file ?? 0, 'utf8'));
    } catch (e) {
      say([`NONE the rollup could not be read (${e.message})`]);
      return 2;
    }
    const a = prAnswer(doc);
    say(a.lines);
    return a.code;
  }
  if (cmd === 'freeze') {
    const file = arg(argv, '--file');
    if (!file) {
      say(['NONE freeze needs --file <path to land.freeze>']);
      return 2;
    }
    let text = null;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        say([`NONE the freeze file could not be read (${e.message})`]);
        return 2;
      }
    }
    const f = readFreeze(text);
    say([f.frozen ? `FROZEN ${f.reason}` : 'OPEN no freeze file']);
    return f.frozen ? EXIT.FROZEN : EXIT.OPEN;
  }
  if (cmd === 'main') {
    const repo = arg(argv, '--repo') ?? process.env.GITHUB_REPOSITORY ?? 'globalonlinedeveloper/Nikatru_Platform_Public';
    if (!REPO_SHAPE.test(repo)) {
      say([`NONE ${JSON.stringify(repo).slice(0, 80)} is not an owner/name slug`]);
      return 2;
    }
    const tok = await tokenFromEnvOrVault();
    if (!tok) {
      say(['NONE no GitHub credential (GH_TOKEN, GITHUB_TOKEN or the vault)']);
      return 2;
    }
    try {
      const ref = await getJson(`/repos/${repo}/git/ref/heads/main`, tok);
      const sha = ref?.object?.sha;
      const statuses = await getJson(`/repos/${repo}/commits/${sha}/statuses?per_page=100`, tok);
      const h = mainHealth({ mainSha: sha, statuses });
      say([`${h.verdict} ${h.why}`, `main ${String(sha).slice(0, 8)}`]);
      return EXIT[h.verdict] ?? 2;
    } catch (e) {
      say([`NONE main's health could not be read (${e.message})`]);
      return 2;
    }
  }
  if (cmd === 'timing') {
    const repo = arg(argv, '--repo') ?? process.env.GITHUB_REPOSITORY ?? 'globalonlinedeveloper/Nikatru_Platform_Public';
    const last = Number(arg(argv, '--last') ?? 30);
    if (!REPO_SHAPE.test(repo) || !Number.isInteger(last) || last < 1 || last > 100) {
      say(['NONE timing needs an owner/name --repo and a whole --last from 1 to 100']);
      return 2;
    }
    const tok = await tokenFromEnvOrVault();
    if (!tok) {
      say(['NONE no GitHub credential (GH_TOKEN, GITHUB_TOKEN or the vault)']);
      return 2;
    }
    try {
      const pulls = await getJson(`/repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100`, tok);
      const merged = pulls.filter((p) => p.merged_at).sort((a, b) => b.merged_at.localeCompare(a.merged_at)).slice(0, last);
      const samples = [];
      for (const p of merged) {
        const checks = await getJson(`/repos/${repo}/commits/${p.head.sha}/check-runs?check_name=${GATE_CHECK}&per_page=100`, tok);
        const g = gateVerdict(checks.check_runs ?? []);
        // No `event=` filter: a land.yml merge's main run is a dispatch, not a push (POST_GATE_EVENTS).
        const runs = await getJson(`/repos/${repo}/actions/runs?head_sha=${p.merge_commit_sha}&per_page=20`, tok);
        const ci = (runs.workflow_runs ?? []).filter((r) => isMainWorkflowRun(r) && POST_GATE_EVENTS.includes(r.event) && r.conclusion === 'success').sort((a, b) => b.id - a.id)[0];
        const gateAt = (checks.check_runs ?? []).find((c) => c.name === GATE_CHECK && g.gate && String(c.details_url ?? '').includes(`/runs/${g.gate.run}/`))?.completed_at ?? null;
        samples.push({ pr: p.number, gateGreenAt: g.verdict === 'GREEN' ? gateAt : null, mergedAt: p.merged_at, mainGreenAt: ci?.updated_at ?? null });
      }
      const t = serialTiming(samples);
      const measured = Math.min(t.gateToMerge.n, t.mergeToMainGreen.n);
      const code = measured * 2 >= merged.length && t.serialP50 !== null ? 0 : 2;
      say([
        `${code === 0 ? 'MEASURED' : 'NONE'} ${merged.length} merged PR(s), newest #${merged[0]?.number ?? '-'} @ ${merged[0]?.merged_at ?? '-'}`,
        `gate green → merge: n ${t.gateToMerge.n}, p50 ${t.gateToMerge.p50} min, p90 ${t.gateToMerge.p90} min`,
        `merge → main CI green: n ${t.mergeToMainGreen.n}, p50 ${t.mergeToMainGreen.p50} min, p90 ${t.mergeToMainGreen.p90} min`,
        `serialMinutesPerPr=${t.serialP50}`,
      ]);
      return code;
    } catch (e) {
      say([`NONE the timing could not be read (${e.message})`]);
      return 2;
    }
  }
  if (cmd === 'publish-main-health') {
    const repo = process.env.GITHUB_REPOSITORY ?? '';
    const tok = process.env.GITHUB_TOKEN ?? '';
    let event;
    try {
      event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'));
    } catch (e) {
      say([`NONE the workflow_run event could not be read (${e.message})`]);
      return 2;
    }
    const s = statusForRun(event?.workflow_run, { repo });
    if (!s.post) {
      say([`SKIP ${s.why}`]);
      return 0;
    }
    if (!tok || !REPO_SHAPE.test(repo)) {
      say(['FAILED GITHUB_TOKEN or GITHUB_REPOSITORY is missing, so the status was not posted']);
      return 1;
    }
    const path = `/repos/${repo}/statuses/${s.post.sha}`;
    const res = await fetchWithBoundedRetry(
      ({ signal }) =>
        fetch(`${API}${path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${tok}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
            'user-agent': 'nikatru-land-gate',
          },
          body: JSON.stringify(s.post.body),
          signal,
        }),
      { describe: (x) => `POST ${path} — ${x}` },
    ).catch((e) => ({ ok: false, status: e?.message ?? 'no answer' }));
    if (!res.ok) {
      say([`FAILED POST ${path} → ${res.status}: ${s.why}`]);
      return 1;
    }
    say([`POSTED ${s.post.body.context}=${s.post.body.state} on ${s.post.sha.slice(0, 8)}: ${s.why}`]);
    return 0;
  }
  say(['NONE usage: land-gate.mjs pr [--file f] | main [--repo o/n] | freeze --file f | timing [--last N] | publish-main-health']);
  return 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.log(`NONE ${e?.message ?? e}`);
      process.exitCode = 2;
    },
  );
}
