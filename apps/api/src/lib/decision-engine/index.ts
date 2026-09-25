import type { IntentDecision, IntentRequest } from '@nexui/types';

import type { TargetLookup } from './change-actions.ts';
import { JevDecisionEngine } from './jev-decision-engine.ts';
import { MockDecisionEngine } from './mock-decision-engine.ts';

export interface DecisionEngine {
  // `lookup` finds the user's saved items for change intents; without it nothing matches.
  classifyIntent(input: IntentRequest, lookup?: TargetLookup): Promise<IntentDecision>;
}

export class DecisionEngineConfigurationError extends Error {}

export function getDecisionEngine(env: NodeJS.ProcessEnv = process.env): DecisionEngine {
  const provider = env.AI_PROVIDER ?? 'mock';

  let engine: DecisionEngine;

  if (provider === 'mock') {
    engine = new MockDecisionEngine();
  } else if (provider === 'jev') {
    const apiKey = env.AI_GATEWAY_API_KEY?.trim();
    const model = env.NEXUI_INTENT_MODEL?.trim();

    if (!apiKey) {
      throw new DecisionEngineConfigurationError(
        'AI_GATEWAY_API_KEY is required for AI_PROVIDER=jev.',
      );
    }

    if (!model) {
      throw new DecisionEngineConfigurationError(
        'NEXUI_INTENT_MODEL is required for AI_PROVIDER=jev.',
      );
    }

    const timeoutMs = Number(env.NEXUI_INTENT_TIMEOUT_MS ?? '3500');

    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 4500) {
      throw new DecisionEngineConfigurationError(
        'NEXUI_INTENT_TIMEOUT_MS must be an integer from 1 to 4500 (below the mobile timeout).',
      );
    }

    engine = new JevDecisionEngine({ apiKey, model, timeoutMs });
  } else {
    throw new DecisionEngineConfigurationError('AI_PROVIDER must be mock or jev.');
  }

  return {
    async classifyIntent(input, lookup) {
      const start = performance.now();
      const decision = await engine.classifyIntent(input, lookup);

      if (env.NODE_ENV !== 'production') {
        console.info(
          `[intent] provider=${provider} intent=${decision.intent} confidence=${decision.confidence} latencyMs=${Math.round(performance.now() - start)}`,
        );
      }

      return decision;
    },
  };
}
