// ─────────────────────────────────────────────────────────────────────────────
// assert-name-clearance.test.mjs — the mutation matrix for
// `tooling/ci/assert-name-clearance.mjs`.
//
// 🔴 A GUARD THAT CANNOT FAIL IS NOT A GUARD. This guard runs against a tree
// where the answer is currently "printed and owner-gated" — Subly is
// PROVEN-TAKEN on `ios-appstore` and that channel is unarmed — so on the real
// repository it exits 0 every time. Read alone, that green is consistent with a
// guard that exits 0 unconditionally, which is exactly the shape this corpus has
// twice found and deleted. So every limb below is driven by a REAL FIXTURE TREE,
// seeded from the real register, the real catalogue, the real schema and the
// real identity files, and then MUTATED one property at a time.
//
// GREEN CONTROL FIRST (M0). Without a run over the unmutated fixture that exits
// 0, every red below would be equally consistent with a guard that refuses
// everything — a guard that reports a defect on a correct tree, which costs more
// than it saves.
//
// THE SHARPEST CASE IS M3. The blocked-but-unarmed state is the ONLY reason main
// is green today, and if that derivation ever stopped depending on the register
// the guard would go on printing ⬜ after `ios-appstore` acquired a lane — a
// clearance that had stopped clearing, silently, at exactly the moment it
// mattered. M3 flips `served` in the fixture register and requires the exit to
// move 0 → 1. Nothing is typed into a list to make that happen.
//
// Run:  node --test tooling/ci/test/assert-name-clearance.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { VERDICTS } from '../../store/name-probes.mjs';
import { whyLines } from '../../store/name-clearance-why.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-name-clearance.mjs');

/** Everything the guard reads, and nothing else. Copied from the real tree so a
 *  fixture cannot quietly model a register the repository does not have. */
const SEEDED = [
  'tooling/channel-register.json',
  'catalog/apps.json',
  'contracts/name-clearance.schema.json',
  'apps/subscriptiontracker/app.yaml',
  'apps/subscriptiontracker/name-clearance.json',
  'apps/subscriptiontracker/android/app/build.gradle.kts',
  'apps/subscriptiontracker/ios/Runner.xcodeproj/project.pbxproj',
  'apps/subscriptiontracker/macos/Runner/Configs/AppInfo.xcconfig',
  'apps/subscriptiontracker/linux/CMakeLists.txt',
];

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-anc-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A throwaway checkout of just the guard's subject. `mutate` receives helpers
 *  that read and write files inside it. */
function fixture(mutate = () => {}) {
  const root = join(TMP, `r${(seq += 1)}`);
  for (const rel of SEEDED) {
    const dst = join(root, ...rel.split('/'));
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(REPO, ...rel.split('/')), dst);
  }
  const readText = (rel) => readFileSync(join(root, ...rel.split('/')), 'utf8');
  const writeText = (rel, text) => writeFileSync(join(root, ...rel.split('/')), text);
  // A mutated RECORD is given the `_why` its mutated fields generate, as every
  // writer gives it, so each case below still isolates the ONE property it
  // names. Limb 11's own cases (M29-M31) write the record raw, with writeText.
  const editJson = (rel, fn) => {
    const doc = JSON.parse(readText(rel));
    const next = fn(doc) ?? doc;
    if (rel === RECORD) next._why = whyLines(next);
    writeText(rel, `${JSON.stringify(next, null, 2)}\n`);
  };
  mutate({ root, readText, writeText, editJson });
  return root;
}

/** The guard's exit code, captured ON ITS OWN LINE — `$?` beside anything else
 *  is that thing's status, which is how a red guard has been read as green in
 *  this repository before. */
