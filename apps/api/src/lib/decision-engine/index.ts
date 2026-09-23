import type { IntentDecision, IntentRequest } from '@flowstate/types';

import { MockDecisionEngine } from './mock-decision-engine';

export interface DecisionEngine {
  classifyIntent(input: IntentRequest): Promise<IntentDecision>;
}

export const decisionEngine: DecisionEngine = new MockDecisionEngine();
