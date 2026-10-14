import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Default layout: src/main, src/preload, src/renderer. Every dependency is a devDependency,
// so electron-vite bundles all of it (workspace packages included) and the packaged app
// ships no node_modules.
export default defineConfig({
  main: {
    define: {
      // Bundling replaces ws's optional native addons with empty stubs, which ws then calls
      // and crashes on any frame over 32 bytes. Tell ws they are absent.
      'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
      'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1'),
    },
  },
  preload: {},
  renderer: {
    plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
  },
})
