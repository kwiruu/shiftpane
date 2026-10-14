import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Served from the desktop app's HTTPS server root, and later from GitHub Pages in demo mode.
  base: './',
  plugins: [
    react({ babel: { plugins: ['babel-plugin-react-compiler'] } }),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ShiftPane',
        short_name: 'ShiftPane',
        description: 'Your phone as a second monitor, with live widgets beside it.',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#16181d',
        theme_color: '#16181d',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  server: {
    host: true,
  },
})
