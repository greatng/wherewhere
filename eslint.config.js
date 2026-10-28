import js from "@eslint/js";
import ts from "typescript-eslint";
import a11y from "eslint-plugin-jsx-a11y";
export default ts.config(
  { ignores: ["dist/**", "node_modules/**", "supabase/functions/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "jsx-a11y": a11y },
    rules: { ...a11y.configs.recommended.rules },
  },
  {
    files: ["scripts/**/*.mjs", "*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
      },
    },
  },
);
