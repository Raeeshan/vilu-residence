/**
 * authService is tested against a MOCKED @react-native-firebase/auth
 * boundary (via a mocked ../../src/services/firebase/firebase module) --
 * this suite proves authService's own logic (normalization, error mapping,
 * event wrapping), not the real native SDK, which cannot run in this
 * Node/Jest environment.
 */
jest.mock('../../src/services/firebase/firebase', () => {
  const mockAuthInstance = {
    signInWithEmailAndPassword: jest.fn(),
    signOut: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    onAuthStateChanged: jest.fn(),
    currentUser: null as null | { uid: string; email: string | null; emailVerified: boolean },
  };
  return {
    getFirebaseAuth: () => mockAuthInstance,
    __mockAuthInstance: mockAuthInstance,
  };
});

import { signIn, signOut, sendPasswordReset, onAuthStateChanged, getCurrentAuthUser } from '../../src/services/auth/authService';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __mockAuthInstance: mockAuth } = jest.requireMock('../../src/services/firebase/firebase');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('signIn', () => {
  test('normalizes the email before calling Firebase Auth', async () => {
    mockAuth.signInWithEmailAndPassword.mockResolvedValue({
      user: { uid: 'u1', email: 'Person@Example.com', emailVerified: true },
    });
    await signIn('  Person@Example.com  ', 'secret123');
    expect(mockAuth.signInWithEmailAndPassword).toHaveBeenCalledWith('person@example.com', 'secret123');
  });
  test('returns ok:true with the mapped AuthUser on success', async () => {
    mockAuth.signInWithEmailAndPassword.mockResolvedValue({
      user: { uid: 'u1', email: 'person@example.com', emailVerified: false },
    });
    const result = await signIn('person@example.com', 'secret123');
    expect(result).toEqual({ ok: true, user: { uid: 'u1', email: 'person@example.com', emailVerified: false } });
  });
  test('returns a clean error, never the raw Firebase error, on failure', async () => {
    mockAuth.signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/wrong-password', message: 'raw internal' });
    const result = await signIn('person@example.com', 'wrong');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Incorrect email or password. Please try again.');
      expect(result.error.message).not.toContain('raw internal');
    }
  });
});

describe('signOut', () => {
  test('calls Firebase Auth signOut', async () => {
    mockAuth.signOut.mockResolvedValue(undefined);
    await signOut();
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('sendPasswordReset', () => {
  test('normalizes the email and invokes sendPasswordResetEmail', async () => {
    mockAuth.sendPasswordResetEmail.mockResolvedValue(undefined);
    const result = await sendPasswordReset('  Person@Example.COM ');
    expect(mockAuth.sendPasswordResetEmail).toHaveBeenCalledWith('person@example.com');
    expect(result.ok).toBe(true);
  });
  test('returns a clean error on failure, never throws', async () => {
    mockAuth.sendPasswordResetEmail.mockRejectedValue({ code: 'auth/invalid-email' });
    const result = await sendPasswordReset('not-an-email');
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('Enter a valid email address.');
  });
});

describe('onAuthStateChanged wrapper (session restoration)', () => {
  test('maps a real Firebase user to AuthUser', () => {
    let captured: unknown;
    mockAuth.onAuthStateChanged.mockImplementation((cb: (u: unknown) => void) => {
      cb({ uid: 'u1', email: 'person@example.com', emailVerified: true });
      return () => undefined;
    });
    onAuthStateChanged((user) => {
      captured = user;
    });
    expect(captured).toEqual({ uid: 'u1', email: 'person@example.com', emailVerified: true });
  });
  test('maps a null (signed-out) auth state to null, not an empty/guessed user', () => {
    let captured: unknown = 'not-yet-called';
    mockAuth.onAuthStateChanged.mockImplementation((cb: (u: unknown) => void) => {
      cb(null);
      return () => undefined;
    });
    onAuthStateChanged((user) => {
      captured = user;
    });
    expect(captured).toBeNull();
  });
  test('returns the unsubscribe function untouched', () => {
    const unsubscribe = jest.fn();
    mockAuth.onAuthStateChanged.mockReturnValue(unsubscribe);
    const returned = onAuthStateChanged(() => undefined);
    expect(returned).toBe(unsubscribe);
  });
});

describe('getCurrentAuthUser', () => {
  test('returns null when nobody is signed in', () => {
    mockAuth.currentUser = null;
    expect(getCurrentAuthUser()).toBeNull();
  });
  test('maps the current Firebase user when present', () => {
    mockAuth.currentUser = { uid: 'u1', email: 'person@example.com', emailVerified: true };
    expect(getCurrentAuthUser()).toEqual({ uid: 'u1', email: 'person@example.com', emailVerified: true });
  });
});
