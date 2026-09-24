import type { ConfigContext, ExpoConfig } from 'expo/config';

// Permanent store identifiers (see docs/specs/auth.md A1). Don't change after release.
const appId = 'ai.faraj.nexui';

// Reversed iOS OAuth client ID. Local builds read it from .env; EAS builds need it as an EAS
// environment variable because .env isn't uploaded.
const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();

if (!googleIosUrlScheme) {
  const message =
    'EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME is not set, so iOS builds cannot use Google sign-in.';
  if (process.env.EAS_BUILD_PLATFORM === 'ios') throw new Error(message);
  if (process.env.EAS_BUILD !== 'true') console.warn(`[app.config] ${message}`);
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'nexui',
  slug: 'nexui',
  owner: 'farajsiddiques-team',
  version: '1.0.0',
  scheme: 'nexui',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: appId,
  },
  android: {
    package: appId,
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    ...(googleIosUrlScheme
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: googleIosUrlScheme },
          ] satisfies [string, unknown],
        ]
      : []),
  ],
  experiments: {
    typedRoutes: true,
  },
  web: {
    bundler: 'metro',
    output: 'single',
  },
  extra: {
    router: {},
    eas: {
      projectId: '2a0da270-390a-4e11-874f-6fa3a7f85d68',
    },
  },
});
