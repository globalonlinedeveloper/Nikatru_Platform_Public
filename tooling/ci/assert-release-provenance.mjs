#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-release-provenance.mjs — nothing is built for release from an ungated
// commit, and nothing is published without recording what shipped.
//
// [pipeline R-6] "A release is produced only from a commit whose required gate
//                passed, and the mapping published artifact → commit SHA → gate
//                verdict is queryable after the fact."
//
// ── WHY A THIRD GUARD WHEN BOTH MECHANISMS ALREADY EXIST ─────────────────────
// `assert-gate-passed.mjs` and `record-deployment.mjs` are built, VERIFIED and
// live-proven by [pipeline F-5b]. R-6 does not need them rewritten — it needs
// them CALLED on a surface they do not cover. So this guard asserts the CALL
// SITES exist and are correctly ORDERED. Reusing the scripts is deliberate:
// F-5b's live test found an off-by-one in `assert-gate-passed.mjs` that broke
// both deploys, and that fix is covered by `guards.test.mjs` — a second
// implementation would inherit none of it.
//
// ── THE CRITERION R-6 SHIPPED WITH HAD NO DOMAIN ─────────────────────────────
// "The RELEASE LANE's first step resolves ci-gate's conclusion … the PUBLISHED
// RELEASE names that SHA." There is no release lane and no published release, so
// both halves were empty-set true and would stay clean right up to the day
// somebody adds an ungated lane — at which point they are STILL clean, because
// the guard was written to check "the release lane" and the new one is not yet
// declared to be it. So the set is derived from what a lane DOES:
//
//   RELEASE BUILD  a step running `flutter build …` in release mode — which is
//                  Flutter's DEFAULT mode, so `--release` is optional decoration
//   PUBLISH        a step that hands an artifact to something outside the run
//   (NOT `actions/upload-artifact` — [pipeline R-4] established those are 7-day
//    BUILD PROOFS, not user artifacts. Requiring a deployment marker for one
//    would write a deployment that never happened into [10]D-9's ledger, which
//    is worse than recording nothing.)
//
// ⚠️ COMMENTS ARE STRIPPED HERE — the OPPOSITE of assert-channel-claims.mjs, and
// both are right. There, the comment WAS the payload (a Flathub URL a human
// copies). Here the hazard runs the other way: `deploy-web.yml` explains in prose
// why it calls both scripts, on far more lines than it RUNS them on, so a raw
// match would report a lane as gated on the strength of a comment DESCRIBING the
// gate. NO COUNT IS FROZEN INTO THIS SENTENCE ANY MORE, and that is a repair:
// what stood here was "prints 28 … Twenty-three of the twenty-eight are COMMENT
// lines", measured 2026-08-21, and on 2026-08-24 the same command printed a
// different number because a sibling is rewriting that file this round. A
// comment may not carry a check. Re-take the pair instead of trusting a number:
//   grep -cE "assert-gate-passed|record-deployment" .github/workflows/deploy-web.yml
//   grep -cE "run: node tooling/ci/(assert-gate-passed|record-deployment)\.mjs" .github/workflows/deploy-web.yml
// The first has always exceeded the second by a wide margin, and that gap — not
// its width on any given day — is the whole argument. ⏱ 2026-09-25 [ADR 095 §4]:
// deploy-web.yml no longer RUNS assert-gate-passed.mjs (its gate is ci.yml's
// `needs: [ci-gate]` on the call), so the pair now counts record-deployment
// and the prose around it; the gap is the same argument. This
// repo has shipped that exact defect twice — the guard-coverage counter that
// accepted a name in a comment ([pipeline F-10], fixed at dd30feb) and
// `assert-stamp-platforms.mjs:43-48`, whose header records deleting the real
// build step and staying green because the comment above it said the words.
//
// ── ORDER IS THE WHOLE POINT, AND IT CROSSES JOBS ────────────────────────────
// A gate check that runs AFTER the build has verified nothing. But the gate may
// legitimately live in a SEPARATE job that the build job `needs:` — which is the
// cheaper shape when three platform jobs share one verdict. So ordering is
// resolved two ways: same job ⇒ by line; different job ⇒ by walking the `needs`
// graph transitively. A guard that only understood line order would force every
// workflow into one job to satisfy it.
//
// ── limb 4 (added 2026-08-21) AND WHAT IT DELIBERATELY DOES NOT CATCH ────────
// limb 4 asserts that a job invoking a `--submit` verb declares an
// `environment:` AND that the script it invokes performs a run-time read of a
// deployment environment's protection rules. The two names are NOT compared —
// the reasoning, and what that separation does and does not buy, is beside the
// constants below.
//
// IT WAS LATENT, NOT LIVE. Measured on this tree 2026-08-21, before writing it:
// exactly 2 jobs invoke `--submit` — submit-play.yml "submit" and
// submit-snap.yml "submit". Both commands are FOLDED (`run: >` at submit-play.yml:197 and submit-snap.yml:241,
// the `node …` text on the next line), which is why the REPORTED line is the
// `run:` key's and not the command's; both jobs declare
// `environment: store-publish` (submit-play.yml:122 and submit-snap.yml:141); and
// both scripts carry the run-time read. The limb was green
// on its first run and fixed nothing. It is a regression guard, and the honest
// claim for it is that a THIRD submit lane is covered the day it appears, without
// anyone remembering to hand-write a third copy of PG-4.
//
// AND SAY HOW FAR AWAY THAT DAY IS, MEASURED 2026-08-21, because an earlier draft
// of this line said submit-appstore.yml and submit-windows-store.yml "are one job
// away from being one" and that understates it. Each of those two workflows does
// declare a `gate` job and a `dry-run` job, and each dry-run job does call its own
// script (submit-appstore.yml:76,:83 and submit-windows-store.yml:71). But
// BOTH scripts PARSE `--submit` only to refuse it: submit-appstore.mjs:161 and
// submit-windows-store.mjs:136 each print "FAIL --submit is NOT IMPLEMENTED, and
// refusing is the implementation." So each lane is a submitting JOB *and* a real
// `--submit` path away, not one job — and when both arrive, (b) is precisely what
// those two scripts do not have today.
//
// ── CORRECTION 2026-08-21, same day, before merge ────────────────────────────
// The fold sentence above claimed the fold was WHY these commands are visible to
// this guard at all. That was never measured and it is false. What stood here,
// verbatim, was:
//     "which is why they are visible here at all"
// RE-MEASURED by running this file's own SUBMIT_FLAG / SUBMIT_RUNNER /
// SUBMIT_SCRIPT over RAW `job.lines` from parseAllWorkflows — that is, with
// joinBlockScalars deliberately NOT applied — against this tree:
//     RAW      submit-play.yml  submit  line=407  script=tooling/release/submit-play.mjs
//     RAW      submit-snap.yml  submit  line=511  script=tooling/release/submit-snap.mjs
//     LOGICAL  the same 2 jobs, the same 2 scripts, at :406 and :510
//     jobs seen RAW=2 LOGICAL=2
// A raw line-anchored scan finds the SAME two jobs and extracts the SAME two
// script paths, because `--submit`, `node` and the `.mjs` path all sit on ONE
// physical line (:407, :511). The fold moves only the reported line number
// (407→406, 511→510). Using the shared parser is still right — it is the house
// rule, and it is what makes the printed number the `run:` key's — but the
// stronger claim that a hand-rolled line scanner "would have reported this
// domain as empty and printed clean" is measurably wrong and is not to be
// carried forward into anyone's notes.
//
// 🔴 WHAT IT DOES NOT CATCH, AND THIS IS A LIVE GAP, NOT A HYPOTHETICAL.
// limb 4's domain is the `--submit` VERB. It is NOT limb 2's publish set. So it
// says nothing about build-platforms.yml's `release` job, which — measured
// 2026-08-21 — runs `gh release create` at :1292 on a PUBLIC repository, with no
// `--draft` anywhere in the file (`grep -c -- "--draft"
// .github/workflows/build-platforms.yml` prints 0), and declares
// NO `environment:` at all — so NOTHING PAUSES for a human. What the job DOES
// carry is a block-form `needs:` at :1174-1179 listing `gate, prepare,
// linux_web_android, windows, apple`; that `- gate` entry at :1175 is exactly
// why limbs 1 and 2 of this very guard pass on it. The edge proves the COMMIT
// WAS GREEN. It does not prove a PERSON REVIEWED THE RELEASE, and those are
// different claims. The `if: github.ref_type == 'tag'` lines at :1276 and :1307
// are the tag condition on the `gh release create` step and on the
// record-deployment step below it — a trigger filter, not a gate.
//
// SAY WHICH JOB, AND SAY IT WITH THE DOMAIN — an earlier draft of this paragraph
// ended "that is the one job here that publishes to the open internet", which is
// an unscoped absolute and is false: so do the three Cloudflare lanes. MEASURED
// 2026-08-21 by printing limb 2's own classification over this tree, limb 2
// counts FOUR publish jobs —
//     build-platforms.yml  "release"     a GitHub Release publish
//     deploy-web.yml       "deploy-web"  a Cloudflare deploy action
//     deploy-workers.yml   "subscriptiontracker-api"   a Cloudflare deploy action
//     deploy-workers.yml   "platform"    a Cloudflare deploy action
// — and `release` is the only one of the four that hands over a DOWNLOADABLE,
// IMMUTABLE artifact. The other three replace a running service, and replacing
// it again is the rollback; a Release asset a third party has already fetched
// has no rollback. That is the distinction the gap is about, and this limb steps
// around it.
//
// ── RE-TAKEN 2026-08-24, because a reviewer reported this paragraph FALSE ────
// It is not. Every offset and every count above was re-measured against the tree
// that day and all of them reproduce: `gh release create` at :1292, inside the
// `release` job (:1161, the LAST job in the file, which runs to :1316);
// `grep -c -- "--draft"` prints 0; the ONLY `environment:` anywhere in that file
// is :1191 and it is inside a comment, so the job declares none; the block-form
// `needs:` is at :1174 with `- gate` at :1175 and the list ending at :1179; and
// `grep -n "ref_type == 'tag'"` prints exactly :1276 and :1307. The four-row
// publish census reproduces too, job for job, printed from limb 2's own
// classification on a scratch copy. The one number worth reading carefully is
// :1292 vs the :1281 the guard REPORTS for that publish — both are right and
// they are different things: :1292 is the raw line carrying the command, :1281
// is the `run:` key whose block scalar the shared parser joins, which is the
// line this guard prints by design.
//
// ── CORRECTION 2026-08-21, same day, before merge ────────────────────────────
// The paragraph above replaced one that UNDERSTATED the protection that exists
// and therefore OVERSTATED the gap it was recording — in a file whose entire
// discipline is "assert on the thing, not the note about it". What stood here,
// verbatim, was:
//     "and declares NO `environment:` at all; its
//      only gate is a step-level `if: github.ref_type == 'tag'`."
// Opened and read this session: build-platforms.yml:351-356 is the `needs:`
// block, :352 is `- gate`, and the job's only job-level keys are `name`,
// `runs-on`, `timeout-minutes`, `needs`, `permissions`, `strategy`, `steps` —
// no `environment:` among them. The missing approval PAUSE is real and is the
// gap; "its only gate" was not.
//
// The scope stops there on purpose and the reason has to survive being read
// aloud: an approval PAUSE is the right demand where the act is irreversible AND
// no human act already stands in front of it. A store upload is both — dispatch
// is a button any collaborator can press, and Play binds the upload certificate
// permanently at the first upload. A Cloudflare deploy is neither: deploy-web
// and deploy-workers ship on every push to main by design, and demanding an
// approval there would be a false red on every merge. `gh release create` sits
// between them — a tag push is a privileged human act, but it is not a REVIEWED
// one, and a public release is fetched by third parties long before it can be
// deleted. THAT IS A JUDGEMENT THIS FILE IS NOT ENTITLED TO MAKE SILENTLY: it is
// recorded here as an open question, not settled by the scope line above, and
// the fix — if the answer is yes — is a line in build-platforms.yml, not a
// widening here.
//
// ── CORRECTION 2026-08-21, same day, before merge — THREE STALE CITATIONS ────
// Three cross-file line citations in this header had stopped resolving to what
// they name. Each was OPENED this session and replaced with a re-measured
// command whose output can be re-taken, not with a new line number. Preserved so
// a grep for the superseded text still lands here:
//   · "`deploy-web.yml` explains in prose why it calls both scripts
//      (`:46-49`, `:121-122`)" — :46-49 is the `paths:` filter rationale and
//      :121-122 is the rollback note; neither names either script. The count
//      above now stands in its place, because the count is what the sentence is
//      actually about.
//      🔴 AND THE REPLACEMENT ITSELF CARRIED A CITATION THAT DID NOT RESOLVE.
//      This line read "The prose that does is at :57-61 and :267-275" until
//      2026-08-24. RE-MEASURED that day: :57-61 does name both scripts, but
//      :267-275 is the `zizmor` least-privilege rationale and names NEITHER —
//      the lines that do had already moved to :278-279. Two sentences above,
//      this same block promises "a re-measured command … not a new line
//      number", and then supplied two new line numbers. So the offsets go and
//      the command stands in their place:
//        grep -nE "checks: read. for assert-gate-passed" .github/workflows/deploy-web.yml
//      printed 2 lines on 2026-08-24. deploy-web.yml is being rewritten by a
//      sibling this round, which is exactly why this is a command.
//      ⏱ 2026-09-25: it prints 0 — the lane holds no checks: read and no gate
//      step any more; ci.yml's call job needs ci-gate instead [ADR 095 §4].
//   · "`assert-stamp-platforms.mjs:37-42`" — :37-38 is that file's
//      `PLATFORM_DIRS` constant. The comment recording the green-on-a-comment
//      mutation is :41-46. Repointed.
//   · "`npx wrangler deploy --dry-run` at :55, :434 and :634" — ci.yml is 2428
//      lines today and those three offsets are stale; the three command lines
//      are :63, :1731 and :2225. The COUNT of three, which is what the paragraph
//      argues from, did reproduce.
// No code changed for any of the three.
//
// ── limb 2b (added 2026-09-25) A SANDBOX DEPLOY IS EXCUSED FROM THE LEDGER ───
// ── ONLY, NEVER FROM THE GATE ────────────────────────────────────────────────
// deploy-sandbox.yml deploys the two sandbox Workers the store captures write
// to, and brief Ruling 5 forbids it to call `record-deployment.mjs`: the release
// ledger is the PRODUCTION record, and a sandbox row in it would say production
// shipped a commit it never ran. Parent ruling CAPSAND-5 item 1 therefore excuses
// a publishing job from limb 2's marker requirement when, and only when, EVERY
// publish in it is a `cloudflare/wrangler-action` whose `command:` carries
// `--env <name>`, and `env.<name>` of the config in that step's
// `workingDirectory` declares MONEY_ENVIRONMENT "sandbox" and passes
// `sandboxEnvironmentFindings()` — the predicate assert-money-config.mjs limb 1c
// fails the build on, imported from wrangler-environments.mjs rather than
// restated here. What it does NOT excuse: the gate. The job still needs
// `assert-gate-passed.mjs` before its first publish, on limb 2's own order rule;
// a sandbox deploy of an ungated SHA is still wrong. Any other publish in the
// job (a shell `wrangler deploy`, a release upload, a default-command action,
// a `--config` override, an `--env` spelled as an expression) withdraws the
// excuse for the whole job, and the FAIL line names which one did.
//
// Usage:  node tooling/ci/assert-release-provenance.mjs [repoRoot]
// Exit 0 = every release build is gated and every publish is recorded.
// Exit 1 = a finding. 2 = COVERAGE LOST (EXIT 1 in the dated measurements below, before 2026-09-16).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
// limb 4 reads a release SCRIPT's source, not a workflow's, and the hazard the
// header already names for YAML runs the same way in .mjs. MEASURED 2026-08-21,
// replacing an unmeasured "~30 lines of comment" that stood here: submit-play.mjs
// names `protection_rules` or `/environments/` on 6 lines, and only 3 of them
// survive `stripSourceComments` — the other 3 are PROSE ABOUT the read. Half the
// evidence in that file is a description of the check, so a raw match would
// credit a script that only DESCRIBES it. THE ONE shared stripper.
import { stripSourceComments } from './text-reductions.mjs';
// 🔴 THE WORKFLOW PARSE MOVED OUT OF THIS FILE ON 2026-08-03, unchanged, because
// four guards now need it and four copies of a parser drift in the one way that
// reports "clean": which lines it can see at all. Every recorded defect this
// parser absorbed — the `run: >` fold, the ` ; ` join for `run: |`, all three
// `needs:` forms with their quotes, comments BLANKED so line numbers survive —
// travelled with it and is recorded in workflow-scan.mjs's header. This guard's
// own semantics (the gate walk, the publish classification, the per-segment
// dry-run rule) stayed here: they are R-6's, not everybody's.
// ⏱ 2026-09-24 (O-GUARDS-DO-NOT-FOLLOW-LOCAL-USES) — read through the RESOLVED
// view: a publish, a gate call or a record moved behind `uses: ./.github/actions/<x>`
// or into a `uses: ./.github/workflows/<f>.yml` callee is graded where it runs,
// and a finding on such a line prints its real `<file>:<line>` via lineAt/placeOf.
// ⏱ 2026-09-25 (pd2c) — the publish classification and the per-segment dry-run
// rule followed the parser out, AS THEY WERE: assert-workflow-hardening limb 10
// grades the same publish set. The gate walk stays here.
import { parseResolvedWorkflows, lineAt, placeOf, refusalText, storePublishSteps, laneRunHost, laneRefusalText, shellSegments, classifyPublishes, flutterReleaseBuilds } from './workflow-scan.mjs';
// limb 2b. The repo's one JSONC reader, and the one sandbox predicate.
import { parseJsonc } from './d1-sql-inventory.mjs';
import { isObject, sandboxEnvironmentFindings } from './wrangler-environments.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const WORKFLOWS = '.github/workflows';
const REGISTER = 'tooling/channel-register.json';
const GATE_SCRIPT = 'tooling/ci/assert-gate-passed.mjs';
const MARKER_SCRIPT = 'tooling/ci/record-deployment.mjs';

