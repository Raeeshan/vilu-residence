/**
 * Two projects: a fast, dependency-free "logic" project for the pure
 * auth/guard/profile modules (runs under plain ts-jest, no RN runtime
 * needed), and the full jest-expo project for anything that imports
 * react-native/expo-router. The security-critical test list in this
 * task's own spec lives entirely in the logic project.
 */
module.exports = {
  projects: [
    {
      displayName: 'logic',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/logic/**/*.test.ts'],
    },
    {
      displayName: 'app',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/__tests__/app/**/*.test.tsx'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)/)',
      ],
    },
  ],
};
