// ─────────────────────────────────────────────────────────────────────────────
// lifecycle.ts — the status a report moves through (lane feedback-triage, Do 3).
//
//   new -> triaged -> duplicate | known | in-fix(PR) -> fixed(version) -> notified
//   plus wontfix and spam.
//
// MOVES is the whole graph: a move it does not list is refused, so a triage
// tool, a person with the ops secret or a bug can never jump a report from
// `new` to `notified` (no mail would then be sent, and the reporter would be
// recorded as told). `notified` is reached ONLY by the cron, after it has
// claimed the report and mailed it (lib/notify.ts); the ops route refuses it.
//
// Each move names what it needs: `duplicate` the FB- id it duplicates, `in-fix`
// the fix PR's number, `fixed` the release version. Every move is written with
// its timestamp and its writer into `status_history` (0027_feedback.sql).
// ─────────────────────────────────────────────────────────────────────────────

export const STATUSES = ['new', 'triaged', 'duplicate', 'known', 'in-fix', 'fixed', 'notified', 'wontfix', 'spam'] as const;
export type Status = (typeof STATUSES)[number];

/** Every legal move, from each status. Anything else is refused. */
export const MOVES: Readonly<Record<Status, readonly Status[]>> = {
  new: ['triaged', 'spam'],
  triaged: ['duplicate', 'known', 'in-fix', 'wontfix', 'spam'],
  duplicate: ['triaged'],
  known: ['in-fix', 'wontfix'],
  'in-fix': ['fixed', 'triaged'],
  fixed: ['notified'],
  notified: [],
  wontfix: ['triaged'],
  spam: [],
};

/** The one move only the cron makes: it mails first. */
export const CRON_ONLY: ReadonlySet<Status> = new Set<Status>(['notified']);

export const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

export const REPORT_ID = /^FB-[0-9A-HJKMNP-TV-Z]{10}$/;
/** A release version: 1 to 4 dot-separated numbers, an optional +build. */
export const VERSION = /^\d{1,5}(\.\d{1,5}){0,3}(\+\d{1,9})?$/;

export interface MoveRequest {
  id: string;
  to: Status;
  duplicateOf?: string;
  pr?: number;
  version?: string;
}

/** What a move needs beyond its target, or the field that is wrong. */
export function checkMove(from: Status, req: MoveRequest, by: 'ops' | 'cron'): { ok: true } | { ok: false; error: string; field?: string } {
  if (by === 'ops' && CRON_ONLY.has(req.to)) return { ok: false, error: 'cron_only', field: 'to' };
  if (!MOVES[from].includes(req.to)) return { ok: false, error: 'illegal_move', field: 'to' };
  if (req.to === 'duplicate' && !(typeof req.duplicateOf === 'string' && REPORT_ID.test(req.duplicateOf) && req.duplicateOf !== req.id)) {
    return { ok: false, error: 'required', field: 'duplicateOf' };
  }
  if (req.to === 'in-fix' && !(Number.isInteger(req.pr) && (req.pr as number) > 0)) return { ok: false, error: 'required', field: 'pr' };
  if (req.to === 'fixed' && !(typeof req.version === 'string' && VERSION.test(req.version))) {
    return { ok: false, error: 'required', field: 'version' };
  }
  return { ok: true };
}

export interface HistoryEntry {
  from: Status;
  to: Status;
  at: string;
  by: 'ops' | 'cron';
}

/** The history JSON with one more move appended; a corrupt value restarts it. */
export function appendHistory(prior: string | null, entry: HistoryEntry): string {
  let list: unknown = [];
  try {
    list = prior ? JSON.parse(prior) : [];
  } catch {
    list = [];
  }
  return JSON.stringify([...(Array.isArray(list) ? list : []), entry]);
}
