// @ts-check
import { tanstackStartConfig } from "@evodo/eslint-config/tanstack-start";

export default [
  ...tanstackStartConfig,
  {
    ignores: [
      "eslint.config.js",
      "prettier.config.js",
      "dist/**",
      "coverage/**",
      ".wrangler/**",
    ],
  },
];
