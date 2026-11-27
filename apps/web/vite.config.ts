import { Scanner } from "@tailwindcss/oxide";
import react from "@vitejs/plugin-react";
import { compile } from "tailwindcss";
import type { PluginOption } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { createInkadeTailwindVitePlugin } from "../../scripts/tailwind-v4-compiler.ts";

const plugins: PluginOption[] = [
  createInkadeTailwindVitePlugin({ compile, Scanner }),
  react(),
  VitePWA({
    injectRegister: false,
    registerType: "autoUpdate",
    includeAssets: [
      "icon.svg",
      "favicon.ico",
      "favicon-32.png",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
    ],
    manifest: {
      name: "Inkade — ADE-Native Knowledge Hub",
      short_name: "Inkade",
      description:
        "Dual-engine daily outliner and long-form research hub with server-enforced ADE scopes.",
      theme_color: "#4f46e5",
      background_color: "#ffffff",
      display: "standalone",
      start_url: "./",
      scope: "./",
      share_target: {
        action: "./inbox",
        method: "GET",
        params: {
          title: "title",
          text: "text",
          url: "url",
        },
      },
      icons: [
        {
          src: "icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
        {
          src: "icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      skipWaiting: true,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      navigateFallback: "index.html",
      navigateFallbackDenylist: [/^\/api\//, /^\/mcp$/],
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
    },
  }),
];

export default defineConfig({
  base: "./",
  plugins,
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3456",
        changeOrigin: true,
        ws: true,
      },
      "/mcp": {
        target: "http://localhost:3456",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@tanstack/")) {
            return "vendor-tanstack";
          }
          if (id.includes("node_modules/@base-ui/") || id.includes("node_modules/lucide-react/")) {
            return "vendor-ui";
          }
          if (
            id.includes("node_modules/react-hook-form/") ||
            id.includes("node_modules/@hookform/") ||
            id.includes("node_modules/zod/")
          ) {
            return "vendor-forms";
          }
          if (
            id.includes("@tiptap/") ||
            id.includes("node_modules/prosemirror-") ||
            id.includes("node_modules/yjs/") ||
            id.includes("node_modules/y-prosemirror/")
          ) {
            return "vendor-tiptap";
          }
          if (id.includes("node_modules/katex/")) {
            return "vendor-katex";
          }
          if (
            id.includes("node_modules/react-markdown/") ||
            id.includes("node_modules/rehype-katex/") ||
            id.includes("node_modules/remark-math/") ||
            id.includes("node_modules/unified/") ||
            id.includes("node_modules/remark-") ||
            id.includes("node_modules/rehype-") ||
            id.includes("node_modules/mdast-") ||
            id.includes("node_modules/hast-") ||
            id.includes("node_modules/micromark")
          ) {
            return "vendor-markdown";
          }
          if (id.includes("node_modules/mermaid/")) {
            return "vendor-mermaid";
          }
          if (
            id.includes("node_modules/sigma/") ||
            id.includes("node_modules/graphology") ||
            id.includes("node_modules/@react-sigma/")
          ) {
            return "vendor-graph";
          }
          if (
            id.includes("node_modules/@fullcalendar/") ||
            id.includes("node_modules/temporal-polyfill/")
          ) {
            return "vendor-calendar";
          }
          if (id.includes("node_modules/gpt-tokenizer/")) {
            return "vendor-tokenizer";
          }
          if (
            id.includes("node_modules/papaparse/") ||
            id.includes("node_modules/yaml/")
          ) {
            return "vendor-structured";
          }
          if (id.includes("node_modules/pdfjs-dist/")) {
            return "vendor-pdf";
          }
          return undefined;
        },
      },
    },
  },
});
