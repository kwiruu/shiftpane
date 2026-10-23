import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
import { showStartupFailure } from './startup.ts'
import { startUpdates } from './updates.ts'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root, { onUncaughtError: showStartupFailure }).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline updates are optional and must never prevent the phone UI from opening.
try {
  startUpdates()
} catch (error) {
  console.warn('Phone update registration failed', error)
}
