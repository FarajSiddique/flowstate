/**
 * Runs the intent fixtures through a decision engine and reports accuracy.
 * Uses the mock engine unless `--provider jev` is passed (billed gateway calls).
 *
 * @example
 * pnpm eval:intent
 * pnpm eval:intent --provider jev --out /tmp/jev.json
 * pnpm eval:intent --compare /tmp/jev.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { getDecisionEngine } from '../apps/api/src/lib/decision-engine/index.ts';

// A fixed clock keeps relative dates such as "tomorrow" stable between runs.
const context = { now: '2026-01-15T09:00:00-05:00', timeZone: 'America/New_York' };

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'mock' },
    fixtures: { type: 'string', default: 'evals/intent-fixtures.json' },
    out: { type: 'string' },
    compare: { type: 'string' },
  },
});

// NODE_ENV=production silences the engine's per-request debug logging.
function loadEnv(provider) {
  if (provider === 'jev') {
    process.loadEnvFile('apps/api/.env.local');
  }

  return { ...process.env, AI_PROVIDER: provider, NODE_ENV: 'production' };
}

async function classify(engine, fixture, lookup) {
  const start = performance.now();

  try {
    const decision = await engine.classifyIntent({ text: fixture.text, context }, lookup);

    return {
      ...fixture,
      actualIntent: decision.intent,
      confidence: Number(decision.confidence.toFixed(2)),
      hasAction: Boolean(decision.action),
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      ...fixture,
      actualIntent: 'ERROR',
      confidence: 0,
      hasAction: false,
      latencyMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarize(results) {
  const byIntent = {};

  for (const result of results) {
    const bucket = (byIntent[result.expectedIntent] ??= { correct: 0, total: 0 });

    bucket.total += 1;

    if (result.actualIntent === result.expectedIntent) {
      bucket.correct += 1;
    }
  }

  const correct = results.filter((result) => result.actualIntent === result.expectedIntent).length;

  return { provider: values.provider, accuracy: correct / results.length, byIntent, results };
}

function printReport(summary) {
  console.table(
    summary.results.map((result) => ({
      text: result.text.slice(0, 48),
      expected: result.expectedIntent,
      actual: result.actualIntent,
      ok: result.actualIntent === result.expectedIntent ? '✓' : '✗',
      confidence: result.confidence,
      action: result.hasAction,
      ms: result.latencyMs,
    })),
  );

  for (const [intent, { correct, total }] of Object.entries(summary.byIntent)) {
    console.log(`${intent.padEnd(12)} ${correct}/${total}`);
  }

  console.log(`\n${summary.provider} accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);
}

async function printComparison(summary, path) {
  const previous = JSON.parse(await readFile(path, 'utf8'));
  const before = new Map(previous.results.map((result) => [result.text, result]));
  const changes = [];

  for (const result of summary.results) {
    const old = before.get(result.text);

    if (!old) {
      changes.push({ text: result.text, change: 'new fixture' });
    } else if (old.actualIntent !== result.actualIntent) {
      changes.push({ text: result.text, change: `${old.actualIntent} → ${result.actualIntent}` });
    } else if (Math.abs(old.confidence - result.confidence) >= 0.1) {
      changes.push({
        text: result.text,
        change: `confidence ${old.confidence} → ${result.confidence}`,
      });
    }
  }

  const delta = ((summary.accuracy - previous.accuracy) * 100).toFixed(1);

  console.log(`\nCompared with ${path} (${previous.provider}): accuracy ${delta} points`);

  if (changes.length === 0) {
    console.log('No intent changes or confidence shifts of 0.1 or more.');
  } else {
    console.table(changes);
  }
}

const fixtures = JSON.parse(await readFile(values.fixtures, 'utf8'));
const savedItems = JSON.parse(await readFile('evals/saved-items.json', 'utf8'));

// Stands in for the user's saved items: titles containing every word of the phrase.
const lookup = {
  async findTargets(phrase, kinds) {
    const words = phrase.toLowerCase().split(/\s+/);

    return savedItems.filter(
      (item) =>
        kinds.includes(item.kind) && words.every((word) => item.title.toLowerCase().includes(word)),
    );
  },
};

const engine = getDecisionEngine(loadEnv(values.provider));
const results = [];

// Sequential, so jev latency reflects single requests and stays within rate limits.
for (const fixture of fixtures) {
  results.push(await classify(engine, fixture, lookup));
}

const summary = summarize(results);

printReport(summary);

if (values.compare) {
  await printComparison(summary, values.compare);
}

if (values.out) {
  await writeFile(values.out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Saved summary to ${values.out}`);
}
