// ─────────────────────────────────────────────────────────────────────────────
// ci-map.test.mjs — tooling/ci/gen-ci-map.mjs must be able to say NO.
//
// The generator writes five marker blocks from the workflows and checks three
// limbs over the lane pages and the tree. Every case below builds a small tree in
// the OS temp directory, runs the real CLI over it, and reads the exit code and
// the line it prints: a green control first, then the one edit that must red it.
//
//   M1  --write fills every block, and --check is then green (the control)
//   M2  a hand edit inside a block reds --check, naming the block and its line
//   M3  a workflow edit (one trigger line) reds --check until --write runs
//   M4  a missing or doubled marker, no workflow, or a jobless workflow is exit 2
//   M5  limb (a): an `### above` anchor quoting a line the workflow lacks
//   M6  limb (b): a `## job` heading naming a key that is not a job
//   M7  limb (c): a tracked file outside docs/ citing a doc line by number
//   M8  a name carrying `\|` stays one table cell (the backslash escaped first)
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { beginMarker, endMarker, TOOL } from '../gen-ci-map.mjs';

const GEN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'gen-ci-map.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-cimap-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const gitEnv = () => {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX']) delete env[k];
  return env;
};
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnv() });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
};
const run = (...args) => spawnSync(process.execPath, [GEN, ...args], { encoding: 'utf8', timeout: 60_000, env: gitEnv() });

const markers = (block) => [beginMarker(TOOL, block), endMarker(TOOL, block)].join('\n');

const CI_YML = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  lint:
    name: Lint the tree
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v4
      - run: make lint
        env:
          TOKEN: \${{ secrets.LINT_TOKEN }}
  docs:
    runs-on: ubuntu-24.04
    steps:
      - uses: some-owner/some-action@0123456789abcdef0123456789abcdef01234567
  ci-gate:
    name: CI gate
    needs: [lint]
    runs-on: ubuntu-24.04
    steps:
      - run: echo ok
`;

const LANE_YML = `name: Build the lane
on:
  push:
    tags:
      - 'app-v*'
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-24.04
    strategy:
      fail-fast: false
    steps:
      - name: Build it
        run: make build
        env:
          KEY: \${{ secrets.BUILD_KEY }}
`;

const LANE_MD = `# \`lane.yml\`

## job \`build\`

### above \`fail-fast: false\`

Each leg is its own proof.

### above \`run: make build\`

The build.
`;

const README_MD = `# CI

## 3. The lane map

${markers('lane-map')}

## 6. Secrets

${markers('secrets')}

## 7. Settings

${markers('actions')}

## 9. One page per workflow

${markers('workflows')}
`;

const RUNBOOK_MD = `# Runbook

## 2. What a tag triggers

