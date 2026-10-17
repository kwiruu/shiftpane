import { registerSW } from 'virtual:pwa-register'

/**
 * Keeps the phone app current. The PC serves the phone app, and the service worker keeps a copy
 * so it opens offline; without this, a phone would go on showing the copy from before the PC was
 * updated until it was reloaded twice.
 *
 * A new version is looked for whenever the phone (re)connects to the PC, since an updated PC has
 * just restarted, and whenever the app comes back to the foreground. Once a new version has been
 * downloaded and takes over, the page reloads onto it by itself.
 */

let registration: ServiceWorkerRegistration | undefined

export function startUpdates(): void {
  if (!('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onRegisteredSW: (_url, registered) => {
      registration = registered
    },
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
}

/** Asks the PC for a newer phone app; quietly does nothing when it cannot be reached. */
export function checkForUpdate(): void {
  void registration?.update().catch(() => {})
}
