import type { ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config — the ONE place app name / bundle id (iOS) /
 * package id (Android) diverge between the two variants. Everything else
 * (icon/splash paths, plugin list) is shared. Run with:
 *   APP_VARIANT=staff npx expo start
 *   APP_VARIANT=agency npx expo start
 *
 * Variant resolution is DELIBERATELY duplicated here rather than imported
 * from src/config/variant.ts (the module app code actually uses) — Expo's
 * own config loader evaluates app.config.ts in an isolated context that
 * does not resolve local relative TypeScript imports the way the app's
 * own Metro bundler/tsc do (confirmed live during Phase M1.5: importing
 * './src/config/variant' here throws "Cannot find module" from
 * @expo/config's evalConfig, a known Expo dynamic-config constraint, not a
 * bug in this project's module resolution). The two copies are kept
 * intentionally tiny and identical in shape; src/config/variant.ts remains
 * the ONE place app *code* reads APP_VARIANT from.
 */
type AppVariant = 'staff' | 'agency';
const APP_VARIANT: AppVariant = process.env.APP_VARIANT === 'agency' ? 'agency' : 'staff';

const IDENTITIES: Record<AppVariant, { displayName: string; applicationId: string; slug: string }> = {
  staff: { displayName: 'Vilu Staff', applicationId: 'com.viluresidence.staff', slug: 'vilu-staff' },
  agency: { displayName: 'Vilu Agency', applicationId: 'com.viluresidence.agency', slug: 'vilu-agency' },
};

const identity = IDENTITIES[APP_VARIANT];

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
    // Real per-variant config, fetched from the ACTUAL registered Firebase
    // iOS apps (Phase M1.5) via:
    //   firebase apps:sdkconfig IOS <appId> --out native-config/<variant>/GoogleService-Info.plist
    // Not committed to git (see .gitignore) -- regenerate with the command
    // above, or override the path with GOOGLE_SERVICES_PLIST.
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? `./native-config/${APP_VARIANT}/GoogleService-Info.plist`,
  },
  android: {
    package: identity.applicationId,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0e7c86',
    },
    // Real per-variant config, fetched from the ACTUAL registered Firebase
    // Android apps (Phase M1.5) via:
    //   firebase apps:sdkconfig ANDROID <appId> --out native-config/<variant>/google-services.json
    // Not committed to git (see .gitignore) -- regenerate with the command
    // above, or override the path with GOOGLE_SERVICES_JSON.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? `./native-config/${APP_VARIANT}/google-services.json`,
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
