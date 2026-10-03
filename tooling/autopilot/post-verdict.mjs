#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// post-verdict.mjs — post an independent review's verdict to GitHub, pinned to the
// head it read. Used by the laptop (primary reviewer) and by the cloud `reviewer`
// routine (docs/autopilot/reviewer.prompt.md) when the laptop is off.
//
// ⏱ 2026-10-02 · lane autopilot-reviews, row O-REVIEWS-DEPEND-ON-THE-LAPTOP.
// Every PR here is authored by the repository owner, and the cloud acts as that same
// user through the `claude` GitHub App; GitHub refuses APPROVE and REQUEST_CHANGES
// from a PR's author. So a verdict is a COMMENT review plus labels, and land-next.mjs
// (`reviewVerdict`) reads the review's first line. This NEVER sends an APPROVE event.
//
// STEPS:
//   1. re-read the PR head; REFUSE (nothing posted) unless it is `--head`
//   2. POST a review: event COMMENT, commit_id <head>, body = the file's line 1,
//      then `Head: <sha>`, then the rest of the file
//   3. set `review:approve` or `review:changes`, removing the other
//   4. on APPROVE, add `land-ok` unless `land-hold` is present
//
// The token is GH_TOKEN / GITHUB_TOKEN, else `gh auth token` (spawned shell:false —
// this runs on the Windows laptop). It is never printed.
//
// Usage: node tooling/autopilot/post-verdict.mjs --pr <n> --head <sha> --verdict-file <file> [--repo o/r]
// Exit 0 = posted. 1 = refused (head moved, bad verdict file) or a write failed. 2 = bad usage / no token.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { envToken, flag, ghSpawnSpec, isMain, redact } from './cli.mjs';
import { LABELS, restClient } from './review-paths.mjs';

/** The verdict lines this posts, and what each is posted as. The repo's review format
 *  also writes `APPROVE WITH NITS` and `CHANGES REQUIRED`: NITS is an APPROVE (a nit
 *  never blocks) and is posted as the canonical `VERDICT: APPROVE`, the only line
 *  land-next.mjs approves on; CHANGES REQUIRED is posted as `VERDICT: CHANGES`. The
 *  original line follows as `Verdict as written: …`. Any other line 1 is refused. */
export const VERDICT_LINE = /^VERDICT: (APPROVE|CHANGES|APPROVE WITH NITS|CHANGES REQUIRED)\s*$/;
export const VERDICT_MAP = Object.freeze({ APPROVE: 'APPROVE', 'APPROVE WITH NITS': 'APPROVE', CHANGES: 'CHANGES', 'CHANGES REQUIRED': 'CHANGES' });
/** GitHub's review body limit; a longer verdict is refused, never cut. */
export const VERDICT_MAX = 65_000;
const SECRET = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const DEFAULT_REPO = 'globalonlinedeveloper/Nikatru_Platform_Public';

/**
 * PURE. The PR as read now, the head the review read, the verdict file's text →
 * { refuse } or { verdict, review, add, remove }.
 */
