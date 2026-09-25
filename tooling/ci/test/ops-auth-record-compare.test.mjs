// ─────────────────────────────────────────────────────────────────────────────
// ops-auth-record-compare.test.mjs — the recorded hosted auth config against a
// live read, as a PURE function: tooling/ops/auth-record-compare.mjs.
//
// ⏱ 2026-09-25 — Ops watch run 36097413255 read `sessions_timebox` and
// `sessions_inactivity_timeout` as 0 where tooling/mail-transport.json records
// null, and printed DRIFT; to GoTrue both mean "never". The comparison moved out
// of verify-supabase-templates.mjs verbatim so these cases can call it without a
// stubbed network, and ONE case was added: `supabaseAuth.sameMeaning`, a value
// list the record itself declares equal for one named field.
//
// What these cases pin, both directions:
//   · the new match, and that it is NARROW — a value outside the list, an
//     undeclared field, and the string "0" all stay drift;
//   · the four malformed shapes, each refused as a DRIFT line and granting
//     nothing (the field falls back to the strict compare);
//   · the moved text, byte for byte — the NO-SUCH-FIELD sentence, the subjects
//     loop and the count are what the verifier printed before the move;
//   · the REAL register: its declaration turns today's reading green, and the
//     same reading is red again the moment `sameMeaning` is taken out of a copy.
//
// Nothing here touches the network, a credential or the live project.
// Run:  node --test tooling/ci/test/ops-auth-record-compare.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareAuthRecord, sameMeaningFindings, NOT_A_LIVE_FIELD } from '../../ops/auth-record-compare.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTER = join(REPO, 'tooling', 'mail-transport.json');

/** A record shaped like the real session block: two declared fields, three not. */
const RECORD = () => ({
  _whySessions: ['prose, not a field'],
  transport: 'custom-smtp',
  jwt_exp: 3600,
  refresh_token_rotation_enabled: true,
  security_refresh_token_reuse_interval: 10,
  sessions_timebox: null,
  sessions_inactivity_timeout: null,
  _whySameMeaning: ['prose, not a field'],
  sameMeaning: { sessions_timebox: [null, 0], sessions_inactivity_timeout: [null, 0] },
});

/** A live read that agrees with `record` on every compared field, then `overrides`. */
const liveFor = (record, overrides = {}) => {
  const live = {};
  for (const [k, v] of Object.entries(record)) {
    if (k.startsWith('_') || NOT_A_LIVE_FIELD.has(k)) continue;
    live[k] = v;
  }
  for (const [key, v] of Object.entries(record.subjects ?? {})) live[`mailer_subjects_${key}`] = v;
  return { ...live, ...overrides };
};

describe('compareAuthRecord — the declared same meaning, and how narrow it is', () => {
  test('GREEN — live 0 against a recorded null, for BOTH declared fields (run 36097413255)', () => {
    const rec = RECORD();
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 0, sessions_inactivity_timeout: 0 }));
    assert.deepEqual(r.drift, []);
    assert.ok(r.ok.includes('sessions_timebox ≡ null (live 0, declared same meaning)'), r.ok.join('\n'));
    assert.ok(r.ok.includes('sessions_inactivity_timeout ≡ null (live 0, declared same meaning)'), r.ok.join('\n'));
    assert.equal(r.checked, 5);
  });

  test('GREEN — live null against a recorded null is the plain match, not the declared one', () => {
    const rec = RECORD();
    const r = compareAuthRecord(rec, liveFor(rec));
    assert.deepEqual(r.drift, []);
    assert.ok(r.ok.includes('sessions_timebox ≡ null'), r.ok.join('\n'));
    assert.ok(r.ok.includes('sessions_inactivity_timeout ≡ null'), r.ok.join('\n'));
    assert.equal(r.ok.filter((o) => o.includes('declared same meaning')).length, 0);
  });

  test('RED — live 3600 against a recorded null: a value outside the list is drift', () => {
    const rec = RECORD();
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 3600 }));
    assert.deepEqual(r.drift, ['auth `sessions_timebox`: register says null, live says 3600.']);
  });

  test('RED — `jwt_exp` live 0 against 3600: an undeclared field keeps the strict compare', () => {
    const rec = RECORD();
    const r = compareAuthRecord(rec, liveFor(rec, { jwt_exp: 0 }));
    assert.deepEqual(r.drift, ['auth `jwt_exp`: register says 3600, live says 0.']);
  });

  test('RED — undeclared `security_refresh_token_reuse_interval` recorded null, live 0: still drift', () => {
    const rec = { ...RECORD(), security_refresh_token_reuse_interval: null };
    const r = compareAuthRecord(rec, liveFor(rec, { security_refresh_token_reuse_interval: 0 }));
    assert.deepEqual(r.drift, ['auth `security_refresh_token_reuse_interval`: register says null, live says 0.']);
  });

  test('RED — the STRING "0" is not the member 0: membership is strict', () => {
    const rec = RECORD();
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: '0' }));
    assert.deepEqual(r.drift, ['auth `sessions_timebox`: register says null, live says "0".']);
  });
});

