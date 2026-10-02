#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// new-product.mjs — ONE readout, for one product, of which steps are DONE, which
// is the agent's NEXT (with its command), which wait on the OWNER, and which
// wait on the product going live (AFTER-LIVE).
//
// Row O-NEW-PRODUCT-HAS-NO-READOUT (PR 15b; design:
// Private/research/session-2026-09-23/newproduct-review-prep/plan-new-product-command.md §3.2, §4).
// Each kind of product already has its own command — stamp-app.mjs,
// pages-origin.mjs, provision-backend.mjs, new-tool.mjs — and the owner steps of
// families A, B, D, E and G sit beside the guards that stay red until they are
// recorded. Before this file nothing said, for product X, which of them were
// done; the guards could say "red", never "red because the owner has not done
// O-A4 yet".
//
// ── RULINGS ──────────────────────────────────────────────────────────────────
//   · READ-ONLY, FROM THE TREE, NO REGISTER OF ITS OWN. Every state is read from
//     a file another change owns: app.yaml, catalog/apps.json, the channel
//     register, app-config-data.json, the monitor register, the workflows. This
//     command writes nothing and calls no network. Its one spawn is the C6
//     meeting point (product-steps/stamp.mjs), a `--print` that runs nothing.
//   · ONE PURE READER PER STEP, in tooling/kit/product-steps/, each
//     `read(root, id, ctx)`. Each is paired, case by case, in
//     tooling/ci/test/new-product-plan.test.mjs with the guard that owns its
//     sentinel, run by path over the same fixture: where the reader says NEXT
//     that guard is red, where it says DONE that guard is green. So the readout
//     and the guards cannot disagree without a test going red.
//   · OWNER STEPS ARE PRINTED, NEVER PERFORMED. No Cloudflare, GlitchTip or
//     store-console write is inside this command; O-G1's `pages-origin.mjs
//     --apply` and O-E2's `ensure-monitors.mjs --apply` are lines it prints.
//   · THE CLIENT CRASH SINK IS NOT A STEP. There is one GlitchTip client project
//     for the portfolio (P-H-2): an app's release id carries the app, so there
//     is nothing per product to be done or not done.
//   · A WORKER'S CRASH SINK IS (rv2-newproduct-001). Since 2026-09-26 each
//     Worker's register row names its own `dsnSecret`, and a deploy delivers it
//     only when deploy-workers.yml declares it; product-steps/crash-sink.mjs
//     reads both, paired with assert-worker-error-sink.mjs. A client-only app
//     owes none, so it is DONE for one by the declaration.
//
// ── KINDS (rv2-newproduct-014, -016, -017) ───────────────────────────────────
//   The steps are per KIND: an app's twelve, an extension's, a service's and a
//   site's (STEPS_BY_KIND). An existing id's kind is read from where its slug is
//   published — PRODUCT_REGISTERS through tooling/kit/product-set.mjs, the tree
//   for the two kinds that have no register yet — so fullshot reads as the
//   extension it is, never as a Flutter app to stamp. A NEW id has no kind to
//   read, and `--kind` names it; a new id without one is a usage error, and so
//   is a `--kind` the id's register contradicts. An id published under two
//   kinds needs `--kind` too, and its id step is NEXT (the claimed-id set).
//
// ── STATES AND EXIT ──────────────────────────────────────────────────────────
//   DONE · NEXT · OWNER · AFTER-LIVE, and UNREAD for a source outside this
//   repository that is not beside it (the private corpus's product list; a CI
//   runner never holds it). UNREAD is printed, and is neither a pass nor a NEXT.
//
// Usage:
//   node tooling/kit/new-product.mjs plan <id> [--kind app|extension|service|site] [--check]
//                                    [--expect-next <step>[,<step>…]] [--root <dir>]
//                                    [--private <dir> | --no-private]
//
//   --kind         the product's kind: required for an id no register publishes
//                  yet, checked against the register for one that is.
//
//   --check        exit 1 when any step is NEXT, 0 when only DONE, OWNER,
//                  AFTER-LIVE and UNREAD remain.
//   --expect-next  with --check: exit 0 only when the NEXT steps are EXACTLY the
//                  named ones, 1 otherwise, either way. The app-brick probe uses
//                  it: a fresh stamp's name clearance is the agent's (the probe
//                  dials the stores, which CI does not), so is its price row
//                  (nothing writes apps.<id>.paywall), the backend probe adds its
//                  provision steps, and every other step must be DONE, OWNER or
//                  AFTER-LIVE.
//   --root         the tree to read (default: this file's repository).
//   --private      the private corpus; by default the directory above --root
//                  holding both Projects/ and nikatru/ is searched for
//                  Projects/Nikatru_Platform_Private.
//
// Exit: 0 read (and, with --check, no NEXT beyond --expect-next) · 1 a NEXT
// step under --check · 2 COVERAGE LOST — a reader could not read its source
// file (the first line names the reader), or the usage was wrong.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as id from './product-steps/id.mjs';
import * as pagesOrigin from './product-steps/pages-origin.mjs';
import * as stamp from './product-steps/stamp.mjs';
import * as tagFilter from './product-steps/tag-filter.mjs';
import * as backend from './product-steps/backend.mjs';
import * as storeRecords from './product-steps/store-records.mjs';
import * as nameClearance from './product-steps/name-clearance.mjs';
import * as swornFiles from './product-steps/sworn-files.mjs';
import * as priceRow from './product-steps/price-row.mjs';
import * as monitorRow from './product-steps/monitor-row.mjs';
import * as productRow from './product-steps/product-row.mjs';
import * as bundleJoin from './product-steps/bundle-join.mjs';
import * as crashSink from './product-steps/crash-sink.mjs';
import * as extensionRow from './product-steps/extension-row.mjs';
import * as extensionListings from './product-steps/extension-listings.mjs';
import * as serviceStamp from './product-steps/service-stamp.mjs';
import * as workerRow from './product-steps/worker-row.mjs';
import * as siteDir from './product-steps/site-dir.mjs';
import * as siteDeploy from './product-steps/site-deploy.mjs';
import { kindsOf, PLANNED_KINDS } from './product-set.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Each kind's steps, in order, each with the file its reader lives in. An
 *  app's are plan §3.2's twelve, with its own Worker's crash sink after the
 *  backend (rv2-newproduct-001). */
