// ─────────────────────────────────────────────────────────────────────────────
// channel-arming.mjs — the ONE answer to "does the register say this channel can
// reach a user today?", read out of tooling/channel-register.json and nowhere
// else.
//
// 🔴 WHY THIS EXISTS, AND IT IS A MEASURED DEFECT RATHER THAN A TIDY-UP.
// Three signing seams — windows-signing.mjs, apple-signing.mjs and
// appimage-signing.mjs — each derived "this is a release lane" from a TAG PUSH
// and then treated a release lane with no secrets as FATAL. Correct in shape,
// wrong in scope, and the consequence was measured on 2026-08-08 before a single
// tag had ever been pushed:
//
//   a `subly-v*` tag makes build-platforms.yml's `windows`, `apple` AND
//   `linux_web_android` jobs die at the credential step; the `release` job
//   `needs:` all three; so THE FIRST RELEASE THIS REPOSITORY EVER PUBLISHES IS
//   SKIPPED, by three checks that were each individually defensible.
//
// The scope error is a specific one, and naming it is the whole of this file.
// "A release lane that cannot sign must not produce a shippable artifact" is a
// statement about a CHANNEL — it is only true when the channel in question can
// actually ship. Today it cannot, and the register says so in its own fields:
//
//   windows-direct   submittable: false · served: false · lane: null
//   ios-appstore     submittable: true  · served: false · lane: NULL
//   macos-appstore   submittable: true  · served: false · lane: NULL
//   linux-appimage   submittable: false · served: false · lane: null
//
// Failing the build on a missing certificate for a channel that publishes
// NOTHING blocks every release of the five channels that are ready, in order to
// protect a download nobody can reach. That is not caution; it is a guard whose
// domain is empty firing on a lane whose domain is not.
//
// ── WHAT "ARMED" MEANS, AND WHY IT IS THESE THREE FIELDS ─────────────────────
// A channel is ARMED when a run that failed to sign would produce something a
// user could actually receive. The register already carries both ways that can
// happen and this file adds no fourth:
//
//   · `served: true`                     the register's own published/unpublished
//                                        flag (assert-channel-register.mjs:348).
//                                        Something is being handed to users from
//                                        this row right now.
//   · `submittable: true` AND a `lane`   a store row whose artifact THIS repo's
//                                        CI emits. `lane` is "the job that EMITS
//                                        the format the row accepts"; with it
//                                        null, a release produces nothing that
//                                        could be submitted, signed or not.
//
// Anything else is UNARMED, and an unsigned build there is a build proof — the
// state those seams already call legal on every non-tag trigger. What changes is
// that a TAG no longer converts it into a failure by itself.
//
// 🔴 THE GAP IS PRINTED, LOUDLY, AND IT IS PRINTED ON THE LANE WHERE IT MATTERS.
// [pipeline C-6]: when a capability's on-switch is owner-gated, the guard must
// PRINT the gap rather than fail the build — "a guard that blocks CI on work only
// the owner can do blocks every merge in the repository" (apple-signing.mjs:88).
// Every one of the four rows above is owner-gated on money or an enrolment: a
// code-signing certificate that must be BOUGHT from a CA in the Microsoft Trusted
// Root Program and renewed yearly; an Apple Developer account (OWNER_QUEUE A-4);
// an Ed25519 keypair whose custody and restore drill only the owner can perform.
// No agent can close any of them, so no agent can unblock a build that fails on
// them.
//
// ── THE TRIPWIRE, WHICH IS WHAT KEEPS THIS FROM BEING A WEAKENING ────────────
// The failing case did not go away; it moved to where it can actually fire. The
// day the register flips `served` to true, or gives an Apple row a lane, or marks
// a direct row submittable, the SAME tag with the SAME missing secrets FAILS —
// and it fails naming the row and the field that armed it. That is strictly more
// precise than "a tag was pushed", which was true of a repository that publishes
// nothing.
//
// ⚠️ NOT A SCANNER, BY CONSTRUCTION. Every function here is pure: rows in,
// verdict out. There is no filesystem, no environment and no channel name — the
// callers find their own rows in the register and hand them over, so this file
// cannot drift from the register by carrying a copy of it. "Did my scan still
// reach the tree" belongs to the three callers, each of which already refuses to
// run when its row is missing from the register.
// ─────────────────────────────────────────────────────────────────────────────

export const REGISTER = 'tooling/channel-register.json';

/**
 * The lane shape, defined identically to assert-channel-register.mjs's
 * `laneShaped` — deliberately the same predicate rather than a looser one.
 *
 * A malformed lane "resolves to nothing and is skipped by every check that reads
 * it, so it looks exactly like coverage" (that guard's own words). Treating a
 * malformed lane as ARMING here would be the inverse mistake: a row could arm
 * itself with `lane: {}`. It is unarmed, and the guard that owns lane shape
 * fails the register in the same run.
 */
export function laneShaped(lane) {
  return (
    lane !== null &&
    lane !== undefined &&
    typeof lane === 'object' &&
    typeof lane.workflow === 'string' &&
    lane.workflow.trim() !== '' &&
    typeof lane.job === 'string' &&
    lane.job.trim() !== ''
  );
}

/**
 * Is this register row armed — i.e. would an unsigned artifact from it reach
 * anybody?
 *
 * Returns `{ id, armed, served, submittable, lane, reasons, blockers }`.
 * `reasons` say why it IS armed (empty when it is not); `blockers` say why it is
 * not (empty when it is). Both are register fields quoted back, never prose this
 * file invented, so a reader can check the claim against the file it came from.
 */
