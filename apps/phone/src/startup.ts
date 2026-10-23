/** Last-resort UI for module initialization or uncaught React failures. No network reporting. */
export function showStartupFailure(error: unknown): void {
  console.error('Phone startup failed', error)
  const root = document.getElementById('root')
  if (!root) return
  const panel = document.createElement('section')
  panel.setAttribute('role', 'alert')
  panel.style.cssText =
    'box-sizing:border-box;min-height:100%;padding:32px;background:#111;color:#f4f4f5;font:16px/1.5 system-ui,sans-serif;display:flex;flex-direction:column;justify-content:center;gap:16px'
  const title = document.createElement('h1')
  title.textContent = 'ShiftPane could not open'
  const help = document.createElement('p')
  help.textContent =
    'Reload this page to try again. If it still fails, share the message below so we can diagnose it.'
  const detail = document.createElement('pre')
  detail.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px'
  detail.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const reload = document.createElement('button')
  reload.textContent = 'Reload ShiftPane'
  reload.style.cssText =
    'align-self:flex-start;padding:12px 20px;border-radius:12px;border:0;background:#eee;color:#111;font:inherit'
  reload.onclick = () => window.location.reload()
  panel.append(title, help, detail, reload)
  root.replaceChildren(panel)
}
