#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-sandbox-service-role.mjs — the LIVE sandbox Workers hold no
// SUPABASE_SERVICE_ROLE_KEY.
//
// ⏱ 2026-09-30 · ADR no.NNN (native sign-in serves only attested app installs),
// second independent review of #1070, finding 4. The account twin of the static
// check: tooling/ci/wrangler-environments.mjs refuses the key in a sandbox
// environment's `vars`/`secrets`, and tooling/ci/assert-money-config.mjs limb 1e
// refuses a workflow step that puts it. Neither can see a HAND-RUN
// `wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env sandbox`. This reads what
// the account actually serves.
//
// 🔴 WHY IT MATTERS. The sandbox Workers share production's identity project,
// and the service-role bearer is what makes GoTrue skip its captcha: a sandbox
// Worker holding it would be a second captcha-free door onto REAL accounts.
//
// ── WHAT IT READS (read-only, NAMES only) ────────────────────────────────────
// For each sandbox script (tooling/store/capture-backend.mjs `sandboxBackend`,
// the one reading of which scripts are the sandbox deploys), the pattern
// tooling/ops/auth-cutover-preflight.mjs uses for a Worker's bindings:
//   /workers/scripts/<name>/deployments      the active deployment's version(s)
//   /workers/scripts/<name>/versions/<id>    each serving version's bindings
//   /workers/scripts/<name>/versions         the newest uploaded version, which
//                                            the next `wrangler deploy` keeps
// A binding is judged by NAME. A `secret_text` binding's value is never returned
// by the API, and nothing here would print it if it were.
//
// Exit: 0 = no sandbox script serves or holds the key · 1 = one does ·
//       2 = COULD NOT LOOK (no token, or a read that did not answer)
// Usage: node tooling/ops/check-sandbox-service-role.mjs
//   env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// ─────────────────────────────────────────────────────────────────────────────
import { fileURLToPath } from 'node:url';
import { sandboxBackend } from '../store/capture-backend.mjs';
import { CouldNotLook } from './bounded-retry.mjs';
import { cf } from './check-retired-names-live.mjs';

export { CouldNotLook } from './bounded-retry.mjs';

/** The binding no sandbox Worker may hold. */
export const FORBIDDEN_BINDING = 'SUPABASE_SERVICE_ROLE_KEY';

/**
 * IMPURE. The binding NAMES of every version a sandbox script serves, plus its
 * newest uploaded version, or CouldNotLook. A script that is not deployed at all
 * (no deployment) holds nothing and is reported as such.
 */
export async function readSandboxBindings({ accountId, token, scripts }, api = cf) {
  const out = [];
  for (const script of scripts) {
    const base = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(script)}`;
    let deployments;
    try {
      deployments = (await api(`${base}/deployments`, token))?.deployments;
    } catch (err) {
      // A sandbox script that was never deployed answers 404: it serves nothing.
      if (err instanceof CouldNotLook && /HTTP 404/.test(err.message)) {
        out.push({ script, deployed: false, versions: [] });
        continue;
      }
      throw err;
    }
    if (!Array.isArray(deployments)) throw new CouldNotLook(`${script}: the deployments answer carried no deployments[]`);
    const ids = new Set();
    for (const d of deployments.slice(0, 1)) {
      for (const v of Array.isArray(d?.versions) ? d.versions : []) if (v?.version_id) ids.add(v.version_id);
    }
    const list = await api(`${base}/versions`, token);
    const newest = Array.isArray(list?.items) ? list.items[0]?.id : undefined;
    if (newest) ids.add(newest);
    const versions = [];
    for (const id of ids) {
      const bindings = (await api(`${base}/versions/${encodeURIComponent(id)}`, token))?.resources?.bindings;
      if (!Array.isArray(bindings)) throw new CouldNotLook(`${script} version ${String(id).slice(0, 8)}: no resources.bindings[] in the answer`);
      versions.push({ id, names: bindings.map((b) => b?.name).filter((n) => typeof n === 'string') });
    }
    out.push({ script, deployed: true, versions });
  }
  return out;
}

/** PURE. The verdict over what readSandboxBindings returned. */
export function judge(reads) {
  if (!Array.isArray(reads) || reads.length === 0) {
    throw new CouldNotLook('no sandbox script was named, so nothing was read — an unread sandbox is not a clean one.');
  }
  const deployed = reads.filter((r) => r.deployed);
  for (const r of deployed) {
    if (r.versions.length === 0) throw new CouldNotLook(`${r.script} is deployed but no version of it was read.`);
  }
  const findings = deployed.flatMap((r) =>
    r.versions.filter((v) => v.names.includes(FORBIDDEN_BINDING)).map((v) => `${r.script} version ${String(v.id).slice(0, 8)}`),
  );
  const counted = `${reads.length} sandbox script(s), ${deployed.length} deployed, ${deployed.reduce((n, r) => n + r.versions.length, 0)} version(s) read`;
  if (findings.length === 0) {
    return { ok: true, line: `ok   sandbox service-role — ${counted}; none holds ${FORBIDDEN_BINDING}` };
  }
  return {
    ok: false,
    line:
      `✗ sandbox service-role — ${FORBIDDEN_BINDING} is bound on: ${findings.join('; ')}. A sandbox Worker shares ` +
      "production's identity project, and that bearer makes GoTrue skip its captcha. Delete it: " +
      `\`wrangler secret delete ${FORBIDDEN_BINDING} --env sandbox\` in the Worker's directory (ADR no.NNN).`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const token = (process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  try {
    if (!token) throw new CouldNotLook('CLOUDFLARE_API_TOKEN is not set, so the account could not be read.');
    if (!accountId) throw new CouldNotLook('CLOUDFLARE_ACCOUNT_ID is not set, so the account could not be read.');
    let scripts;
    try {
      scripts = Object.values(sandboxBackend()).map((w) => w.scriptName);
    } catch (err) {
      throw new CouldNotLook(`the sandbox script names could not be derived: ${err.message}`);
    }
    const verdict = judge(await readSandboxBindings({ accountId, token, scripts }));
    if (verdict.ok) console.log(verdict.line);
    else {
      console.error(verdict.line);
      process.exitCode = 1;
    }
  } catch (err) {
    if (!(err instanceof CouldNotLook)) throw err;
    console.error('check-sandbox-service-role: COULD NOT LOOK');
    console.error(`    ${err.message}`);
    console.error('    Exit 2 = the sandbox Workers were not read. An unread sandbox is not a clean one.');
    process.exitCode = 2;
  }
}
