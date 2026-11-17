import { openViewer, type Viewer } from './viewer.js'

/** A Markdown content image. Hosts may supply a separate original URL. */
export interface LightboxImage {
  url: string
  full?: string | null
  title?: string | null
}
export interface ImageLightboxOptions {
  /** Providing this callback delegates all viewing UI to the host. */
  onOpen?: (images: LightboxImage[], index: number) => void
}

interface AttributeChange {
  name: string
  before: string | null
  applied: string
}
interface EnhancedImage {
  attributes: AttributeChange[]
  cursor: string
  owners: Set<HTMLElement>
}
interface ImageEntry {
  element: HTMLImageElement
  image: LightboxImage
}

interface MountedRoot {
  dispose: () => void
  refresh: () => ImageEntry[]
}

const mounts = new WeakMap<HTMLElement, MountedRoot>()
const enhancements = new WeakMap<HTMLImageElement, EnhancedImage>()
const EXCLUDED = 'a,button,[role="link"],.nd-card,.nd-link-card,.nd-mention-card,.nd-embed,.cm-editor,[contenteditable]:not([contenteditable="false"])'

function imageUrl(value: string | null, image: HTMLImageElement): string | null {
  if (!value?.trim()) return null
  const raw = value.trim()
  if ([...raw].some(character => 0x20 > character.charCodeAt(0) || character.charCodeAt(0) === 0x7f)) return null
  try {
    const protocol = new URL(raw, image.ownerDocument.baseURI).protocol
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'blob:') return raw
    const lower = raw.toLowerCase()
    if (protocol === 'data:' && ['png', 'gif', 'jpeg', 'webp'].some(type => lower.startsWith('data:image/' + type + ';'))) return raw
  } catch {
    // Invalid sources remain ordinary images.
  }
  return null
}

function entries(root: HTMLElement): ImageEntry[] {
  const result: ImageEntry[] = []
  for (const element of root.querySelectorAll<HTMLImageElement>('img[data-nd-image]')) {
    if (element.closest(EXCLUDED)) continue
    let owner: HTMLElement | null = element.parentElement
    while (owner && !mounts.has(owner)) owner = owner.parentElement
    if (owner !== root) continue
    const url = imageUrl(element.getAttribute('src'), element)
    if (!url) continue
    const full = imageUrl(element.getAttribute('data-nd-full'), element)
    result.push({
      element,
      image: {
        url,
        ...(full ? { full } : {}),
        title: element.getAttribute('title') || element.getAttribute('alt') || '',
      },
    })
  }
  return result
}

function sameEntries(first: ImageEntry[], second: ImageEntry[]): boolean {
  return first.length === second.length && first.every((entry, index) => {
    const other = second[index]!
    return entry.element === other.element && entry.image.url === other.image.url &&
      entry.image.full === other.image.full && entry.image.title === other.image.title
  })
}

function refreshAncestors(root: HTMLElement): void {
  let ancestor = root.parentElement
  while (ancestor) {
    mounts.get(ancestor)?.refresh()
    ancestor = ancestor.parentElement
  }
}

/**
 * Enhance only marked Markdown images inside root. Each root has one live mount.
 * Replacing a mount disposes its predecessor; an old cleanup cannot remove a new mount.
 * The returned function restores this mount's attributes and closes its default viewer.
 */
export function mountImageLightbox(root: HTMLElement, options?: ImageLightboxOptions): () => void {
  mounts.get(root)?.dispose()
  let active = true
  let viewer: Viewer | null = null
  let viewedEntries: ImageEntry[] | null = null
  const enhanced = new Map<HTMLImageElement, EnhancedImage>()

  function restore(image: HTMLImageElement, saved: EnhancedImage): void {
    for (const attribute of saved.attributes) {
      if (image.getAttribute(attribute.name) !== attribute.applied) continue
      if (attribute.before === null) image.removeAttribute(attribute.name)
      else image.setAttribute(attribute.name, attribute.before)
    }
    if (image.style.cursor === 'zoom-in') image.style.cursor = saved.cursor
  }

  function release(image: HTMLImageElement, saved: EnhancedImage): void {
    enhanced.delete(image)
    saved.owners.delete(root)
    if (saved.owners.size > 0) return
    restore(image, saved)
    enhancements.delete(image)
  }

  function refresh(): ImageEntry[] {
    const current = entries(root)
    const currentImages = new Set(current.map(entry => entry.element))
    for (const [image, saved] of enhanced) {
      if (currentImages.has(image)) continue
      release(image, saved)
    }
    for (const { element: image, image: data } of current) {
      let saved = enhancements.get(image)
      if (!saved) {
        saved = {
          attributes: [],
          cursor: image.style.cursor,
          owners: new Set<HTMLElement>(),
        }
        for (const [name, value] of [
          ['tabindex', '0'],
          ['role', 'button'],
          ['aria-label', data.title ? '查看大图：' + data.title : '查看大图'],
        ]) {
          if (image.hasAttribute(name!)) continue
          saved.attributes.push({ name: name!, before: null, applied: value! })
          image.setAttribute(name!, value!)
        }
        image.style.cursor = 'zoom-in'
        enhancements.set(image, saved)
      }
      const label = saved.attributes.find(attribute => attribute.name === 'aria-label')
      if (label && image.getAttribute(label.name) === label.applied) {
        const value = data.title ? '查看大图：' + data.title : '查看大图'
        if (value !== label.applied) {
          image.setAttribute(label.name, value)
          label.applied = value
        }
      }
      saved.owners.add(root)
      enhanced.set(image, saved)
    }
    if (viewedEntries && !sameEntries(viewedEntries, current)) {
      viewer?.close()
      viewer = null
      viewedEntries = null
    }
    return current
  }

  function activate(target: EventTarget | null, event: Event): void {
    if (!active || event.defaultPrevented) return
    const element = target as Element | null
    if (!element || element.tagName !== 'IMG') return
    const current = refresh()
    const index = current.findIndex(entry => entry.element === element)
    if (index === -1) return
    event.preventDefault()
    const images = current.map(entry => ({ ...entry.image }))
    if (options?.onOpen) {
      options.onOpen(images, index)
      return
    }
    viewer?.close(false)
    viewedEntries = current
    viewer = openViewer(root.ownerDocument, images, index, element as HTMLImageElement, () => {
      viewer = null
      viewedEntries = null
    })
  }

  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    activate(event.target, event)
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    activate(event.target, event)
  }
  const Observer = root.ownerDocument.defaultView?.MutationObserver
  const observer = Observer ? new Observer(() => { if (active) refresh() }) : null

  function dispose(): void {
    if (!active) return
    active = false
    observer?.disconnect()
    root.removeEventListener('click', onClick)
    root.removeEventListener('keydown', onKey)
    viewer?.close()
    viewer = null
    viewedEntries = null
    if (mounts.get(root)?.dispose === dispose) mounts.delete(root)
    for (const [image, saved] of enhanced) release(image, saved)
    enhanced.clear()
    refreshAncestors(root)
  }

  mounts.set(root, { dispose, refresh })
  refresh()
  root.addEventListener('click', onClick)
  root.addEventListener('keydown', onKey)
  observer?.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'alt', 'title', 'data-nd-image', 'data-nd-full', 'href', 'contenteditable', 'class'],
  })
  refreshAncestors(root)
  return dispose
}
