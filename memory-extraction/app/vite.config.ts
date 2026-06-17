import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Renderer build. base "./" so assets resolve under Electron's file:// load.
export default defineConfig({
  root: "renderer-src",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../renderer-dist",
    emptyOutDir: true,
  },
});
