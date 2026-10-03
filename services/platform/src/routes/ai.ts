// ─────────────────────────────────────────────────────────────────────────────
// routes/ai.ts — PAID AI, metered (train-st-ai-customer-pays, T17).
//
//   GET  /v1/ai/status?app_id=   — the switch, the plan, the credits left, and
//                                  whether the current disclosure is acknowledged.
//   POST /v1/ai/consent          — the explicit opt-in to the current disclosure
//                                  (AI-05; EU AI Act Art. 50(1)). No opt-in, no call.
//   POST /v1/ai/import           — a pasted text or ONE image in, candidate
//                                  subscription rows out (AI-03, IM-10). Never saved:
//                                  the client puts them in the Import hub's review
//                                  list; the request body is never persisted.
//   POST /v1/ai/review           — the user's own list in, keep / review / cancel
//                                  suggestions out (AI-04). Advisory only.
//
// AUTHENTICATED (`platformAuth`, mounted at /v1/ai/* in index.ts): the payer is
// the verified JWT's subject.
//
// 🔴 CUSTOMER PAYS. Every call goes through the meter (src/lib/ai/meter.ts): the
// read-only precheck answers the user's refusal first (503 ai_disabled, 403
// ai_consent_required, 402 ai_requires_plan / ai_credits_exhausted), and the
// port's `beforeCall` enforces the same rules again plus the caps, atomically,
// BEFORE any provider touches the wire. A refusal is never a call.
//
// 🔴 THE MODEL IS CONFIG: `aiFor(feature)` (src/ports.ts), never a constant here.
// Until each feature's model is set from a measurement (tooling/ports/ai.json
// features.<f>.model), `aiFor` answers "no model yet" and this route 503s
// `ai_unavailable` — after the user's own refusals, so a Free user still hears
// "this needs a plan".
//
// 🔴 EVERY AI OUTPUT IS MARKED (EU AI Act Art. 50(2)): the response carries
// `provenance: { generator: 'ai', provider, model, at }`; every import candidate
// carries `source: 'ai_import'` and every review suggestion `generated_by: 'ai'`,
// each with the same provenance, so a row saved from it keeps the marker in
// storage, in every export and in every backup (the client's half).
// ─────────────────────────────────────────────────────────────────────────────
import { Hono, type Context } from 'hono';
import type { AppEnv, Env } from '../types';
import type { AiFeature, AiImage, AiJsonSchema, AiOutcome, AiProvider } from '../../../_shared/src/ports/ai';
import { isKnownApp } from '../config';
import { readBoundedBody } from '../lib/body';
import { nowIso } from '../lib/d1';
import { AI_COST_MODEL, aiFor } from '../ports';
import {
  AI_DISCLOSURE_VERSION,
  PRO_MONTHLY_ALLOWANCE,
  aiEnabled,
  allowanceLeft,
  createMeter,
  planOf,
  precheck,
  readAccount,
  recordConsent,
} from '../lib/ai/meter';
import { sendOwnerPage } from '../lib/owner-page';

const ai = new Hono<AppEnv>();

/**
 * A pasted text or one base64 image, with the JSON around it. The image is what
 * sizes it: the import input cap (ai.json features.import.maxInputTokens) admits
 * one screenshot, and a phone screenshot as base64 is well under this.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_AI_BODY_BYTES = 2_097_152;
/** @ceiling none — a field length we chose; the input cap is the real bound. */
export const MAX_IMPORT_TEXT_CHARS = 12_000;
/** @ceiling none — a list length we chose for one review call. */
export const MAX_REVIEW_ITEMS = 100;
/** @ceiling none — the output we ask for; within every candidate model's limit. */
export const AI_MAX_OUTPUT_TOKENS = 2048;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly', 'unknown'] as const;
export const REVIEW_ACTIONS = ['keep', 'review', 'cancel'] as const;

/** The provider selector — `aiFor` in production; a test swaps in the counting stub. */
export const aiRouteDeps: {
  select: (feature: AiFeature, env: Env, beforeCall: Parameters<typeof aiFor>[2]) => ReturnType<typeof aiFor>;
} = {
  select: (feature, env, wiring) => aiFor(feature, env, wiring),
};

export const IMPORT_SYSTEM =
  'You extract recurring subscriptions from a receipt, a bank or card statement, an e-mail or a screenshot the user provides. ' +
  'Return only subscriptions that are clearly present. For each: the service name, the price as a number (null if absent), ' +
  'the ISO 4217 currency (null if absent), the billing cycle, the next charge date as YYYY-MM-DD (null if absent), ' +
  'and your confidence from 0 to 1. Never invent a value: use null.';

