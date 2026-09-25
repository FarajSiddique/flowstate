import type { IntentAction } from '@nexui/types';

import { displayLocalDateTime } from './intent-display.ts';

/** The preview's main button label: exactly what pressing it will do. */
export function commitLabel(action: IntentAction): string {
  switch (action.kind) {
    case 'CREATE_TASK':
      return 'Add task';
    case 'CREATE_EVENT':
      return 'Add event';
    case 'CREATE_NOTE':
      return 'Save note';
    case 'SEARCH':
      return 'Search';
    case 'COMPLETE':
      return action.target ? `Mark '${action.target.title}' done` : 'Mark done';
    case 'RESCHEDULE': {
      const when = displayLocalDateTime(action.to);

      return action.target && when ? `Move ${action.target.title} to ${when}` : 'Choose a new time';
    }

    case 'APPEND':
      return action.target ? `Add to ${action.target.title}` : 'Add to note';
  }
}

function withWhen(text: string, when: string | null): string {
  return when ? `${text} · ${when}` : text;
}

/**
 * The Undo card's message after an instant save or change.
 *
 * @example
 * undoMessage({ kind: 'COMPLETE', target: { title: 'Report', ... }, ... }) // 'Marked done: Report'
 */
export function undoMessage(action: IntentAction): string {
  switch (action.kind) {
    case 'CREATE_TASK':
      return withWhen(`Added: ${action.title}`, displayLocalDateTime(action.due));
    case 'CREATE_EVENT':
      return withWhen(`Added: ${action.title}`, displayLocalDateTime(action.start));
    case 'CREATE_NOTE':
      return `Saved: ${action.title}`;
    case 'SEARCH':
      return 'Searched';
    case 'COMPLETE':
      return `Marked done: ${action.target?.title ?? 'item'}`;
    case 'RESCHEDULE':
      return withWhen(`Moved ${action.target?.title ?? 'item'}`, displayLocalDateTime(action.to));
    case 'APPEND':
      return `Added to ${action.target?.title ?? 'note'}`;
  }
}
