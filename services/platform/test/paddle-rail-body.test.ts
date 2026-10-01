// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · port-pay-core · THE PADDLE CREATE BODY, BYTE FOR BYTE.
//
// Recorded at 92dd961a BEFORE the transaction-body builder moved behind
// `paddleRail` (lib/mor/paddle-rail.ts), while it still lived in routes/checkout.ts.
// The move is a refactor of WHERE the bytes are made, never of WHAT they are: a
// different serialization is a different request to Paddle, so this literal is
// the evidence that the deploy changes no behaviour. Do not re-record it to make
// a change pass; a body change is its own reviewed change with its own ADR line.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { buildCreateTransactionBody, serializeCreateTransactionBody } from '../src/lib/mor/paddle-rail';

const RECORDED_AT_92DD961A =
  '{"items":[{"price_id":"pri_01snapshotfixture","quantity":1}],' +
  '"custom_data":{"nikatru_user_id":"user-snapshot-1","nikatru_app_id":"subscriptiontracker"}}';

describe('the Paddle create-transaction body is byte-identical across the port move', () => {
  it('serializes exactly the bytes recorded before the move', () => {
    const body = buildCreateTransactionBody({
      priceId: 'pri_01snapshotfixture',
      userId: 'user-snapshot-1',
      appId: 'subscriptiontracker',
    });
    expect(serializeCreateTransactionBody(body)).toBe(RECORDED_AT_92DD961A);
  });
});
