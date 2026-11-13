import { readdirSync } from 'node:fs';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Slices are the directories under lib/. `lib/<slice>/internal/**` is private to its slice.
const slices = readdirSync('lib', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const forbidInternals = (names, paths = []) => ({
  'no-restricted-imports': [
    'error',
    {
      paths,
      patterns: names.map((s) => ({
        group: [`@/lib/${s}/internal`, `@/lib/${s}/internal/**`, `**/${s}/internal`, `**/${s}/internal/**`],
        message: `lib/${s}/internal is private to the ${s} slice. Import from its index.ts or server.ts.`,
      })),
    },
  ],
});

// Changing a license's channels or videos must create its clearance requests in the same transaction (PLAN 4.5), so
// callers use the clearance wrappers. Only the wrappers themselves (and the licensing slice) may use the bare functions.
const useClearanceWrappers = [
  {
    name: '@/lib/licensing/server',
    importNames: ['addChannel', 'replaceChannel', 'registerVideo'],
    message: 'Use addChannelWithClearance / replaceChannelWithClearance / registerVideoWithClearance from @/lib/clearance/server.',
  },
];

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: ['db/migrations/**', '.next/**', 'next-env.d.ts', 'supabase/**'] },
  { rules: forbidInternals(slices, useClearanceWrappers) },
  ...slices.map((s) => ({
    files: [`lib/${s}/**/*.{ts,tsx}`],
    rules: forbidInternals(slices.filter((x) => x !== s), s === 'licensing' ? [] : useClearanceWrappers),
  })),
  {
    files: ['lib/clearance/internal/usage.ts', 'lib/clearance/clearance.test.ts'],
    rules: forbidInternals(slices.filter((x) => x !== 'clearance')),
  },
];

export default eslintConfig;