export function planVerdict({ pr, head, text }) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const m = VERDICT_LINE.exec(lines[0] ?? '');
  if (!m) return { refuse: 'the verdict file\'s first line is not `VERDICT: APPROVE`, `VERDICT: APPROVE WITH NITS`, `VERDICT: CHANGES` or `VERDICT: CHANGES REQUIRED`' };
  // The file's text is posted to the GitHub API; it is held to a verdict's shape first.
  if (String(text).length > VERDICT_MAX) return { refuse: `the verdict file is ${String(text).length} characters, over ${VERDICT_MAX}` };
  if (SECRET.test(String(text))) return { refuse: 'the verdict file carries a secret-shaped string: nothing posted' };
  if (!/^[0-9a-f]{40}$/.test(String(head))) return { refuse: `--head ${JSON.stringify(head)} is not a full commit sha` };
  const now = pr?.head?.sha;
  if (now !== head) return { refuse: `the head moved: the review read ${String(head).slice(0, 8)}, the PR is now at ${String(now).slice(0, 8)} — nothing posted; review the new head` };
  if (pr?.state !== 'open') return { refuse: `the PR is ${pr?.state}` };
  const verdict = VERDICT_MAP[m[1]];
  const labels = new Set((pr.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)));
  const mine = verdict === 'APPROVE' ? LABELS.REVIEW_APPROVE : LABELS.REVIEW_CHANGES;
  const other = verdict === 'APPROVE' ? LABELS.REVIEW_CHANGES : LABELS.REVIEW_APPROVE;
  const add = [];
  if (!labels.has(mine)) add.push(mine);
  if (verdict === 'APPROVE' && !labels.has(LABELS.LAND_HOLD) && !labels.has(LABELS.LAND_OK)) add.push(LABELS.LAND_OK);
  const remove = labels.has(other) ? [other] : [];
  const asWritten = m[1] === verdict ? [] : [`Verdict as written: ${lines[0].trim()}`];
  const body = [`VERDICT: ${verdict}`, `Head: ${head}`, ...asWritten, ...lines.slice(1)].join('\n').replace(/\n+$/, '');
  return { verdict, review: { event: 'COMMENT', commit_id: head, body }, add, remove };
}

/** The token: environment first, else `gh auth token` (no shell). Never printed. */
export function resolveToken({ env = process.env, run = execFileSync } = {}) {
  const t = envToken(env);
  if (t) return t;
  try {
    const spec = ghSpawnSpec(['auth', 'token']);
    return String(run(spec.file, spec.args, spec.options)).trim() || null;
  } catch {
    return null;
  }
}

/** The whole post, over an injectable REST client. Returns { code, lines }. */
export async function postVerdict({ call, n, head, text }) {
  const pr = await call('GET', `/pulls/${n}`);
  if (!pr.ok) return { code: 1, lines: [`reading #${n} answered HTTP ${pr.status}: nothing posted`] };
  const p = planVerdict({ pr: pr.json, head, text });
  if (p.refuse) return { code: 1, lines: [`REFUSED #${n}: ${p.refuse}`] };
  const r = await call('POST', `/pulls/${n}/reviews`, p.review);
  if (!r.ok) return { code: 1, lines: [`posting the ${p.verdict} review on #${n} answered HTTP ${r.status} ${redact(r.text.slice(0, 200))}`] };
  const lines = [`posted VERDICT: ${p.verdict} on #${n} at ${head.slice(0, 8)} (review ${r.json?.id ?? '?'})`];
  let code = 0;
  if (p.add.length) {
    const a = await call('POST', `/issues/${n}/labels`, { labels: p.add });
    lines.push(a.ok ? `labelled ${p.add.join(', ')}` : `adding ${p.add.join(', ')} answered HTTP ${a.status}`);
    if (!a.ok) code = 1;
  }
  for (const l of p.remove) {
    const d = await call('DELETE', `/issues/${n}/labels/${encodeURIComponent(l)}`);
    lines.push(d.ok || d.status === 404 ? `removed ${l}` : `removing ${l} answered HTTP ${d.status}`);
    if (!d.ok && d.status !== 404) code = 1;
  }
  return { code, lines };
}

async function main(argv) {
  const n = Number(flag(argv, '--pr'));
  const head = flag(argv, '--head');
  const file = flag(argv, '--verdict-file');
  const repo = flag(argv, '--repo', process.env.GITHUB_REPOSITORY || DEFAULT_REPO);
  if (!Number.isInteger(n) || n <= 0 || !head || !file || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    console.log('usage: post-verdict.mjs --pr <n> --head <sha> --verdict-file <file> [--repo o/r]');
    return 2;
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    console.log(`REFUSED: the verdict file could not be read (${e.code ?? e.message})`);
    return 1;
  }
  const token = resolveToken();
  if (!token) {
    console.log('no token: set GH_TOKEN, or sign in with `gh auth login` (nothing posted)');
    return 2;
  }
  const r = await postVerdict({ call: restClient({ repo, token }).call, n, head, text });
  for (const l of r.lines) console.log(l);
  return r.code;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
