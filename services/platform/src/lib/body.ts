// body.ts — a RE-EXPORT. The one home is services/_shared/src/body.ts, which this
// Worker and services/subscriptiontracker-api both bound their request bodies with
// (⏱ 2026-09-30 · ST-N6 D11: PATCH /v1/preferences is capped by the same reader).
export * from '../../../_shared/src/body';
