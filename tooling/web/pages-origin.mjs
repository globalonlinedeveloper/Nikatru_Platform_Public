#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tooling/web/pages-origin.mjs — an app's Cloudflare Pages ORIGIN: read back from
// Cloudflare when the project is created, passed to the brick as `pages_origin`,
// and verified against apps/<app>/app.yaml `hosts.pagesOrigin`.
//
// O-PRODUCT-RECORD-UNBUILT (G-a). 🔴 THE VALUE IS ISSUED BY CLOUDFLARE AT
// CREATION AND IS NEVER DERIVED. Measured for app #1 and recorded in
// apps/subscriptiontracker/app.yaml `hosts`:
//     POST /accounts/{a}/pages/projects {"name":"subscriptiontracker"}
//       -> result.subdomain = subscriptiontracker-7qg.pages.dev
// The `-7qg` suffix is Cloudflare's, appended because the bare name was taken,
// and `subscriptiontracker.pages.dev` answers 200 for a THIRD PARTY. So
// `<id>.pages.dev` is somebody else's origin, and `<id>.nikatru.com` (the host
// the brick used to derive) has served nothing since the wildcard was deleted.
// render.mjs used to fall back to `hosts.web` when `pagesOrigin` was absent; it
// now exits 1 instead, so the origin has to exist BEFORE the stamp, which is
// what `--apply` is for.
//
// ── G-b: THE RECORD IS PROVEN ON EVERY DEPLOY, NEVER WRITTEN BY ONE ──────────
// The row's closes asked for "deploy-web records the Pages name into app.yaml".
// ADAPTED (P-G-1): a CI deploy cannot commit to main, and the stamp needs the
// value BEFORE the app's first merge, so no deploy could ever be its writer.
// Instead deploy-web.yml runs `--verify <app>` right after its idempotent
// project create and BEFORE `wrangler pages deploy`: it reads the subdomain
// back from Cloudflare and exits 1 when app.yaml declares another, naming both
// and the lines to write. A mismatch therefore publishes nothing.
//
// Usage:
//   node tooling/web/pages-origin.mjs --check <app>   offline: exit 0 when app.yaml declares a
//                                                     *.pages.dev pagesOrigin equal to hosts.web
//   node tooling/web/pages-origin.mjs --apply <app>   create the Pages project (idempotent), GET it,
//                                                     print `pagesOrigin=<host>`; writes nothing
//   node tooling/web/pages-origin.mjs --read <app>    GET the project only, print `pagesOrigin=<host>`
//   node tooling/web/pages-origin.mjs --verify <app>  --check, then GET the project and exit 1 unless
//                                                     its subdomain IS the declared pagesOrigin
//
// `--apply`, `--read` and `--verify` call Cloudflare with CLOUDFLARE_API_TOKEN
// and CLOUDFLARE_ACCOUNT_ID. They go through an injectable fetch and an
// injectable wrangler runner (`main(argv, deps)`), so the test stubs them and
// never calls out. The parent runs `--apply` at app #2 only after the owner's
// go (O-G1), with the locked tooling/wrangler island installed (`npm ci
// --ignore-scripts --prefix tooling/wrangler`); without it `--apply` is
// COVERAGE LOST, never an `npx` registry fetch. The GET is re-asked through
// tooling/ops/bounded-retry.mjs: a dropped wire, a 429 or a 5xx is asked
// again, and one that outlives the plan is COULD NOT LOOK (exit 2), never a
// pass and never a mismatch.
//
// Exit: 0 ok · 1 a finding (a missing, non-pages.dev or disagreeing origin; a
// refused API answer; a declared origin the project does not answer) ·
// 2 COVERAGE LOST (no app named, app.yaml unreadable, credentials absent,
// Cloudflare unreachable after the bounded retry).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../app-yaml/yaml.mjs';
import { CouldNotLook, fetchWithBoundedRetry } from '../ops/bounded-retry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_ID = /^[a-z][a-z0-9]*$/;
/** A Pages production alias: one label (the project name, maybe suffixed) under pages.dev. */
export const PAGES_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pages\.dev$/;
const API = 'https://api.cloudflare.com/client/v4';

/** PURE. The findings for one app.yaml document's hosts; [] when the origin is sound. */
export function originFindings(doc, where) {
  const hosts = doc?.hosts ?? {};
  const origin = hosts.pagesOrigin;
  const out = [];
  if (typeof origin !== 'string' || origin === '') {
    out.push(`${where} declares no \`hosts.pagesOrigin\`. It is issued by Cloudflare when the Pages project is created ` +
      '(`node tooling/web/pages-origin.mjs --apply <app>` prints it) and is never derived.');
    return out;
  }
  if (!PAGES_HOST.test(origin)) {
    out.push(`${where} \`hosts.pagesOrigin\` is "${origin}", which is not a *.pages.dev host. Only the project's ` +
      'production alias is outside the nikatru.com zone the retired-subdomain Redirect Rule matches.');
  }
  if (hosts.web !== origin) {
    out.push(`${where} \`hosts.web\` is "${hosts.web}" and \`hosts.pagesOrigin\` is "${origin}": the app's own origin ` +
      'is its Pages project, so the two are the same host.');
  }
  return out;
}

/**
 * The project's subdomain from Cloudflare's GET answer, or a refusal. `lost` is
 * set when nothing answered after the bounded retry: COULD NOT LOOK, which the
 * caller reports as exit 2, never as a finding about the record.
 */
