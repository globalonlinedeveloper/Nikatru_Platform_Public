#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// org-move.mjs — the graded, READ-ONLY rehearsal of moving this platform's
// repositories to another GitHub org (the owner's coming move to `nikatru-com`).
//
//   node tooling/ops/org-move.mjs --to <org> --dry-run [--root <repoRoot>]
//
// ⏱ 2026-10-03 · port-codehost (tooling/ports/codehost.json; row
// O-CODEHOST-NAME-HARD-CODED-IN-33-FILES). Phase 2 of
// Private/runbooks/switch-vendor.md#codehost. The org is CONFIG
// (tooling/github-org.json), so inside this tree the move is one line and a
// re-render; what this lists is everything the move must change, and above all
// what OUTSIDE the tree pins the old name (trap vacuous-09: a rename silently
// voids whatever hard-coded it, and a pin nobody lists is never re-pointed).
//
// One line per check, `PASS | FAIL | LOST  M<n> <name>: <detail>`, after ONE
// first line naming the check that decided the exit:
//   exit 1  any FAIL (a finding — do not move);
//   exit 2  no FAIL, but some check could not look (COVERAGE LOST is not a pass),
//           or the invocation was refused;
//   exit 0  every check PASS.
//
//   M1  target       `--to` is an org name, not the current org; with a read
//                    token, GET /users/<to> says it exists (and is an org).
//   M2  in-tree      tooling/ci/assert-no-dead-repo-names.mjs (its code-host
//                    limbs) is green — nothing types the org outside the register —
//                    and the edits the move commit makes are listed: the register
//                    line, the re-render, the checked pins, the counted mentions,
//                    the Markdown prose.
//   M3  pins listed  every pin this tool knows lives OUTSIDE the tree (KNOWN_PINS)
//                    is a tooling/github-org.json `renamePins` entry, and every
//                    entry there is one this tool can report on: an unlisted pin
//                    is FAIL either way.
//   M4… one per pin  confirmed by a read-only GET with a token (GH_TOKEN or
//                    GITHUB_TOKEN; Cloudflare's for the Pages bindings); without
//                    one, LOST. A pin no API exposes (the dispatch token's scope,
//                    the private sync script's remote) is LOST always: an owner step.
//   M<last> plan     the GitHub Free plan in the target org — the cost line.
//
// 🔴 IT NEVER WRITES. Every request is a GET (the tests hold that); nothing is
// renamed, transferred, created or re-pointed. Tokens print as `set`/`NOT SET`.
// Without `--dry-run` it refuses (shell-13: a no-value flag never eats an argument).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';
import { CODEHOST } from '../generated/codehost.mjs';

export const REGISTER = 'tooling/github-org.json';
export const DEAD_REPOS = 'tooling/dead-repos.json';
export const CHANNEL_REGISTER = 'tooling/channel-register.json';
export const NAME_GUARD = 'tooling/ci/assert-no-dead-repo-names.mjs';
export const NO_VALUE_FLAGS = new Set(['--dry-run']);
export const VALUE_FLAGS = new Set(['--to', '--root']);
const ORG_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const GH = CODEHOST.apiOrigin;
const CF = 'https://api.cloudflare.com/client/v4';

/**
 * The pins OUTSIDE this tree that name the org, each with how it is confirmed. Every one must
 * be a `renamePins` entry of the register, and every entry there must be one of these (M3).
 */
export const KNOWN_PINS = Object.freeze([
  { id: 'cloudflare-pages', what: 'the Cloudflare Pages Git bindings (projects nikatru, rajasekarselvam)', read: 'cloudflare' },
  { id: 'renovate-app', what: 'the Renovate GitHub App installation (RENOVATE_TOKEN, .github/workflows/renovate.yml)', read: 'installations', app: 'renovate' },
  { id: 'github-apps', what: 'every other GitHub App installed on the repositories', read: 'installations' },
  { id: 'actions-secrets', what: 'the Actions secrets, BY NAME — re-provisioned from the vault, never exported', read: 'secrets' },
  { id: 'environments', what: 'the deployment environments and their protection rules', read: 'environments' },
  { id: 'branch-protection', what: "main's branch protection (ci-gate the required check)", read: 'protection' },
  { id: 'webhooks', what: 'the repository webhooks', read: 'hooks' },
  { id: 'dispatch-token', what: "GITHUB_DISPATCH_TOKEN, the platform Worker's dispatch credential, scoped to the CURRENT org", read: 'owner' },
  { id: 'private-sync-remote', what: "the Private repository's sync script remote (sync-private-repo.ps1), by name only", read: 'owner' },
]);

