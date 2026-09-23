import { create } from 'zustand';

interface DemoState {
  manualChecks: number;
  recordCheck: () => void;
}

// Only local UI state lives here. API results stay in TanStack Query.
export const useDemoStore = create<DemoState>((set) => ({
  manualChecks: 0,
  recordCheck: () => set((state) => ({ manualChecks: state.manualChecks + 1 })),
}));
