import assert from 'node:assert/strict';
import test from 'node:test';

import { intentRequestSchema, intentResponseSchema } from '../packages/types/src/index.ts';

test('intent request accepts meaningful text and rejects blank input', () => {
  assert.deepEqual(intentRequestSchema.parse({ text: '  meet Sarah  ' }), {
    text: 'meet Sarah',
  });
  assert.equal(intentRequestSchema.safeParse({ text: '   ' }).success, false);
  assert.equal(intentRequestSchema.safeParse({ text: 42 }).success, false);
});

test('intent response validates confidence and known intent values', () => {
  const valid = { intent: 'CREATE_EVENT', confidence: 0.96, entities: { person: 'Sarah' } };
  assert.deepEqual(intentResponseSchema.parse(valid), valid);
  assert.equal(intentResponseSchema.safeParse({ ...valid, confidence: 1.2 }).success, false);
  assert.equal(intentResponseSchema.safeParse({ ...valid, intent: 'CHAT' }).success, false);
});
