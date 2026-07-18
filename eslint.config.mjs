import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".agent/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "public/**",
      "next-env.d.ts",
    ],
  },
  {
    // Mirror legacy .eslintrc.json intent that the v8→v9 flat-config
    // migration dropped: `any` is allowed across the codebase (mock
    // surfaces, config bridges intentionally use it), and underscore-
    // prefixed parameters/vars/catches are conventional unused markers
    // that should not warn.
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/icons/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message: "Import icons through '@/components/ui/icons' only.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='svg']",
          message:
            "Use AppIcon or icons module components instead of inline <svg>.",
        },
      ],
    },
  },
];

export default eslintConfig;