function run(root, args = []) {
  const r = spawnSync(process.execPath, [GUARD, '--repo', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const RECORD = 'apps/subscriptiontracker/name-clearance.json';

/** ⏱ 2026-09-24 — THE OWED STATE IS SEEDED, NOT INHERITED. M0 and M5 read the null
 *  ruling and its owner gate off the LIVE record, which carried them until apps-review
 *  F1 recorded the owner's ruling there; from then on both would have been measuring a
 *  state the tree no longer has — the same lesson M3 records about its wall. The gate
 *  date is computed, so the control does not expire on a calendar day either. */
const IN_30_DAYS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
/* Built from parts: this file is tracked, and a literal fixture id in it is a citation
   assert-public-citations' ROW IDS class would look up in open.json. */
const FIXTURE_HOLD = ['O', 'FIXTURE', 'TRADEMARK', 'HOLD'].join('-');
const owed = (doc) => {
  Object.assign(doc.trademark, { ruling: null, ruledBy: null, ruledOn: null, basis: null, ownerItem: FIXTURE_HOLD, gatedUntil: IN_30_DAYS });
};
const ruled = (doc) => {
  Object.assign(doc.trademark, { ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-09', basis: 'ADR 074', ownerItem: null, gatedUntil: null });
};

describe('assert-name-clearance — the green control', () => {
  // 🔴 THIS CONTROL ASSERTS THE GUARD'S BEHAVIOUR, NOT TODAY'S VERDICTS. It used to
  // also require `PROVEN-TAKEN on ios-appstore` and `NOT BLOCKING TODAY`, which were
  // true of the record on 2026-09-08 and stopped being true on 2026-09-09: the app
  // was renamed, the clearance was re-derived, and the new name is taken on nothing.
  // A green control that fails because a real-world verdict IMPROVED is a control
  // reporting on the internet rather than on the guard. The wall is still tested —
  // M3 now SEEDS one rather than borrowing whichever one the tree happens to carry.
  test('M0 GREEN CONTROL — an owed ruling inside its gate exits 0 and PRINTS the owed finding', () => {
    const r = run(fixture(({ editJson }) => editJson(RECORD, owed)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /QUALIFIED, NOT CLEAR/, 'a null trademark ruling must never print as clear');
    assert.match(r.out, /owner-gated until/);
  });

  test('M0b GREEN CONTROL — a PROCEED ruling with who, when and on what basis exits 0 and prints nothing owed', () => {
    const r = run(fixture(({ editJson }) => editJson(RECORD, ruled)));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /QUALIFIED, NOT CLEAR/);
  });
});

describe('assert-name-clearance — the mutation matrix', () => {
  test('M1 a MISSING record is a finding, and it names the command that makes one', () => {
    const root = fixture(({ root: r }) => rmSync(join(r, 'apps', 'subscriptiontracker', 'name-clearance.json')));
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no apps\/subscriptiontracker\/name-clearance\.json/);
    assert.match(r.out, /name-clearance\.mjs "<Name>" --app subscriptiontracker --execute/);
  });

  // 🔴 THE DECLARED NAME IS REWRITTEN, NOT SPELLED. `^name: Subly$` matched nothing
  // after the 2026-09-09 rename, so the "mutation" silently mutated nothing, the
  // guard saw an unchanged tree and exited 0, and a red control went green without
  // anybody typing a waiver. A mutation that no longer mutates is the worst kind of
  // passing test. `^name: .*$` cannot miss, and the assertion below reads the name
  // the record actually clears out of the guard's own message.
  test('M2 a record for a DIFFERENT name than app.yaml declares is a finding', () => {
    const root = fixture(({ readText, writeText }) => {
      const before = readText('apps/subscriptiontracker/app.yaml');
      const after = before.replace(/^name: .*$/m, 'name: Renamed');
      assert.notEqual(after, before, 'the app.yaml `name:` line must exist for this mutation to mean anything');
      writeText('apps/subscriptiontracker/app.yaml', after);
    });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /clears the name "[^"]+" while apps\/subscriptiontracker\/app\.yaml declares "Renamed"/);
  });

  // 🔴 THE WALL IS SEEDED HERE, and that is the whole repair. This case used to rely
  // on the LIVE record carrying a PROVEN-TAKEN on `ios-appstore` — true while the app
  // was called Subly, false the moment it was renamed to a name nobody had taken. The
  // arming mutation then had no wall to arm, the guard exited 0, and THE SHARPEST CASE
  // IN THIS FILE reported that the arming bite worked when it had not been exercised
  // at all. M3's subject is "a BLOCKED record fails once its channel arms", so M3 must
  // CONSTRUCT the blocked record; inheriting one from the internet is what broke it.
  //
  // The two runs below differ in exactly one property — `served` — over the same
  // seeded wall, which is what makes the 0 → 1 move attributable to the arming.
  const withWall = (doc) => {
    doc.channels['ios-appstore'].verdict = 'PROVEN-TAKEN';
    doc.channels['ios-appstore'].uniqueness = 'global';
    doc.channels['ios-appstore'].evidence = ['"Seeded" — Somebody Else — Finance — https://apps.apple.com/us/app/id1'];
    doc.overall = 'BLOCKED';
  };

  // ⏱ THE GREEN CONTROL NOW HAS TO DISARM THE ROW EXPLICITLY — 2026-09-09. This
  // test's whole shape is "unarmed prints, armed fails", and it took
  // `ios-appstore` being unarmed in the REAL register as its starting state. That
  // stopped being true when the row acquired a lane, so the control was silently
  // measuring the armed case twice. The fixture now states the unarmed half
  // rather than inheriting it, which is what a control has to do anyway: a
  // control that depends on unrelated production state is one register edit away
  // from testing nothing, and this is the edit that proved it.
  const unarm = (doc) => {
    for (const c of doc.channels) if (c.id === 'ios-appstore') { c.lane = null; c.served = false; }
  };

  test('M3 THE ARMING BITE — the same BLOCKED record fails the moment its channel arms', () => {
    // green control: the seeded wall on an UNARMED channel is printed, not fatal
    const before = run(
      fixture(({ editJson }) => {
        editJson(RECORD, withWall);
        editJson('tooling/channel-register.json', unarm);
      }),
    );
    assert.equal(before.code, 0, `green control first — a seeded wall on an unarmed channel must still exit 0:
${before.out}`);
    assert.match(before.out, /PROVEN-TAKEN on ios-appstore/, 'the wall must be printed, not swallowed');
    assert.match(before.out, /NOT BLOCKING TODAY/);

    const root = fixture(({ editJson }) => {
      editJson(RECORD, withWall);
      editJson('tooling/channel-register.json', (doc) => {
        for (const c of doc.channels) if (c.id === 'ios-appstore') c.served = true;
      });
    });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is ARMED/);
    assert.match(r.out, /would be refused by a channel that can reach a user today/);
  });

  test('M4 a record whose RED CONTROLS FAILED is not evidence, whatever its verdicts say', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.controls = { green: 0, failed: ['amo', 'ios-appstore'] };
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /red control\(s\) FAILED on the run that wrote it/);
  });

  test('M5 the owner gate EXPIRES — a past `gatedUntil` blocks, and so does a missing one', () => {
    const expired = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          owed(doc);
          doc.trademark.gatedUntil = '2020-01-01';
        }),
      ),
    );
    assert.equal(expired.code, 1, expired.out);
    assert.match(expired.out, /EXPIRED on 2020-01-01/);

    const undated = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          owed(doc);
          doc.trademark.gatedUntil = null;
        }),
      ),
    );
    assert.equal(undated.code, 1, undated.out);
    assert.match(undated.out, /carries no `gatedUntil` date/);

    const unowned = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          owed(doc);
          doc.trademark.ownerItem = null;
        }),
      ),
    );
    assert.equal(unowned.code, 1, unowned.out);
    assert.match(unowned.out, /a finding nobody owns/);
  });

  test('M6 an owner ruling of DO-NOT-PROCEED blocks unconditionally', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.trademark.ruling = 'DO-NOT-PROCEED';
        doc.trademark.ruledBy = 'owner';
        doc.trademark.ruledOn = '2026-09-09';
        doc.trademark.basis = 'a fixture decision record';
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /RULED DO-NOT-PROCEED/);
    assert.doesNotMatch(r.out, /and lacks/, 'the ruling is complete, so the only finding is the ruling itself');
  });

  // RC6. `PROCEDE` is refused by the schema's enum before limb 7 is reached, so the
  // first run is the whole guard and the second takes the schema out of the way: the
  // fixture's enum is WIDENED to admit the typo, and limb 7 must still refuse it.
  // Without the second run, limb 7's own check would be one no input could reach.
  test('M16 (RC6) a misspelt ruling is a finding, and limb 7 refuses it even where the schema admits it', () => {
    const typo = (doc) => {
      ruled(doc);
      doc.trademark.ruling = 'PROCEDE';
    };
    const whole = run(fixture(({ editJson }) => editJson(RECORD, typo)));
    assert.equal(whole.code, 1, whole.out);
    assert.match(whole.out, /trademark\/ruling/);

    const limb7 = run(
      fixture(({ editJson }) => {
        editJson(RECORD, typo);
        editJson('contracts/name-clearance.schema.json', (s) => {
          s.properties.trademark.properties.ruling.anyOf[1].enum.push('PROCEDE');
        });
      }),
    );
    assert.equal(limb7.code, 1, limb7.out);
    assert.match(limb7.out, /`trademark\.ruling` is "PROCEDE", and a ruling is null, "PROCEED" or "DO-NOT-PROCEED"/);
  });

  test('M17 (RC7) a PROCEED with no basis is a finding — and so is one with no ruledBy or no dated ruledOn', () => {
    const noBasis = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          ruled(doc);
          delete doc.trademark.basis;
        }),
      ),
    );
    assert.equal(noBasis.code, 1, noBasis.out);
    assert.match(noBasis.out, /`trademark\.ruling` is PROCEED and lacks `basis`/);

    const unattributed = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          ruled(doc);
          doc.trademark.ruledBy = null;
          doc.trademark.ruledOn = null;
        }),
      ),
    );
    assert.equal(unattributed.code, 1, unattributed.out);
    assert.match(unattributed.out, /is PROCEED and lacks `ruledBy`, a dated `ruledOn`/);
  });

  test('M18 a null ruling whose ownerItem is not an owner id is a finding, even inside its gate', () => {
    const r = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          owed(doc);
          doc.trademark.ownerItem = 'the owner, eventually';
        }),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is not an owner id/);
  });

  // ⏱ 2026-09-24 (the PR 913 review, L1): limb 7 and the citations guard read one
  // `isOwnerId`, so a queue id no pattern fits is an id to both.
  test('M19 a null ruling held on an owner-queue id outside the old grammar is an owner id, inside its gate', () => {
    const r = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          owed(doc);
          doc.trademark.ownerItem = 'HOSTINGER-EXPIRY';
        }),
      ),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /owner-gated until .* under HOSTINGER-EXPIRY/);
  });

  // ⏱ 2026-09-24 (the PR 913 review, L2): `basis: " "` passed the schema's
  // `minLength: 1`, and only limb 7 caught it.
  test('M20 (RC4) a whitespace-only `basis` fails the schema, and limb 7 refuses it without the schema too', () => {
    const blank = (doc) => {
      ruled(doc);
      doc.trademark.basis = ' ';
    };
    const r = run(fixture(({ editJson }) => editJson(RECORD, blank)));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /trademark\/basis: matches none of the 2 permitted shapes/);

    const limb7 = run(
      fixture(({ editJson }) => {
        editJson(RECORD, blank);
        editJson('contracts/name-clearance.schema.json', (s) => {
          delete s.properties.trademark.properties.basis.anyOf[1].pattern;
        });
      }),
    );
    assert.equal(limb7.code, 1, limb7.out);
    assert.match(limb7.out, /is PROCEED and lacks `basis`/);
  });

  // ⏱ 2026-09-24 (the PR 913 review, L2): V8 parses `2026-02-31` as 3 March, so the
  // schema's `date` format accepted it while limb 7 refused it. One helper now.
  test('M21 (RC5) `ruledOn: "2026-02-31"` fails the schema, and limb 7 refuses it without the schema too', () => {
    const noSuchDay = (doc) => {
      ruled(doc);
      doc.trademark.ruledOn = '2026-02-31';
    };
    const r = run(fixture(({ editJson }) => editJson(RECORD, noSuchDay)));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /trademark\/ruledOn: matches none of the 2 permitted shapes/);

    const limb7 = run(
      fixture(({ editJson }) => {
        editJson(RECORD, noSuchDay);
        editJson('contracts/name-clearance.schema.json', (s) => {
          delete s.properties.trademark.properties.ruledOn.anyOf[1].format;
        });
      }),
    );
    assert.equal(limb7.code, 1, limb7.out);
    assert.match(limb7.out, /is PROCEED and lacks a dated `ruledOn`/);

    const leap = run(fixture(({ editJson }) => editJson(RECORD, (doc) => { ruled(doc); doc.trademark.ruledOn = '2028-02-29'; })));
    assert.equal(leap.code, 0, `green control: a real leap day is a date: ${leap.out}`);
  });

  test('M7 IDENTITY DRIFT — an applicationId the tree no longer declares is a finding', () => {
    // The `applicationId` LINE, not the first occurrence of the string: this
    // file also carries `namespace = "com.nikatru.subscriptiontracker"` above it, and a bare
    // `.replace()` mutates that one instead and leaves the identity the guard
    // actually reads untouched — a mutation that changes nothing, which reads
    // exactly like a guard that cannot fail. It did, on the first run.
    const root = fixture(({ readText, writeText }) =>
      writeText(
        'apps/subscriptiontracker/android/app/build.gradle.kts',
        readText('apps/subscriptiontracker/android/app/build.gradle.kts').replace(/^(\s*applicationId\s*=\s*)"[^"]+"/m, '$1"com.nikatru.renamed"'),
      ),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /now declares "com\.nikatru\.renamed"/);
    assert.match(r.out, /one app_id derives every store identity/);
  });

  test('M8 SELF IS NOT A COLLISION, but a second app declaring the same name is', () => {
    const root = fixture(({ editJson }) =>
      editJson('catalog/apps.json', (doc) => {
        doc.push({ ...doc[0], slug: 'twin' });
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a DIFFERENT app in catalog\/apps\.json already declares this name/);
    assert.match(r.out, /twin/);
  });

  test('M9 STALENESS — past the ceiling it WARNS in the hook and FAILS under --execute', () => {
    const stale = ({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.asOf = '2020-01-01';
      });
    const hook = run(fixture(stale));
    assert.equal(hook.code, 0, hook.out);
    assert.match(hook.out, /the ceiling is 30/);
    assert.match(hook.out, /a WARNING here and a FINDING under --execute/);

    const routine = run(fixture(stale), ['--execute']);
    assert.equal(routine.code, 1, routine.out);
    assert.match(routine.out, /the ceiling is 30/);
  });

  test('M10 a record written against a DIFFERENT channel set is COVERAGE LOST, not a pass', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        delete doc.channels['linux-snap'];
      }),
    );
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /Never asked about: linux-snap/);
  });

  test('M11 an unreadable register is COVERAGE LOST — nothing was checked, and nothing is not a pass', () => {
    const root = fixture(({ writeText }) => writeText('tooling/channel-register.json', '{ not json'));
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('M12 a record that violates the schema is a finding, not a clearance', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.channels.web.verdict = 'PROBABLY-FINE';
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PROBABLY-FINE/);
  });

  test('M13 an empty catalogue is COVERAGE LOST — the expected set is what stops a vacuous green', () => {
    const root = fixture(({ writeText }) => writeText('catalog/apps.json', '[]\n'));
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /declares no app with a `slug`/);
  });

  test('M15 ONE DAY AHEAD IS GEOGRAPHY, NOT A DEFECT — a record stamped in IST is read in UTC', () => {
    // 🔴 THIS EXACT CASE FAILED CI ON THE FIRST PUSH. The probe stamps the LOCAL
    // date on purpose (UTC would stamp yesterday for an evening run at +05:30 and
    // give a day of the 30-day ceiling away), and the runner reads it in UTC:
    // local 2026-09-09 02:51 IST is 2026-09-08 21:21 UTC, so a correct record
    // read as "measured tomorrow" and the guard refused it. Tolerating one day is
    // the whole width of the effect — M14 proves it is not tolerating more.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.asOf = tomorrow;
      }),
    );
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  });

  test('M14 an `asOf` in the future is a finding — a clearance cannot have been measured tomorrow', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.asOf = '2099-01-01';
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /More than a day is more than geography can explain/);
  });
});

