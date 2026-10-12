import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages 之类的子路径部署需要相对路径
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  optimizeDeps: {
    // zstd wasm 包内部用 `new URL('./zstd.wasm', import.meta.url)` 定位 wasm，
    // 预打包会破坏这个相对路径，因此排除在依赖预构建之外。
    exclude: ['@bokuweb/zstd-wasm'],
  },
  // 显式绑到 IPv4，避免 Windows 上只监听 ::1 导致 127.0.0.1 连不上
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: false },
});
