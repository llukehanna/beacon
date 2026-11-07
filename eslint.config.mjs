// @ts-check
import eslint from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import * as importPlugin from "eslint-plugin-import";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// Rules shared by every environment (browser and Node).
const sharedRules = /** @type import("eslint").Linter.RulesRecord */ ({
  "eqeqeq": ["error", "always", { "null": "ignore" }],
  "no-console": "warn",
  "curly": ["error", "all"],
  // Off: stubs and adapters implement async interfaces (Queryable, Clusterer, handlers) without awaiting.
  "@typescript-eslint/require-await": "off",
  "@typescript-eslint/no-unused-vars": ["error", {
    "argsIgnorePattern": "^_",
  }],
  "import/named": "error",
  "import/default": "error",
  "import/namespace": "error",
  "import/no-duplicates": "error",
  "import/no-extraneous-dependencies": "error",
});

export default tseslint.config(
  {
    files: ["src/**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    settings: {
      react: {
        version: "detect",
      },

      "import/resolver": {
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },

      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    plugins: {
      "react": /** @type import("eslint").ESLint.Plugin */ (reactPlugin),
      "react-refresh": reactRefresh,
      "react-hooks":
        /** @type import("eslint").ESLint.Plugin */ (reactHooksPlugin),
      "jsx-a11y": jsxA11yPlugin,
      "import": importPlugin,
    },
    rules: {
      ...(
        /** @type import("eslint").Linter.RulesRecord */
        (reactPlugin.configs.flat?.recommended.rules)
      ),
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...jsxA11yPlugin.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", {
        allowConstantExport: true,
      }],

      ...sharedRules,
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    // Node-side code: server/, shared/ (used by both sides, but Node globals are a
    // superset-safe default here since shared/ has no browser-only APIs), api/, scripts/.
    files: [
      "server/**/*.{ts,mts,cts,js,mjs,cjs}",
      "shared/**/*.{ts,mts,cts,js,mjs,cjs}",
      "api/**/*.{ts,mts,cts,js,mjs,cjs}",
      "scripts/**/*.{ts,mts,cts,js,mjs,cjs}",
      "worker/**/*.{ts,mts,cts,js,mjs,cjs}",
    ],
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".ts"],
        },
      },
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },

      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.server.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    plugins: {
      "import": importPlugin,
    },
    rules: {
      ...sharedRules,
    },
  },
  {
    // CLI scripts: console output is the point, not debug residue left behind.
    files: ["scripts/**/*.{ts,mts,cts,js,mjs,cjs}"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Plain JavaScript outside both TypeScript projects: the config and the Node scripts.
    files: ["eslint.config.mjs", "scripts/**/*.mjs"],
    // The same rules as the code above, minus the ones that need type information.
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      tseslint.configs.disableTypeChecked,
    ],
    languageOptions: { globals: { ...globals.node } },
    plugins: { "import": importPlugin },
    // Node scripts print on purpose (see the scripts block above, which this block would undo).
    rules: { ...sharedRules, "no-console": "off" },
  },
);
