import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcovonly"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts", "index.ts"],
    },
  },
});
