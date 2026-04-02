import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  // Capacitor: file:// / capacitor:// 에서 상대 경로로 에셋 로드
  base: "./",
  plugins: [react()],
  server: {
    port: 5173
  }
});

