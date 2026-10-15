import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  allowScript,
  elevatedScript,
  encodeCommand,
  psLiteral,
  QUERY_SCRIPT,
} from './powershell.ts'

const decode = (base64: string) => Buffer.from(base64, 'base64').toString('utf16le')

describe('psLiteral', () => {
  it('doubles straight and curly single quotes', () => {
    expect(psLiteral("C:\\Users\\O'Brien\\a.exe")).toBe("'C:\\Users\\O''Brien\\a.exe'")
    expect(psLiteral('C:\\Users\\Kei’s PC\\a.exe')).toBe("'C:\\Users\\Kei’’s PC\\a.exe'")
    expect(psLiteral('$(Remove-Item x) `n "q"')).toBe('\'$(Remove-Item x) `n "q"\'')
  })
})

describe('allowScript', () => {
  it('splices the program path in once, as a literal', () => {
    const script = allowScript("C:\\Users\\O'Brien\\shiftpane.exe")
    expect(script).toContain("$program = 'C:\\Users\\O''Brien\\shiftpane.exe'")
    expect(script.match(/O''Brien/g)).toHaveLength(1)
    expect(script).toContain('-Profile Private,Domain -Protocol TCP')
  })
})

describe('elevatedScript', () => {
  it('runs the inner script through -EncodedCommand behind a runas verb', () => {
    const inner = allowScript('C:\\a.exe')
    const outer = elevatedScript(
      inner,
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
    expect(outer).toContain("$psi.Verb = 'runas'")
    const encoded = /-EncodedCommand ([A-Za-z0-9+/=]+)'/.exec(outer)?.[1] ?? ''
    expect(decode(encoded)).toBe(inner)
  })
})

// Parses (never runs) each script with PowerShell's own parser, so a typo fails here and not
// behind a UAC prompt.
describe.runIf(process.platform === 'win32')('scripts parse in Windows PowerShell', () => {
  const parseErrors = (script: string) => {
    const check = `$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodeCommand(script)}')), [ref]$null, [ref]$errors)
$errors.Count`
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(check)],
      { encoding: 'utf8', windowsHide: true },
    ).trim()
  }

  it.each([
    ['query', QUERY_SCRIPT],
    ['allow', allowScript("C:\\Users\\O'Brien\\shiftpane.exe")],
    ['elevate', elevatedScript(allowScript('C:\\a.exe'), 'C:\\powershell.exe')],
  ])('%s', (_name, script) => {
    expect(parseErrors(script)).toBe('0')
  })
})
