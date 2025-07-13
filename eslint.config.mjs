// @ts-check
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import graphileExport from "eslint-plugin-graphile-export";
import jest from "eslint-plugin-jest";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  tseslint.configs.recommended,
  //"plugin:jest/recommended",
  prettier, // not a plugin, just a config object
  graphileExport.configs.recommended,
  {
    plugins: {
      //"@typescript-eslint",
      jest,
      //"graphile-export"
    },
    languageOptions: {
      parser: tsParser,
      globals: {
        jasmine: false,
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      "jest/expect-expect": ["off"],
      "@typescript-eslint/no-namespace": ["off"],
      "@typescript-eslint/no-explicit-any": ["warn"],
    },
  },
  {
    files: ["__tests__/*.d.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["off"],
    },
  },
  globalIgnores(["dist/**", ".yarn/**"]),
]);
