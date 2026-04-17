import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "react/jsx-key": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**/*.ts",
      "**/__tests__/**/*.tsx",
    ],
    rules: {
      "no-console": "off",
    },
  },

  {
    ignores: [
      ".next/**",
      ".vercel/**",
      "out/**",
      "build/**",
      "ios/**",
      "coverage/**",
      "playwright-report/**",
      "src-tauri/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
