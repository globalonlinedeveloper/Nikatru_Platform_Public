// edge-ceiling.ts — a RE-EXPORT. The one home is services/_shared/src/rate-limit.ts,
// which this Worker and the brick's Worker carry from. Its header holds why nothing
// in the key comes from the caller, the two fail-open paths that must not be one
// observable event, and the fail-closed `strictRateLimit`.
// rv2 SYN-S2.
export * from '../../../_shared/src/rate-limit';
