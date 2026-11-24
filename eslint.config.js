// ESLint: nur Fehlerklassen (undefinierte/ungenutzte Namen, Tippfehler, unerreichbarer Code), keine Stilregeln –
// der kompakte Stil des Projekts bleibt, wie er ist. Aufruf: npm run lint
const js = require('@eslint/js');
const globals = require('globals');

const rules = {
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
};

module.exports = [
  { ignores: ['node_modules/**', '.claude/**', 'data/**', '.recherche/**'] },
  js.configs.recommended,
  {
    files: ['server/**/*.js', 'shared/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
  {
    // shared/ läuft auch im Browser (UMD-Muster)
    files: ['shared/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Browser: klassische Skripte, verbunden über window (siehe index.html)
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'script',
      globals: { ...globals.browser, Geom: 'readonly', Art: 'readonly', Avatars: 'readonly', Voice: 'readonly', Sound: 'readonly', Fx: 'readonly', Lobby: 'readonly', Menu: 'readonly', Trade: 'readonly', Table: 'readonly', Regeln: 'readonly' },
    },
    rules,
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
];
