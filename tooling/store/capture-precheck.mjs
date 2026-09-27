#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// capture-precheck.mjs — CAN THIS APP'S LISTING BE CAPTURED FOR THIS CHANNEL AT
// ALL? Asked in the first seconds of a capture job, before it builds anything.
//
// ⏱ 2026-09-26 (O-SCREENSHOT-DRIVER-IS-ONE-APPS). store-screenshots.yml takes its
// app at dispatch (O-STORE-LANES-HARD-WIRE-ONE-APP), so the lane can be pointed at
// an app of the workspace that has no capture suite. Without this step that app
// gets a lane that installs Flutter, boots a device, provisions a real user and
// dies at the first `flutter drive` with no target — twenty minutes in, on a
// runner that has already written to the sandbox. This step moves that failure
// to the job's first step, naming the file, and it is a plain file check, so the
// red control that holds it needs no capture: an app without the suite turns it
// red on any machine.
//
// What it requires, each one named when it is missing:
//   · the app is one of the workspace app set (tooling/ci/app-set.mjs). The gate
//     job already refused any other value; this repeats the membership so the
//     command is complete on its own wherever it is run;
//   · apps/<app>/<SUITE_FILE> and apps/<app>/<DRIVER_FILE>: the `--target` and
//     `--driver` of the drive. tooling/store/capture-suite-scan.mjs declares
//     both, and the capture runner builds its `flutter drive` arguments from the
//     same two constants, so this cannot require a pair the drive does not use;
//   · the channel's listing directory: the register row's `storeMetadataDir`
//     with {app} filled in, which is where the capture writes its frames and
//     where assert-listing-assets.mjs reads them.
//
// ⚠️ WHAT IT CANNOT SEE: whether the suite captures the boards the listing needs,
// or captures anything. It asks "is there a suite and a driver", and the capture
// runner's own scan (scanCaptureSuite) and the listing guard ask the rest.
//
// Usage:  node tooling/store/capture-precheck.mjs --app <id> --channel <channel> [--root <dir>]
// Exit 0 = the app is in the set and every file is there.
// Exit 1 = a finding: the app is not in the set, the channel declares no
//          screenshot set, or a required file is missing (each one named).
// Exit 2 = COVERAGE LOST: an argument is missing, the register cannot be read,
//          no channel declares a screenshot set, or the workspace app set is
//          empty or unreadable. Nothing was checked, which is not a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAppSet } from '../ci/app-set.mjs';
import { SUITE_FILE, DRIVER_FILE } from './capture-suite-scan.mjs';

const NAME = 'capture-precheck';
const REGISTER = 'tooling/channel-register.json';

/** The channels of the register that declare a screenshot set, as
 *  `{ id, dir }` with `dir` the row's `storeMetadataDir` template. Null when the
 *  register is absent or unparseable. */
export function capturableChannels(root) {
  const p = join(root, REGISTER);
  if (!existsSync(p)) return null;
  let register;
  try {
    register = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
  const perChannel = register?.storeMetadataContract?.perChannel ?? {};
  return (Array.isArray(register?.channels) ? register.channels : [])
    .filter((c) => c && c.kind === 'store' && typeof c.storeMetadataDir === 'string' && c.storeMetadataDir.includes('{app}'))
    .filter((c) => {
      const shots = perChannel[c.id]?.graphicAssets?.screenshots;
      return shots !== null && typeof shots === 'object' && !Array.isArray(shots);
    })
    .map((c) => ({ id: c.id, dir: c.storeMetadataDir }));
}

/** What the capture of `app` for `channel` needs on disk, repo-relative. */
export function requiredPaths(app, channelDir) {
  return [
    { rel: posix.join('apps', app, SUITE_FILE), kind: 'file', why: 'the capture suite, the `--target` of the drive' },
    { rel: posix.join('apps', app, DRIVER_FILE), kind: 'file', why: 'the capture driver, the `--driver` of the drive' },
    { rel: channelDir.replace('{app}', app), kind: 'dir', why: 'the listing directory the capture writes into and the listing guard reads' },
  ];
}

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${NAME}: ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error(`\n${NAME}: FAILED`);
  process.exit(2);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const app = arg('--app');
  const channel = arg('--channel');
  const root = resolve(arg('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (!app || !channel) {
    coverageLost([
      `${!app ? '--app' : '--channel'} was not given.`,
      'Usage: node tooling/store/capture-precheck.mjs --app <id> --channel <channel> [--root <dir>]',
    ]);
  }

  const set = requireAppSet(root, NAME);
  const ids = set.map((a) => a.id);
  const channels = capturableChannels(root);
  if (channels === null) coverageLost([`${join(root, REGISTER)} is missing or is not valid JSON.`, 'It is where a channel\'s listing directory is declared.']);
  if (channels.length === 0) {
    coverageLost([
      `${REGISTER} declares no \`kind: "store"\` channel with a storeMetadataDir and a graphicAssets.screenshots block.`,
      'With none, no channel can be captured and every answer here would be about nothing.',
    ]);
  }

  const problems = [];
  if (!ids.includes(app)) {
    problems.push(`the app "${app}" is not in the workspace app set (${ids.join(', ')}). The lane captures one app of the workspace per dispatch.`);
  }
  const row = channels.find((c) => c.id === channel);
  if (!row) {
    problems.push(`the channel "${channel}" declares no screenshot set in ${REGISTER}. The channels that do: ${channels.map((c) => c.id).join(', ')}.`);
  }
  if (problems.length === 0) {
    for (const need of requiredPaths(app, row.dir)) {
      const abs = join(root, need.rel);
      const there = existsSync(abs) && (need.kind === 'dir' ? statSync(abs).isDirectory() : statSync(abs).isFile());
      if (!there) problems.push(`${need.rel} is missing — ${need.why}. A capture of "${app}" for ${channel} cannot run without it.`);
    }
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`\n${NAME}: FAILED`);
    process.exit(1);
  }
  const paths = requiredPaths(app, row.dir).map((n) => n.rel);
  console.log(`ok   "${app}" is one of the ${ids.length} app(s) of the workspace set`);
  console.log(`ok   ${channel}: ${paths.join(', ')} — each present`);
  console.log(`\n${NAME}: ok`);
}
