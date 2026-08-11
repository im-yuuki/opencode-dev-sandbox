import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Served by nginx under /launcher/ behind the PAM gate.
  base: '/launcher/',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss()
  ],
  build: {
    rolldownOptions: {
      output: {
        // Keep the initial launcher shell small. Pages are lazy-loaded below,
        // while large shared libraries get stable vendor chunks instead of
        // being folded into one warning-sized entry bundle.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/recharts/')) return 'vendor-charts'
          if (id.includes('/framer-motion/')) return 'vendor-motion'
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router/')) {
            return 'vendor-react'
          }
          if (id.includes('/@heroui/') || id.includes('/tailwindcss/')) return 'vendor-ui'
          return 'vendor'
        },
      },
    },
  },
})