/** Parse argv. Every flag is declared; a no-value flag never eats the next argument (shell-13). */
export function parseArgs(argv) {
  const out = { to: null, root: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (NO_VALUE_FLAGS.has(a)) { out.dryRun = true; continue; }
    if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v === undefined) return { error: `${a} needs a value` };
      if (v.startsWith('--')) return { error: `${a} was given ${JSON.stringify(v)}, which is a flag, not a value` };
      out[a.slice(2)] = v;
      i++;
      continue;
    }
    return { error: `unknown argument ${a}` };
  }
  if (!out.dryRun) return { error: '--dry-run is required: this tool only ever rehearses an org move, and says so on the command line' };
  if (!out.to) return { error: '--to <org> is required' };
  return out;
}

const readJson = (root, rel) => JSON.parse(readFileSync(join(root, ...rel.split('/')), 'utf8'));

/** Every file under `rel` (in-tree listing) whose name matches `re`, repo-relative with `/`. */
function walk(root, rel, re, out = []) {
  let entries;
  try { entries = listDir(join(root, ...rel.split('/').filter(Boolean)), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!['node_modules', '.git', 'build', '.dart_tool', '.wrangler'].includes(e.name)) walk(root, r, re, out); }
    else if (re.test(e.name)) out.push(r);
  }
  return out;
}

/** One read-only GET; `{status, body}` or `{error}`. Never any other method. */
async function get(fetchImpl, url, headers) {
  try {
    const res = await fetchImpl(url, { method: 'GET', headers });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } catch (e) {
    return { error: e instanceof Error ? e.name : typeof e };
  }
}

