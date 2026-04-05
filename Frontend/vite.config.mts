/// <reference types="node" />

// vite.config.ts
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

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
    },
    optimizeDeps: {
        rolldownOptions: { target: "es2022" },
    },
});
