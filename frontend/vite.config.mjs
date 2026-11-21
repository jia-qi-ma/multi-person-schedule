import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: '../shared/mock',
  server: {
    fs: { allow: ['..'] },
  },
})
