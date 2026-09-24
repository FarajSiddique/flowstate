/**
 * Layout rules shared by every workspace. Prettier owns indentation and line
 * width; these rules add the blank lines Prettier leaves alone.
 *
 * @example
 * const user = await verifyRequest(request, headers);
 *
 * if (user instanceof Response) {
 *   return user;
 * }
 *
 * return user.userId;
 */
export default {
  rules: {
    curly: ['error', 'all'],
    'padding-line-between-statements': [
      'error',
      { blankLine: 'always', prev: '*', next: 'return' },
      { blankLine: 'always', prev: 'block-like', next: '*' },
      { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
      { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
      { blankLine: 'always', prev: 'import', next: '*' },
      { blankLine: 'any', prev: 'import', next: 'import' },
    ],
  },
};
