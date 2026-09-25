// ─────────────────────────────────────────────────────────────────────────────
// WHERE A ONE-TIME CODE MAY BE DELIVERED — read off tooling/channel-register.json.
//
// ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT. Each extension channel row
// (`chrome-webstore`, `edge-addons`, `amo`) carries `extensionRedirectUri`: the
// exact URL that browser's `identity.getRedirectURL()` returns for OUR extension
// id. POST /v1/ext/codes mints a code only for a `redirect_uri` byte-equal to
// that value, and answers with the REGISTER's value — never the caller's — so
// the page can only ever navigate to a URL this file handed it (no open redirect).
//
// 🔴 `null` REFUSES THE CHANNEL. Every value is null until the parent measures
// the real extension ids, so the whole flow is inert in production until then —
// a dark launch by data, not by a flag. A null is never "any URL".
//
// Its own module, and deliberately small, so the tests can substitute a fixture
// register (vi.mock) without a test hook in production code. esbuild inlines the
// JSON, exactly as src/lib/bundle/availability.ts inlines the same file.
// ─────────────────────────────────────────────────────────────────────────────
import channelRegisterJson from '../../../../tooling/channel-register.json';

/** The three store channels an extension can be linked from, and nothing else. */
export const EXT_CHANNELS = ['chrome-webstore', 'edge-addons', 'amo'] as const;
export type ExtChannel = (typeof EXT_CHANNELS)[number];

export function isExtChannel(v: unknown): v is ExtChannel {
  return typeof v === 'string' && (EXT_CHANNELS as readonly string[]).includes(v);
}

interface ChannelRow {
  id?: unknown;
  extensionRedirectUri?: unknown;
}

/** The register's `extensionRedirectUri` for `channel`, or `null` — refused. A
 *  missing row, a missing field and a non-string all read as `null`. */
export function extensionRedirectUri(channel: ExtChannel): string | null {
  const rows = (channelRegisterJson as { channels?: unknown }).channels;
  if (!Array.isArray(rows)) return null;
  const row = (rows as ChannelRow[]).find((r) => r?.id === channel);
  const v = row?.extensionRedirectUri;
  return typeof v === 'string' && v !== '' ? v : null;
}
