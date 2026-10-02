// new-channel.test.mjs — tooling/kit/new-channel.mjs scaffolds a store channel,
// and WRITES NOTHING without --write.
//
// ⏱ 2026-10-01 (port-channels, O-CHANNELS-HAVE-NO-SUBMIT-CONTRACT). Run over a
// temp tree holding copies of the REAL tooling/channel-register.json and
// tooling/ports/channels.json, so the row lands where the real register's
// channels array ends and the candidate it consumes is the real one.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, scaffold, REGISTER_REL, PORT_REL } from '../../kit/new-channel.mjs';
import { validate, declares } from '../assert-ports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const KIT = join(REPO, 'tooling/kit/new-channel.mjs');
const SCHEMA = JSON.parse(readFileSync(join(REPO, 'tooling/ports/port.schema.json'), 'utf8'));

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'new-channel-'));
  for (const rel of [REGISTER_REL, PORT_REL]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  return root;
}
const snapshot = (root) => ({
  register: readFileSync(join(root, REGISTER_REL), 'utf8'),
  port: readFileSync(join(root, PORT_REL), 'utf8'),
  release: existsSync(join(root, 'tooling/release')) ? readdirSync(join(root, 'tooling/release')) : [],
});
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [KIT, ...args, '--root', root], { encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

describe('new-channel — the dry run prints and writes nothing', () => {
  it('🔴 a dry run on the candidate prints the row, the adapter, the skeleton and the owner steps — and every byte is unchanged', () => {
    const root = tree();
    const before = snapshot(root);
    for (const args of [['--id', 'indus-appstore', '--dry-run'], ['--id', 'indus-appstore']]) {
      const r = run(root, ...args);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /DRY RUN \(nothing is written; pass --write\)/);
      assert.match(r.out, /"id": "indus-appstore"[\s\S]*"kind": "store"[\s\S]*"submittable": false/);
      assert.match(r.out, /export const indusAppstoreSubmitter = storeSubmitter\(/);
      assert.match(r.out, /OWNER STEPS \(printed, never performed\)[\s\S]*open an Indus Appstore developer account/);
      assert.match(r.out, /DRY RUN — nothing was written/);
      assert.deepEqual(snapshot(root), before, `${args.join(' ')} wrote to the tree`);
    }
  });

  it('--write scaffolds all three, moves the candidate into the adapters, and refuses a second run', () => {
    const root = tree();
    const r = run(root, '--id', 'indus-appstore', '--write');
    assert.equal(r.code, 0, r.err);
    const register = JSON.parse(readFileSync(join(root, REGISTER_REL), 'utf8'));
    assert.equal(register.channels.at(-1).id, 'indus-appstore');
    assert.equal(register.channels.at(-1).submittable, false);
    const port = JSON.parse(readFileSync(join(root, PORT_REL), 'utf8'));
    assert.deepEqual(port.candidates, []);
    const adapter = port.adapters.find((a) => a.id === 'indus-appstore');
    assert.equal(adapter.status, 'draft');
    assert.deepEqual(validate(port, SCHEMA, SCHEMA), [], 'the port registry still validates against port.schema.json');
    const skeleton = readFileSync(join(root, adapter.impl.file), 'utf8');
    assert.ok(declares(skeleton, adapter.impl.symbol, '.mjs'), 'the skeleton declares the symbol the adapter names');
    assert.equal(spawnSync(process.execPath, ['--check', join(root, adapter.impl.file)]).status, 0, 'the skeleton parses');
    // a second run: the row exists now
    const again = run(root, '--id', 'indus-appstore', '--write');
    assert.equal(again.code, 1);
    assert.match(again.err, /already a tooling\/channel-register\.json row/);
  });

  it('an existing channel is refused, exit 1, and nothing is written', () => {
    const root = tree();
    const before = snapshot(root);
    const r = run(root, '--id', 'android-play', '--write');
    assert.equal(r.code, 1);
    assert.match(r.err, /android-play is already a tooling\/channel-register\.json row/);
    assert.deepEqual(snapshot(root), before);
  });

  it('a missing register is COVERAGE LOST, exit 2', () => {
    const root = mkdtempSync(join(tmpdir(), 'new-channel-empty-'));
    const r = run(root, '--id', 'indus-appstore');
    assert.equal(r.code, 2);
    assert.match(r.err, /COVERAGE LOST/);
  });
});

describe('new-channel — the flags are two declared sets (TRAPS shell-13)', () => {
  it('a switch never eats the next argument, in either order', () => {
    assert.deepEqual(parseArgs(['--dry-run', '--id', 'x']).errors, []);
    assert.equal(parseArgs(['--dry-run', '--id', 'x']).opts.id, 'x');
    assert.equal(parseArgs(['--id', 'x', '--dry-run']).opts.id, 'x');
    assert.ok(parseArgs(['--id', 'x', '--write']).opts.switches.has('--write'));
  });
  it('🔴 a valued flag refuses a flag as its value', () => {
    const { errors } = parseArgs(['--id', '--write']);
    assert.match(errors.join('\n'), /--id needs a value, and the next argument is the flag --write/);
  });
  it('🔴 --dry-run with --write, an unknown flag, and a bad id are refused', () => {
    assert.match(parseArgs(['--id', 'x', '--dry-run', '--write']).errors.join('\n'), /pick one/);
    assert.match(parseArgs(['--id', 'x', '--submit']).errors.join('\n'), /unknown argument "--submit"/);
    assert.match(parseArgs(['--id', 'Indus Appstore']).errors.join('\n'), /is not a channel id/);
    assert.match(parseArgs(['--id', 'x', '--surface', 'tv']).errors.join('\n'), /--surface must be app or extension/);
  });
  it('the scaffold for an extension channel is a publisher under extensions/scripts', () => {
    const s = scaffold({ id: 'opera-addons', surface: 'extension', candidate: null });
    assert.equal(s.script, 'extensions/scripts/publish-opera-addons.mjs');
    assert.equal(s.row.storeMetadataDir, 'extensions/Extension/{tool}/store/opera-addons');
    assert.match(s.submitter, /from '\.\.\/\.\.\/tooling\/release\/submit-common\.mjs'/);
  });
});
