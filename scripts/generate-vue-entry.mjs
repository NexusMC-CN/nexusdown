/**
 * Generates the publishable `src/vue/entry.js` shim from the TypeScript source
 * `src/vue/entry.ts`.
 *
 * Why this exists: the entry has to be a `.js` file so that tooling running plain
 * Node (`require.resolve('nexusdown/vue')`, bundler config resolution, CI checks)
 * can resolve the subpath export. Node cannot type-strip files inside
 * node_modules, and a `.ts` subpath target fails `require.resolve` outright. But
 * `.ts` is the source of truth because it is the only form the repo actually
 * type-checks.
 *
 * So: keep one TypeScript source, and strip the type-only syntax to produce the
 * JavaScript shim. Anything the stripper cannot handle fails the build loudly
 * rather than emitting a broken file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../src/vue/entry.ts')
const target = resolve(here, '../src/vue/entry.js')

const banner = `/*
 * GENERATED FILE - DO NOT EDIT.
 * Produced from ./entry.ts by scripts/generate-vue-entry.mjs (runs on \`npm run build\`).
 * Edit entry.ts instead; this shim exists only so plain-Node tooling can resolve
 * the \`nexusdown/vue\` subpath export.
 */
`

const input = readFileSync(source, 'utf8')
const lines = input.split(/\r?\n/)
const out = []

for (const line of lines) {
  // Drop type-only imports/exports; they carry no runtime meaning.
  if (/^\s*import\s+type\s/.test(line)) continue
  if (/^\s*export\s+type\s/.test(line)) continue
  // Drop the `as DefineComponent<...>` cast, keeping the value binding.
  const cast = /^const Editor = NexusdownEditor as .*$/.exec(line)
  if (cast) {
    out.push('const Editor = NexusdownEditor')
    continue
  }
  out.push(line)
}

let body = out.join('\n')

// A non-null assertion on a value import would not survive stripping; fail loudly
// rather than shipping something broken.
if (/\bas\s+(const|unknown|any)\b/.test(body) || /<[A-Za-z][^>]*>\(/.test(body)) {
  throw new Error(
    'generate-vue-entry: found TypeScript syntax the stripper does not handle. ' +
      'Extend scripts/generate-vue-entry.mjs instead of weakening this check.',
  )
}

body = body.replace(/\n{3,}/g, '\n\n').trim()
writeFileSync(target, `${banner}${body}\n`, 'utf8')

console.log(`generate-vue-entry: wrote ${target.replace(here, '.')}`)
