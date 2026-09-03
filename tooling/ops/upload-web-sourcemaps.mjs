#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// upload-web-sourcemaps.mjs — put the web bundle's source maps INTO GlitchTip,
// and refuse to exit 0 until the server says it holds them.
//
// [pipeline 9]R-7, web limb.
//
// ── THE DEFECT, MEASURED 2026-09-03 ──────────────────────────────────────────
// `GET /api/0/organizations/nikatru/releases/{version}/files/` answered 200 with
// a ZERO-LENGTH list for all TWELVE releases GlitchTip holds for `subly`, and
// `dsyms` was `[]`. Nothing had ever been uploaded, because nothing had ever
// tried and because `flutter build web --release` emits no maps to upload. Two
// OPEN, UNRESOLVED production issues are unreadable as a result:
//   · `minified:a0X: GoError: There is nothing to pop` — 4 occurrences, fatal
//   · `minified:ng: AuthException(...)`
// with frames reading `main.dart.js k7.er 63099`, `aQU.$0 130674`, `JY.hG 116903`.
//
// ── 🔴 WHY THIS FILE EXISTS INSTEAD OF `glitchtip-cli sourcemaps upload` ─────
// It was the obvious answer and it does not work, and the reason is the exact
// failure mode this repository refuses everywhere else: IT REPORTS SUCCESS AND
// STORES NOTHING.
//
// READ FROM THE SOURCE ON 2026-09-03, not inferred, and reproduced locally
// against a protocol stub:
//   · glitchtip-cli (v1.0.0 and `main`), src/commands/sourcemaps.rs
//     `upload_single_file` gzips ONE file, POSTs it as a chunk, then calls
//     `assemble_release_files` with `{checksum, chunks}` — and NOTHING ELSE. The
//     artifact name it prints (`Uploaded: main.dart.js -> ~/main.dart.js`) and
//     the `--dist` it accepts are computed CLIENT-SIDE and never transmitted;
//     `dist` is literally carried as `#[allow(dead_code)] // Used for artifact
//     bundle metadata`.
//   · glitchtip-backend, apps/releases/api.py `assemble_release` answers
//     `{"state":"created"}` IMMEDIATELY and enqueues `assemble_artifacts_task`.
//     The CLI reads that 200 and prints "Uploaded".
//   · glitchtip-backend, apps/files/assemble.py `assemble_artifacts` then runs
//     `safe_extract_zip(...)` over the blob and, on failure, logs
//     "uploaded file is not a valid zip archive" and deletes everything. A
//     gzipped `main.dart.js` is not a zip archive.
// So the CLI's own upload path is a green step that stores nothing — the same
// shape as the standing sentry-cli reports (glitchtip#38, backend#299) that
// sent us to the CLI in the first place. It is used in deploy-web.yml for what
// it does do correctly (`sourcemaps inject`, `releases new`), and this file does
// the upload the server actually accepts.
//
// ── WHAT THE SERVER ACTUALLY ACCEPTS ─────────────────────────────────────────
// An ARTIFACT BUNDLE: a zip whose root holds `manifest.json` —
//   { "org": "<slug>", "release": "<version>",
//     "files": { "<path in zip>": { "url": "~/main.dart.js",
//                                   "type": "minified_source" | "source_map",
//                                   "headers": { "sourcemap": "main.dart.js.map",
//                                                "debug-id": "<uuid>" } } } }
// assemble.py stores `File.name = basename(url)`, matches a minified_source to
// its map by `headers.sourcemap == <the map File's name>` OR by a shared
// `debug-id`, and REFUSES the bundle outright when `manifest.release` differs
// from the version in the URL or `manifest.org` differs from the org.
//
// ⚠️ AND IT DOES NOT STORE `dist`. `DebugSymbolBundle` (apps/sourcecode/
// models.py) has columns for organization, debug_id, release, file and
// sourcemap_file — and none for dist; assemble.py carries the line "Sentry OSS
// would add dist to release here" over nothing. So on THIS backend the lookup
// key is `(organization, debug_id)` or `(release, file name)`. `--dist` is
// accepted here, recorded in the manifest and sent by the SDK because it is
// correct Sentry-protocol metadata and costs nothing — but it is NOT the
// mechanism, and anyone debugging a failed lookup should stop reading it.
//
// ── THE PROOF IS IN-BAND, EVERY RUN ──────────────────────────────────────────
// Assemble is ASYNCHRONOUS, so a 200 from it means "queued", never "stored".
// This script therefore ends by polling `GET /releases/{version}/files/` — the
// exact call whose empty answer is the defect above — and exits non-zero if it
// is still empty when the budget runs out. A run that cannot prove the files
// landed is a red run.
//
// Usage:
//   node tooling/ops/upload-web-sourcemaps.mjs \
//     --dir apps/subly/build/web --release 'subly@1.0.75+e509a26' \
//     --org nikatru --project subly [--dist web] [--url-prefix '~'] [--timeout 180]
// Env: SENTRY_URL (server origin), SENTRY_AUTH_TOKEN.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, basename, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, gzipSync } from 'node:zlib';

