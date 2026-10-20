let nextFallbackId = 0

/** Client-only IDs must also be distinct across separately bundled entries. */
export function createWidgetId(prefix: string): string {
  const cryptoApi = globalThis.crypto
  const id = typeof cryptoApi?.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextFallbackId}`
  return `${prefix}-${id}`
}
