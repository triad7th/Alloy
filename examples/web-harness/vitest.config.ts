import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The harness's tsconfig maps @allyworld/* to package SOURCE (not dist); vitest
// must resolve the same way or the pure modules would test against a stale build.
export default defineConfig({
  resolve: {
    alias: {
      '@allyworld/alloy-audio': fileURLToPath(
        new URL('../../web/packages/alloy-audio/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    // Only the PURE modules are tested. Angular components stay untested here,
    // as they were before this phase.
    include: ['src/app/rompler/**/*.spec.ts'],
  },
});
