#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// review-paths.mjs — which pull requests need an independent review, and the
// labels that say so. Run by .github/workflows/review-gate.yml.
//
// ⏱ 2026-10-02 · lane autopilot-reviews, row O-REVIEWS-DEPEND-ON-THE-LAPTOP. The
// owner rule (2026-09-29) is that an auth, money, user-data or API pull request
// gets an INDEPENDENT review before it may merge. The classes are globs in
// tooling/autopilot/review-paths.json; the labels are tooling/autopilot/contract.json.
//
// THE RULES (`decideLabels`, pure):
//   · any path in a class                 → add `needs-review`
//   · a file list it could not read whole → add `needs-review` (fail closed)
//   · `needs-review` is NEVER removed here: only the lead removes it
//   · on `synchronize` (a new head)       → remove `review:approve` / `review:changes`,
//     because a verdict is pinned to the head it read
//
// SAFETY. review-gate.yml runs this from main under pull_request_target and never
// checks out the PR's code: the file list comes from the REST API, and nothing
// from the event reaches a shell but the PR number.
//
// Usage:
//   node tooling/autopilot/review-paths.mjs --pr <n> [--synchronize]     live (GITHUB_TOKEN, GITHUB_REPOSITORY)
//   node tooling/autopilot/review-paths.mjs --files <file.json> [--labels a,b] [--synchronize]   decide only, write nothing
// Exit 0 = decided (and, live, applied). 1 = a label write was refused. 2 = bad usage.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT, envToken, flag, isMain, redact } from './cli.mjs';

const [LAND_OK, LAND_HOLD, NEEDS_REVIEW, REVIEW_APPROVE, REVIEW_CHANGES] = CONTRACT.publicLabels.pr;
export const LABELS = Object.freeze({ LAND_OK, LAND_HOLD, NEEDS_REVIEW, REVIEW_APPROVE, REVIEW_CHANGES, FIX_FIRST: CONTRACT.publicLabels.pr[5] });
export const CLASSES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'review-paths.json'), 'utf8')).classes;
/** GitHub's pull-request files API returns at most this many files. */
export const PR_FILE_CAP = 3000;

/** A review glob → a RegExp over a repo-relative path (case-insensitive). */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) throw new Error(`unclosed { in review glob ${glob}`);
      re += `(?:${glob.slice(i + 1, end).split(',').map((a) => a.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** files → { classes: [names hit], hits: { class: [first few paths] } }. */
export function classify(files, classes = CLASSES) {
  const hits = {};
  for (const [name, globs] of Object.entries(classes)) {
    const res = globs.map(globToRegExp);
    const matched = (files ?? []).filter((f) => res.some((r) => r.test(String(f).replace(/\\/g, '/'))));
    if (matched.length) hits[name] = matched.slice(0, 5);
  }
  return { classes: Object.keys(hits), hits };
}

/**
 * THE LABEL DECISION. `files` null (or `complete` false) means the list could not be
 * read whole. Returns { add, remove, why }.
 */
export function decideLabels({ files, complete = true, labels = [], synchronize = false, classes = CLASSES }) {
  const add = [];
  const remove = [];
  const has = new Set(labels);
  let why;
  if (!Array.isArray(files) || !complete) {
    why = 'the file list could not be read whole: needs-review (fail closed)';
    if (!has.has(NEEDS_REVIEW)) add.push(NEEDS_REVIEW);
  } else {
    const c = classify(files, classes);
    if (c.classes.length) {
      why = `review-classed: ${c.classes.map((k) => `${k} (${c.hits[k].join(', ')})`).join('; ')}`;
      if (!has.has(NEEDS_REVIEW)) add.push(NEEDS_REVIEW);
    } else why = `no review class among ${files.length} file(s)`;
  }
  if (synchronize) for (const l of [REVIEW_APPROVE, REVIEW_CHANGES]) if (has.has(l)) remove.push(l);
  return { add, remove, why };
}

// ── I/O ─────────────────────────────────────────────────────────────────────

const API = () => process.env.GITHUB_API_URL || 'https://api.github.com';

export function restClient({ repo, token, fetchImpl = globalThis.fetch }) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'nikatru-autopilot', 'x-github-api-version': '2022-11-28' };
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${API()}/repos/${repo}${path}`, { method, headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const text = await res.text().catch(() => '');
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  };
  return { call };
}

async function readFiles(call, n) {
  const out = [];
  for (let page = 1; page <= PR_FILE_CAP / 100; page++) {
    const r = await call('GET', `/pulls/${n}/files?per_page=100&page=${page}`);
    if (!r.ok || !Array.isArray(r.json)) return { files: null, complete: false };
    out.push(...r.json.map((f) => f.filename));
    if (r.json.length < 100) return { files: out, complete: true };
  }
  return { files: out, complete: false };
}

async function main(argv) {
  const synchronize = argv.includes('--synchronize');
  const filesArg = flag(argv, '--files');
  if (filesArg) {
    let files;
    try {
      files = JSON.parse(readFileSync(filesArg, 'utf8'));
    } catch {
      files = null;
    }
    const labels = (flag(argv, '--labels', '') ?? '').split(',').filter(Boolean);
    const d = decideLabels({ files, labels, synchronize });
    console.log(`${d.why}\nadd: ${d.add.join(', ') || '—'}\nremove: ${d.remove.join(', ') || '—'}`);
    return 0;
  }
  const n = Number(flag(argv, '--pr'));
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const token = envToken();
  if (!Number.isInteger(n) || n <= 0 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !token) {
    console.log('usage: --pr <n> with GITHUB_REPOSITORY and GITHUB_TOKEN, or --files <file.json>');
    return 2;
  }
  const { call } = restClient({ repo, token });
  const pr = await call('GET', `/pulls/${n}`);
  const labels = pr.ok ? (pr.json?.labels ?? []).map((l) => l.name) : [];
  const { files, complete } = await readFiles(call, n);
  const d = decideLabels({ files, complete, labels, synchronize });
  console.log(`#${n}: ${d.why}`);
  let code = 0;
  if (d.add.length) {
    const r = await call('POST', `/issues/${n}/labels`, { labels: d.add });
    console.log(r.ok ? `added ${d.add.join(', ')}` : `adding ${d.add.join(', ')} answered HTTP ${r.status} ${redact(r.text.slice(0, 200))}`);
    if (!r.ok) code = 1;
  }
  for (const l of d.remove) {
    const r = await call('DELETE', `/issues/${n}/labels/${encodeURIComponent(l)}`);
    console.log(r.ok || r.status === 404 ? `removed ${l} (a verdict is pinned to the old head)` : `removing ${l} answered HTTP ${r.status}`);
    if (!r.ok && r.status !== 404) code = 1;
  }
  if (!d.add.length && !d.remove.length) console.log('no label change');
  return code;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
