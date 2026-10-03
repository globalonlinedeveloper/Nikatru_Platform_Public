#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// gen-release-carries.mjs — RELEASE-RUNBOOK.md §3 "what a Release carries",
// GENERATED from the code that decides it, never typed beside it.
//
// ⏱ ADDED 2026-10-01 (O-RELEASE-RUNBOOK-CONTRADICTS-THE-LANE, review AA-27). §3a
// and §3b of tooling/release/RELEASE-RUNBOOK.md were tables measured on
// 2026-08-09, each followed by a dated correction saying no Release carries what
// the table lists: three layers of text, and a reader at the moment of a first
// tag had to find the newest one to know what the tag publishes. The answer is
// release-manifest.mjs's — `releaseCarriesFor`, `releaseCarriesNow`,
// `storeOnlyFormats`, `releaseOwed` — read over tooling/channel-register.json, so
// the block is written from those, per row of the app surface, and `--check` in
// ci.yml fails when the runbook says anything else.
//
// Usage:
//   node tooling/ci/gen-release-carries.mjs            print the block
//   node tooling/ci/gen-release-carries.mjs --write    write it into the runbook
//   node tooling/ci/gen-release-carries.mjs --check    exit 1 when the runbook's block differs
// Exit 0 = written / matches. 1 = stale. 2 = COVERAGE LOST (no register, no block markers).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { releaseCarriesFor, releaseCarriesNow, storeOnlyFormats, releaseOwed, ruledOutBy, MANIFEST_NAME, RELEASE_JSON_NAME } from './release-manifest.mjs';
import { findBlock, spliceBlock, blockMatches } from './gen-ci-map.mjs';

export const TOOL = 'gen-release-carries';
export const BLOCK = 'carries';
export const COMMAND = 'node tooling/ci/gen-release-carries.mjs';
const RUNBOOK = 'tooling/release/RELEASE-RUNBOOK.md';
const REGISTER = 'tooling/channel-register.json';
const SURFACE = 'app';

const cell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/** PURE. One row's answer: does a Release carry its file, and why, in the register's words. */
export function carriesAnswer(register, c) {
  const constraint = ruledOutBy(c);
  if (constraint !== null) return ['no', `ruled out by ${constraint}`];
  if (releaseCarriesNow(register, c)) {
    const why = c.kind === 'direct' ? 'a direct row: the Release is its download origin' : 'a store a person uploads to by hand, from the Release';
    return ['**yes**', c.lane ? why : `${why}; no lane emits it yet`];
  }
  if (releaseCarriesFor(register, c)) return ['withheld', 'carried once its signing identity is pinned (release-manifest.mjs `withheldFormats`)'];
  if (c.kind === 'web') return ['no', 'served from Cloudflare Pages, never a Release asset'];
  return ['no', 'a submittable store: its own submit-*.yml builds and submits its own copy'];
}

/** PURE. The block's body lines for the app surface of `register`. */
export function carriesBlock(register) {
  const rows = (register?.channels ?? []).filter((c) => c?.surface === SURFACE);
  const owed = releaseOwed(register, SURFACE);
  const storeOnly = [...storeOnlyFormats(register, SURFACE)].sort();
  const lines = [
    `A Release on the \`${SURFACE}\` surface holds \`${MANIFEST_NAME}\` (first in the asset list), \`${RELEASE_JSON_NAME}\`, and a loose`,
    'installer for each row below that answers **yes** — nothing else. The release job downloads only the',
    '`<app>-*` upload namespace and the apps.gov.in name; a build proof is uploaded as `ci-proof-…`, a',
    'store-only file as `store-<app>-…` and a symbols directory as `symbols-<app>-…`, and',
    '`assert-release-durable.mjs` limbs 1b and 1c fail any `<app>-*` upload no row below says a Release carries.',
    '',
    '| Channel | Kind | Format(s) | A Release carries it? | Why |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const c of rows) {
    const formats = (c.artifactFormats ?? []).map((f) => `\`${f}\``).join(', ');
    const [answer, why] = carriesAnswer(register, c);
    lines.push(`| \`${cell(c.id)}\` | ${cell(c.kind)} | ${cell(formats)} | ${answer} | ${cell(why)} |`);
  }
  lines.push(
    '',
    `Store-only formats (no row takes them from a Release, so \`--stage\` refuses them): ${storeOnly.map((f) => `\`${f}\``).join(', ') || 'none'}.`,
    `Formats a lane on this surface owes a Release today: ${owed.owed.length ? owed.owed.map((f) => `\`${f}\``).join(', ') : 'none — the Release carries only its two records until a row above answers **yes** with a lane'}.`,
  );
  return lines;
}

function coverageLost(why) {
  console.error(`✗ COVERAGE LOST — ${why}`);
  process.exitCode = 2;
}

function main(argv) {
  const root = resolve(argv.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  let register;
  try {
    register = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  } catch (e) {
    return coverageLost(`${REGISTER} could not be read (${e.message})`);
  }
  const body = carriesBlock(register);
  if (!argv.includes('--write') && !argv.includes('--check')) {
    console.log(body.join('\n'));
    return;
  }
  let text;
  try {
    text = readFileSync(join(root, RUNBOOK), 'utf8');
  } catch (e) {
    return coverageLost(`${RUNBOOK} could not be read (${e.message})`);
  }
  const f = findBlock(text, TOOL, BLOCK);
  if (!f.ok) return coverageLost(`${RUNBOOK} has no complete \`${BLOCK}\` block (${f.why})`);
  if (argv.includes('--write')) {
    writeFileSync(join(root, RUNBOOK), spliceBlock(text, TOOL, BLOCK, COMMAND, body));
    console.log(`wrote ${BLOCK} into ${RUNBOOK}`);
    return;
  }
  if (!blockMatches(text, TOOL, BLOCK, COMMAND, body)) {
    console.error(`${RUNBOOK}:${f.begin + 1} — the \`${BLOCK}\` block is not what release-manifest.mjs and ${REGISTER} say — run \`${COMMAND} --write\` and commit what it writes`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${TOOL}: the runbook's §3 block matches release-manifest.mjs over ${REGISTER}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
