import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
        fetch: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
];
