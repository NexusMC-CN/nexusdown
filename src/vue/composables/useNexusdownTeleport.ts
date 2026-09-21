import { onMounted, ref } from 'vue'

/**
 * Keep Teleport disabled during SSR and the initial island hydration pass.
 * Astro renders each Vue island in isolation, so a body-level Teleport target
 * cannot be reconciled safely until the island has mounted in the browser.
 */
export function useNexusdownTeleport() {
  const teleportReady = ref(false)
  onMounted(() => { teleportReady.value = true })
  return { teleportReady }
}
