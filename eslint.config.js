// ESLint: catches mistakes (unused or undefined names, unreachable code) in IVB's JavaScript.
// Layout is Prettier's job (.prettierrc.json); data files are laid out by tools/format-data.mjs.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/",
      "vendor/",
      "gtfs/",
      "pages/",
      "site/",
      "osm/",
      "android/",
      "train/",
      "station/",
      "place/",
      "go/",
      "loop/",
      "browse/",
      "privacy/",
    ],
  },
  js.configs.recommended,
  {
    files: ["assets/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser, d3: "readonly" } },
  },
  {
    // loaded with a plain <script> in the <head>, before the styles
    files: ["assets/theme.js"],
    languageOptions: { sourceType: "script" },
  },
  {
    files: ["lib/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals["shared-node-browser"] },
  },
  {
    files: ["sw.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: globals.serviceworker },
  },
  {
    files: ["tools/**/*.mjs", "tests/**/*.js", "tests/**/*.mjs", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
  },
  {
    // the browser checks pass functions to page.evaluate, which run in the page
    files: ["tests/ui.mjs", "tests/update.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
];
