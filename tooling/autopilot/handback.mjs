#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// handback.mjs — what the cloud did while the laptop was off, so nothing launches
// twice. The laptop's reconcile (`reconcile.mjs --from-github`) calls it on return,
// BEFORE it starts the heartbeat again; it runs on the owner's WINDOWS laptop.
//
// ⏱ 2026-10-02 · lane autopilot-runners, row O-LANES-LAUNCH-ONLY-FROM-THE-LAPTOP.
//
// Input (a JSON file, or stdin): { owner, now?, issues: [Private REST issues, each
// with `comments`], prs: [Public REST PRs (open and closed), each with `merged_at`
// and, for REVIEWED-BY-CLOUD, its issue `comments`] }. One line per lane:
//   ADOPT  <n> <lane> place=cloud-runner runner=<id>   a fresh cloud claim in flight: hands off
//   KEEP   <n> <lane> place=laptop                     the laptop's own fresh claim
//   DONE   <n> <lane> pr=#<m>                          the lane's PR merged (even if the issue is open)
//   FAILED <n> <lane>                                  labelled `failed`: the lead rules
//   STALE  <n> <lane> pr=#<m> runner=<id>              a stale claim whose PR is still open: the lead reads it
//   FREE   <n> <lane>                                  unclaimed, or a stale claim with no PR
// and one line per merged PR the cloud reviewer reviewed:
//   REVIEWED-BY-CLOUD pr=#<m>
//
// Usage: node tooling/autopilot/handback.mjs [--in <file>]   (Windows paths are fine)
// Exit 0 = answered. 2 = the input could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { CONTRACT, flag, isMain, readStdin } from './cli.mjs';
import { parseIssue, claimState, prsForLander } from './issue-queue.mjs';

const FAILED = CONTRACT.labels.fixed[5];
const LANE = CONTRACT.labels.fixed[0];
const CLOUD_RUNNERS = CONTRACT.routines.map((r) => r.id).filter((id) => id.startsWith('runner-'));
/** The claim comment the cloud reviewer posts (docs/autopilot/reviewer.prompt.md step 3). */
const CLOUD_REVIEW = /^REVIEWING head=[0-9a-f]{7,40} by=reviewer\b/;

/** The input path, resolved the way the platform resolves it (a laptop passes `.\snap.json`). */
export function inputPath(arg, cwd = process.cwd(), platform = process.platform) {
  return (platform === 'win32' ? win32 : posix).resolve(cwd, String(arg));
}

const labelsOf = (i) => (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

/** PURE. The hand-back lines. */
export function handback({ owner, now = Date.now(), issues = [], prs = [] }) {
  const merged = prs.filter((p) => p.merged_at);
  const open = prs.filter((p) => p.state === 'open');
  const lines = [];
  for (const raw of issues) {
    if (!labelsOf(raw).includes(LANE)) continue;
    let i;
    try {
      i = parseIssue(raw, raw.comments ?? [], { owner });
    } catch {
      continue;
    }
    const id = `${i.number} ${i.lane}`;
    const done = prsForLander(i.lander, merged)[0];
    if (done) {
      lines.push(`DONE ${id} pr=#${done.number}`);
      continue;
    }
    if (i.state !== 'open') continue;
    if (i.labels.includes(FAILED)) {
      lines.push(`FAILED ${id}`);
      continue;
    }
    const pr = prsForLander(i.lander, open)[0] ?? null;
    const st = claimState(raw.comments ?? [], { owner, now, prUpdatedAt: pr?.updated_at ?? null });
    if (!st.holder) lines.push(`FREE ${id}`);
    else if (st.fresh) lines.push(CLOUD_RUNNERS.includes(st.holder.runner) ? `ADOPT ${id} place=cloud-runner runner=${st.holder.runner}` : `KEEP ${id} place=${st.holder.runner === CONTRACT.laptopRunner ? 'laptop' : st.holder.runner}`);
    else if (pr) lines.push(`STALE ${id} pr=#${pr.number} runner=${st.holder.runner}`);
    else lines.push(`FREE ${id}`);
  }
  for (const p of merged) {
    if ((p.comments ?? []).some((c) => CLOUD_REVIEW.test(String(c.body ?? '')))) lines.push(`REVIEWED-BY-CLOUD pr=#${p.number}`);
  }
  return lines;
}

if (isMain(import.meta.url)) {
  const arg = flag(process.argv.slice(2), '--in');
  let text;
  try {
    text = arg ? readFileSync(inputPath(arg), 'utf8') : readStdin();
    const input = JSON.parse(text.replace(/^﻿/, ''));
    for (const l of handback(input)) console.log(l);
    process.exitCode = 0;
  } catch (e) {
    console.log(`COULD NOT READ — ${e.code ?? e.message}: no hand-back decided`);
    process.exitCode = 2;
  }
}
