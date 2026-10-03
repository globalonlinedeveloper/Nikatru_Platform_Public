// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/ai/help-chat — THE HELP CHAT (lane help-ai-chat, O-HELP-AI-CHAT-UNBUILT).
//
//   body   { app_id, question, locale? }
//   200    { generated_by: 'ai', provenance, answer, citations: [{ id, title, url }] }
//   200    { refusal: 'out_of_scope', ask_us: true }   — no call was made
//
// AUTHENTICATED (`platformAuth`, mounted at /v1/ai/* in index.ts).
//
// 🔴 CUSTOMER PAYS, EXACTLY AS T17's FEATURES DO. This route CALLS the meter
// (src/lib/ai/meter.ts: planOf, precheck, createMeter) and the port
// (`aiFor('help')`), and changes neither: the user's own refusals first (503
// ai_disabled, 403 ai_consent_required, 402 ai_requires_plan /
// ai_credits_exhausted), then the port's `beforeCall` reserves one credit
// BEFORE the wire and enforces the per-user daily cap, the global daily spend
// breaker and the kill switch; the call is settled with its actual tokens. A
// refusal is never a call.
//
// 🔴 GROUNDED, AND REFUSED WITHOUT A CALL WHEN IT CANNOT BE. The question is
// answered only from the help articles src/lib/help/chat.ts retrieves; no
// article above the score floor, or a question that tries to rewrite the
// rules, is the scoped refusal with the "ask us" button — and costs nothing.
// Every answer is validated before it is shown (cites what it was given, no
// price, no link, no refund or terms wording); a failing one is 422 ai_invalid.
//
// 🔴 EU AI Act Art. 50: every answer carries `generated_by: 'ai'` and the
// provenance (provider, model, time); the client labels it and keeps the
// marker in any copied transcript.
//
// 🔒 NOTHING IS STORED OR LOGGED: the question and the answer live in this
// request only; the meter keeps token counts. No log line names either.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import type { AiFeature } from '../../../_shared/src/ports/ai';
import { isKnownApp } from '../config';
import { readBoundedBody } from '../lib/body';
import { nowIso } from '../lib/d1';
import { AI_COST_MODEL, aiFor } from '../ports';
import { createMeter, planOf, precheck } from '../lib/ai/meter';
import { sendOwnerPage } from '../lib/owner-page';
import {
  HELP_CHAT_SCHEMA,
  HELP_CHAT_SYSTEM,
  HELP_MAX_OUTPUT_TOKENS,
  MAX_QUESTION_CHARS,
  chatInput,
  citationOf,
  looksLikeInjection,
  retrieve,
  validateAnswer,
  type HelpAnswer,
} from '../lib/help/chat';

/** @ceiling workers.maxRequestBodySize lte */
export const MAX_HELP_CHAT_BODY_BYTES = 4_096;

const FEATURE: AiFeature = 'help';

/** The provider selector — `aiFor` in production; a test swaps in the counting stub. */
export const helpChatDeps: {
  select: (feature: AiFeature, env: Env, wiring: Parameters<typeof aiFor>[2]) => ReturnType<typeof aiFor>;
} = {
  select: (feature, env, wiring) => aiFor(feature, env, wiring),
};

const helpChat = new Hono<AppEnv>();

helpChat.post('/ai/help-chat', async (c) => {
  const read = await readBoundedBody(c.req.raw, MAX_HELP_CHAT_BODY_BYTES);
  if (!read.ok) return read.status === 413 ? c.json({ error: read.error }, 413) : c.json({ error: read.error }, 400);
  let body: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(read.text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return c.json({ error: 'invalid_body' }, 400);
    body = v as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const appId = body.app_id;
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId);
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question === '' || question.length > MAX_QUESTION_CHARS) return c.json({ error: 'invalid_question' }, 400);
  const locale = typeof body.locale === 'string' ? body.locale.slice(0, 8) : 'en';

  // The user's own refusals first, read-only, exactly as T17's routes order them.
  const env = c.env;
  const userId = c.get('userId');
  const now = nowIso();
  const plan = await planOf(env, userId, appId, c.get('requestId') ?? '-', Date.parse(now));
  const pre = await precheck(env, userId, appId, plan, now);
  if (pre) return c.json({ error: pre.error }, pre.status as 402);

  // Out of scope or an attempt on the rules: the scoped refusal, and no call.
  const docs = looksLikeInjection(question) ? [] : retrieve(appId, locale, question);
  if (docs.length === 0) return c.json({ refusal: 'out_of_scope', ask_us: true }, 200);

  const meter = createMeter({ env, userId, appId, feature: FEATURE, plan, prices: AI_COST_MODEL, page: (subject, lines) => sendOwnerPage(env, subject, lines) });
  const sel = helpChatDeps.select(FEATURE, env, { beforeCall: meter.beforeCall });
  if (!sel.ok) {
    console.warn('[ai] help: no provider (see tooling/ports/ai.json features.help)');
    return c.json({ error: 'ai_unavailable' }, 503);
  }
  const outcome = await sel.provider.complete({
    feature: FEATURE,
    model: sel.model,
    system: HELP_CHAT_SYSTEM,
    input: chatInput(docs, question),
    schema: HELP_CHAT_SCHEMA,
    maxOutputTokens: HELP_MAX_OUTPUT_TOKENS,
    ...(sel.effort ? { effort: sel.effort } : {}),
  });
  await meter.settle(outcome);
  const refused = meter.refusal();
  if (refused) return c.json({ error: refused.error }, refused.status as 402);
  if (!outcome.ok) {
    console.warn(`[ai] help: outcome ${outcome.kind}`);
    return outcome.kind === 'timeout' ? c.json({ error: 'ai_timeout' }, 504) : c.json({ error: 'ai_unavailable' }, 503);
  }
  const why = validateAnswer(outcome.output, docs);
  if (why !== null) {
    console.warn(`[ai] help: answer refused by the validator (${why})`);
    return c.json({ error: 'ai_invalid' }, 422);
  }
  const ans = outcome.output as HelpAnswer;
  if (!ans.in_scope) return c.json({ refusal: 'out_of_scope', ask_us: true }, 200);
  const cited = docs.filter((d) => ans.citations.includes(d.id)).map(citationOf);
  return c.json(
    {
      generated_by: 'ai',
      provenance: { generator: 'ai', provider: sel.provider.id, model: outcome.servedModel, at: now },
      answer: ans.answer,
      citations: cited,
    },
    200,
  );
});

export default helpChat;