export const STEPS_BY_KIND = {
  app: [
    { reader: id, file: 'id.mjs' },
    { reader: pagesOrigin, file: 'pages-origin.mjs' },
    { reader: stamp, file: 'stamp.mjs' },
    { reader: tagFilter, file: 'tag-filter.mjs' },
    { reader: backend, file: 'backend.mjs' },
    { reader: crashSink, file: 'crash-sink.mjs' },
    { reader: storeRecords, file: 'store-records.mjs' },
    { reader: nameClearance, file: 'name-clearance.mjs' },
    { reader: swornFiles, file: 'sworn-files.mjs' },
    { reader: priceRow, file: 'price-row.mjs' },
    { reader: monitorRow, file: 'monitor-row.mjs' },
    { reader: productRow, file: 'product-row.mjs' },
    { reader: bundleJoin, file: 'bundle-join.mjs' },
  ],
  extension: [
    { reader: id, file: 'id.mjs' },
    { reader: extensionRow, file: 'extension-row.mjs' },
    { reader: extensionListings, file: 'extension-listings.mjs' },
    { reader: productRow, file: 'product-row.mjs' },
    { reader: bundleJoin, file: 'bundle-join.mjs' },
  ],
  service: [
    { reader: id, file: 'id.mjs' },
    { reader: serviceStamp, file: 'service-stamp.mjs' },
    { reader: workerRow, file: 'worker-row.mjs' },
    { reader: backend, file: 'backend.mjs' },
    { reader: crashSink, file: 'crash-sink.mjs' },
    { reader: monitorRow, file: 'monitor-row.mjs' },
    { reader: productRow, file: 'product-row.mjs' },
  ],
  site: [
    { reader: id, file: 'id.mjs' },
    { reader: siteDir, file: 'site-dir.mjs' },
    { reader: siteDeploy, file: 'site-deploy.mjs' },
    { reader: productRow, file: 'product-row.mjs' },
  ],
};

