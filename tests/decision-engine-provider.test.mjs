import assert from 'node:assert/strict';
import test from 'node:test';

import { getDecisionEngine } from '../apps/api/src/lib/decision-engine/index.ts';

const config = {
  AI_PROVIDER: 'jev',
  AI_GATEWAY_API_KEY: 'test-secret',
  FLOWSTATE_INTENT_MODEL: 'typesafe-ai/jev',
};

// 22:30 on Sep 23 in New York, 02:30 on Sep 24 in UTC.
const context = { now: '2026-09-24T02:30:00Z', timeZone: 'America/New_York' };

test('mock remains the default and needs no Gateway configuration', async () => {
  for (const env of [{}, { AI_PROVIDER: 'mock' }]) {
    assert.deepEqual(
      await getDecisionEngine(env).classifyIntent({ text: 'meet Sarah tomorrow at 2', context }),
      {
        intent: 'CREATE_EVENT',
        confidence: 0.96,
        entities: { title: 'Meet Sarah', person: 'Sarah', date: 'tomorrow', time: '14:00' },
        action: {
          kind: 'CREATE_EVENT',
          title: 'Meet Sarah',
          start: { date: '2026-09-24', time: '14:00' },
          durationMin: 30,
          attendees: ['Sarah'],
          location: null,
        },
      },
    );
  }
});

test('jev selection requires explicit server configuration and rejects invalid providers', () => {
  assert.equal(typeof getDecisionEngine(config).classifyIntent, 'function');
  assert.throws(() => getDecisionEngine({ AI_PROVIDER: 'typo' }), /AI_PROVIDER/);
  assert.throws(() => getDecisionEngine({ AI_PROVIDER: '' }), /AI_PROVIDER/);
  assert.throws(
    () => getDecisionEngine({ ...config, AI_GATEWAY_API_KEY: ' ' }),
    /AI_GATEWAY_API_KEY/,
  );
  assert.throws(
    () => getDecisionEngine({ ...config, FLOWSTATE_INTENT_MODEL: '' }),
    /FLOWSTATE_INTENT_MODEL/,
  );
  for (const timeout of ['0', '-10', 'NaN', '1.5', '5000']) {
    assert.throws(
      () => getDecisionEngine({ ...config, FLOWSTATE_INTENT_TIMEOUT_MS: timeout }),
      /FLOWSTATE_INTENT_TIMEOUT_MS/,
    );
  }
});
