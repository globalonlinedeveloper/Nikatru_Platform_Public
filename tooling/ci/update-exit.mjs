// ─────────────────────────────────────────────────────────────────────────────
// update-exit.mjs — [pipeline 10]D-8, WHERE THE FORCE-UPDATE WALL SENDS A USER,
// graded per channel × app. Pure: rows and served values in, findings out. Its
// one caller is assert-stamp-properties.mjs `checkUpdateDestinationIsRepointable`,
// which owns the reads and the COVERAGE LOST verdicts; this file owns the rules.
//
// 🔴 WHY THE RULES MOVED OUT OF THE GUARD (O-FORCE-UPDATE-VERSION-READ-UNPROVEN,
// folding O-UPDATE-EXIT-OPENS-HOMEPAGE). Until 2026-10-01 the limb graded only a
// row that was `served: true` or carried no deferral, and its one question was
// "is a string served?". Two defects sat under that, both measured on the tree:
//   · `linux-snap` is `submittable: true` with a real lane — ARMED by
//     channel-arming.mjs's definition, so a tag builds and submits it — and the
//     limb skipped it, because it is deferred and unserved. Every store build's
//     wall opened the compiled-in homepage, and no limb could say so.
//   · a store row served `https://nikatru.com` would have PASSED: a homepage is a
//     string.
// So a row is now graded when it is LIVE (`served`, or nothing defers it — the
// old rule, kept) OR ARMED (`submittable` and a lane), and each row is graded by
// HOW its wall exits — the same three ways the client resolves it in
// packages/core/lib/src/config/update_exit.dart:
//   · a STORE-LISTING channel (the Dart `kStoreListingChannels`) may be served
//     null: the wall calls `openStoreListing()`. A string must not be a homepage.
//   · `linux-snap` must be served its snapcraft.io page, derived from the app's
//     own store/linux-snap/snap-name.txt — no adapter opens the Snap Store.
//   · a row that carries `updateListingUrl` (apps-gov-in: a sideloaded .apk, so
//     `openStoreListing()` would open Play, where that install cannot update)
//     must be served EXACTLY that URL once armed; while it is null the row needs
//     a dated `_updateListingUrlPending` note, armed or not.
//   · anything else (the direct rows) must be served a string, as before.
// ─────────────────────────────────────────────────────────────────────────────

/** The register row field that records a storefront's own listing URL. */
export const LISTING_FIELD = 'updateListingUrl';
/** …and the dated note a null one must carry. */
export const LISTING_PENDING_FIELD = '_updateListingUrlPending';

/** `const Set<String> kStoreListingChannels = <String>{…};` in update_exit.dart,
 *  as a Set, or null when the declaration cannot be read. */
export function parseStoreListingChannels(dartSrc) {
  const m = String(dartSrc ?? '').match(/kStoreListingChannels\s*=\s*<String>\{([^}]*)\}/);
  if (!m) return null;
  const ids = [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
  return ids.length ? new Set(ids) : null;
}

/** True when `url` names a site ROOT — a homepage, never a listing or a download. */
export function isHomepage(url) {
  try {
    const u = new URL(url);
    return (u.pathname === '' || u.pathname === '/') && u.search === '' && u.hash === '';
  } catch {
    return false;
  }
}

const laneShaped = (lane) =>
  lane !== null && typeof lane === 'object' && typeof lane.workflow === 'string' && lane.workflow.trim() !== '' &&
  typeof lane.job === 'string' && lane.job.trim() !== '';

/** Why a non-web row's wall is graded, or null when it is neither live nor armed. */
export function gradedBecause(row) {
  // An extension row ships no Flutter build, so it has no wall to exit. Fail-closed:
  // only a row that SAYS it is not an app is skipped.
  if (row?.kind === 'web' || (row?.surface !== undefined && row?.surface !== 'app')) return null;
  if (row?.served === true) return 'served: true';
  if (row?.submittable === true && laneShaped(row?.lane)) return `armed (submittable + lane ${row.lane.workflow} · ${row.lane.job})`;
  if (!(typeof row?.deferral === 'object' && row?.deferral !== null)) return 'no deferral';
  return null;
}

