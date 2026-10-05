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
 *   4. Type-check and build a Vue + Vite app using the published editor,
 *      CodeMirror engine, renderer and stylesheets.
 *
 * Run: `npm run test:consumer` (also invoked from CI).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
function assertExportTargetsExist(pkg, packageDir) {
  const missing = []
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key.includes('*')) continue
    const targets = typeof value === 'string' ? [value] : Object.values(value)
    for (const target of targets) {
      // `types` may point at a .ts source that ships alongside the runtime .js.
      const relative = target.replace(/^\.\//, '')
      if (!existsSync(join(packageDir, relative))) missing.push(`${key} -> ${target}`)
    }
  }
  if (missing.length) throw new Error(`missing export targets: ${missing.join(', ')}`)
  return `${Object.keys(pkg.exports).length} keys`
}

console.log('consumer smoke test')

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------
// Build both the engine and the compiled Vue editor before packing.
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

  // -------------------------------------------------------------------------
  // Install into an isolated project
  // -------------------------------------------------------------------------
  const appDir = join(workDir, 'app')
  mkdirSync(appDir, { recursive: true })
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2))
	// The editor needs the optional CodeMirror peers; use the versions tested
	// by this repository instead of letting the consumer drift to latest.
	const consumerDependencies = ['vue', 'vite', '@vitejs/plugin-vue', 'typescript',
		...Object.keys(pkg.peerDependencies).filter((name) => /^@(codemirror|lezer)\//.test(name)),
	].map((name) => `${name}@${pkg.devDependencies[name] ?? pkg.peerDependencies[name]}`)
	run('npm', ['install', tarballPath, ...consumerDependencies, '--no-audit', '--no-fund'], {
		cwd: appDir,
	})

  const installed = join(appDir, 'node_modules', 'nexusdown')
  step('package installed', () => {
    if (!existsSync(installed)) throw new Error('node_modules/nexusdown missing')
    return installed.replace(workDir, '<tmp>')
  })

	step('every export target ships in the package', () => {
		const installedPkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
		return assertExportTargetsExist(installedPkg, installed)
	})

  // -------------------------------------------------------------------------
  // Resolution: plain Node must resolve the subpaths (this is what broke before)
  // -------------------------------------------------------------------------
  step('require.resolve() finds every documented subpath', () => {
    // Export keys are "./cm" style; consumers import "nexusdown/cm".
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

	for (const format of ['esm', 'cjs']) {
		step(`engine and renderer load in bare Node (${format})`, () => {
			const imports = format === 'esm'
				? "const engine = await import('nexusdown'); const cm = await import('nexusdown/cm'); const renderer = await import('nexusdown/render');"
				: "const engine = require('nexusdown'); const cm = require('nexusdown/cm'); const renderer = require('nexusdown/render');"
			const script = `${imports}
				for (const api of [engine, cm]) {
					for (const name of ['nexusdown', 'mountEditor', 'setEditorValue']) {
						if (typeof api[name] !== 'function') throw new Error('Missing ' + name);
					}
				}
				for (const api of [engine, renderer]) {
					if (!api.renderMarkdown('**consumer-ok**').includes('<strong>consumer-ok</strong>')) {
						throw new Error('Renderer output is incorrect');
					}
				}
				console.log('ok');
			`
			run(process.execPath, ['--input-type=' + (format === 'esm' ? 'module' : 'commonjs'), '-e', script], { cwd: appDir })
			return 'public functions and Markdown rendering verified'
		})
	}

  // -------------------------------------------------------------------------
  // Real consumer: checks published declarations, compiled editor and styles.
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
				"import { createApp, h } from 'vue'",
				"import { NexusdownEditor, NexusdownToolbar } from 'nexusdown/editor'",
				"import { nexusdown, mountEditor } from 'nexusdown/cm'",
				"import { renderMarkdown } from 'nexusdown/render'",
				"import 'nexusdown/editor/style.css'",
				"import 'nexusdown/cm/theme.css'",
				"import 'nexusdown/dialect.css'",
				"const html: string = renderMarkdown('**consumer-ok**')",
				'console.log(html, nexusdown(), mountEditor, NexusdownToolbar)',
				"createApp({ render: () => h(NexusdownEditor, { modelValue: '# Hello' }) }).mount('#app')",
      ].join('\n'),
    )
		step('published declarations type-check in a consumer', () => {
			run(process.execPath, [join(appDir, 'node_modules/typescript/bin/tsc'),
				'--noEmit', '--strict', '--skipLibCheck', '--module', 'ESNext',
				'--moduleResolution', 'bundler', '--target', 'ES2022', 'src/main.ts',
			], { cwd: appDir })
			return 'editor, engine and renderer types resolved'
		})
		run(process.execPath, [join(appDir, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'], { cwd: appDir })

    const assets = join(appDir, 'dist', 'assets')
    if (!existsSync(assets)) throw new Error('no dist/assets produced')
    const emitted = readFileSync(join(appDir, 'dist', 'index.html'), 'utf8')
    if (!/assets\/.*\.js/.test(emitted)) throw new Error('bundle not referenced from index.html')
		if (!readdirSync(assets).some((name) => name.endsWith('.css'))) throw new Error('no stylesheet emitted')
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
