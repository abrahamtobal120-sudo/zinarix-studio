import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', '**/release/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': ['error', { allow: ['error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/cli/**', 'scripts/**', 'tests/**', 'apps/*/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  // Security lint for code that runs with full privileges (main process, CLI, core).
  {
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: ['apps/desktop/src/renderer/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message: 'shell: true parses arguments with a shell: pass an argument array instead.',
        },
        {
          selector:
            'ImportDeclaration[source.value=/^(node:)?child_process$/] ImportSpecifier[imported.name=/^(exec|execSync)$/]',
          message: 'exec() runs a shell string: use execFile/spawn with an argument array.',
        },
        {
          selector:
            "CallExpression[callee.object.name='ipcMain'][callee.property.name=/^(on|once|handleOnce|addListener)$/]",
          message: 'Register IPC only through handle() in main.ts (Zod schema + sender check).',
        },
        {
          selector:
            'Property[key.name=/^(nodeIntegration|webviewTag|allowRunningInsecureContent)$/][value.value=true]',
          message: 'Electron hardening: this must stay false.',
        },
        {
          selector:
            'Property[key.name=/^(contextIsolation|sandbox|webSecurity)$/][value.value=false]',
          message: 'Electron hardening: this must stay true.',
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
