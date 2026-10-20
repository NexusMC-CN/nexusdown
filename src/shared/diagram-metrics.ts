/**
 * DOM-free text metrics adapted from Pele 1.7.0:
 * https://github.com/obsidianmd/pele/blob/main/src/text/measurer.ts
 * https://github.com/obsidianmd/pele/blob/main/src/text/metrics.ts
 * Copyright (c) 2026 kepano. MIT; see THIRD_PARTY_NOTICES.md.
 *
 * Pele's default uses canvas in browsers and these estimates on servers. Using
 * the same estimator in both places keeps SSR and client SVG geometry aligned.
 */
import type { TextMeasurer } from 'pele'

// Printable ASCII widths in thousandths of an em, encoded as base-36 pairs.
const REGULAR = '7q7q9vfgfgopij5b9999atg87q997q7qfgfgfgfgfgfgfgfgfgfg7q7qg8g8g8fgs7ijijk2k2ijgzlmk27qdwijfgn5k2lmijlmk2ijgzk2ijq8ijijgz7q7q7qd1fg99fgfgdwfgfg7qfgfg6666dw66n5fgfgfgfg99dw7qfgdwk2dwdwdw9a789ag8'
const BOLD = '7q99d6fgfgopk26m9999atg87q997q7qfgfgfgfgfgfgfgfgfgfg9999g8g8g8gzr3k2k2k2k2ijgzlmk27qfgk2gzn5k2lmijlmk2ijgzk2ijq8ijijgz997q99g8fg99fggzfggzfg99gzgz7q7qfg7qopgzgzgzgzatfg99gzfglmfgfgdwat7satg8'

function unpack(packed: string): Uint16Array {
  return Uint16Array.from({ length: 95 }, (_, index) => parseInt(packed.slice(index * 2, index * 2 + 2), 36))
}

const regular = unpack(REGULAR)
const bold = unpack(BOLD)

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0xd800 && code <= 0xdbff)
  )
}

function isZeroWidth(code: number): boolean {
  return (
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0xdc00 && code <= 0xdfff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff
  )
}

export const diagramTextMeasurer: TextMeasurer = {
  width(text, size, style) {
    const mono = (style & 4) !== 0
    const table = style & 1 ? bold : regular
    let units = 0
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (code < 32) continue
      if (code < 127) units += mono ? 600 : table[code - 32]!
      else if (isZeroWidth(code)) continue
      else if (isWide(code)) units += mono ? 1200 : 1000
      else units += mono ? 600 : 580
    }
    return (units * size) / 1000
  },
}