// ── --for-submission=<channel> (limb 10) ──────────────────────────────────────
// The pass set is exactly two answers on the named channel: PROVEN-FREE, or HELD
// with a store record id, `heldBy: "owner"` and a dated `heldOn`. Every case
// below runs the SAME fixture bare first where that is the point, so a red under
// the flag is the flag and not the fixture.
const heldOnPlay = (doc) => {
  Object.assign(doc.channels['android-play'], { verdict: 'HELD', storeRecordId: 'com.nikatru.subscriptiontracker', heldBy: 'owner', heldOn: '2026-09-24' });
};

describe('assert-name-clearance --for-submission — limb 10', () => {
  test('M22 (A7-RC1) an UNDETERMINED channel is fatal under the flag, and the bare run of the same record passes', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.channels['android-play'].verdict = 'UNDETERMINED';
      }),
    );
    const bare = run(root);
    assert.equal(bare.code, 0, `green control: UNDETERMINED is not a finding in the bare run:\n${bare.out}`);
    const r = run(root, ['--for-submission=android-play']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is UNDETERMINED on android-play/);
    assert.match(r.out, /name-clearance\.mjs --hold android-play --record <store record id> --app subscriptiontracker/, 'the finding must name the command that records a hold');
  });

  test('M23 (A7-RC2) a HELD with its store record id, heldBy owner and heldOn passes under the flag', () => {
    const r = run(fixture(({ editJson }) => editJson(RECORD, heldOnPlay)), ['--for-submission=android-play']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /--for-submission=android-play: subscriptiontracker HELD \(store record com\.nikatru\.subscriptiontracker, 2026-09-24\)/);
  });

  // The schema refuses a HELD without its id before limb 10 is reached, so the
  // second run takes the schema's clause out of the fixture: limb 10 must still
  // refuse it. Without that run, limb 10's own check is one no input could reach.
  test('M24 (A7-RC3) a HELD with no storeRecordId is a finding — from the schema, and from limb 10 where the schema admits it', () => {
    const noId = (doc) => {
      heldOnPlay(doc);
      delete doc.channels['android-play'].storeRecordId;
    };
    const whole = run(fixture(({ editJson }) => editJson(RECORD, noId)), ['--for-submission=android-play']);
    assert.equal(whole.code, 1, whole.out);
    assert.match(whole.out, /channels\/android-play: matches none of the 2 permitted shapes/);

    const limb10 = run(
      fixture(({ editJson }) => {
        editJson(RECORD, noId);
        editJson('contracts/name-clearance.schema.json', (s) => {
          delete s.properties.channels.additionalProperties.anyOf;
        });
      }),
      ['--for-submission=android-play'],
    );
    assert.equal(limb10.code, 1, limb10.out);
    assert.match(limb10.out, /android-play is HELD and lacks a `storeRecordId`/);
  });

  test('M25 (A7-RC4) a bare --for-submission is COVERAGE LOST, and so is a channel the register does not declare', () => {
    const bare = run(fixture(), ['--for-submission']);
    assert.equal(bare.code, 2, bare.out);
    assert.match(bare.out, /--for-submission was given without a channel/);

    const stranger = run(fixture(), ['--for-submission=android-playstore']);
    assert.equal(stranger.code, 2, stranger.out);
    assert.match(stranger.out, /names channel "android-playstore", which tooling\/channel-register\.json does not declare/);
  });

  test('M26 the pass set is exactly PROVEN-FREE or HELD — PROVEN-FREE passes, NOT-APPLICABLE and a tolerated PROVEN-TAKEN do not', () => {
    const free = run(fixture(), ['--for-submission=web']);
    assert.equal(free.code, 0, free.out);
    assert.match(free.out, /--for-submission=web: subscriptiontracker PROVEN-FREE/);

    const na = run(fixture(), ['--for-submission=windows-direct']);
    assert.equal(na.code, 1, na.out);
    assert.match(na.out, /is NOT-APPLICABLE on windows-direct/);

    // tolerated, so limb 6 never grades it and the bare run stays green
    const taken = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.channels['windows-store'].verdict = 'PROVEN-TAKEN';
      }),
    );
    assert.equal(run(taken).code, 0, 'green control: a tolerated PROVEN-TAKEN is not a bare finding');
    const r = run(taken, ['--for-submission=windows-store']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is PROVEN-TAKEN on windows-store/);
  });

  test('M27 the trademark owner gate is FATAL under the flag and a print in the bare run', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        owed(doc);
        heldOnPlay(doc);
      }),
    );
    const bare = run(root);
    assert.equal(bare.code, 0, bare.out);
    assert.match(bare.out, /owner-gated until/);
    const r = run(root, ['--for-submission=android-play']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /bounds a BUILD, not a submission/);
    assert.doesNotMatch(r.out, /android-play is HELD and lacks/, 'the hold is complete, so the only finding is the gate');
  });

  test('M32 a HELD record regenerated by the fixture names its store record id in `_why`', () => {
    const root = fixture(({ editJson }) => editJson(RECORD, heldOnPlay));
    const back = JSON.parse(readFileSync(join(root, ...RECORD.split('/')), 'utf8'));
    assert.ok(back._why.some((l) => l.startsWith('Held (HELD)') && l.includes('android-play (store record com.nikatru.subscriptiontracker, 2026-09-24)')), back._why.join('\n'));
    assert.equal(run(root).code, 0, 'the regenerated text is the text limb 11 wants');
  });

  test('M28 HELD is one verdict in both places — the schema enum is name-probes.mjs VERDICTS', () => {
    const schema = JSON.parse(readFileSync(join(REPO, 'contracts', 'name-clearance.schema.json'), 'utf8'));
    const verdicts = schema.properties.channels.additionalProperties.properties.verdict.enum;
    assert.ok(verdicts.includes('HELD'));
    assert.deepEqual([...verdicts].sort(), [...VERDICTS].sort());
  });
});

