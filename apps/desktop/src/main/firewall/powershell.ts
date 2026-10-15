import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
import type { FirewallAllowResult } from '../../shared/firewall.ts'
import { type Environment, type FirewallSnapshot, parseSnapshot } from './rules.ts'

/**
 * Windows-only: reads the firewall state without admin rights, and adds ShiftPane's rule
 * behind a UAC prompt. Every script here is fixed; the only value spliced in is the path of
 * the running executable, as a quoted literal.
 */

const execFileAsync = promisify(execFile)

/** The rule ShiftPane adds. `build/installer.nsh` adds the same one for installed builds. */
export const RULE_NAME = 'ShiftPane'
const RULE_DESCRIPTION = 'Lets phones on your local network pair with ShiftPane.'

const ERROR_CANCELLED = 1223
const FLAGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']

/** Prints the rules, profile settings and network categories as one JSON object for `parseSnapshot`. */
export const QUERY_SCRIPT = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Read-Rules($key) {
  if (Test-Path $key) {
    $item = Get-Item $key
    foreach ($name in $item.GetValueNames()) { [string]$item.GetValue($name) }
  }
}
$local = @(Read-Rules 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules')
$policy = @(Read-Rules 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\FirewallRules')
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_.Name
    enabled = [string]$_.Enabled
    defaultInboundAction = [string]$_.DefaultInboundAction
    allowInboundRules = [string]$_.AllowInboundRules
    allowLocalFirewallRules = [string]$_.AllowLocalFirewallRules
  }
})
$networks = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_.Name
    interfaceAlias = [string]$_.InterfaceAlias
    category = [string]$_.NetworkCategory
  }
})
ConvertTo-Json -Compress -Depth 3 -InputObject ([pscustomobject]@{
  local = $local; policy = $policy; profiles = $profiles; networks = $networks
})`

/** A PowerShell string literal. PowerShell also ends single-quoted strings at curly quotes. */
export function psLiteral(value: string): string {
  return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`
}

/** For `-EncodedCommand`, which sidesteps command-line quoting altogether. */
export function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Runs elevated. Leaves exactly one inbound allow rule for `program` on private and domain
 * networks: clears this program's inbound block rules (Windows makes those when its own
 * "allow access" prompt is dismissed, and they beat any allow rule) and earlier ShiftPane
 * rules, then adds a fresh one. A program rule, not a port rule, so it still applies when
 * the default port is taken and the server falls back to a random one.
 */
export function allowScript(program: string): string {
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$program = ${psLiteral(program)}
try {
  $stale = @(Get-NetFirewallApplicationFilter -PolicyStore PersistentStore |
    Where-Object { [Environment]::ExpandEnvironmentVariables($_.Program) -ieq $program } |
    Get-NetFirewallRule |
    Where-Object { $_.Direction -eq 'Inbound' -and ($_.Action -eq 'Block' -or $_.DisplayName -eq ${psLiteral(RULE_NAME)}) })
  if ($stale.Count -gt 0) { $stale | Remove-NetFirewallRule }
  New-NetFirewallRule -DisplayName ${psLiteral(RULE_NAME)} -Description ${psLiteral(RULE_DESCRIPTION)} -Direction Inbound -Action Allow -Program $program -Profile Private,Domain -Protocol TCP | Out-Null
  exit 0
} catch {
  exit 1
}`
}

/** Runs `script` in an elevated PowerShell (UAC prompt) and exits with its exit code, or 1223 if the user declines. */
export function elevatedScript(script: string, powershell: string): string {
  return `$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = ${psLiteral(powershell)}
$psi.Arguments = '${FLAGS.join(' ')} -EncodedCommand ${encodeCommand(script)}'
$psi.Verb = 'runas'
$psi.UseShellExecute = $true
$psi.WindowStyle = 'Hidden'
try {
  $process = [Diagnostics.Process]::Start($psi)
} catch {
  for ($e = $_.Exception; $e; $e = $e.InnerException) {
    if ($e -is [ComponentModel.Win32Exception] -and $e.NativeErrorCode -eq ${ERROR_CANCELLED}) { exit ${ERROR_CANCELLED} }
  }
  exit 1
}
$process.WaitForExit()
exit $process.ExitCode`
}

/** Windows PowerShell 5.1 from System32, not whatever `powershell` resolves to on PATH. */
function powershellPath(env: Environment): string {
  return win32.join(
    env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
}

export async function queryFirewall(env: Environment = process.env): Promise<FirewallSnapshot> {
  const { stdout } = await execFileAsync(
    powershellPath(env),
    [...FLAGS, '-EncodedCommand', encodeCommand(QUERY_SCRIPT)],
    { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  )
  return parseSnapshot(stdout)
}

/** Shows the UAC prompt and, if accepted, adds ShiftPane's rule for `program`. */
export async function allowThroughFirewall(
  program: string,
  env: Environment = process.env,
): Promise<FirewallAllowResult> {
  const powershell = powershellPath(env)
  try {
    await execFileAsync(
      powershell,
      [
        ...FLAGS,
        '-EncodedCommand',
        encodeCommand(elevatedScript(allowScript(program), powershell)),
      ],
      // Long enough for someone to read the UAC prompt.
      { windowsHide: true, timeout: 5 * 60_000 },
    )
    return 'allowed'
  } catch (error) {
    return (error as { code?: unknown }).code === ERROR_CANCELLED ? 'cancelled' : 'failed'
  }
}
