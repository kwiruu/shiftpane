import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Default layout: src/main, src/preload, src/renderer. Every dependency is a devDependency,
// so electron-vite bundles all of it (workspace packages included) and the packaged app
// ships no node_modules.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
  },
})
