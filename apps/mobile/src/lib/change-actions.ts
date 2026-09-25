import { resolveRescheduleTo, type ChangeAction, type ItemRef } from '@nexui/types';

/** Sets the item picked from "Which one?"; a move is resolved against that item's date. */
export function withTarget(action: ChangeAction, target: ItemRef, today: string): ChangeAction {
  switch (action.kind) {
    case 'RESCHEDULE':
      return {
        ...action,
        target,
        alternatives: [],
        to: action.toParsed ? resolveRescheduleTo(action.toParsed, target.when, today) : null,
      };
    case 'COMPLETE':
    case 'APPEND':
      return { ...action, target, alternatives: [] };
  }
}
