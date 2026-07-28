import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787'
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Webitor',
        short_name: 'Webitor',
        description: 'A private, offline-first text and Markdown editor for touch-first devices.',
        theme_color: '#101316',
        background_color: '#101316',
        display: 'standalone',
        start_url: '/',
        file_handlers: [{
          action: '/',
          accept: {
            'text/plain': ['.txt', '.text', '.log', '.csv', '.ini', '.cfg', '.conf', '.toml', '.properties', '.env', '.gitignore'],
            'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'],
            'application/json': ['.json', '.jsonc'],
            'application/xml': ['.xml'],
            'text/yaml': ['.yaml', '.yml'],
            'text/html': ['.html', '.htm'],
            'text/css': ['.css'],
            'text/javascript': ['.js', '.mjs', '.cjs', '.jsx'],
            'text/typescript': ['.ts', '.mts', '.cts', '.tsx'],
            'text/x-python': ['.py'],
            'text/x-java-source': ['.java'],
            'text/x-c': ['.c', '.h'],
            'text/x-c++': ['.cc', '.cpp', '.cxx', '.hpp'],
            'text/x-rust': ['.rs'],
            'application/sql': ['.sql']
          }
        }],
        icons: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024
      }
    })
  ]
})
