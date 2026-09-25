#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-generated-line-cites.mjs — tracked text never cites a LINE of a
// generated file, and never tells a person to hand-edit one.
//
// Parent decision 2026-09-23 (pipeline-lows, rider 4). Since nikatru 3b84337
// nikatru/OWNER_QUEUE.md is GENERATED from nikatru/owner-queue.json, and the
// nikatru hook refuses a hand edit to it. Two shapes in this repository still
// treated it as a hand-kept file:
//   · a `<file>:<line>` citation into it. Every regeneration moves the lines, so
//     the cite lands on some other real line and nothing says so — the same
//     silent drift AGENTS.md records for every `<file>:NNNN` cite, made certain.
//   · an instruction to add or append a row to it. Followed, the edit is refused
//     by the hook, or it is overwritten on the next regeneration.
// Measured on the day: one instance of each, in tooling/ci/assert-stamp-properties.mjs
// and tooling/release/submit-play.mjs. Both now name the row in owner-queue.json.
//
// SCOPE: every file `git ls-files` tracks under the root, read as text (a file
// carrying a NUL byte in its first 8 KiB is binary and skipped). Comments are
// read too: a comment is where a citation lives.
//
// COVERAGE LOST (exit 2) when `git ls-files` returns nothing, or when any of
// SCOPE_ROOTS contributes no text file — one floor per root, never one count
// over all of them, so a tree that lost apps/ cannot pass on tooling/ alone.
//
// Usage:  node tooling/ci/assert-no-generated-line-cites.mjs [repoRoot]
// Exit 0 = no tracked text cites a generated file's line or asks for a hand edit.
//      1 = at least one does; each is printed as file:line.
//      2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? process.cwd());

/** The generated files, each with the source a person edits instead. */
const GENERATED = [{ name: 'OWNER_QUEUE.md', stem: 'OWNER_QUEUE', source: 'nikatru/owner-queue.json' }];

/** Each root must contribute at least one tracked text file. */
const SCOPE_ROOTS = ['apps', 'docs', 'extensions', 'services', 'tooling'];

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error('  2 is deliberately NOT a pass: a scan that read too little is no evidence.');
  process.exit(2);
}

const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked = ls.status === 0 ? ls.stdout.split('\0').filter(Boolean) : [];
if (tracked.length === 0) {
  coverageLost([
    `\`git ls-files\` returned no tracked file under ${ROOT} (exit ${ls.status}).`,
    'The subject of this guard is the tracked text; with no manifest there is nothing to read.',
  ]);
}

const shapes = GENERATED.flatMap((g) => [
  {
    g,
    re: new RegExp(`${g.stem}(?:\\.md)?:\\d+`, 'g'),
    why: `cites a LINE of ${g.name}, which is generated from ${g.source}: every regeneration moves its lines. Cite the row id in ${g.source} instead.`,
  },
  {
    g,
    re: new RegExp(`\\b(?:add|append)(?:s|ed|ing)?\\s+(?:(?:a|an|one|the|your)\\s+)?(?:new\\s+)?rows?\\s+(?:to|in|into)\\s+\`?(?:[\\w.-]+\\/)*${g.stem}(?:\\.md)?\\b`, 'gi'),
    why: `tells a person to add a row to ${g.name}, which is generated from ${g.source} and refuses a hand edit. Point at ${g.source}.`,
  },
]);

const problems = [];
const readPerRoot = new Map(SCOPE_ROOTS.map((r) => [r, 0]));
let read = 0;
for (const rel of tracked) {
  let buf;
  try {
    buf = readFileSync(join(ROOT, ...rel.split('/')));
  } catch {
    continue; // tracked but absent from the working tree: nothing to read
  }
  if (buf.subarray(0, 8192).includes(0)) continue;
  read++;
  const top = rel.split('/')[0];
  if (readPerRoot.has(top)) readPerRoot.set(top, readPerRoot.get(top) + 1);
  const lines = buf.toString('utf8').split('\n');
  for (const [i, line] of lines.entries()) {
    for (const s of shapes) {
      for (const m of line.matchAll(s.re)) problems.push(`${rel}:${i + 1} \`${m[0]}\` ${s.why}`);
    }
  }
}

const empty = [...readPerRoot].filter(([, n]) => n === 0).map(([r]) => r);
if (empty.length) {
  coverageLost([
    `no tracked text file was read under ${empty.join(', ')} (of ${SCOPE_ROOTS.join(', ')}).`,
    'Each root is a place a citation into a generated file has been, or could be, written.',
  ]);
}

if (problems.length) {
  console.error(`✗ ${problems.length} citation(s) or instruction(s) treat a generated file as hand-kept:`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(
  `ok  no generated-file line cites — ${read} tracked text file(s) read (${[...readPerRoot].map(([r, n]) => `${r} ${n}`).join(', ')}); ` +
    `none cites a line of, or asks for a hand edit to, ${GENERATED.map((g) => g.name).join(', ')}`,
);
