// Phase 16: colors come from tokens. A hex color is allowed only in ui/tokens.css (the Dark and
// Light themes and the few fixed colors) and in themes.ts (custom themes, not CSS).
/** @type {import('stylelint').Config} */
export default {
  rules: {
    'color-no-hex': true,
  },
  ignoreFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/release/**',
    'apps/desktop/src/renderer/ui/tokens.css',
  ],
};
