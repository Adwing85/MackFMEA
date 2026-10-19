import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const src = (file: string) => fileURLToPath(new URL(`./src/${file}`, import.meta.url));

// `--mode standalone`: eigenständige Browser-Version (eingebetteter Server statt FastAPI, eine HTML-Datei).
export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    plugins: [react()],
    define: { __STANDALONE__: JSON.stringify(standalone) },
    resolve: {
      alias: {
        "@transport": src(standalone ? "standalone/transport.ts" : "transport.ts"),
        "@gate": src(standalone ? "standalone/Gate.tsx" : "gate.tsx"),
      },
    },
    build: standalone
      ? { outDir: "dist-standalone", assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false }
      : undefined,
    server: {
      port: 5173,
      proxy: {
        "/api": { target: process.env.MACKFMEA_API ?? "http://127.0.0.1:8000", changeOrigin: true },
      },
    },
  };
});