const problems = [];
const ok = (m) => console.log(`ok   ${m}`);
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-release-provenance: FAILED');
  // ⏱ 2026-09-16 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

/**
 * 🔴 RELEASE IS FLUTTER'S DEFAULT BUILD MODE — triage 2026-07-31 (mutation-
 * proven): the first version demanded the literal `--release`, so an ungated
 * `flutter build appbundle` job — written without the redundant flag, as the
 * very next Play lane will be — was an INVISIBLE release build; the
 * releaseJobs floor stayed satisfied by build-platforms.yml and nothing
 * tripped. The verb is still required — `flutter test --release` is not a
 * release build — but the flag no longer is: a `flutter build <target>`
 * command counts unless its own segment says `--debug` or `--profile`, the
 * only two spellings that make a Flutter build non-release. (`web-server` is
 * a dev-server target, not a shippable artifact.)
 * ⏱ CHANGED 2026-09-25 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 2 of 3): that
 * rule is now workflow-scan's census, read through its release view
 * (flutterReleaseBuilds: mode `release` or `default`), one entry per job
 * LINE. It was `/flutter\s+build\s+(?!web-server\b)\S+/` without
 * `/--debug\b|--profile\b/` per segment here, which a release build made
 * through tooling/ci/flutter-release-build.mjs never matched, so its job was
 * no release lane and its gate was never asked for.
 */

