const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: ['coverage/**']
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.browser
            }
        },
        rules: {
            'no-console': 'off',
            'linebreak-style': ['error', 'unix'],
            quotes: ['error', 'single'],
            semi: ['error', 'always']
        }
    },
    {
        files: ['test/**/*.spec.js', '__tests__/**/*.spec.js'],
        languageOptions: {
            globals: globals.jest
        }
    }
];
