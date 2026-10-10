import { defineConfig } from "vitest/config"

// Deliberately NOT the same config as vite.config.ts — these are small
// Node-side integration tests against the real API (see server/test/helpers.ts),
// not browser/component tests, so they don't need the React/Tailwind/API-middleware
// plugins the app's own Vite config pulls in. Interface logic that needs no DOM
// (src/**/*.test.ts, with fetch stubbed) runs here too; the browser itself is
// covered by scripts/e2e.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 15_000,
  },
})
