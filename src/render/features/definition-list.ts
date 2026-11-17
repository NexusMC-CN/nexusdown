import definitionList from 'markdown-it-deflist'
import type { RenderFeature } from '../feature.js'

export const definitionListFeature: RenderFeature = {
  name: 'definition-list',
  install({ md }) { md.use(definitionList) },
}