// PUBLISH (what hands an artifact to something outside the run), DRY_RUN (the
// per-segment dry-run exclusion) and classifyPublishes, which applies both, live
// in workflow-scan.mjs. ⏱ MOVED 2026-09-25 (pd2c, O-DEPLOY-IS-NOT-ONE-GATED-LANE
// limb 2), AS IT WAS, with every comment that explained them: a second guard,
// assert-workflow-hardening limb 10, grades the same publish set, and this file
// runs on import so it cannot be imported. This file imports classifyPublishes
// and shellSegments; the local shellSegments that stood here was byte-identical
// to workflow-scan's export.

/** A job-level `if:` containing either of these runs the job even when a job it
 *  `needs` has FAILED — which is precisely what disarms a `needs: gate` edge. */
const NEUTRALIZING_IF = /\balways\s*\(|\bfailure\s*\(/;

// ─────────────────────────────────────────────────────────────────────────────
// limb 4 — A `--submit` VERB IS TWO MECHANISMS, AND THE YAML HALF FAILS OPEN.
//
// A store upload is the one act in this repository that cannot be taken back:
// Play binds the upload certificate at the first upload and Snap auto-updates
// silently. [ADR 031:117-124] makes it owner-only per instance and names the
// enforcement — "a GitHub environment with a required reviewer".
//
// 🔴 `environment:` ON ITS OWN FAILS OPEN, and that is not a worry, it is
// documented GitHub behaviour quoted verbatim at docs/ci/submit-play.md:41-44:
// "Running a workflow that references an environment that does not exist will
// create an environment with the referenced name" — with no protection rules,
// and the run history then shows a deployment that reads exactly like an
// approval. So a limb that asserted only the presence of the key would assert
// the half that fails open, and would report clean on a lane with no gate.
// Hence TWO assertions per submitting job:
//   (a) the job declares a job-level `environment:` — the only thing that makes
//       GitHub pause and record who approved, WHEN the environment is protected;
//   (b) the script it invokes with `--submit` performs a RUN-TIME read of a
//       deployment environment's `protection_rules` — what makes (a)'s absence
//       loud instead of invisible.
//
// 🔴 WHAT (a) AND (b) DO NOT ASSERT, RECORDED 2026-08-21 SO NO MESSAGE IMPLIES
// IT. The two are checked SEPARATELY and their environment NAMES are never
// compared. Probed against a fixture tree with this guard as it stands:
// `environment: totally-unprotected-other-env` in the YAML beside a script that
// reads `store-publish` PASSES limb 4 clean, and `environment:` with its value
// deleted — the key alone, which is also the block form's opening line —
// satisfies (a). The names are not compared on purpose: the script resolves its
// environment at run time from its own constant, and demanding a literal match
// would false-red the first lane that computes the name instead of typing it.
// This is why the ok() line at the foot of this file says "performs a run-time
// protection-rules read" and NOT "reads THAT environment's protection rules" —
// the second is a link the code does not make. It used to say the second.
//
// ── WHY THIS IS NOT A FIFTH COPY OF PG-4 ─────────────────────────────────────
// submit-play.mjs:375 and submit-snap.mjs:408 each already refuse a job that
// runs `--submit` without `environment:`. MEASURED 2026-08-21: that check exists
// in 2 of the 4 scripts under tooling/release/ that carry a submit path —
// `grep -rlE 'PUBLISH_ENVIRONMENT|protection_rules|/environments/' tooling/release/`
// (`-E`, because with a plain `grep` those `|` are literal and the command prints
// nothing) names submit-play.mjs and submit-snap.mjs and NOTHING else, while
// `grep -rl -- --submit tooling/release/*.mjs` names four files. It is also SUBMIT-TIME ONLY: running
// `submit-play.mjs --dry-run --app subscriptiontracker --allow-missing-artifact` this session
// EXITED 0 and printed no `PG-` line at all, so the check ci.yml runs on every
// push is not the check that reads the YAML. This limb is the CI-time, lane-
// generic half: the day submit-appstore.yml or submit-windows-store.yml grows a
// `--submit` job, it is covered here without anyone remembering to hand-write a
// third PG-4 — and (b) is precisely the thing those two scripts do not have.
//
// A `node … --submit` invocation, matched per shell segment. The flag and the
// script path are found SEPARATELY on purpose: `node --experimental-x s.mjs
// --submit` puts a flag where a path-first pattern expects the path, and a
// pattern that then matched nothing would drop a submitting job out of the
// domain silently — the failure mode this whole file is written against. If the
// verb is present and the script cannot be named, that is COVERAGE LOST below,
// not a pass.
const SUBMIT_FLAG = /(?:^|\s)--submit(?=\s|$)/;
// 🔴 THE DASH MULTIPLICITY OF `--` IS A CONDITION, AND "IT CAN ONLY MATCH MORE"
// IS NOT A REASON TO LEAVE IT FREE — MEASURED 2026-08-24, which is why it is
// pinned rather than declared. `-{2,}submit` IS a strict superset of `--submit`
// in the matching sense, and the verdict is still not monotone in it: on a tree
// carrying a `---submit` lane that declares no `environment:`, the shipped guard
// EXITS 0 and the widened one EXITS 1, inventing an (a)-half FAIL on a workflow
// that submits nothing. A matcher that only ever matches MORE still flips an
// exit code wherever what it feeds decides a FAIL. Held by 'a `---submit`
// argument is not the verb — the DASH COUNT in SUBMIT_FLAG'. The NARROWING
// direction is a different atom and was already red: `-submit`, one dash, takes
// the domain to zero and the floor speaks (measured: EXIT 1).
// 🔴 A REGEX IS NOT ONE CONDITION, AND TWO ROUNDS OF SWEEPING THIS FILE READ IT
// AS ONE. Every boundary, alternative, class and quantifier below is its own
// condition and has its OWN case in release-provenance.test.mjs; the earlier
// rows "the word boundaries" and "the `node` prefix" each covered a pair, and a
// pair only ever fails together. Named here so the next sweep cannot re-merge
// them:
//   SUBMIT_RUNNER  leading  `\b` → 'a left-attached `xnode` is not `node`'
//   SUBMIT_RUNNER  trailing `\b` → '`nodemon` is not `node`'
//   SUBMIT_SCRIPT  leading  `\b` → 'a decoy `.mjs` attached to an `xnode`'
//   SUBMIT_SCRIPT  `node`'s `\b` → 'a decoy `.mjs` attached to a `nodemon`'
//   SUBMIT_SCRIPT  `\S+`         → 'a bare `.mjs` is not a script path'
//   SUBMIT_SCRIPT  trailing `\b` → 'a `.mjsx` path is not a `.mjs` script'
//   SUBMIT_SCRIPT  `\.` escape   → 'a dotless `...mjs` argument before the script'
//   SUBMIT_SCRIPT  `*` zero-arm  → 'a script name that begins where `node` ends'
//   SUBMIT_SCRIPT  `\S+`'s GREED → 'a `.mjs.mjs` path is the WHOLE token'
//   SUBMIT_SCRIPT  the `s` of mjs → 'a decoy `.mjx` before the script'
//   SUBMIT_FLAG  the prefix GROUP → 'a `--submit` GLUED to the end of another token'
//   SUBMIT_FLAG  the WORD submit  → '`--submitted` is not `--submit`'
// THE THIRD PASS, 2026-08-24, added the last five, and ALL FIVE WERE GREEN
// WITH 103 CASES PASSING. Naming a construct is not naming its members
// either, and the fifth level down is where they were hiding: one escaped
// character inside a literal (`\.`), one character of a literal (the `s` of
// `mjs`), the ZERO-WIDTH arm of a quantifier as distinct from its laziness,
// the GREED of `\S+` as distinct from its `+`, and the EXISTENCE of the
// prefix group as distinct from its two alternatives. The rule that finds
// them is mechanical: mutate one character of the pattern at a time, never
// one named construct at a time.
const SUBMIT_RUNNER = /\bnode\b/;
// 🔴 `[^\n]*?` STOOD BETWEEN `\bnode\b` AND THE CAPTURE UNTIL 2026-08-24 AND WAS
// DELETED RATHER THAN PINNED, because it is a restriction that can never bite.
// What this pattern is handed is a shell SEGMENT of a LOGICAL line, and
// workflow-scan.mjs builds logical lines by `parts.join(' ')` / `parts.join(' ; ')`
// over lines that were themselves produced by splitting the file on `\r?\n` — so
// no logical line, hence no segment, can carry a newline. Swapped for `[\s\S]`
// the suite stayed green in every case, which is the measurement, and the reason
// is the proof: the two classes are the same set on every input reachable here.
// A narrowing that cannot narrow is the same defect as an assertion that cannot
// fail — it makes the pattern look guarded against something it never meets.
const SUBMIT_SCRIPT = /\bnode\b[\s\S]*?(\S+\.mjs)\b/;
// 🔴 THIS PATTERN'S CASE-SENSITIVITY IS A CONDITION TOO, and it was carried as a
// "pure widening" until it was MEASURED on 2026-08-24. Adding `i` matches a
// strict superset of strings and still flips an exit code, because the capture
// is LAZY: an uppercase `.MJS` argument sitting between `node` and the real
// script wins the race under `i` and loses it without, so the guard reads a file
// that is not in the tree. Measured on one such tree: shipped EXIT 0 (the real
// script is opened and passes), `/i` EXIT 1 (COVERAGE LOST). Held by 'an
// uppercase `.MJS` argument is not the script — SUBMIT_SCRIPT is CASE-SENSITIVE'.
/** The run-time half, read out of the invoked script with comments stripped:
 *  it must BUILD the environments API URL and READ the protection rules. Both,
 *  because a script that fetches the environment and never looks at its rules
 *  has confirmed only that the environment exists — which is the state
 *  docs/ci/submit-play.md:51-55 records measuring on this very repo, where all
 *  three auto-created environments returned `"protection_rules": []`.
 *
 *  🔴 THE TWO SLASHES ARE TWO CONDITIONS AND ARE NOW HELD SEPARATELY. Dropping
 *  either one ALONE left every case green while dropping the pair did not —
 *  which is exactly how one table row hid two. The LEADING slash is held by
 *  'a bare `environments/` with no leading slash is not the API path'; the
 *  TRAILING one by 'the environments LIST endpoint is not one environment's
 *  rules', and that half is the materially live one:
 *  `GET /repos/{owner}/{repo}/environments` enumerates WHICH environments
 *  exist and never reads any one's protection_rules, so crediting it would
 *  credit precisely the confirmation this docstring says is not enough.
 *
 *  THE WORD BETWEEN THE SLASHES IS A THIRD MEMBER and was green until
 *  2026-08-24: widened to `/\/environment\w*\//` all 103 cases still
 *  passed, because every fixture spelled the path correctly. The route is
 *  `/repos/{owner}/{repo}/environments/{name}`, so a singular
 *  `/environment/` GET fetches a 404 with no `protection_rules` in it and
 *  would still buy the credit. Held by 'the SINGULAR `/environment/` path
 *  is not the environments API'. */
const ENV_API_READ = /\/environments\//;
// 🔴 AND THE CASE OF THOSE LETTERS IS A CONDITION — MEASURED 2026-08-24, and it
// is the DANGEROUS direction, not the loud one. Adding `i` matches strictly
// more, and what it matches more of is scripts that DO NOT PERFORM THE READ: the
// REST route is lower-case, so a script spelling `/ENVIRONMENTS/{name}` GETs a
// 404 with no `protection_rules` in it and would be credited anyway. Measured on
// such a script: shipped EXIT 1 (the (b) FAIL speaks), `/i` EXIT 0 — a silent
// credit, which is the one outcome this file's header forbids. "It can only
// match MORE" is therefore not a reason to leave it free here; matching more is
// exactly how this half goes blind. Held by 'an UPPER-CASE `/ENVIRONMENTS/` is
// not the API route'.
// `protection_rules`, and the `_rules` half is a condition of its own: widened
// to /protection/ the whole suite stayed green on 2026-08-24, because every
// fixture that carried the word carried the whole token. That widening is not
// inert — it credits a script that GETs the right endpoint and then reads some
// OTHER `protection` field off it. Held by 'a `protection` field that is not
// `protection_rules` is not the rules read'.
// THE OTHER HALF IS ALSO A CONDITION and was green until 2026-08-24:
// narrowed to /_rules/ all 103 cases still passed. A deployment-branch
// policy read is `_rules` off the right endpoint and says nothing about
// approval, so it would buy the credit for an unreviewed lane. Held by
// 'a `_rules` field that is not `protection_rules` is not the rules read'.
// SO ARE THE OTHER TWO MEMBERS OF THIS TOKEN, both green until 2026-08-24
// with 109/111 cases passing: the UNDERSCORE (`protection.rules` matches a
// script that merely says the two words in a runtime message, `.` being a
// space) and the WORD `rules` (`protection_rule\w*` credits a read of the
// singular `deployment_protection_rule`, a different GitHub object). Held
// by 'the words `protection rules` in a message are not the
// `protection_rules` field' and 'a SINGULAR `deployment_protection_rule` id
// is not the `protection_rules` array'.
const ENV_PROTECTION_READ = /protection_rules/;

/** ⏱ 2026-09-24 (EXT-3) — THE SHARED READ. The three extension publishers do not
 *  inline the environment read; they call `requireStorePublishEnvironment()` from
 *  this helper, which performs it. A script is credited with the run-time half
 *  when its own code performs the read OR calls the helper and the helper's code
 *  performs it — the helper is graded by the same two patterns, so deleting the
 *  read from it un-credits every caller at once. The CALL is the condition, not
 *  the import: an imported helper nobody calls reads nothing. */
const STORE_ENV_HELPER = 'extensions/scripts/lib/store-environment.mjs';
const STORE_ENV_CALL = /\brequireStorePublishEnvironment\(/;
const STORE_ENV_FN = 'requireStorePublishEnvironment';
const performsRead = (code) => ENV_API_READ.test(code) && ENV_PROTECTION_READ.test(code);

/** ⏱ 2026-09-25 (C4b, O-SUBMIT-SCRIPTS-SHARE-NO-MODULE) — THE ONE READ, AND THE
 *  MOVE THAT WOULD OTHERWISE HAVE TURNED THIS LIMB RED. submit-play, submit-snap
 *  and submit-windows-store no longer inline the environment read: each imports
 *  `requirePublishEnvironment` from COMMON_READER and calls it. MEASURED on that
 *  tree with this file as it stood (the rule "the read is in the invoked
 *  script's OWN source"): EXIT 1, all three scripts named. So the credit is
 *  widened, generalising the helper acceptance above, and it takes BOTH halves:
 *    · an `import { … }` naming the function, NOT renamed, from a relative
 *      specifier that RESOLVES to COMMON_READER from the importing file — a
 *      same-named file anywhere else is not this module;
 *    · a CALL of it — an import nobody calls reads nothing, and a call with no
 *      such import calls whatever else carries the name.
 *  COMMON_READER is graded by the same two patterns, so deleting the read from
 *  it un-credits every caller at once. */
const COMMON_READER = 'tooling/release/submit-common.mjs';
const COMMON_FN = 'requirePublishEnvironment';
const COMMON_CALL = /\brequirePublishEnvironment\(/;
/** The `{ … }` bindings that every `<keyword> { … } from '<spec>'` statement in
 *  `code` takes from `target`, as [imported, local] pairs. `rel` is the file
 *  `code` came from, so a relative specifier is resolved as Node resolves it. */
function bindingsFrom(code, rel, keyword, target) {
  const pairs = [];
  const statement = new RegExp(`\\b${keyword}\\s*\\{([^}]*)\\}\\s*from\\s*(['"])([^'"]+)\\2`, 'g');
  for (const m of code.matchAll(statement)) {
    if (!m[3].startsWith('.')) continue;
    if (posix.normalize(posix.join(posix.dirname(rel), m[3])) !== target) continue;
    for (const item of m[1].split(',')) {
      const [imported, local = imported] = item.trim().split(/\s+as\s+/);
      if (imported !== '') pairs.push([imported, local]);
    }
  }
  return pairs;
}
const commonPerformsRead = (() => {
  const src = read(COMMON_READER);
  return src !== null && performsRead(stripSourceComments(src, '.mjs'));
})();
const callsCommonRead = (code, rel) =>
  COMMON_CALL.test(code) && bindingsFrom(code, rel, 'import', COMMON_READER).some(([imported, local]) => imported === COMMON_FN && local === COMMON_FN);
/** STORE_ENV_HELPER is credited when its own code performs the read (EXT-3's
 *  shape) OR — C4b, 2026-09-25, its shape since — when it re-exports COMMON_FN
 *  from COMMON_READER under the one name its callers call, STORE_ENV_FN, and
 *  that module performs the read. MEASURED: with only the first arm, the
 *  re-exporting helper exits 1 naming all three extension publishers. A
 *  re-export under any other name leaves STORE_ENV_FN to whatever else defines
 *  it, so it earns nothing. */
const helperPerformsRead = (() => {
  const src = read(STORE_ENV_HELPER);
  if (src === null) return false;
  const code = stripSourceComments(src, '.mjs');
  const reExportsCommonRead = bindingsFrom(code, STORE_ENV_HELPER, 'export', COMMON_READER).some(
    ([exported, as]) => exported === COMMON_FN && as === STORE_ENV_FN,
  );
  return performsRead(code) || (reExportsCommonRead && commonPerformsRead);
})();
const readsEnvironmentAtRunTime = (code, rel) =>
  performsRead(code) || (callsCommonRead(code, rel) && commonPerformsRead) || (STORE_ENV_CALL.test(code) && helperPerformsRead);
// 🔴 SAME FINDING ON THIS TOKEN, MEASURED 2026-08-24: its CASE is a condition and
// the widening is the blind kind. `protection_rules` is the JSON key GitHub
// returns; a script reading `PROTECTION_RULES` off that response reads
// `undefined` and has performed no check at all. With `/i` it is credited:
// measured, shipped EXIT 1 and `/i` EXIT 0 on a script that GETs the right
// endpoint and then reads the wrong-case key. Held by 'a wrong-CASE
// `PROTECTION_RULES` reads undefined and is not the rules read'.

// ── the two mechanisms must still exist ──────────────────────────────────────
// Asserting call sites to a script that has been deleted proves nothing.
for (const s of [GATE_SCRIPT, MARKER_SCRIPT]) {
  if (!existsSync(join(ROOT, s))) {
    coverageLost([
      `${s} does not exist.`,
      'Every assertion below is about workflows CALLING it. With the script gone, a workflow that still',
      'names it would pass this guard while failing at runtime — a green check over a broken lane.',
    ]);
  }
}

// ── which job IS the gate? derived, never duplicated ─────────────────────────
// `assert-gate-passed.mjs` polls a check run BY NAME, and that name is declared
// exactly once — in that script. Reading it here instead of writing 'ci-gate'
// a second time is [pipeline F-2]'s single-declaration rule: a private copy of
// the name would make this guard the first thing to drift when it changes.
const gateCheckMatch = read(GATE_SCRIPT).match(/const GATE = '([^']+)'/);
if (!gateCheckMatch) {
  coverageLost([
    `${GATE_SCRIPT} no longer declares \`const GATE = '…'\`, so this guard cannot tell which job IS the gate.`,
    'The gate-constituent credit below would silently stop applying and flag the gate workflow\'s own',
    'compile-proof builds — a false red on the one workflow every deploy lane depends on.',
  ]);
}
const GATE_CHECK = gateCheckMatch[1];

// ── parse ────────────────────────────────────────────────────────────────────
const wfDir = join(ROOT, WORKFLOWS);
if (!existsSync(wfDir)) coverageLost([`${WORKFLOWS} does not exist.`]);
const wfFiles = listDir(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
if (wfFiles.length === 0) coverageLost([`${WORKFLOWS} contains no workflow files.`]);

/**
 * The parse itself lives in tooling/ci/workflow-scan.mjs — see the import note
 * at the top of this file. What stays here is what to DO with the parse.
 */
// 🔴 NO `.filter(Boolean)` HERE, AND ITS REMOVAL IS THE POINT — mutation sweep
// 2026-08-22. It stood here and NO mutation could turn it red: `parseWorkflow`
// returns null on exactly one condition, `!existsSync(abs)`, and every path in
// `wfFiles` came from `listDir` on that same directory microseconds earlier. So
// it was an unfalsifiable filter whose only reachable effect would be to DROP a
// workflow this guard could not parse and carry on — silence reported as
// success, which is the one outcome this file's header forbids. Without it an
// unparseable workflow is a loud crash on the next line instead.
// ⏱ 2026-09-24 — the parse is now parseResolvedWorkflows, and the same rule
// holds in two checks: a local reference it could not follow is COVERAGE LOST
// here, and every file listed above must be one it READ (a workflow_call-only
// callee is read, then graded as its callers' `<caller>/<job>` children).
const resolved = parseResolvedWorkflows(ROOT);
if (resolved.refusal !== null) {
  coverageLost([
    refusalText(resolved.refusal),
    'A publish or gate call behind that reference would be graded as absent, and absent reads as clean.',
  ]);
}
const unread = wfFiles.filter((f) => !resolved.filesRead.includes(`${WORKFLOWS}/${f}`));
if (unread.length > 0) coverageLost([`the resolved parse never read ${unread.join(', ')}.`]);
const workflows = resolved.workflows;

// ── coverage self-check on the stripper ──────────────────────────────────────
// A stripper that ate the file makes every "does this call X" question below run
// against an empty string and answer "no" — or, worse, makes the RELEASE BUILD
// set empty so nothing is checked at all and it reports clean.
for (const wf of workflows) {
  if (wf.rawStepCount > 0 && wf.strippedStepCount === 0) {
    coverageLost([
      `${wf.rel} has ${wf.rawStepCount} step(s) and NONE survived comment stripping.`,
      'Every question below would then be asked of an empty file and answered "nothing to check".',
    ]);
  }
}
const totalJobs = workflows.reduce((n, wf) => n + wf.jobs.size, 0);
if (totalJobs === 0) {
  coverageLost([`parsed ${workflows.length} workflow file(s) and found ZERO jobs. The job parser has stopped reaching the files.`]);
}

// ── classify every job ───────────────────────────────────────────────────────
const has = (job, re) => job.logical.find((l) => re.test(l.text));

// classifyPublishes(job), the publish set for one job, is imported from
// workflow-scan.mjs (⏱ MOVED 2026-09-25, AS IT WAS; see above RELEASE_BUILD_CMD).

for (const wf of workflows) {
  const releaseLines = new Map();
  for (const b of flutterReleaseBuilds(ROOT, [wf])) {
    if (!releaseLines.has(b.job)) releaseLines.set(b.job, new Set());
    releaseLines.get(b.job).add(b.runLine);
  }
  for (const job of wf.jobs.values()) {
    const lines = releaseLines.get(job.name) ?? new Set();
    job.releaseBuilds = job.logical.filter((l) => lines.has(l.n));
    job.gateCall = has(job, /node\s+tooling\/ci\/assert-gate-passed\.mjs/);
    job.markerCall = has(job, /node\s+tooling\/ci\/record-deployment\.mjs/);
    job.publishes = classifyPublishes(job);
    // limb 4's domain. `script` is null when the verb is there and no `.mjs`
    // path can be read off the segment — carried through so the floor below can
    // go COVERAGE LOST on it rather than treating an unreadable call as absent.
    job.submitCalls = [];
    for (const l of job.logical) {
      for (const seg of shellSegments(l.text)) {
        // 🔴 ALL THREE RECEIVERS BELOW ARE `seg`, NOT `l.text`, AND EACH IS A
        // CONDITION OF ITS OWN. Two were pinned and the third was not
        // enumerated at all until 2026-08-24: swapping SUBMIT_RUNNER's receiver
        // to `l.text` left the whole 114-case suite green and still flipped a
        // verdict — on a line whose first segment runs `node` and does not
        // submit while its second submits with no runner, the shipped guard
        // exits 0 and the swap exits 1 with COVERAGE LOST, naming a lane that
        // invokes no `node … --submit` at all. The verb and the runner must be
        // in the SAME segment, which is the same per-segment rule the dry-run
        // exclusion pays for. Held by 'the `node` runner must be on the
        // SUBMITTING segment, not merely on the line'; the other two by
        // 'a `--submit` that OPENS a shell segment' and 'the script is read
        // from the SUBMITTING segment, not from another one on the line'.
        if (!SUBMIT_FLAG.test(seg) || !SUBMIT_RUNNER.test(seg)) continue;
        job.submitCalls.push({ n: l.n, script: seg.match(SUBMIT_SCRIPT)?.[1] ?? null });
      }
    }
  }
}

/**
 * Does this job, or any job it transitively needs, run the gate check — and is
 * the credit REAL? Triage 2026-07-31 (mutation-proven): a `needs: gate` edge
 * proves nothing once GitHub's own semantics have disarmed it. A job-level
 * `if: always()` (or `failure()`) on the building/publishing job — or on any
 * intermediate job on the walked path — runs it even when the needed gate
 * FAILED; `continue-on-error: true` in the gate job swallows a red
 * assert-gate-passed verdict before `needs` can see it. Both idioms already
 * live in this tree (build-platforms.yml's `all_platforms`, ci.yml's
 * aggregator), so "nobody would write that" is not a defense. A gate call in
 * the SAME job still counts on step order alone — a job's own `if:` cannot
 * reorder its steps. Ordinary conditions (`if: github.ref == …`) are left
 * alone; only always()/failure() disarm an edge.
 *
 * Returns { clean, refused }: `clean` is a gate job credited with no
 * neutralizer on the path; `refused` records credits that WOULD have counted,
 * so the failure message can name the exact line that disarmed them instead of
 * claiming no gate exists.
 *
 * ⏱ 2026-09-25 — THE GATE VERDICT ITSELF, IN THE SAME RUN. [ADR 095 §4] The
 * deploys are ci.yml call jobs that `needs: [ci-gate]`, and parseResolvedWorkflows
 * hands each callee job that edge as `<caller>/<job>` (an inherited need). GitHub
 * starts a job only when every job it needs SUCCEEDED, and ci-gate succeeds only
 * when every lane did — the very verdict assert-gate-passed.mjs polls for by
 * name, read here without the poll. So reaching the ONE gate-verdict job (see
 * gateVerdictJobs below; none is credited while the name is ambiguous) in the
 * SAME workflow is a gate, under the same neutralizers as a gate call: an
 * always()/failure() on the walked path, or continue-on-error on the verdict job,
 * withdraws it. The walk's own start is never its own credit.
 */
function findGate(wf, job) {
  let clean = null;
  const refused = [];
  const verdict = gateVerdictJobs.length === 1 && gateVerdictJobs[0].wf === wf ? gateVerdictJobs[0].job : null;
  const walk = (j, blockedBy, path) => {
    if (path.has(j.name)) return;
    path.add(j.name);
    if (j.gateCall || (j === verdict && j !== job)) {
      if (blockedBy) refused.push({ kind: 'if', gate: j, blockedBy });
      else if (j.continueOnError) refused.push({ kind: 'coe', gate: j });
      else if (!clean) clean = j;
    }
    for (const dep of j.needs) {
      const d = wf.jobs.get(dep);
      if (!d) continue;
      const disarmed = j.jobIf !== null && NEUTRALIZING_IF.test(j.jobIf.cond) ? { job: j, line: j.jobIf } : null;
      walk(d, blockedBy ?? disarmed, path);
    }
    path.delete(j.name);
  };
  walk(job, null, new Set());
  return { clean, refused };
}

function neutralizedCredit(wf, job, r, doing) {
  if (r.kind === 'coe') {
    return (
      `${wf.rel}: job "${job.name}" ${doing}, and its gate job "${r.gate.name}" carries \`continue-on-error: true\` at ${lineAt(wf, r.gate.continueOnError.n)}. ` +
      `${GATE_SCRIPT} failing can no longer fail that job, so every \`needs\` edge to it is satisfied on a RED gate — the edge exists and enforces nothing.`
    );
  }
  return (
    `${wf.rel}: job "${job.name}" ${doing}, and its only path to ${GATE_SCRIPT} (job "${r.gate.name}") is neutralized: ` +
    `job "${r.blockedBy.job.name}" has a job-level \`if:\` at ${lineAt(wf, r.blockedBy.line.n)} containing \`always()\`/\`failure()\`, so it runs even when the gate FAILED and the \`needs\` edge enforces nothing.`
  );
}

// ── limb 2b · the sandbox exemption from the marker (see the header) ─────────
const ENV_FLAG = /(?:^|\s)(?:--env|-e)(?:=|\s+)(\S+)/;
const CONFIG_FLAG = /(?:^|\s)(?:--config|-c)(?:=|\s|$)/;
/** { exempt, tried, reasons, targets } for one publishing job. `tried` is true
 *  when any publish names an `--env`, so the FAIL line explains a refused
 *  excuse only to a job that asked for one. */
function sandboxExemption(wf, job) {
  const reasons = [];
  const targets = [];
  let tried = false;
  for (const p of job.publishes) {
    const at = lineAt(wf, p.n);
    if (p.what !== 'a Cloudflare deploy action' || typeof p.command !== 'string') {
      const tail = p.what === 'a Cloudflare deploy action' ? ' with no `command:` (its default, a top-level deploy)' : '';
      reasons.push(`${at} is ${p.what}${tail}, not an \`--env\` deploy action`);
      continue;
    }
    const m = p.command.match(ENV_FLAG);
    if (!m) {
      reasons.push(`${at} runs \`wrangler ${p.command}\` with no \`--env\`, which deploys the TOP LEVEL — production`);
      continue;
    }
    tried = true;
    const name = m[1].replace(/^['"]|['"]$/g, '');
    if (/[${}]/.test(name)) {
      reasons.push(`${at} names its environment as an expression (\`${name}\`), which only the run can resolve`);
      continue;
    }
    if (CONFIG_FLAG.test(p.command)) {
      reasons.push(`${at} passes \`--config\`, so the config it deploys is not the one in its working directory`);
      continue;
    }
    const dir = (p.dir ?? '.').replace(/^\.\/+/, '').replace(/\/+$/, '') || '.';
    const cfgRel = ['wrangler.jsonc', 'wrangler.json'].map((f) => (dir === '.' ? f : `${dir}/${f}`)).find((r) => existsSync(join(ROOT, r)));
    if (cfgRel === undefined) {
      reasons.push(`${at} deploys \`--env ${name}\` from ${dir}, which holds no wrangler.jsonc or wrangler.json`);
      continue;
    }
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(join(ROOT, cfgRel), 'utf8'));
    } catch (err) {
      reasons.push(`${cfgRel} does not parse (${err.message}), so \`--env ${name}\` at ${at} cannot be read`);
      continue;
    }
    const e = isObject(cfg?.env) ? cfg.env[name] : undefined;
    if (!isObject(e)) {
      reasons.push(`${at} deploys \`--env ${name}\` and ${cfgRel} declares no \`env.${name}\``);
      continue;
    }
    const world = isObject(e.vars) ? e.vars.MONEY_ENVIRONMENT : undefined;
    if (world !== 'sandbox') {
      reasons.push(`${cfgRel} env.${name} (deployed at ${at}) declares MONEY_ENVIRONMENT = ${JSON.stringify(world)}, not "sandbox"`);
      continue;
    }
    const findings = sandboxEnvironmentFindings(`${cfgRel} env.${name}`, cfg, e);
    if (findings.length > 0) {
      reasons.push(...findings);
      continue;
    }
    targets.push(`${cfgRel} env.${name}`);
  }
  return { exempt: job.publishes.length > 0 && reasons.length === 0, tried, reasons, targets };
}
const exemptJobs = [];

// ── the gate's own builds are gated by construction ──────────────────────────
// Widening RELEASE BUILD to Flutter's default mode (above) pulls ci.yml's
// stamped-probe build — `flutter build web --pwa-strategy=none`, [pipeline S-3]
// — into the domain, and ci.yml cannot call assert-gate-passed.mjs on itself:
// the verdict it would poll for is the one it is busy producing. The credit is
// structural instead: a job the gate-verdict job transitively `needs` cannot go
// red without the gate going red, so building there IS how the commit gets
// gated. (Publishing there gets NO such credit — an artifact that leaves the
// runner before the verdict completes is still limb 2's problem.) The credit is
// withdrawn entirely if MORE than one job claims the gate's check name:
// assert-gate-passed.mjs polls by name, and a second claimant could hand every
// deploy lane the wrong verdict.
const gateVerdictJobs = [];
for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    if ((job.displayName ?? job.name) === GATE_CHECK) gateVerdictJobs.push({ wf, job });
  }
}
const gateConstituents = new Map(); // wf.rel → Set(jobName)
if (gateVerdictJobs.length === 1) {
  const { wf, job } = gateVerdictJobs[0];
  const seen = new Set();
  const stack = [...job.needs];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    const d = wf.jobs.get(n);
    if (d) stack.push(...d.needs);
  }
  gateConstituents.set(wf.rel, seen);
} else if (gateVerdictJobs.length > 1) {
  problems.push(
    `${gateVerdictJobs.length} jobs produce a check run named "${GATE_CHECK}" (${gateVerdictJobs.map((g) => `${g.wf.rel}:"${g.job.name}"`).join(', ')}). ` +
      `${GATE_SCRIPT} polls that check BY NAME, so a second claimant can hand every deploy lane the wrong verdict — and no gate-constituent credit is granted while the name is ambiguous.`,
  );
}

// ── the served lanes, from [9]R-5's register ─────────────────────────────────
const registerRaw = read(REGISTER);
/** Each served lane as the register names it: a workflow, and the job in it
 *  when the row gives one. `key` is how the lane is printed and counted. */
const servedLanes = [];
if (registerRaw !== null) {
  try {
    const register = JSON.parse(registerRaw);
    for (const c of register.channels ?? []) {
      if (c.served !== true || !c.lane || typeof c.lane.workflow !== 'string') continue;
      const job = typeof c.lane.job === 'string' ? c.lane.job : null;
      const key = job === null ? c.lane.workflow : `${c.lane.workflow}#${job}`;
      if (!servedLanes.some((l) => l.key === key)) servedLanes.push({ workflow: c.lane.workflow, job, key });
    }
  } catch {
    problems.push(`${REGISTER} is not valid JSON, so the served-lane half of this guard has no subject.`);
  }
}

// ── assertions ───────────────────────────────────────────────────────────────
let releaseJobs = 0;
let publishJobs = 0;
let submitJobs = 0;
// 🔴 limb 4's OWN failure count, and it exists because an `ok` LINE IS AN
// ASSERTION. MEASURED 2026-08-22 on a fixture tree under the scratchpad, with
// the guard exactly as it stood: a submit job with NO `environment:` printed
//     ok   1 job(s) invoke a `--submit` verb; each declares an `environment:` …
// and, four lines below it,
//     FAIL … job "submit" … declares no job-level `environment:`.
// The success line asserted, in the present tense, the very thing the failure
// line denied — on the same run, about the same job. Counting limb 4's own
// problems (NOT `problems.length`, which a limb-1 red elsewhere would also
// trip) is what lets the line below say only what held.
let submitProblems = 0;
const unnamedSubmitScripts = [];
const submitScriptsChecked = new Set();

// ⏱ 2026-09-25 — A SERVED LANE CAN RUN AS A CALL JOB'S CHILDREN. [ADR 095 §4]
// deploy-web.yml is `on: workflow_call` only and runs as ci.yml's `deploy-web`
// call, after ci-gate. The register still names the file that holds the steps,
// deploy-web.yml#deploy-web, so the lane is resolved to where it RUNS by
// workflow-scan's laneRunHost — the one derivation, imported, never re-derived
// here — and graded as that host's child `deploy-web/deploy-web` in ci.yml.
//   · a file that runs as itself: the lane is the named job and the children it
//     calls (`job.calledBy`), or, for a row with no job, its whole workflow;
//   · a call-only file: the lane is the named child `<callJob>/<job>` among the
//     host's `children`, or, for a row with no job, all of them. Never the
//     caller's other jobs: matching by the caller's `wf.rel` alone would make
//     EVERY ci.yml job the served lane;
//   · ambiguous-callee / orphan-callee is COVERAGE LOST now, in
//     laneRefusalText's words; `missing` matches no job and is COVERAGE LOST
//     below with every other lane that matched none, where a lookup that stopped
//     matching used to leave limb 3 with no subject while its `ok` line still
//     named the lane.
for (const l of servedLanes) {
  const host = laneRunHost(resolved, l.workflow);
  if (host.refusal && host.refusal.kind !== 'missing') {
    coverageLost([`the served lane ${l.key} from ${REGISTER} has no one place it runs.`, laneRefusalText(host.refusal)]);
  }
  l.host = host.refusal ? null : host;
}
const inLane = (l, wf, job) => {
  if (l.host === null || wf.rel !== l.host.workflow) return false;
  if (l.host.callJob === null) return l.job === null || job.name === l.job || job.calledBy === l.job;
  return l.host.children.includes(job) && (l.job === null || job.name === `${l.host.callJob}/${l.job}`);
};
const servedLaneOf = (wf, job) => servedLanes.find((l) => inLane(l, wf, job))?.key ?? null;
const servedLanesGraded = new Set();

for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    const servedLane = servedLaneOf(wf, job);
    if (servedLane !== null) servedLanesGraded.add(servedLane);
    const buildsRelease = job.releaseBuilds.length > 0;
    if (buildsRelease) releaseJobs++;

    // ── limb 1: a release build must be gated, and gated BEFORE it ──────────
    if (buildsRelease) {
      const { clean: gateJob, refused } = findGate(wf, job);
      if (gateJob) {
        if (gateJob.name === job.name && gateJob.gateCall.n > job.releaseBuilds[0].n) {
          problems.push(
            `${wf.rel}: job "${job.name}" calls ${GATE_SCRIPT} at ${lineAt(wf, gateJob.gateCall.n)}, AFTER its first release build at ${lineAt(wf, job.releaseBuilds[0].n)}. ` +
              'A gate consulted after the build has verified nothing — the artifact already exists.',
          );
        }
      } else if (gateConstituents.get(wf.rel)?.has(job.name)) {
        // Gated by construction — the gate verdict `needs` this job, so a red
        // build here IS a red gate. See the gate-constituent block above.
      } else if (refused.length > 0) {
        problems.push(
          neutralizedCredit(wf, job, refused[0], `runs ${job.releaseBuilds.length} release build(s) (first at ${lineAt(wf, job.releaseBuilds[0].n)})`),
        );
      } else {
        problems.push(
          `${wf.rel}: job "${job.name}" runs ${job.releaseBuilds.length} release build(s) (first at ${lineAt(wf, job.releaseBuilds[0].n)}) and neither it nor any job it \`needs\` calls ${GATE_SCRIPT} or reaches the "${GATE_CHECK}" verdict in this run. ` +
            'An artifact can then be built from any dispatched ref, including one whose gate is RED, and nothing downstream can tell the difference.',
        );
      }
    }

    // ── limb 2: a publish must record what shipped, AFTER publishing ────────
    if (job.publishes.length > 0) {
      publishJobs++;
      const lastPublish = job.publishes[job.publishes.length - 1];
      const excused = job.markerCall ? null : sandboxExemption(wf, job);
      if (excused?.exempt) {
        // limb 2b: every publish is a proven-sandbox `--env` deploy. The gate
        // checks below still run.
        exemptJobs.push(`${wf.rel}#${job.name} → ${[...new Set(excused.targets)].join(', ')}`);
      } else if (!job.markerCall) {
        problems.push(
          `${wf.rel}: job "${job.name}" performs ${lastPublish.what} at ${lineAt(wf, lastPublish.n)} and never calls ${MARKER_SCRIPT}. ` +
            'The code shipped and nothing can say what shipped — which is the state [10]D-9\'s ledger exists to abolish.' +
            (excused.tried ? ` It is not excused as a sandbox deploy (limb 2b): ${excused.reasons.join('; ')}.` : ''),
        );
      } else if (job.markerCall.n < lastPublish.n) {
        problems.push(
          `${wf.rel}: job "${job.name}" records the deployment at ${lineAt(wf, job.markerCall.n)}, BEFORE its last publish at ${lineAt(wf, lastPublish.n)}. ` +
            'A marker written before the publish records an intention, not an outcome, and it survives a failed deploy.',
        );
      }
      // A publishing lane is also a release lane, whether or not it says --release.
      // 🔴 ORDER, not just presence — review 2026-07-31: this branch checked only
      // that a gate call EXISTED, so a same-job gate placed after the publish
      // passed limb 2 (limb 1's ordering only covers release builds, and
      // publish-only jobs like deploy-workers' are exactly the ones limb 1 never
      // sees). A gate consulted after the artifact left the runner verified nothing.
      const firstPublish = job.publishes[0];
      const { clean: gateJob, refused } = findGate(wf, job);
      if (!gateJob) {
        if (refused.length > 0) {
          problems.push(neutralizedCredit(wf, job, refused[0], `performs ${lastPublish.what} at ${lineAt(wf, lastPublish.n)}`));
        } else {
          problems.push(
            `${wf.rel}: job "${job.name}" performs ${lastPublish.what} without any \`${GATE_SCRIPT}\` call in itself or a job it \`needs\`, and no clean path to the "${GATE_CHECK}" verdict in this run.`,
          );
        }
      } else if (gateJob.name === job.name && gateJob.gateCall.n > firstPublish.n) {
        problems.push(
          `${wf.rel}: job "${job.name}" calls ${GATE_SCRIPT} at ${lineAt(wf, gateJob.gateCall.n)}, AFTER its first publish at ${lineAt(wf, firstPublish.n)}. A gate consulted after the artifact left the runner has verified nothing.`,
        );
      }
    }

    // ── limb 4: a `--submit` job is gated on an environment, and something ──
    // ──          reads a deployment environment's protection rules at run ──
    // ──          time (the two names are not compared — see the constants) ──
    // SCOPE, SAID OUT LOUD BECAUSE THE FAILURE TEXT HAS TO BE HONEST ABOUT IT:
    // this limb ranges over jobs that invoke a `--submit` VERB, and over nothing
    // else. It does NOT range over the publish set limb 2 uses. See the "WHAT
    // THIS LIMB DOES NOT CATCH" block in this file's header, which names the one
    // job that difference lets through today.
    if (job.submitCalls.length > 0) {
      submitJobs++;
      // `[0]`, not the last call: the (a) message points a reader at where the
      // lane STARTS submitting. Held by 'the (a) FAIL names the FIRST `--submit`
      // call in the job, not the last' — a job with two of them, where `[0]` and
      // `[length - 1]` print different line numbers.
      const first = job.submitCalls[0];
      // (a) the YAML half.
      //
      // 🔴 `job.lines`, NOT `job.logical`, AND THE TWO ARE PROVABLY THE SAME SET
      // FOR THIS PATTERN — stated because the sweep of 2026-08-24 found the swap
      // GREEN and a green swap has to be explained, not left. `job.logical` is
      // `job.lines` with block-scalar CONTINUATION lines folded into their
      // `run:` key line, and joinBlockScalars only consumes lines indented
      // DEEPER than that key. Inside a job a `run:` key sits at six spaces or
      // more, so a four-space job-level key can never be swallowed; and the
      // folded text keeps the `run:` line's own indent, so folding can never
      // MANUFACTURE a `^ {4}environment:` either. The receiver is therefore not
      // a condition that can change a verdict on well-formed YAML — it is a
      // naming choice, and it is spelled the way PG-4 spells it at
      // tooling/release/submit-play.mjs:375, so the two checks cannot drift.
      // The predicate it feeds IS a condition and IS pinned: see
      // 'FAILS when the submit job declares no environment:'.
      if (!job.lines.some((l) => /^ {4}environment:/.test(l.text))) {
        submitProblems++;
        problems.push(
          `${wf.rel}: job "${job.name}" invokes a \`--submit\` verb at ${lineAt(wf, first.n)} and declares no job-level \`environment:\`. ` +
            '[ADR 031:117-124] makes promoting a release owner-only per instance and names the environment as the enforcement; a job without one runs the moment it is dispatched, ' +
            'with no approval and no record of one. A store upload is not undoable — Play binds the upload certificate at the first upload and Snap auto-updates silently.',
        );
      }
      // (b) the run-time half, without which (a) is decoration.
      //
      // EVERY call, not `[0]`: a job may invoke a `--submit` verb more than
      // once and the calls may name DIFFERENT scripts, so one clean script
      // cannot vouch for the next. THE LOOP BOUND IS ITSELF A CONDITION and it
      // is held by 'limb 4 (b) checks EVERY `--submit` call in the job, not
      // just the first' — two calls, the first script performing the read and
      // the second blind. Truncated to `.slice(0, 1)` the guard exits 0 on that
      // fixture and prints an `ok` line saying each script performs the read.
      for (const call of job.submitCalls) {
        if (call.script === null) {
          unnamedSubmitScripts.push(`${placeOf(wf, call.n)} (job "${job.name}")`);
          continue;
        }
        const src = read(call.script);
        if (src === null) {
          unnamedSubmitScripts.push(`${placeOf(wf, call.n)} → ${call.script} (not readable under ${ROOT})`);
          continue;
        }
        submitScriptsChecked.add(call.script);
        const code = stripSourceComments(src, '.mjs');
        const reads = readsEnvironmentAtRunTime(code, call.script);
        if (!reads) {
          submitProblems++;
          problems.push(
            `${wf.rel}: job "${job.name}" invokes \`${call.script} --submit\` at ${lineAt(wf, call.n)}, and that script never reads the deployment environment's protection rules ` +
              `(no \`/environments/\` API path AND \`protection_rules\` survives comment stripping in it, and it does not both import ${COMMON_FN} from ${COMMON_READER} and call it, with that module performing the read). ` +
              '`environment:` on its own FAILS OPEN — GitHub\'s own documentation, quoted at docs/ci/submit-play.md:41-44, says a workflow referencing an environment that does not exist CREATES it, unprotected, and runs. ' +
              'The run history then shows a deployment that reads exactly like an approval. So the YAML line is the pause and this read is the proof the pause was real; a lane with only the first has a gate that a typo silently removes.',
          );
        }
      }
    }

    // ── limb 3: a SERVED channel's lane is held to the same bar ─────────────
    // Derived from the register, so the day a channel is served its lane is
    // covered without anyone remembering to add it here.
    // 🔴 A FOURTH CONJUNCT — `&& !findGate(wf, job).clean` — STOOD HERE AND WAS
    // PROVABLY DEAD. Deleted 2026-08-22 by the exhaustive sweep, with a proof
    // rather than a measurement, because no fixture CAN distinguish it:
    // `clean` is assigned in exactly one place, inside `if (j.gateCall)`, so
    // `clean` truthy implies some walked job carries a gate call, which implies
    // `anyGated` below is true — and the only `problems.push` in this block is
    // under `if (!anyGated)`. So on every path where the conjunct could matter
    // it was already true. The other three conjuncts each DO change the
    // verdict and each has a case below.
    if (servedLane !== null && !buildsRelease && job.publishes.length === 0) {
      // Not every job in a served lane's workflow builds or publishes (a lint
      // job, say). Only complain if NO job in this lane is gated at all — by a
      // gate call, or (⏱ 2026-09-25) by a clean path to the gate verdict itself.
      const laneJobs = [...wf.jobs.values()].filter((j) => servedLaneOf(wf, j) === servedLane);
      const anyGated = laneJobs.some((j) => j.gateCall || findGate(wf, j).clean);
      if (!anyGated) {
        problems.push(
          `${servedLane} is the lane for a SERVED channel in ${REGISTER}, and no job in it calls ${GATE_SCRIPT} or needs the "${GATE_CHECK}" verdict. A served channel ships from an unverified commit.`,
        );
      }
    }
  }
}