const SOURCE_EXT = /\.(?:js|cjs|mjs)$/;
const MAP_EXT = /\.map$/;

class Fatal extends Error {}

const die = (msg) => {
  console.error(`::error title=source maps::${msg}`);
  console.error(`\nupload-web-sourcemaps: FAILED — ${msg}`);
  throw new Fatal(msg);
};

// 🔴 `process.exit()` IS NOT WHAT ENDS THIS SCRIPT, AND THAT IS THE POINT.
// `die` used to call it. Called from the SYNC phase that is harmless; called
// after the multipart chunk POST — while undici still holds the socket — it
// aborts inside libuv on Windows:
//
//     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:94
//
// and the process leaves with 0xC0000409 (3221226505) instead of the 1 the
// script chose. A CRASH WHERE A REFUSAL WAS INTENDED is the exact shape of
// failure this whole file exists to stop reporting, and the two assemble
// refusals — `state: error` and `state: not_found` — are both on that side of
// the first POST. Measured on 2026-09-03 by the negative test, which asserts
// the code is 1 and nothing else.
//
// So `die` throws and the loop is left to drain the sockets on its own. That it
// DOES drain, rather than hanging on a keep-alive socket, is measured by the
// same test: every failing protocol case terminates.
process.on('uncaughtException', (err) => {
  process.exitCode = 1;
  // A Fatal has already printed the reason a human should read. Anything else
  // is a bug or an unreachable host, and its stack is the only thing that will
  // explain it — printing it here rather than letting Node's default handler
  // abort keeps the exit code ours in both cases.
  if (!(err instanceof Fatal)) console.error(err);
});

// ── argv ─────────────────────────────────────────────────────────────────────
// ⚠️ FLAGS THAT TAKE NO VALUE MUST BE DECLARED, or they silently eat the next
// argument. `--dry-run` written last bound `undefined`, so the dry-run branch
// (`!== undefined`) never fired and the script UPLOADED; written anywhere else
// it swallowed the option after it. A flag that does the opposite of what it
// says, quietly, on a script whose job is to refuse quiet successes.
const NO_VALUE = new Set(['dry-run']);
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (!a.startsWith('--')) die(`unexpected argument "${a}"`);
  const eq = a.indexOf('=');
  if (eq > -1) {
    args.set(a.slice(2, eq), a.slice(eq + 1));
    continue;
  }
  const key = a.slice(2);
  if (NO_VALUE.has(key)) {
    args.set(key, 'yes');
    continue;
  }
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) die(`--${key} needs a value, and none followed it`);
  args.set(key, value);
  i += 1;
}
const opt = (k) => {
  const v = args.get(k);
  if (v === undefined || v === '') die(`--${k} is required`);
  return v;
};

const dir = resolve(opt('dir'));
const release = opt('release');
const org = opt('org');
const project = opt('project');
const dist = args.get('dist') ?? '';
const urlPrefix = (args.get('url-prefix') ?? '~').replace(/\/+$/, '');
const timeoutS = Number(args.get('timeout') ?? 180);

const base = (process.env.SENTRY_URL ?? '').replace(/\/+$/, '');
const token = process.env.SENTRY_AUTH_TOKEN ?? '';
if (!/^https?:\/\/[^/\s]+$/.test(base)) {
  die(`SENTRY_URL must be a bare server origin, got ${JSON.stringify(base)}`);
}
if (!token) die('SENTRY_AUTH_TOKEN is empty, so nothing could be uploaded');

