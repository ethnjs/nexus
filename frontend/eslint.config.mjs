import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Only the React Compiler rules, which Biome has no equivalent for. Biome covers everything else.
const eslintConfig = defineConfig([
  // The sheets import is deprecated and unmaintained; see biome.jsonc.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "**/sheets/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
  },
  reactHooks.configs.flat.recommended,
  {
    rules: {
      // Biome's useHookAtTopLevel and useExhaustiveDependencies.
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
]);

export default eslintConfig;
