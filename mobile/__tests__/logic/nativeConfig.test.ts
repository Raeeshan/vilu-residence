/**
 * Phase M1.5 — native Firebase config + variant isolation.
 *
 * Verifies the ACTUAL fetched Firebase client config files (registered via
 * `firebase apps:create`/`apps:sdkconfig`, see mobile/README.md), not a
 * description of intent. Firebase's own google-services.json format lists
 * EVERY Android app in a project as a separate `client[]` entry (confirmed
 * live during this phase -- a naive `client[0]` index check is WRONG and
 * was caught by exactly this kind of correctness check), so the real test
 * is "does this file contain a client entry whose package_name matches
 * this variant", never index-based, and never "the two files are
 * different" (they legitimately aren't, byte-for-byte, since both list
 * every sibling app in the project -- Android's own google-services
 * Gradle plugin picks the right entry via applicationId at build time).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const NATIVE_CONFIG_DIR = path.join(ROOT, 'native-config');

const VARIANTS = [
  { key: 'staff', applicationId: 'com.viluresidence.staff', displayName: 'Vilu Staff' },
  { key: 'agency', applicationId: 'com.viluresidence.agency', displayName: 'Vilu Agency' },
] as const;

function hasNativeConfig(): boolean {
  return VARIANTS.every(
    (v) =>
      fs.existsSync(path.join(NATIVE_CONFIG_DIR, v.key, 'google-services.json')) &&
      fs.existsSync(path.join(NATIVE_CONFIG_DIR, v.key, 'GoogleService-Info.plist')),
  );
}

// This suite requires the real fetched config files (Phase M1.5). If a
// checkout hasn't run `firebase apps:sdkconfig` yet (see README), skip
// rather than fail the whole suite red for a documented, expected gap.
const describeIfConfigPresent = hasNativeConfig() ? describe : describe.skip;

interface GoogleServicesClient {
  client_info: { mobilesdk_app_id: string; android_client_info: { package_name: string } };
}
interface GoogleServicesConfig {
  project_info: { project_id: string };
  client: GoogleServicesClient[];
}

describeIfConfigPresent('Android google-services.json — real fetched config, per variant', () => {
  function readGoogleServices(variantKey: string): GoogleServicesConfig {
    return JSON.parse(fs.readFileSync(path.join(NATIVE_CONFIG_DIR, variantKey, 'google-services.json'), 'utf8'));
  }
  function clientFor(config: GoogleServicesConfig, packageName: string): GoogleServicesClient | undefined {
    return config.client.find((c) => c.client_info.android_client_info.package_name === packageName);
  }

  test.each(VARIANTS)('$key config belongs to the real "vilu-residence" Firebase project (project_id)', (variant) => {
    const config = readGoogleServices(variant.key);
    expect(config.project_info.project_id).toBe('vilu-residence');
  });

  test.each(VARIANTS)('$key config contains a client entry for its OWN package id ($applicationId)', (variant) => {
    const config = readGoogleServices(variant.key);
    const client = clientFor(config, variant.applicationId);
    expect(client).toBeDefined();
    expect(client?.client_info.android_client_info.package_name).toBe(variant.applicationId);
  });

  test('Staff and Agency are genuinely DIFFERENT registered Android apps (different mobilesdk_app_id), not the same app under two names', () => {
    const staffConfig = readGoogleServices('staff');
    const agencyConfig = readGoogleServices('agency');
    const staffClient = clientFor(staffConfig, 'com.viluresidence.staff');
    const agencyClient = clientFor(agencyConfig, 'com.viluresidence.agency');
    expect(staffClient).toBeDefined();
    expect(agencyClient).toBeDefined();
    expect(staffClient?.client_info.mobilesdk_app_id).not.toBe(agencyClient?.client_info.mobilesdk_app_id);
  });
});

describeIfConfigPresent('iOS GoogleService-Info.plist — real fetched config, per variant', () => {
  function readPlistText(variantKey: string): string {
    return fs.readFileSync(path.join(NATIVE_CONFIG_DIR, variantKey, 'GoogleService-Info.plist'), 'utf8');
  }
  function plistValue(xml: string, key: string): string | null {
    const m = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
    return m?.[1] ?? null;
  }

  test.each(VARIANTS)('$key plist BUNDLE_ID matches its own applicationId ($applicationId)', (variant) => {
    const xml = readPlistText(variant.key);
    expect(plistValue(xml, 'BUNDLE_ID')).toBe(variant.applicationId);
  });
  test.each(VARIANTS)('$key plist PROJECT_ID is the real "vilu-residence" project', (variant) => {
    const xml = readPlistText(variant.key);
    expect(plistValue(xml, 'PROJECT_ID')).toBe('vilu-residence');
  });
  test('Staff and Agency iOS configs have different GOOGLE_APP_ID values (genuinely separate registered iOS apps)', () => {
    const staffId = plistValue(readPlistText('staff'), 'GOOGLE_APP_ID');
    const agencyId = plistValue(readPlistText('agency'), 'GOOGLE_APP_ID');
    expect(staffId).not.toBe(agencyId);
    expect(staffId).toMatch(/^1:751046104531:ios:/);
    expect(agencyId).toMatch(/^1:751046104531:ios:/);
  });
});

describe('app.config.ts — variant identity resolution (structural, no subprocess)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.config.ts'), 'utf8');

  test('the identity map assigns distinct, correct display names/application ids per variant', () => {
    expect(src).toMatch(/staff:\s*\{\s*displayName:\s*'Vilu Staff',\s*applicationId:\s*'com\.viluresidence\.staff'/);
    expect(src).toMatch(/agency:\s*\{\s*displayName:\s*'Vilu Agency',\s*applicationId:\s*'com\.viluresidence\.agency'/);
  });
  test('ios.bundleIdentifier and android.package both read from the SAME identity.applicationId -- never two independently-typed ids that could drift apart', () => {
    const iosBlock = src.slice(src.indexOf('ios: {'), src.indexOf('android: {'));
    const androidBlock = src.slice(src.indexOf('android: {'), src.indexOf('plugins:'));
    expect(iosBlock).toMatch(/bundleIdentifier:\s*identity\.applicationId/);
    expect(androidBlock).toMatch(/package:\s*identity\.applicationId/);
  });
  test('the native Firebase config file path is derived from APP_VARIANT for both platforms, defaulting into native-config/<variant>/', () => {
    expect(src).toMatch(/`\.\/native-config\/\$\{APP_VARIANT\}\/GoogleService-Info\.plist`/);
    expect(src).toMatch(/`\.\/native-config\/\$\{APP_VARIANT\}\/google-services\.json`/);
  });
});

describe('generated native project (expo prebuild output) — only checked when present, since it is git-ignored and regenerated on demand', () => {
  const androidDir = path.join(ROOT, 'android');
  const testIf = fs.existsSync(path.join(androidDir, 'app', 'build.gradle')) ? test : test.skip;

  testIf('the currently-generated android/ project\'s applicationId and google-services.json agree with EACH OTHER (whichever variant was last prebuilt)', () => {
    const buildGradle = fs.readFileSync(path.join(androidDir, 'app', 'build.gradle'), 'utf8');
    const appIdMatch = buildGradle.match(/applicationId '([^']+)'/);
    expect(appIdMatch).not.toBeNull();
    const applicationId = appIdMatch![1];

    const googleServicesPath = path.join(androidDir, 'app', 'google-services.json');
    expect(fs.existsSync(googleServicesPath)).toBe(true);
    const config: GoogleServicesConfig = JSON.parse(fs.readFileSync(googleServicesPath, 'utf8'));
    const matchingClient = config.client.find(
      (c) => c.client_info.android_client_info.package_name === applicationId,
    );
    expect(matchingClient).toBeDefined();
    expect(config.project_info.project_id).toBe('vilu-residence');
  });
});
