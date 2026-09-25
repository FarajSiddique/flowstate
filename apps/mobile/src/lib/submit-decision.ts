import { canCommit, isChangeAction, isChangeIntent, type IntentDecision } from '@nexui/types';

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

  // A change below the threshold opens the form when it has a target to act on;
  // with no target it's settled on the card instead (pick an item, or create one).
  if (isChangeIntent(decision.intent) && isChangeAction(decision.action)) {
    return decision.action.target ? 'open-form' : 'ignore';
  }

  return 'open-form';
}
