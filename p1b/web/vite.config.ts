import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 后端（P1b-1 Fastify）默认端口约定为 8787；dev 代理 /api 到本地后端。
// 后端未就绪期：设 VITE_USE_MOCK=1 全走内置 mock（见 src/api.ts）。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // ★2026-09-30：dev 服务的可读范围放宽到整个 p1b 包。
    //   病象：WhereOffPage 现在 import 的是 p1b/src/disclosure/habitRank.mjs（归并判据的唯一
    //   真源，后端端点与网页共用同一份）。生产构建不受影响（build 走磁盘直读），
    //   但 **dev 走的是 fs.allow 白名单**，实测直接把那条 import 变成 403：
    //   "request url … is outside of Vite serving allow list"（只列了 web 这一个根）。
    //   ⇒ 这里补一行，让 dev 与 build 对"同一份源码"给出同一个答案。
    //   范围取 p1b 包根而不是整机：只放开本包，后端源码本来就在同包里。
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true }, // 127.0.0.1 避免 localhost 解析到 ::1 与后端 0.0.0.0(IPv4) 不通
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
