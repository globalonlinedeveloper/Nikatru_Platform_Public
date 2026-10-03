#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// r2-durable-copy.mjs — put a store build's symbols where they outlive the run.
//
// ⏱ ADDED 2026-10-01 (O-STORE-BUILD-SYMBOLS-EXPIRE-AT-90-DAYS, review AA-07).
// A store build is obfuscated, so the ONLY thing that turns its crash reports
// back into names is the split-debug-info directory of THAT build — a rebuild
// writes a different one. Until today the one decodable copy of a submitted
// build's mapping that this repository controlled was a 90-day Actions artifact
// (`symbols-<app>-android-play`, `-windows-store`, `-linux-snap`); the crash sink
// holds another, and a sink is a reader, not an archive. A store keeps serving a
// build for years. So each submit job — and the build-platforms tag run, whose
// apps.gov.in .apk a person uploads by hand — copies the symbols to the private
// R2 bucket `releaseStore` in tooling/channel-register.json names, BEFORE the
// store upload, and the record carries the copy's sha256.
//
// WHAT IT DOES, in order — every step reads back what the one before it wrote:
//   1. packs `--dir` into one .tar.gz (refused when the directory holds no file:
//      an empty mapping archived is a lie with a checksum);
//   2. hashes it (sha256) and measures it (bytes);
//   3. HEADs the key: absent → PUT; present with the same sha256 → kept (a
//      re-run of the same build is idempotent); present with ANOTHER sha256 →
//      exit 1, because two builds under one `<version>+<build>` is the defect;
//   4. HEADs it again and requires the stored length and `sha256` metadata to be
//      the bytes it hashed;
//   5. writes `--out` ({kind, bucket, r2Key, sha256, size, stored}) for
//      record-deployment.mjs `--symbols-record`, and the GITHUB_OUTPUT pair
//      `sha256` / `r2_key`.
//
// THE KEY, the one place it is composed:
//   symbols/<app>/<channel>/<version>+<build>/symbols.tar.gz
// `releaseStore.symbolsKey` in the register is the template; this file fills it.
//
// THE CREDENTIAL IS THE OWNER'S TO MINT, and until it exists the copy is DATED,
// not skipped. The existing Cloudflare deploy token's scope cannot be read from
// CI, and widening it to R2 write would hand every deploy job write access to
// the archive. So the register names a bucket-scoped token
// (`releaseStore.credentials`, each name declared in `ciSecretRegister`), and
// while any of them is unset this prints a `::warning::` naming the owner step
// and writes `stored: false` — up to `releaseStore.pendingUntil`. After that date
// a missing credential is exit 1. Same shape as CLOUDFLARE_READ_TOKEN's dated
// repository fallback (#1095): a pending step that cannot quietly become permanent.
//
// The transport is the S3 API R2 speaks, through the AWS CLI every GitHub-hosted
// runner image carries. The endpoint is COMPOSED from the account id, never read
// from the environment, so the credential cannot be pointed at another host.
// `--aws-cli <path>` is the one seam, for the tests' fake CLI.
//
// Usage:
//   node tooling/ci/r2-durable-copy.mjs --kind symbols --app <app> --channel <channel> \
//        --version <x.y.z> --build <n> --dir <symbols dir> --out <record.json> [--aws-cli <path>]
// env: R2 credentials as releaseStore.credentials names them; CHANNEL_REGISTER_TODAY (tests only).
// Exit 0 = stored and read back, or pending before its date (`stored: false`, printed).
//      1 = refused: a bad argument, an empty directory, a key holding another
//          build, a read-back that disagrees, or a credential missing past its date.
//      2 = COVERAGE LOST: the register declares no releaseStore, so there is no
//          bucket to name and no date to hold the pending step to.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
export const KINDS = Object.freeze(['symbols']);
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** PURE. The releaseStore block, checked, or `{ refusal }`. */
export function readStore(register) {
  const s = register?.releaseStore;
  if (s === null || typeof s !== 'object') return { refusal: `${REGISTER_REL} declares no \`releaseStore\` block.` };
  const names = s.credentials ?? {};
  const missing = ['bucket', 'symbolsKey', 'pendingUntil'].filter((k) => typeof s[k] !== 'string' || s[k] === '');
  for (const k of ['accountId', 'accessKeyId', 'secretAccessKey']) if (typeof names[k] !== 'string' || names[k] === '') missing.push(`credentials.${k}`);
  if (missing.length) return { refusal: `${REGISTER_REL} releaseStore lacks ${missing.join(', ')}.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.pendingUntil)) return { refusal: `${REGISTER_REL} releaseStore.pendingUntil "${s.pendingUntil}" is not YYYY-MM-DD.` };
  return { store: s };
}

/** PURE. The object key for one build's symbols, or `{ refusal }`. */
export function symbolsKey(template, { app, channel, version, build }) {
  for (const [k, v] of Object.entries({ app, channel, version, build })) {
    if (typeof v !== 'string' || !SEGMENT.test(v)) return { refusal: `--${k} "${v ?? ''}" is not one path segment (letters, digits, . _ -).` };
  }
  if (!/^[1-9]\d*$/.test(build)) return { refusal: `--build "${build}" is not a whole number of 1 or more.` };
  const prefix = template.replace('{app}', app).replace('{channel}', channel).replace('{version}', version).replace('{build}', build);
  if (/[{}]/.test(prefix) || !prefix.endsWith('/')) return { refusal: `releaseStore.symbolsKey "${template}" leaves a placeholder or does not end in "/".` };
  return { key: `${prefix}symbols.tar.gz` };
}

/** PURE. Is a missing credential still inside its pending window? */
export const pendingOpen = (today, pendingUntil) => today <= pendingUntil;

/** PURE. The endpoint, composed — never read from the environment. */
export const r2Endpoint = (accountId) => `https://${accountId}.r2.cloudflarestorage.com`;

/** Every regular file under `dir`, so an empty mapping is refused before it is packed. */
function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of listDir(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** The sha256 and size of one file. */
export function digestOf(file) {
  const bytes = readFileSync(file);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= argv.length || argv[i + 1].startsWith('--') ? null : argv[i + 1];
}

/** The COVERAGE LOST stop: there is no bucket to name, so "stored" or "pending" would both be guesses. */
function coverageLost(why) {
  console.error(`✗ COVERAGE LOST — ${why}`);
  process.exitCode = 2;
  return 2;
}

function main(argv) {
  const say = (m) => console.log(m);
  const deny = (m) => {
    console.error(`✗ r2-durable-copy: ${m}`);
    return 1;
  };
  const kind = arg(argv, 'kind');
  if (!KINDS.includes(kind)) return deny(`--kind "${kind ?? ''}" is not one of ${KINDS.join(', ')}.`);
  const dir = arg(argv, 'dir');
  const out = arg(argv, 'out');
  if (dir === null || out === null) return deny('--dir and --out are both required.');

  let register;
  try {
    register = JSON.parse(readFileSync(join(ROOT, REGISTER_REL), 'utf8'));
  } catch (e) {
    return coverageLost(`${REGISTER_REL} could not be read (${e.message}), so no bucket can be named.`);
  }
  const { store, refusal: storeRefusal } = readStore(register);
  if (storeRefusal) return coverageLost(`${storeRefusal} The copy has no bucket and the pending step no date.`);
  const { key, refusal } = symbolsKey(store.symbolsKey, {
    app: arg(argv, 'app'),
    channel: arg(argv, 'channel'),
    version: arg(argv, 'version'),
    build: arg(argv, 'build'),
  });
  if (refusal) return deny(refusal);

  let files;
  try {
    files = filesUnder(resolve(dir));
  } catch (e) {
    return deny(`--dir ${dir} cannot be read (${e.message}).`);
  }
  if (files.length === 0) return deny(`--dir ${dir} holds no file. An empty mapping archived is a checksum over nothing.`);

  const work = mkdtempSync(join(tmpdir(), 'r2-durable-'));
  try {
    const tarball = join(work, 'symbols.tar.gz');
    // why the bare name, run from `work`: GNU tar reads an archive name with a colon as host:path, so an
    // absolute Windows path (C:\...) is a remote archive there. `-C` moves only the member walk.
    const tar = spawnSync('tar', ['-czf', 'symbols.tar.gz', '-C', resolve(dir), '.'], { cwd: work, encoding: 'utf8' });
    if (tar.status !== 0) return deny(`tar exited ${tar.status}: ${(tar.stderr ?? '').trim()}`);
    const { sha256, size } = digestOf(tarball);
    say(`→    ${files.length} file(s) under ${dir} packed: ${size} bytes, sha256 ${sha256}`);
    const record = { kind, bucket: store.bucket, r2Key: key, sha256, size, stored: false };

    const env = process.env;
    const names = store.credentials;
    const unset = [names.accountId, names.accessKeyId, names.secretAccessKey].filter((n) => String(env[n] ?? '').trim() === '');
    const today = env.CHANNEL_REGISTER_TODAY ?? new Date().toISOString().slice(0, 10);
    if (unset.length) {
      if (!pendingOpen(today, store.pendingUntil)) {
        return deny(
          `${unset.join(', ')} unset, and releaseStore.pendingUntil (${store.pendingUntil}) has passed (today ${today}). ` +
            `The symbols of this build exist only in this run and its Actions artifact. ${store.ownerStep ?? ''}`.trim(),
        );
      }
      console.log(
        `::warning title=Symbols not yet durable::${unset.join(', ')} unset — the copy to r2://${store.bucket}/${key} is PENDING until ${store.pendingUntil} ` +
          `(${REGISTER_REL} releaseStore). The record carries stored: false and this sha256. ${store.ownerStep ?? ''}`.trim(),
      );
    } else {
      const cli = arg(argv, 'aws-cli') ?? 'aws';
      const awsEnv = {
        ...env,
        AWS_ACCESS_KEY_ID: env[names.accessKeyId],
        AWS_SECRET_ACCESS_KEY: env[names.secretAccessKey],
        AWS_DEFAULT_REGION: 'auto',
        AWS_EC2_METADATA_DISABLED: 'true',
      };
      const endpoint = r2Endpoint(env[names.accountId].trim());
      const aws = (...a) => spawnSync(cli, ['s3api', ...a, '--bucket', store.bucket, '--key', key, '--endpoint-url', endpoint, '--output', 'json'], { encoding: 'utf8', env: awsEnv });
      const head = () => {
        const r = aws('head-object');
        if (r.status !== 0) return /\b(404|Not Found|NoSuchKey)\b/.test(`${r.stderr}${r.stdout}`) ? { absent: true } : { error: `head-object exited ${r.status}` };
        try {
          const j = JSON.parse(r.stdout);
          return { size: Number(j.ContentLength), sha256: j.Metadata?.sha256 ?? null };
        } catch {
          return { error: 'head-object printed no JSON' };
        }
      };
      const before = head();
      if (before.error) return deny(`${before.error} for r2://${store.bucket}/${key}; nothing was written.`);
      if (!before.absent && before.sha256 !== sha256) {
        return deny(`r2://${store.bucket}/${key} already holds sha256 ${before.sha256}, not ${sha256}: another build under the same version and build number.`);
      }
      if (before.absent) {
        const put = aws('put-object', '--body', tarball, '--metadata', `sha256=${sha256}`, '--content-type', 'application/gzip');
        if (put.status !== 0) return deny(`put-object exited ${put.status} for r2://${store.bucket}/${key}.`);
      } else {
        say(`ok   r2://${store.bucket}/${key} already holds these bytes (a re-run of this build); kept`);
      }
      const after = head();
      if (after.error || after.absent || after.size !== size || after.sha256 !== sha256) {
        return deny(`the read-back of r2://${store.bucket}/${key} is ${JSON.stringify(after)}, not ${size} bytes with sha256 ${sha256}.`);
      }
      record.stored = true;
      say(`ok   r2://${store.bucket}/${key} holds ${size} bytes, sha256 ${sha256} (read back)`);
    }
    writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `sha256=${sha256}\nr2_key=${key}\n`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
