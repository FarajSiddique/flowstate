import type { SavedItem } from '@nexui/types';
import { create } from 'zustand';

/**
 * What Undo reverses: a logged Magic Bar action (by its log id), or a task completed
 * from its checkbox (reopened with a PATCH).
 */
export type UndoTarget =
  | { type: 'intent'; eventId: string }
  | { type: 'completion'; task: Pick<SavedItem, 'kind' | 'id'> };

/** The card above the Magic Bar. `undo` is null for a status line with no Undo button. */
export interface UndoToast {
  undo: UndoTarget | null;
  message: string;
  shownAt: number;
}

interface UndoState {
  toast: UndoToast | null;
}

export const UNDO_MS = 8_000;
export const STATUS_MS = 2_500;

// Local UI state only; the log and items live on the server.
export const useUndoStore = create<UndoState>(() => ({ toast: null }));

/** Offers Undo for a just-applied action, replacing any earlier card. */
export function showUndo(eventId: string, message: string): void {
  useUndoStore.setState({
    toast: { undo: { type: 'intent', eventId }, message, shownAt: Date.now() },
  });
}

/** Offers Undo for a task just completed from its checkbox. */
export function showCompletionUndo(task: Pick<SavedItem, 'kind' | 'id'>, message: string): void {
  useUndoStore.setState({
    toast: {
      undo: { type: 'completion', task: { kind: task.kind, id: task.id } },
      message,
      shownAt: Date.now(),
    },
  });
}

/** Replaces the card with a short status line such as "Undone". */
export function showUndoStatus(message: string): void {
  useUndoStore.setState({ toast: { undo: null, message, shownAt: Date.now() } });
}

export function clearUndo(): void {
  useUndoStore.setState({ toast: null });
}
