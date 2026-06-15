import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages se sirve bajo /observatorio-ambiental-peruano/
export default defineConfig({
  plugins: [react()],
  base: '/observatorio-ambiental-peruano/',
  build: {
    chunkSizeWarningLimit: 1600,
  },
})
