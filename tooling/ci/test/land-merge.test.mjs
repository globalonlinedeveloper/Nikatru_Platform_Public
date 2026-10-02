// ─────────────────────────────────────────────────────────────────────────────
// land-merge.test.mjs — tooling/ops/land-merge.mjs squashes with the PR's body,
// read at the head it merges, so the `Rows:` line reaches main's history.
//
// Row: O-SQUASH-DROPS-THE-ROWS-LINE (SYN-C1).
//
//   L1  the composed command carries --squash, --match-head-commit <head>,
//       --subject "<title> (#n)" and --body-file, and the body file holds the
//       `Rows:` line (RED CONTROL: a command without --body-file fails the check)
//   L2  the line is rewritten bare, the one form main's reader reads; the rest
//       of the body is kept
//   L3  a body with no valid line (missing, singular, the template placeholder)
//       is REFUSED before any merge, exit 1, and gh is never called
//   L4  not a verdict, exit 2: a head that moved, a closed PR, a read of another
//       PR, an unreadable PR, a bad repo slug; gh failing is exit 1
//   L5  the CLI: --dry-run --view-file prints the command and keeps the body
//   L6  no `gh pr merge --squash` in tooling/ops runs without --body-file
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { land, mergeArgs, squashBody, squashSubject } from '../../ops/land-merge.mjs';
import { ROWS_LINE } from '../assert-main-rows.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = join(REPO, 'tooling', 'ops', 'land-merge.mjs');
const OPS = join(REPO, 'tooling', 'ops');

const HEAD = 'a1b2c3d4'.repeat(5);
const BODY = [
  '## What was wrong',
  '',
  'The squash dropped the body.',
  '',
  '- **Rows:** O-SQUASH-DROPS-THE-ROWS-LINE, O-PR-ROWS-NAME-NONEXISTENT-ROWS',
  '- **Deploys:** none',
  '',
  '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
].join('\n');
const doc = (over = {}) => ({ number: 1090, title: 'The Rows: line survives every squash', body: BODY, headRefOid: HEAD, state: 'OPEN', ...over });

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-land-merge-test-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** land() with a recorded read and a gh that records what it was asked, and the body file as it stood then. */
function landWith(over = {}, { exitStatus = 0, ...opts } = {}) {
  const calls = [];
  const exec = (args) => {
    const at = args.indexOf('--body-file');
    calls.push({ args, body: at === -1 ? null : readFileSync(args[at + 1], 'utf8') });
    return { status: exitStatus, out: exitStatus === 0 ? '' : 'GraphQL: Head branch was modified' };
  };
  const r = land({ number: 1090, repo: 'owner/name', view: () => doc(over), exec, tmp: TMP, ...opts });
  return { r, calls };
}

/** The check the brief names: the composed command carries --body-file and that file holds a `Rows:` line. */
function carriesBody(args, bodyText) {
  const at = args.indexOf('--body-file');
  return at !== -1 && typeof args[at + 1] === 'string' && ROWS_LINE.test(bodyText ?? '');
}