describe('compareAuthRecord — a malformed sameMeaning is refused as DRIFT and grants nothing', () => {
  test('RED — a key that is not a compared field of the record', () => {
    const rec = { ...RECORD(), sameMeaning: { sessions_timeboxx: [null, 0], sessions_inactivity_timeout: [null, 0] } };
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 0 }));
    assert.equal(r.drift.length, 2, r.drift.join('\n'));
    assert.match(r.drift[0], /^auth `sameMeaning\.sessions_timeboxx`: `sessions_timeboxx` is not a compared field of this record/);
    assert.equal(r.drift[1], 'auth `sessions_timebox`: register says null, live says 0.');
  });

  test('RED — a key naming prose, vocabulary or the declaration itself is not a compared field either', () => {
    const rec = { ...RECORD(), sameMeaning: { transport: ['custom-smtp'], _whySessions: [null] } };
    const { refused, lists } = sameMeaningFindings(rec);
    assert.equal(refused.length, 2, refused.join('\n'));
    assert.match(refused[0], /`transport` is not a compared field/);
    assert.match(refused[1], /`_whySessions` is not a compared field/);
    assert.equal(lists.size, 0);
  });

  test('RED — a list that does not contain the recorded value', () => {
    const rec = { ...RECORD(), sameMeaning: { sessions_timebox: [0, 60] } };
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 0 }));
    assert.deepEqual(r.drift, [
      'auth `sameMeaning.sessions_timebox`: [0,60] does not contain the recorded value null, so it cannot say what the recorded value means; `sessions_timebox` is compared strictly.',
      'auth `sessions_timebox`: register says null, live says 0.',
    ]);
  });

  test('RED — a list that is not an array of JSON scalars (an object member)', () => {
    const rec = { ...RECORD(), sameMeaning: { sessions_timebox: [null, { seconds: 0 }] } };
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 0 }));
    assert.equal(r.drift.length, 2, r.drift.join('\n'));
    assert.match(r.drift[0], /^auth `sameMeaning\.sessions_timebox`: \[null,\{"seconds":0\}\] is not an array of JSON scalars/);
    assert.equal(r.drift[1], 'auth `sessions_timebox`: register says null, live says 0.');
  });

  test('RED — a value that is not an array at all', () => {
    const rec = { ...RECORD(), sameMeaning: { sessions_timebox: 0 } };
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 0 }));
    assert.match(r.drift[0], /^auth `sameMeaning\.sessions_timebox`: 0 is not an array of JSON scalars/);
    assert.equal(r.drift[1], 'auth `sessions_timebox`: register says null, live says 0.');
  });

  test('RED — an empty list', () => {
    const rec = { ...RECORD(), sameMeaning: { sessions_timebox: [] } };
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 0 }));
    assert.equal(r.drift.length, 2, r.drift.join('\n'));
    assert.match(r.drift[0], /^auth `sameMeaning\.sessions_timebox`: the list is EMPTY/);
    assert.equal(r.drift[1], 'auth `sessions_timebox`: register says null, live says 0.');
  });

  test('RED — a sameMeaning that is not an object refuses every equivalence', () => {
    const rec = { ...RECORD(), sameMeaning: [['sessions_timebox', null, 0]] };
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 0, sessions_inactivity_timeout: 0 }));
    assert.equal(r.drift.length, 3, r.drift.join('\n'));
    assert.match(r.drift[0], /^auth `sameMeaning`: .* is not an object of field name -> list of values/);
  });

  test('one bad entry does not poison a good one beside it', () => {
    const rec = { ...RECORD(), sameMeaning: { sessions_timebox: [], sessions_inactivity_timeout: [null, 0] } };
    const r = compareAuthRecord(rec, liveFor(rec, { sessions_timebox: 0, sessions_inactivity_timeout: 0 }));
    assert.equal(r.drift.length, 2, r.drift.join('\n'));
    assert.ok(r.ok.includes('sessions_inactivity_timeout ≡ null (live 0, declared same meaning)'), r.ok.join('\n'));
  });

  test('no `sameMeaning` key at all refuses nothing and declares nothing', () => {
    const rec = RECORD();
    delete rec.sameMeaning;
    const { refused, lists } = sameMeaningFindings(rec);
    assert.deepEqual(refused, []);
    assert.equal(lists.size, 0);
  });
});

