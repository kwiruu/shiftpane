import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveStaticPath, SECURITY_HEADERS, securityHeaders } from './static.ts'

const root = resolve('/srv/phone')

describe('resolveStaticPath', () => {
  it('maps files and falls back to index.html for routes', () => {
    expect(resolveStaticPath(root, '/')).toBe(join(root, 'index.html'))
    expect(resolveStaticPath(root, '/assets/index-abc.js?v=1')).toBe(
      join(root, 'assets/index-abc.js'),
    )
    expect(resolveStaticPath(root, '/gallery')).toBe(join(root, 'index.html'))
  })

  it.each([
    '/../secrets.txt',
    '/assets/../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/..%5c..%5cwindows%5cwin.ini',
    '/file%00.js',
    '/%E0%A4%A',
  ])('refuses %s', (path) => {
    expect(resolveStaticPath(root, path)).toBeNull()
  })
})

describe('phone connection policy', () => {
  it('explicitly permits only the page host and port for secure WebSockets', () => {
    for (const host of ['192.168.1.20:47820', 'pc.local:47821', '[::1]:47820']) {
      expect(securityHeaders(host)['Content-Security-Policy']).toContain(
        `connect-src 'self' wss://${host};`,
      )
    }
  })
  it('does not interpolate invalid authorities into the policy', () => {
    for (const host of [
      undefined,
      'pc.local; connect-src *',
      'pc.local/path',
      'user@pc.local',
      'pc.local#fragment',
    ])
      expect(securityHeaders(host)).toEqual(SECURITY_HEADERS)
  })
})
