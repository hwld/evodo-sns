// @ts-check
import { base } from "@evodo/eslint-config/base";

export default [
  ...base,
  {
    ignores: [
      "eslint.config.js",
      "prettier.config.js",
      "dist/**",
      "coverage/**",
      ".wrangler/**",
      "drizzle/**",
      "migrations/**",
      "worker-configuration.d.ts",
    ],
  },
];
