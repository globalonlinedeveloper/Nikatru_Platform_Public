// ─────────────────────────────────────────────────────────────────────────────
// digest-copy.ts — the renewal digest speaks the person's language.
//
// Lane i18n-pipeline (item 5). The digest was English string literals even
// though the app stores each person's `locale` preference
// (subscriptiontracker-api /v1/preferences, table `preferences`, key `locale`).
// Now the copy is DATA — tooling/i18n/messages/email.json `digest`, one block per
// locale of the register tooling/i18n/locales.json — inlined at build time by
// esbuild (a Worker has no filesystem), and the stored preference picks it.
//
// Every fallback lands on the register's source locale (English): no stored
// preference, "follow the device" (''), a tag the register does not support, a
// key missing from a locale's block, or an app database with no `preferences`
// table yet (this Worker reads app databases it does not migrate).
// ─────────────────────────────────────────────────────────────────────────────
import emailJson from '../../../../tooling/i18n/messages/email.json';
import registerJson from '../../../../tooling/i18n/locales.json';
import type { SqlDb } from '../../../_shared/src/ports/sql';
import { firstRow } from './d1';

export interface DigestCopy {
  subjectOne: string;
  subjectMany: string;
  intro: string;
  why: string;
  change: string;
  stop: string;
  cycle: Record<string, string>;
}

const DIGEST = emailJson.digest as Record<string, Partial<DigestCopy> | undefined>;

/** The register's source locale — every fallback's answer. */
export const SOURCE_LOCALE: string = registerJson.sourceLocale;

/** The register's supported codes, in register order. */
export const SUPPORTED_LOCALES: readonly string[] = (registerJson.locales as { code: string; status: string }[])
  .filter((l) => l.status === 'supported')
  .map((l) => l.code);

/** The supported locale a stored preference resolves to: the exact tag, else
 *  its language subtag (`ta-IN` → `ta`), else the source locale. */
export function resolveLocale(stored: unknown): string {
  if (typeof stored !== 'string' || stored === '') return SOURCE_LOCALE;
  const tag = stored.replace(/_/g, '-');
  const exact = SUPPORTED_LOCALES.find((c) => c.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const lang = tag.split('-')[0].toLowerCase();
  return SUPPORTED_LOCALES.find((c) => c.toLowerCase() === lang) ?? SOURCE_LOCALE;
}

/** The digest copy for `locale`: its block, with any missing key from the source. */
export function digestCopy(locale: string): DigestCopy {
  const base = DIGEST[SOURCE_LOCALE] as DigestCopy;
  const own = DIGEST[locale] ?? {};
  return { ...base, ...own, cycle: { ...base.cycle, ...(own.cycle ?? {}) } };
}

/** `{name}` placeholders filled from `vars`; an unknown one is left as written. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** "Mon 5 Oct 2026" in English (en-GB, unambiguous where a numeric date is
 *  not); the same weekday, day, month and year in the locale's own words. */
export function localDateLabel(ymd: string, locale: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString(locale === SOURCE_LOCALE ? 'en-GB' : locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The person's stored `locale` preference in this app's database, or null.
 * The value column is JSON (`"ta"`). A database without the table — every app
 * before subscriptiontracker-api migration 0008 — answers null, never an error:
 * a digest in English beats no digest. A read that THROWS — no table, a renamed
 * column, a value that is not JSON — also answers null, and calls `onFallback`
 * so the run counts it: without the count a schema rename would make every
 * digest English with nothing in the heartbeat detail (#1161 nit 7c).
 */
export async function readStoredLocale(db: SqlDb, userId: string, onFallback?: () => void): Promise<string | null> {
  try {
    const row = await firstRow<{ value: string }>(
      db.prepare("SELECT value FROM preferences WHERE user_id = ? AND key = 'locale'").bind(userId),
    );
    if (!row) return null;
    const v: unknown = JSON.parse(row.value);
    return typeof v === 'string' && v !== '' ? v : null;
  } catch {
    onFallback?.();
    return null;
  }
}
