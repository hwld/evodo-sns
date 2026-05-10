// @ts-check
import { tanstackConfig } from "@tanstack/eslint-config";
import { base } from "./base.js";

export const tanstackStartConfig = [
  ...base,
  ...tanstackConfig,
  {
    name: "evodo/tanstack-start/ignores",
    ignores: [
      "**/.output/**",
      "**/.tanstack/**",
      "**/.nitro/**",
      "**/routeTree.gen.ts",
    ],
  },
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
];
