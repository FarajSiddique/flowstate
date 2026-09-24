import { AtkinsonHyperlegible_400Regular } from '@expo-google-fonts/atkinson-hyperlegible/400Regular';
import { AtkinsonHyperlegible_700Bold } from '@expo-google-fonts/atkinson-hyperlegible/700Bold';
import { BricolageGrotesque_500Medium } from '@expo-google-fonts/bricolage-grotesque/500Medium';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactElement } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QueryProvider } from '@/lib/query-provider';
import { startSessionLifecycle } from '@/lib/session-lifecycle';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { updateSession, useSessionStore } from '@/stores/use-session-store';

export default function RootLayout(): ReactElement | null {
  useEffect(() => {
    const nativeAppState = Platform.OS === 'web' ? undefined : AppState;

    return startSessionLifecycle(supabase.auth, updateSession, nativeAppState);
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
    BricolageGrotesque_500Medium,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
  });
  const sessionStatus = useSessionStore((state) => state.status);

  // A failed font load falls back to system faces rather than blocking the app.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  // Wait for the stored session so a signed-in user never sees the sign-in screen flash.
  if (sessionStatus === 'loading') {
    return null;
  }

  const signedIn = sessionStatus === 'signedIn';

  return (
    <SafeAreaProvider>
      <QueryProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}
        >
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