/** The snapcraft.io page a snap name is listed at. */
export const snapcraftUrl = (snapName) => `https://snapcraft.io/${snapName}`;

const PENDING_RE = /^⏱ \d{4}-\d{2}-\d{2}\b/;

/**
 * Every finding for one app.
 * @param {{rows: object[], served: Map<string, unknown>, appId: string,
 *          storeListing: Set<string>, snapName: string|null}} args
 * @returns {{fail: string[], graded: string[]}}
 */
export function updateExitFindings({ rows, served, appId, storeListing, snapName }) {
  const fail = [];
  const graded = [];
  for (const row of rows) {
    const id = row?.id ?? '<unnamed row>';
    const value = served.get(id);
    if (typeof value === 'string' && row?.kind !== 'web' && isHomepage(value)) {
      fail.push(
        `[10]D-8: '${appId}' is served an update_url of '${value}' on '${id}', which is a HOMEPAGE. A user walled ` +
          'there is sent to a site root that cannot update the build they are holding (O-UPDATE-EXIT-OPENS-HOMEPAGE).',
      );
    }
    const hasListingField = row !== null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, LISTING_FIELD);
    const listing = hasListingField ? row[LISTING_FIELD] : undefined;
    if (hasListingField && listing === null && !PENDING_RE.test(String(row?.[LISTING_PENDING_FIELD] ?? ''))) {
      fail.push(
        `[10]D-8: '${id}' records \`${LISTING_FIELD}: null\` with no dated \`${LISTING_PENDING_FIELD}\` ` +
          "(\"⏱ YYYY-MM-DD · …\"). A null listing is a pending answer only while it says what it waits for, and since when.",
      );
    }
    if (hasListingField && listing !== null && !(typeof listing === 'string' && /^https:\/\/\S+$/.test(listing))) {
      fail.push(`[10]D-8: '${id}' records \`${LISTING_FIELD}\` as ${JSON.stringify(listing)}, which is not an https URL.`);
    }
    const because = gradedBecause(row);
    if (because === null) continue;
    graded.push(`${id} (${because})`);
    if (hasListingField) {
      if (typeof listing !== 'string') {
        fail.push(
          `[10]D-8: '${id}' is ${because} and records no \`${LISTING_FIELD}\`. Its build is not installed by a store ` +
            "`openStoreListing()` can open, so the wall's only way out is that URL: record it on the row and serve it to " +
            `'${id}' in services/platform/src/app-config-data.json.`,
        );
      } else if (value !== listing) {
        fail.push(
          `[10]D-8: '${appId}' is served ${JSON.stringify(value ?? null)} on '${id}', which is ${because}; the row's ` +
            `listing is '${listing}', and that is the one place its wall may open.`,
        );
      }
      continue;
    }
    if (storeListing.has(id)) continue; // null → openStoreListing(); a string was graded above
    if (row?.kind === 'store' && (row?.platforms ?? []).includes('linux')) {
      if (snapName === null) {
        fail.push(`COVERAGE LOST — [10]D-8: '${id}' is ${because}, and '${appId}' has no store/linux-snap/snap-name.txt to derive its snapcraft.io page from.`);
      } else if (value !== snapcraftUrl(snapName)) {
        fail.push(
          `[10]D-8: '${appId}' is served ${JSON.stringify(value ?? null)} on '${id}', which is ${because}. No adapter opens ` +
            `the Snap Store, so the wall opens the served URL, and it must be the snap's own page: '${snapcraftUrl(snapName)}'.`,
        );
      }
      continue;
    }
    if (typeof value !== 'string') {
      const deferral = typeof row?.deferral === 'object' && row?.deferral !== null ? 'declared' : 'none';
      fail.push(
        `[10]D-8: '${appId}' is served an update_url of null while ${id} (kind=${row?.kind ?? 'none'}, ` +
          `served=${row?.served === true}, deferral=${deferral}) is ${because}. It has no store listing to fall back ` +
          'on, so the wall would open the compiled-in fallback with no way to repoint it: serve it a real ' +
          "update_url, or record the channel's deferral in the register.",
      );
    }
  }
  return { fail, graded };
}
