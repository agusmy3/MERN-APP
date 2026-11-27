import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Library pihak ketiga dipisah dari kode aplikasi: jarang berubah, jadi tetap ter-cache browser setelah deploy
// (yang diunduh ulang hanya chunk halaman yang berubah). Leaflet tetap di chunk peta (dimuat lazy).
const VENDOR_CHUNKS = {
  react: ['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'],
  ui: ['framer-motion', 'motion-dom', 'motion-utils', '@tabler/icons-react'],
  libs: ['axios', 'dayjs'],
}

const vendorChunk = (id) => {
  if (!id.includes('node_modules')) return undefined
  const pkg = id.split('node_modules/').pop().split('/')
  const name = pkg[0].startsWith('@') ? `${pkg[0]}/${pkg[1]}` : pkg[0]
  return Object.keys(VENDOR_CHUNKS).find((chunk) => VENDOR_CHUNKS[chunk].includes(name))
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:5000' // proxy ke backend
    }
  },
  plugins: [react(),tailwindcss(),],
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
})
