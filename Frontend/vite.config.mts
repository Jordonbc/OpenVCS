// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="node" />

import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const sentryOrg = process.env.SENTRY_ORG?.trim();
const sentryProject = process.env.SENTRY_PROJECT?.trim();
const sentryRelease = process.env.VITE_SENTRY_RELEASE?.trim();
const shouldUploadSourceMaps = Boolean(sentryAuthToken && sentryOrg && sentryProject && sentryRelease);

export default defineConfig({
    base: "./", // critical for packaged Tauri paths
    clearScreen: false, // prevent Vite from obscuring Rust errors in dev
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            "@scripts": fileURLToPath(new URL("./src/scripts", import.meta.url)),
            "@modals": fileURLToPath(new URL("./src/modals", import.meta.url)),
        },
    },
    server: {
        port: 1420,
        strictPort: true,
        open: false,
        host: host || false,
        hmr: host
            ? {
                  protocol: "ws",
                  host,
                  port: 1421,
              }
            : undefined,
        watch: {
            ignored: ["**/src-tauri/**"],
        },
    },
    build: {
        target: "es2022",
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: shouldUploadSourceMaps ? "hidden" : false,
    },
    optimizeDeps: {
        include: [],
    },
    plugins: shouldUploadSourceMaps
        ? [
              sentryVitePlugin({
                  authToken: sentryAuthToken,
                  org: sentryOrg,
                  project: sentryProject,
                  release: {
                      name: sentryRelease,
                      create: true,
                      finalize: true,
                  },
                  sourcemaps: {
                      assets: "./dist/**",
                  },
                  telemetry: false,
              }),
          ]
        : [],
});
