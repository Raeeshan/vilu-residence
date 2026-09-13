import { normalizeEmail, isValidEmailFormat } from '../../src/utils/email';

describe('normalizeEmail', () => {
  test('lower-cases and trims', () => {
    expect(normalizeEmail('  Person@Example.COM  ')).toBe('person@example.com');
  });
  test('handles null/undefined without throwing', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });
  test('is idempotent', () => {
    const once = normalizeEmail('Mixed@Case.com');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('isValidEmailFormat', () => {
  test('accepts a plausible email', () => {
    expect(isValidEmailFormat('person@example.com')).toBe(true);
  });
  test('rejects an empty/blank string', () => {
    expect(isValidEmailFormat('')).toBe(false);
    expect(isValidEmailFormat('   ')).toBe(false);
  });
  test('rejects a string with no @ or no domain', () => {
    expect(isValidEmailFormat('not-an-email')).toBe(false);
    expect(isValidEmailFormat('person@')).toBe(false);
  });
});
