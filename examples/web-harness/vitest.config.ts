import { defineConfig } from 'vitest/config';

// The harness's tsconfig maps @allyworld/* to package SOURCE (not dist); vitest
// must resolve the same way or the pure modules would test against a stale build.
//
// `new URL(...).pathname` rather than node:url's fileURLToPath: the harness's
// tsconfig carries no node types, so importing 'node:url' here is a type error
// under `tsc --noEmit` even though vitest itself runs fine. URL is a lib.dom
// global, so this needs no extra @types. `.pathname` alone does NOT undo percent
// encoding (fileURLToPath does) — a checkout path containing a space would come
// through as `%20` and the alias would resolve to nothing, so decodeURIComponent
// it explicitly.
export default defineConfig({
  resolve: {
    alias: {
      '@allyworld/alloy-audio': decodeURIComponent(
        new URL('../../web/packages/alloy-audio/src/index.ts', import.meta.url).pathname,
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
