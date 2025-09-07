/// <reference types="node" />

// vite.config.ts
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
    base: "./", // critical for packaged Tauri paths
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
        hmr: { host: "localhost" },
        // Optional: quiet the red HMR overlay if you prefer console-only
        // hmr: { host: "localhost", overlay: false },
    },
    build: {
        target: "es2022",
        outDir: "dist",
        emptyOutDir: true,
    },
    optimizeDeps: {
        esbuildOptions: { target: "es2022" },
    },
});