/** An app's steps: the list the app-brick probe and app #1 are read with. */
export const STEPS = STEPS_BY_KIND.app;

/**
 * The kind to plan `productId` as: `{ kind }`, or `{ usage }` (exit 2) when it
 * cannot be told — a new id with no `--kind`, a `--kind` its register
 * contradicts, an id two kinds publish with no `--kind`, or a register that
 * could not be read.
 */
export function resolveKind(root, productId, wanted = null) {
  if (wanted !== null && !PLANNED_KINDS.includes(wanted)) {
    return { usage: `--kind ${wanted} is no kind this readout plans (${PLANNED_KINDS.join(', ')})` };
  }
  const { kinds, problems } = kindsOf(root, productId);
  if (problems.length) return { usage: `the product registers could not be read (${problems[0]})` };
  const planned = kinds.filter((k) => PLANNED_KINDS.includes(k.kind));
  const where = planned.map((k) => `${k.kind} (${k.source})`).join(', ');
  if (wanted !== null) {
    if (planned.length && !planned.some((k) => k.kind === wanted)) {
      return { usage: `"${productId}" is published as ${where}, and --kind says ${wanted}` };
    }
    return { kind: wanted };
  }
  if (planned.length === 1) return { kind: planned[0].kind };
  if (planned.length > 1) return { usage: `"${productId}" is published as ${where}: name the one to plan with --kind` };
  return { usage: `"${productId}" is published in no product register, so it is new: name its kind with --kind ${PLANNED_KINDS.join('|')}` };
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The private corpus beside `root`: the first directory upward holding both
 *  Projects/ and nikatru/, then its Projects/Nikatru_Platform_Private; or
 *  `<root>/Private`. null when neither exists. */
export function findPrivateRoot(root) {
  if (isDir(join(root, 'Private'))) return join(root, 'Private');
  let d = resolve(root);
  for (;;) {
    if (isDir(join(d, 'Projects')) && isDir(join(d, 'nikatru'))) {
      const p = join(d, 'Projects', 'Nikatru_Platform_Private');
      return isDir(p) ? p : null;
    }
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** Every step's answer for a product of `kind`, in order, as `{ name, file, …answer }`.
 *  A refused id stops the reading: every later step is keyed on it. */
export function planProduct(root, productId, { privateRoot = null, kind = 'app' } = {}) {
  const out = [];
  for (const { reader, file } of STEPS_BY_KIND[kind]) {
    const a = reader.read(root, productId, { privateRoot, kind });
    out.push({ name: reader.name, file: `tooling/kit/product-steps/${file}`, ...a });
    if (reader === id && a.state !== 'DONE') break;
  }
  return out;
}

/** The exit code for a readout. */
export function exitCodeOf(answers, { check = false, expectNext = null } = {}) {
  if (answers.some((a) => a.lost)) return 2;
  if (!check) return 0;
  const next = answers.filter((a) => a.state === 'NEXT').map((a) => a.name).sort();
  if (expectNext === null) return next.length ? 1 : 0;
  const want = [...expectNext].sort();
  return next.length === want.length && next.every((n, i) => n === want[i]) ? 0 : 1;
}

/** The printed readout, one block per step. */
export function render(answers, productId, kind = 'app') {
  const lines = [];
  for (const a of answers.filter((x) => x.lost)) {
    lines.push(`✗ COVERAGE LOST — reader "${a.name}" (${a.file}) could not read its source: ${a.lost}`);
  }
  lines.push(`new-product plan ${productId} (${kind})`);
  for (const a of answers) {
    if (a.lost) {
      lines.push(`LOST ${a.name} — ${a.lost}`);
      continue;
    }
    lines.push(`${a.state} ${a.name} — ${a.detail}`);
    if (a.command) lines.push(`       run:   ${a.command}`);
    if (a.owner) lines.push(`       owner: ${a.owner}`);
    lines.push(`       guard: ${a.guard}`);
  }
  const steps = STEPS_BY_KIND[kind].length;
  if (answers.length < steps && !answers.some((a) => a.lost)) {
    lines.push(`(${steps - answers.length} later step(s) not read: each is keyed on the id)`);
  }
  const count = (s) => answers.filter((a) => a.state === s).length;
  lines.push(
    `summary: ${count('DONE')} DONE, ${count('NEXT')} NEXT, ${count('OWNER')} OWNER, ${count('AFTER-LIVE')} AFTER-LIVE, ` +
      `${count('UNREAD')} UNREAD, ${answers.filter((a) => a.lost).length} LOST`,
  );
  return lines;
}

const USAGE =
  'usage: new-product.mjs plan <id> [--kind app|extension|service|site] [--check] [--expect-next <step>[,<step>…]] ' +
  '[--root <dir>] [--private <dir> | --no-private]';

/** @returns {number} the exit code */
export function main(argv, { log = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const valued = new Set(['--root', '--private', '--expect-next', '--kind']);
  const known = new Set([...valued, '--check', '--no-private']);
  const bad = argv.filter((a) => a.startsWith('--') && !known.has(a));
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const value = (f) => {
    const i = argv.indexOf(f);
    return i === -1 ? null : argv[i + 1] ?? '';
  };
  if (bad.length || positional[0] !== 'plan' || positional.length !== 2 || [...valued].some((f) => value(f) === '')) {
    err(`✗ COVERAGE LOST — ${bad.length ? `unknown flag ${bad[0]}; ` : ''}${USAGE}`);
    return 2;
  }
  const productId = positional[1];
  const root = resolve(value('--root') ?? REPO);
  if (!existsSync(root)) {
    err(`✗ COVERAGE LOST — --root ${root} does not exist`);
    return 2;
  }
  const privateRoot = argv.includes('--no-private') ? null : value('--private') !== null ? resolve(value('--private')) : findPrivateRoot(root);
  const expect = value('--expect-next');
  const expectNext = expect === null ? null : expect.split(',').map((s) => s.trim()).filter(Boolean);
  if (expectNext !== null && !argv.includes('--check')) {
    err(`✗ COVERAGE LOST — --expect-next grades --check's answer, so it needs --check; ${USAGE}`);
    return 2;
  }
  const k = resolveKind(root, productId, value('--kind'));
  if (k.usage) {
    err(`✗ COVERAGE LOST — ${k.usage}; ${USAGE}`);
    return 2;
  }
  const names = new Set(STEPS_BY_KIND[k.kind].map((s) => s.reader.name));
  const unknownStep = (expectNext ?? []).find((n) => !names.has(n));
  if (unknownStep) {
    err(`✗ COVERAGE LOST — --expect-next names "${unknownStep}", which is no ${k.kind} step. Steps: ${[...names].join(', ')}`);
    return 2;
  }
  const answers = planProduct(root, productId, { privateRoot, kind: k.kind });
  const code = exitCodeOf(answers, { check: argv.includes('--check'), expectNext });
  for (const l of render(answers, productId, k.kind)) (l.startsWith('✗') ? err : log)(l);
  if (argv.includes('--check') && code === 1) {
    const next = answers.filter((a) => a.state === 'NEXT').map((a) => a.name);
    err(
      expectNext === null
        ? `✗ --check: ${next.length} NEXT step(s): ${next.join(', ')}`
        : `✗ --check --expect-next ${expectNext.join(',')}: the NEXT steps are [${next.join(', ')}]`,
    );
  }
  return code;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
