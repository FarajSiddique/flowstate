import { create } from 'zustand';

/** The card above the Magic Bar. `eventId` is null for a status line with no Undo button. */
export interface UndoToast {
  eventId: string | null;
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
  useUndoStore.setState({ toast: { eventId, message, shownAt: Date.now() } });
}

/** Replaces the card with a short status line such as "Undone". */
export function showUndoStatus(message: string): void {
  useUndoStore.setState({ toast: { eventId: null, message, shownAt: Date.now() } });
}

export function clearUndo(): void {
  useUndoStore.setState({ toast: null });
}