// ── limb 4, SECOND DOMAIN: every STORE PUBLISH STEP ─────────────────────────
// ⏱ 2026-09-24 (EXT-3, O-STORE-PUBLISH-STEP-DEFINED-THREE-WAYS). The `--submit`
// verb above is one spelling of a store publish; the Chrome and Edge lanes never
// used it, so limb 4 never ranged over them and a Chrome upload could run in a job
// with no `environment:` while this guard printed ok. The domain here is
// workflow-scan.mjs `storePublishSteps()`, the one definition limb 2 of
// assert-publish-steps-guarded.mjs and rule 2b of assert-publish-records.mjs also
// read: its job must declare `environment:`, and every script it runs must read
// that environment back at run time (directly, or through STORE_ENV_HELPER).
// Two things keep it from grading a job twice: a store step whose own `run:`
// carries the `--submit` verb is (b)'s above, parsed by SUBMIT_SCRIPT (the script
// after `node`, not the first `.mjs` on the line); and a job with any `--submit`
// call already had its `environment:` graded by (a). What is left is the step the
// verb never reached — a register `publishScript` run without `--submit`.
let registerJson = null;
try {
  registerJson = JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
} catch {
  // An unreadable register is reported by the served-lane read above; this domain
  // then has no publishScript set to grade against and adds nothing.
}
const publishScriptSet = new Set(
  (registerJson?.channels ?? []).map((c) => c?.publishScript).filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()),
);
const storeSteps = registerJson === null ? [] : storePublishSteps(workflows.filter(Boolean), registerJson);
const storeStepJobs = new Set();
let storeStepsBeyondSubmit = 0;
for (const { wf, job, step, scripts } of storeSteps) {
  if (SUBMIT_FLAG.test(step.run)) continue;
  storeStepsBeyondSubmit++;
  const key = `${wf.rel}#${job.name}`;
  if (!storeStepJobs.has(key)) {
    storeStepJobs.add(key);
    if (job.submitCalls.length === 0 && !job.lines.some((l) => /^ {4}environment:/.test(l.text))) {
      submitProblems++;
      problems.push(
        `${wf.rel}: job "${job.name}" runs the store publish step ${JSON.stringify(step.name ?? '(unnamed)')} at ${lineAt(wf, step.n)} and declares no job-level \`environment:\`. ` +
          '[ADR 031] makes a store publish owner-only per instance and names the environment as the enforcement; a job without one runs the moment it is dispatched.',
      );
    }
  }
  for (const rel of scripts.filter((x) => publishScriptSet.has(x))) {
    const src = read(rel);
    if (src === null) {
      unnamedSubmitScripts.push(`${placeOf(wf, step.n)} → ${rel} (not readable under ${ROOT})`);
      continue;
    }
    submitScriptsChecked.add(rel);
    if (!readsEnvironmentAtRunTime(stripSourceComments(src, '.mjs'), rel)) {
      submitProblems++;
      problems.push(
        `${wf.rel}: job "${job.name}" runs ${rel} as a store publish at ${lineAt(wf, step.n)}, and that script never reads the deployment environment's protection rules — ` +
          `not itself, not by importing and calling ${COMMON_FN}() from ${COMMON_READER}, and not by calling requireStorePublishEnvironment() from ${STORE_ENV_HELPER}. \`environment:\` on its own FAILS OPEN.`,
      );
    }
  }
}
// No floor of its own: every `node … --submit` call above is also a store publish
// step, so an empty second domain implies `submitJobs === 0`, and that floor below
// is COVERAGE LOST already.

