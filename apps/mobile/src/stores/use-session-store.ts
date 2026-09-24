import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

type SessionStatus = 'loading' | 'signedIn' | 'signedOut';

interface SessionState {
  session: Session | null;
  status: SessionStatus;
}

// Mirrors Supabase's auth state for routing. Supabase itself owns and persists the session.
export const useSessionStore = create<SessionState>(() => ({ session: null, status: 'loading' }));

export function updateSession(session: Session | null): void {
  useSessionStore.setState({ session, status: session ? 'signedIn' : 'signedOut' });
}
