/**
 * Consumer smoke test: verifies that the *packed* package actually works for a
 * real consumer, not just inside this repo.
 *
 * This exists because the repo's own test suite cannot catch packaging bugs: it
 * imports `../../src/...` directly, so a broken `exports` map, a missing file in
 * `files[]`, or a stale generated shim all pass locally while every real install
 * fails. That is exactly how `nexusdown/vue` once shipped unresolvable.
 *
 * Steps:
 *   1. `npm pack` the package.
 *   2. Install the tarball into a throwaway project outside this repo.
 *   3. Assert every documented subpath resolves.
 *   4. Build a minimal Vue + Vite app that imports the public entry, proving the
 *      SFCs compile in a consumer bundler with the consumer's own Vue.
 *
 * Run: `npm run test:consumer` (also invoked from CI).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const steps = []

function step(name, fn) {
  try {
    const detail = fn()
    steps.push({ name, ok: true, detail })
    console.log(`  ok    ${name}${detail ? ` - ${detail}` : ''}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    steps.push({ name, ok: false, detail: message })
    failures.push(`${name}: ${message}`)
    console.error(`  FAIL  ${name} - ${message}`)
  }
}

/**
 * Run a command, returning stdout. Throws with stderr attached on non-zero exit.
 *
 * Windows needs a shell to launch `npm`/`npx`, which are `.cmd` shims, but a
 * shell re-parses the argument list and breaks executable paths containing
 * spaces (e.g. `D:\Program Files\nodejs\node.exe`). So only use a shell for the
 * package-manager shims and invoke `node` directly.
 */
