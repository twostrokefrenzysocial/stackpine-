/** Unit tests cover pure TypeScript in src/core and the proxy. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/proxy'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    // @noble/* ship ESM only.
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', target: 'ES2022', isolatedModules: true } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
};
