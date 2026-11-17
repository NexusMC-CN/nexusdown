/** A deterministic, attribute-safe ID part; no document or process state. */
export function normalizeRenderId(value: string, fallback = 'section'): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || fallback
}

export function renderNamespace(env: unknown): string {
  const prefix = env && typeof env === 'object' ? (env as { idPrefix?: unknown }).idPrefix : undefined
  return normalizeRenderId(typeof prefix === 'string' ? prefix : '', 'nd')
}

export function scopedRenderId(env: unknown, local: string): string {
  return renderNamespace(env) + '-' + local
}