export const IMPORT_SCHEMA: AiJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'price', 'currency', 'cycle', 'next_date', 'confidence'],
        properties: {
          name: { type: 'string' },
          price: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          cycle: { type: 'string', enum: [...CYCLES] },
          next_date: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
      },
    },
  },
};

export const REVIEW_SYSTEM =
  "You review the user's own list of subscriptions and suggest, for each, keep, review or cancel, with a one-sentence reason. " +
  'You only advise: you never act, and you use only the list given.';

export const REVIEW_SCHEMA: AiJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      maxItems: MAX_REVIEW_ITEMS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'action', 'reason'],
        properties: { name: { type: 'string' }, action: { type: 'string', enum: [...REVIEW_ACTIONS] }, reason: { type: 'string' } },
      },
    },
  },
};

export interface Provenance {
  readonly generator: 'ai';
  readonly provider: string;
  readonly model: string;
  readonly at: string;
}

type Body = Record<string, unknown>;

async function readJson(req: Request): Promise<{ ok: true; body: Body } | { ok: false; status: 400 | 413; error: string }> {
  const read = await readBoundedBody(req, MAX_AI_BODY_BYTES);
  if (!read.ok) return { ok: false, status: read.status as 400 | 413, error: read.error };
  try {
    const body = JSON.parse(read.text) as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, status: 400, error: 'invalid_body' };
    return { ok: true, body: body as Body };
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
}

/** The import body: text, or one image, or both. Exported for the tests. */
export function parseImport(b: Body): { ok: true; text: string; images: AiImage[] } | { ok: false; error: string } {
  const text = b.text === undefined || b.text === null ? '' : b.text;
  if (typeof text !== 'string' || text.length > MAX_IMPORT_TEXT_CHARS) return { ok: false, error: 'invalid_text' };
  const images: AiImage[] = [];
  if (b.image !== undefined && b.image !== null) {
    const img = b.image as Record<string, unknown>;
    if (typeof img !== 'object' || !IMAGE_TYPES.includes(img.media_type as (typeof IMAGE_TYPES)[number])) return { ok: false, error: 'invalid_image' };
    if (typeof img.base64 !== 'string' || img.base64.length === 0 || !/^[A-Za-z0-9+/]+=*$/.test(img.base64)) return { ok: false, error: 'invalid_image' };
    images.push({ mediaType: img.media_type as AiImage['mediaType'], base64: img.base64 });
  }
  if (text.trim() === '' && images.length === 0) return { ok: false, error: 'nothing_to_import' };
  return { ok: true, text, images };
}

/** The review body: the user's own rows, names and amounts only. Exported for the tests. */
export function parseReview(b: Body): { ok: true; input: string } | { ok: false; error: string } {
  const items = b.subscriptions;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_REVIEW_ITEMS) return { ok: false, error: 'invalid_subscriptions' };
  const rows: Array<Record<string, unknown>> = [];
  for (const it of items) {
    if (typeof it !== 'object' || it === null) return { ok: false, error: 'invalid_subscriptions' };
    const r = it as Record<string, unknown>;
    if (typeof r.name !== 'string' || r.name.length === 0 || r.name.length > 200) return { ok: false, error: 'invalid_subscriptions' };
    rows.push({
      name: r.name,
      price: typeof r.price === 'number' ? r.price : null,
      currency: typeof r.currency === 'string' ? r.currency.slice(0, 3) : null,
      cycle: typeof r.cycle === 'string' ? r.cycle.slice(0, 20) : null,
      last_used: typeof r.last_used === 'string' ? r.last_used.slice(0, 10) : null,
    });
  }
  return { ok: true, input: JSON.stringify(rows) };
}

const refusalOf = (o: AiOutcome & { ok: false }): { status: 422 | 502 | 503 | 504; error: string } =>
  o.kind === 'timeout' ? { status: 504, error: 'ai_timeout' } : o.kind === 'retryable' || o.kind === 'unavailable' ? { status: 503, error: 'ai_unavailable' } : o.kind === 'refused' || o.kind === 'invalid' || o.kind === 'incomplete' ? { status: 422, error: `ai_${o.kind}` } : { status: 502, error: 'ai_failed' };

