// health.ts — a RE-EXPORT. The one home is services/_shared/src/health.ts, which
// this stamped Worker, services/platform and services/subscriptiontracker-api all carry from.
// Its header holds the three-state design, the cache reasoning and the measured
// reason services/_shared may hold no bare import. [ADR 067] decision 2.
export * from '../../../_shared/src/health';
