import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";
import i18nextPlugin from "eslint-plugin-i18next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { inkadeArchitecturePlugin } from "./scripts/eslint-plugin-inkade-architecture.mjs";
import { inkadeI18nPlugin } from "./scripts/eslint-plugin-inkade-i18n.mjs";

const WORKSPACE_TS_FILES = [
  "packages/**/*.{ts,tsx,mts,cts}",
  "apps/**/*.{ts,tsx,mts,cts}",
];

const UI_I18N_FILES = [
  "packages/ui/src/patterns/**/*.{ts,tsx}",
  "packages/views/src/**/*.{ts,tsx}",
  "apps/web/src/**/*.{ts,tsx}",
  "apps/clipper/src/**/*.{ts,tsx}",
  "apps/mobile/app/**/*.{ts,tsx}",
  "apps/mobile/src/**/*.{ts,tsx}",
];

const THIRD_PARTY_MODULES = [
  "!@inkade/*",
  "!@inkade/*/*",
  "!node:*",
  "!bun:*",
];

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/.expo/**",
      "**/.expo-export/**",
      "**/src-tauri/**",
      "**/drizzle/**",
      "adapters/**",
      "e2e/**",
      "scripts/**",
      "packages/i18n/src/locales/**",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: WORKSPACE_TS_FILES,
  })),
  {
    files: WORKSPACE_TS_FILES,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["packages/db/drizzle.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      boundaries,
      "inkade-arch": inkadeArchitecturePlugin,
    },
    settings: {
      "boundaries/elements": [
        { type: "core", pattern: "packages/core/src/**" },
        { type: "i18n", pattern: "packages/i18n/src/**" },
        { type: "clipper-core", pattern: "packages/clipper-core/src/**" },
        { type: "db", pattern: "packages/db/**" },
        { type: "sdk", pattern: "packages/sdk/src/**" },
        { type: "ade-kit", pattern: "packages/ade-kit/src/**" },
        { type: "cli", pattern: "packages/cli/src/**" },
        { type: "ui", pattern: "packages/ui/src/**" },
        { type: "views", pattern: "packages/views/src/**" },
        { type: "server-routes", pattern: "apps/server/src/routes/**" },
        { type: "server-mcp", pattern: "apps/server/src/mcp/**" },
        { type: "server-services", pattern: "apps/server/src/services/**" },
        { type: "server-auth", pattern: "apps/server/src/auth/**" },
        { type: "server-realtime", pattern: "apps/server/src/realtime/**" },
        { type: "server-app", pattern: "apps/server/src/**" },
        { type: "web", pattern: "apps/web/**" },
        { type: "clipper", pattern: "apps/clipper/**" },
        { type: "desktop", pattern: "apps/desktop/**" },
        { type: "mobile", pattern: "apps/mobile/**" },
      ],
      "boundaries/files": [
        { pattern: "**/*.test.{ts,tsx}", category: "test" },
      ],
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 8,
        },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "inkade-arch/no-reexport-shim": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          policies: [
            // Self-imports within the same element
            {
              from: { element: { type: "*" } },
              allow: { to: { element: { type: "{{from.element.type}}" } } },
            },
            // Third-party packages (non-@inkade, non-node/bun IO) allowed everywhere
            {
              from: { element: { type: "*" } },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: THIRD_PARTY_MODULES,
                  },
                },
              },
            },
            // Node/Bun built-ins allowed in IO-capable layers and in all test files
            {
              from: {
                element: {
                  types: [
                    "db",
                    "sdk",
                    "ade-kit",
                    "cli",
                    "ui",
                    "views",
                    "server-routes",
                    "server-mcp",
                    "server-services",
                    "server-auth",
                    "server-realtime",
                    "server-app",
                    "web",
                    "clipper",
                    "desktop",
                    "mobile",
                  ],
                },
              },
              allow: { to: { module: { origin: ["core", "external"], source: ["node:*", "bun:*"] } } },
            },
            {
              from: { file: { categories: ["test"] } },
              allow: { to: { module: { origin: ["core", "external"], source: ["node:*", "bun:*"] } } },
            },
            // Package dependency direction per AGENTS.md:
            // core & i18n -> zero internal deps
            {
              from: { element: { type: "clipper-core" } },
              allow: { to: { module: { origin: "external", source: ["@inkade/core"] } } },
            },
            {
              from: { element: { type: "db" } },
              allow: { to: { module: { origin: "external", source: ["@inkade/core"] } } },
            },
            {
              from: { element: { type: "sdk" } },
              allow: { to: { module: { origin: "external", source: ["@inkade/core"] } } },
            },
            {
              from: { element: { type: "ade-kit" } },
              allow: {
                to: { module: { origin: "external", source: ["@inkade/core", "@inkade/sdk", "@inkade/sdk/*"] } },
              },
            },
            {
              from: { element: { type: "cli" } },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: ["@inkade/core", "@inkade/sdk", "@inkade/sdk/*", "@inkade/ade-kit"],
                  },
                },
              },
            },
            {
              from: { element: { type: "ui" } },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: ["@inkade/core", "@inkade/i18n", "@inkade/sdk", "@inkade/sdk/*"],
                  },
                },
              },
            },
            {
              from: { element: { type: "views" } },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: [
                      "@inkade/core",
                      "@inkade/i18n",
                      "@inkade/sdk",
                      "@inkade/sdk/*",
                      "@inkade/ade-kit",
                      "@inkade/ui",
                      "@inkade/ui/*",
                    ],
                  },
                },
              },
            },
            // Server layers and package dependencies
            {
              from: {
                element: {
                  types: [
                    "server-routes",
                    "server-mcp",
                    "server-services",
                    "server-auth",
                    "server-realtime",
                    "server-app",
                  ],
                },
              },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: ["@inkade/core", "@inkade/db", "@inkade/clipper-core", "@inkade/clipper-core/*"],
                  },
                },
              },
            },
            {
              from: { element: { type: "server-app" } },
              allow: {
                to: {
                  element: {
                    types: [
                      "server-routes",
                      "server-mcp",
                      "server-services",
                      "server-auth",
                      "server-realtime",
                    ],
                  },
                },
              },
            },
            {
              from: { element: { type: "server-routes" } },
              allow: {
                to: {
                  element: {
                    types: ["server-services", "server-auth", "server-realtime", "server-app"],
                  },
                },
              },
            },
            {
              from: { element: { type: "server-mcp" } },
              allow: {
                to: {
                  element: {
                    types: ["server-services", "server-auth", "server-realtime", "server-app"],
                  },
                },
              },
            },
            {
              from: { element: { type: "server-services" } },
              allow: {
                to: {
                  element: {
                    types: ["server-auth", "server-realtime", "server-app"],
                  },
                },
              },
            },
            {
              from: { element: { type: "server-auth" } },
              allow: { to: { element: { types: ["server-app"] } } },
            },
            {
              from: { element: { type: "server-realtime" } },
              allow: { to: { element: { types: ["server-auth", "server-app"] } } },
            },
            {
              from: { element: { type: "server-app" }, file: { categories: ["test"] } },
              allow: {
                to: { module: { origin: "external", source: ["@inkade/sdk", "@inkade/sdk/*"] } },
              },
            },
            // App package dependencies
            {
              from: { element: { type: "web" } },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: [
                      "@inkade/core",
                      "@inkade/i18n",
                      "@inkade/sdk",
                      "@inkade/sdk/*",
                      "@inkade/ade-kit",
                      "@inkade/ui",
                      "@inkade/ui/*",
                      "@inkade/views",
                      "@inkade/views/*",
                    ],
                  },
                },
              },
            },
            {
              from: { element: { type: "clipper" } },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: [
                      "@inkade/core",
                      "@inkade/clipper-core",
                      "@inkade/clipper-core/*",
                      "@inkade/i18n",
                      "@inkade/sdk",
                      "@inkade/sdk/*",
                      "@inkade/ui",
                      "@inkade/ui/*",
                    ],
                  },
                },
              },
            },
            {
              from: { element: { type: "desktop" } },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: ["@inkade/core", "@inkade/i18n", "@inkade/sdk", "@inkade/sdk/*"],
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile" } },
              allow: {
                to: {
                  module: {
                    origin: "external",
                    source: ["@inkade/core", "@inkade/i18n", "@inkade/sdk", "@inkade/sdk/*"],
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/server/src/routes/**/*.{ts,tsx,mts,cts}",
      "apps/server/src/services/**/*.{ts,tsx,mts,cts}",
    ],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["drizzle-orm", "drizzle-orm/*"],
              message:
                "Routes and services must delegate persistence to @inkade/db repositories rather than importing drizzle-orm directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: UI_I18N_FILES,
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      i18next: i18nextPlugin,
      "inkade-i18n": inkadeI18nPlugin,
    },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          "should-validate-template": true,
          "jsx-components": {
            exclude: ["Trans", "Kbd"],
          },
          words: {
            exclude: [
              "[0-9!-/:-@[-`{-~]+",
              "^[A-Z0-9_.-]+$",
              "^v$",
              "^Inkade$",
              "^MCP$",
              "^/mcp$",
              "^/dispatch$",
              "^\\.md$",
              "^mermaid$",
              "^⌘[A-Za-z.]$",
              "^G [A-Z]$",
              "^Esc$",
              "^[·—→…]+$",
            ],
          },
        },
      ],
      "inkade-i18n/no-hardcoded-ui-string": "error",
    },
  },
];
