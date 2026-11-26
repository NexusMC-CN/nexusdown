import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// A require branch that resolves to an ESM .d.ts makes these .cts imports
// fail with TS1479. Compile real callers so missing/any declarations fail too.
const engineConsumer = `
import { nexusdown, renderMarkdown as renderFromRoot } from '@nexusmc-cn/nexusdown'
import { nexusdown as cm, mountEditor, observeEditorUpdates, type Extension } from '@nexusmc-cn/nexusdown/cm'
import { renderMarkdown } from '@nexusmc-cn/nexusdown/render'
import { mountEmbeds } from '@nexusmc-cn/nexusdown/embed'
import { mountImageLightbox, type ImageLightboxOptions } from '@nexusmc-cn/nexusdown/lightbox'

const html: string = renderMarkdown('**consumer**')
const rootHtml: string = renderFromRoot('**consumer**')
const lightboxOptions: ImageLightboxOptions = { onOpen: (images, index) => console.log(images[index]?.url) }
const disposeEmbeds: () => void = mountEmbeds(document.createElement('div'))
const disposeLightbox: () => void = mountImageLightbox(document.createElement('div'), lightboxOptions)
const extensions: Extension = []
const mountOptions: Parameters<typeof mountEditor>[0] = {
  parent: document.createElement('div'), doc: '', extensions,
  scrollMargins: view => ({ top: view.state.readOnly ? 0 : 64 }),
}
const observe: typeof observeEditorUpdates = (view, listener) => observeEditorUpdates(view, listener)
console.log(html, rootHtml, nexusdown(), cm(), disposeEmbeds, disposeLightbox, mountOptions, observe)

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
import { NexusdownEditor, NexusdownToolbar, defaultToolbarGroups, type ToolbarConfig, type ToolbarActionError } from '@nexusmc-cn/nexusdown/editor'
const toolbar: ToolbarConfig = { groups: [...defaultToolbarGroups, {
  id: 'host-tools', label: 'Host tools', display: 'dropdown', items: [{
    id: 'host-insert', label: 'Insert host text',
    disabled: ({view}) => view.state.readOnly,
    async run({view, signal, runCommand}) {
      await Promise.resolve()
      if (signal.aborted) return
      runCommand(current => { current.dispatch({ changes: { from: current.state.selection.main.head, insert: 'host' } }); return true })
      console.log(view.state.doc.length)
    },
  }],
}] }
const editorProps: InstanceType<typeof NexusdownEditor>['$props'] = {
  modelValue: '# Consumer', toolbar, extensions: [], previewPlugins: [md => { md.set({ breaks: true }) }],
  scrollMode: 'page', stickyToolbar: true, toolbarOffset: 64,
  'onAction-error': (failure: ToolbarActionError) => console.log(failure.id, failure.error),
}
const toolbarProps: InstanceType<typeof NexusdownToolbar>['$props'] = { view: null, config: toolbar }
console.log(editorProps, toolbarProps)
// @ts-expect-error The Vue editor value must be a string.
const invalidEditorProps: InstanceType<typeof NexusdownEditor>['$props'] = { modelValue: 42 }
console.log(invalidEditorProps)
// @ts-expect-error Only the supported scrolling modes are accepted.
const invalidScroll: InstanceType<typeof NexusdownEditor>['$props'] = {modelValue: '', scrollMode: 'floating'}
// @ts-expect-error Built-in actions are a finite set of stable IDs.
const invalidToolbar: ToolbarConfig = {groups: [{id:'invalid', label:'Invalid', items:['unknown-action']}]}
console.log(invalidScroll, invalidToolbar)
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
