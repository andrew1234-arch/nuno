import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "contracts/**", "apps/web/.next/**", "apps/web/out/**", "site/**", ".contrast-export/**", "apps/web/next-env.d.ts", "apps/web/lib/*.generated.ts", "data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
  { files: ["**/scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
);