// ── the domain must not be empty ─────────────────────────────────────────────
if (releaseJobs === 0) {
  coverageLost([
    `ZERO jobs across ${workflows.length} workflow file(s) run a \`flutter build\` in release mode.`,
    'This repo builds six platforms for release; a zero here means the pattern or the parser stopped',
    'matching, and every limb above then ranges over nothing and reports clean.',
  ]);
}
if (publishJobs === 0) {
  coverageLost([
    `ZERO publishing jobs found across ${workflows.length} workflow file(s).`,
    'ci.yml calls deploy-web.yml and deploy-workers.yml after ci-gate on every push to main, and both deploy to Cloudflare, so zero means the',
    'PUBLISH pattern set has stopped matching — and limb 2 would then be vacuously true forever.',
  ]);
}
// limb 4's floor. A zero here is not "no submit lanes exist" — MEASURED
// 2026-08-21, two do (submit-play.yml's `submit` job runs `--submit` at :406,
// submit-snap.yml's at :510) — so a zero means SUBMIT_FLAG/SUBMIT_RUNNER stopped
// matching and limb 4 has been ranging over nothing while reporting clean.
if (submitJobs === 0) {
  coverageLost([
    `ZERO jobs invoke a \`--submit\` verb across ${workflows.length} workflow file(s), ${totalJobs} job(s).`,
    'Two do: .github/workflows/submit-play.yml and .github/workflows/submit-snap.yml each run one from their',
    '`submit` job. A zero means the verb pattern has stopped matching and limb 4 is asserting nothing.',
  ]);
}
// An unreadable call is not an absent one. If the verb was found and the script
// could not be named or opened, half (b) was never asked — say so rather than
// counting the job as checked.
if (unnamedSubmitScripts.length > 0) {
  coverageLost([
    `${unnamedSubmitScripts.length} \`--submit\` invocation(s) whose script this guard could not read: ${unnamedSubmitScripts.join(', ')}.`,
    'limb 4 (b) asserts that script performs the run-time environment-protection read. Unread, that assertion',
    'was never made, and the job would otherwise pass on the strength of the `environment:` line alone — which',
    'is exactly the half GitHub fails open on.',
  ]);
}
if (servedLanes.length === 0) {
  problems.push(
    `${REGISTER} declares no SERVED channel with a lane, so limb 3 has no subject. [9]R-5 requires at least one served channel; this guard should never see zero.`,
  );
}
const ungradedLanes = servedLanes.map((l) => l.key).filter((k) => !servedLanesGraded.has(k));
if (ungradedLanes.length > 0) {
  coverageLost([
    `served lane(s) ${ungradedLanes.join(', ')} from ${REGISTER} matched no job: no workflow runs that path and job, as itself or as a call job's child.`,
    ...servedLanes
      .filter((l) => ungradedLanes.includes(l.key) && l.host !== null && l.host.callJob !== null)
      .map((l) => `${l.key} runs as ${l.host.workflow} call job "${l.host.callJob}", whose children are: ${l.host.children.map((j) => j.name).join(', ')}.`),
    'Limb 3 then grades nothing for that channel while its `ok` line still names it.',
  ]);
}

