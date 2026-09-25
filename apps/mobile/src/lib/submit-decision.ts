import { canCommit, isChangeIntent, type IntentDecision } from '@nexui/types';

export type SubmitStep = 'commit' | 'open-form' | 'ignore';

/**
 * What the return key does with the prediction for the current text. A null decision
 * (text changed while predicting, or the prediction failed) does nothing.
 *
 * @example
 * submitStep({ intent: 'CREATE_TASK', confidence: 0.7, entities: {}, action }) // 'open-form'
 */
export function submitStep(decision: IntentDecision | null): SubmitStep {
  if (!decision?.action) {
    return 'ignore';
  }

  if (canCommit(decision)) {
    return 'commit';
  }

  // An unsure change is settled on the card: pick an item, or create one instead.
  if (isChangeIntent(decision.intent)) {
    return 'ignore';
  }

  return 'open-form';
}
