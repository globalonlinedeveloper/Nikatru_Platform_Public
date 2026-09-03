// ─────────────────────────────────────────────────────────────────────────────
// web-sourcemaps.test.mjs — tooling/ops/upload-web-sourcemaps.mjs must be able
// to FAIL, and the bundle it builds must be the thing the server accepts.
//
// [pipeline F-10] Every guard carries a recorded failing case.
//
// ── WHY THIS FILE IS NOT A SHAPE TEST ────────────────────────────────────────
// The script exists because `glitchtip-cli sourcemaps upload` REPORTS SUCCESS
// AND STORES NOTHING: it gzips one file, the backend's `assemble_artifacts`
// runs `safe_extract_zip` over the blob, logs "uploaded file is not a valid zip
// archive" and deletes everything — while the CLI has already printed
// "Uploaded". A test that asserted on this script's own printed output would
// reproduce that failure exactly, so it does not.
//
// Instead the script is SPAWNED against a stub speaking the server's protocol,
// and the assertions are made on the BYTES IT PUT ON THE WIRE:
//   · the blob gunzips to a real ZIP — read here through its central directory,
//     never through the writer that produced it — whose root holds a
//     `manifest.json` naming the org and release the URL also names.
//   · the chunk's part FILENAME is the sha1 of the RAW chunk (the server reads
//     that filename as the checksum and stores the gunzipped bytes under it).
//   · `main.dart.js` carries `headers.sourcemap` = the MAP's basename, which is
//     what assemble.py matches a minified source to its map by.
//
// ── THE CASE THIS WHOLE CHANGE EXISTS FOR ────────────────────────────────────
// `GET /releases/{version}/files/` answering an EMPTY LIST is the measured
// defect — twelve releases, zero files, two unreadable fatal production issues.
// So the decisive case here is the one where the stub accepts everything, says
// `state: created`, and then keeps answering `[]`: the script must exit
// NON-ZERO. A green run that stored nothing is the only outcome that would make
// this change worthless.
//
// 17 cases: 5 refuse the arguments or environment, 3 refuse the bundle before
// any network call, 9 drive the protocol.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(REPO, 'tooling/ops/upload-web-sourcemaps.mjs');

const ORG = 'nikatru';
const PROJECT = 'subly';
const RELEASE = 'subly@1.0.75+e509a26';
const DEBUG_ID = '7f3d2b16-4e5a-4c8f-9a21-0d6b8e1f4c33';

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-maps-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── the fixture bundle directory ─────────────────────────────────────────────
/** A `flutter build web --release --source-maps` output, reduced to what the
 *  script reads: a script, its map, and a file that is neither. */
const buildDir = ({ withMap = true, withScript = true, debugId = DEBUG_ID } = {}) => {
  const dir = join(TMP, `build-${(seq += 1)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  if (withScript) {
    writeFileSync(
      join(dir, 'main.dart.js'),
      `self.window=self;\n//# debugId=${debugId}\n//# sourceMappingURL=main.dart.js.map\n`,
    );
  }
  if (withMap) {
    writeFileSync(
      join(dir, 'main.dart.js.map'),
      JSON.stringify({ version: 3, debug_id: debugId, sources: ['lib/main.dart'], mappings: 'AAAA' }),
    );
  }
  return dir;
};

// ── spawning ─────────────────────────────────────────────────────────────────
// spawnSync would block this process's event loop, and the stub server below
// runs ON that loop — so the script would hang waiting for a server that cannot
// answer until the script exits. Asynchronous, deliberately.
const run = (args, env = {}) =>
  new Promise((res) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: REPO,
      env: { ...process.env, SENTRY_URL: '', SENTRY_AUTH_TOKEN: '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (code) => res({ code, stdout, stderr, all: stdout + stderr }));
  });

const ok = (dir, over = []) => [
  '--dir',
  dir,
  '--release',
  RELEASE,
  '--org',
  ORG,
  '--project',
  PROJECT,
  ...over,
];

// ── reading what went on the wire ────────────────────────────────────────────
const parseMultipart = (buf, contentType) => {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  assert.ok(m, `no multipart boundary in ${contentType}`);
  const boundary = Buffer.from(`--${(m[1] ?? m[2]).trim()}`);
  const parts = [];
  let at = buf.indexOf(boundary);
  while (at !== -1) {
    const start = at + boundary.length;
    if (buf.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const chunk = buf.subarray(start + 2, next - 2);
    const headEnd = chunk.indexOf('\r\n\r\n');
    const head = chunk.subarray(0, headEnd).toString('utf8');
    parts.push({
      name: /name="([^"]*)"/.exec(head)?.[1],
      filename: /filename="([^"]*)"/.exec(head)?.[1],
      body: chunk.subarray(headEnd + 4),
    });
    at = next;
  }
  return parts;
};

