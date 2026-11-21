import { defineConfig } from 'vite'

export default defineConfig({
  // 以前这里有一行 publicDir: '../shared/mock'，把假数据当静态文件挂进来，
  // 给 DATA_SOURCE='mock' 那版用。现在页面只走真实接口，这一行就撤了 ——
  // 留着的话，构建出来的 dist/ 里会躺着 users.json 这类文件，
  // 部署到公网就等于把「调试用的假数据」一起公开了。
  server: {
    fs: { allow: ['..'] },
    // 开发阶段把 /api 转发给后端，避免浏览器跨域拦截。
    // 上线时前后端同域、或由网关统一转发，这一条就不需要了。
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
