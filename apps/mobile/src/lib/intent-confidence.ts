import type { IntentDecision } from '@nexui/types';

export const HIGH_CONFIDENCE = 0.85;
export const MEDIUM_CONFIDENCE = 0.6;

export type PreviewEmphasis = 'high' | 'medium' | 'none';

export function previewEmphasis(
  decision: Pick<IntentDecision, 'intent' | 'confidence'>,
): PreviewEmphasis {
  if (decision.intent === 'UNKNOWN' || decision.confidence < MEDIUM_CONFIDENCE) {
    return 'none';
  }
  return decision.confidence >= HIGH_CONFIDENCE ? 'high' : 'medium';
}
