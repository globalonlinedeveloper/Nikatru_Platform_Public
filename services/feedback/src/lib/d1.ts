// d1.ts — a RE-EXPORT. The one home is services/_shared/src/d1.ts, which this
// Worker, its twin and the app template's Worker all carry from. Its header holds
// the transient-retry reasoning, the production stack trace that named the defect,
// the caller contract `run` rests on, and the measured reason services/_shared may
// hold no bare import. [ADR 067] decision 2.
export * from '../../../_shared/src/d1';