export async function run(opts, deps = {}) {
  const root = resolve(opts.root ?? join(fileURLToPath(import.meta.url), '..', '..', '..'));
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const spawn = deps.spawn ?? ((args) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 600_000 }));
  const checks = [];
  const lines = [];
  const add = (n, name, verdict, detail) => checks.push({ n, name, verdict, detail });

  let reg;
  try { reg = readJson(root, REGISTER); } catch (e) {
    return finish([{ n: 0, name: 'register', verdict: 'LOST', detail: `${REGISTER} could not be read (${e.message})` }], []);
  }
  const from = reg.org;
  const repos = (reg.platform ?? []).map((p) => p.repo);
  const pub = (reg.platform ?? []).find((p) => p.visibility === 'PUBLIC')?.repo;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || '';
  const gh = token ? { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } : null;
  lines.push(`    move ${from} → ${opts.to} · repositories ${repos.join(', ')} · GH_TOKEN/GITHUB_TOKEN ${token ? 'set' : 'NOT SET'} · CLOUDFLARE_API_TOKEN ${env.CLOUDFLARE_API_TOKEN ? 'set' : 'NOT SET'}`);

  // M1 — the target
  if (!ORG_NAME.test(opts.to)) add(1, 'target', 'FAIL', `${JSON.stringify(opts.to)} is not a GitHub account name`);
  else if (opts.to.toLowerCase() === String(from).toLowerCase()) add(1, 'target', 'FAIL', `${opts.to} is the CURRENT org (${REGISTER}); there is nothing to move`);
  else if (!gh) add(1, 'target', 'LOST', `no read token: whether ${opts.to} exists, and is an organization, is not confirmed`);
  else {
    const r = await get(fetchImpl, `${GH}/users/${encodeURIComponent(opts.to)}`, gh);
    if (r.status === 200) add(1, 'target', r.body?.type === 'Organization' ? 'PASS' : 'FAIL', `${opts.to} exists as a ${r.body?.type ?? 'thing of unknown type'}${r.body?.type === 'Organization' ? '' : ' — repositories move into an ORGANIZATION'}`);
    else if (r.status === 404) {
      // vacuous-09: a name that does not resolve prints the names that DO exist.
      const mine = await get(fetchImpl, `${GH}/user/orgs`, gh);
      const names = Array.isArray(mine.body) ? mine.body.map((o) => o.login).join(', ') : 'unreadable';
      add(1, 'target', 'FAIL', `${opts.to} does not exist (GET /users answered 404); the token's orgs are: ${names || 'none'}`);
    } else add(1, 'target', 'LOST', `GET /users/${opts.to} answered ${r.status ?? r.error}`);
  }

  // M2 — in the tree: nothing types the org but the register; the move commit's edits
  const g = spawn([join(root, ...NAME_GUARD.split('/')), root]);
  const first = `${g.stdout ?? ''}${g.stderr ?? ''}`.split(/\r?\n/).find((l) => /^✗|code-host limbs/.test(l)) ?? '(no output)';
  add(2, 'in-tree', g.status === 0 ? 'PASS' : g.status === 1 ? 'FAIL' : 'LOST', `node ${NAME_GUARD} exit ${g.status}: ${first.trim().slice(0, 240)}`);
  let dead = null;
  try { dead = readJson(root, DEAD_REPOS); } catch { dead = null; }
  lines.push('    ── the move commit, inside this tree ──');
  lines.push(`      ${REGISTER}: "org": "${from}" → "${opts.to}" (one line; then node tooling/ports/render.mjs)`);
  lines.push('      re-rendered: tooling/generated/codehost.mjs, services/platform/src/generated/codehost.ts → REDEPLOY platform (the dispatch table and OPS_REPO)');
  const pubspecs = walk(root, '', /^(pubspec\.yaml|.*\.podspec)$/).filter((f) => readFileSync(join(root, ...f.split('/')), 'utf8').includes(from));
  for (const f of [...pubspecs, '.github/CODEOWNERS', '.github/ISSUE_TEMPLATE/config.yml']) lines.push(`      pin  ${f} (checked against the register: it goes red until rewritten)`);
  for (const m of dead?.codehost?.mentions ?? []) lines.push(`      mention  ${m.path} ×${m.count} — ${m.why.slice(0, 120)}`);
  const prose = walk(root, '', /\.md$/).filter((f) => !f.startsWith('tooling/ci/test/')).map((f) => [f, (readFileSync(join(root, ...f.split('/')), 'utf8').match(new RegExp(from, 'gi')) ?? []).length]).filter(([, n]) => n > 0);
  for (const [f, n] of prose) lines.push(`      prose  ${f} ×${n} (a link or a dated record: rewrite links, keep records)`);
  lines.push(`      stays: ${dead?.codehost?.fixtureConstant?.path ?? 'the fixture constant'} and the recorded fixtures — captured under ${from}, they are history`);

  // M3 — every pin listed, both ways
  const listed = [...(reg.renamePins?.observable ?? []), ...(reg.renamePins?.unobservable ?? [])].map((p) => p?.id).filter(Boolean);
  const known = new Set(KNOWN_PINS.map((p) => p.id));
  const unlisted = KNOWN_PINS.filter((p) => !listed.includes(p.id)).map((p) => p.id);
  const unknown = listed.filter((id) => !known.has(id));
  if (unlisted.length) add(3, 'pins listed', 'FAIL', `${REGISTER} renamePins does not list: ${unlisted.join(', ')} — a pin the register does not name is never re-pointed`);
  else if (unknown.length) add(3, 'pins listed', 'FAIL', `${REGISTER} renamePins lists ${unknown.join(', ')}, which this tool cannot report on — add it to KNOWN_PINS with its reader`);
  else add(3, 'pins listed', 'PASS', `all ${listed.length} pin(s) outside the tree are listed in ${REGISTER} renamePins`);

  // M4… — one per pin
  let n = 4;
  for (const p of KNOWN_PINS) {
    const r = await readPin(p, { fetchImpl, gh, env, from, pub, repos });
    add(n++, p.id, r.verdict, r.detail);
    for (const l of r.lines ?? []) lines.push(`      ${p.id}: ${l}`);
  }

  // the cost line
  const plan = gh ? await get(fetchImpl, `${GH}/orgs/${encodeURIComponent(opts.to)}`, gh) : null;
  const planName = plan?.status === 200 ? plan.body?.plan?.name ?? 'not visible to this token' : null;
  add(n, 'plan', planName ? 'PASS' : 'LOST', `${planName ? `${opts.to} is on plan \`${planName}\`` : `the plan of ${opts.to} is not read (${gh ? `GET /orgs answered ${plan?.status ?? plan?.error}` : 'no read token'})`} — GitHub Free in an org: Actions minutes are unlimited for PUBLIC repositories (the macOS runners this repo is public for), 2,000 min/month and 500 MB of packages for PRIVATE ones; environments with required reviewers need a PUBLIC repository on Free. An owner-visible cost line: confirm before the move.`);

  return finish(checks, lines);
}

/** Read one pin, GET only. */
async function readPin(p, { fetchImpl, gh, env, from, pub, repos }) {
  if (p.read === 'owner') {
    const what = p.id === 'dispatch-token'
      ? `${p.what}: its scope cannot be read without using it. OWNER STEP — mint a token for the new org (Actions: write on ${pub}), \`wrangler secret put GITHUB_DISPATCH_TOKEN\` on platform, revoke the old one`
      : `${p.what}: names ${from}/${repos.find((r) => /Private/.test(r)) ?? 'the private repository'} and lives outside this tree. OWNER STEP — point its remote at the new org`;
    return { verdict: 'LOST', detail: what };
  }
  if (p.read === 'cloudflare') {
    const tok = env.CLOUDFLARE_API_TOKEN;
    const acct = env.CLOUDFLARE_ACCOUNT_ID;
    if (!tok || !acct) return { verdict: 'LOST', detail: `${p.what}: no Cloudflare read token; the binding is not read (and no API re-points it — the register's measured record says so: an owner step in the dashboard)` };
    const out = [];
    for (const proj of ['nikatru', 'rajasekarselvam']) {
      const r = await get(fetchImpl, `${CF}/accounts/${acct}/pages/projects/${proj}`, { Authorization: `Bearer ${tok}` });
      if (r.status !== 200) return { verdict: 'LOST', detail: `${p.what}: GET pages/projects/${proj} answered ${r.status ?? r.error}` };
      const cfg = r.body?.result?.source?.config ?? {};
      out.push(`${proj} → ${cfg.owner ?? '?'}/${cfg.repo_name ?? '?'} (re-point in the dashboard)`);
    }
    return { verdict: 'PASS', detail: `${p.what}: read`, lines: out };
  }
  if (!gh) return { verdict: 'LOST', detail: `${p.what}: no read token, not confirmed` };
  const repo = `${GH}/repos/${from}/${pub}`;
  const url = p.read === 'installations' ? `${GH}/user/installations`
    : p.read === 'secrets' ? `${repo}/actions/secrets?per_page=100`
      : p.read === 'environments' ? `${repo}/environments`
        : p.read === 'protection' ? `${repo}/branches/main/protection`
          : `${repo}/hooks`;
  const r = await get(fetchImpl, url, gh);
  if (r.status !== 200) return { verdict: 'LOST', detail: `${p.what}: GET ${url.slice(GH.length)} answered ${r.status ?? r.error}` };
  const b = r.body;
  let names = [];
  if (p.read === 'installations') {
    names = (b?.installations ?? []).map((i) => i?.app_slug).filter(Boolean);
    if (p.app && !names.includes(p.app)) return { verdict: 'FAIL', detail: `${p.what}: no ${p.app} installation is visible (installed: ${names.join(', ') || 'none'})` };
    if (p.app) names = [p.app];
  } else if (p.read === 'secrets') names = (b?.secrets ?? []).map((s) => s?.name);
  else if (p.read === 'environments') names = (b?.environments ?? []).map((e) => e?.name);
  else if (p.read === 'protection') names = (b?.required_status_checks?.contexts ?? []).map((c) => `required: ${c}`);
  else names = (Array.isArray(b) ? b : []).map((h) => `${h?.name ?? 'hook'} #${h?.id}`);
  return { verdict: 'PASS', detail: `${p.what}: ${names.length} — ${names.join(', ') || 'none'} (recreate in the new org)` };
}

