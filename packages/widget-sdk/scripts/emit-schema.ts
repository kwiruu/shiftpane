// Writes schema/widget-manifest.schema.json from the zod manifest schema.
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { manifestSchema } from '../src/manifest.ts'

const schema = z.toJSONSchema(manifestSchema, { io: 'input', unrepresentable: 'any' })
const out = new URL('../schema/widget-manifest.schema.json', import.meta.url)
writeFileSync(
  out,
  `${JSON.stringify({ ...schema, title: 'ShiftPane widget manifest' }, null, 2)}\n`,
)
console.info(`wrote ${out.pathname}`)
