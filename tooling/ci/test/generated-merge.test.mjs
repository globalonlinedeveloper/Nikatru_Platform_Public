// generated-merge.test.mjs — two PRs that each add or raise ONE entry of a
// generated file merge without a conflict (rv2-pipe-a P-2, 2026-09-29).
//
// MEASURED before this change, over the 30 merges to 93402826, each PR's own
// diff replayed onto main as it stood 6 merges earlier: tooling/chassis-ledger.json
// conflicted in 8 of them, every one on `totals.lines`;
// tooling/ci/test/coverage-manifest.json in 2 (#1050: neighbouring entries
// raised on each side; #1058: the SAME entry, with the test file itself also in
// conflict). enforcement-index.json, START-HERE.md and guard-yield.json: 0.
//
// Each case below builds a real git repository, commits a base, makes two
// branches the way a PR must write them to stay green, and asks git for the
// three-way merge — the same merge GitHub's update-branch performs. Each case
// runs its RED CONTROL first: the pre-P-2 shape of the same file, which must
// conflict, so a merge that "passes" because the setup cannot conflict is caught.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialiseManifest } from '../coverage-manifest-format.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MANIFEST = join(ROOT, 'tooling', 'ci', 'test', 'coverage-manifest.json');
const LEDGER = join(ROOT, 'tooling', 'chassis-ledger.json');
const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** A two-branch merge of one file. Returns { clean, merged }. */
function mergeOf(name, base, ours, theirs) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-merge-'));
  temps.push(dir);
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
    return r;
  };
  const commit = (text, msg) => {
    writeFileSync(join(dir, name), text);
    assert.equal(git('add', name).status, 0);
    assert.equal(git('commit', '-q', '-m', msg).status, 0);
  };
  assert.equal(git('init', '-q', '-b', 'base').status, 0);
  commit(base, 'base');
  assert.equal(git('checkout', '-q', '-b', 'a').status, 0);
  commit(ours, 'a');
  assert.equal(git('checkout', '-q', 'base').status, 0);
  assert.equal(git('checkout', '-q', '-b', 'b').status, 0);
  commit(theirs, 'b');
  const m = git('merge-tree', '--write-tree', 'a', 'b');
  assert.ok(m.status === 0 || m.status === 1, `git merge-tree could not run: ${m.stderr}`);
  const tree = m.stdout.split('\n')[0].trim();
  const merged = m.status === 0 ? git('show', `${tree}:${name}`).stdout : null;
  return { clean: m.status === 0, merged };
}

const oldManifest = (counts) => `${JSON.stringify(Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]])), null, 2)}\n`;

