/**
 * Guards the packaging contract: every file that `package.json#exports` points
 * at must actually exist in the repo.
 *
 * Why this exists: nexusdown is consumed straight from git as well as from a
 * packed tarball, and `dist/` is deliberately not committed. An `exports` entry
 * aimed at a build artefact therefore resolves to nothing until the package has
 * been built. That is exactly how `nexusdown/style.css` and `nexusdown/core`
 * once shipped broken — consumers got an unstyled editor or `MODULE_NOT_FOUND`
 * — while every check *inside* the repo still passed, because the repo's tests
 * import `src/` directly and never resolve the published entry points.
 *
 * The check only asserts the declared targets exist and
 * nothing more. It does not bundle, import or type-check them, so it stays fast
 * enough to run on every `verify`.
 *
 * Run: `node scripts/check-exports.mjs` (wired into `pnpm run verify`, after the
 * build, so the emitted `dist/` files are present).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const missing = []
const checked = []

/**
 * Verify one target path. `condition` is only used to label the report, so a
 * nested condition is reported as e.g. `types.import`.
 */
function checkTarget(key, condition, target) {
  if (typeof target !== 'string') return
  const relative = target.replace(/^\.\//, '')

  if (relative.includes('*')) {
    // A wildcard maps a whole directory (e.g. "./vue/*" -> "./src/vue/*").
    // The individual files cannot be enumerated ahead of time, so assert the
    // directory the pattern expands into exists instead.
    const base = relative.slice(0, relative.indexOf('*'))
    const baseDir = (base.endsWith('/') ? base.slice(0, -1) : dirname(base)) || '.'
    const absolute = join(root, baseDir)
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      missing.push(`${key} [${condition}] -> ${target}  (base directory "${baseDir}" is missing)`)
      return
    }
    checked.push(`${key} [${condition}] -> ${baseDir}/`)
    return
  }

  const absolute = join(root, relative)
  if (!existsSync(absolute)) {
    missing.push(`${key} [${condition}] -> ${target}`)
    return
  }
  checked.push(`${key} [${condition}] -> ${relative}`)
}

function checkConditions(key, value, condition = '') {
  if (typeof value === 'string') {
    checkTarget(key, condition || 'default', value)
    return
  }
  if (value && typeof value === 'object') {
    for (const [nestedCondition, target] of Object.entries(value)) {
      checkConditions(key, target, condition ? `${condition}.${nestedCondition}` : nestedCondition)
    }
  }
}

for (const [key, value] of Object.entries(pkg.exports ?? {})) {
  checkConditions(key, value)
}

if (missing.length > 0) {
  console.error(`check-exports: ${missing.length} export target(s) do not exist:`)
  for (const entry of missing) console.error(`  - ${entry}`)
  console.error('')
  console.error('Build the package (`pnpm run build`) or fix the paths in package.json#exports.')
  process.exit(1)
}

console.log(`check-exports: ${checked.length} export target(s) verified`)
