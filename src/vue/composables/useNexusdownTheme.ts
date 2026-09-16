import { getCurrentInstance, isRef, onMounted, onUnmounted, ref, unref, watch, type Ref } from 'vue'

export type NexusdownTheme = 'light' | 'dark' | 'system'
export type ResolvedNexusdownTheme = Exclude<NexusdownTheme, 'system'>

type ThemeSource = NexusdownTheme | Ref<NexusdownTheme>

function systemTheme(): ResolvedNexusdownTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useNexusdownTheme(source: ThemeSource = 'system') {
  const resolvedTheme = ref<ResolvedNexusdownTheme>('light')
  let media: MediaQueryList | undefined
  const update = () => {
    const requested = unref(source)
    resolvedTheme.value = requested === 'system' ? systemTheme() : requested
  }
  const onMediaChange = () => update()
  const detachMedia = () => {
    if (!media) return
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onMediaChange)
    else media.removeListener(onMediaChange)
    media = undefined
  }
  const syncMediaListener = () => {
    detachMedia()
    if (unref(source) !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    media = window.matchMedia('(prefers-color-scheme: dark)')
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onMediaChange)
    else media.addListener(onMediaChange)
  }

  update()
  const instance = getCurrentInstance()

  if (instance) {
    watch(() => (isRef(source) ? source.value : source), () => {
      update()
      syncMediaListener()
    }, { immediate: true })
    onMounted(() => {
      syncMediaListener()
      update()
    })
    onUnmounted(detachMedia)
  }

  return { resolvedTheme }
}
