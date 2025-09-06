import { defineConfig } from "vite";

export default defineConfig({
    base: "./",                 // critical for packaged Tauri paths
    server: {
        port: 1420,
        strictPort: true,
        open: false,
        hmr: { host: "localhost" }
    },
    build: {
        target: "es2022",
        outDir: "dist",
        emptyOutDir: true
    }
});
