/* SKELETON — settings: defaults, storage partition, schema version, migrations.

   This is the ONE definition of what the tool remembers. A plain script on
   purpose: the service worker importScripts()es it and every extension page
   <script src>es it, so background and pages read the same object. The
   alternative — a DEFAULTS literal in background.js and a second one in
   pages/common.js — drifts the first time somebody adds a setting to one of
   them, and the symptom (a feature that behaves differently depending on which
   half of the extension asked) is expensive to find. Keep it that way.

   Storage areas, and why:
     chrome.storage.sync    settings that FOLLOW THE USER'S PROFILE. Read the
                            partition note below before you put a key here: sync
                            means Google's servers, for anyone signed in with
                            sync on.
     chrome.storage.local   settings that belong to THIS DEVICE and must not
                            leave it.
     chrome.storage.session the last-failure note and the in-flight job table
                            (background.js, lib/jobs.js). Dies with the browser,
                            never syncs, origin only.
     IndexedDB (lib/storage.js)  anything large or listable, and everything the
                            user must be able to see, export and delete.

   THE PARTITION, AND WHY IT IS TWO LISTS AND NOT ONE STORE.

   chrome.storage.sync is not "storage that happens to sync". For a signed-in
   user with sync on it is an upload: the value is transmitted to Google and
   replicated to every device on the account. The product says "no network
   calls" and means it about its own code, and that claim survives storage.sync
   only if what goes in there is genuinely profile-shaped — a theme, a boolean,
   a numeric cap.

   The moment a tool needs a free-text preference — a filename template naming a
   client, a per-site rule keyed by hostname, a redaction wordlist, an allowed
   domain list, a last-used folder — the single-store design puts page-derived
   or workplace-identifying text into that upload, because there is nowhere else
   to put it and nothing said not to. So there are two lists, and the DEFAULT
   FOR A NEW KEY IS LOCAL.

     A key goes in SK_SYNC_KEYS only if you would be comfortable seeing its
     value in a Google account export.

   Moving a key between areas later is a real migration in every copy of this
   skeleton, and it cannot un-replicate what has already been uploaded. Decide
   now; it costs one line.

   SYNC HAS HARD LIMITS the local area does not: 8 KB per item, 100 KB total,
   120 writes per minute, 1,800 per hour. They are why settings are settings and
   payload is IndexedDB, and why skSetSettings measures an item before it sends
   it rather than letting the rejection escape into an unhandled promise.
*/
(function (root) {
  'use strict';

  /* PLACEHOLDER(settings) — the tool's settings. Every key needs a default
     here, a line in exactly one of the two key lists below, a row in
     pages/options.html, and an entry in pages/options.js FIELDS.
     Default to OFF for anything that stores or reveals more than the tool needs
     to do its single job — the user turns it on, not you. */
  const SK_DEFAULTS = {
    theme: 'system',       // system | light | dark
    keepHistory: false,    // store what the tool produces so it can be listed later
    copyOnOpen: false,     // copy the result the moment the popup opens
    historyLimit: 50,      // hard cap on stored rows; oldest are dropped first
    retentionDays: 30,     // rows older than this are swept; 0 = no age limit
    skPersistAsked: false, // navigator.storage.persist() has been requested once
    skMigrationFailedAt: 0 // the schema version a migration threw on; 0 = clean
  };

  /* Profile-shaped, and nothing in here would identify a person, a workplace or
     a page if it appeared in an account export. */
  const SK_SYNC_KEYS = ['theme', 'keepHistory', 'copyOnOpen', 'historyLimit', 'retentionDays'];

  /* This device only.
     skPersistAsked is the worked example of why the list exists: durability is
     granted per origin PER DEVICE, so syncing "we already asked" would make a
     second device skip the request it has never actually made and sit in the
     best-effort bucket for good. A device-shaped fact belongs to the device.
     skMigrationFailedAt is local for the same reason in reverse: the migration
     failed on THIS machine's copy of the data, and syncing the marker would ask
     a device whose data is fine to re-run a migration it does not need. */
  const SK_LOCAL_KEYS = ['skPersistAsked', 'skMigrationFailedAt'];

  /* Keys with NO control on the options page: internal bookkeeping the user
     does not set. They are declared here rather than simply omitted, so the
     sim's settings↔html↔js parity check can tell "deliberately internal" from
     "somebody added a preference and forgot the row for it" — which is the
     drift that check exists to catch, and which an undeclared exception would
     hide. An internal key still needs a default and an area, and it still shows
     up in a problem report as a value. */
  const SK_INTERNAL_KEYS = ['skPersistAsked', 'skMigrationFailedAt'];

  /* Bump when a stored key changes MEANING, NAME or STORAGE AREA (not when you
     merely add one — a new key gets its default from SK_DEFAULTS on the next
     read). Then add the matching function to SK_MIGRATIONS. */
  const SK_SETTINGS_VERSION = 1;

  /* PLACEHOLDER(migrations) — keyed by the version they migrate TO. Each is
     handed a plain settings object and mutates it in place. They run in order,
     once, and never see the network or the DOM.
       2: (s) => { s.newName = s.oldName; delete s.oldName; },
       3: (s) => { if (s.limit > 500) s.limit = 500; }
     Keep old entries forever: an install that skipped four versions runs all
     four on its next update, in order.
     A key that MOVED between areas needs no migration function — skMigrate
     Settings re-homes every declared key by itself and deletes the copy left in
     the wrong area. It cannot un-sync what was already uploaded, which is the
     argument for getting the partition right the first time. */
  const SK_MIGRATIONS = {
    // 1 is the initial schema — nothing to migrate to it.
  };

  /* The schema stamp itself lives with the synced half, so an update that lands
     on a second device does not re-run migrations that already ran. */
  const SK_VERSION_KEY = 'skSchemaVersion';

  /* chrome.storage.sync's documented per-item ceiling. Measured BEFORE the
     write, so an oversized value produces a declared reason instead of an
     engine rejection nobody catches. A settings value anywhere near this is
     payload wearing a setting's clothes: put it in IndexedDB. */
  const SK_SYNC_ITEM_BYTES = 8192;

  function areaFor(key) { return SK_LOCAL_KEYS.indexOf(key) >= 0 ? 'local' : 'sync'; }

  function areaApi(name) {
    try { return (chrome.storage && chrome.storage[name]) || null; } catch (_) { return null; }
  }

  /* Read: defaults, then whatever the profile actually holds, from BOTH areas.
     Never throws; a settings read must not be able to break the feature that
     asked.
     The returned object's key set is EXACTLY SK_DEFAULTS' key set: the schema
     stamp is bookkeeping, not a setting, and a caller that iterated the result
     would otherwise render a row for it. */
  async function skGetSettings() {
    let fromSync = {}, fromLocal = {};
    try { fromSync = (areaApi('sync') && await chrome.storage.sync.get(SK_SYNC_KEYS)) || {}; } catch (_) {}
    try { fromLocal = (areaApi('local') && await chrome.storage.local.get(SK_LOCAL_KEYS)) || {}; } catch (_) {}
    return Object.assign({}, SK_DEFAULTS, fromSync, fromLocal);
  }

  /* THIS FUNCTION NEVER THROWS AND NEVER REJECTS.

     It used to await chrome.storage.sync.set and hand the rejection straight to
     its caller, and its caller — the options page — awaited it with no catch.
     So a real write failure (the per-item ceiling, the write-rate limiter after
     a burst) became an unhandled rejection: no "Saved" note, no error, and a
     form still displaying a value that is not in effect. A settings write that
     can fail silently makes "what am I actually running?" unanswerable, which
     makes every later bug report ambiguous.

     Returns { ok: true } or { ok: false, reason } where `reason` is a MESSAGE
     KEY from the catalogue, never a sentence and never engine text. */
  async function skSetSettings(patch) {
    const p = patch || {};
    const bySync = {}, byLocal = {};
    let anySync = false, anyLocal = false;

    for (const key of Object.keys(p)) {
      if (areaFor(key) === 'local') { byLocal[key] = p[key]; anyLocal = true; }
      else { bySync[key] = p[key]; anySync = true; }
    }

    /* Measured, not caught. The engine's rejection for an oversized item is
       prose we would then have to classify; the size is a number we already
       have. TextEncoder is not available in every context this file loads in,
       so the length of the JSON is the measure — it is an under-count for
       astral characters, which errs toward refusing early, and refusing early
       is the safe direction. */
    for (const key of Object.keys(bySync)) {
      let bytes = 0;
      try { bytes = (key + JSON.stringify(bySync[key])).length; } catch (_) { bytes = SK_SYNC_ITEM_BYTES + 1; }
      if (bytes > SK_SYNC_ITEM_BYTES) return { ok: false, reason: 'reasonSettingTooBig' };
    }

    try {
      if (anySync) await chrome.storage.sync.set(bySync);
      if (anyLocal) await chrome.storage.local.set(byLocal);
    } catch (e) {
      // The raw rejection goes to the console for a developer; the caller gets
      // a declared key, exactly as the worker's error path does.
      console.error('SKELETON settings write failed:', e);
      return { ok: false, reason: 'reasonSettingsWriteFailed' };
    }
    return { ok: true };
  }

  /* Every declared key back to its default, in both areas, and the schema stamp
     re-written. This is what makes "anything stored is reachable and deletable"
     TRUE of settings — before it existed, the one category of data that leaves
     the machine was the one category the product offered no way to remove. */
  async function skResetSettings() {
    try {
      if (areaApi('sync')) await chrome.storage.sync.remove(SK_SYNC_KEYS.concat([SK_VERSION_KEY]));
      if (areaApi('local')) await chrome.storage.local.remove(SK_LOCAL_KEYS);
    } catch (e) {
      console.error('SKELETON settings reset failed:', e);
      return { ok: false, reason: 'reasonSettingsWriteFailed' };
    }
    const seeded = Object.assign({}, SK_DEFAULTS);
    seeded[SK_VERSION_KEY] = SK_SETTINGS_VERSION;
    return skSetSettings(seeded);
  }

  /* Idempotent: safe to call on install, on update, and on every options-page
     load. Returns the settings as they are AFTER migrating.

     THREE THINGS THIS FUNCTION IS NOT ALLOWED TO DO, each of which it used to.

     1. It must never treat a profile that already holds settings as blank. See
        skInitSettings below — `reason: 'install'` is not "this user is new".
     2. It must never write the stamp DOWNWARD. Two devices on one profile,
        one of them updated first: the old build reads a version it has no
        migrations for, and re-stamping it to its own number makes the newer
        build re-run migrations 2..4 over data that has already been through
        them. There is no way to detect that afterwards, so the only safe move
        is to leave a newer profile completely alone.
     3. It must never stamp PAST a migration that threw. Catching the throw is
        right; recording it as done is not — it marks the profile as migrated
        with half-converted data and guarantees the migration never runs again
        on that device. It stops at the failure, records the version it failed
        on, and the next update tries again. */
  async function skMigrateSettings() {
    let inSync = {}, inLocal = {};
    try { inSync = (areaApi('sync') && await chrome.storage.sync.get(null)) || {}; } catch (_) {}
    try { inLocal = (areaApi('local') && await chrome.storage.local.get(null)) || {}; } catch (_) {}

    const s = Object.assign({}, SK_DEFAULTS, inSync, inLocal);

    /* A profile with no stamp and not one declared key has never been written
       by this tool: it is BORN at the current schema and no historical
       migration should run against defaults it was never shaped by. Anything
       else — one key, one stamp — is data, and data starts at version 0 unless
       it says otherwise. */
    const held = SK_SYNC_KEYS.concat(SK_LOCAL_KEYS)
      .filter(k => Object.prototype.hasOwnProperty.call(inSync, k) ||
                   Object.prototype.hasOwnProperty.call(inLocal, k));
    const stamped = Object.prototype.hasOwnProperty.call(inSync, SK_VERSION_KEY);
    const from = stamped ? (Number(inSync[SK_VERSION_KEY]) || 0)
      : (held.length ? 0 : SK_SETTINGS_VERSION);

    /* (2) A newer profile is returned as it is: nothing migrated, nothing
       re-homed, nothing written. A build that does not understand the data is
       not the build that should be tidying it. */
    if (from > SK_SETTINGS_VERSION) {
      console.error('SKELETON settings: profile is at schema ' + from +
        ' but this build only understands ' + SK_SETTINGS_VERSION +
        ' — leaving it untouched. Update the extension.');
      return s;
    }

    let reached = from, failedAt = 0;
    for (let v = from + 1; v <= SK_SETTINGS_VERSION; v++) {
      const fn = SK_MIGRATIONS[v];
      if (fn) {
        try { fn(s); }
        catch (e) {
          // (3) Stop here. Everything below v is applied and recorded; v itself
          // is not, so the next update starts again from exactly this point.
          console.error('SKELETON migration ' + v + ' failed:', e);
          failedAt = v;
          break;
        }
      }
      reached = v;
    }
    s[SK_VERSION_KEY] = reached;
    /* Cleared on the run that finally succeeds, so the marker means "still
       broken" and not "was broken once". It is a local, internal key, which
       means a problem report carries it without anyone having to remember to
       add it — that is the only way a solo maintainer finds out this happened. */
    s.skMigrationFailedAt = failedAt;

    /* Re-home anything sitting in the wrong area. A key that used to sync and
       is now local is the case that matters: leaving the old copy in sync means
       the value is still being replicated after the code stopped reading it. */
    const strayInSync = SK_LOCAL_KEYS.filter(k => Object.prototype.hasOwnProperty.call(inSync, k));
    if (strayInSync.length) {
      try { await chrome.storage.sync.remove(strayInSync); } catch (_) {}
    }
    const strayInLocal = SK_SYNC_KEYS.filter(k => Object.prototype.hasOwnProperty.call(inLocal, k));
    if (strayInLocal.length) {
      try { await chrome.storage.local.remove(strayInLocal); } catch (_) {}
    }

    const write = {};
    for (const k of SK_SYNC_KEYS.concat(SK_LOCAL_KEYS)) write[k] = s[k];
    write[SK_VERSION_KEY] = reached;
    await skSetSettings(write);
    return s;
  }

  /* THE ONLY THING background.js's onInstalled listener should call, on EVERY
     reason — install, update, chrome_update, shared_module_update.

     `reason: 'install'` does not mean "this user is new". It fires on the
     SECOND DEVICE of a signed-in profile, where chrome.storage.sync has already
     replicated everything from the first one, and it fires again after a
     remove-and-reinstall. The listener used to answer that with

         skSetSettings(Object.assign({}, SK_DEFAULTS, { [SK_VERSION_KEY]: … }))

     which is a settings wipe on every device on the account, plus — because it
     stamped the current version at the same time — a permanent block on the
     migration that should have converted those values. Two losses from one
     line, and the second one is silent.

     There is nothing an install needs that a migrate does not already do:
     skMigrateSettings starts from SK_DEFAULTS, layers whatever the profile
     actually holds on top, runs whatever is outstanding, and writes every
     declared key back. An absent key gets its default; a present key is left
     alone. So this is a named alias rather than a second code path — a second
     code path is how the two drift. */
  async function skInitSettings() {
    return skMigrateSettings();
  }

  /* Live updates: options page writes, popup and worker see it without a
     reload. Both areas, because the partition must be invisible to callers. */
  function skOnSettingsChanged(fn) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      const patch = {};
      let any = false;
      for (const k of Object.keys(changes)) {
        if (k in SK_DEFAULTS && areaFor(k) === area) { patch[k] = changes[k].newValue; any = true; }
      }
      if (any) fn(patch);
    });
  }

  const api = { SK_DEFAULTS, SK_SYNC_KEYS, SK_LOCAL_KEYS, SK_INTERNAL_KEYS, SK_SETTINGS_VERSION,
                SK_MIGRATIONS, SK_VERSION_KEY, SK_SYNC_ITEM_BYTES,
                skGetSettings, skSetSettings, skResetSettings, skMigrateSettings,
                skInitSettings, skOnSettingsChanged };

  /* Node can require() this file for a pure-core sim; the browser gets globals. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this);