ok(`${workflows.length} workflow file(s), ${totalJobs} job(s); ${releaseJobs} build for release, ${publishJobs} publish`);
ok(
  // No "THAT environment": the guard never compares the name in the YAML with
  // the name the script reads. Corrected 2026-08-21 — see the "WHAT (a) AND (b)
  // DO NOT ASSERT" block beside the constants.
  //
  // ── CORRECTION 2026-08-22, before merge — AN `ok` LINE MAY NOT ASSERT WHAT
  //    THE RUN JUST REFUTED. What stood here, verbatim, was the clause
  //        "; each declares an `environment:` and its script performs a
  //         run-time protection-rules read "
  //    printed UNCONDITIONALLY, above the FAIL lines. It is now spoken only
  //    when limb 4 raised nothing; otherwise the line says how many of the
  //    jobs it counted FAILED. The census — the count and the scripts actually
  //    opened — is a fact either way and stays on both branches, because it is
  //    what a reader diagnoses from. BOTH HALVES OF THAT CENSUS ARE
  //    CONDITIONS, and both were green until 2026-08-24 because every
  //    fixture but one opens exactly ONE script, where a count cannot be
  //    wrong by arithmetic and an order cannot be wrong at all: `size + 1`
  //    and a join with the `.sort()` dropped each passed all 103 cases.
  //    Held by 'the limb-4 `ok` line COUNTS the scripts it opened and names
  //    them in a stable order', which opens two.
  //
  // ── DELETED 2026-08-24 — a `|| '(none)'` fallback stood on the join below and
  //    was DEAD BY CONSTRUCTION, which is the same unfalsifiable shape this
  //    round deleted `.filter(Boolean)` for. Reaching this line at all requires
  //    `submitJobs > 0` (else the floor above calls coverageLost, which
  //    `process.exit(1)`s) and `unnamedSubmitScripts.length === 0` (same). Every
  //    call either lands in `unnamedSubmitScripts` or in `submitScriptsChecked`,
  //    so those two together make the set non-empty here — the fallback could
  //    never be taken. The sibling on the served-lane line below is NOT dead
  //    (a zero-size set only pushes a problem there) and stays.
  // ── DECLARED, NOT PINNED — TWO GREENS ON THE LINE BELOW, AND BOTH ARE REPORT
  //    TEXT (2026-08-24). Neither can change an exit code, and each was measured
  //    that way rather than argued:
  //    · `${publishJobs}` in the tail. `${publishJobs + 1}` is green, and it is
  //      green for a reason its two siblings on this line do not share: the job
  //      count and `${submitScriptsChecked.size}` are limb 4's OWN census — they
  //      are what the line ASSERTS about the scripts it opened, so they are
  //      pinned. `publishJobs` is limb 2's number, quoted here only so a reader
  //      can see the domain this limb does NOT range over. Nothing reads it back.
  //      Measured on the base fixture: shipped and `+ 1` BOTH EXIT 0, the printed
  //      sentence the only difference. Where `publishJobs` does decide something
  //      it is held — the `publishJobs === 0` floor above.
  //    · THE PROSE TAIL IS OUTSIDE THE ASSERTION'S REGEX, and the honest claim
  //      for this line is "tight over the prefix a case matches", NOT
  //      "byte-tight". The case that reads it stops at the closing `)` of the
  //      script list, so everything from `. The two environment names` onwards
  //      is unasserted: `NOT compared.` -> `NOT compared!` is green, measured,
  //      both EXIT 0. It is prose about scope; building machinery to pin a
  //      sentence would assert nothing this guard's verdict depends on.
  `${submitJobs} job(s) invoke a \`--submit\` verb; ${submitScriptsChecked.size} script(s) opened for the run-time half ` +
    `(${[...submitScriptsChecked].sort().join(', ')})` +
    (submitProblems === 0
      ? '; each declares an `environment:` and its script performs a run-time protection-rules read'
      : `; ${submitProblems} of those assertions FAILED — see the FAIL line(s) below`) +
    `. The two environment names are NOT compared. limb 4 also ranges over the ${storeStepsBeyondSubmit} store publish step(s) no \`--submit\` verb reaches, in ${storeStepJobs.size} job(s) (EXT-3); it does NOT range over the ${publishJobs} publish job(s) — see the header.`,
);
ok(
  `limb 2b: ${exemptJobs.length} publishing job(s) excused from ${MARKER_SCRIPT} as proven-sandbox \`--env\` deploys, each still gated` +
    (exemptJobs.length > 0 ? ` (${exemptJobs.join('; ')})` : ''),
);
ok(`${servedLanes.length} served-channel lane(s) from ${REGISTER}: ${servedLanes.map((l) => l.key).join(', ') || '(none)'}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-release-provenance: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-release-provenance: ok');
}
