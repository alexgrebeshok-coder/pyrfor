import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";

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

  // ─── Boundary rules: enforce one-directional dependencies ────────────────
  // engine ← business | ochag | freeclaude | ui (never engine → product)
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "engine",     pattern: "packages/engine/src/**" },
        { type: "business",   pattern: "packages/business/src/**" },
        { type: "ochag",      pattern: "packages/ochag/src/**" },
        { type: "freeclaude", pattern: "packages/freeclaude/src/**" },
        { type: "ui",         pattern: "packages/ui/src/**" },
      ],
    },
    rules: {
      "boundaries/element-types": ["error", {
        default: "disallow",
        rules: [
          // engine can only import itself and ui-primitives (no product deps)
          { from: "engine",     allow: ["engine"] },
          // business can use engine + ui
          { from: "business",   allow: ["engine", "ui", "business"] },
          // ochag can use engine + ui
          { from: "ochag",      allow: ["engine", "ui", "ochag"] },
          // freeclaude can use engine
          { from: "freeclaude", allow: ["engine", "freeclaude"] },
          // ui has no business-domain deps
          { from: "ui",         allow: ["ui"] },
        ],
      }],
    },
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
  },
];
export default eslintConfig;