// ── limb 11: `_why` is generated, never typed ─────────────────────────────────
// These cases write the record RAW (writeText), because editJson regenerates
// `_why` and would repair the very defect each one plants.
describe('assert-name-clearance — limb 11, the generated `_why`', () => {
  test('M29 (A7-RC5) one word changed in `_why[0]` is a finding naming the offline command', () => {
    const control = run(fixture());
    assert.equal(control.code, 0, `green control: the tree's own record carries the generated text:\n${control.out}`);
    const root = fixture(({ readText, writeText }) => {
      const doc = JSON.parse(readText(RECORD));
      const before = doc._why[0];
      doc._why[0] = before.replace('GENERATED', 'WRITTEN');
      assert.notEqual(doc._why[0], before, 'the mutation must change the line');
      writeText(RECORD, `${JSON.stringify(doc, null, 2)}\n`);
    });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`_why` differs from whyLines\(\) at line 0/);
    assert.match(r.out, /node tooling\/store\/name-clearance\.mjs --why --app subscriptiontracker/);
  });

  test('M30 an absent `_why` is a finding', () => {
    const root = fixture(({ readText, writeText }) => {
      const doc = JSON.parse(readText(RECORD));
      delete doc._why;
      writeText(RECORD, `${JSON.stringify(doc, null, 2)}\n`);
    });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`_why` is absent/);
  });

  test('M31 a verdict changed WITHOUT regenerating is a finding — the stale-prose defect itself', () => {
    const root = fixture(({ readText, writeText }) => {
      const doc = JSON.parse(readText(RECORD));
      assert.equal(doc.channels.amo.verdict, 'PROVEN-FREE', 'the mutation below must change a verdict the text names');
      doc.channels.amo.verdict = 'UNDETERMINED';
      writeText(RECORD, `${JSON.stringify(doc, null, 2)}\n`);
    });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`_why` differs from whyLines\(\) at line 2/);
  });
});
