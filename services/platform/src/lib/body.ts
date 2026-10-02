// body.ts — a RE-EXPORT. The one home is services/_shared/src/body.ts, which this
// Worker, services/subscriptiontracker-api's stamped twin and the brick's Worker
// carry from. Its header holds why the body is bounded BEFORE it is parsed and
// why Content-Length is a hint, not a bound. rv2 SYN-S2.
export * from '../../../_shared/src/body';
