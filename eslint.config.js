import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'public/pdf-assets', 'src-tauri/target', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  { files: ['scripts/*.mjs', '*.js'], languageOptions: { globals: globals.node } },
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': hooks }, rules: { ...hooks.configs.recommended.rules } },
);
