import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** Headers on every response from the phone server. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/** Explicit same-host WSS source for browsers that do not match WebSockets to 'self'. */
export function securityHeaders(host: string | undefined): Readonly<Record<string, string>> {
  if (!host) return SECURITY_HEADERS
  try {
    const url = new URL(`https://${host}`)
    // Reject credentials, paths and directive injection before reflecting the authority.
    if (url.host.toLowerCase() !== host.toLowerCase()) return SECURITY_HEADERS
    return {
      ...SECURITY_HEADERS,
      'Content-Security-Policy':
        SECURITY_HEADERS['Content-Security-Policy']?.replace(
          "connect-src 'self'",
          `connect-src 'self' wss://${url.host}`,
        ) ?? '',
    }
  } catch {
    return SECURITY_HEADERS
  }
}

/**
 * Maps a request path to a file under `root`, or null if it would escape `root`.
 * Paths without an extension fall back to index.html (client-side routes).
 */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.split(/[/\\]/).includes('..')) return null
  const relative = normalize(decoded).replace(/^([/\\])+/, '')
  const file = relative === '' || extname(relative) === '' ? 'index.html' : relative
  const resolved = join(root, file)
  return resolved === root || resolved.startsWith(root.endsWith(sep) ? root : root + sep)
    ? resolved
    : null
}

function cacheControl(file: string): string {
  // Vite fingerprints everything under assets/; the shell and service worker must revalidate.
  return file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
}

/** Serves the built phone app from `root`. GET and HEAD only. */
export function createStaticHandler(root: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [name, value] of Object.entries(securityHeaders(req.headers.host)))
      res.setHeader(name, value)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const file = resolveStaticPath(root, req.url ?? '/')
    const info = file ? await stat(file).catch(() => null) : null
    if (!file || !info?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': cacheControl(file),
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file).pipe(res)
  }
}