function finish(checks, lines) {
  const fail = checks.find((c) => c.verdict === 'FAIL');
  const lost = checks.find((c) => c.verdict === 'LOST');
  const decider = fail ?? lost;
  const code = fail ? 1 : lost ? 2 : 0;
  const out = [decider ? `org-move: ${decider.verdict} — M${decider.n} ${decider.name}: ${decider.detail}` : `org-move: PASS — all ${checks.length} checks pass (dry run; nothing was moved)`];
  for (const c of checks) out.push(`${c.verdict.padEnd(4)}  M${c.n} ${c.name}: ${c.detail}`);
  out.push(...lines);
  out.push(`summary: ${checks.filter((c) => c.verdict === 'PASS').length} PASS · ${checks.filter((c) => c.verdict === 'FAIL').length} FAIL · ${checks.filter((c) => c.verdict === 'LOST').length} LOST → exit ${code} (read-only: nothing was renamed, transferred or re-pointed)`);
  return { code, out };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`org-move: REFUSED — ${opts.error}`);
    console.error('usage: node tooling/ops/org-move.mjs --to <org> --dry-run [--root <dir>]');
    process.exit(2);
  }
  const { code, out } = await run(opts);
  for (const l of out) (code ? console.error : console.log)(l);
  process.exit(code);
}

const IS_MAIN = (() => {
  try { return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (IS_MAIN) await main();
