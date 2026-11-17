import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // DeepSeek 官方接口不返回跨域头，开发服务器代为转发。
    // 打包版由「接口地址」控制，可填直连或自建中转。
    proxy: {
      '/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deepseek/, ''),
      },
    },
  },
});
