import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// A require branch that resolves to an ESM .d.ts makes these .cts imports
// fail with TS1479. Compile real callers so missing/any declarations fail too.
const engineConsumer = `
import { nexusdown, renderMarkdown as renderFromRoot } from '@nexusmc-cn/nexusdown'
import { nexusdown as cm } from '@nexusmc-cn/nexusdown/cm'
import { renderMarkdown } from '@nexusmc-cn/nexusdown/render'
import { mountEmbeds } from '@nexusmc-cn/nexusdown/embed'
import { mountImageLightbox, type ImageLightboxOptions } from '@nexusmc-cn/nexusdown/lightbox'

const html: string = renderMarkdown('**consumer**')
const rootHtml: string = renderFromRoot('**consumer**')
const lightboxOptions: ImageLightboxOptions = { onOpen: (images, index) => console.log(images[index]?.url) }
const disposeEmbeds: () => void = mountEmbeds(document.createElement('div'))
const disposeLightbox: () => void = mountImageLightbox(document.createElement('div'), lightboxOptions)
console.log(html, rootHtml, nexusdown(), cm(), disposeEmbeds, disposeLightbox)

// @ts-expect-error Markdown source must be a string.
renderFromRoot(42)
// @ts-expect-error CodeMirror configuration must be an options object.
cm(42)
// @ts-expect-error Markdown source must be a string.
renderMarkdown(42)
// @ts-expect-error Embed mounting requires an element.
mountEmbeds(42)
// @ts-expect-error Lightbox mounting requires an element.
mountImageLightbox(42)
`

const editorConsumer = `
import { NexusdownEditor, NexusdownToolbar } from '@nexusmc-cn/nexusdown/editor'
const editorProps: InstanceType<typeof NexusdownEditor>['$props'] = { modelValue: '# Consumer' }
const toolbarProps: InstanceType<typeof NexusdownToolbar>['$props'] = { view: null }
console.log(editorProps, toolbarProps)
// @ts-expect-error The Vue editor value must be a string.
const invalidEditorProps: InstanceType<typeof NexusdownEditor>['$props'] = { modelValue: 42 }
console.log(invalidEditorProps)
`

/** Compile against either this built checkout or an installed packed package. */
export function assertTypeScriptConsumers(projectDir, typescriptPath = join(projectDir, 'node_modules/typescript/bin/tsc')) {
  const fixtureParent = projectDir === packageRoot ? join(projectDir, '.superpowers') : projectDir
  mkdirSync(fixtureParent, { recursive: true })
  const fixtureDir = mkdtempSync(join(fixtureParent, 'type-consumers-'))
  try {
    const esm = join(fixtureDir, 'consumer.mts')
    const cjs = join(fixtureDir, 'consumer.cts')
    writeFileSync(esm, engineConsumer + editorConsumer)
    writeFileSync(cjs, engineConsumer)
    const failures = []
    for (const resolution of ['Node16', 'NodeNext']) {
      const result = spawnSync(process.execPath, [typescriptPath,
        '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
        '--module', resolution, '--moduleResolution', resolution, esm, cjs,
      ], { cwd: projectDir, encoding: 'utf8' })
      if (result.error) throw result.error
      if (result.status !== 0) failures.push(`${resolution}:\n${result.stdout}${result.stderr}`)
    }
    if (failures.length) throw new Error(failures.join('\n'))
    return 'ESM and CommonJS types pass Node16 and NodeNext; Vue editor ESM types pass'
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(assertTypeScriptConsumers(packageRoot))
}
