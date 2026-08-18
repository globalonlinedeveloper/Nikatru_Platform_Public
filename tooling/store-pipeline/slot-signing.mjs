#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// slot-signing.mjs — THE SEAM WHERE PARAMETERISATION STOPS, AND WHY IT STOPS
// HERE RATHER THAN SOMEWHERE MORE CONVENIENT.
//
// Everything else in this template is derived. Signing is not, and cannot be:
// each store's signing story is a different mechanism with a different failure,
// not a different value of one mechanism.
//
//   Google Play  an UPLOAD KEY we hold, materialised into the runner, read by
//                Gradle. Play binds the certificate at the first upload and
//                refuses every later bundle signed by another key.
//   Apple        a developer identity in a temporary keychain, plus
//                provisioning profiles, plus notarisation — a network round
//                trip to Apple that is part of signing rather than after it.
//   Microsoft    a package identity bound at first submission, signed by the
//                Store on our behalf for Store distribution.
//   Snap         NO KEY OF OURS AT ALL. Canonical signs the binary. What is
//                one-way here is a GLOBAL NAME claimed at `snapcraft register`.
//   AMO          the add-on ID is fixed PERMANENTLY at first signing.
//
// A template that pretended these were one parameterised step would have to
// invent the differences, and every invention here is a guess about a door that
// does not open twice. So this file is a DISPATCHER over a declared table, and
// the table's most important entries are the ones that say NOTHING EXISTS YET.
//
// ── THE TABLE'S TWO RULES, BOTH ENFORCED BY assert-slot-pipeline.mjs ─────────
//   1. EVERY channel in tooling/channel-register.json has an entry here, and
//      every entry names a channel the register has. Both directions. A channel
//      added to the register therefore fails HERE rather than resolving to
//      `undefined` and taking the "nothing to do" path.
//   2. Every non-null script path must exist on disk. A table naming a script
//      that was deleted is a table that reports a signing step nobody runs.
//
// 🔴 `null` IS A DECLARED ANSWER AND IT REFUSES, IT DOES NOT SKIP.
// `verify: null` means "nothing in this repository can read the signature out of
// this store's artifact". `--verify` on such a channel exits 2, COVERAGE LOST.
// It does NOT print ok. This repository has already paid for the other
// behaviour once: the Android configuration was correct for weeks while every
// bundle CI produced was debug-signed, because no workflow supplied the secrets
// and the fallback fired silently. Every check was green. A verify step that
// passes when it cannot look is that defect with a nicer name.
//
// Usage:  node tooling/store-pipeline/slot-signing.mjs --prepare
//         node tooling/store-pipeline/slot-signing.mjs --verify
// Exit:   0 = the declared step ran, or the channel declaredly signs nothing
//         1 = the delegated script failed
//         2 = COVERAGE LOST — no entry, no script, or nothing that can verify
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SIGNING_SEAMS } from './signing-seams.mjs';

// The table lives in its own module so this dispatcher and the guard can both
// import it without executing each other. See signing-seams.mjs.

const ARGV = process.argv.slice(2);
const MODE = ARGV.includes('--verify') ? 'verify' : ARGV.includes('--prepare') ? 'prepare' : null;

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

if (!MODE) coverageLost(['neither --prepare nor --verify was passed', 'Refusing to pick one: a signing step chosen by default is a signing step nobody asked for.']);

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..', '..');

// The channel comes from the resolver, never from an argument, so a signing step
// cannot be pointed at a store other than the one this checkout is.
let plan;
try {
  const raw = execFileSync(process.execPath, [join(ROOT, 'tooling/store-pipeline/resolve-slot.mjs'), '--json'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  plan = JSON.parse(raw);
} catch (e) {
  coverageLost([
    'resolve-slot.mjs did not produce a plan, so the channel to sign for is unknown',
    String(e.stdout ?? '').trim().split('\n').slice(-6).join('\n  '),
    String(e.message ?? '').split('\n')[0],
  ]);
}

const channel = plan.storeChannel ?? plan.channels?.[0] ?? null;
if (!channel) {
  coverageLost([
    `slot ${plan.path} resolves to no channel at all`,
    'There is no signing story to run and none is invented. See resolve-slot.mjs exit code 4.',
  ]);
}

const seam = SIGNING_SEAMS[channel];
if (!seam) {
  coverageLost([
    `channel "${channel}" has no entry in SIGNING_SEAMS`,
    'This is the failure the both-directions check in assert-slot-pipeline.mjs is',
    'meant to catch before a build ever reaches here. That it reached here means',
    'the guard did not run, or ran and was ignored.',
  ]);
}

console.log(`slot    : ${plan.path}`);
console.log(`channel : ${channel}`);
console.log(`why     : ${seam.why}`);

const script = seam[MODE];

if (script === null) {
  if (MODE === 'prepare') {
    console.log(`✓ nothing to prepare — this channel holds no signing material of ours.`);
    process.exit(0);
  }
  coverageLost([
    `nothing in this repository can VERIFY the signature of a ${channel} artifact`,
    `declared: ${seam.why}`,
    '',
    '🔴 THIS IS NOT A PASS AND NOT A SKIP. A verify step that succeeds when it',
    'cannot look is exactly how this repository shipped weeks of debug-signed',
    'bundles with every check green. The slot may not claim a verified artifact,',
    'and therefore may not submit, until a reader for this format exists.',
  ]);
}

const abs = join(ROOT, script);
if (!existsSync(abs)) {
  coverageLost([`${script} is declared for channel ${channel} and is not in this checkout`, `looked at: ${abs}`]);
}

const args = [abs];
if (MODE === 'verify' && seam.artifactGlob) args.push(seam.artifactGlob);
console.log(`run     : node ${script}${MODE === 'verify' && seam.artifactGlob ? ` ${seam.artifactGlob}` : ''}`);
try {
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
} catch {
  process.exit(1);
}
process.exit(0);
