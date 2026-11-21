import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: '../shared/mock',
  server: {
    fs: { allow: ['..'] },
    // 开发阶段把 /api 转发给后端，避免浏览器跨域拦截。
    // 上线时前后端同域、或由网关统一转发，这一条就不需要了。
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