/** Read a zip through its CENTRAL DIRECTORY — the structure `safe_extract_zip`
 *  reads — rather than through the writer that produced it. A test that walked
 *  the local headers in write order would pass on an archive with no usable
 *  directory at all, which is the failure being guarded against. */
const readZip = (buf) => {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'no end-of-central-directory record: this is not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n += 1) {
    assert.equal(buf.readUInt32LE(off), 0x02014b50, `central header ${n} has the wrong signature`);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const rawSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    assert.equal(
      buf.readUInt32LE(localOff),
      0x04034b50,
      `${name} has no local header at its recorded offset`,
    );
    const dataAt = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const comp = buf.subarray(dataAt, dataAt + compSize);
    const data = method === 8 ? inflateRawSync(comp) : comp;
    assert.equal(data.length, rawSize, `${name} inflates to the wrong length`);
    out.set(name, data);
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
};

// ── the protocol stub ────────────────────────────────────────────────────────
/** Speaks the four calls the script makes. `filesAnswers` is consumed one entry
 *  per `GET /files/`, so a run can be made to see an empty list first and a
 *  populated one later — or an empty one for ever, which is the defect. */
const startStub = (opts = {}) =>
  new Promise((res) => {
    const seen = { requests: [], uploads: [], assemble: null, fileReads: 0 };
    const filesAnswers = opts.filesAnswers ?? [
      [{ name: 'main.dart.js' }, { name: 'main.dart.js.map' }],
    ];
    let origin = '';
    const server = createServer((req, out) => {
      const body = [];
      req.on('data', (d) => body.push(d));
      req.on('end', () => {
        const buf = Buffer.concat(body);
        const path = new URL(req.url, 'http://stub').pathname;
        seen.requests.push(`${req.method} ${path}`);
        const send = (code, obj, raw) => {
          out.writeHead(code, { 'content-type': raw ? 'text/plain' : 'application/json' });
          out.end(raw ?? JSON.stringify(obj));
        };
        if (path === `/api/0/organizations/${ORG}/chunk-upload/`) {
          if (opts.chunkUploadStatus) return send(opts.chunkUploadStatus, { detail: 'nope' });
          if (opts.chunkUploadRaw !== undefined) return send(200, null, opts.chunkUploadRaw);
          return send(200, {
            url: `${origin}/chunks/`,
            chunkSize: opts.chunkSize ?? 8 * 1024 * 1024,
            chunksPerRequest: opts.chunksPerRequest ?? 1,
            hashAlgorithm: opts.hashAlgorithm ?? 'sha1',
            accept: opts.accept ?? ['release_files'],
          });
        }
        if (path === '/chunks/') {
          for (const p of parseMultipart(buf, req.headers['content-type'])) {
            seen.uploads.push({ name: p.name, filename: p.filename, gzipped: p.body });
          }
          return send(200, {});
        }
        if (path.endsWith('/assemble/')) {
          seen.assemble = { path, body: JSON.parse(buf.toString('utf8')) };
          return send(200, opts.assemble ?? { state: 'created' });
        }
        if (path.endsWith('/files/')) {
          seen.fileReads += 1;
          return send(200, filesAnswers[Math.min(seen.fileReads - 1, filesAnswers.length - 1)]);
        }
        return send(404, { detail: `stub has no route for ${path}` });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      res({
        origin,
        seen,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(done);
          }),
      });
    });
  });

const withStub = async (opts, body) => {
  const stub = await startStub(opts);
  try {
    return await body(stub);
  } finally {
    await stub.close();
  }
};

const TOKEN = { SENTRY_AUTH_TOKEN: 'stub-token' };
const NOWHERE = 'https://glitchtip.invalid';

