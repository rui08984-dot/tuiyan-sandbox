import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后端（P1b-1 Fastify）默认端口约定为 8787；dev 代理 /api 到本地后端。
// 后端未就绪期：设 VITE_USE_MOCK=1 全走内置 mock（见 src/api.ts）。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true }, // 127.0.0.1 避免 localhost 解析到 ::1 与后端 0.0.0.0(IPv4) 不通
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
