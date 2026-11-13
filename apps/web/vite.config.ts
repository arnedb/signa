import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.SIGNA_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { port: 5173, proxy: { "/api": { target: api, changeOrigin: false } } },
  preview: { port: 4173, proxy: { "/api": { target: api } } },
  build: { sourcemap: true },
});
