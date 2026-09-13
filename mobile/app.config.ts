import type { ExpoConfig } from 'expo/config';
import { APP_VARIANT, getVariantIdentity } from './src/config/variant';

/**
 * Dynamic Expo config — the ONE place app name / bundle id (iOS) /
 * package id (Android) diverge between the two variants. Everything else
 * (icon/splash paths, plugin list) is shared. Run with:
 *   APP_VARIANT=staff npx expo start
 *   APP_VARIANT=agency npx expo start
 */
const identity = getVariantIdentity(APP_VARIANT);

const config: ExpoConfig = {
  name: identity.displayName,
  slug: identity.slug,
  scheme: identity.slug,
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0e7c86',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: identity.applicationId,
    supportsTablet: true,
    // GoogleService-Info.plist is intentionally NOT committed to this repo
    // (no real Firebase iOS app has been registered yet) -- see
    // mobile/README.md "Firebase project setup" before a real device/
    // simulator build.
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? undefined,
  },
  android: {
    package: identity.applicationId,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0e7c86',
    },
    // google-services.json is intentionally NOT committed -- see the same
    // README section as above.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? undefined,
  },
  plugins: [
    'expo-router',
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    '@react-native-firebase/crashlytics',
  ],
  extra: {
    appVariant: APP_VARIANT,
  },
};

export default config;
