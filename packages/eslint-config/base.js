// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export const base = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: "evodo/base",
    files: ["**/*.{js,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
