// ─────────────────────────────────────────────────────────────────────────────
// store-bytes-record.test.mjs — the bytes a store receives, and the symbols that
// decode them, are recorded durably (O-STORE-SUBMISSION-RECORD-HAS-NO-DIGEST (absent from open.json until the next Private pass records it),
// O-STORE-BUILD-SYMBOLS-EXPIRE-AT-90-DAYS (absent from open.json until the next Private pass records it); review AA-07, AA-12, AA-21).
//
// Two writers, one record:
//   · record-deployment.mjs `--artifact <file> --build-number <n>` hashes the file
//     ITSELF into `payload.artifact`, and `--symbols-record` carries the copy's
//     record into `payload.symbols`;
//   · r2-durable-copy.mjs packs a symbols directory, puts it under the key the
//     register's `releaseStore.symbolsKey` composes, and READS IT BACK.
// The R2 transport is the AWS CLI; these cases drive the real script against a
// fake CLI that keeps objects in a temporary directory, so no case reaches a
// network or holds a credential. Each refusal case is the green case with one
// thing broken.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { artifactRecord, symbolsRecord } from '../record-deployment.mjs';
import { readStore, symbolsKey, pendingOpen, r2Endpoint, packDeterministic } from '../r2-durable-copy.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COPY = join(CI_DIR, 'r2-durable-copy.mjs');
const RECORDER = join(CI_DIR, 'record-deployment.mjs');
const REGISTER = JSON.parse(readFileSync(join(CI_DIR, '..', 'channel-register.json'), 'utf8'));

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-bytes-'));
});
after(() => rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
const dir = () => {
  const d = join(TMP, `d${seq++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

/** A fake `aws s3api` that keeps each object as <store>/<key> plus <key>.sha256. */
function fakeAws() {
  const store = dir();
  const cli = join(dir(), 'aws.cjs');
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
fs.appendFileSync(${JSON.stringify(join(store, 'calls.log'))}, process.argv[3] + '\\n');
const a = process.argv.slice(2); const v = (k) => a[a.indexOf(k) + 1];
const at = path.join(${JSON.stringify(store)}, v('--key'));
if (a[1] === 'head-object') {
  if (!fs.existsSync(at)) { process.stderr.write('An error occurred (404) when calling the HeadObject operation: Not Found'); process.exit(254); }
  const sha = fs.readFileSync(at + '.sha256', 'utf8');
  process.stdout.write(JSON.stringify({ ContentLength: fs.statSync(at).size, Metadata: { sha256: sha } }));
} else if (a[1] === 'put-object') {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.copyFileSync(v('--body'), at);
  fs.writeFileSync(at + '.sha256', v('--metadata').replace(/^sha256=/, ''));
  process.stdout.write('{}');
} else { process.exit(9); }
`,
  );
  chmodSync(cli, 0o755);
  return { cli, store };
}

const CREDS = { CLOUDFLARE_ACCOUNT_ID: 'acct', R2_RELEASE_ACCESS_KEY_ID: 'id', R2_RELEASE_SECRET_ACCESS_KEY: 'secret' };
const UNSET = { CLOUDFLARE_ACCOUNT_ID: '', R2_RELEASE_ACCESS_KEY_ID: '', R2_RELEASE_SECRET_ACCESS_KEY: '' };

function copy({ symbols, env = {}, cli = null, build = '7' }) {
  const out = join(dir(), 'record.json');
  const args = [COPY, '--kind', 'symbols', '--app', 'subscriptiontracker', '--channel', 'android-play', '--version', '1.0.7', '--build', build, '--dir', symbols, '--out', out];
  if (cli) args.push('--aws-cli', cli);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', ...env } });
  let record = null;
  try {
    record = JSON.parse(readFileSync(out, 'utf8'));
  } catch {}
  return { code: r.status, out: `${r.stdout}${r.stderr}`, record };
}

function symbolsDir() {
  const d = dir();
  mkdirSync(join(d, 'nested'));
  writeFileSync(join(d, 'app.android-arm64.symbols'), 'mapping bytes');
  writeFileSync(join(d, 'nested', 'x.symbols'), 'more');
  return d;
}

describe('the register declares the release store the copy writes to', () => {
  test('releaseStore is complete in the real register, and its key template composes a key', () => {
    const { store, refusal } = readStore(REGISTER);
    assert.equal(refusal, undefined, refusal);
    assert.equal(store.visibility, 'private');
    assert.deepEqual(symbolsKey(store.symbolsKey, { app: 'a', channel: 'android-play', version: '1.0.7', build: '7' }), { key: 'symbols/a/android-play/1.0.7+7/symbols.tar.gz' });
  });

  test('every credential name releaseStore gives is declared in ciSecretRegister', () => {
    const declared = new Set(REGISTER.ciSecretRegister.nonSigning.map((e) => e.name));
    for (const n of Object.values(REGISTER.releaseStore.credentials)) assert.ok(declared.has(n), n);
  });

  test('a key segment that is not one path segment is refused, and so is a build that is not a number', () => {
    assert.match(symbolsKey('symbols/{app}/{channel}/{version}+{build}/', { app: '../x', channel: 'c', version: '1', build: '1' }).refusal, /--app/);
    assert.match(symbolsKey('symbols/{app}/{channel}/{version}+{build}/', { app: 'a', channel: 'c', version: '1', build: 'x' }).refusal, /--build/);
    assert.match(readStore({}).refusal, /no `releaseStore`/);
  });

  test('the pending window is inclusive of its date, and the endpoint is composed from the account id', () => {
    assert.equal(pendingOpen('2026-11-30', '2026-11-30'), true);
    assert.equal(pendingOpen('2026-12-01', '2026-11-30'), false);
    assert.equal(r2Endpoint('abc'), 'https://abc.r2.cloudflarestorage.com');
  });
});

describe('r2-durable-copy.mjs — the symbols are stored and read back, or the job says why not', () => {
  test('GREEN — stored under the composed key, read back, and the record carries the tarball sha256', () => {
    const { cli, store } = fakeAws();
    const r = copy({ symbols: symbolsDir(), env: CREDS, cli });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.record.stored, true);
    assert.equal(r.record.r2Key, 'symbols/subscriptiontracker/android-play/1.0.7+7/symbols.tar.gz');
    const stored = readFileSync(join(store, r.record.r2Key));
    assert.equal(createHash('sha256').update(stored).digest('hex'), r.record.sha256);
    assert.equal(stored.length, r.record.size);
    assert.match(r.out, /holds \d+ bytes, sha256 [0-9a-f]{64} \(read back\)/);
  });

  test('a key already holding ANOTHER build is refused, and nothing is overwritten', () => {
    const { cli, store } = fakeAws();
    const first = copy({ symbols: symbolsDir(), env: CREDS, cli });
    assert.equal(first.code, 0, first.out);
    const other = symbolsDir();
    writeFileSync(join(other, 'app.android-arm64.symbols'), 'a different build');
    const r = copy({ symbols: other, env: CREDS, cli });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /already holds sha256 [0-9a-f]{64}, not [0-9a-f]{64}: another build under the same version and build number/);
    assert.equal(readFileSync(join(store, `${first.record.r2Key}.sha256`), 'utf8'), first.record.sha256);
  });

  test('a read-back that disagrees with the bytes hashed is refused', () => {
    const lying = join(dir(), 'aws.cjs');
    writeFileSync(lying, `#!/usr/bin/env node\nconst a=process.argv.slice(2);\nif(a[1]==='head-object'){if(!require('fs').existsSync(${JSON.stringify(join(TMP, 'put-done'))})){process.stderr.write('Not Found');process.exit(254);}process.stdout.write(JSON.stringify({ContentLength:1,Metadata:{sha256:'0'.repeat(64)}}));}\nelse{require('fs').writeFileSync(${JSON.stringify(join(TMP, 'put-done'))},'');process.stdout.write('{}');}\n`);
    chmodSync(lying, 0o755);
    const r = copy({ symbols: symbolsDir(), env: CREDS, cli: lying });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the read-back of r2:\/\/nikatru-release-store\/symbols\/.+ is \{"size":1,/);
  });

  test('PENDING — no credential before the date warns, records stored: false, and still exits 0', () => {
    const r = copy({ symbols: symbolsDir(), env: { ...UNSET, CHANNEL_REGISTER_TODAY: '2026-10-01' } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /::warning title=Symbols not yet durable::CLOUDFLARE_ACCOUNT_ID, R2_RELEASE_ACCESS_KEY_ID, R2_RELEASE_SECRET_ACCESS_KEY unset/);
    assert.equal(r.record.stored, false);
    assert.match(r.record.sha256, /^[0-9a-f]{64}$/);
  });

  test('PAST THE DATE — the same missing credential is exit 1, and no record is written', () => {
    const r = copy({ symbols: symbolsDir(), env: { ...UNSET, CHANNEL_REGISTER_TODAY: '2026-12-01' } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /releaseStore\.pendingUntil \(2026-11-30\) has passed \(today 2026-12-01\)/);
    assert.equal(r.record, null);
  });

  // ⏱ 2026-10-03 (review of #1187, finding 1): a re-run re-downloads the symbols, so every file time
  // is new. The archive must not record them, or the kept branch below could never fire.
  test('REPRODUCIBLE — the same files with new times and another creation order pack to the same sha256', () => {
    const a = symbolsDir();
    const b = dir();
    writeFileSync(join(b, 'z-last-created-first.symbols'), 'z');
    mkdirSync(join(b, 'nested'));
    writeFileSync(join(b, 'nested', 'x.symbols'), 'more');
    writeFileSync(join(b, 'app.android-arm64.symbols'), 'mapping bytes');
    writeFileSync(join(a, 'z-last-created-first.symbols'), 'z');
    utimesSync(join(b, 'nested', 'x.symbols'), new Date('2001-01-01'), new Date('2001-01-01'));
    utimesSync(join(a, 'app.android-arm64.symbols'), new Date('2030-06-01'), new Date('2030-06-01'));
    const pending = { ...UNSET, CHANNEL_REGISTER_TODAY: '2026-10-01' };
    const ra = copy({ symbols: a, env: pending });
    const rb = copy({ symbols: b, env: pending });
    assert.equal(ra.code, 0, ra.out);
    assert.equal(rb.code, 0, rb.out);
    assert.equal(ra.record.sha256, rb.record.sha256, 'the archive recorded something other than paths and bytes');
  });

  test('REPRODUCIBLE, pure — packDeterministic ignores input order and changes with one byte', () => {
    const files = [{ rel: 'b/x', bytes: Buffer.from('1') }, { rel: 'a', bytes: Buffer.from('2') }];
    const sha = (r) => createHash('sha256').update(r.bytes).digest('hex');
    assert.equal(sha(packDeterministic(files)), sha(packDeterministic([...files].reverse())));
    assert.notEqual(sha(packDeterministic(files)), sha(packDeterministic([files[0], { rel: 'a', bytes: Buffer.from('3') }])));
    assert.match(packDeterministic([{ rel: 'x'.repeat(120), bytes: Buffer.from('') }]).refusal, /too long for a ustar entry/);
  });

  test('the archive is a real .tar.gz: the system tar lists every member', () => {
    const work = dir();
    const { bytes } = packDeterministic([{ rel: 'nested/x.symbols', bytes: Buffer.from('more') }, { rel: 'app.symbols', bytes: Buffer.from('m') }]);
    writeFileSync(join(work, 'a.tar.gz'), bytes);
    const r = spawnSync('tar', ['-tzf', 'a.tar.gz'], { cwd: work, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.deepEqual(r.stdout.split(/\r?\n/).filter(Boolean), ['app.symbols', 'nested/x.symbols']);
  });

  test('IDEMPOTENT — a re-run of the same build against the object it stored is kept, exit 0, and puts nothing', () => {
    const { cli, store } = fakeAws();
    const symbols = symbolsDir();
    const first = copy({ symbols, env: CREDS, cli });
    assert.equal(first.code, 0, first.out);
    for (const f of ['app.android-arm64.symbols', join('nested', 'x.symbols')]) utimesSync(join(symbols, f), new Date(), new Date('2031-01-01'));
    const again = copy({ symbols, env: CREDS, cli });
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /already holds these bytes \(a re-run of this build\); kept/);
    assert.equal(again.record.sha256, first.record.sha256);
    assert.equal(readFileSync(join(store, 'calls.log'), 'utf8').split('\n').filter((c) => c === 'put-object').length, 1, 'the re-run wrote the object again');
  });

  test('an empty symbols directory is refused: a checksum over nothing is not a mapping', () => {
    const r = copy({ symbols: dir(), env: CREDS, cli: fakeAws().cli });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /holds no file/);
  });
});

describe('record-deployment.mjs — a store record names the bytes the store received', () => {
  test('--artifact is hashed HERE: name, sha256, size and the build number', () => {
    const f = join(dir(), 'app-release.aab');
    writeFileSync(f, 'aab bytes');
    assert.deepEqual(artifactRecord(f, '41'), {
      artifact: { name: 'app-release.aab', sha256: createHash('sha256').update('aab bytes').digest('hex'), size: 9, buildNumber: 41 },
    });
    assert.deepEqual(artifactRecord(null, null), { artifact: null });
  });

  test('--artifact without --build-number, a missing file, an empty one and a bad number are each refused', () => {
    const f = join(dir(), 'x.msix');
    writeFileSync(f, 'm');
    assert.match(artifactRecord(f, null).refusal, /--artifact was given without --build-number/);
    assert.match(artifactRecord(null, '3').refusal, /--build-number was given without --artifact/);
    assert.match(artifactRecord(join(TMP, 'nope.aab'), '3').refusal, /cannot be read/);
    const empty = join(dir(), 'e.snap');
    writeFileSync(empty, '');
    assert.match(artifactRecord(empty, '3').refusal, /is empty/);
    assert.match(artifactRecord(f, '0').refusal, /not a whole number of 1 or more/);
  });

  test('--symbols-record takes the copy\'s record, and refuses one missing a field', () => {
    const good = join(dir(), 'r.json');
    writeFileSync(good, JSON.stringify({ kind: 'symbols', r2Key: 'symbols/a/b/1+1/symbols.tar.gz', sha256: 'a'.repeat(64), size: 3, stored: false }));
    assert.deepEqual(symbolsRecord(good), { symbols: { r2Key: 'symbols/a/b/1+1/symbols.tar.gz', sha256: 'a'.repeat(64), size: 3, stored: false } });
    const bad = join(dir(), 'r.json');
    writeFileSync(bad, JSON.stringify({ r2Key: 'x', sha256: 'short', size: 0 }));
    assert.match(symbolsRecord(bad).refusal, /lacks a valid r2Key, sha256, size, stored/);
  });

  test('the CLI refuses --artifact on a unit that is not a store, before anything is written', () => {
    const f = join(dir(), 'bundle.zip');
    writeFileSync(f, 'z');
    const r = spawnSync(process.execPath, [RECORDER, 'subscriptiontracker-web', 'https://x', '--artifact', f, '--build-number', '3'], {
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'a'.repeat(40), GITHUB_API_URL: 'http://127.0.0.1:9' },
    });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--artifact was given for "subscriptiontracker-web", a unit of kind "web"/);
  });
});

