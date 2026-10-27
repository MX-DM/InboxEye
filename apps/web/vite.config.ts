import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// La consola habla con la API a través de /api (proxy): no hace falta CORS ni exponer la API.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
