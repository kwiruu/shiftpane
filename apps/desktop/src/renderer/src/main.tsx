import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { startCaptureHost } from './capture/host.ts'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

// The monitor stream's capture and WebRTC live in this page, outside React: it is started by the
// main process, not by anything on screen.
startCaptureHost({
  channel: window.shiftpane.capture,
  getDisplayMedia: (options) => navigator.mediaDevices.getDisplayMedia(options),
  createPeerConnection: (configuration) => new RTCPeerConnection(configuration),
  warmUp: true,
  log: (message) => console.info(`[capture] ${message}`),
})

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
