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

// EAS project link (Phase M1.5 continuation): ONE Expo/EAS project
// ("Vilu Mobile", slug "vilu-mobile") shared by BOTH variants, matching
// this task's own "one codebase, do not create another Expo project"
// requirement. `slug` therefore is NOT per-variant like name/bundle id/
// package id -- it must equal the real EAS project's own slug for
// `extra.eas.projectId` to resolve at all (confirmed live: `eas
// project:info` first failed with "Slug for project identified by
// extra.eas.projectId (vilu-mobile) does not match the 'slug' field
// (vilu-staff)" when this was still per-variant). `scheme` stays
// per-variant below -- that's an OS-level deep-link URL scheme
// (vilu-staff:// vs vilu-agency://), a completely separate concern from
// which Expo/EAS project this config is linked to.
const EAS_PROJECT_SLUG = 'vilu-mobile';
const EAS_PROJECT_ID = 'a1a1e35b-e6cf-4b2f-ae74-5a07d884b586';

const config: ExpoConfig = {
  name: identity.displayName,
  slug: EAS_PROJECT_SLUG,
  // Required alongside extra.eas.projectId below -- EAS reported that the
  // logged-in Expo account's username ("viluresidence") does not match
  // the project's own account name ("vilu-residence"), and asked for this
  // explicit field to disambiguate (see EAS's own "owner" field docs:
  // https://expo.fyi/eas-project-id). Confirmed via a real
  // `eas project:info` run during Phase M1.5, not guessed.
  owner: 'vilu-residence',
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
    // EAS project link (Phase M1.5 continuation): ONE Expo/EAS project
    // ("Vilu Mobile") shared by both variants -- matches the "one
    // codebase" principle. `eas init --id <projectId>` cannot write this
    // itself into a dynamic app.config.ts, so it's set here by hand, once,
    // for both variants (the projectId is variant-independent; only
    // name/bundle id/package id/native config differ per variant).
    eas: {
      projectId: EAS_PROJECT_ID,
    },
  },
};

export default config;
