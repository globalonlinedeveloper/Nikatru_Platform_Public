// request-id.ts — a RE-EXPORT. The one home is services/_shared/src/request-id.ts,
// which every Worker and the brick's Worker carry from. Its header holds why a
// caller's `x-request-id` is kept only when it is a plain token of 1–64 characters.
export * from '../../../_shared/src/request-id';
