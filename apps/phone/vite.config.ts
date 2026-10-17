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
      // src/updates.ts registers the worker itself, so it can reload onto a new version.
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      // Fonts and icons too, so the phone-only widgets still look right while the PC is away.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      manifest: {
        name: 'ShiftPane',
        short_name: 'ShiftPane',
        description: 'Your phone as a second monitor, with live widgets beside it.',
        // Android honours fullscreen; iOS opens home screen apps standalone, which with the
        // black-translucent status bar in index.html also fills the whole screen.
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true,
  },
})
