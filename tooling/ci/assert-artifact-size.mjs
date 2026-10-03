#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-artifact-size.mjs — a store artifact is held to its store's size limit
// BEFORE it is uploaded, and a sudden growth is said out loud.
//
// ⏱ ADDED 2026-10-01 (O-ARTIFACT-SIZES-UNRECORDED, review AA-21). No step in this
// repository read the size of anything it shipped: the 379.9 MB macOS .app was
// found by a reviewer reading an artifact list, not by a check. Two rules, both
// read from the channel's row in tooling/channel-register.json:
//   · FAIL at FAIL_FRACTION (80%) of `storeSizeLimit.bytes` — the store refuses at
//     100%, and 80% is the margin in which a release still has room to land a fix;
//   · WARN at WARN_MULTIPLE (2×) the MEDIAN of the sizes this channel's earlier
//     production records carry (`payload.artifact.size`, which record-deployment.mjs
//     `--artifact` writes). A doubling is either intended or a defect, and either
//     way somebody should read it on the run that caused it.
// A row whose store states no limit carries `storeSizeLimit: null` and a
// `_storeSizeLimitWhy`; it is held to the median rule only, and the line says so.
// A row with no `storeSizeLimit` key at all is COVERAGE LOST: "unbounded" must be
// a declaration, never an omission.
//
// The median needs the ledger, read with the recorder's own bounded client. With
// no token, or no earlier record, there is no baseline, and the run prints that
// rather than inventing one.
//
// Usage:  node tooling/ci/assert-artifact-size.mjs --app <app> --channel <channel id> <file>
// env:    GH_TOKEN (or GITHUB_TOKEN) + GITHUB_REPOSITORY for the median; optional.
// Exit 0 = within the limit (a growth warning may be printed). 1 = at or over 80% of
//      the limit, or a bad invocation. 2 = COVERAGE LOST (no such row, or the row
//      declares no `storeSizeLimit` key).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, githubApiBase } from './record-deployment.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
export const FAIL_FRACTION = 0.8;
export const WARN_MULTIPLE = 2;

/** PURE. The median of a list of sizes, or null for none. */
export function median(sizes) {
  const s = sizes.filter((n) => Number.isSafeInteger(n) && n > 0).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** PURE. `{ fail, warn, median, ceiling }` for one artifact size. `limitBytes` null = unbounded. */
export function sizeVerdict({ size, limitBytes, history }) {
  const ceiling = limitBytes === null ? null : Math.floor(limitBytes * FAIL_FRACTION);
  const med = median(history);
  return {
    ceiling,
    median: med,
    fail: ceiling !== null && size >= ceiling,
    warn: med !== null && size > med * WARN_MULTIPLE,
  };
}

/** PURE. The sizes earlier production records carry, from a GitHub deployments list. */
export function recordedSizes(deployments) {
  return (Array.isArray(deployments) ? deployments : [])
    .map((d) => d?.payload?.artifact?.size)
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

async function main(argv) {
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  const app = opt('app');
  const channel = opt('channel');
  const file = argv.filter((a, i) => !a.startsWith('--') && !['--app', '--channel'].includes(argv[i - 1])).pop() ?? null;
  if (!app || !channel || !file) {
    console.error('✗ usage: assert-artifact-size.mjs --app <app> --channel <channel id> <file>');
    return 1;
  }
  const register = JSON.parse(readFileSync(join(ROOT, REGISTER_REL), 'utf8'));
  const row = (register.channels ?? []).find((c) => c?.id === channel);
  if (!row || !Object.hasOwn(row, 'storeSizeLimit')) {
    console.error(
      `✗ COVERAGE LOST — ${row ? `the "${channel}" row declares no \`storeSizeLimit\`` : `no row "${channel}" in ${REGISTER_REL}`}. ` +
        'A channel whose limit is unknown says so with `storeSizeLimit: null` and a `_storeSizeLimitWhy`; an absent key is an omission, not a declaration.',
    );
    return 2;
  }
  let size;
  try {
    size = statSync(file).size;
  } catch (e) {
    console.error(`✗ ${file} cannot be read (${e.code ?? e.message}).`);
    return 1;
  }
  const limit = row.storeSizeLimit === null ? null : row.storeSizeLimit.bytes;

  let history = [];
  let baseline = 'no baseline: GH_TOKEN or GITHUB_REPOSITORY is unset, so the ledger was not read';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const transport = githubApiBase();
  if (token && repo && !transport.error) {
    try {
      const env = encodeURIComponent(`${app}-${channel}`);
      const list = await api(`deployments?environment=${env}&per_page=100`, token, repo, null, {
        method: 'GET',
        base: transport.base,
        rl: { deadline: null, retries: 0, secondaryStrikes: 0 },
      });
      history = recordedSizes(list);
      baseline = history.length ? `median of ${history.length} recorded production size(s)` : 'no baseline: no earlier record of this channel carries `payload.artifact.size`';
    } catch (e) {
      baseline = `no baseline: the ledger could not be read (${e.message.slice(0, 120)})`;
    }
  }
  const v = sizeVerdict({ size, limitBytes: limit, history });
  const limitText = limit === null ? `no stated store limit (${row._storeSizeLimitWhy ?? 'storeSizeLimit: null'})` : `store limit ${mb(limit)}, fail at ${mb(v.ceiling)} (${FAIL_FRACTION * 100}%)`;
  console.log(`→    ${channel}: ${file} is ${size} bytes (${mb(size)}); ${limitText}; ${v.median === null ? baseline : `${baseline} = ${mb(v.median)}`}`);
  if (v.warn) {
    console.log(`::warning title=${channel} artifact grew::${mb(size)} is more than ${WARN_MULTIPLE}× the ${baseline} (${mb(v.median)}). Intended or a defect — read it on this run.`);
  }
  if (v.fail) {
    console.error(`✗ ${channel}: ${mb(size)} is at or over ${FAIL_FRACTION * 100}% of the store limit (${mb(limit)}; ${row.storeSizeLimit.source}). Shrink it before it is uploaded.`);
    return 1;
  }
  console.log(`ok   ${channel}: within ${limit === null ? 'the median rule (no store limit is stated)' : `${FAIL_FRACTION * 100}% of the store limit`}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