// ⏱ AA-21 — the size a store receives is held to the store's stated limit before the upload.
describe('assert-artifact-size.mjs — 80% of the store limit fails, 2× the median warns', () => {
  const SIZE = join(CI_DIR, 'assert-artifact-size.mjs');
  const sized = (n) => {
    const f = join(dir(), 'a.bin');
    writeFileSync(f, Buffer.alloc(n));
    return f;
  };
  const cli = (...a) => {
    const r = spawnSync(process.execPath, [SIZE, ...a], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  test('the verdict: under 80% passes, at 80% fails, and a growth past 2× the median warns', async () => {
    const { sizeVerdict, median, recordedSizes } = await import('../assert-artifact-size.mjs');
    assert.deepEqual(sizeVerdict({ size: 79, limitBytes: 100, history: [] }), { ceiling: 80, median: null, fail: false, warn: false });
    assert.equal(sizeVerdict({ size: 80, limitBytes: 100, history: [] }).fail, true);
    assert.equal(sizeVerdict({ size: 21, limitBytes: null, history: [10, 9, 11] }).warn, true);
    assert.equal(sizeVerdict({ size: 20, limitBytes: null, history: [10, 9, 11] }).warn, false);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.deepEqual(recordedSizes([{ payload: { artifact: { size: 5 } } }, { payload: {} }, null]), [5]);
  });

  test('every submit lane\'s row declares storeSizeLimit — a number with its source, or null with why', () => {
    for (const id of ['android-play', 'windows-store', 'linux-snap']) {
      const row = REGISTER.channels.find((c) => c.id === id);
      assert.ok(Object.hasOwn(row, 'storeSizeLimit'), id);
      if (row.storeSizeLimit === null) assert.ok(String(row._storeSizeLimitWhy ?? '').length >= 20, id);
      else assert.match(row.storeSizeLimit.source, /^https:\/\//, id);
    }
  });

  test('the CLI: a small .aab passes, one at 80% of Play\'s limit fails, a row with no key is COVERAGE LOST', () => {
    const ok = cli('--app', 'subscriptiontracker', '--channel', 'android-play', sized(1000));
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /no baseline: GH_TOKEN or GITHUB_REPOSITORY is unset/);
    const limit = REGISTER.channels.find((c) => c.id === 'android-play').storeSizeLimit.bytes;
    const big = join(dir(), 'big.aab');
    writeFileSync(big, '');
    // a sparse file: the size is what is measured, so no bytes need writing
    spawnSync('truncate', ['-s', String(Math.ceil(limit * 0.8)), big]);
    const red = cli('--app', 'subscriptiontracker', '--channel', 'android-play', big);
    assert.equal(red.code, 1, red.out);
    assert.match(red.out, /at or over 80% of the store limit/);
    const lost = cli('--app', 'subscriptiontracker', '--channel', 'web', sized(10));
    assert.equal(lost.code, 2, lost.out);
  });
});

// ⏱ AA-27 — RELEASE-RUNBOOK.md §3 is generated from release-manifest.mjs over the register.
describe('gen-release-carries.mjs — the runbook says what the code decides', () => {
  const GEN = join(CI_DIR, 'gen-release-carries.mjs');
  const fixtureRoot = (runbook) => {
    const root = dir();
    mkdirSync(join(root, 'tooling', 'release'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify(REGISTER));
    writeFileSync(join(root, 'tooling', 'release', 'RELEASE-RUNBOOK.md'), runbook);
    return root;
  };
  const gen = (...a) => {
    const r = spawnSync(process.execPath, [GEN, ...a], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const EMPTY = '# x\n<!-- BEGIN GENERATED: gen-release-carries carries -->\n<!-- END GENERATED: gen-release-carries carries -->\n';

  test('the real runbook matches (the CI step), and a carried row answers yes while a submittable store answers no', async () => {
    const r = gen('--check');
    assert.equal(r.code, 0, r.out);
    // the block is LINES of markdown in the real runbook, not a self-consistent splice of characters
    const runbook = readFileSync(join(CI_DIR, '..', 'release', 'RELEASE-RUNBOOK.md'), 'utf8');
    assert.match(runbook, /^<!-- why: GENERATED by node tooling\/ci\/gen-release-carries\.mjs --write\. Never hand-edit\. -->$/m);
    assert.match(runbook, /^\| `linux-appimage` \| direct \| `\.AppImage` \| \*\*yes\*\* \|/m);
    const { carriesBlock } = await import('../gen-release-carries.mjs');
    const text = carriesBlock(REGISTER).join('\n');
    assert.match(text, /\| `linux-appimage` \| direct \| `\.AppImage` \| \*\*yes\*\* \|/);
    assert.match(text, /\| `macos-appstore` \| store \| `\.pkg` \| no \| a submittable store/);
  });

  test('a stale block exits 1, --write repairs it, and missing markers are COVERAGE LOST', () => {
    const root = fixtureRoot(EMPTY);
    assert.equal(gen(root, '--check').code, 1);
    assert.equal(gen(root, '--write').code, 0);
    assert.equal(gen(root, '--check').code, 0);
    assert.equal(gen(fixtureRoot('# no markers\n'), '--check').code, 2);
  });
});
