const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expo,
  prettier,
  { rules: { curly: ['error', 'all'] } },
  { ignores: ['dist/**', '.expo/**', 'expo-env.d.ts'] },
]);
