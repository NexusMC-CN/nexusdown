import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Reactive visible-viewport metrics for floating UI positioning.
 *
 * `window.innerWidth/innerHeight` do not reflect the area actually visible once
 * a soft keyboard opens or mobile browser chrome collapses, and iOS often does
 * not fire `window.resize` for keyboard transitions at all. `visualViewport` is
 * the only reliable signal there, so listening to it (in addition to `resize`
 * and `scroll`) keeps anchored dropdowns from detaching on phones.
 *
 * The offset fields let callers convert layout-viewport coordinates (which is
 * what `getBoundingClientRect()` returns) into visible-viewport coordinates.
 */
export interface NexusdownViewport {
  /** Visible width in CSS px. */
  width: number
  /** Visible height in CSS px. */
  height: number
  /** Horizontal scroll offset of the visual viewport within the layout viewport. */
  offsetLeft: number
  /** Vertical scroll offset of the visual viewport within the layout viewport. */
  offsetTop: number
}

function readViewport(): NexusdownViewport {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0 }
  }
  const viewport = window.visualViewport
  if (viewport) {
    return {
      width: viewport.width,
      height: viewport.height,
      offsetLeft: viewport.offsetLeft,
      offsetTop: viewport.offsetTop,
    }
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  }
}

/**
 * Returns a ref holding the current visible viewport and installs listeners for
 * every event that can move or resize it. Callers should re-run their
 * positioning logic whenever `onChange` fires.
 */
export function useNexusdownViewport(onChange?: () => void) {
  const viewport = ref<NexusdownViewport>(readViewport())

  const update = () => {
    viewport.value = readViewport()
    onChange?.()
  }

  const viewportTarget = () =>
    typeof window !== 'undefined' ? window.visualViewport ?? null : null

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.addEventListener('scroll', update, true)
    const visual = viewportTarget()
    if (visual) {
      visual.addEventListener('resize', update)
      visual.addEventListener('scroll', update)
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', update)
    window.removeEventListener('orientationchange', update)
    window.removeEventListener('scroll', update, true)
    const visual = viewportTarget()
    if (visual) {
      visual.removeEventListener('resize', update)
      visual.removeEventListener('scroll', update)
    }
  })

  return { viewport, update }
}
