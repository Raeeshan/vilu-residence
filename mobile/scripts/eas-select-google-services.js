#!/usr/bin/env node
/**
 * EAS Build hook (Phase M1.5) — runs as `eas-build-pre-install` (see
 * package.json), i.e. on the EAS cloud builder, before `npm install`.
 *
 * native-config/ is git-ignored (see mobile/README.md), so a fresh EAS
 * clone of this repo does NOT have google-services.json on disk. Instead,
 * each variant's real Firebase Android config was uploaded ONCE as a
 * file-type EAS environment variable (GOOGLE_SERVICES_JSON_STAFF /
 * GOOGLE_SERVICES_JSON_AGENCY, environment "development") -- EAS injects
 * both as env vars pointing to their own decrypted temp paths for every
 * build in that environment, regardless of which profile is running. This
 * script reads APP_VARIANT (set literally per build profile in eas.json)
 * to pick the right one and copies it to EXACTLY the path app.config.ts
 * already defaults to locally (native-config/<variant>/google-services.json)
 * -- so app.config.ts itself needed ZERO changes for EAS to work.
 *
 * Fails the build LOUDLY (non-zero exit) rather than silently proceeding
 * if the selected file is missing, unreadable, or does not actually
 * contain a client entry for the variant's own package id -- a wrong or
 * missing Firebase config should never quietly ship in a "successful"
 * build.
 */
const fs = require('fs');
const path = require('path');

const APP_VARIANT = process.env.APP_VARIANT === 'agency' ? 'agency' : 'staff';
const EXPECTED_PACKAGE = APP_VARIANT === 'agency' ? 'com.viluresidence.agency' : 'com.viluresidence.staff';
const SOURCE_ENV_VAR = APP_VARIANT === 'agency' ? 'GOOGLE_SERVICES_JSON_AGENCY' : 'GOOGLE_SERVICES_JSON_STAFF';

function fail(message) {
  console.error(`\n[eas-select-google-services] FAILING BUILD: ${message}\n`);
  process.exit(1);
}

// Local development already has native-config/<variant>/google-services.json
// on disk (fetched via `firebase apps:sdkconfig`, see README) -- nothing to
// do outside a real EAS builder, where this hook doesn't even run.
const destDir = path.join(__dirname, '..', 'native-config', APP_VARIANT);
const destPath = path.join(destDir, 'google-services.json');

const sourcePath = process.env[SOURCE_ENV_VAR];
if (!sourcePath) {
  // Not running on EAS with the secret configured (e.g. a local
  // `npm install` outside this hook's real invocation context) -- if the
  // real file already exists locally, that's fine; only fail if it's
  // ALSO missing, since then nothing will produce a valid Firebase config.
  if (fs.existsSync(destPath)) {
    console.log(`[eas-select-google-services] ${SOURCE_ENV_VAR} not set; using existing local ${destPath}`);
    process.exit(0);
  }
  fail(`Environment variable ${SOURCE_ENV_VAR} is not set, and ${destPath} does not exist locally. ` +
    `Run 'firebase apps:sdkconfig ANDROID <appId> --out ${destPath}' locally, or configure the ` +
    `${SOURCE_ENV_VAR} file-type EAS environment variable for the "development" environment.`);
}

if (!fs.existsSync(sourcePath)) {
  fail(`${SOURCE_ENV_VAR} points to '${sourcePath}', but that file does not exist on this builder.`);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
} catch (e) {
  fail(`Could not parse the Firebase config at '${sourcePath}' as JSON: ${e.message}`);
}

const projectId = config && config.project_info && config.project_info.project_id;
if (projectId !== 'vilu-residence') {
  fail(`Firebase config project_id is '${projectId}', expected 'vilu-residence'. Refusing to use a config from the wrong Firebase project.`);
}

const clients = Array.isArray(config.client) ? config.client : [];
const hasExpectedPackage = clients.some(
  (c) => c && c.client_info && c.client_info.android_client_info && c.client_info.android_client_info.package_name === EXPECTED_PACKAGE,
);
if (!hasExpectedPackage) {
  fail(`Firebase config for APP_VARIANT=${APP_VARIANT} does not contain a client entry for the expected package '${EXPECTED_PACKAGE}'. ` +
    `This would silently build an app that can't authenticate against its own Firebase app registration.`);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(sourcePath, destPath);
console.log(`[eas-select-google-services] OK: copied ${SOURCE_ENV_VAR} -> ${destPath} (package ${EXPECTED_PACKAGE} confirmed present, project vilu-residence confirmed).`);
