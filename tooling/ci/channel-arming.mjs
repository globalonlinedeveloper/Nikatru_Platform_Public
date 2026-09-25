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
//   a `subscriptiontracker-v*` tag makes build-platforms.yml's `windows`, `apple` AND
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
// Root Program and renewed yearly; an Apple distribution certificate (the account is active, OWNER_QUEUE A-4 closed 2026-08-31);
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
 * ARMING, PER TOOL — the same rule with the axis the register does not have.
 *
 * 🔴 WHY A SECOND FUNCTION AND NOT A WIDER `armingOf`. A register row answers
 * "can this CHANNEL reach a user"; three signing seams already ask exactly that
 * and must keep getting exactly that answer, so `armingOf` is untouched. What
 * the register cannot answer is "can this channel reach a user WITH THIS TOOL'S
 * PACKAGE", and on the extensions lane that second question is the load-bearing
 * one: `.github/workflows/extensions.yml` derives the tool from the tag
 * `<tool>-v<semver>`, so ONE armed channel serves N tools and each of them has
 * its own permanent, store-issued listing id.
 *
 * ⚠️ MEASURED, 2026-09-07, and it is why this exists. The Chrome item id and the
 * Edge product id were repository-global SECRETS (`CWS_ITEM_ID`,
 * `EDGE_PRODUCT_ID`). A second extension's tag push would have uploaded its zip
 * to the first tool's listing and printed `SUBMITTED — <the other tool>`: a
 * fail-OPEN into the one act this repository treats as irreversible. The
 * identity now lives on `extensions/Extension/<tool>/tool.json`
 * `storeMetadata.stores.<key>.listingId`, and a channel that is armed for a tool
 * with no listing id is NOT armed for that tool. (⏱ 2026-09-25: Firefox's add-on
 * id is the exception — the package declares it, and `listingId` here is the
 * value publish-arming.mjs derived from the tool's own files.)
 *
 * Pure, like everything else here: the caller reads the row and the tool's
 * declared id and hands both over.
 *
 * @param {object} row              the channel-register row
 * @param {object} o
 * @param {string} o.toolId         the tool the release is publishing
 * @param {string} o.identityField  where the id is declared, for the message
 * @param {string|null} o.listingId the tool's declared listing id, or null
 * @returns {object} `armingOf(row)` plus `{ toolId, listingId, identified,
 *          armedForTool }`, with `reasons`/`blockers` extended by the tool limb.
 */
export function armingOfTool(row, { toolId = null, identityField = 'listingId', listingId = null } = {}) {
  const base = armingOf(row);
  const id = typeof listingId === 'string' && listingId.trim() !== '' ? listingId.trim() : null;
  const identified = id !== null;
  const tool = typeof toolId === 'string' && toolId.trim() !== '' ? toolId.trim() : '(unnamed tool)';

  const reasons = [...base.reasons];
  const blockers = [...base.blockers];
  if (identified) {
    reasons.push(`tool "${tool}" declares its own \`${identityField}\` for this store, so the destination is this tool's listing and not another's`);
  } else {
    // ⏱ 2026-09-25 (O-NEW-TOOL-HAS-NO-FIREFOX-IDENTITY): this sentence is about
    // the STORE-ISSUED ids only (the Chrome item id, the Edge product id). An id
    // the package manifest declares — Firefox's `browser_specific_settings.gecko.id`
    // — is derived by extensions/scripts/publish-arming.mjs toolListingId() from
    // the tool's publish/identity.json, and reaches here either set or not at all:
    // an id it cannot derive is refused there, before this function is called.
    blockers.push(
      `tool "${tool}" declares no \`${identityField}\` for this store — a store-issued listing id is issued by the STORE and never by this factory, is not derivable, and is read off that store's own dashboard into the tool manifest — so there is no destination to address`,
    );
  }

  return { ...base, toolId: tool, identityField, listingId: id, identified, armedForTool: base.armed && identified, reasons, blockers };
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
export function unarmedGapLines({ armings = [], secretNames = [], laneReasons = [], ownerItem = null, ownerGated = true } = {}) {
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
    // `ownerGated` defaults TRUE, so every existing caller prints byte for byte
    // what it printed before. The Apple caller passes FALSE, and the reason is a
    // measurement rather than a preference: on 2026-09-08 an authenticated App
    // Store Connect call answered HTTP 200 with an ACCOUNT_HOLDER record, so the
    // enrolment that limb used to name as the blocker is ACTIVE. The blocker is a
    // certificate nobody has issued into it, and the ASC API issues those. A
    // printed line that says OWNER-GATED over work an agent can do is how a
    // closable gap stays open for a month.
    lines.push(`   🔴 THE BLOCKER IS ${ownerGated ? 'OWNER-GATED' : 'CODE-GATED'}: ${ownerItem}`);
    if (ownerGated) {
      lines.push('      No agent can create these secrets, so failing here would block every release of every');
      lines.push('      OTHER channel on work only the owner can do. [pipeline C-6] says PRINT, not fail.');
    } else {
      lines.push('      An agent CAN close this one, so it is not deferred to anybody. It is not closed TODAY,');
      lines.push('      and failing here would block every release of every OTHER channel until it is.');
      lines.push('      [pipeline C-6] says PRINT, not fail; this print is the tripwire, and it is now a to-do.');
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// AVAILABILITY — the SITE's reading of the same register, added 2026-09-09.
//
// 🔴 WHY A THIRD FUNCTION AND NOT A WIDER `armingOf`, stated before the code so
// nobody "simplifies" the two together. `armingOf` answers "would an unsigned
// artifact from this row reach anybody" — a question about a RELEASE, which is
// why its second limb requires a `lane`: with no job emitting the format, a
// release produces nothing to sign badly. A marketing page asks a different
// question: "should this channel appear in the availability row, and in which of
// three states". Those answers genuinely differ, and the difference is not
// cosmetic — on the register as measured 2026-09-09:
//
//   ios-appstore    submittable: true · lane: null  →  UNARMED, but it IS shown
//                                                      as "coming soon", because
//                                                      the row is a declared,
//                                                      owner-gated submission
//                                                      path and saying so is true
//   apps-gov-in     submittable: false · storefrontKey: null
//                                                   →  UNARMED and NOT SHOWN
//
// Collapsing them would either delete five honest "coming soon" tiles or promote
// a channel with no submission path at all into the row. They share this file
// because they share the ONE reading of the register — not because they are the
// same question.
//
// ── THE RULE, IN ONE SENTENCE ────────────────────────────────────────────────
// Render a tile for every register row where `served || submittable` is true AND
// the row declares a non-empty `storefrontKey`; mark it LIVE when the app's
// `listings[storefrontKey]` holds a URL and COMING SOON when that key is present
// but null. A row that is neither served nor submittable does not render at all.
//
// 🔴 `storefrontKey` IS PART OF THE RULE AND NOT AN IMPLEMENTATION DETAIL. It is
// the storefront's name for the channel and the ONLY join between a register row
// and `catalog/apps.json`'s `listings` block (assert-catalog-contract.mjs derives
// the whole listings vocabulary from it). A row with a null `storefrontKey` has
// no listing to be live or pending, so it cannot have a state, so it cannot have
// a tile. `apps-gov-in` is both `submittable: false` AND has a null
// `storefrontKey` today — it fails the rule twice, and becomes the seventh tile
// the day the register gives it both.
//
// ⚠️ THE COUNT IS NEVER TYPED. `shown` and `live` are the lengths of derived
// lists. The trap this closes is real and was found in the design canvas itself:
// its placeholder built tiles by slicing a HAND-ORDERED array and marking the
// first N live, which rendered "App Store" as live when the only live channel is
// `web`. A row order is not a truth, and a count in markup is a lie waiting for
// the register to move.
//
// ⚠️ NOT A SCANNER, exactly like its neighbours: rows and a listings object in,
// verdict out. No filesystem, no environment. "Did my scan still reach the tree"
// belongs to the callers, which read the register and the catalogue themselves.
// ─────────────────────────────────────────────────────────────────────────────

/** The three states a channel tile can be in. A fourth would be a design change. */
export const AVAILABILITY_STATES = Object.freeze(['live', 'soon', 'absent']);

/**
 * Does this register row render an availability tile, and in what state?
 *
 * @param {object} row       a channel-register row
 * @param {object} listings  the app's `listings` block from catalog/apps.json
 * @returns {object} `{ id, name, storefrontKey, renders, state, url, why, lost }`
 *   · `state` is one of AVAILABILITY_STATES; 'absent' means no tile.
 *   · `lost` is non-null when the row SHOULD have a state and the catalogue
 *     cannot give it one — a renderable row whose `storefrontKey` the listings
 *     block does not mention at all. Absent and null are NOT the same answer:
 *     null is "declared, not live yet", absent is "nobody has decided". Raised to
 *     the caller as COVERAGE LOST rather than silently rendered as "coming soon",
 *     which is how a channel nobody has thought about starts advertising itself.
 */
export function availabilityOf(row, listings = {}) {
  const id = typeof row?.id === 'string' && row.id !== '' ? row.id : '(unnamed row)';
  const name = typeof row?.name === 'string' && row.name !== '' ? row.name : id;
  const served = row?.served === true;
  const submittable = row?.submittable === true;
  const key =
    typeof row?.storefrontKey === 'string' && row.storefrontKey.trim() !== '' ? row.storefrontKey.trim() : null;

  const base = { id, name, storefrontKey: key, served, submittable };

  if (!served && !submittable) {
    return {
      ...base,
      renders: false,
      state: 'absent',
      url: null,
      why: `served and submittable are both false in ${REGISTER} — the register declares no way for this channel to reach a user, so the page claims nothing about it`,
      lost: null,
    };
  }
  if (key === null) {
    return {
      ...base,
      renders: false,
      state: 'absent',
      url: null,
      why: `no storefrontKey in ${REGISTER} — there is no key to look up in the app's listings, so this row has no listing to be live or pending`,
      lost: null,
    };
  }

  const declared = listings && typeof listings === 'object' ? listings : {};
  if (!Object.hasOwn(declared, key)) {
    return {
      ...base,
      renders: false,
      state: 'absent',
      url: null,
      why: `the app's listings block does not mention "${key}"`,
      lost:
        `${REGISTER} row "${id}" renders (served or submittable) and declares storefrontKey "${key}", but the app's ` +
        `listings block has no "${key}" key AT ALL. Absent is not null: null says "declared, not live yet" and renders ` +
        `a COMING SOON tile; absent says nobody has decided. Rendering it anyway would advertise a channel on the ` +
        `strength of a missing field.`,
    };
  }

  const raw = declared[key];
  const url = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  return {
    ...base,
    renders: true,
    state: url === null ? 'soon' : 'live',
    url,
    why:
      url === null
        ? `listings["${key}"] is null — a declared channel with nothing published to it yet`
        : `listings["${key}"] holds ${url}`,
    lost: null,
  };
}

/**
 * THE AVAILABILITY ROW for one app: every tile, in register order, plus the two
 * counts the page prints.
 *
 * Register order — not alphabetical and not a hand-written order — because the
 * register is the only file entitled to say which channel comes first, and
 * `assert-catalog-contract.mjs` already derives the listings vocabulary in that
 * same order. One ordering, one file.
 *
 * @returns `{ tiles, shown, live, soon, hidden, lost }`. `shown`/`live` are
 *   lengths, never arguments. `lost` is the list of COVERAGE-LOST messages the
 *   caller must print and refuse on; an empty array is the clean case.
 */
export function availabilityRow(rows, listings = {}) {
  const all = (Array.isArray(rows) ? rows : [rows]).map((r) => availabilityOf(r, listings));
  const tiles = all.filter((a) => a.renders);
  return {
    tiles,
    shown: tiles.length,
    live: tiles.filter((a) => a.state === 'live').length,
    soon: tiles.filter((a) => a.state === 'soon').length,
    hidden: all.filter((a) => !a.renders),
    lost: all.map((a) => a.lost).filter((m) => m !== null),
  };
}
