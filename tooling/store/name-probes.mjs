#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// name-probes.mjs — THE PER-CHANNEL PROBE TABLE. One entry per channel id in
// `tooling/channel-register.json`; each entry knows what authority can be asked
// about a name on that channel, and — the half that makes the answer worth
// anything — what RED CONTROL proves that authority answered at all.
//
// 🔴 NOT A GUARD. Pure table plus pure functions: an injected `http` in, a
// verdict out. It walks no tree, reads no file and exits nowhere, so "did my
// scan still reach the tree" belongs to `tooling/store/name-clearance.mjs`,
// which is the one caller and which carries its own COVERAGE LOST over the
// register it read. It is `tooling/store/` and not `tooling/ci/` on purpose:
// `assert-guard-coverage.mjs` treats every `.mjs` under `tooling/ci` as a guard,
// and this is a tool's data.
//
// ── THE ONE RULE: THREE ANSWERS, NEVER TWO ───────────────────────────────────
//   PROVEN-TAKEN   a record was READ that holds the name. Evidence attached.
//   PROVEN-FREE    an authority ANSWERED "no such record", AND a red control
//                  proved on the same run, over the same transport, that the
//                  authority answers at all.
//   UNDETERMINED   everything else — no API, a JS-rendered page, a dead
//                  network, a control that did not go green. NEVER a pass.
//
// "Not found" is not "free". A store search page that renders in JavaScript
// returns an empty body to a fetch; an unauthenticated 404 can mean free, can
// mean reserved-but-unpublished, can mean rate-limited, can mean down. A probe
// that collapses those into "clear" is worse than no probe, because it also
// carries the belief that something was checked.
//
// ── EVERY PROBE DECLARES A RED CONTROL, AND DOWNGRADES ITSELF ────────────────
// Before the real query, the probe asks a second question whose answer is KNOWN
// NON-EMPTY, over the same transport, on the same run. If the control does not
// come back the probe answers UNDETERMINED about its own subject — because a
// "no hit" from an endpoint that is down is indistinguishable from a "no hit"
// from an endpoint that is up. Green control first, every time.
//
// The five controls below were each verified live on 2026-09-09:
//   iTunes Search/lookup   lookup?bundleId=com.google.Gmail   1 result, "Gmail"
//   Google Play details    details?id=com.spotify.music       HTTP 200
//   Snap Store             v2/snaps/info/firefox              HTTP 200
//   Firefox AMO            search/?q=ublock                   non-zero count
//   Microsoft winget       manifestSearch KeyWord "firefox"   non-empty Data
//
// ── WHAT THE HONEST "NO" ANSWERS ARE ─────────────────────────────────────────
// APPLE HAS NO NAME-AVAILABILITY ENDPOINT. The only authority is the App Store
// Connect "New App" dialog, and asking it means CREATING A RECORD, which is
// forbidden here. The iTunes Search API indexes PUBLISHED apps, so it proves
// TAKEN brilliantly and FREE not at all — a name reserved this morning for an
// unreleased app is invisible to it. A no-hit is UNDETERMINED with the manual
// step named.
//
// A SNAP NAME REGISTERED-BUT-UNPUBLISHED 404s IDENTICALLY TO A FREE ONE. The
// namespace is claimed by `snapcraft register`, not by publication. A 404
// proves "no published snap", which is not "registerable". UNDETERMINED.
//
// MICROSOFT'S ONLY AUTHORITY IS THE RESERVATION ITSELF. The Partner Center
// dialog answers availability BY RESERVING, which is a mutation and a
// three-month submit-or-lose clock. Refused here and named as an owner-only
// manual step. The winget catalogue is an advisory index, nothing more.
//
// ── WHAT `uniqueness` CHANGES ────────────────────────────────────────────────
//   global     the store REFUSES a duplicate name — a hit is a wall
//   tolerated  duplicates ship every day — a hit is a discoverability cost
//   none       no third party holds a name on this channel at all
// It is declared HERE and not in the register because it is a property of the
// probe's reading of the store, not of the release lane the register describes.
// ─────────────────────────────────────────────────────────────────────────────

