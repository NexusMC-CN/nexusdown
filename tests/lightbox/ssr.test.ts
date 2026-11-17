// @vitest-environment node
import { expect, it } from 'vitest'
import { mountImageLightbox } from '../../src/lightbox/index.js'

it('imports the optional browser entry without touching DOM globals', () => {
  expect(typeof window).toBe('undefined')
  expect(typeof document).toBe('undefined')
  expect(typeof mountImageLightbox).toBe('function')
})
