import { defineConfig } from 'vite'

export default defineConfig({
  base: '/kaisai-handan/',
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  }
})
