import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The build cache `mastra dev` leaves if it's ever run — huge
    // bundled/minified JS, not source this repo owns; linting it exhausted
    // the heap and crashed the process.
    ".mastra/**",
  ]),
]);

export default eslintConfig;
