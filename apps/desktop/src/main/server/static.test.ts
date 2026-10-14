import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveStaticPath } from './static.ts'

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
