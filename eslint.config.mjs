import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'examples/**/dist/**',
      'examples/**/node_modules/**',
      'public/**',
      'scripts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // TypeScript already reports undefined identifiers; the base rule produces
      // false positives on types and is disabled by tseslint for that reason.
      'no-undef': 'off',
      // Allow intentionally unused args prefixed with `_` (common in extension
      // hooks where the signature is fixed by Tiptap).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // The codebase uses `any` only in narrow, documented interop spots.
      '@typescript-eslint/no-explicit-any': 'warn',

      // The templates intentionally keep short elements on one line with compact
      // attribute lists; the upstream "recommended" preset disagrees. These are
      // disabled to match the established style instead of reformatting the repo.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/one-component-per-file': 'off',
      'vue/attributes-order': 'warn',
      // Optional props deliberately have NO default: `undefined` means "not
      // provided" and drives fallbacks like `props.toolbarItems ??
      // createDefaultToolbarItems()`. Adding defaults would change behaviour.
      'vue/require-default-prop': 'off',
      // `v-html` is used only for highlight.js output generated from already
      // escaped source, never for raw user HTML.
      'vue/no-v-html': 'off',
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
  },

  {
    files: ['tests/**/*.ts', '**/*.test.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Tests legitimately assert on loosely typed fixtures.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // The generated shim is emitted by scripts/generate-vue-entry.mjs.
    files: ['src/vue/entry.js'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
)
