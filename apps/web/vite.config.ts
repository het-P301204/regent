import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * In development Vite serves the console on :5173 and proxies /api to the API
 * on :8787, so the browser sees one origin and the SameSite=Strict session
 * cookie works. In production the API serves dist/ itself, under its CSP.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.VITE_HOST ?? '127.0.0.1',
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
})
