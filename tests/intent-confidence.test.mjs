import assert from 'node:assert/strict';
import test from 'node:test';

import { previewEmphasis } from '../apps/mobile/src/lib/intent-confidence.ts';

test('uses one confidence policy and hides unknown decisions', () => {
  assert.equal(previewEmphasis({ intent: 'CREATE_EVENT', confidence: 0.85 }), 'high');
  assert.equal(previewEmphasis({ intent: 'CREATE_TASK', confidence: 0.6 }), 'medium');
  assert.equal(previewEmphasis({ intent: 'CREATE_NOTE', confidence: 0.59 }), 'none');
  assert.equal(previewEmphasis({ intent: 'UNKNOWN', confidence: 0.99 }), 'none');
});