describe('coverage-manifest.json: entries are order-independent', () => {
  const real = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const keys = Object.keys(real).sort();

  test('the committed manifest is in the format its one writer produces', () => {
    assert.equal(readFileSync(MANIFEST, 'utf8').replaceAll('\r\n', '\n'), serialiseManifest(real));
  });

  test('#1050: two PRs raise NEIGHBOURING entries — the old format conflicts, the new one merges both', () => {
    // The neighbour is READ off the sorted keys, never named: a pinned pair broke the
    // day two test files (port-switch, ports) sorted into the gap between them.
    const i = Math.max(0, keys.indexOf('policy-claims.test.mjs'));
    const [k1, k2] = [keys[i], keys[i + 1]];
    assert.ok(k2, `the manifest must hold an entry after ${k1} for this case to mean anything`);
    const a = { ...real, [k1]: real[k1] + 4 };
    const b = { ...real, [k2]: real[k2] + 11 };
    assert.equal(mergeOf('m.json', oldManifest(real), oldManifest(a), oldManifest(b)).clean, false, 'red control: the pre-P-2 format must conflict here');
    const m = mergeOf('m.json', serialiseManifest(real), serialiseManifest(a), serialiseManifest(b));
    assert.equal(m.clean, true);
    assert.equal(m.merged, serialiseManifest({ ...real, [k1]: real[k1] + 4, [k2]: real[k2] + 11 }));
  });

  test('one PR ADDS a test file while another raises the entry it lands next to — the old format conflicts, the new one merges', () => {
    const i = keys.indexOf(keys.find((k) => k.startsWith('p')) ?? keys[1]);
    const added = `${keys[i].replace('.test.mjs', '')}.x.test.mjs`;
    assert.ok(added > keys[i] && added < keys[i + 1], `${added} must sort between ${keys[i]} and ${keys[i + 1]}`);
    const a = { ...real, [added]: 3 };
    const b = { ...real, [keys[i + 1]]: real[keys[i + 1]] + 2 };
    assert.equal(mergeOf('m.json', oldManifest(real), oldManifest(a), oldManifest(b)).clean, false, 'red control: the pre-P-2 format must conflict here');
    const m = mergeOf('m.json', serialiseManifest(real), serialiseManifest(a), serialiseManifest(b));
    assert.equal(m.clean, true);
    assert.equal(m.merged, serialiseManifest({ ...a, ...b }));
  });

  test('one PR ADDS a test file while another raises the entries on BOTH sides of it — the old format conflicts, the new one merges', () => {
    const i = keys.indexOf(keys.find((k) => k.startsWith('p')) ?? keys[1]);
    const added = `${keys[i].replace('.test.mjs', '')}.x.test.mjs`;
    const a = { ...real, [added]: 3 };
    const b = { ...real, [keys[i]]: real[keys[i]] + 1, [keys[i + 1]]: real[keys[i + 1]] + 2 };
    assert.equal(mergeOf('m.json', oldManifest(real), oldManifest(a), oldManifest(b)).clean, false, 'red control: the pre-P-2 format must conflict here');
    const m = mergeOf('m.json', serialiseManifest(real), serialiseManifest(a), serialiseManifest(b));
    assert.equal(m.clean, true);
    assert.equal(m.merged, serialiseManifest({ ...a, ...b }));
  });

  test('two PRs each ADD one test file into two different gaps merge cleanly (green control: both formats)', () => {
    const i = keys.indexOf(keys.find((k) => k.startsWith('p')) ?? keys[1]);
    const a = { ...real, [`${keys[i].replace('.test.mjs', '')}-a.test.mjs`]: 3 };
    const b = { ...real, [`${keys[i + 1].replace('.test.mjs', '')}-b.test.mjs`]: 5 };
    const m = mergeOf('m.json', serialiseManifest(real), serialiseManifest(a), serialiseManifest(b));
    assert.equal(m.clean, true);
    assert.equal(m.merged, serialiseManifest({ ...a, ...b }));
  });

  test('two PRs raising the SAME entry still conflict — the merged count is a re-measure, never a guess', () => {
    const k = keys[0];
    assert.equal(mergeOf('m.json', serialiseManifest(real), serialiseManifest({ ...real, [k]: real[k] + 1 }), serialiseManifest({ ...real, [k]: real[k] + 2 })).clean, false);
  });
});

describe('chassis-ledger.json: the totals are derived, so two brick PRs do not conflict', () => {
  const text = readFileSync(LEDGER, 'utf8').replaceAll('\r\n', '\n');
  const real = JSON.parse(text);
  const write = (j) => `${JSON.stringify(j, null, 2)}\n`;
  /** What a PR must commit to stay green when it changes one brick file by `d`
   *  lines: that file's row — and, while the ledger carried `totals`, the total. */
  const pr = (ledger, i, d) => {
    const j = structuredClone(ledger);
    j.files[i].lines += d;
    if (j.totals) j.totals.lines += d;
    return write(j);
  };

  test('the committed ledger carries no `totals` and serialises as it is written', () => {
    assert.equal(Object.hasOwn(real, 'totals'), false);
    assert.equal(write(real), text);
  });

  test('#1054/#1056: two PRs change two different brick files — with totals they conflict, without they merge', () => {
    const [i, j] = [0, real.files.length - 1];
    const withTotals = { ...real, totals: { files: real.files.length, lines: real.files.reduce((n, f) => n + f.lines, 0), unclassified: 0 } };
    // keep `totals` where it sat, after `roots`
    const ordered = Object.fromEntries(Object.entries(withTotals).flatMap(([k, v]) => (k === 'totals' ? [] : k === 'roots' ? [[k, v], ['totals', withTotals.totals]] : [[k, v]])));
    assert.equal(mergeOf('l.json', write(ordered), pr(ordered, i, 5), pr(ordered, j, 7)).clean, false, 'red control: a committed totals.lines must conflict here');
    const m = mergeOf('l.json', write(real), pr(real, i, 5), pr(real, j, 7));
    assert.equal(m.clean, true);
    const merged = JSON.parse(m.merged);
    assert.equal(merged.files[i].lines, real.files[i].lines + 5);
    assert.equal(merged.files[j].lines, real.files[j].lines + 7);
  });
});
