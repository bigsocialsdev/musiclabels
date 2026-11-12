import { readdirSync } from 'node:fs';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Slices are the directories under lib/. `lib/<slice>/internal/**` is private to its slice.
const slices = readdirSync('lib', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const forbidInternals = (names) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: names.map((s) => ({
        group: [`@/lib/${s}/internal`, `@/lib/${s}/internal/**`, `**/${s}/internal`, `**/${s}/internal/**`],
        message: `lib/${s}/internal is private to the ${s} slice. Import from its index.ts or server.ts.`,
      })),
    },
  ],
});

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: ['db/migrations/**', '.next/**', 'next-env.d.ts', 'supabase/**'] },
  { rules: forbidInternals(slices) },
  ...slices.map((s) => ({
    files: [`lib/${s}/**/*.{ts,tsx}`],
    rules: forbidInternals(slices.filter((x) => x !== s)),
  })),
];

export default eslintConfig;