/** One metered call: precheck → select → reserve (beforeCall) → call → settle. */
async function meteredCall(
  c: Context<AppEnv>,
  feature: AiFeature,
  appId: string,
  input: string,
  images: AiImage[],
): Promise<{ ok: true; output: unknown; provenance: Provenance } | { ok: false; status: number; error: string }> {
  const env = c.env;
  const userId = c.get('userId');
  const now = nowIso();
  const plan = await planOf(env, userId, appId, c.get('requestId') ?? '-', Date.parse(now));
  const pre = await precheck(env, userId, appId, plan, now);
  if (pre) return { ok: false, status: pre.status, error: pre.error };

  const meter = createMeter({
    env,
    userId,
    appId,
    feature,
    plan,
    prices: AI_COST_MODEL,
    page: (subject, lines) => sendOwnerPage(env, subject, lines),
  });
  const sel = aiRouteDeps.select(feature, env, { beforeCall: meter.beforeCall });
  if (!sel.ok) {
    console.warn(`[ai] ${feature}: ${sel.detail}`);
    return { ok: false, status: 503, error: 'ai_unavailable' };
  }
  const provider: AiProvider = sel.provider;
  const outcome = await provider.complete({
    feature,
    model: sel.model,
    system: feature === 'import' ? IMPORT_SYSTEM : REVIEW_SYSTEM,
    input,
    ...(images.length ? { images } : {}),
    schema: feature === 'import' ? IMPORT_SCHEMA : REVIEW_SCHEMA,
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    ...(sel.effort ? { effort: sel.effort } : {}),
  });
  // Metered to the ledger BEFORE the response returns.
  await meter.settle(outcome);
  const refused = meter.refusal();
  if (refused) return { ok: false, status: refused.status, error: refused.error };
  if (!outcome.ok) {
    console.warn(`[ai] ${feature}: ${outcome.detail}`);
    const r = refusalOf(outcome);
    return { ok: false, status: r.status, error: r.error };
  }
  return { ok: true, output: outcome.output, provenance: { generator: 'ai', provider: provider.id, model: outcome.servedModel, at: now } };
}

ai.get('/ai/status', async (c) => {
  const appId = c.req.query('app_id') ?? '';
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  const userId = c.get('userId');
  const now = nowIso();
  const plan = await planOf(c.env, userId, appId, c.get('requestId') ?? '-', Date.parse(now));
  let account;
  try {
    account = await readAccount(c.env.PLATFORM_DB, userId, appId);
  } catch {
    return c.json({ error: 'ai_meter_unavailable' }, 503);
  }
  return c.json({
    enabled: await aiEnabled(c.env),
    plan,
    pack_credits: account.pack_credits,
    allowance_left: allowanceLeft(plan, account, now),
    monthly_allowance: plan === 'paid' ? PRO_MONTHLY_ALLOWANCE : 0,
    disclosure_version: AI_DISCLOSURE_VERSION,
    consent_current: account.consent_version === AI_DISCLOSURE_VERSION,
  });
});

ai.post('/ai/consent', async (c) => {
  const read = await readJson(c.req.raw);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  const appId = read.body.app_id;
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId);
  // The client acknowledges the version it SHOWED; an older text is not consent to this one.
  if (read.body.disclosure_version !== AI_DISCLOSURE_VERSION) return c.json({ error: 'stale_disclosure', disclosure_version: AI_DISCLOSURE_VERSION }, 409);
  try {
    await recordConsent(c.env.PLATFORM_DB, c.get('userId'), appId, nowIso());
  } catch {
    return c.json({ error: 'ai_meter_unavailable' }, 503);
  }
  return c.json({ ok: true, disclosure_version: AI_DISCLOSURE_VERSION });
});

ai.post('/ai/import', async (c) => {
  const read = await readJson(c.req.raw);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  const appId = read.body.app_id;
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId);
  const parsed = parseImport(read.body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const r = await meteredCall(c, 'import', appId, parsed.text, parsed.images);
  if (!r.ok) return c.json({ error: r.error }, r.status as 402);
  const out = r.output as { candidates: Array<Record<string, unknown>> };
  return c.json({
    provenance: r.provenance,
    candidates: out.candidates.map((cand) => ({ ...cand, source: 'ai_import', provenance: r.provenance })),
  });
});

ai.post('/ai/review', async (c) => {
  const read = await readJson(c.req.raw);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  const appId = read.body.app_id;
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId);
  const parsed = parseReview(read.body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const r = await meteredCall(c, 'review', appId, parsed.input, []);
  if (!r.ok) return c.json({ error: r.error }, r.status as 402);
  const out = r.output as { suggestions: Array<Record<string, unknown>> };
  return c.json({
    advisory: true,
    provenance: r.provenance,
    suggestions: out.suggestions.map((s) => ({ ...s, generated_by: 'ai', provenance: r.provenance })),
  });
});

export default ai;
