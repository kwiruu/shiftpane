import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
import { startUpdates } from './updates.ts'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

startUpdates()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