/** The three answers, and the fourth non-answer for a channel with no namespace. */
export const PROVEN_FREE = 'PROVEN-FREE';
export const PROVEN_TAKEN = 'PROVEN-TAKEN';
export const UNDETERMINED = 'UNDETERMINED';
export const NOT_APPLICABLE = 'NOT-APPLICABLE';
/** The fifth, and NO PROBE IN THIS TABLE RETURNS IT. HELD is the owner's record
 *  that the name is reserved in the store's own console, with the store's record
 *  id — a reservation an unauthenticated read cannot see, so only
 *  `name-clearance.mjs --hold` writes it and `--execute` carries it forward. */
export const HELD = 'HELD';
export const VERDICTS = Object.freeze([PROVEN_FREE, PROVEN_TAKEN, UNDETERMINED, NOT_APPLICABLE, HELD]);

export const GLOBAL = 'global';
export const TOLERATED = 'tolerated';
export const NONE = 'none';

/** NFKC + case fold. Store names differ by width and by case and mean the same
 *  thing to a human and to a reviewer; a byte comparison would report FREE on a
 *  full-width duplicate. */
export const norm = (s) => String(s ?? '').normalize('NFKC').trim().toLowerCase();

const answer = (verdict, why, evidence = [], control = null) => ({ verdict, why, evidence, control });

/** A control result. `green` is the only field the caller reads; `what` is what
 *  gets printed when it is false, because "the control failed" with no name is
 *  an excuse rather than a measurement. */
const control = (what, green, detail) => ({ what, green, detail });