${markers('tag-trigger')}
`;

let seq = 0;
/** A whole small tree, git-tracked, with every block's markers and nothing between them. */
function seed(overrides = {}) {
  const root = join(TMP, `t${seq++}`);
  const files = {
    '.github/workflows/ci.yml': CI_YML,
    '.github/workflows/lane.yml': LANE_YML,
    'docs/ci/README.md': README_MD,
    'docs/ci/lane.md': LANE_MD,
    'tooling/release/RELEASE-RUNBOOK.md': RUNBOOK_MD,
    'tooling/tool.mjs': '// cites docs/ci/lane.md by its section, never by a line\n',
    ...overrides,
  };
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  return root;
}
/** seed(), then --write, asserting it wrote. */
function written(overrides) {
  const root = seed(overrides);
  const w = run('--write', root);
  assert.equal(w.status, 0, w.stderr);
  return root;
}
const edit = (root, rel, from, to) => {
  const abs = join(root, rel);
  const text = readFileSync(abs, 'utf8');
  assert.ok(text.includes(from), `${rel} does not contain ${from}`);
  writeFileSync(abs, text.replace(from, to));
};
const lineOf = (root, rel, needle) => readFileSync(join(root, rel), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;

describe('gen-ci-map', () => {
  test('M1 · --write fills all five blocks from the workflows, and --check is then green', () => {
    const root = seed();
    const before = run('--check', root);
    assert.equal(before.status, 1, `empty blocks must be a finding: ${before.stdout}${before.stderr}`);
    assert.match(before.stderr, /the `lane-map` block is not what the workflows say/);
    const w = run('--write', root);
    assert.equal(w.status, 0, w.stderr);
    const after = run('--check', root);
    assert.equal(after.status, 0, after.stderr);
    const readme = readFileSync(join(root, 'docs/ci/README.md'), 'utf8');
    assert.match(readme, /<!-- why: GENERATED by node tooling\/ci\/gen-ci-map\.mjs --write\. Never hand-edit\. -->/);
    assert.match(readme, /\| `lint` \| Lint the tree \| — \| — \| yes \|/);
    assert.match(readme, /\| `docs` \| — \| — \| — \| \*\*no\*\* \|/);
    assert.match(readme, /\| `ci-gate` \| CI gate \| `lint` \| — \| — \(the aggregate/);
    assert.match(readme, /\| `LINT_TOKEN` \| `ci\.yml` \|/);
    assert.match(readme, /\| `some-owner\/some-action` \| third-party \| `ci\.yml` \|/);
    assert.match(readme, /\| \[`lane\.md`\]\(lane\.md\) \| `\.github\/workflows\/lane\.yml` \| Build the lane \| `push`, `workflow_dispatch` \| 1 \|/);
    const runbook = readFileSync(join(root, 'tooling/release/RELEASE-RUNBOOK.md'), 'utf8');
    assert.match(runbook, /\| `\.github\/workflows\/lane\.yml` \| Build the lane \| `app-v\*` \|/);
    const again = run('--write', root);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(readFileSync(join(root, 'docs/ci/README.md'), 'utf8'), readme, '--write twice must write the same bytes');
  });

  test('M2 · a hand edit inside a generated block reds --check at the block, and --write restores it', () => {
    const root = written();
    edit(root, 'docs/ci/README.md', '| `lint` | Lint the tree | — | — | yes |', '| `lint` | Lint the tree | — | — | no |');
    const r = run('--check', root);
    assert.equal(r.status, 1, r.stderr);
    const at = lineOf(root, 'docs/ci/README.md', beginMarker(TOOL, 'lane-map'));
    assert.ok(r.stderr.includes(`docs/ci/README.md:${at} — the \`lane-map\` block is not what the workflows say — run`), r.stderr);
    assert.doesNotMatch(r.stderr, /`secrets` block/);
    assert.equal(run('--write', root).status, 0);
    assert.equal(run('--check', root).status, 0);
  });

  test('M3 · one trigger line edited in a workflow reds the blocks that quote it, until --write', () => {
    const root = written();
    edit(root, '.github/workflows/lane.yml', "      - 'app-v*'", "      - 'app-v[0-9]*'");
    const r = run('--check', root);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /tooling\/release\/RELEASE-RUNBOOK\.md:\d+ — the `tag-trigger` block is not what the workflows say/);
    assert.equal(run('--write', root).status, 0);
    assert.equal(run('--check', root).status, 0);
  });

  test('M4 · a missing or doubled marker, an empty workflow set and a jobless workflow are COVERAGE LOST (exit 2), never a pass', () => {
    const noEnd = seed({ 'tooling/release/RELEASE-RUNBOOK.md': `# Runbook\n\n${beginMarker(TOOL, 'tag-trigger')}\n` });
    const a = run('--check', noEnd);
    assert.equal(a.status, 2, a.stderr);
    assert.match(a.stderr, /^COVERAGE LOST — gen-ci-map: tooling\/release\/RELEASE-RUNBOOK\.md has no complete `tag-trigger` block/m);
    assert.equal(run('--write', noEnd).status, 2, '--write must refuse too, and write nothing');

    const doubled = seed({ 'docs/ci/README.md': `${README_MD}\n${markers('actions')}\n` });
    const b = run('--check', doubled);
    assert.equal(b.status, 2, b.stderr);
    assert.match(b.stderr, /2 `<!-- BEGIN GENERATED: gen-ci-map actions -->` line\(s\)/);

    const empty = seed({ '.github/workflows/ci.yml': null, '.github/workflows/lane.yml': null, 'docs/ci/lane.md': null });
    const c = run('--check', empty);
    assert.equal(c.status, 2, c.stderr);
    assert.match(c.stderr, /holds no workflow/);

    const jobless = seed({ '.github/workflows/lane.yml': 'name: Nothing\non:\n  workflow_dispatch:\n' });
    const d = run('--check', jobless);
    assert.equal(d.status, 2, d.stderr);
    assert.match(d.stderr, /lane\.yml parses to no job/);

    const noPages = seed({ 'docs/ci/lane.md': null });
    const e = run('--check', noPages);
    assert.equal(e.status, 2, e.stderr);
    assert.match(e.stderr, /docs\/ci holds no lane page/);
  });

  test('M5 · limb (a): an `### above` anchor quoting a line its workflow does not have is a finding at the anchor', () => {
    const root = written();
    assert.equal(run('--check', root).status, 0, 'the control: every anchor resolves');
    edit(root, 'docs/ci/lane.md', '### above `run: make build`', '### above `run: make everything`');
    const r = run('--check', root);
    assert.equal(r.status, 1, r.stderr);
    const at = lineOf(root, 'docs/ci/lane.md', 'make everything');
    assert.ok(r.stderr.includes(`docs/ci/lane.md:${at} — anchor \`run: make everything\` is on no line of .github/workflows/lane.yml — re-quote it`), r.stderr);
    assert.match(r.stderr, /limb \(a\) anchors 1, limb \(b\) headings 0, limb \(c\) line citations 0/);
    edit(root, 'docs/ci/lane.md', '### above `run: make everything`', '### above `run: make bu…`');
    assert.equal(run('--check', root).status, 0, 'an anchor ending in … quotes the start of its line');
    edit(root, 'docs/ci/lane.md', '### above `run: make bu…`', '### above `run: make x…`');
    assert.equal(run('--check', root).status, 1, 'the start before the … must still be on a line');
  });

  test('M6 · limb (b): a `## job` heading that names a key inside a job is a finding; demoted to ###, it is not', () => {
    const root = written();
    edit(root, 'docs/ci/lane.md', '### above `fail-fast: false`', '## job `strategy`\n\n### above `fail-fast: false`');
    const r = run('--check', root);
    assert.equal(r.status, 1, r.stderr);
    const at = lineOf(root, 'docs/ci/lane.md', '## job `strategy`');
    assert.ok(r.stderr.includes(`docs/ci/lane.md:${at} — heading "## job \`strategy\`" names \`strategy\`, which is not a job of .github/workflows/lane.yml — demote it to ###`), r.stderr);
    edit(root, 'docs/ci/lane.md', '## job `strategy`', '### job `strategy`');
    assert.equal(run('--check', root).status, 0);
  });

  // ⏱ 2026-09-26 (CIMAP-4, option B): a caller's page may document the jobs of a
  // workflow it calls by a local `uses:`, read through workflow-scan's resolveLocalCalls.
  test('M6b · limbs (a)/(b) read the workflows a page\'s workflow calls; a page whose workflow calls nothing does not; an unresolved call is COVERAGE LOST', () => {
    const called = 'name: Called\non:\n  workflow_call:\njobs:\n  inner:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: make inner\n';
    const page = `${LANE_MD}\n## job \`inner\`\n\n### above \`run: make inner\`\n\nThe called job.\n`;
    const caller = `${LANE_YML}  ci:\n    uses: ./.github/workflows/called.yml\n`;
    const root = written({ '.github/workflows/lane.yml': caller, '.github/workflows/called.yml': called, 'docs/ci/lane.md': page });
    const green = run('--check', root);
    assert.equal(green.status, 0, `the caller's page documents its callee's job: ${green.stderr}`);

    const alone = written({ '.github/workflows/called.yml': called, 'docs/ci/lane.md': page });
    const r = run('--check', alone);
    assert.equal(r.status, 1, r.stderr);
    const at = lineOf(alone, 'docs/ci/lane.md', '## job `inner`');
    assert.ok(r.stderr.includes(`docs/ci/lane.md:${at} — heading "## job \`inner\`" names \`inner\`, which is not a job of .github/workflows/lane.yml — demote it to ###`), r.stderr);
    assert.match(r.stderr, /limb \(a\) anchors 1, limb \(b\) headings 1, limb \(c\) line citations 0/);

    const missing = seed({ '.github/workflows/lane.yml': caller, 'docs/ci/lane.md': page });
    const lost = run('--check', missing);
    assert.equal(lost.status, 2, lost.stderr);
    assert.match(lost.stderr, /^COVERAGE LOST — gen-ci-map: docs\/ci\/lane\.md: \.github\/workflows\/lane\.yml:\d+ \(job "ci"\) calls \.github\/workflows\/called\.yml, and that call does not resolve \(missing\)/m);
  });

  test('M7 · limb (c): a TRACKED file outside docs/ citing a doc line by number is a finding; docs/ and untracked files are not read', () => {
    const cite = ['docs/ci/lane.md', '7'].join(':');
    const root = written();
    writeFileSync(join(root, 'scratch.mjs'), `// see ${cite}\n`);
    writeFileSync(join(root, 'docs/notes.md'), `see ${cite}\n`);
    git(root, 'add', 'docs/notes.md');
    const control = run('--check', root);
    assert.equal(control.status, 0, `an untracked file and a page under docs/ are not the subject: ${control.stderr}`);
    edit(root, 'tooling/tool.mjs', 'by its section, never by a line', `at ${cite}`);
    const runbookCite = ['tooling/release/RELEASE-RUNBOOK.md', '3'].join(':');
    writeFileSync(join(root, 'tooling/other.json'), `{ "note": "${runbookCite}" }\n`);
    git(root, 'add', 'tooling/other.json');
    const r = run('--check', root);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes(`tooling/tool.mjs:1 — cites \`${cite}\` by line number`), r.stderr);
    assert.ok(r.stderr.includes('tooling/other.json:1 — cites `RELEASE-RUNBOOK.md'), r.stderr);
    assert.doesNotMatch(r.stderr, /scratch\.mjs/);
    assert.match(r.stderr, /limb \(c\) line citations 2/);
  });

  // ⏱ 2026-09-27 — CodeQL js/incomplete-sanitization (PR #993). A cell escaped its
  // pipes only, so a name carrying `\|` came out `\\|`: an escaped backslash, then
  // a pipe that ENDS the cell. GFM's own row rule is the oracle here: a backslash
  // escapes the character after it, and every other pipe is a cell break.
  test('M8 · a job name carrying `\\|` stays one cell: the backslash is escaped before the pipe', () => {
    const root = written({ '.github/workflows/ci.yml': CI_YML.replace('name: Lint the tree', 'name: Lint a\\|b C:\\tree') });
    const readme = readFileSync(join(root, 'docs/ci/README.md'), 'utf8');
    const row = readme.split('\n').find((l) => l.startsWith('| `lint` |'));
    assert.equal(row, '| `lint` | Lint a\\\\\\|b C:\\\\tree | — | — | yes |');
    const cells = row.slice(1, -1).match(/(?:\\[\s\S]|[^|\\])+/g).map((c) => c.trim());
    assert.equal(cells.length, 5, `the row splits into ${cells.length} cells: ${JSON.stringify(cells)}`);
    assert.equal(run('--check', root).status, 0);
  });
});