function run(command, args, options = {}) {
  const needsShell = process.platform === 'win32' && /^(npm|npx)(\.cmd)?$/.test(command)
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: needsShell,
    ...options,
  })
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} could not start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const outText = result.stdout ? `\nstdout:\n${result.stdout}` : ''
    const errText = result.stderr ? `\nstderr:\n${result.stderr}` : ''
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${outText}${errText}`)
  }
  return result.stdout ?? ''
}

/** Subpaths every consumer is entitled to import, per package.json#exports. */
function readDocumentedSubpaths() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const subpaths = Object.keys(pkg.exports).filter((key) => !key.includes('*'))
  return { pkg, subpaths }
}

/** Assert each export key maps to a file that actually exists in the tarball. */
function assertExportTargetsExist(pkg) {
  const missing = []
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key.includes('*')) continue
    const targets = typeof value === 'string' ? [value] : Object.values(value)
    for (const target of targets) {
      // `types` may point at a .ts source that ships alongside the runtime .js.
      const relative = target.replace(/^\.\//, '')
      if (!existsSync(join(root, relative))) missing.push(`${key} -> ${target}`)
    }
  }
  if (missing.length) throw new Error(`missing export targets: ${missing.join(', ')}`)
  return `${Object.keys(pkg.exports).length} keys`
}

console.log('consumer smoke test')

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------
// The build must run first so `dist/` and the generated shim are current.
run('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

const workDir = mkdtempSync(join(tmpdir(), 'nexusdown-consumer-'))
let tarballName
try {
  const packOutput = run('npm', ['pack', '--silent', '--pack-destination', workDir], { cwd: root })
  tarballName = packOutput.trim().split(/\r?\n/).filter(Boolean).pop()
  if (!tarballName) throw new Error('npm pack produced no filename')
  const tarballPath = join(workDir, tarballName)
  if (!existsSync(tarballPath)) throw new Error(`tarball not found at ${tarballPath}`)

  const { pkg, subpaths } = readDocumentedSubpaths()

  step('every export target exists in the repo', () => assertExportTargetsExist(pkg))

  // -------------------------------------------------------------------------
  // Install into an isolated project
  // -------------------------------------------------------------------------
  const appDir = join(workDir, 'app')
  mkdirSync(appDir, { recursive: true })
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2))
  run('npm', ['install', tarballPath, 'vue', 'vite', '@vitejs/plugin-vue', '--silent', '--no-audit', '--no-fund'], {
    cwd: appDir,
  })

  const installed = join(appDir, 'node_modules', 'nexusdown')
  step('package installed', () => {
    if (!existsSync(installed)) throw new Error('node_modules/nexusdown missing')
    return installed.replace(workDir, '<tmp>')
  })

  // Files that must ship for the documented usage to work.
  for (const relative of [
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/core/index.js',
    'dist/core/index.cjs',
    'dist/style.css',
    'src/vue/entry.js',
    'src/vue/entry.ts',
    'src/vue/NexusdownEditor.vue',
  ]) {
    step(`ships ${relative}`, () => {
      if (!existsSync(join(installed, relative))) throw new Error(`missing from tarball`)
      return 'present'
    })
  }

  // -------------------------------------------------------------------------
  // Resolution: plain Node must resolve the subpaths (this is what broke before)
  // -------------------------------------------------------------------------
  step('require.resolve() finds every documented subpath', () => {
    // Export keys are "./core" style; consumers import "nexusdown/core".
    const specifiers = subpaths.map((key) => (key === '.' ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, '')}`))
    const script = `
      const results = ${JSON.stringify(specifiers)}.map((s) => {
        try { require.resolve(s); return s + '=ok' } catch (e) { return s + '=' + e.code }
      })
      console.log(JSON.stringify(results))
    `
    const output = run(process.execPath, ['-e', script], { cwd: appDir }).trim()
    const parsed = JSON.parse(output)
    const bad = parsed.filter((entry) => !entry.endsWith('=ok'))
    if (bad.length) throw new Error(`unresolvable: ${bad.join(', ')}`)
    return `${parsed.length} subpaths`
  })

  step('pre-compiled ./core loads in bare Node', () => {
    const script = `
      import('nexusdown/core').then((m) => {
        const needed = ['createNexusdownEditor', 'createDefaultToolbarItems']
        const missing = needed.filter((n) => typeof m[n] !== 'function')
        if (missing.length) { console.error('missing exports: ' + missing); process.exit(1) }
        console.log('ok')
      }).catch((e) => { console.error(e.code || e.message); process.exit(1) })
    `
    const output = run(process.execPath, ['--input-type=module', '-e', script], { cwd: appDir }).trim()
    if (!output.includes('ok')) throw new Error(`unexpected output: ${output}`)
    return 'createNexusdownEditor present'
  })

  step('published style.css contains the responsive/touch layer', () => {
    const css = readFileSync(join(installed, 'dist', 'style.css'), 'utf8')
    for (const token of ['@media (pointer: coarse)', '@media (max-width: 760px)', 'env(safe-area-inset-bottom)']) {
      if (!css.includes(token)) throw new Error(`dist/style.css is missing ${token}`)
    }
    return 'mobile rules present'
  })

  step('published types declare the documented API', () => {
    // tsup splits declarations into shared chunks and leaves `dist/core/index.d.ts`
    // as a re-export barrel, so grepping that one file gives false negatives.
    // Concatenate every declaration file before matching.
    const distDir = join(installed, 'dist')
    const collect = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) return collect(full)
        return /\.d\.(ts|cts|mts)$/.test(entry.name) ? [readFileSync(full, 'utf8')] : []
      })
    const declarations = collect(distDir).join('\n')

    const expected = {
      'getText(): string': /getText\(\):\s*string/,
      'insertMarkdown command': /insertMarkdown:\s*\(/,
      'setTextAlign command': /setTextAlign:\s*\(/,
      'indent command': /indent:\s*\(\)/,
      'outdent command': /outdent:\s*\(\)/,
      'TextAlignment type': /TextAlignment\s*=/,
      "PasteMode includes 'markdown'": /PasteMode\s*=[^;]*markdown/,
    }
    const missing = Object.entries(expected)
      .filter(([, pattern]) => !pattern.test(declarations))
      .map(([name]) => name)
    if (missing.length) throw new Error(`missing from published types: ${missing.join(', ')}`)
    return `${Object.keys(expected).length} declarations`
  })

  step('published entry.js matches its TypeScript source', () => {
    // A stale shim would mean the generated file was committed without rebuilding.
    const shim = readFileSync(join(installed, 'src/vue/entry.js'), 'utf8')
    if (/\bas\s+DefineComponent\b/.test(shim)) throw new Error('shim still contains TypeScript-only syntax')
    if (/^\s*(import|export)\s+type\s/m.test(shim)) throw new Error('shim still contains type-only statements')
    return 'shim is plain JavaScript'
  })

  // -------------------------------------------------------------------------
  // Real bundler build: proves SFCs compile with the consumer's Vue
  // -------------------------------------------------------------------------
  step('Vite consumer app builds and imports the public entry', () => {
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(
      join(appDir, 'index.html'),
      '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>',
    )
    writeFileSync(
      join(appDir, 'vite.config.mjs'),
      "import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\nexport default defineConfig({ plugins: [vue()] })\n",
    )
    writeFileSync(
      join(appDir, 'src', 'main.ts'),
      [
        "import NexusdownEditor, { useNexusdownTheme } from 'nexusdown/vue'",
        "import { createNexusdownEditor } from 'nexusdown/core'",
        "import 'nexusdown/style.css'",
        'if (typeof NexusdownEditor !== "object" && typeof NexusdownEditor !== "function") {',
        '  throw new Error("default export is not a component")',
        '}',
        'if (typeof useNexusdownTheme !== "function") throw new Error("missing useNexusdownTheme")',
        'if (typeof createNexusdownEditor !== "function") throw new Error("missing createNexusdownEditor")',
        'console.log("consumer-ok")',
      ].join('\n'),
    )
    run('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: appDir })

    const assets = join(appDir, 'dist', 'assets')
    if (!existsSync(assets)) throw new Error('no dist/assets produced')
    const emitted = readFileSync(join(appDir, 'dist', 'index.html'), 'utf8')
    if (!/assets\/.*\.js/.test(emitted)) throw new Error('bundle not referenced from index.html')
    return 'bundle emitted'
  })

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('')
  if (failures.length) {
    console.error(`consumer smoke test FAILED (${failures.length} of ${steps.length} checks)`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`consumer smoke test passed (${steps.length} checks)`)
  }
} finally {
  // Keep the temp dir on failure so the failure can be inspected.
  if (!failures.length) rmSync(workDir, { recursive: true, force: true })
  else console.error(`artifacts kept for inspection: ${workDir}`)
}
