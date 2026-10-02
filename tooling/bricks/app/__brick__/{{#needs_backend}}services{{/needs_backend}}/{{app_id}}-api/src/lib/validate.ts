// validate.ts — a RE-EXPORT. The one home is services/_shared/src/validate.ts: the
// leaf checks a route's `validate(body)` is built from, so no unchecked value
// from a public body reaches a D1 bind.
export * from '../../../_shared/src/validate';
