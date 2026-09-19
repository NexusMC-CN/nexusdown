import { nextTick, onBeforeUnmount, onMounted, readonly, ref, watch, type Ref } from 'vue'

export interface ToolbarControlMeasurement {
  key: string
  right: number
}

export function calculateOverflowedKeys(
  controls: ToolbarControlMeasurement[],
  fullRight: number,
  moreLeft: number,
): Set<string> {
  if (controls.every(({ right }) => right <= fullRight)) return new Set()
  return new Set(controls.filter(({ right }) => right > moreLeft).map(({ key }) => key))
}

export interface ToolbarOverflowOptions {
  toolbar: Ref<HTMLElement | null>
  moreSlot: Ref<HTMLElement | null>
  controlKeys: Ref<string[]>
}

export function useToolbarOverflow(options: ToolbarOverflowOptions): {
  overflowedKeys: Readonly<Ref<Set<string>>>
  ready: Readonly<Ref<boolean>>
  refresh: () => void
} {
  const overflowedKeys = ref<Set<string>>(new Set())
  const ready = ref(false)
  let observer: ResizeObserver | undefined
  let fallbackWindow: Window | undefined
  let frame: number | undefined
  let refreshQueued = false
  let mounted = false

  function measure() {
    const toolbar = options.toolbar.value
    const moreSlot = options.moreSlot.value
    if (!toolbar || !moreSlot) return

    const allowedKeys = new Set(options.controlKeys.value)
    const measurements = Array.from(toolbar.querySelectorAll<HTMLElement>('[data-nexusdown-toolbar-key]'))
      .flatMap((element) => {
        const key = element.dataset.nexusdownToolbarKey
        return key !== undefined && allowedKeys.has(key)
          ? [{ key, right: element.getBoundingClientRect().right }]
          : []
      })
    overflowedKeys.value = calculateOverflowedKeys(
      measurements,
      toolbar.getBoundingClientRect().right,
      moreSlot.getBoundingClientRect().left,
    )
    ready.value = true
  }

  function refresh() {
    if (!mounted || refreshQueued) return
    refreshQueued = true
    void nextTick(() => {
      refreshQueued = false
      if (!mounted) return

      if (typeof globalThis.requestAnimationFrame !== 'function') {
        measure()
        return
      }

      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame)
      frame = globalThis.requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    })
  }

  onMounted(() => {
    mounted = true
    const toolbar = options.toolbar.value
    fallbackWindow = toolbar?.ownerDocument.defaultView ?? undefined
    const Observer = globalThis.ResizeObserver
    if (toolbar && typeof Observer === 'function') {
      observer = new Observer(refresh)
      observer.observe(toolbar)
      const track = toolbar.querySelector<HTMLElement>('.nexusdown-toolbar__track')
      if (track) observer.observe(track)
    } else {
      fallbackWindow?.addEventListener('resize', refresh)
    }
    refresh()
  })

  watch(options.controlKeys, refresh, { flush: 'post' })

  onBeforeUnmount(() => {
    mounted = false
    observer?.disconnect()
    observer = undefined
    fallbackWindow?.removeEventListener('resize', refresh)
    fallbackWindow = undefined
    if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame)
    frame = undefined
  })

  return {
    overflowedKeys: readonly(overflowedKeys) as Readonly<Ref<Set<string>>>,
    ready: readonly(ready),
    refresh,
  }
}
