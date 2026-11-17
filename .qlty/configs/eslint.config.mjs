import typeChecked from '@sinemacula/coding-standards/js/eslint/type-checked';
import vue from '@sinemacula/coding-standards/js/eslint/vue';

// The type-aware layer includes the base.
export default [
    ...typeChecked,
    ...vue,
    {
        // Tests define several fixture components per file.
        files: ['**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', '**/__tests__/**', '**/tests/**'],
        rules: {
            'vue/one-component-per-file': 'off',
        },
    },
];
