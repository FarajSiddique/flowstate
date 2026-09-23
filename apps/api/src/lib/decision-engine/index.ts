import type { IntentDecision, IntentRequest } from '@flowstate/types';

import { JevDecisionEngine } from './jev-decision-engine.ts';
import { MockDecisionEngine } from './mock-decision-engine.ts';

export interface DecisionEngine {
  classifyIntent(input: IntentRequest): Promise<IntentDecision>;
}

export class DecisionEngineConfigurationError extends Error {}

export function getDecisionEngine(env: NodeJS.ProcessEnv = process.env): DecisionEngine {
  const provider = env.AI_PROVIDER ?? 'mock';

  let engine: DecisionEngine;

  if (provider === 'mock') {
    engine = new MockDecisionEngine();
  } else if (provider === 'jev') {
    const apiKey = env.AI_GATEWAY_API_KEY?.trim();
    const model = env.FLOWSTATE_INTENT_MODEL?.trim();

    if (!apiKey) {
      throw new DecisionEngineConfigurationError(
        'AI_GATEWAY_API_KEY is required for AI_PROVIDER=jev.',
      );
    }
      

    if (!model) {
      throw new DecisionEngineConfigurationError(
        'FLOWSTATE_INTENT_MODEL is required for AI_PROVIDER=jev.',
      );
    }
      
    const timeoutMs = Number(env.FLOWSTATE_INTENT_TIMEOUT_MS ?? '3500');

    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 4500) {
      throw new DecisionEngineConfigurationError(
        'FLOWSTATE_INTENT_TIMEOUT_MS must be an integer from 1 to 4500 (below the mobile timeout).',
      );
    }
    
    engine = new JevDecisionEngine({ apiKey, model, timeoutMs });
  } else {
    throw new DecisionEngineConfigurationError('AI_PROVIDER must be mock or jev.');
  }

  return {
    async classifyIntent(input) {
      const start = performance.now();
      const decision = await engine.classifyIntent(input);
      if (env.NODE_ENV !== 'production') {
        console.info(
          `[intent] provider=${provider} intent=${decision.intent} confidence=${decision.confidence} latencyMs=${Math.round(performance.now() - start)}`,
        );
      }
      return decision;
    },
  };
}
