import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: {
      /* Proxy API requests to the Express backend (default PORT=7000 per CLAUDE.md).
         Set VITE_API_PORT to override (e.g. VITE_API_PORT=3000 npm run dev). */
      '/api': `http://localhost:${process.env.VITE_API_PORT ?? 7000}`,
      '/gallery-uploads': `http://localhost:${process.env.VITE_API_PORT ?? 7000}`,
    },
  },
})
