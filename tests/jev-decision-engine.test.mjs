import assert from 'node:assert/strict';
import test from 'node:test';

import { JevDecisionEngine } from '../apps/api/src/lib/decision-engine/jev-decision-engine.ts';

const config = { apiKey: 'test-secret', model: 'typesafe-ai/jev', timeoutMs: 100 };
const unknown = { intent: 'UNKNOWN', confidence: 0, entities: {} };
const input = { text: 'meet Sarah tomorrow at 2' };

function evaluation(choice = 'CREATE_EVENT', confidence = 0.96, ready = 0.99) {
  return {
    model: 'typesafe-ai/jev',
    answers: {
      intent: {
        type: 'choice',
        choice,
        confidence,
        probabilities: {
          CREATE_EVENT: choice === 'CREATE_EVENT' ? 0.98 : 0.005,
          CREATE_TASK: choice === 'CREATE_TASK' ? 0.98 : 0.005,
          CREATE_NOTE: choice === 'CREATE_NOTE' ? 0.98 : 0.005,
          SEARCH: choice === 'SEARCH' ? 0.98 : 0.005,
          UNKNOWN: choice === 'UNKNOWN' ? 0.98 : 0.005,
        },
      },
      ready: { type: 'boolean', probability: ready },
    },
    usage: { inputTokens: 120, outputTokens: 35 },
    providerMetadata: { gateway: { routing: { finalProvider: 'typesafe-ai' } } },
  };
}

function engineFor(result, options = {}) {
  return new JevDecisionEngine({ ...config, ...options }, async () => Response.json(result));
}

test('calls the documented Gateway evaluation endpoint with the configured model and constrained choices', async () => {
  let request;
  const engine = new JevDecisionEngine(config, async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return Response.json(evaluation());
  });
  assert.deepEqual(await engine.classifyIntent(input), {
    intent: 'CREATE_EVENT',
    confidence: 0.96,
    entities: { title: 'Meet Sarah', person: 'Sarah', date: 'tomorrow', time: '14:00' },
  });
  assert.equal(request.url, 'https://ai-gateway.vercel.sh/v1/evaluate');
  assert.equal(request.headers.Authorization, 'Bearer test-secret');
  assert.equal(request.body.model, 'typesafe-ai/jev');
  assert.deepEqual(request.body.state, { text: input.text });
  assert.deepEqual(Object.keys(request.body.questions.intent.criteria).sort(), [
    'CREATE_EVENT',
    'CREATE_NOTE',
    'CREATE_TASK',
    'SEARCH',
    'UNKNOWN',
  ]);
  assert.equal(request.body.questions.ready.type, 'boolean');
  assert.ok(request.signal instanceof AbortSignal);
});

test('uses the Jev choice even for phrases the mock does not recognize', async () => {
  assert.deepEqual(
    await engineFor(evaluation('CREATE_TASK')).classifyIntent({
      text: 'finish the report tonight',
    }),
    {
      intent: 'CREATE_TASK',
      confidence: 0.96,
      entities: { title: 'Finish the report', date: 'tonight' },
    },
  );
  assert.deepEqual(
    await engineFor(evaluation('CREATE_NOTE')).classifyIntent({
      text: 'write down idea about AI sports coach',
    }),
    {
      intent: 'CREATE_NOTE',
      confidence: 0.96,
      entities: { title: 'AI sports coach' },
    },
  );
  assert.deepEqual(
    await engineFor(evaluation('SEARCH')).classifyIntent({ text: 'find my architecture notes' }),
    {
      intent: 'SEARCH',
      confidence: 0.96,
      entities: { query: 'architecture notes' },
    },
  );
});

test('limits partial-input confidence using readiness; UNKNOWN never carries entities', async () => {
  const partial = await engineFor(evaluation('CREATE_EVENT', 0.99, 0.2)).classifyIntent({
    text: 'meet',
  });
  assert.equal(partial.confidence, 0.2);
  assert.deepEqual(partial.entities, {});
  assert.deepEqual((await engineFor(evaluation('UNKNOWN')).classifyIntent(input)).entities, {});
});

test('supports Gateway answers without a separate confidence field', async () => {
  const result = evaluation();
  delete result.answers.intent.confidence;
  assert.equal((await engineFor(result).classifyIntent(input)).confidence, 0.98);
});

test('rejects malformed or out-of-contract Gateway answers', async () => {
  const invalid = [
    null,
    {},
    { error: 'provider failure' },
    evaluation('DELETE_EVERYTHING'),
    evaluation('CREATE_EVENT', 1.5),
    evaluation('CREATE_EVENT', 0.9, -1),
  ];
  const missing = evaluation();
  delete missing.answers.intent.probabilities.CREATE_TASK;
  invalid.push(missing);
  for (const result of invalid) {
    assert.deepEqual(await engineFor(result).classifyIntent(input), unknown);
  }
  const engine = new JevDecisionEngine(config, async () => new Response('not json'));
  assert.deepEqual(await engine.classifyIntent(input), unknown);
});

test('HTTP and network errors return UNKNOWN without retrying or leaking provider data', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const engine = new JevDecisionEngine(config, async () => {
      calls++;
      return new Response('test-secret raw provider internals', { status });
    });
    assert.deepEqual(await engine.classifyIntent(input), unknown);
    assert.equal(calls, 1);
  }
  const engine = new JevDecisionEngine(config, async () => {
    throw new Error('test-secret');
  });
  assert.deepEqual(await engine.classifyIntent(input), unknown);
  assert.doesNotMatch(JSON.stringify(warnings.mock.calls), /test-secret|raw provider internals/);
});

test('times out and aborts a stalled Gateway request', async () => {
  let signal;
  const engine = new JevDecisionEngine({ ...config, timeoutMs: 10 }, async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  assert.deepEqual(await engine.classifyIntent(input), unknown);
  assert.equal(signal.aborted, true);
});

test('timeout also covers a stalled response body', async () => {
  const engine = new JevDecisionEngine({ ...config, timeoutMs: 10 }, async () => ({
    ok: true,
    json: () => new Promise(() => {}),
  }));
  assert.deepEqual(await engine.classifyIntent(input), unknown);
});