// ─────────────────────────────────────────────────────────────────────────────
describe('upload-web-sourcemaps: the arguments and the environment', () => {
  test('a missing --dir is refused, not defaulted to the cwd', async () => {
    const r = await run(['--release', RELEASE, '--org', ORG, '--project', PROJECT]);
    assert.equal(r.code, 1);
    assert.match(r.all, /--dir is required/);
  });

  test('a positional argument is refused rather than silently ignored', async () => {
    const r = await run([...ok(buildDir()), 'build/web']);
    assert.equal(r.code, 1);
    assert.match(r.all, /unexpected argument "build\/web"/);
  });

  test('a SENTRY_URL carrying a path is refused — it must be a bare origin', async () => {
    const r = await run(ok(buildDir()), { SENTRY_URL: `${NOWHERE}/api/0`, ...TOKEN });
    assert.equal(r.code, 1);
    assert.match(r.all, /must be a bare server origin/);
  });

  test('an empty SENTRY_AUTH_TOKEN fails BEFORE any upload is attempted', async () => {
    const r = await run(ok(buildDir()), { SENTRY_URL: NOWHERE, SENTRY_AUTH_TOKEN: '' });
    assert.equal(r.code, 1);
    assert.match(r.all, /SENTRY_AUTH_TOKEN is empty/);
  });

  test('a --dir that does not exist is reported as unreadable, not as an empty build', async () => {
    const r = await run(ok(join(TMP, 'no-such-build')), { SENTRY_URL: NOWHERE, ...TOKEN });
    assert.equal(r.code, 1);
    assert.match(r.all, /could not read/);
  });
});

describe('upload-web-sourcemaps: the bundle is refused before the network', () => {
  test('a build with NO .map file fails, naming --source-maps', async () => {
    const r = await run(ok(buildDir({ withMap: false })), { SENTRY_URL: NOWHERE, ...TOKEN });
    assert.equal(r.code, 1);
    assert.match(r.all, /contains no \.map file/);
    assert.match(r.all, /--source-maps/);
  });

  test('a map with no script beside it is refused — an unpaired map resolves nothing', async () => {
    const r = await run(ok(buildDir({ withScript: false })), { SENTRY_URL: NOWHERE, ...TOKEN });
    assert.equal(r.code, 1);
    assert.match(r.all, /NOT ONE pair/);
  });

  test('--dry-run classifies both artefacts and uploads nothing', async () => {
    const r = await run(ok(buildDir(), ['--dry-run']), { SENTRY_URL: NOWHERE, ...TOKEN });
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /minified_source\s+~\/main\.dart\.js/);
    assert.match(r.stdout, /source_map\s+~\/main\.dart\.js\.map/);
    assert.match(r.stdout, /nothing was uploaded/);
  });
});