// ── the shared Apple limb — iOS and macOS differ only by `entity` ────────────
async function itunes({ http, name }, entity, label) {
  const c = await http('https://itunes.apple.com/lookup?bundleId=com.google.Gmail');
  const cj = c.json;
  const ctl = control(
    'itunes.apple.com/lookup?bundleId=com.google.Gmail (known present: "Gmail - Email by Google")',
    Boolean(cj && cj.resultCount >= 1),
    `HTTP ${c.status}, resultCount ${cj?.resultCount ?? 'unparseable'}`,
  );
  if (!ctl.green) {
    return answer(
      UNDETERMINED,
      'RED CONTROL FAILED — the iTunes Search API did not return the known-present control record, so a ' +
        '"no hit" from it on this run carries no information at all.',
      [],
      ctl,
    );
  }
  const r = await http(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=${entity}&limit=200&country=us`);
  const j = r.json;
  if (!j || !Array.isArray(j.results)) {
    return answer(UNDETERMINED, `iTunes Search returned HTTP ${r.status} with no parseable result set.`, [], ctl);
  }
  const exact = j.results.filter((x) => norm(x.trackName) === norm(name));
  const near = j.results.filter((x) => norm(x.trackName) !== norm(name) && norm(x.trackName).includes(norm(name)));
  const cite = (x) => `"${x.trackName}" — ${x.sellerName} — ${x.primaryGenreName} — https://apps.apple.com/us/app/id${x.trackId}`;
  if (exact.length) {
    return answer(
      PROVEN_TAKEN,
      `App Store names are GLOBALLY UNIQUE. ${exact.length} live ${label} listing(s) already carry this exact ` +
        'name, so App Store Connect will refuse it.',
      exact.map(cite).concat(near.length ? [`+ ${near.length} near-miss listing(s) containing the word`] : []),
      ctl,
    );
  }
  if (near.length) {
    return answer(
      UNDETERMINED,
      `No EXACT ${label} name match, but ${near.length} listing(s) contain the word. Apple's search index is ` +
        'not its name-reservation table. MANUAL STEP: App Store Connect > My Apps > "+" > New App, type the ' +
        'name, read the inline error, then CANCEL without saving.',
      near.slice(0, 8).map(cite),
      ctl,
    );
  }
  return answer(
    UNDETERMINED,
    `No ${label} listing carries this name (control green, ${j.resultCount} result(s) scanned). THIS IS NOT ` +
      'PROOF OF AVAILABILITY: the search index omits unreleased and name-reserved records, and Apple exposes ' +
      'no availability endpoint short of creating a record — which is forbidden here. MANUAL STEP: the App ' +
      'Store Connect new-app dialog, read and cancelled without saving.',
    [],
    ctl,
  );
}

/** One identity probe, shared by every channel whose register row declares an
 *  `identity` block. `identity` is whatever `tooling/ci/read-identity.mjs`
 *  answered — `{ value }`, `{ missing }`, `{ lost }` or `{ absent }` — and the
 *  trichotomy is carried through rather than flattened. */
export function identityLines(identity, rel) {
  if (!identity) return { state: 'none', lines: [] };
  if (identity.absent) return { state: 'absent', lines: [`${identity.absent} is not in this tree — the app declares no identity for this channel.`] };
  if (identity.lost) return { state: 'lost', lines: [`COVERAGE LOST reading ${rel}: ${identity.lost}`] };
  if (identity.missing) return { state: 'missing', lines: [`${rel} declares no identity: ${identity.missing}`] };
  return { state: 'value', lines: [`${rel} declares ${identity.value}`] };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TABLE. Keyed by channel-register `id`. A channel in the register with no
// entry here comes out UNDETERMINED with "NO PROBE REGISTERED" — never silently
// dropped, which is what keeps this file from drifting behind the register when
// a thirteenth channel lands.
// ─────────────────────────────────────────────────────────────────────────────
export const PROBES = Object.freeze({
  // ── web — the ONE channel whose namespace is ours, so FREE is provable ──────
  web: {
    uniqueness: NONE,
    async run(ctx) {
      const { catalog, app, name } = ctx;
      if (!Array.isArray(catalog)) {
        return answer(UNDETERMINED, 'catalog/apps.json was not readable as an array, so whether this name is already ours cannot be told.');
      }
      // 🔴 SELF IS NOT A COLLISION. Re-clearing the name an app already declares
      // must not report that app against itself. The prototype's first run did
      // exactly that — `Subly` matched `catalog/apps.json`'s own Subly row — and
      // a guard that fires on every commit of the app it guards is the
      // cries-wolf shape this corpus grades as worse than no guard. The
      // catalogue row whose slug IS THIS APP is EXCLUDED — keyed on the app, not
      // on the slug the candidate NAME derives, because those coincide for a
      // re-clearance and diverge for a second app proposing the same name, which
      // is the case that must still collide. The exclusion is said out loud in
      // the evidence so it is visible rather than silent.
      const clash = catalog.filter((a) => norm(a.name) === norm(name) && norm(a.slug) !== norm(app));
      const self = catalog.filter((a) => norm(a.slug) === norm(app) && norm(a.name) === norm(name));
      const selfLine = self.length ? [`catalog/apps.json row "${self[0].slug}" carries this name — SELF, NOT A COLLISION, excluded from the comparison.`] : [];
      if (clash.length) {
        return answer(
          PROVEN_TAKEN,
          'A DIFFERENT app in our own catalogue already declares this name. Two apps cannot share one name on a namespace we control.',
          clash.map((a) => `${a.slug} — "${a.name}"`).concat(selfLine),
        );
      }
      return answer(
        PROVEN_FREE,
        'No OTHER app in catalog/apps.json declares this name, and the web host is a subdomain of a wildcard ' +
          'this factory controls ([ADR 006]), so no external party can hold it. This is the one channel whose ' +
          'namespace is ours, which is why FREE is provable here and nowhere else.',
        selfLine,
      );
    },
  },

  'ios-appstore': { uniqueness: GLOBAL, run: (ctx) => itunes(ctx, 'software', 'iOS') },
  'macos-appstore': { uniqueness: GLOBAL, run: (ctx) => itunes(ctx, 'macSoftware', 'macOS') },

  'android-play': {
    uniqueness: TOLERATED,
    async run(ctx) {
      const { http, identity, identityRel } = ctx;
      const c = await http('https://play.google.com/store/apps/details?id=com.spotify.music&hl=en&gl=us');
      const ctl = control('play.google.com details?id=com.spotify.music (known present)', c.status === 200, `HTTP ${c.status}`);
      const id = identityLines(identity, identityRel);
      if (!ctl.green) {
        return answer(UNDETERMINED, 'RED CONTROL FAILED — play.google.com did not serve the known-present control listing, so a 404 on this run means nothing.', id.lines, ctl);
      }
      if (id.state === 'lost' || id.state === 'missing') {
        return answer(UNDETERMINED, `The applicationId this app would publish under could not be read from the tree, so nothing could be asked about it.`, id.lines, ctl);
      }
      if (id.state === 'absent' || id.state === 'none') {
        return answer(
          UNDETERMINED,
          'Play TOLERATES duplicate titles, so a title hit would be advisory rather than blocking — and the store ' +
            'search surface is JS-rendered with no unauthenticated API, so no title verdict is provable here. This ' +
            'app declares no Android identity, so the permanent applicationId limb had nothing to ask about either. ' +
            'MANUAL/AUTHENTICATED STEP: a logged-in Play Console title check.',
          id.lines,
          ctl,
        );
      }
      const appId = identity.value;
      const r = await http(`https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en&gl=us`);
      if (r.status === 200) {
        return answer(
          PROVEN_TAKEN,
          `The PERMANENT applicationId this app declares is already published on Play. A package name is bound at ` +
            'the first upload and is never released or recycled, even if the app is deleted.',
          id.lines.concat([`applicationId ${appId} — HTTP 200, a published listing holds it.`]),
          ctl,
        );
      }
      if (r.status !== 404) {
        return answer(UNDETERMINED, `Play answered HTTP ${r.status} for the identifier probe — neither a listing nor a clean absence.`, id.lines, ctl);
      }
      return answer(
        UNDETERMINED,
        'Play TOLERATES duplicate titles, so a title hit would be advisory rather than blocking — but the store ' +
          'search surface is JS-rendered with no unauthenticated API, so NO TITLE VERDICT can be proven here. The ' +
          'permanent applicationId is free of any PUBLISHED listing (control green, HTTP 404); a draft in ' +
          "somebody's console would not show. MANUAL/AUTHENTICATED STEP: a logged-in Play Console title check.",
        id.lines.concat([`applicationId ${appId} — HTTP 404, no published listing holds it (control green).`]),
        ctl,
      );
    },
  },

  'linux-snap': {
    uniqueness: GLOBAL,
    async run(ctx) {
      const { http, slug, snapDeclared } = ctx;
      // 🔴 THE NAME PROBED IS THE NAME THAT WILL BE REGISTERED, AND UNTIL
      // 2026-09-09 IT WAS NOT. This probe queried `slug` — the display name with
      // every non-alphanumeric stripped — while the string `snapcraft register`
      // actually claims is the one in `snap-name.txt`. So the availability
      // verdict was about a name nobody was going to ask for: on this app it
      // answered for "nikatrusubscriptiontracker" while the tree shipped
      // "nikatru-subscription-tracker". A 404 on the wrong string is not a
      // measurement of anything, which is the one thing a clearance record may
      // never contain. `snapDeclared` was already in scope and unused for this.
      const target = snapDeclared?.value ? norm(snapDeclared.value) : slug;
      // REPO CONSISTENCY. The snap name IS the identifier, and it lives in a
      // plain text file the register does not model as an `identity` block — so
      // `read-identity.mjs` cannot answer for it and this is the one place the
      // disagreement can be seen. A rename that updates four of five files is
      // exactly the defect [10]D-3 exists to catch.
      //
      // ⚠️ COMPARED SEPARATOR-INSENSITIVELY, AND THAT IS A NARROWING WITH A
      // REASON. `slug` cannot contain a hyphen (it is built by stripping every
      // non-alphanumeric), but a snap name MAY and conventionally DOES — so a
      // byte comparison against `slug` reported every correctly hyphenated name
      // as INCONSISTENT. A guard that fires on correct input is a guard someone
      // switches off; this repo has that failure on record
      // (assert-desktop-runner-identity.mjs's header states the same rule).
      // Folding the separators keeps the defect [10]D-3 is for — a rename that
      // leaves this file holding the OLD STEM ("subscriptiontracker" against
      // "nikatrusubscriptiontracker") still differs in its letters and still
      // fires — while letting "nikatru-subscription-tracker" pass.
      const fold = (s) => norm(s).replace(/[^a-z0-9]+/g, '');
      const drift =
        snapDeclared && fold(snapDeclared.value) !== fold(slug)
          ? [`⛔ INCONSISTENT: ${snapDeclared.rel} declares "${snapDeclared.value}" and this name implies "${slug}". One app_id derives every store identity ([pipeline 10]D-3); a rename that leaves this file behind ships a snap under the old name.`]
          : [];
      const H = { 'Snap-Device-Series': '16' };
      const c = await http('https://api.snapcraft.io/v2/snaps/info/firefox', { headers: H });
      const ctl = control('api.snapcraft.io/v2/snaps/info/firefox (known present)', c.status === 200, `HTTP ${c.status}`);
      if (!ctl.green) {
        return answer(UNDETERMINED, 'RED CONTROL FAILED — api.snapcraft.io did not return the known-present control snap, so a 404 on this run means nothing.', drift, ctl);
      }
      const r = await http(`https://api.snapcraft.io/v2/snaps/info/${encodeURIComponent(target)}`, { headers: H });
      if (r.status === 200) {
        return answer(
          PROVEN_TAKEN,
          'Snap names are GLOBALLY UNIQUE and first-come. A published snap already holds this name.',
          [`https://snapcraft.io/${target} — publisher ${r.json?.snap?.publisher?.['display-name'] ?? 'unknown'}`, ...drift],
          ctl,
        );
      }
      if (r.status === 404) {
        return answer(
          UNDETERMINED,
          `No PUBLISHED snap holds "${target}" (control green, HTTP 404). ⚠️ A name REGISTERED BUT UNPUBLISHED ` +
            'returns EXACTLY this same 404 — the snap namespace is claimed by registration, not by publication — ' +
            `so this is "no published snap", NOT "registerable". MANUAL STEP: \`snapcraft register --dry-run ${target}\` ` +
            "under the owner's account.",
          [`https://api.snapcraft.io/v2/snaps/info/${target} — HTTP 404`, ...drift],
          ctl,
        );
      }
      return answer(UNDETERMINED, `api.snapcraft.io answered HTTP ${r.status} — neither a snap nor a clean absence.`, drift, ctl);
    },
  },

  'windows-store': {
    uniqueness: TOLERATED,
    async run(ctx) {
      const { http, name } = ctx;
      const body = (kw) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Query: { KeyWord: kw, MatchType: 'Substring' } }) });
      const URL = 'https://storeedgefd.dsx.mp.microsoft.com/v9.0/manifestSearch';
      const c = await http(URL, body('firefox'));
      const ctl = control('storeedgefd manifestSearch KeyWord "firefox" (known non-empty)', c.status === 200 && Array.isArray(c.json?.Data) && c.json.Data.length > 0, `HTTP ${c.status}, ${c.json?.Data?.length ?? 'no'} row(s)`);
      const evidence = [];
      if (!ctl.green) {
        evidence.push('The advisory winget index could not be read on this run, so it says nothing either way.');
      } else {
        const r = await http(URL, body(name));
        const rows = Array.isArray(r.json?.Data) ? r.json.Data : [];
        evidence.push(
          rows.length
            ? `winget/Store catalogue substring hits (ADVISORY — this index is not the reservation pool): ${rows.slice(0, 5).map((x) => x.PackageName ?? x.PackageIdentifier).join(', ')}`
            : `winget/Store catalogue substring search returned 0 rows (control green). ADVISORY only.`,
        );
      }
      return answer(
        UNDETERMINED,
        'Microsoft TOLERATES duplicate display names, and the ONLY authority on a Store name is the Partner ' +
          'Center "reserve a name" dialog — pressing which IS the reservation, and starts a three-month ' +
          'submit-or-lose clock. That is a mutation and is refused here. MANUAL STEP, OWNER ONLY: open the ' +
          'reserve-name dialog, read the inline availability answer, and CANCEL without reserving.',
        evidence,
        ctl,
      );
    },
  },

  amo: {
    uniqueness: TOLERATED,
    async run(ctx) {
      const { http, name, slug } = ctx;
      const c = await http('https://addons.mozilla.org/api/v5/addons/search/?q=ublock&type=extension');
      const ctl = control('addons.mozilla.org search?q=ublock (known non-empty)', Boolean(c.json?.count > 0), `HTTP ${c.status}, count ${c.json?.count ?? 'unparseable'}`);
      if (!ctl.green) {
        return answer(UNDETERMINED, 'RED CONTROL FAILED — the AMO search API did not return the known-present control add-on.', [], ctl);
      }
      const r = await http(`https://addons.mozilla.org/api/v5/addons/search/?q=${encodeURIComponent(name)}&type=extension`);
      const j = r.json;
      if (!j || !Array.isArray(j.results)) {
        return answer(UNDETERMINED, `AMO search returned HTTP ${r.status} with no parseable result set.`, [], ctl);
      }
      const nameOf = (x) => (typeof x.name === 'string' ? x.name : Object.values(x.name || {})[0] || '');
      const slugClash = j.results.filter((x) => norm(x.slug) === norm(slug));
      const exact = j.results.filter((x) => norm(nameOf(x)) === norm(name));
      if (slugClash.length) {
        return answer(
          PROVEN_TAKEN,
          `The AMO SLUG "${slug}" is taken, and an add-on slug is globally unique on addons.mozilla.org.`,
          slugClash.map((x) => `https://addons.mozilla.org/addon/${x.slug} — "${nameOf(x)}"`),
          ctl,
        );
      }
      if (exact.length) {
        return answer(
          UNDETERMINED,
          'An add-on already uses this exact display name. AMO TOLERATES duplicate names, so this is advisory ' +
            'rather than blocking — but it is a discoverability and confusion cost.',
          exact.map((x) => `"${nameOf(x)}" — https://addons.mozilla.org/addon/${x.slug}`),
          ctl,
        );
      }
      return answer(
        PROVEN_FREE,
        `No listed Firefox add-on carries this name and the globally-unique slug "${slug}" is unclaimed ` +
          `(control green, ${j.count} row(s) searched).`,
        [],
        ctl,
      );
    },
  },

  'chrome-webstore': {
    uniqueness: TOLERATED,
    async run() {
      return answer(
        UNDETERMINED,
        'The Chrome Web Store has NO public search or name-availability API and its search surface is ' +
          'JS-rendered, so a fetch of it returns an empty body that must never be read as "free". Chrome ' +
          'tolerates duplicate names; what is permanent is the extension ID, which Google ASSIGNS — it is not ' +
          'chosen and cannot be checked in advance. MANUAL STEP: a logged-in developer-dashboard search plus a ' +
          'human read of the store search page.',
      );
    },
  },

  'edge-addons': {
    uniqueness: TOLERATED,
    async run() {
      return answer(
        UNDETERMINED,
        'Edge Add-ons exposes a details endpoint by CRX ID only — there is no name search API and no ' +
          'name-availability endpoint. Duplicates are tolerated. MANUAL STEP: the Partner Center (Edge program) ' +
          'submission form.',
      );
    },
  },

  'apps-gov-in': {
    uniqueness: TOLERATED,
    async run() {
      return answer(
        NOT_APPLICABLE,
        'The register declares `served: false`, `submittable: false` and no submission API — a manual web upload ' +
          'forever. There is no namespace to contest until a submission exists.',
      );
    },
  },

  'windows-direct': {
    uniqueness: NONE,
    async run() {
      return answer(NOT_APPLICABLE, 'kind:"direct" — a download from a host this factory owns. No third party holds a name here; the only namespace is our own filename.');
    },
  },

  'linux-appimage': {
    uniqueness: NONE,
    async run() {
      return answer(NOT_APPLICABLE, 'kind:"direct" — an AppImage from a host this factory owns. No third-party name authority exists.');
    },
  },
});

/** The verdict for a channel the register declares and this table does not know.
 *  A coverage gap, REPORTED rather than skipped. */
export function noProbeRegistered(id) {
  return {
    uniqueness: 'UNKNOWN',
    ...answer(
      UNDETERMINED,
      `NO PROBE REGISTERED for channel "${id}". It is in tooling/channel-register.json and this table does not ` +
        'know how to ask about it. That is a coverage gap, reported rather than silently dropped — which is what ' +
        'stops this file drifting behind the register when a thirteenth channel lands.',
    ),
  };
}
