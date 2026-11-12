import { parseEmbedUrl, embedTitle } from '../render/features/embed.js'
export type { EmbedSpec, EmbedProvider, EmbedKind } from '../render/features/embed.js'

/** Install one delegated listener. No third-party frame exists before a real click. */
export function mountEmbeds(root: HTMLElement): () => void {
  const frames = new WeakSet<HTMLIFrameElement>()
  const onClick = (event: Event) => {
    if (!event.isTrusted) return
    const target = event.target as Element | null
    const button = target?.closest?.('[data-nd-embed-load]')
    const block = button?.closest<HTMLElement>('.nd-embed')
    if (!button || !block || !root.contains(block) || block.querySelector('iframe')) return
    const spec = parseEmbedUrl(block.dataset.ndEmbedCanonical ?? block.dataset.ndEmbedUrl ?? '')
    if (!spec) return
    event.preventDefault()
    const frame = root.ownerDocument.createElement('iframe')
    frame.className = 'nd-embed__frame'
    frame.title = embedTitle(spec)
    frame.src = spec.src.startsWith('//') ? 'https:' + spec.src : spec.src
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation')
    frame.setAttribute('allow', 'fullscreen')
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    frame.loading = 'lazy'
    frames.add(frame)
    block.append(frame)
    button.setAttribute('hidden', '')
  }
  root.addEventListener('click', onClick)
  return () => {
    root.removeEventListener('click', onClick)
    for (const frame of root.querySelectorAll('iframe')) {
      if (!frames.has(frame)) continue
      frame.closest('.nd-embed')?.querySelector('[data-nd-embed-load]')?.removeAttribute('hidden')
      frame.remove()
    }
  }
}