// ── 1. discover the .js / .js.map pairs ──────────────────────────────────────
const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

let all;
try {
  all = walk(dir);
} catch (e) {
  die(`could not read ${dir}: ${e.message}`);
}

const rel = (p) => relative(dir, p).split(sep).join('/');
const maps = new Set(all.filter((p) => MAP_EXT.test(p)).map(rel));
if (maps.size === 0) {
  die(
    `${dir} contains no .map file. The build did not emit source maps, so there is nothing to ` +
      'upload and every stack trace from this release would stay minified. Check that the ' +
      '`flutter build web` command still carries --source-maps.',
  );
}

/** Read the debug id glitchtip-cli's `sourcemaps inject` writes, when present.
 *  It is the STRONGEST key the server has — `(organization, debug_id)` — and
 *  unlike the release name it cannot drift from what the SDK reports. Absent is
 *  fine: assemble.py then falls back to `(release, file name)`, which is why
 *  `--release` is mandatory here and not optional. */
const debugIdOfSource = (text) => text.match(/\/\/#\s*debugId=([0-9a-fA-F-]{36})/)?.[1];
const debugIdOfMap = (text) => {
  try {
    const v = JSON.parse(text).debug_id;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
};

const entries = [];
for (const p of all) {
  const r = rel(p);
  const isMap = MAP_EXT.test(r);
  const isSrc = SOURCE_EXT.test(r);
  if (!isMap && !isSrc) continue;
  const bytes = readFileSync(p);
  const headers = {};
  let type;
  if (isMap) {
    type = 'source_map';
    const id = debugIdOfMap(bytes.toString('utf8'));
    if (id) headers['debug-id'] = id;
  } else {
    type = 'minified_source';
    const id = debugIdOfSource(bytes.toString('utf8'));
    if (id) headers['debug-id'] = id;
    // `headers.sourcemap` is compared against the MAP's stored File.name, and
    // assemble.py sets that to `basename(url)` — so a basename here, never a path.
    if (maps.has(`${r}.map`)) headers.sourcemap = basename(`${r}.map`);
  }
  entries.push({ zipPath: r, bytes, url: `${urlPrefix}/${r}`, type, headers });
}

const sources = entries.filter((e) => e.type === 'minified_source');
const paired = sources.filter((e) => e.headers.sourcemap);
if (paired.length === 0) {
  die(
    `${dir} has ${maps.size} map(s) and ${sources.length} script(s) but NOT ONE pair — no ` +
      '`<name>.js` sits beside its `<name>.js.map`. An unpaired map resolves nothing.',
  );
}

const manifest = {
  org,
  release,
  ...(dist ? { dist } : {}),
  files: Object.fromEntries(
    entries.map((e) => [e.zipPath, { url: e.url, type: e.type, headers: e.headers }]),
  ),
};

// ── 2. the artifact bundle ───────────────────────────────────────────────────
// A minimal DEFLATE zip writer. No dependency is added for this: the repo ships
// no zip library, `zip(1)` would be a second thing that has to be present on the
// runner, and the format needed here is the 1989 one — local headers, a central
// directory and an end record. ZIP64 is deliberately absent; a Flutter web
// bundle's maps are megabytes, and a >4 GiB member fails loudly at the size
// check below rather than silently emitting a truncated field.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const buildZip = (members) => {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const m of members) {
    const name = Buffer.from(m.name, 'utf8');
    const raw = m.data;
    if (raw.length > 0xffffffff) die(`${m.name} is too large for a non-ZIP64 archive`);
    const deflated = deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(0, 10); // mod time — zeroed, so the bundle is reproducible
    lh.writeUInt16LE(33, 12); // mod date — 1 Jan 1980, the epoch of the format
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, deflated);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(33, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(deflated.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + deflated.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
};

const bundle = buildZip([
  { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
  ...entries.map((e) => ({ name: e.zipPath, data: e.bytes })),
]);

console.log(
  `bundle: ${entries.length} artifact(s) (${paired.length} paired), ${bundle.length} bytes, ` +
    `release "${release}"${dist ? `, dist "${dist}"` : ''}`,
);
for (const e of entries) {
  const id = e.headers['debug-id'] ? `  debug-id=${e.headers['debug-id']}` : '';
  console.log(`  ${e.type.padEnd(16)} ${e.url}${id}`);
}

if (args.get('dry-run') !== undefined) {
  console.log('\ndry-run: nothing was uploaded.');
  process.exit(0);
}

// ── 3. upload ────────────────────────────────────────────────────────────────
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const auth = { authorization: `Bearer ${token}`, accept: 'application/json' };

const api = async (path, init = {}) => {
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    die(`${init.method ?? 'GET'} ${url} → ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return die(`${init.method ?? 'GET'} ${url} answered 200 with a non-JSON body: ${text.slice(0, 200)}`);
  }
};

const info = await api(`/api/0/organizations/${encodeURIComponent(org)}/chunk-upload/`);
if (!Array.isArray(info.accept) || !info.accept.includes('release_files')) {
  die(
    `the instance's chunk-upload advertises accept=${JSON.stringify(info.accept)} — without ` +
      '`release_files` the assemble endpoint below is not the one this server implements.',
  );
}
if (info.hashAlgorithm !== 'sha1') die(`the instance hashes chunks with "${info.hashAlgorithm}", not sha1`);
const chunkSize = Number(info.chunkSize) || 8 * 1024 * 1024;
const perRequest = Math.max(1, Number(info.chunksPerRequest) || 1);

const chunks = [];
for (let i = 0; i < bundle.length; i += chunkSize) {
  const data = bundle.subarray(i, i + chunkSize);
  chunks.push({ data, checksum: sha1(data) });
}
const bundleChecksum = sha1(bundle);
console.log(`chunk-upload: ${chunks.length} chunk(s) of <=${chunkSize} bytes, bundle sha1 ${bundleChecksum}`);

for (let i = 0; i < chunks.length; i += perRequest) {
  const batch = chunks.slice(i, i + perRequest);
  const form = new FormData();
  for (const c of batch) {
    // The server reads the PART FILENAME as the chunk's checksum and stores the
    // GUNZIPPED bytes under it (apps/files/api.py `decompress_chunk`), so the
    // digest must be of the RAW chunk and the body must be gzip.
    form.append('file_gzip', new Blob([gzipSync(c.data)]), c.checksum);
  }
  await api(info.url, { method: 'POST', body: form });
}

const encodedRelease = encodeURIComponent(release);
const assembled = await api(
  `/api/0/organizations/${encodeURIComponent(org)}/releases/${encodedRelease}/assemble/`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checksum: bundleChecksum, chunks: chunks.map((c) => c.checksum) }),
  },
);
if (assembled.state === 'not_found') {
  die(`assemble reports missing chunks after upload: ${JSON.stringify(assembled.missingChunks)}`);
}
if (assembled.state === 'error') die(`assemble refused the bundle: ${assembled.detail ?? '(no detail)'}`);
console.log(`assemble: state=${assembled.state}`);

