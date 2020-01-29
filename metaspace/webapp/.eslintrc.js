const operatorLinebreakOverrides = {};
(['=', '+=', '-=', '*=', '/=', '&=', '^=']).forEach(o => {
  operatorLinebreakOverrides[o] = 'after';
})

module.exports = {
  'root': true,
  'env': {
    'node': true,
  },
  'extends': [
    'plugin:vue/recommended',
    'eslint:recommended',
    '@vue/standard',
    '@vue/typescript',
  ],
  'rules': {
    'vue/require-default-prop': ['off'], // Will props even be relevant if we shift to the Composition API?
    'vue/require-prop-types': ['off'], // Will props even be relevant if we shift to the Composition API?
    'vue/no-v-html': ['off'],
    'no-mixed-operators': ['off'], // TODO?

    'no-unused-vars': ['off'], // Does not work well with TypeScript
    'import/no-duplicates': ['off'], // This keeps breaking stuff: https://github.com/benmosher/eslint-plugin-import/issues/1504

    'comma-dangle': ['error', 'always-multiline'], // Opinion
    'space-before-function-paren': ['error', 'never'], // Opinion
    'curly': 'off', // Auto-fix doesn't work well
    'operator-linebreak': ['error', 'before', {overrides: operatorLinebreakOverrides}], // Opinion
    'vue/max-len': ['warn', { // Opinion
      'code': 120,
      'template': 200,
      'ignoreComments': true,
    }],
  },
  'parserOptions': {
    'parser': '@typescript-eslint/parser',
  },
  'overrides': [
    {
      'files': [
        '**/*.spec.{j,t}s?(x)',
        'tests/**/*',
      ],
      'env': {
        'jest': true,
      },
    },
  ],
}
