import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Two entry points:
//   index.html -> the WebGL landing film (static, no React)
//   app.html   -> the React SPA holding auth + the three portals
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
  // same proxy for `vite` and `vite preview`, so the SPA always finds the API
  server: {
    port: 5173,
    // the SPA talks to the API on the same origin in dev and in production
    proxy: { '/api': { target: process.env.API_URL || 'http://localhost:8787', changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: process.env.API_URL || 'http://localhost:8787', changeOrigin: true } },
  },
})
