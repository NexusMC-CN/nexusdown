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
 *   1. `pnpm pack` the package.
 *   2. Install the tarball into a throwaway project outside this repo.
 *   3. Assert every documented subpath resolves.
 *   4. Type-check and build a Vue + Vite app using the published editor,
 *      CodeMirror engine, renderer and stylesheets.
 *
 * Run: `pnpm run test:consumer` (also invoked from CI).
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
 * Invoke pnpm's CLI through Node when running as a pnpm script. This preserves
 * version ranges such as ^3.0.0, which Windows cmd would otherwise strip, and
 * paths containing spaces without executing a shell.
 */
function run(command, args, options = {}) {
  if (command === 'pnpm') {
    if (!process.env.npm_execpath || !/[/\\]pnpm\.(?:c?js)$/.test(process.env.npm_execpath)) {
      throw new Error('Run this script with pnpm run test:consumer so it uses the pinned pnpm CLI.')
    }
    args = [process.env.npm_execpath, ...args]
    command = process.execPath
  }
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
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
const workDir = mkdtempSync(join(tmpdir(), 'nexusdown-consumer-'))
let tarballName
try {
  // The package's prepare hook builds before pnpm writes the tarball.
  run('pnpm', ['pack', '--pack-destination', workDir], { cwd: root })
  const tarballs = readdirSync(workDir).filter((name) => name.endsWith('.tgz'))
  if (tarballs.length !== 1) throw new Error(`pnpm pack produced ${tarballs.length} tarballs`)
  tarballName = tarballs[0]
  const tarballPath = join(workDir, tarballName)
  if (!existsSync(tarballPath)) throw new Error(`tarball not found at ${tarballPath}`)

  const { pkg, subpaths } = readDocumentedSubpaths()

  // -------------------------------------------------------------------------
  // Install into an isolated project
  // -------------------------------------------------------------------------
  const appDir = join(workDir, 'app')
  mkdirSync(appDir, { recursive: true })
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module', packageManager: pkg.packageManager }, null, 2))
  writeFileSync(join(appDir, 'pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - esbuild\n')
	// The editor needs the optional CodeMirror peers; use the versions tested
	// by this repository instead of letting the consumer drift to latest.
	const consumerDependencies = ['vue', 'vite', '@vitejs/plugin-vue', 'typescript', 'jsdom',
		...Object.keys(pkg.peerDependencies).filter((name) => /^@(codemirror|lezer)\//.test(name)),
	].map((name) => `${name}@${pkg.devDependencies[name] ?? pkg.peerDependencies[name]}`)
	run('pnpm', ['add', tarballPath, ...consumerDependencies], {
		cwd: appDir,
	})

  const installed = join(appDir, 'node_modules', ...pkg.name.split('/'))
  step('package installed', () => {
    if (!existsSync(installed)) throw new Error(`node_modules/${pkg.name} missing`)
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
    // Export keys are "./cm" style; consumers import "@nexusmc-cn/nexusdown/cm".
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

  step('mixed public entries keep editor diagram and tab IDs isolated', () => {
    const fence = '```mermaid\nflowchart LR\naccTitle: Flow\naccDescr: Start to end\nA[Start] --> B[End]\n```'
    const tabbed = `${fence}\n{tab=First}\n\n${fence}\n{tab=Second}`
    const script = `
      import { JSDOM } from 'jsdom';
      const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
      for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'Text', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
        Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
      }
      const { EditorState } = await import('@codemirror/state');
      const { EditorView } = await import('@codemirror/view');
      const root = await import('@nexusmc-cn/nexusdown');
      const cm = await import('@nexusmc-cn/nexusdown/cm');
      const views = [];
      try {
        for (const source of ${JSON.stringify([fence, tabbed])}) {
          for (const api of [root, cm]) {
            const doc = source + '\\n\\nTail';
            views.push(new EditorView({ parent: document.body, state: EditorState.create({
              doc, selection: { anchor: doc.length }, extensions: [api.nexusdown()],
            }) }));
          }
        }
        const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
        if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Duplicate DOM IDs across bundled entries');
        const first = [...views[2].dom.querySelectorAll('input[type=radio]')];
        const second = [...views[3].dom.querySelectorAll('input[type=radio]')];
        if (first.length !== 2 || second.length !== 2) throw new Error('Missing tab group');
        first[1].click();
        if (!first[1].checked || !second[0].checked) throw new Error('Tab groups interfere across bundled entries');
      } finally {
        for (const view of views) view.destroy();
        dom.window.close();
      }
    `
    run(process.execPath, ['--input-type=module', '-e', script], { cwd: appDir })
    return 'SVG IDs and radio groups stay independent'
  })
	for (const format of ['esm', 'cjs']) {
		step(`engine and renderer load in bare Node (${format})`, () => {
			const imports = format === 'esm'
				? "const engine = await import('@nexusmc-cn/nexusdown'); const cm = await import('@nexusmc-cn/nexusdown/cm'); const renderer = await import('@nexusmc-cn/nexusdown/render');"
				: "const engine = require('@nexusmc-cn/nexusdown'); const cm = require('@nexusmc-cn/nexusdown/cm'); const renderer = require('@nexusmc-cn/nexusdown/render');"
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
					const diagram = api.renderMarkdown(${JSON.stringify('```mermaid\nflowchart LR\nA[Start] --> B[End]\n```')});
					if (!diagram.includes('<svg') || !diagram.includes('Start')) {
						throw new Error('Pele diagram rendering is unavailable');
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
				"import { NexusdownEditor, NexusdownToolbar } from '@nexusmc-cn/nexusdown/editor'",
				"import { nexusdown, mountEditor } from '@nexusmc-cn/nexusdown/cm'",
				"import { renderMarkdown } from '@nexusmc-cn/nexusdown/render'",
				"import '@nexusmc-cn/nexusdown/editor/style.css'",
				"import '@nexusmc-cn/nexusdown/cm/theme.css'",
				"import '@nexusmc-cn/nexusdown/dialect.css'",
				"const html: string = renderMarkdown('**consumer-ok**')",
				'console.log(html, nexusdown(), mountEditor, NexusdownToolbar)',
				"const editorProps: InstanceType<typeof NexusdownEditor>['$props'] = {",
				"  modelValue: '# Hello',",
				"  mathRenderer: { renderToString: (tex: string) => tex },",
				"  mentionCandidates: async () => [{ slug: 'demo', title: 'Demo', kind: 'post' }],",
				"  mentions: new Map(),",
				"  'onUpdate:modelValue': (value: string) => console.log(value),",
				'}',
				"const toolbarProps: InstanceType<typeof NexusdownToolbar>['$props'] = {",
				"  view: null,",
				"  mentionCandidates: editorProps.mentionCandidates,",
				'}',
				'console.log(toolbarProps)',
				"createApp({ render: () => h(NexusdownEditor, editorProps) }).mount('#app')",
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
