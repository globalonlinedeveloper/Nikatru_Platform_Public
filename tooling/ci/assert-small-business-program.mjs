#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-small-business-program.mjs — NO REAL APP STORE SUBMISSION BEFORE THE
// OWNER HAS ENROLLED IN THE APPLE SMALL BUSINESS PROGRAM (AB-M5-02).
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// Apple's commission on an auto-renewable subscription is 30% of a subscriber's
// first year and 15% after it, or 15% from day one for a developer enrolled in
// the App Store Small Business Program. Enrolment is free, console-only and
// Account-Holder-only: owner queue A-18. Measured by
// `node tooling/catalog/render-rail-prices.mjs --net-sheet` on 2026-09-29: at
// the standard rate the store monthly nets BELOW the web monthly, and the store
// yearly below the web yearly, so until A-18 is done the two Apple channels are
// the lowest-margin channels this factory sells on, against [ADR 093] §2's
// premise that a store sale nets at least a web sale. Nothing tied the first
// Apple sale to the enrolment: a submission could ship and sell a year of
// subscriptions at twice the commission with every guard green.
//
// So the enrolment is a DATED CELL, `apple-small-business-enrolment` in
// tooling/catalog/fee-register.json ({value, asOf, verify}, value the date the
// console shows, written by the owner), and this gate reads it. The same cell
// selects the Apple rate the net sheet applies, so the gate and the arithmetic
// can never disagree about whether the program applies.
//
// ── WHAT IT GRADES ───────────────────────────────────────────────────────────
//   1 · SHAPE — the cell exists and carries asOf and verify; its value is null
//       or a YYYY-MM-DD date no later than today. Exit 1 otherwise.
//   2 · THE GATE — under `--real-submission`, a null value is exit 1: the
//       refusal names A-18. A dry run (no --real-submission) prints the same
//       sentence as a ⬜ note and exits 0, because a dry run rehearses the
//       bytes and never sells (the rule the declaration gates follow).
//       submit-preconditions.mjs carries this gate for every
//       submitting row whose purchaseRail is `apple-iap`, and limb 3 of
//       assert-publish-steps-guarded.mjs holds the flag to the job: REQUIRED
//       where the job publishes, REFUSED where it does not.
//   COVERAGE LOST (exit 2) — the fee register or the channel register absent
//   or unparseable, the cell absent, zero `apple-iap` channels, or a
//   `--for-submission` channel the register does not declare or whose rail is
//   not `apple-iap`.
//
// Usage:  node tooling/ci/assert-small-business-program.mjs [--for-submission=<channel>] [--real-submission] [repoRoot]
// Exit:   0 ok · 1 a finding (a malformed cell, or a real submission before enrolment) · 2 COVERAGE LOST
// Tests:  tooling/ci/test/small-business-program.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FEE_REGISTER = 'tooling/catalog/fee-register.json';
const CHANNEL_REGISTER = 'tooling/channel-register.json';
const CELL = 'apple-small-business-enrolment';
const RAIL = 'apple-iap';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const ARGS = process.argv.slice(2);
const REAL = ARGS.includes('--real-submission');
const forArg = ARGS.find((a) => a === '--for-submission' || a.startsWith('--for-submission='));
const CHANNEL = forArg === undefined ? null : forArg.slice('--for-submission='.length);
const ROOT = resolve(ARGS.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const lost = [];
const problems = [];
const notes = [];

function done() {
  for (const n of notes) console.log(n);
  if (lost.length) {
    for (const l of lost) console.error(`FAIL COVERAGE LOST — ${l}`);
    process.exit(2);
  }
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`\nassert-small-business-program: FAILED — ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('assert-small-business-program: ok');
  process.exit(0);
}

function readJson(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    lost.push(`${rel} does not exist, so there is no enrolment to read.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    lost.push(`${rel} is not valid JSON (${e.message}).`);
    return null;
  }
}

if (CHANNEL === '') {
  lost.push('--for-submission names no channel. Pass --for-submission=<channel id>.');
  done();
}

const fees = readJson(FEE_REGISTER);
const register = readJson(CHANNEL_REGISTER);
if (lost.length) done();

const appleChannels = (Array.isArray(register?.channels) ? register.channels : []).filter((c) => c?.purchaseRail?.rail === RAIL);
if (appleChannels.length === 0) {
  lost.push(`${CHANNEL_REGISTER} declares no channel whose purchaseRail is ${RAIL}, so this gate guards nothing.`);
}
if (CHANNEL !== null) {
  const row = (register?.channels ?? []).find((c) => c?.id === CHANNEL);
  if (row === undefined) lost.push(`--for-submission=${CHANNEL}: ${CHANNEL_REGISTER} declares no such channel.`);
  else if (row?.purchaseRail?.rail !== RAIL) {
    lost.push(`--for-submission=${CHANNEL}: its purchaseRail is ${JSON.stringify(row?.purchaseRail?.rail)}, not ${RAIL}; this gate is Apple's alone.`);
  }
}
const cell = fees?.cells?.[CELL];
if (cell === undefined || cell === null || typeof cell !== 'object') {
  lost.push(`${FEE_REGISTER} carries no cells.${CELL}, so whether the program applies cannot be read.`);
}
if (lost.length) done();

// 1 · shape.
const where = `${FEE_REGISTER} cells.${CELL}`;
if (typeof cell.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(cell.asOf)) problems.push(`${where}.asOf is ${JSON.stringify(cell.asOf)}; it is the day the cell was last read.`);
if (typeof cell.verify !== 'string' || cell.verify.trim() === '') problems.push(`${where} has no \`verify\`: how the owner re-reads the enrolment.`);
const today = new Date().toISOString().slice(0, 10);
const enrolled = typeof cell.value === 'string' && DAY.test(cell.value);
if (cell.value !== null && !enrolled) {
  problems.push(`${where}.value is ${JSON.stringify(cell.value)}; it is null, or the enrolment date (YYYY-MM-DD) the console shows.`);
} else if (enrolled && cell.value > today) {
  problems.push(`${where}.value is ${cell.value}, after today (${today}). An enrolment is recorded once the console shows it, not before.`);
}

// 2 · the gate.
const channels = CHANNEL === null ? appleChannels.map((c) => c.id) : [CHANNEL];
if (enrolled && problems.length === 0) {
  notes.push(`ok  Small Business Program enrolled ${cell.value}: ${channels.join(', ')} sell at the 15% rate the net sheet applies.`);
} else if (cell.value === null) {
  const sentence =
    `the Apple Small Business Program enrolment is not recorded (${where}.value is null): owner step A-18 — enrol in App ` +
    'Store Connect (Account Holder only, free), then write the enrolment date into that cell. Until then a first-year ' +
    'subscriber pays the standard commission and the Apple rows net below web (render-rail-prices.mjs --net-sheet).';
  for (const id of channels) {
    if (REAL) problems.push(`REFUSED  a real ${id} submission: ${sentence}`);
    else notes.push(`⬜ NOT YET ENROLLED  ${id} — ${sentence} A dry run rehearses and sells nothing, so it does not refuse; --real-submission does.`);
  }
}
done();
