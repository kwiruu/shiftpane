import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  canSendOffPc,
  osiLicenses,
  readPackage,
  reservedIds,
  type WidgetPackage,
} from '@shiftpane/widget-sdk'
import { PACKAGE_FILES, type PackageFile, type PackageTexts, readWidgetFolder } from './folder.ts'
import { inspectCollector } from './run.ts'
import { openPackage, packPackage } from './zip.ts'

export interface FolderReport {
  /** The package, when its files parse and its view fits its manifest. */
  widget?: WidgetPackage
  texts: PackageTexts
  /** What the marketplace would refuse it for. */
  problems: string[]
  /** What it would let through, but a person reviews first. */
  warnings: string[]
}

/**
 * Every check the marketplace runs on an upload that can be run on this PC: the files and their
 * limits, the manifest, the view against the manifest and the sample, the license, a README, a
 * collector that loads and exports one, and an id ShiftPane doesn't reserve.
 */
export async function checkFolder(folder: string): Promise<FolderReport> {
  const { files, problems } = await readWidgetFolder(folder)
  if (problems.length > 0) return { texts: files, problems, warnings: [] }
  const read = readPackage(files)
  if (!read.ok) return { texts: files, problems: read.problems, warnings: [] }
  const { manifest, collector } = read.widget
  const more: string[] = []
  if (reservedIds.includes(manifest.id)) {
    more.push(`"${manifest.id}" is a widget built into ShiftPane. Pick another id.`)
  }
  if (!osiLicenses.includes(manifest.license)) {
    more.push(
      `${manifest.license} isn't an OSI-approved SPDX id. Use one such as MIT or Apache-2.0.`,
    )
  }
  if (!files.readme?.trim()) more.push('README.md is missing or empty.')
  if (!files.license?.trim()) more.push('LICENSE is missing or empty.')
  if (collector !== undefined) {
    const problem = await inspectCollector(collector)
    if (problem) more.push(`collector.js: ${problem}`)
  }
  const warnings: string[] = []
  if (canSendOffPc(manifest.permissions)) {
    warnings.push(
      'It reads something that shows what you do and can reach a host, so a person always reviews it.',
    )
  }
  if (manifest.permissions.local.length > 0) {
    warnings.push('It reaches apps on this PC or network, so a person always reviews it.')
  }
  return { widget: read.widget, texts: files, problems: more, warnings }
}

export type PackResult =
  | { ok: true; zip: Uint8Array; sha256: string; fileName: string; widget: WidgetPackage }
  | { ok: false; report: FolderReport }

/**
 * The package the marketplace takes: the checked files, plus `icon.png` and `screenshots/*.png`
 * when there are any, packed so the same files always give the same zip.
 */
export async function packFolder(folder: string): Promise<PackResult> {
  const report = await checkFolder(folder)
  if (!report.widget || report.problems.length > 0) return { ok: false, report }
  const files: Record<string, Uint8Array | string> = {}
  for (const [key, name] of Object.entries(PACKAGE_FILES) as [PackageFile, string][]) {
    const text = report.texts[key]
    if (text !== undefined) files[name] = text
  }
  const icon = await readFile(join(folder, 'icon.png')).catch(() => null)
  if (icon) files['icon.png'] = icon
  const shots = await readdir(join(folder, 'screenshots')).catch(() => [] as string[])
  for (const name of shots.filter((shot) => shot.toLowerCase().endsWith('.png')).sort()) {
    files[`screenshots/${name}`] = await readFile(join(folder, 'screenshots', name))
  }
  const zip = packPackage(files)
  const opened = openPackage(zip)
  if (opened.problems.length > 0) {
    return { ok: false, report: { ...report, problems: opened.problems } }
  }
  const { id, version } = report.widget.manifest
  return {
    ok: true,
    zip,
    sha256: opened.sha256,
    fileName: `${id}-${version}.zip`,
    widget: report.widget,
  }
}
