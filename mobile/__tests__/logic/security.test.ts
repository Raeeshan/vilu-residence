/**
 * Structural security checks — reading the ACTUAL shipped source text
 * (not a description of intent), matching the same "prove it, don't just
 * claim it" convention used throughout this project's own web test suite.
 */
import fs from 'fs';
import path from 'path';
import { buildResolvedSession } from '../../src/services/profile/profileService';

const SRC_ROOT = path.join(__dirname, '..', '..', 'src');

/** Strips `//` line comments and `/** ... *​/` block comments before a check runs -- explanatory prose (e.g. "never store this in AsyncStorage") must never itself trip a "never references X" assertion. Only real code is checked. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function readAllSourceFiles(): string {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  }
  walk(SRC_ROOT);
  return files.map((f) => stripComments(fs.readFileSync(f, 'utf8'))).join('\n---FILE---\n');
}

const ALL_SRC = readAllSourceFiles();

describe('no password persistence or logging', () => {
  test('no source file references AsyncStorage in actual code -- session state is Firebase Auth\'s own native persistence only (comments describing this policy are fine)', () => {
    expect(ALL_SRC).not.toMatch(/AsyncStorage/);
  });
  test('no source file writes a password value to SecureStore/Firestore/console', () => {
    // A real password variable is only ever named `password` (see
    // authService.ts's own signIn(email, password) parameter) and is
    // passed exactly once, straight into signInWithEmailAndPassword.
    expect(ALL_SRC).not.toMatch(/secureStore[a-zA-Z]*\.setItem\([^)]*password/i);
    expect(ALL_SRC).not.toMatch(/\.set\([^)]*password/i);
    expect(ALL_SRC).not.toMatch(/console\.(log|warn|error)\([^)]*password/i);
  });
  test('authService only ever forwards the password VALUE into signInWithEmailAndPassword, never reads it back out or re-uses it elsewhere', () => {
    const authServiceSrc = stripComments(fs.readFileSync(path.join(SRC_ROOT, 'services/auth/authService.ts'), 'utf8'));
    // Case-sensitive, whole-word match for the lowercase `password` TOKEN --
    // this deliberately does not match "Password" as it appears inside
    // unrelated identifiers like sendPasswordReset/PasswordResetResult
    // (real, legitimate password-RESET feature names, not the secret
    // itself). Only the actual `password` parameter/variable is in scope.
    const passwordUses = [...authServiceSrc.matchAll(/\bpassword\b/g)];
    // Expected exactly 2: signIn's own `password` parameter declaration,
    // and its single forwarding use inside signInWithEmailAndPassword(email,
    // password). Any more means it started being stored/logged/re-read
    // somewhere in this file.
    expect(passwordUses.length).toBe(2);
    expect(authServiceSrc).toMatch(/signInWithEmailAndPassword\(email, password\)/);
  });
});

describe('no backend/service credentials bundled', () => {
  test('no private key / service account material appears anywhere in the mobile source tree', () => {
    expect(ALL_SRC).not.toMatch(/BEGIN PRIVATE KEY/);
    expect(ALL_SRC).not.toMatch(/"type"\s*:\s*"service_account"/);
    expect(ALL_SRC).not.toMatch(/client_email/);
  });
  test('firebase.ts never constructs a web-style firebaseConfig object with an explicit apiKey -- RNFB auto-initializes from native config files instead', () => {
    const firebaseSrc = fs.readFileSync(path.join(SRC_ROOT, 'services/firebase/firebase.ts'), 'utf8');
    expect(firebaseSrc).not.toMatch(/apiKey\s*:/);
  });
});

describe('role/accountStatus cannot be supplied client-side to bypass checks', () => {
  test('buildResolvedSession has no parameter for role/accountStatus -- both are ALWAYS derived from the fetched userDoc, never accepted as direct input', () => {
    const profileServiceSrc = fs.readFileSync(path.join(SRC_ROOT, 'services/profile/profileService.ts'), 'utf8');
    const paramsInterface = profileServiceSrc.slice(
      profileServiceSrc.indexOf('export interface BuildResolvedSessionParams'),
      profileServiceSrc.indexOf('export function buildResolvedSession'),
    );
    expect(paramsInterface).not.toMatch(/\brole\s*:/);
    expect(paramsInterface).not.toMatch(/\baccountStatus\s*:/);
  });
  test('even if an extraneous role/accountStatus field is smuggled in via an `as any` cast, buildResolvedSession ignores it and derives from userDoc only', () => {
    const spoofed = {
      authUser: { uid: 'u1', email: 'agency@example.com', emailVerified: true },
      userDoc: { role: 'agency', accountStatus: 'ACTIVE' },
      role: 'admin', // attempted client-side override
      accountStatus: 'SUSPENDED', // attempted client-side override
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = buildResolvedSession(spoofed);
    expect(result.role).toBe('agency'); // derived from userDoc, ignoring the spoofed 'admin'
    expect(result.accountStatus).toBe('ACTIVE'); // ignoring the spoofed 'SUSPENDED'
  });
});

describe('an agency profile can never select another agency\'s identity', () => {
  test('usersRepository/profileService never accept an arbitrary target email for a foreign profile -- fetchResolvedSession always derives the lookup email from the CALLER\'s own AuthUser', () => {
    const profileServiceSrc = fs.readFileSync(path.join(SRC_ROOT, 'services/profile/profileService.ts'), 'utf8');
    const fn = profileServiceSrc.slice(profileServiceSrc.indexOf('export async function fetchResolvedSession'));
    expect(fn).toMatch(/normalizeEmail\(authUser\.email\)/);
    expect(fn).not.toMatch(/params\.email|input\.email|request\.email/);
  });
});
