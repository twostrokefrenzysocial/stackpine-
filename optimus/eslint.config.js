// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    files: ['proxy/**/*.ts'],
    rules: { 'import/no-unresolved': ['error', { ignore: ['^cloudflare:'] }] },
  },
  {
    ignores: ['dist/*', 'proxy/node_modules/*', 'android/*', 'ios/*', 'scripts/*.mjs'],
  },
]);
