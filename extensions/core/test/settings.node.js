#!/usr/bin/env node
/* SPDX-License-Identifier: MPL-2.0
   core/test/settings.node.js — the sim for core/v1/settings.js.

   Loads the REAL core/v1/settings.js on bare Node. The only fakes are
   chrome.storage.sync / .local / .onChanged, and each records its reads and
   writes so "did it write?" is an assertion and not an inference.

   ONE THING TO KNOW BEFORE READING THE MIGRATION SECTION. This file ships as a
   TEMPLATE (its own header says so): SK_SETTINGS_VERSION is 1 and SK_MIGRATIONS
   is empty, because a tool fills those in when it adopts the file. A migration
   ENGINE cannot be exercised at version 1 with no migrations — there is nothing
   to run — so section `migration engine` loads the real file with a tool-shaped
   schema injected at the two PLACEHOLDER sites a tool would edit, and grades
   the untouched engine code around it. The injection goes through
   harness.mutate(), which throws if either site stops matching, so this section
   cannot silently degrade into testing nothing.

   Run: node core/test/settings.node.js      (cwd-independent) */

'use strict';

const H = require('./harness.js');
const { check, section, note } = H;

const MODULE = 'v1/settings.js';
const SRC = H.readCore(MODULE);

function sink() {
  const lines = [];
  const rec = (...a) => lines.push(a.map(x => (x && x.message) || String(x)).join(' '));
  return { lines, error: rec, warn: rec, log: rec, info: rec };
}

function load(chrome, opts) {
  const o = opts || {};
  const con = o.console || sink();
  const sandbox = H.loadCore(MODULE, { chrome, MIG: o.MIG }, { source: o.source, console: con });
  sandbox.__console = con;
  return sandbox;
}

/* The two PLACEHOLDER edits a tool makes when it adopts this file: a real
   schema version and real migration functions. Everything else — the ordering,
   the stamping rules, the re-homing, the failure handling — is the shipped
   code, untouched. */
function withSchema(mig) {
  let src = H.mutate(SRC, 'const SK_SETTINGS_VERSION = 1;', 'const SK_SETTINGS_VERSION = 3;');
  src = H.mutate(src,
    '  const SK_MIGRATIONS = {\n    // 1 is the initial schema — nothing to migrate to it.\n  };',
    '  const SK_MIGRATIONS = {\n' +
    '    2: (s) => { MIG.ran.push(2); s.historyLimit = 22; if (MIG.throwAt === 2) throw new Error("migration 2 blew up"); },\n' +
    '    3: (s) => { MIG.ran.push(3); s.retentionDays = 33; if (MIG.throwAt === 3) throw new Error("migration 3 blew up"); }\n' +
    '  };');
  return { source: src, MIG: Object.assign({ ran: [] }, mig || {}) };
}

