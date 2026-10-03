// ─────────────────────────────────────────────────────────────────────────────
// internal.ts — THE ONE READ PATH for what the intake stores (lane
// feedback-intake, Do 5 and 8).
//
// A NAMED entrypoint, reached only by a Service Binding that names
// `entrypoint: "FeedbackInternal"` from a Worker inside this account. It is not
// `fetch`: no URL on any host reaches it, so a screenshot cannot be served by a
// route, a guessed key or a misconfigured cache. The default export's `fetch`
// mounts no read route at all (test/routes.test.ts walks the route table).
//
//   screenshot(id)        the stored (already stripped) image of one report.
//   exportForUser(userId) every report a person filed, for the per-user export
//                         lane dpdp-rights will call (DSAR). The screenshot is
//                         named by key, not inlined; `screenshot` reads it.
// The lead's laptop reads the same store through the Cloudflare credential it
// already uses for D1 (lane feedback-triage's tooling/feedback/pull.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { WorkerEntrypoint } from 'cloudflare:workers';
import { allRows, firstRow } from './lib/d1';
import type { Env } from './types';

const REPORT_ID = /^FB-[0-9A-Z]{10}$/;

export interface ExportedReport {
  id: string;
  app_id: string;
  app_version: string | null;
  surface: string;
  category: string;
  description: string;
  steps: string | null;
  diagnostics: string | null;
  contact_email: string | null;
  reply_ok: number;
  notify_fixed: number;
  screenshot_key: string | null;
  status: string;
  created_at: string;
  purge_at: string;
}

/** The person's reports, newest first. Exported so the tests reach it without the runtime. */
export async function reportsOf(env: Env, userId: string): Promise<ExportedReport[]> {
  if (typeof userId !== 'string' || userId === '') return [];
  return allRows<ExportedReport>(
    env.PLATFORM_DB.prepare(
      'SELECT id, app_id, app_version, surface, category, description, steps, diagnostics, contact_email, reply_ok, ' +
        'notify_fixed, screenshot_key, status, created_at, purge_at FROM feedback_reports WHERE user_id = ? ORDER BY created_at DESC',
    ).bind(userId),
  );
}

/** One report's screenshot bytes and type, or null. */
export async function screenshotOf(env: Env, id: string): Promise<{ contentType: string; bytes: ArrayBuffer } | null> {
  if (!REPORT_ID.test(id)) return null;
  const row = await firstRow<{ screenshot_key: string | null }>(
    env.PLATFORM_DB.prepare('SELECT screenshot_key FROM feedback_reports WHERE id = ?').bind(id),
  );
  if (!row?.screenshot_key) return null;
  const obj = await env.SCREENSHOTS.get(row.screenshot_key);
  if (!obj) return null;
  return { contentType: row.screenshot_key.endsWith('.webp') ? 'image/webp' : 'image/png', bytes: await obj.arrayBuffer() };
}

export class FeedbackInternal extends WorkerEntrypoint<Env> {
  async screenshot(id: string) {
    return screenshotOf(this.env, id);
  }

  async exportForUser(userId: string) {
    return reportsOf(this.env, userId);
  }
}
