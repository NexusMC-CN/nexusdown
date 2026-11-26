import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = mkdtempSync(join(tmpdir(), 'nexusdown-exports-'))
try {
  mkdirSync(join(fixtureDir, 'scripts'))
  copyFileSync(join(root, 'scripts/check-exports.mjs'), join(fixtureDir, 'scripts/check-exports.mjs'))
  writeFileSync(join(fixtureDir, 'package.json'), JSON.stringify({
    exports: {
      '.': {
        import: { node: { types: './index.d.ts', default: './index.js' } },
        require: { node: { types: './index.d.cts', default: './index.cjs' } },
      },
      './theme.css': './theme.css',
    },
  }))
  for (const file of ['index.d.ts', 'index.js', 'index.d.cts', 'index.cjs', 'theme.css']) {
    writeFileSync(join(fixtureDir, file), '')
  }
  const run = () => spawnSync(process.execPath, [join(fixtureDir, 'scripts/check-exports.mjs')], { encoding: 'utf8' })
  const present = run()
  assert.equal(present.status, 0, present.stderr)

  // Removing a deeply nested declaration must fail the real packaging guard.
  unlinkSync(join(fixtureDir, 'index.d.cts'))
  const missing = run()
  assert.equal(missing.status, 1, 'Missing nested CommonJS declaration was accepted')
  assert.match(missing.stderr, /require\.node\.types.*index\.d\.cts/)
  console.log('check-exports regression: existing targets pass; missing nested CommonJS declaration fails')
} finally {
  rmSync(fixtureDir, { recursive: true, force: true })
}
