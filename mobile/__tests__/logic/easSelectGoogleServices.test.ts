/**
 * scripts/eas-select-google-services.js — the EAS `eas-build-pre-install`
 * hook that picks the right variant's real Firebase Android config on a
 * cloud builder (native-config/ is git-ignored, so a fresh EAS clone has
 * nothing on disk without this). Executed as a REAL child process against
 * REAL temp fixture files for every case, mirroring the manual smoke test
 * run live during Phase M1.5 -- not a description of the script's logic.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'eas-select-google-services.js');

function validConfig(packageName: string, projectId = 'vilu-residence') {
  return JSON.stringify({
    project_info: { project_id: projectId },
    client: [
      { client_info: { mobilesdk_app_id: '1:1:android:aaa', android_client_info: { package_name: packageName } } },
    ],
  });
}

function run(env: NodeJS.ProcessEnv): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT], { env: { ...process.env, ...env }, encoding: 'utf8' });
    return { status: 0, output };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, output: (err.stdout || '') + (err.stderr || '') };
  }
}

describe('eas-select-google-services.js', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vilu-eas-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('staff variant with a valid config for its own package succeeds', () => {
    const file = path.join(tmpDir, 'staff.json');
    fs.writeFileSync(file, validConfig('com.viluresidence.staff'));
    const result = run({ APP_VARIANT: 'staff', GOOGLE_SERVICES_JSON_STAFF: file });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/OK: copied GOOGLE_SERVICES_JSON_STAFF/);
  });

  test('agency variant with a valid config for its own package succeeds', () => {
    const file = path.join(tmpDir, 'agency.json');
    fs.writeFileSync(file, validConfig('com.viluresidence.agency'));
    const result = run({ APP_VARIANT: 'agency', GOOGLE_SERVICES_JSON_AGENCY: file });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/OK: copied GOOGLE_SERVICES_JSON_AGENCY/);
  });

  test('FAILS LOUDLY (non-zero exit) when the config does not contain the expected package -- never silently ships a mismatched Firebase app', () => {
    const file = path.join(tmpDir, 'wrong-package.json');
    fs.writeFileSync(file, validConfig('com.viluresidence.agency')); // staff variant, agency's package
    const result = run({ APP_VARIANT: 'staff', GOOGLE_SERVICES_JSON_STAFF: file });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/does not contain a client entry for the expected package 'com\.viluresidence\.staff'/);
  });

  test('FAILS LOUDLY when the config belongs to the wrong Firebase project', () => {
    const file = path.join(tmpDir, 'wrong-project.json');
    fs.writeFileSync(file, validConfig('com.viluresidence.staff', 'some-other-project'));
    const result = run({ APP_VARIANT: 'staff', GOOGLE_SERVICES_JSON_STAFF: file });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/project_id is 'some-other-project', expected 'vilu-residence'/);
  });

  test('FAILS LOUDLY when the referenced file does not exist', () => {
    const result = run({ APP_VARIANT: 'staff', GOOGLE_SERVICES_JSON_STAFF: path.join(tmpDir, 'missing.json') });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/does not exist on this builder/);
  });

  test('FAILS LOUDLY when the env var is unset and no local fallback file exists', () => {
    // Point HOME/pwd-independent by running from a copy of the script in
    // an isolated cwd with no native-config/ directory alongside it.
    const isolatedScript = path.join(tmpDir, 'eas-select-google-services.js');
    fs.mkdirSync(path.join(tmpDir, 'scripts'));
    fs.copyFileSync(SCRIPT, path.join(tmpDir, 'scripts', 'eas-select-google-services.js'));
    const result = (() => {
      try {
        const output = execFileSync('node', [path.join(tmpDir, 'scripts', 'eas-select-google-services.js')], {
          env: { ...process.env, APP_VARIANT: 'staff', GOOGLE_SERVICES_JSON_STAFF: '' },
          encoding: 'utf8',
        });
        return { status: 0, output };
      } catch (e) {
        const err = e as { status: number; stdout: string; stderr: string };
        return { status: err.status, output: (err.stdout || '') + (err.stderr || '') };
      }
    })();
    void isolatedScript;
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/is not set, and .* does not exist locally/);
  });
});