describe('upload-web-sourcemaps: the protocol', () => {
  test('an instance that does not advertise release_files is refused', async () => {
    await withStub({ accept: ['artifact_bundle'] }, async (stub) => {
      const r = await run(ok(buildDir()), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 1);
      assert.match(r.all, /release_files/);
      assert.equal(stub.seen.uploads.length, 0, 'it uploaded to a server it had just judged wrong');
    });
  });

  test('an instance hashing chunks with anything but sha1 is refused', async () => {
    await withStub({ hashAlgorithm: 'sha256' }, async (stub) => {
      const r = await run(ok(buildDir()), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 1);
      assert.match(r.all, /hashes chunks with "sha256"/);
      assert.equal(stub.seen.uploads.length, 0);
    });
  });

  test('a non-2xx from the API is fatal and names the status', async () => {
    await withStub({ chunkUploadStatus: 503 }, async (stub) => {
      const r = await run(ok(buildDir()), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 1);
      assert.match(r.all, /503/);
    });
  });

  test('a 200 carrying a non-JSON body is fatal — an HTML error page is not success', async () => {
    await withStub({ chunkUploadRaw: '<html>login</html>' }, async (stub) => {
      const r = await run(ok(buildDir()), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 1);
      assert.match(r.all, /non-JSON body/);
    });
  });

  test('🔴 the uploaded blob is a REAL ZIP whose root holds a manifest naming this org and release', async () => {
    await withStub({}, async (stub) => {
      const r = await run(ok(buildDir()), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 0, r.all);

      assert.equal(stub.seen.uploads.length, 1, 'expected exactly one chunk for a bundle this small');
      const [part] = stub.seen.uploads;
      assert.equal(part.name, 'file_gzip', 'the server reads the part NAME to decide whether to gunzip');

      // The server reads the part FILENAME as the checksum and stores the
      // GUNZIPPED bytes under it, so the digest must be of the RAW chunk.
      const raw = gunzipSync(part.gzipped);
      assert.equal(part.filename, createHash('sha1').update(raw).digest('hex'));

      const zip = readZip(raw);
      assert.ok(zip.has('manifest.json'), `no manifest.json at the zip root; entries: ${[...zip.keys()]}`);
      const manifest = JSON.parse(zip.get('manifest.json').toString('utf8'));

      // assemble.py REFUSES the bundle outright when either differs from the URL.
      assert.equal(manifest.org, ORG);
      assert.equal(manifest.release, RELEASE);
      assert.ok(stub.seen.assemble.path.includes(encodeURIComponent(RELEASE)));

      const src = manifest.files['main.dart.js'];
      const map = manifest.files['main.dart.js.map'];
      assert.equal(src.type, 'minified_source');
      assert.equal(map.type, 'source_map');
      assert.equal(src.url, '~/main.dart.js');
      // Matched to its map by File.name, which assemble.py sets to basename(url).
      assert.equal(src.headers.sourcemap, 'main.dart.js.map');
      assert.equal(src.headers['debug-id'], DEBUG_ID);
      assert.equal(map.headers['debug-id'], DEBUG_ID);

      // index.html is neither a script nor a map and must not be in the bundle.
      assert.ok(!zip.has('index.html'), 'the bundle carries a file that is not an artefact');
      assert.ok(!('index.html' in manifest.files));

      // Every artefact the manifest names is actually IN the archive.
      for (const name of Object.keys(manifest.files)) {
        assert.ok(zip.has(name), `${name} is manifested but absent from the archive`);
      }

      assert.equal(stub.seen.assemble.body.checksum, createHash('sha1').update(raw).digest('hex'));
      assert.deepEqual(stub.seen.assemble.body.chunks, [part.filename]);
    });
  });

  test('a build with no debug id still uploads — the release/name fallback is why --release is required', async () => {
    await withStub({}, async (stub) => {
      const dir = buildDir();
      writeFileSync(join(dir, 'main.dart.js'), 'self.window=self;\n//# sourceMappingURL=main.dart.js.map\n');
      writeFileSync(join(dir, 'main.dart.js.map'), JSON.stringify({ version: 3, sources: ['lib/main.dart'] }));
      const r = await run(ok(dir), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 0, r.all);
      const manifest = JSON.parse(
        readZip(gunzipSync(stub.seen.uploads[0].gzipped)).get('manifest.json').toString('utf8'),
      );
      assert.equal(manifest.files['main.dart.js'].headers['debug-id'], undefined);
      assert.equal(manifest.files['main.dart.js'].headers.sourcemap, 'main.dart.js.map');
    });
  });

  test('assemble answering state=error is fatal, with the server detail carried through', async () => {
    const detail = 'Release does not match uploaded bundle';
    await withStub({ assemble: { state: 'error', detail } }, async (stub) => {
      const r = await run(ok(buildDir()), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 1);
      assert.match(r.all, /assemble refused the bundle: Release does not match uploaded bundle/);
      assert.equal(stub.seen.fileReads, 0, 'it polled for files after assemble had already refused');
    });
  });

  test('assemble reporting missing chunks is fatal, not retried into a green run', async () => {
    await withStub({ assemble: { state: 'not_found', missingChunks: ['deadbeef'] } }, async (stub) => {
      const r = await run(ok(buildDir()), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 1);
      assert.match(r.all, /missing chunks/);
      assert.match(r.all, /deadbeef/);
    });
  });

  test('🔴 THE DEFECT: assemble says created, /files/ stays empty, and the run is RED', async () => {
    await withStub({ filesAnswers: [[]] }, async (stub) => {
      const r = await run(ok(buildDir(), ['--timeout', '1']), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 1, 'a run that stored nothing exited 0 — the state this change exists to end');
      assert.match(r.all, /STILL returns an empty list/);
      assert.ok(stub.seen.fileReads >= 1, 'it never read the files list at all');
      assert.doesNotMatch(r.stdout, /^ok {2}\d+ file/m);
    });
  });

  test('an empty list on the first read is polled, not accepted — assemble is asynchronous', async () => {
    await withStub({ filesAnswers: [[], [{ name: 'main.dart.js' }]] }, async (stub) => {
      const r = await run(ok(buildDir(), ['--timeout', '30']), { SENTRY_URL: stub.origin, ...TOKEN });
      assert.equal(r.code, 0, r.all);
      assert.equal(stub.seen.fileReads, 2, 'it did not poll a second time');
      assert.match(r.stdout, /ok {2}1 file\(s\) now stored against release/);
    });
  });
});
