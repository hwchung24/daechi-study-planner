import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  // Capacitor: file:// / capacitor:// 에서 상대 경로로 에셋 로드
  base: "./",
  plugins: [react()],
  build: {
    // iOS 배포 16+ / 최신 Chromium — 불필요한 레거시 폴리필 축소
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("recharts")) return "vendor-charts";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("leaflet")) return "vendor-maps";
          if (id.includes("html2canvas") || id.includes("jspdf")) return "vendor-pdf";
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/auth": { target: "http://localhost:3000", changeOrigin: true },
      "/uploads": { target: "http://localhost:3000", changeOrigin: true }
    }
  }
});

