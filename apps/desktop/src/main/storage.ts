import { readFile, rename, writeFile } from 'node:fs/promises'

/** A small text file the app keeps between runs (the board, the paired phones). */
export interface TextStorage {
  /** The saved text, or null when nothing was saved yet. */
  read(): Promise<string | null>
  write(text: string): Promise<void>
}

/** Keeps text in a file, replaced whole on each save so it is never half-written. */
export function fileStorage(path: string): TextStorage {
  return {
    read: async () => {
      try {
        return await readFile(path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    write: async (text) => {
      const temporary = `${path}.tmp`
      await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, path)
    },
  }
}