// ── 4. THE PROOF ─────────────────────────────────────────────────────────────
// `state: created` means QUEUED. The only statement worth making is the one the
// defect was measured with, so it is the one this script ends on.
const filesUrl = `/api/0/organizations/${encodeURIComponent(org)}/releases/${encodedRelease}/files/`;
const deadline = Date.now() + timeoutS * 1000;
let listed = [];
let attempt = 0;
while (Date.now() < deadline) {
  attempt += 1;
  listed = await api(filesUrl);
  if (Array.isArray(listed) && listed.length > 0) break;
  await new Promise((r) => setTimeout(r, 5000));
}

if (!Array.isArray(listed) || listed.length === 0) {
  die(
    `after ${attempt} read(s) over ${timeoutS}s, GET ${filesUrl} STILL returns an empty list. The ` +
      'bundle was accepted for assembly and stored nothing — the exact state this whole change ' +
      'exists to end. assemble.py logs the reason server-side; "uploaded file is not a valid zip ' +
      'archive" and "Release does not match uploaded bundle" are the two a client change can cause.',
  );
}

console.log('');
console.log(`ok  ${listed.length} file(s) now stored against release "${release}" (project ${project}):`);
for (const f of listed.slice(0, 20)) {
  console.log(`      ${f.name ?? JSON.stringify(f).slice(0, 120)}`);
}
console.log(`\n    proof: curl -H "authorization: Bearer <token>" ${base}${filesUrl}`);
