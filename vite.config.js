import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production builds are served from GitHub Pages under /FunctionalGraphExplorer/; dev stays at /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/FunctionalGraphExplorer/' : '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
}))
