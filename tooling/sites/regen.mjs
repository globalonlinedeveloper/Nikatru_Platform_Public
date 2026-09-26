#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// regen.mjs — the site surface's generators, run in ONE order from ONE list.
//
// Row O-NEW-APP-IS-NOT-ONE-COMMAND, its chain limb.
//
//     apps/<id>/app.yaml ──render──▶ catalog/apps.json + listing copy + icon labels
//     apps/<id>/privacy.yaml ──render-privacy──▶ the notice surfaces
//     catalog/apps.json ──apps-data──▶ sites/_shared/_data/apps.json
//     catalog/apps.json + rail + listings ──landing-payload──▶ catalog/apps-landing.json
//     docs/platform/supabase/email-templates ──auth-mail──▶ sites/nikatru/auth-mail/
//     sites/_shared/_data/apps.json + rail + pages ──discovery──▶ sites/nikatru/
//     catalog/apps.json + app.yaml ──well-known──▶ sites/nikatru/.well-known/
//
// ── WHY AN ORDER, AND WHY IT LIVES HERE ─────────────────────────────────────
// Each arrow above reads what an earlier one wrote. Run apps-data before render
// and the site feed is built from the catalogue as it was BEFORE the new app
// joined it; every file is well-formed, every generator exits 0, and the feed
// is one app short. Until this file the order was carried by whoever typed the
// commands: post_gen.dart ran render alone, the deploy job runs discovery
// alone, and a new app's author ran the rest from memory. `ORDER` below is the
// list; post_gen.dart and tooling/kit/stamp-app.mjs run this CLI, and
// ci.yml's `sites` job runs its `--check`. A generator that joins the site
// surface joins it by gaining a row here.
//
// ── THREE KINDS OF ENTRY ────────────────────────────────────────────────────
//   · 'check'      the generator has its own `--check`; --check spawns it WITH
//                  that flag, never without.
//   · 'plan'       no `--check` flag, but an exported planner. --check compares
//                  the plan with the disk in memory and spawns nothing.
//   · 'git-dated'  discovery. Its sitemap <lastmod> is each page's git date, so
//                  the right bytes for a page a PR changes exist only after that
//                  PR merges; the deploy job generates it, uncommitted. --check
//                  names the skip on its own line and compares it (in memory,
//                  through planDiscovery) only under --with-discovery.
//
// Usage:  node tooling/sites/regen.mjs [repoRoot]                    write
//         node tooling/sites/regen.mjs [repoRoot] --check            compare, write nothing
//         node tooling/sites/regen.mjs [repoRoot] --check --with-discovery
// Write mode stops at the first entry that fails: a later entry reads an earlier
// one's output, and running it over a failed input writes a wrong file that
// looks right. --check runs every entry, so one run names every stale output.
// Exit 0 = every entry that ran is green.
// Exit 1 = an output is stale, or a generator failed.
// Exit 2 = COVERAGE LOST: a generator exited 2 (render and render-privacy do on
//          COVERAGE LOST) or did not exit at all. Never a pass; the line names it.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planWellKnown, wellKnownOnDisk } from './generate-well-known.mjs';
import { planDiscovery } from './generate-discovery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

/** The chain. Every entry names its script repo-relative, so a reader can find
 *  each one without resolving anything. */
export const ORDER = Object.freeze([
  Object.freeze({ id: 'render', script: 'tooling/app-yaml/render.mjs', kind: 'check' }),
  Object.freeze({ id: 'render-privacy', script: 'tooling/app-yaml/render-privacy.mjs', kind: 'check' }),
  Object.freeze({ id: 'apps-data', script: 'tooling/sites/generate-apps-data.mjs', kind: 'check' }),
  Object.freeze({ id: 'landing-payload', script: 'tooling/sites/generate-landing-payload.mjs', kind: 'check' }),
  Object.freeze({ id: 'auth-mail', script: 'tooling/sites/gen-auth-mail.mjs', kind: 'check' }),
  Object.freeze({ id: 'discovery', script: 'tooling/sites/generate-discovery.mjs', kind: 'git-dated' }),
  Object.freeze({ id: 'well-known', script: 'tooling/sites/generate-well-known.mjs', kind: 'plan' }),
]);

/** The file's bytes, or null when it cannot be read. Read once: the comparison
 *  is decided on these bytes, never on a separate existence check. */
