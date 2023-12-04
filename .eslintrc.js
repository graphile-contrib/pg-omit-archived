module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  env: {
    node: true,
    es6: true,
    "jest/globals": true,
  },
  plugins: ["@typescript-eslint", "jest", "graphile-export"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:jest/recommended",
    "prettier",
    "plugin:graphile-export/recommended",
  ],
  rules: {
    "jest/expect-expect": ["off"],
    "@typescript-eslint/no-namespace": ["off"],
  },
};
