/**
 * Demo mode: sample PC data instead of a connection. On for the Vite dev server, which has no
 * PC behind it (so the UI can be designed in a desktop browser), and for `?demo`, which the
 * hosted demo will use.
 */
export const DEMO = import.meta.env.DEV || new URLSearchParams(window.location.search).has('demo')