export function armingOf(row) {
  const id = typeof row?.id === 'string' && row.id !== '' ? row.id : '(unnamed row)';
  const served = row?.served === true;
  const submittable = row?.submittable === true;
  const lane = laneShaped(row?.lane) ? row.lane : null;

  const reasons = [];
  const blockers = [];

  if (served) {
    reasons.push(`\`served: true\` — ${REGISTER} says this channel is published, so users receive what it emits`);
  }
  if (submittable && lane !== null) {
    reasons.push(
      `\`submittable: true\` and a build lane (${lane.workflow} · job "${lane.job}") emits the artifact a submission would carry`,
    );
  }

  // 🔴 BLOCKERS ONLY EXIST WHEN THE ROW IS UNARMED. A row can be armed by one
  // limb while failing the other — `web` is `served: true` and
  // `submittable: false` — and listing "`submittable: false`" as a blocker
  // against a channel that is LIVE would be a sentence that is true of the field
  // and false of the channel. Exactly one of `reasons` and `blockers` is ever
  // non-empty, which is what lets a printer use either without asking.
  const armed = reasons.length > 0;
  if (!armed) {
    blockers.push('`served: false` — nothing is published from this channel');
    if (submittable) {
      blockers.push(
        '`submittable: true` but `lane: null` — no job in this repository emits the artifact, so a release produces nothing this channel could submit',
      );
    } else {
      blockers.push('`submittable: false` — the register declares no store submission path for it at all');
    }
  }

  return { id, armed, served, submittable, lane, reasons, blockers };
}

/**
 * THE RULE, applied to the set of rows one signing seam serves.
 *
 * `fatal` is true when AT LEAST ONE of them is armed: a seam serving two rows
 * (the Apple pair) must fail if either can ship, because one credential arranges
 * both and a partial answer is not available.
 *
 * `armed` / `unarmed` are the split, so the caller can name rows in its message
 * rather than repeating the derivation.
 */
export function releaseGapVerdict(rows) {
  const armings = (Array.isArray(rows) ? rows : [rows]).map(armingOf);
  const armed = armings.filter((a) => a.armed);
  const unarmed = armings.filter((a) => !a.armed);
  return { fatal: armed.length > 0, armings, armed, unarmed };
}

/**
 * The LOUD PRINT for the legal case: a release lane, no secrets, and not one row
 * this seam serves can reach a user.
 *
 * Returned as lines rather than printed, so the caller owns its own stream and
 * so this can be asserted on directly in a test. `laneReasons` are the release
 * signals the caller already derived (a tag push, a declared submission
 * workflow) — quoted back so the printed block says WHY it was consulted.
 */
export function unarmedGapLines({ armings = [], secretNames = [], laneReasons = [], ownerItem = null } = {}) {
  const lines = [];
  lines.push('🔴 RELEASE LANE, NO SIGNING SECRETS — PRINTED IN FULL AND NOT FAILED, BECAUSE NOTHING THIS');
  lines.push('   SEAM SERVES CAN REACH A USER. Read the derivation before reading this as an excuse:');
  for (const r of laneReasons) lines.push(`   · this run IS a release lane — ${r}`);
  for (const a of armings) {
    lines.push(`   · channel "${a.id}" is NOT ARMED in ${REGISTER}:`);
    for (const b of a.blockers) lines.push(`       ${b}`);
  }
  if (secretNames.length) {
    lines.push(`   · absent secrets: ${secretNames.join(', ')}`);
  }
  if (ownerItem !== null) {
    lines.push(`   🔴 THE BLOCKER IS OWNER-GATED: ${ownerItem}`);
    lines.push('      No agent can create these secrets, so failing here would block every release of every');
    lines.push('      OTHER channel on work only the owner can do. [pipeline C-6] says PRINT, not fail.');
  }
  lines.push('   ⚠️ THIS IS A TRIPWIRE, NOT A WAIVER. The same tag with the same missing secrets FAILS the');
  lines.push(`      moment ${REGISTER} arms any row above — \`served: true\`, or \`submittable: true\` with a`);
  lines.push('      real `lane`. Arming a channel and creating its secrets belong in ONE change.');
  lines.push('   ⬜ WHAT THIS RELEASE THEREFORE CARRIES FOR THIS PLATFORM IS A BUILD PROOF, labelled below.');
  return lines;
}

/**
 * The lines a caller appends to its own FATAL message when a row IS armed, so
 * the failure names the field that armed it rather than only the missing secret.
 *
 * Kept here beside the derivation on purpose: the message a reader gets at 2am
 * has to point at the same field the code branched on, and two places to edit is
 * how those two stop agreeing.
 */
export function armedFatalLines(armed) {
  // Empty in, empty out — never a lone trailing sentence about a set with no
  // members. A caller that splices this into an existing message must be able to
  // pass an empty list and get that message back BYTE FOR BYTE, which is what
  // makes the rescope provable rather than asserted.
  if (!Array.isArray(armed) || armed.length === 0) return [];
  const lines = [];
  for (const a of armed) {
    lines.push(`     🔴 channel "${a.id}" IS ARMED in ${REGISTER}, which is why this is fatal:`);
    for (const r of a.reasons) lines.push(`          ${r}`);
  }
  lines.push('     An armed channel that cannot sign would hand a user an artifact nothing vouches for.');
  return lines;
}
