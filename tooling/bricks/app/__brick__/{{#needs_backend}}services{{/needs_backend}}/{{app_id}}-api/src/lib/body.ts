// body.ts — a RE-EXPORT. The one home is services/_shared/src/body.ts: read at
// most N bytes of a request body, refusing anything larger, BEFORE it is parsed.
// Its header holds the defect that made it, and why Content-Length is a hint.
export * from '../../../_shared/src/body';
