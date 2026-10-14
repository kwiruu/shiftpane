import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { DEFAULT_PORT, MAX_FRAME_BYTES, WS_PATH } from '@shiftpane/protocol'
import { WebSocket, WebSocketServer } from 'ws'
import type { TlsCredentials } from './certificate.ts'
import type { PhoneHub } from './phone-hub.ts'
import { createStaticHandler } from './static.ts'

export interface LanServerOptions {
  tls: TlsCredentials
  /** Directory holding the built phone app. */
  staticRoot: string
  hub: PhoneHub
  /** Tried first; falls back to a free port when taken. */
  port?: number
  host?: string
  /** How often to ping sockets; a socket that misses one ping is dropped (dead Wi-Fi). */
  heartbeatMs?: number
}

export interface LanServer {
  port: number
  close(): Promise<void>
}

/**
 * The HTTPS server phones connect to: serves the phone app and upgrades `/ws` to the
 * WebSocket the PhoneHub authenticates. Listens on every interface so phones on the LAN
 * can reach it; the pairing token, not the network, is what grants access.
 */
export async function startLanServer(options: LanServerOptions): Promise<LanServer> {
  const serveStatic = createStaticHandler(options.staticRoot)
  const server = createServer(
    { cert: options.tls.cert, key: options.tls.key, minVersion: 'TLSv1.2' },
    (req, res) => {
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

  const port = await listen(server, options.port ?? DEFAULT_PORT, options.host ?? '0.0.0.0')
  return {
    port,
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
  if (origin === undefined) return true // not a browser; the pairing token still applies
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && port !== 0) {
        server.listen(0, host)
        return
      }
      reject(error)
    }
    server.on('error', onError)
    server.once('listening', () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    })
    server.listen(port, host)
  })
}
