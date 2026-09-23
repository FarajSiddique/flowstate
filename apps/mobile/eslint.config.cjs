const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expo,
  prettier,
  { ignores: ['dist/**', '.expo/**', 'expo-env.d.ts'] },
]);
