/** The scheme the site's Install buttons use: `shiftpane://install/<widget id>`. */
export const PROTOCOL = 'shiftpane'

/** The whole link, as typed: no `..`, no query, nothing after the id but a slash. */
const INSTALL = new RegExp(`^${PROTOCOL}://install/([a-z0-9]+(?:-[a-z0-9]+)*)/?$`, 'i')

/**
 * The widget an install link names, or null for any other link. The id is all a link carries:
 * installing still checks the signed index and asks the user, like an install from the window.
 */
export function installLinkId(link: string): string | null {
  const id = INSTALL.exec(link.trim())?.[1]
  return id && id === id.toLowerCase() && id.length <= 64 ? id : null
}

/** The first install link among a process's arguments (how Windows and Linux pass it). */
export function installLinkIn(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const id = installLinkId(arg)
    if (id) return id
  }
  return null
}
