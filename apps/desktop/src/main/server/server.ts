import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { DEFAULT_PORT, MAX_FRAME_BYTES, PORT_RANGE, WS_PATH } from '@shiftpane/protocol'
import { WebSocket, WebSocketServer } from 'ws'
import type { TlsCredentials } from './certificate.ts'
import type { PhoneHub } from './phone-hub.ts'
import { createStaticHandler, securityHeaders } from './static.ts'

export interface LanServerOptions {
  tls: TlsCredentials
  /** Directory holding the built phone app. */
  staticRoot: string
  hub: PhoneHub
  /**
   * Tried first (the port phones last used), then the ports from `DEFAULT_PORT` on, then any
   * free port. 0 goes straight to a free port.
   */
  port?: number
  host?: string
  /** How often to ping sockets; a socket that misses one ping is dropped (dead Wi-Fi). */
  heartbeatMs?: number
  /** HTTP observations from another device; excludes local self-checks and URL tokens. */
  onPhoneRequest?: (stage: 'page' | 'test' | 'socket') => void
}

export interface LanServer {
  port: number
  close(): Promise<void>
  updateTls(tls: TlsCredentials): void
}

/**
 * The HTTPS server phones connect to: serves the phone app and upgrades `/ws` to the
 * WebSocket the PhoneHub authenticates. Listens on every interface so phones on the LAN
 * can reach it; pairing, not the network, is what grants access.
 */
export async function startLanServer(options: LanServerOptions): Promise<LanServer> {
  const serveStatic = createStaticHandler(options.staticRoot)
  const server = createServer(
    { cert: options.tls.cert, key: options.tls.key, minVersion: 'TLSv1.2' },
    (req, res) => {
      const path = (req.url ?? '/').split('?')[0]
      if (req.method === 'GET' && isRemoteDevice(req.socket.remoteAddress, req.socket.localAddress))
        res.once('finish', () => {
          if (
            res.statusCode === 200 &&
            (path === '/' || path === '/index.html' || path === '/connection-test')
          )
            options.onPhoneRequest?.(path === '/connection-test' ? 'test' : 'page')
        })
      if (path === '/connection-test' && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, {
          ...securityHeaders(req.headers.host),
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(req.method === 'HEAD' ? undefined : CONNECTION_TEST_HTML)
        return
      }
      serveStatic(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    },
  )

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== WS_PATH || !isSameOrigin(req.headers.origin, req.headers.host)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    if (isRemoteDevice(req.socket.remoteAddress, req.socket.localAddress))
      options.onPhoneRequest?.('socket')
    wss.handleUpgrade(req, socket, head, (ws) => {
      const handlers = options.hub.accept({
        remoteAddress: req.socket.remoteAddress ?? 'unknown',
        send: (frame) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(frame)
        },
        close: (code, reason) => ws.close(code, reason),
      })
      let alive = true
      ws.on('pong', () => {
        alive = true
      })
      const heartbeat = setInterval(() => {
        if (!alive) {
          ws.terminate()
          return
        }
        alive = false
        ws.ping()
      }, options.heartbeatMs ?? 15_000)
      ws.on('message', (data, isBinary) => {
        // Binary frames are not part of the protocol; the hub rejects the text as garbage.
        handlers.onMessage(isBinary ? '' : data.toString())
      })
      ws.on('close', () => {
        clearInterval(heartbeat)
        handlers.onClose()
      })
      ws.on('error', () => ws.terminate())
    })
  })

  const port = await listen(server, candidatePorts(options.port), options.host ?? '0.0.0.0')
  return {
    port,
    updateTls: (tls) => server.setSecureContext({ cert: tls.cert, key: tls.key }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate()
        wss.close()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** Browsers always send Origin on WebSocket upgrades; other pages must not open our socket. */
function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true // not a browser; the hello's auth still applies
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * The ports to try, in order. A phone's home screen app is tied to one address, so a port that
 * worked before, or failing that a predictable one, beats whatever is free.
 */
export function candidatePorts(preferred?: number): number[] {
  if (preferred === 0) return [0]
  const range = Array.from({ length: PORT_RANGE }, (_, i) => DEFAULT_PORT + i)
  return [...new Set([...(preferred === undefined ? [] : [preferred]), ...range]), 0]
}

function listen(server: Server, ports: readonly number[], host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let next = 0
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && next < ports.length) {
        server.listen(ports[next++], host)
        return
      }
      reject(error)
    }
    server.on('error', onError)
    server.once('listening', () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    })
    server.listen(ports[next++], host)
  })
}

/** No scripts, pairing tokens or app assets: isolates basic HTTPS reachability. */
const CONNECTION_TEST_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShiftPane connection test</title><body style="background:#111;color:#eee;font:18px/1.5 system-ui,sans-serif;padding:32px"><h1>Connection reached your PC</h1><p>This phone can load a page from ShiftPane over this network.</p><p>Return to the PC and scan the main pairing QR code to connect. This test does not pair your phone.</p></body></html>`

/** Exclude loopback and connections the PC makes to its own LAN address. */
export function isRemoteDevice(remote: string | undefined, local: string | undefined): boolean {
  const address = remote?.replace(/^::ffff:/, '')
  const own = local?.replace(/^::ffff:/, '')
  return Boolean(address && address !== own && !address.startsWith('127.') && address !== '::1')
}
