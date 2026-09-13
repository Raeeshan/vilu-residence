import { toCleanError } from '../../src/utils/errors';

describe('toCleanError', () => {
  test('maps a known Firebase Auth error code to a clean message', () => {
    const result = toCleanError({ code: 'auth/wrong-password', message: 'INTERNAL: some Firebase internals' });
    expect(result.message).toBe('Incorrect email or password. Please try again.');
  });
  test('never leaks the raw error.message onto the returned clean message', () => {
    const raw = { code: 'auth/network-request-failed', message: 'FirebaseError: internal detail xyz' };
    const result = toCleanError(raw);
    expect(result.message).not.toContain('FirebaseError');
    expect(result.message).not.toContain('xyz');
  });
  test('maps a Cloud Functions permission-denied code to a clean message, never the raw code/collection name', () => {
    const result = toCleanError({ code: 'permission-denied', message: 'permission-denied: users/foo@bar.com read blocked' });
    expect(result.message).not.toMatch(/permission-denied/);
    expect(result.message).not.toMatch(/users\//);
  });
  test('an unrecognized error code still returns a clean generic message, never falls through to raw text', () => {
    const result = toCleanError({ code: 'some/unmapped-code', message: 'raw internal detail' });
    expect(result.message).toBe('Something went wrong. Please try again.');
    expect(result.message).not.toContain('raw internal detail');
  });
  test('a non-error-shaped value (string, undefined, plain object) never throws', () => {
    expect(() => toCleanError('a plain string')).not.toThrow();
    expect(() => toCleanError(undefined)).not.toThrow();
    expect(() => toCleanError({})).not.toThrow();
  });
  test('network-ish errors are marked retryable; a wrong-password is not', () => {
    expect(toCleanError({ code: 'auth/network-request-failed' }).retryable).toBe(true);
    expect(toCleanError({ code: 'auth/wrong-password' }).retryable).toBe(false);
  });
});
