/** The only surface the renderer gets: exposed as `window.shiftpane` by the preload script. */
export interface ShiftPaneApi {
  platform: 'windows' | 'macos' | 'linux'
  versions: { app: string; electron: string; chrome: string; node: string }
}

declare global {
  interface Window {
    shiftpane: ShiftPaneApi
  }
}
