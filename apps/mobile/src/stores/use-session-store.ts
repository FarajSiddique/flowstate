import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';

type SessionStatus = 'loading' | 'signedIn' | 'signedOut';

interface SessionState {
  session: Session | null;
  status: SessionStatus;
}

// Mirrors Supabase's auth state for routing. Supabase itself owns and persists the session.
export const useSessionStore = create<SessionState>(() => ({ session: null, status: 'loading' }));

// INITIAL_SESSION arrives first with the stored session (or null), then every sign-in,
// refresh and sign-out. Keep the callback synchronous: Supabase awaits it.
supabase.auth.onAuthStateChange((_event, session) => {
  useSessionStore.setState({ session, status: session ? 'signedIn' : 'signedOut' });
});