export async function readSubdomain({ app, accountId, token, fetchImpl, sleep }) {
  let res;
  try {
    res = await fetchWithBoundedRetry(
      async ({ signal }) => {
        const r = await fetchImpl(`${API}/accounts/${accountId}/pages/projects/${app}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        // The body is read INSIDE the attempt, so a wire that drops mid-body is
        // re-asked rather than read as a garbled answer.
        let body = null;
        try {
          body = await r.json();
        } catch {
          body = null;
        }
        return { ok: r.ok, status: r.status, headers: r.headers, body };
      },
      { describe: (what) => `GET pages/projects/${app}: ${what}`, ...(sleep ? { sleep } : {}) },
    );
  } catch (e) {
    if (!(e instanceof CouldNotLook)) throw e;
    return { ok: false, lost: true, why: e.message };
  }
  const sub = res.body?.result?.subdomain;
  if (!res.ok || res.body?.success !== true || typeof sub !== 'string') {
    return { ok: false, why: `GET pages/projects/${app} answered HTTP ${res.status} with no result.subdomain` };
  }
  if (!PAGES_HOST.test(sub)) return { ok: false, why: `pages/projects/${app} answered subdomain "${sub}", not a *.pages.dev host` };
  return { ok: true, subdomain: sub };
}

/**
 * PURE. G-b's comparison: the declared origin against the subdomain Cloudflare
 * answered for the project. [] when they are the same host; otherwise the lines
 * a deploy log needs — both hosts, and the two lines to write into app.yaml
 * (`web` and `pagesOrigin` are one host, which `--check` holds).
 */
export function verifyFindings(declared, answered, app) {
  if (declared === answered) return [];
  const rel = `apps/${app}/app.yaml`;
  return [
    `::error title=Pages origin::${rel} declares hosts.pagesOrigin "${declared}", but the Pages project ` +
      `"${app}" answers subdomain "${answered}". Nothing was deployed.`,
    `Write these two lines under \`hosts:\` in ${rel}, then push:`,
    `  web: ${answered}`,
    `  pagesOrigin: ${answered}`,
  ];
}

/** The locked wrangler island's binary: the one deploy-web.yml and rollback.mjs run. */
export const WRANGLER_REL = 'tooling/wrangler/node_modules/.bin/wrangler';

/**
 * The real wrangler runner: `wrangler pages project create`, the flags deploy-web.yml
 * uses, from the locked tooling/wrangler island and never an `npx` registry fetch
 * (assert-lockfile-discipline limb 3). `missing` when the island is not installed.
 */
function runWrangler(args, root) {
  const bin = join(root, WRANGLER_REL);
  if (!existsSync(bin)) return { missing: true, code: null, out: '' };
  const r = spawnSync(bin, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * @param {string[]} argv
 * @param {{ root?: string, env?: object, fetchImpl?: Function, wrangler?: Function,
 *           sleep?: Function, log?: Function, err?: Function }} deps
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, deps = {}) {
  const root = deps.root ?? ROOT;
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((s) => console.log(s));
  const err = deps.err ?? ((s) => console.error(s));
  const [mode, app] = argv;
  if (!['--check', '--apply', '--read', '--verify'].includes(mode) || typeof app !== 'string' || !APP_ID.test(app)) {
    err('✗ COVERAGE LOST — usage: pages-origin.mjs --check|--apply|--read|--verify <app-id>');
    return 2;
  }
  let declared = null;
  if (mode === '--check' || mode === '--verify') {
    const rel = `apps/${app}/app.yaml`;
    const p = join(root, 'apps', app, 'app.yaml');
    if (!existsSync(p)) {
      err(`✗ COVERAGE LOST — ${rel} does not exist, so there is no declared origin to check.`);
      return 2;
    }
    let doc;
    try {
      doc = parseYaml(readFileSync(p, 'utf8'));
    } catch (e) {
      err(`✗ COVERAGE LOST — ${rel} cannot be read (${e.message}).`);
      return 2;
    }
    const findings = originFindings(doc, rel);
    if (findings.length) {
      for (const f of findings) err(`✗ ${f}`);
      return 1;
    }
    declared = doc.hosts.pagesOrigin;
    if (mode === '--check') {
      log(`ok  pages origin — ${rel} declares pagesOrigin ${declared} (= hosts.web), a *.pages.dev host`);
      return 0;
    }
  }
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    err('✗ COVERAGE LOST — CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are both required to read the project.');
    return 2;
  }
  if (mode === '--apply') {
    const wrangler = deps.wrangler ?? ((args) => runWrangler(args, root));
    const made = wrangler(['pages', 'project', 'create', app, '--production-branch=main']);
    if (made.missing) {
      err(`✗ COVERAGE LOST — the wrangler island is not installed (${WRANGLER_REL}): run \`npm ci --ignore-scripts --prefix tooling/wrangler\` first. Nothing was created.`);
      return 2;
    }
    if (made.code !== 0 && !/already exists|8000002/i.test(made.out)) {
      err(`✗ wrangler pages project create ${app} exited ${made.code}: ${made.out.trim().split('\n').slice(-3).join(' | ')}`);
      return 1;
    }
  }
  const read = await readSubdomain({ app, accountId, token, fetchImpl: deps.fetchImpl ?? fetch, sleep: deps.sleep });
  if (!read.ok) {
    err(read.lost ? `✗ COVERAGE LOST — ${read.why}` : `✗ ${read.why}`);
    return read.lost ? 2 : 1;
  }
  if (mode === '--verify') {
    const findings = verifyFindings(declared, read.subdomain, app);
    if (findings.length) {
      for (const f of findings) err(f);
      return 1;
    }
    log(`pagesOrigin ${declared} = the project's subdomain`);
    return 0;
  }
  log(`pagesOrigin=${read.subdomain}`);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));
