const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');
const style = require('@nexui/config/eslint-style').default;

module.exports = defineConfig([
  expo,
  prettier,
  style,
  { ignores: ['dist/**', '.expo/**', 'expo-env.d.ts'] },
]);
