import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { AppState, AppStateStatus } from 'react-native';

type SessionClient = Pick<
  SupabaseClient['auth'],
  'onAuthStateChange' | 'startAutoRefresh' | 'stopAutoRefresh'
>;
type NativeAppState = Pick<typeof AppState, 'currentState' | 'addEventListener'>;

// Supabase starts refresh asynchronously. Serialize changes across root-layout remounts.
const refreshOperations = new WeakMap<SessionClient, Promise<void>>();

/** Mirrors Supabase sessions and, on native, refreshes only while foregrounded. */
export function startSessionLifecycle(
  auth: SessionClient,
  onSession: (session: Session | null) => void,
  appState?: NativeAppState,
): () => void {
  let active = true;
  const {
    data: { subscription },
  } = auth.onAuthStateChange((_event, session) => {
    // Supabase awaits this callback. Keep it synchronous and free of auth calls.
    if (active) {
      onSession(session);
    }
  });

  function updateRefresh(state: AppStateStatus) {
    if (!active) {
      return;
    }
    const previous = refreshOperations.get(auth);
    refreshOperations.set(auth, applyRefresh(previous, state));
  }

  async function applyRefresh(previous: Promise<void> | undefined, state: AppStateStatus) {
    try {
      await previous;
      if (active && state === 'active') {
        await auth.startAutoRefresh();
      } else {
        await auth.stopAutoRefresh();
      }
    } catch {
      console.warn('[auth] Could not update session refresh.');
    }
  }

  const appStateSubscription = appState?.addEventListener('change', updateRefresh);
  if (appState) {
    updateRefresh(appState.currentState);
  }

  return () => {
    subscription.unsubscribe();
    appStateSubscription?.remove();
    if (appState) {
      updateRefresh('background');
    }
    active = false;
  };
}