async function main() {
  /* ---------------------------------------------------------------- */
  section('defaults');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const S = load(chrome);
    const s = await S.skGetSettings();
    check('an empty profile reads back the declared defaults',
      s.theme === 'system' && s.historyLimit === 50 && s.retentionDays === 30);
    check('the key set is EXACTLY SK_DEFAULTS — the schema stamp is bookkeeping, not a\n' +
      '        setting, and a caller that iterated the result would render a row for it',
      Object.keys(s).sort().join(',') === Object.keys(S.SK_DEFAULTS).sort().join(','),
      Object.keys(s).sort().join(','));

    /* docs/CORE-POLICY.md and the file's own banner: default to OFF for
       anything that stores or reveals more than the tool needs. */
    check('keepHistory defaults OFF', S.SK_DEFAULTS.keepHistory === false);
    check('copyOnOpen defaults OFF', S.SK_DEFAULTS.copyOnOpen === false);

    const declared = S.SK_SYNC_KEYS.concat(S.SK_LOCAL_KEYS).sort().join(',');
    check('every default is declared in exactly one of the two area lists',
      declared === Object.keys(S.SK_DEFAULTS).sort().join(','), declared);
    check('the two lists do not overlap',
      S.SK_SYNC_KEYS.every(k => S.SK_LOCAL_KEYS.indexOf(k) < 0));
    check('every internal key is also a declared key with a default',
      S.SK_INTERNAL_KEYS.every(k => k in S.SK_DEFAULTS));
  }

  /* ---------------------------------------------------------------- */
  section('the sync/local partition — where a value physically goes');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const S = load(chrome);
    const r = await S.skSetSettings({ theme: 'dark', skPersistAsked: true });
    check('the write reports ok', r.ok === true, JSON.stringify(r));
    check('a profile-shaped setting went to storage.sync', chrome.storage.sync.__data.theme === 'dark');
    check('a device-shaped setting went to storage.local', chrome.storage.local.__data.skPersistAsked === true);
    check('...and did NOT go to sync. This is the whole point of the partition: sync means\n' +
      '        Google\'s servers for anyone signed in, and "we already asked for persistence"\n' +
      '        is a fact about THIS DEVICE',
      !('skPersistAsked' in chrome.storage.sync.__data),
      JSON.stringify(chrome.storage.sync.__data));
    check('...and the synced half carries no device-shaped key at all',
      Object.keys(chrome.storage.sync.__data).every(k => S.SK_LOCAL_KEYS.indexOf(k) < 0));

    const s = await S.skGetSettings();
    check('a read reassembles both halves, so the partition is invisible to callers',
      s.theme === 'dark' && s.skPersistAsked === true);
  }

  /* ---------------------------------------------------------------- */
  section('a write that cannot succeed says so — it never throws');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const S = load(chrome);
    const big = 'x'.repeat(9000);
    const r = await S.skSetSettings({ theme: big });
    check('an oversized sync value is REFUSED with a message key, not a sentence',
      r.ok === false && r.reason === 'reasonSettingTooBig', JSON.stringify(r));
    check('the size is MEASURED before the write, so nothing was written',
      chrome.storage.sync.writes === 0, chrome.storage.sync.writes);
    check('...not even the valid half of the same patch', chrome.storage.local.writes === 0);
    check('the ceiling is the documented chrome.storage.sync per-item limit',
      S.SK_SYNC_ITEM_BYTES === 8192, S.SK_SYNC_ITEM_BYTES);
  }
  {
    const chrome = H.makeChrome();
    const S = load(chrome);
    chrome.storage.sync.failSet = new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
    let threw = null, r = null;
    try { r = await S.skSetSettings({ theme: 'dark' }); } catch (e) { threw = e; }
    check('an engine rejection does not escape — this used to be an unhandled rejection\n' +
      '        with no "Saved" note and no error, in a form still showing a value that is\n' +
      '        not in effect', threw === null, threw && threw.message);
    check('...it comes back as a declared reason key',
      r && r.ok === false && r.reason === 'reasonSettingsWriteFailed', JSON.stringify(r));
    check('...and the raw rejection still reaches the console for a developer',
      S.__console.lines.some(l => /settings write failed/.test(l)), S.__console.lines.join(' | '));
  }
  {
    const chrome = H.makeChrome();
    chrome.storage.sync.failGet = new Error('storage unavailable');
    chrome.storage.local.failGet = new Error('storage unavailable');
    const S = load(chrome);
    let threw = null, s = null;
    try { s = await S.skGetSettings(); } catch (e) { threw = e; }
    check('a READ that fails does not throw either — a settings read must not be able to\n' +
      '        break the feature that asked', threw === null, threw && threw.message);
    check('...it falls back to the defaults', s && s.theme === 'system');
  }
  {
    const S = load(undefined);   // no chrome global at all
    const s = await S.skGetSettings();
    check('a context with no chrome binding reads defaults instead of exploding', s.theme === 'system');
    const r = await S.skSetSettings({ theme: 'dark' });
    check('...and a write there reports a declared reason', r.ok === false && !!r.reason, JSON.stringify(r));
  }

  /* ---------------------------------------------------------------- */
  section('reset — the one category of data that leaves the machine');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome({
      sync: { theme: 'dark', keepHistory: true, historyLimit: 5 },
      local: { skPersistAsked: true }
    });
    const S = load(chrome);
    const r = await S.skResetSettings();
    check('reset reports ok', r.ok === true, JSON.stringify(r));
    const s = await S.skGetSettings();
    check('every declared key is back to its default',
      s.theme === 'system' && s.keepHistory === false && s.historyLimit === 50 && s.skPersistAsked === false,
      JSON.stringify(s));
    check('the schema stamp is re-written rather than left dangling',
      chrome.storage.sync.__data[S.SK_VERSION_KEY] === S.SK_SETTINGS_VERSION,
      chrome.storage.sync.__data[S.SK_VERSION_KEY]);
  }

  /* ---------------------------------------------------------------- */
  section('install is not "this user is new"');
  /* ---------------------------------------------------------------- */
  {
    /* onInstalled fires with reason 'install' on the SECOND DEVICE of a
       signed-in profile, where sync has already replicated everything. The
       listener used to answer that by writing SK_DEFAULTS over the top. */
    const chrome = H.makeChrome({ sync: { theme: 'dark', historyLimit: 7 } });
    const S = load(chrome);
    const s = await S.skInitSettings();
    check('skInitSettings on a profile that already holds settings keeps them',
      s.theme === 'dark' && s.historyLimit === 7, JSON.stringify(s));
    check('...in storage too, not just in the returned object',
      chrome.storage.sync.__data.theme === 'dark');
    check('an absent key still gets its default', s.retentionDays === 30);
    check('skInitSettings is skMigrateSettings — one code path, so the two cannot drift',
      S.skInitSettings.toString().indexOf('skMigrateSettings') >= 0);
  }

  /* ---------------------------------------------------------------- */
  section('migration engine (real code, tool-shaped schema injected)');
  /* ---------------------------------------------------------------- */
  note('SK_SETTINGS_VERSION -> 3 and two migration functions, at the two PLACEHOLDER sites.');
  {
    const w = withSchema();
    const chrome = H.makeChrome();
    const S = load(chrome, w);
    const s = await S.skMigrateSettings();
    check('a profile with NO stamp and NOT ONE declared key is BORN at the current schema',
      s[S.SK_VERSION_KEY] === 3, s[S.SK_VERSION_KEY]);
    check('...so no historical migration runs against defaults it was never shaped by',
      w.MIG.ran.length === 0, w.MIG.ran.join(','));
  }
  {
    const w = withSchema();
    const chrome = H.makeChrome({ sync: { theme: 'dark' } });   // one key, no stamp
    const S = load(chrome, w);
    const s = await S.skMigrateSettings();
    check('a profile holding ONE declared key and no stamp starts at version 0',
      w.MIG.ran.join(',') === '2,3', w.MIG.ran.join(','));
    check('...migrations run IN ORDER and their effects are in the result',
      s.historyLimit === 22 && s.retentionDays === 33, JSON.stringify(s));
    check('...and it ends stamped at the current version', s[S.SK_VERSION_KEY] === 3);
    check('...the stamp is persisted to the SYNCED half, so a second device does not re-run them',
      chrome.storage.sync.__data[S.SK_VERSION_KEY] === 3);
  }
  {
    const w = withSchema();
    const chrome = H.makeChrome({ sync: { theme: 'dark', skSchemaVersion: 2 } });
    const S = load(chrome, w);
    await S.skMigrateSettings();
    check('a profile stamped 2 runs only what is outstanding', w.MIG.ran.join(',') === '3', w.MIG.ran.join(','));
  }
  {
    const w = withSchema();
    const chrome = H.makeChrome({ sync: { theme: 'dark', skSchemaVersion: 9 } });
    const S = load(chrome, w);
    const before = chrome.storage.sync.writes;
    const s = await S.skMigrateSettings();
    check('a profile stamped NEWER than this build runs nothing', w.MIG.ran.length === 0, w.MIG.ran.join(','));
    check('...and is not written to at all. Two devices, one profile, one updated first:\n' +
      '        re-stamping downward would make the newer build re-run migrations over data\n' +
      '        that has already been through them, undetectably',
      chrome.storage.sync.writes === before, chrome.storage.sync.writes + ' vs ' + before);
    check('...the stored stamp is still 9', chrome.storage.sync.__data[S.SK_VERSION_KEY] === 9);
    check('...and the caller gets the settings as they are', s.theme === 'dark');
    check('...with a console line naming the situation',
      S.__console.lines.some(l => /profile is at schema 9/.test(l)), S.__console.lines.join(' | '));
  }
  {
    const w = withSchema({ throwAt: 3 });
    const chrome = H.makeChrome({ sync: { theme: 'dark', skSchemaVersion: 1 } });
    const S = load(chrome, w);
    const s = await S.skMigrateSettings();
    check('a migration that throws is caught', w.MIG.ran.join(',') === '2,3', w.MIG.ran.join(','));
    check('...and the stamp STOPS at the last one that succeeded. Stamping past it would\n' +
      '        mark the profile migrated with half-converted data and guarantee the\n' +
      '        migration never runs again on that device',
      s[S.SK_VERSION_KEY] === 2, s[S.SK_VERSION_KEY]);
    check('...the version it failed on is recorded locally', s.skMigrationFailedAt === 3, s.skMigrationFailedAt);
    check('...the marker is a LOCAL key, so it cannot ask a healthy device to re-run',
      chrome.storage.local.__data.skMigrationFailedAt === 3 &&
      !('skMigrationFailedAt' in chrome.storage.sync.__data));
    check('...and migration 2\'s work is kept, not rolled back', s.historyLimit === 22);
  }
  {
    /* The next update, with the bug fixed: it starts again from exactly where
       it stopped, and the marker is cleared on the run that finally succeeds. */
    const w = withSchema();
    const chrome = H.makeChrome({
      sync: { theme: 'dark', skSchemaVersion: 2 },
      local: { skMigrationFailedAt: 3 }
    });
    const S = load(chrome, w);
    const s = await S.skMigrateSettings();
    check('the retry resumes at the failed version', w.MIG.ran.join(',') === '3', w.MIG.ran.join(','));
    check('...reaches the current schema', s[S.SK_VERSION_KEY] === 3);
    check('...and clears the marker, so it means "still broken" and not "was broken once"',
      s.skMigrationFailedAt === 0, s.skMigrationFailedAt);
  }
  {
    /* A key that changed area. Leaving the old copy in sync means the value is
       still being replicated after the code stopped reading it. */
    const w = withSchema();
    const chrome = H.makeChrome({
      sync: { theme: 'dark', skPersistAsked: true },     // a LOCAL key stranded in sync
      local: { keepHistory: true }                       // a SYNC key stranded in local
    });
    const S = load(chrome, w);
    await S.skMigrateSettings();
    check('a local-only key found in sync is REMOVED from sync',
      !('skPersistAsked' in chrome.storage.sync.__data), JSON.stringify(chrome.storage.sync.__data));
    check('a synced key found in local is removed from local',
      !('keepHistory' in chrome.storage.local.__data), JSON.stringify(chrome.storage.local.__data));
    check('...and both values survive the move, in their right areas',
      chrome.storage.local.__data.skPersistAsked === true && chrome.storage.sync.__data.keepHistory === true);
  }

  /* ---------------------------------------------------------------- */
  section('live changes');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const S = load(chrome);
    const seen = [];
    S.skOnSettingsChanged(patch => seen.push(patch));

    await chrome.storage.sync.set({ theme: 'dark' });
    check('a declared sync key changing in the sync area is delivered',
      seen.length === 1 && seen[0].theme === 'dark', JSON.stringify(seen));

    await chrome.storage.local.set({ skPersistAsked: true });
    check('a declared local key changing in the local area is delivered',
      seen.length === 2 && seen[1].skPersistAsked === true, JSON.stringify(seen));

    await chrome.storage.sync.set({ skPersistAsked: false });
    check('the SAME key arriving from the WRONG area is ignored — a stale copy left in\n' +
      '        sync must not be able to overwrite the device\'s own value',
      seen.length === 2, JSON.stringify(seen));

    await chrome.storage.sync.set({ somethingUndeclared: 1 });
    check('an undeclared key is ignored', seen.length === 2, JSON.stringify(seen));

    await chrome.storage.sync.set({ theme: 'light', alsoUndeclared: 2 });
    check('a mixed change delivers only the declared half',
      seen.length === 3 && Object.keys(seen[2]).join(',') === 'theme', JSON.stringify(seen[2]));
  }

  /* ---------------------------------------------------------------- */
  section('TEETH — every check above, re-run against broken source');
  /* ---------------------------------------------------------------- */
  note('If a mutation stops applying, harness.mutate() throws rather than passing quietly.');

  await H.expectBroken('the partition check depends on areaFor()', async () => {
    const src = H.mutate(SRC,
      "  function areaFor(key) { return SK_LOCAL_KEYS.indexOf(key) >= 0 ? 'local' : 'sync'; }",
      "  function areaFor(key) { return 'sync'; }");
    const chrome = H.makeChrome();
    const S = load(chrome, { source: src });
    await S.skSetSettings({ theme: 'dark', skPersistAsked: true });
    return !('skPersistAsked' in chrome.storage.sync.__data);
  });

  await H.expectBroken('the oversize check depends on the measured ceiling', async () => {
    const src = H.mutate(SRC,
      "      if (bytes > SK_SYNC_ITEM_BYTES) return { ok: false, reason: 'reasonSettingTooBig' };",
      '');
    const chrome = H.makeChrome();
    const S = load(chrome, { source: src });
    const r = await S.skSetSettings({ theme: 'x'.repeat(9000) });
    return r.ok === false && r.reason === 'reasonSettingTooBig' && chrome.storage.sync.writes === 0;
  });

  await H.expectBroken('the never-throws check depends on the catch in skSetSettings', async () => {
    const src = H.mutate(SRC,
      "      return { ok: false, reason: 'reasonSettingsWriteFailed' };\n    }\n    return { ok: true };",
      '      throw e;\n    }\n    return { ok: true };');
    const chrome = H.makeChrome();
    chrome.storage.sync.failSet = new Error('quota');
    const S = load(chrome, { source: src });
    try { await S.skSetSettings({ theme: 'dark' }); } catch (_) { return false; }
    return true;
  });

  await H.expectBroken('the newer-profile check depends on the downgrade guard', async () => {
    const w = withSchema();
    w.source = H.mutate(w.source, '    if (from > SK_SETTINGS_VERSION) {', '    if (false) {');
    const chrome = H.makeChrome({ sync: { theme: 'dark', skSchemaVersion: 9 } });
    const S = load(chrome, w);
    const before = chrome.storage.sync.writes;
    await S.skMigrateSettings();
    return w.MIG.ran.length === 0 && chrome.storage.sync.writes === before;
  });

  await H.expectBroken('the stop-at-the-failure check depends on the break in the catch', async () => {
    const w = withSchema({ throwAt: 2 });
    w.source = H.mutate(w.source, '          failedAt = v;\n          break;', '          failedAt = v;');
    const chrome = H.makeChrome({ sync: { theme: 'dark', skSchemaVersion: 1 } });
    const S = load(chrome, w);
    const s = await S.skMigrateSettings();
    return s[S.SK_VERSION_KEY] === 1;
  });

  await H.expectBroken('the born-at-current-schema check depends on the held.length branch', async () => {
    const w = withSchema();
    w.source = H.mutate(w.source,
      '      : (held.length ? 0 : SK_SETTINGS_VERSION);',
      '      : 0;');
    const chrome = H.makeChrome();
    const S = load(chrome, w);
    await S.skMigrateSettings();
    return w.MIG.ran.length === 0;
  });

  await H.expectBroken('the wrong-area check depends on the areaFor test in the listener', async () => {
    const src = H.mutate(SRC,
      '        if (k in SK_DEFAULTS && areaFor(k) === area) { patch[k] = changes[k].newValue; any = true; }',
      '        if (k in SK_DEFAULTS) { patch[k] = changes[k].newValue; any = true; }');
    const chrome = H.makeChrome();
    const S = load(chrome, { source: src });
    const seen = [];
    S.skOnSettingsChanged(p => seen.push(p));
    await chrome.storage.sync.set({ skPersistAsked: false });
    return seen.length === 0;
  });
}

main().then(() => process.exit(H.finish()), e => {
  console.error('\nSIM CRASHED — this is a failure, not a skip:\n', e);
  process.exit(1);
});
