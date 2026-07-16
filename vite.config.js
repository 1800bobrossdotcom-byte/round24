import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// manualChunks keeps stable third-party code in its own content-hashed chunks so
// a one-line app edit doesn't invalidate the cached vendor/react bundle for
// returning users, and isolates the heavy libs (recharts/xlsx/qrcode) that the
// lazy views pull, so they cache and load independently of the app shell.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory')) return 'charts'
          if (id.includes('xlsx')) return 'xlsx'
          if (id.includes('qrcode-generator')) return 'qr'
          if (id.includes('/react') || id.includes('/scheduler') || id.includes('@supabase')) return 'vendor'
          return undefined
        },
      },
    },
  },
})