describe('compareAuthRecord — the moved text is the text the verifier printed', () => {
  test('the NO-SUCH-FIELD sentence is unchanged, and a declared field gets no pass for a missing key', () => {
    const rec = RECORD();
    const live = liveFor(rec);
    delete live.sessions_timebox;
    const r = compareAuthRecord(rec, live);
    assert.deepEqual(r.drift, [
      'auth `sessions_timebox`: the register records null, and the live config has NO SUCH FIELD. Either the name is wrong here or it was renamed upstream; nothing is being checked either way.',
    ]);
  });

  test('the subjects loop is unchanged: a match, a difference and a missing key, and each key counts once', () => {
    const rec = { ...RECORD(), subjects: { confirmation: 'Confirm — T', magic_link: 'Sign in — T', recovery: 'Reset — T' } };
    const live = liveFor(rec, { mailer_subjects_magic_link: 'Magic Link' });
    delete live.mailer_subjects_recovery;
    const r = compareAuthRecord(rec, live);
    assert.ok(r.ok.includes('mailer_subjects_confirmation ≡ "Confirm — T"'), r.ok.join('\n'));
    assert.deepEqual(r.drift, [
      'auth `mailer_subjects_magic_link`: register says "Sign in — T", live says "Magic Link".',
      'auth subject `recovery`: the register records "Reset — T", and the live config has NO SUCH FIELD `mailer_subjects_recovery`.',
    ]);
    assert.equal(r.checked, 8);
  });

  test('a record of nothing comparable says so, and `sameMeaning` is not counted as a field', () => {
    const r = compareAuthRecord({ _why: 'prose', transport: 'custom-smtp', sameMeaning: {} }, {});
    assert.equal(r.checked, 0);
    assert.deepEqual(r.drift, [
      'the register\'s `supabaseAuth` declared no comparable field at all, so NOTHING about the live auth config was checked. That is a gap, not a match.',
    ]);
  });

  test('`sameMeaning` is never compared against live, even when live carries no such key', () => {
    const rec = RECORD();
    const r = compareAuthRecord(rec, liveFor(rec));
    assert.equal(r.drift.filter((d) => d.startsWith('auth `sameMeaning')).length, 0);
    assert.equal(r.ok.filter((o) => o.startsWith('sameMeaning')).length, 0);
  });
});

describe('compareAuthRecord — the REAL register, with a red control', () => {
  const real = () => JSON.parse(readFileSync(REGISTER, 'utf8')).supabaseAuth;

  test('the real register declares both session fields, and its declaration is well formed', () => {
    const rec = real();
    assert.equal(rec.sessions_timebox, null);
    assert.equal(rec.sessions_inactivity_timeout, null);
    const { refused, lists } = sameMeaningFindings(rec);
    assert.deepEqual(refused, []);
    assert.deepEqual([...lists.keys()].sort(), ['sessions_inactivity_timeout', 'sessions_timebox']);
  });

  test('GREEN on the real register for the reading of run 36097413255, RED with `sameMeaning` taken out of a copy, GREEN again restored', () => {
    const rec = real();
    const reading = liveFor(rec, { sessions_timebox: 0, sessions_inactivity_timeout: 0 });
    assert.deepEqual(compareAuthRecord(rec, reading).drift, []);

    const mutated = structuredClone(rec);
    delete mutated.sameMeaning;
    assert.deepEqual(compareAuthRecord(mutated, reading).drift, [
      'auth `sessions_timebox`: register says null, live says 0.',
      'auth `sessions_inactivity_timeout`: register says null, live says 0.',
    ]);

    const restored = { ...mutated, sameMeaning: structuredClone(rec.sameMeaning) };
    assert.deepEqual(compareAuthRecord(restored, reading).drift, []);
  });
});
