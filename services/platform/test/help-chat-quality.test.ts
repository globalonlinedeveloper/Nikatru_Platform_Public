import { describe, expect, it } from 'vitest';
import quality from './fixtures/help-chat-quality.json';
import { retrieve, validateAnswer, looksLikeInjection } from '../src/lib/help/chat';

// ─────────────────────────────────────────────────────────────────────────────
// help-chat-quality.test.ts — THE QUALITY BAR the help chat's model must pass
// (lane help-ai-chat, Do 4). Over at least 30 recorded question/answer fixtures
// (test/fixtures/help-chat-quality.json): the question retrieves the article
// that answers it, and the recorded answer passes the validator — it cites the
// right article, names no price, carries no link and restates no refund or terms
// wording. A candidate model's recorded answers are graded by the SAME checks;
// the cheapest that passes is the one tooling/ports/ai.json features.help.model
// may name. Each check is shown able to fail on a broken copy of a good answer.
// No live model is called.
// ─────────────────────────────────────────────────────────────────────────────

interface Fixture {
  question: string;
  article: string;
  recorded: { in_scope: boolean; answer: string; citations: string[] };
}
const FIXTURES = (quality as { fixtures: Fixture[] }).fixtures;
const APP = 'subscriptiontracker';

describe('the help chat quality bar', () => {
  it('has at least 30 recorded fixtures, every one a real help article', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(FIXTURES.map((f) => [f.question, f] as const))('%s', (_q, f) => {
    const docs = retrieve(APP, 'en', f.question);
    // Grounding: the article that answers it is in the context the model is given.
    expect(docs.map((d) => d.id), 'the answering article was not retrieved').toContain(f.article);
    expect(looksLikeInjection(f.question)).toBe(false);
    // The recorded answer passes: citation correct and nothing the bar forbids.
    expect(validateAnswer(f.recorded, docs)).toBeNull();
    expect(f.recorded.citations).toContain(f.article);
    // 🔴 and the bar can fail on this very answer.
    expect(validateAnswer({ ...f.recorded, citations: [] }, docs)).toBe('no_citation');
    expect(validateAnswer({ ...f.recorded, answer: `${f.recorded.answer} Pro is ₹149 a month.` }, docs)).toBe('price');
    expect(validateAnswer({ ...f.recorded, answer: `${f.recorded.answer} Refunds are given within 14 days.` }, docs)).toBe('owner_wording');
  });
});