// ── L1 ───────────────────────────────────────────────────────────────────────
describe('L1 — the composed command', () => {
  test('green control: --body-file is passed and the file holds the Rows line', () => {
    const { r, calls } = landWith();
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(calls.length, 1);
    const { args, body } = calls[0];
    assert.ok(carriesBody(args, body), JSON.stringify(args));
    assert.deepEqual(args.slice(0, 6), ['pr', 'merge', '1090', '--repo', 'owner/name', '--squash']);
    assert.equal(args[args.indexOf('--match-head-commit') + 1], HEAD);
    assert.equal(args[args.indexOf('--subject') + 1], 'The Rows: line survives every squash (#1090)');
    assert.match(r.lines[0], /^MERGED #1090 at a1b2c3d4, Rows: O-SQUASH-DROPS-THE-ROWS-LINE, O-PR-ROWS-NAME-NONEXISTENT-ROWS$/);
  });

  test('RED CONTROL: the same command with --body-file dropped fails the check', () => {
    const { calls } = landWith();
    const { args, body } = calls[0];
    const at = args.indexOf('--body-file');
    const dropped = [...args.slice(0, at), ...args.slice(at + 2)];
    assert.equal(carriesBody(dropped, body), false);
  });

  test('the body file is removed after the merge', () => {
    const { calls } = landWith();
    const file = calls[0].args[calls[0].args.indexOf('--body-file') + 1];
    assert.equal(existsSync(file), false);
  });

  test('mergeArgs keeps the title as ONE argument, whatever it holds', () => {
    const args = mergeArgs({ number: 3, repo: 'o/n', headRefOid: HEAD, subject: 'a "quoted" $(title) (#3)', bodyFile: '/x' });
    assert.equal(args[args.indexOf('--subject') + 1], 'a "quoted" $(title) (#3)');
  });

  test('squashSubject appends (#n) once', () => {
    assert.equal(squashSubject('Fix it', 4), 'Fix it (#4)');
    assert.equal(squashSubject('Fix it (#4)', 4), 'Fix it (#4)');
  });
});

// ── L2 ───────────────────────────────────────────────────────────────────────
describe('L2 — the line reaches main in the form main reads', () => {
  test('a bulleted bold line is rewritten bare; the rest of the body is kept', () => {
    const b = squashBody(BODY);
    assert.equal(b.ok, true);
    assert.ok(ROWS_LINE.test(BODY) === false, 'fixture: the raw body has no bare line');
    assert.match(b.text, /^Rows: O-SQUASH-DROPS-THE-ROWS-LINE, O-PR-ROWS-NAME-NONEXISTENT-ROWS$/m);
    assert.match(b.text, /^- \*\*Deploys:\*\* none$/m);
    assert.match(b.text, /^## What was wrong$/m);
    assert.doesNotMatch(b.text, /\*\*Rows:\*\*/);
  });

  test('`none` keeps its reason; CRLF bodies come out LF', () => {
    const b = squashBody('intro\r\nRows: none - a typo in a README\r\n');
    assert.equal(b.ok, true);
    assert.equal(b.text, 'intro\nRows: none — a typo in a README\n');
  });
});

// ── L3 ───────────────────────────────────────────────────────────────────────
describe('L3 — a body main could not read is refused before the merge', () => {
  test('missing, singular, the template placeholder and a null body: each exit 1, gh never called', () => {
    const cases = [
      ['missing', 'no line at all', /no `Rows:` line/],
      ['singular', 'Row: O-A', /singular `Row:`/],
      ['the template placeholder', 'Rows: <row id, … | none — why>', /malformed/],
      ['null', null, /no `Rows:` line/],
    ];
    for (const [name, body, why] of cases) {
      const { r, calls } = landWith({ body });
      assert.equal(r.code, 1, `${name}: ${r.lines.join('\n')}`);
      assert.match(r.lines[0], /^REFUSED #1090 would squash without a Rows: line main can read/, name);
      assert.match(r.lines[0], why, name);
      assert.equal(calls.length, 0, name);
    }
  });
});

// ── L4 ───────────────────────────────────────────────────────────────────────
describe('L4 — not a verdict is exit 2; gh failing is exit 1', () => {
  test('green control: --head equal to the read head merges', () => {
    assert.equal(landWith({}, { head: HEAD }).r.code, 0);
  });

  test('a head that moved since the gate was read: exit 2, nothing merged', () => {
    const { r, calls } = landWith({ headRefOid: 'f'.repeat(40) }, { head: HEAD });
    assert.equal(r.code, 2);
    assert.match(r.lines[0], /it moved/);
    assert.equal(calls.length, 0);
  });

  test('a closed PR, another PR\'s read, an unreadable read and a bad slug are exit 2', () => {
    assert.equal(landWith({ state: 'MERGED' }).r.code, 2);
    assert.equal(landWith({ number: 1091 }).r.code, 2);
    assert.equal(land({ number: 1090, repo: 'o/n', view: () => { throw new Error('HTTP 404'); }, exec: () => assert.fail('no merge') }).code, 2);
    assert.equal(land({ number: 1090, repo: 'not a slug', view: () => doc(), exec: () => assert.fail('no merge') }).code, 2);
    assert.equal(land({ number: 0, repo: 'o/n', view: () => doc(), exec: () => assert.fail('no merge') }).code, 2);
  });

  test('gh pr merge failing is exit 1 with its output', () => {
    const { r } = landWith({}, { exitStatus: 1 });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /FAILED gh pr merge #1090 exited 1[\s\S]*Head branch was modified/);
  });
});

// ── L5 ───────────────────────────────────────────────────────────────────────
describe('L5 — the CLI', () => {
  test('--dry-run --view-file prints the command and keeps a body file holding the line', () => {
    const view = join(TMP, 'view.json');
    writeFileSync(view, JSON.stringify(doc()));
    const r = spawnSync(process.execPath, [CLI, '1090', '--repo', 'owner/name', '--dry-run', '--view-file', view], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [first, cmd, bodyLine] = r.stdout.trim().split('\n');
    assert.match(first, /^COMPOSED #1090 at a1b2c3d4/);
    assert.match(cmd, /^gh pr merge 1090 --repo owner\/name --squash --match-head-commit a1b2c3d4\S+ --subject "The Rows: line survives every squash \(#1090\)" --body-file \S+/);
    const file = bodyLine.replace(/^body /, '');
    assert.match(readFileSync(file, 'utf8'), /^Rows: O-SQUASH-DROPS-THE-ROWS-LINE/m);
    rmSync(dirname(file), { recursive: true, force: true });
  });

  test('a body with no line exits 1 through the CLI too', () => {
    const view = join(TMP, 'view-bad.json');
    writeFileSync(view, JSON.stringify(doc({ body: 'nothing' })));
    const r = spawnSync(process.execPath, [CLI, '1090', '--repo', 'owner/name', '--dry-run', '--view-file', view], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
  });

  test('no PR number, or an unknown flag, exits 2', () => {
    assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, '1090', '--merge-it'], { encoding: 'utf8' }).status, 2);
  });
});

// ── L6 ───────────────────────────────────────────────────────────────────────
describe('L6 — every squash merge in tooling/ops passes the body', () => {
  test('each `pr merge … --squash` in a tooling/ops script also names --body-file and --subject', () => {
    const files = readdirSync(OPS).filter((f) => /\.(mjs|sh)$/.test(f));
    assert.ok(files.includes('land-merge.mjs') && files.length > 20, `read ${files.length} file(s) of tooling/ops`);
    let merges = 0;
    for (const f of files) {
      const src = readFileSync(join(OPS, f), 'utf8');
      if (/'merge',[^\n]*'--squash'/.test(src) || /gh pr merge[^\n]*--squash/.test(src)) {
        merges++;
        assert.match(src, /'--body-file'|--body-file/, `${f} squashes without --body-file`);
        assert.match(src, /'--subject'|--subject/, `${f} squashes without --subject`);
      }
    }
    assert.ok(merges >= 1, 'no squash merge found in tooling/ops: the scan would pass over nothing');
  });
});