function readOrNull(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Every planned file whose bytes on disk differ, repo-relative. */
function staleAgainstDisk(root, files) {
  const stale = [];
  for (const [rel, contents] of files) {
    if (readOrNull(join(root, ...rel.split('/'))) !== contents) stale.push(rel);
  }
  return stale;
}

/** The spawn this file makes, and the only one: the generator from THIS
 *  checkout, over `root`, with the same Node that runs the chain. */
function spawnEntry(entry, root, args) {
  const r = spawnSync(process.execPath, [join(REPO, ...entry.script.split('/')), root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd();
  if (r.status === null) {
    const why = r.error ? r.error.message : `signal ${r.signal}`;
    return { code: 2, out, verdict: `${entry.script} did not exit (${why}), so it proved nothing` };
  }
  return { code: r.status, out, verdict: `${entry.script}${args.length ? ` ${args.join(' ')}` : ''} exited ${r.status}` };
}

/** --check for a 'plan' entry: the plan against the disk, plus any file under
 *  the generator's directory it does not own (its CLI exits 1 on one). */
function checkWellKnown(root) {
  const plan = planWellKnown(root);
  if (plan.problems.length) {
    return { code: 1, out: plan.problems.map((p) => `    ${p}`).join('\n'), verdict: 'planWellKnown reported problem(s)' };
  }
  const stale = staleAgainstDisk(root, plan.files);
  const stray = wellKnownOnDisk(root).filter((rel) => !plan.files.has(rel));
  const named = [...stale.map((s) => `    stale ${s}`), ...stray.map((s) => `    unowned ${s}`)];
  if (named.length) return { code: 1, out: named.join('\n'), verdict: `${named.length} file(s) differ from planWellKnown` };
  return { code: 0, out: '', verdict: `planWellKnown matches the disk (${plan.files.size} file(s) planned)` };
}

/** --check --with-discovery: planDiscovery against the disk, in memory. */
function checkDiscovery(root) {
  const plan = planDiscovery(root);
  if (plan.problems.length) {
    return { code: 1, out: plan.problems.map((p) => `    ${p}`).join('\n'), verdict: 'planDiscovery reported problem(s)' };
  }
  const stale = staleAgainstDisk(root, plan.files);
  if (stale.length) return { code: 1, out: stale.map((s) => `    stale ${s}`).join('\n'), verdict: `${stale.length} file(s) differ from planDiscovery` };
  return { code: 0, out: '', verdict: `planDiscovery matches the disk (${plan.files.size} file(s) planned)` };
}

/** One entry, in one mode. Returns null for a named skip. */
function runEntry(entry, root, { check, withDiscovery }) {
  if (!check) return spawnEntry(entry, root, []);
  if (entry.kind === 'check') return spawnEntry(entry, root, ['--check']);
  if (entry.kind === 'plan') return checkWellKnown(root);
  if (entry.kind === 'git-dated') return withDiscovery ? checkDiscovery(root) : null;
  return { code: 2, out: '', verdict: `ORDER entry "${entry.id}" has kind "${entry.kind}", which this file cannot run` };
}

/**
 * Run the chain over `root`. Returns the exit code and every line it would
 * print, so a test reads the same verdict the CLI prints.
 *
 * @returns {{code: 0|1|2, lines: string[], ran: string[], skipped: string[]}}
 */
export function regen(root, { check = false, withDiscovery = false } = {}) {
  const lines = [];
  const ran = [];
  const skipped = [];
  let lost = null;
  let failed = null;
  for (const entry of ORDER) {
    if (!check && (lost || failed)) {
      skipped.push(entry.id);
      lines.push(`NOT RUN ${entry.id} — an earlier entry failed, and ${entry.id} would read its output`);
      continue;
    }
    const r = runEntry(entry, root, { check, withDiscovery });
    if (r === null) {
      skipped.push(entry.id);
      lines.push(
        `skip ${entry.id} — git-dated: its sitemap <lastmod> is the merge date, so the deploy job ` +
          `generates it, uncommitted. Pass --with-discovery to compare it in memory.`,
      );
      continue;
    }
    ran.push(entry.id);
    if (r.code === 0) {
      lines.push(`ok   ${entry.id} — ${r.verdict}`);
      continue;
    }
    const label = r.code === 2 ? 'COVERAGE LOST' : check ? 'STALE' : 'FAILED';
    lines.push(`✗ ${label} ${entry.id} — ${r.verdict}`);
    if (r.out) lines.push(r.out);
    if (r.code === 2) lost ??= entry.id;
    else failed ??= entry.id;
  }
  const mode = check ? 'regen --check' : 'regen';
  if (lost) {
    lines.push(`${mode}: COVERAGE LOST — ${lost} exited 2, so its outputs were not checked. Never a pass.`);
    return { code: 2, lines, ran, skipped };
  }
  if (failed) {
    lines.push(
      check
        ? `${mode}: STALE — first at ${failed}. Run \`node tooling/sites/regen.mjs\` and commit what it writes.`
        : `${mode}: FAILED at ${failed}; the entries after it were not run.`,
    );
    return { code: 1, lines, ran, skipped };
  }
  lines.push(`${mode}: ok — ${ran.length} of ${ORDER.length} entr(ies) ran green, ${skipped.length} skipped by name`);
  return { code: 0, lines, ran, skipped };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const known = new Set(['--check', '--with-discovery']);
  const unknown = args.filter((a) => a.startsWith('--') && !known.has(a));
  if (unknown.length) {
    console.error(`regen: unknown flag(s) ${unknown.join(', ')}. Known: ${[...known].join(', ')}.`);
    process.exit(2);
  }
  const check = args.includes('--check');
  if (args.includes('--with-discovery') && !check) {
    console.error('regen: --with-discovery only changes --check; write mode always runs discovery.');
    process.exit(2);
  }
  const root = resolve(args.find((a) => !a.startsWith('--')) ?? REPO);
  const { code, lines } = regen(root, { check, withDiscovery: args.includes('--with-discovery') });
  for (const l of lines) (code === 0 ? console.log : console.error)(l);
  process.exitCode = code;
}
