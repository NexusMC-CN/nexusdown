import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** Keep a teleported popup synchronized with its own editor while it is open. */
export function useNexusdownOverlayTheme(
  trigger: Ref<HTMLElement | null>,
  open: Ref<boolean>,
  refreshPosition: () => void,
) {
  const skin = ref<string | null>(null)
  let observer: MutationObserver | undefined

  function disconnect() {
    observer?.disconnect()
    observer = undefined
  }

  watch([open, trigger], ([isOpen, element], _, onCleanup) => {
    disconnect()
    onCleanup(disconnect)
    if (!isOpen || typeof window === 'undefined') return
    // Secondary pickers may be mounted inside another teleported overlay. The
    // nearest overlay root is their theme bridge when the editor is no longer
    // an ancestor in the DOM.
    const scope = element?.closest('.nexusdown-editor, [data-nexusdown-overlay-root]')
    if (!scope) return

    const refresh = () => {
      skin.value = scope.getAttribute('data-nexusdown-skin')
      refreshPosition()
    }
    refresh()

    const Observer = scope.ownerDocument.defaultView?.MutationObserver
    if (!Observer) return
    observer = new Observer((records) => {
      if (records.some(({ attributeName: name }) => name === 'class' || name === 'style'
        || name === 'data-nexusdown-skin' || name?.includes('theme'))) refresh()
    })
    // Observe each ancestor's attributes, never its subtree. Popup styles and
    // editor content mutations must not trigger another theme/position update.
    for (let ancestor: Element | null = scope; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true })
    }
  }, { flush: 'post' })

  onBeforeUnmount(disconnect)
  return { skin }
}
