#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stamp-channel.mjs — the build says which channel a file was built for, beside
// the file, before the file leaves the build job.
//
// O-RELEASE-RECORD-GUESSES-CHANNEL-FROM-EXTENSION. release.json used to READ a
// file's channels off its extension: every register row on the surface that
// accepts `.apk` was listed for every .apk. `apps-gov-in` accepts `.apk`, so the
// Play build's .apk (compiled with RELEASE_CHANNEL=android-play, sold through
// Google Play Billing) was described as an apps.gov.in file. An extension says
// what a file IS; only its build knows which RELEASE_CHANNEL it compiled in.
//
// So each build step that makes a shippable file is followed by a step running
// this, and it writes `<file>.channel.json`:
//
//     { "channel": "<register row id>", "file": "<basename>",
//       "sha256": "<the file's bytes>", "runId": "<GITHUB_RUN_ID>" }
//
// The upload that carries the file carries the stamp too (its `path:` lists
// `<file glob>.channel.json`). release-manifest.mjs `--stage` judges each stamp
// against its file and `--emit-release-json` takes the channel from it. An
// installer with no stamp is COVERAGE LOST there, never a default.
//
// WHAT THIS FILE CHECKS, AND WHAT IT LEAVES TO `--stage`. Here: the channel is a
// register row (a typo fails the build job, not the release a week later), the
// file exists and is a file, and the stamp written is READ BACK and its hash
// compared to the bytes again, so a stamp that was not written whole is refused
// where it was made. Whether the row ACCEPTS the file's format is judged once,
// by `stampProblems` in release-manifest.mjs, which both `--stage` and
// `--emit-release-json` call: a second copy of that judgement here would be the
// one that disagrees.
//
// WHICH BUILD IT STAMPS. `--build-step <id>` names the step `id:` of the build
// that compiled the file. This file only checks the flag is there; the pairing
// (that build's `--dart-define=RELEASE_CHANNEL=` equals `--channel`) is graded
// statically, from the workflow text, by `assert-release-json.mjs --static`.
//
// Usage:
//   node tooling/ci/stamp-channel.mjs --channel <row id> --build-step <step id>
//     [--run-id <id>] [--repo-root <path>] <file>...
//   `--run-id` defaults to $GITHUB_RUN_ID; with neither it refuses.
//
// Exit 0 = every file stamped, and each stamp read back whole. 1 = refused.
// 2 = COVERAGE LOST: nothing was stamped (no file, or a glob that matched none),
// or the register could not be read to check the channel.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { channelStampName, channelStampKeys } from './release-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(join(HERE, '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';

/** The stamp for one file's bytes. Pure. */
export function makeChannelStamp({ channel, file, bytes, runId }) {
  return { channel, file: basename(file), sha256: createHash('sha256').update(bytes).digest('hex'), runId: String(runId) };
}

function die(msg, ...more) {
  console.error(`✗ ${msg}`);
  for (const m of more) console.error(`  ${m}`);
  return process.exit(1);
}

/** Exit 2 (AGENTS.md): the step could not do what it exists for, so it is not
 *  evidence either way. A stamp step that stamped NOTHING (an unmatched glob) or
 *  that could not read the register to check its channel lands here, never at 0. */
function coverageLost(msg, ...more) {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const m of more) console.error(`  ${m}`);
  return process.exit(2);
}

function main(argv) {
  const VALUED = new Set(['--channel', '--build-step', '--run-id', '--repo-root']);
  const opts = new Map();
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUED.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) die(`${a} was given with no value.`);
      opts.set(a, v);
      i++;
    } else if (a.startsWith('--')) {
      die(`${a} is not an option of stamp-channel.mjs.`, 'Usage: --channel <row id> --build-step <step id> [--run-id <id>] [--repo-root <path>] <file>...');
    } else {
      files.push(a);
    }
  }
  const channel = opts.get('--channel') ?? die('--channel <register row id> is required: it is the RELEASE_CHANNEL the build compiled in.');
  if (!opts.has('--build-step')) die('--build-step <step id> is required: it names the build this stamp speaks for, and assert-release-json.mjs --static pairs the two.');
  const runId = opts.get('--run-id') ?? process.env.GITHUB_RUN_ID ?? die('no --run-id and no $GITHUB_RUN_ID: a stamp that names no run cannot be traced to the build that made it.');
  if (!/^[0-9]+$/.test(String(runId))) die(`the run id ${JSON.stringify(runId)} is not a workflow run id.`);
  if (files.length === 0) coverageLost('no file to stamp.', 'A stamp step with nothing to stamp stamped nothing; the release would then meet the file unstamped.');

  const root = resolve(opts.get('--repo-root') ?? DEFAULT_ROOT);
  let register;
  try {
    register = JSON.parse(readFileSync(join(root, REGISTER_REL), 'utf8'));
  } catch (e) {
    coverageLost(`${REGISTER_REL} could not be read under ${root} (${e.message}).`, 'The channel is checked against it; without it nothing says the stamp names a real row.');
  }
  const ids = new Set((register?.channels ?? []).map((c) => c?.id));
  if (!ids.has(channel)) {
    die(`--channel "${channel}" names no row of ${REGISTER_REL}.`, `It has: ${[...ids].join(', ')}.`);
  }

  for (const f of files) {
    const abs = resolve(f);
    if (f.endsWith('.channel.json')) die(`${f} is a stamp; a stamp is never stamped.`);
    // An unmatched shell glob arrives as its own text, `…/*.aab`, and lands here:
    // nothing was stamped, which is COVERAGE LOST and never a quiet 0.
    if (!existsSync(abs)) coverageLost(`${f} is not a file.`, 'An unmatched glob arrives as its own text; the build made no such file, so nothing was stamped.');
    if (!statSync(abs).isFile()) die(`${f} is a directory, not a file; a stamp speaks for one file's bytes.`);
    const stamp = makeChannelStamp({ channel, file: abs, bytes: readFileSync(abs), runId });
    const out = channelStampName(abs);
    try {
      writeFileSync(out, `${JSON.stringify(stamp, null, 2)}\n`, { flag: 'wx' });
    } catch (e) {
      if (e?.code === 'EEXIST') die(`${out} already exists.`, 'One file, two stamps: a second stamp step would leave nobody able to say which build it speaks for.');
      throw e;
    }
    // WRITE, READ, VERIFY: the stamp on disk is parsed back and its hash compared
    // to the bytes a second time, so a torn write or a file that changed under
    // the step is refused here, in the job that made the file.
    const back = JSON.parse(readFileSync(out, 'utf8'));
    const again = createHash('sha256').update(readFileSync(abs)).digest('hex');
    if (Object.keys(back).sort().join(',') !== channelStampKeys().join(',') || back.sha256 !== again || back.channel !== channel || back.file !== basename(abs)) {
      die(`${out} did not read back as written: sha256 ${back.sha256} on disk, the bytes hash to ${again}.`);
    }
    console.log(`stamped  ${basename(abs)}  ${channel}  ${back.sha256}  run ${back.runId}`);
  }
  console.log(`\nok  ${files.length} file(s) stamped ${channel} (build step ${opts.get('--build-step')})`);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
