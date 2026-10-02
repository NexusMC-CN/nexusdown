/**
 * 工具栏图标的「墨迹面积」测量器。
 *
 * ## 为什么需要它
 *
 * `src/editor/Toolbar.vue` 的 `ICONS` 表有一条硬约定：所有图标画在同一个
 * 16×16 网格上，视觉重量靠**墨迹面积**对齐，每个都要落在均值的 ±15% 以内
 * （`italic` 是唯一例外，见那边的注释）。这不是靠眼睛估的 —— 那个文件里
 * 每个坐标背后都有一句「扫像素量出来是多少」。
 *
 * 这个脚本就是那把尺子：它把 `.vue` 里的 `ICONS` 表**原样读出来**（不是手抄一份，
 * 否则量的是另一个东西），按 SVG 的描边/填充规则栅格化，输出每个图标的
 * 墨迹面积和外框，好和均值对比。**改任何一个图标都要重新跑一遍。**
 *
 * 用法：`node scripts/measure-icons.mjs`
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* ---------------------------------------------------------------- 读 ICONS 表 */

const vuePath = fileURLToPath(new URL('../src/editor/Toolbar.vue', import.meta.url))
// 统一换行 —— 仓库在 Windows 上检出时是 CRLF，直接用 `\n` 找结尾会落空。
const src = readFileSync(vuePath, 'utf8').replace(/\r\n/g, '\n')

const marker = 'const ICONS: Record<IconName, Shape[]> = {'
const at = src.indexOf(marker)
if (at < 0) throw new Error('没找到 ICONS 表 —— Toolbar.vue 的结构变了？')
const open = src.indexOf('{', at)
// 表里第一个「行首的 }」就是它的结尾（内部闭合括号都带缩进）。
// `+1` 跳过那个 `\n`，落点是 `}` 本身；再 `+1` 把它包进来。
const end = src.indexOf('\n}\n', open) + 1
if (end <= open) throw new Error('没找到 ICONS 表的结尾')
// 表体里有 TS 的 `as Shape`，剥掉才能用 new Function 求值。
const body = src.slice(open, end + 1).replace(/ as Shape/g, '')

const ROWS = [3.8, 8, 12.2]
// eslint-disable-next-line no-new-func
const ICONS = new Function('ROWS', `return (${body})`)(ROWS)

/* ---------------------------------------------------------------- SVG 路径展平 */

/** 端点参数化的圆弧 → 一串折线点（含终点）。 */
function arcPoints(x0, y0, rx, ry, rotDeg, largeArc, sweep, x1, y1, steps) {
  if (rx === 0 || ry === 0) return [[x1, y1]]
  const phi = (rotDeg * Math.PI) / 180
  const cosP = Math.cos(phi)
  const sinP = Math.sin(phi)
  const dx2 = (x0 - x1) / 2
  const dy2 = (y0 - y1) / 2
  const x1p = cosP * dx2 + sinP * dy2
  const y1p = -sinP * dx2 + cosP * dy2
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
  }
  const sign = largeArc !== sweep ? 1 : -1
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const co = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = co * ((rx * y1p) / ry)
  const cyp = co * ((-ry * x1p) / rx)
  const cx = cosP * cxp - sinP * cyp + (x0 + x1) / 2
  const cy = sinP * cxp + cosP * cyp + (y0 + y1) / 2
  const theta1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx)
  let dtheta = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - theta1
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI
  const out = []
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (dtheta * i) / steps
    const px = Math.cos(t) * rx
    const py = Math.sin(t) * ry
    out.push([cosP * px - sinP * py + cx, sinP * px + cosP * py + cy])
  }
  return out
}

/** 一条 `d` → 若干条折线（每条是 [x,y] 数组）。只支持图标表里用到的命令。 */
function flattenPath(d) {
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
  const toks = []
  let m
  while ((m = re.exec(d)) !== null) toks.push(m[1] !== undefined ? m[1] : parseFloat(m[2]))

  const polys = []
  let cur = null
  let i = 0
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let cmd = null
  let fresh = false

  const start = (nx, ny) => {
    x = nx
    y = ny
    sx = nx
    sy = ny
    cur = [[x, y]]
    polys.push(cur)
  }
  const lineTo = (nx, ny) => {
    if (!cur) start(x, y)
    cur.push([nx, ny])
    x = nx
    y = ny
  }

  while (i < toks.length) {
    if (typeof toks[i] === 'string') {
      cmd = toks[i++]
      fresh = true
    }
    if (cmd === null) break
    // M 之后的隐式坐标对是 L（m → l）；其余命令隐式重复自身。
    let c = cmd
    if (!fresh && (c === 'M' || c === 'm')) c = c === 'M' ? 'L' : 'l'
    fresh = false

    const rel = c === c.toLowerCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    const n = () => toks[i++]

    switch (c.toUpperCase()) {
      case 'M':
        start(ox + n(), oy + n())
        break
      case 'L':
        lineTo(ox + n(), oy + n())
        break
      case 'H':
        lineTo((rel ? x : 0) + n(), y)
        break
      case 'V':
        lineTo(x, (rel ? y : 0) + n())
        break
      case 'C': {
        const c1x = ox + n()
        const c1y = oy + n()
        const c2x = ox + n()
        const c2y = oy + n()
        const nx = ox + n()
        const ny = oy + n()
        for (let s = 1; s <= 24; s++) {
          const t = s / 24
          const u = 1 - t
          const px = u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * nx
          const py = u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ny
          cur.push([px, py])
        }
        x = nx
        y = ny
        break
      }
      case 'A': {
        const rx = n()
        const ry = n()
        const rot = n()
        const large = n()
        const sweep = n()
        const nx = ox + n()
        const ny = oy + n()
        for (const p of arcPoints(x, y, rx, ry, rot, large, sweep, nx, ny, 24)) cur.push(p)
        x = nx
        y = ny
        break
      }
      case 'Z':
        lineTo(sx, sy)
        cur = null
        break
      default:
        throw new Error(`未支持的路径命令：${c}`)
    }
  }
  return polys
}

/* ---------------------------------------------------------------- 栅格化 */

const S = 8 // 每个像素切成 8×8 个采样点
const N = 16 * S
const STROKE = 1.5 // `<svg>` 上的 stroke-width

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 5×7 点阵数字 —— 图标里的 `<text>` 只出现 1/2/3。 */
const DIGITS = {
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
}

function covered(shapes, px, py) {
  for (const s of shapes) {
    if (s.t === 'p') {
      for (const poly of s.polys) {
        for (let k = 1; k < poly.length; k++) {
          if (
            distToSegment(px, py, poly[k - 1][0], poly[k - 1][1], poly[k][0], poly[k][1]) <=
            STROKE / 2
          ) {
            return true
          }
        }
      }
    } else if (s.t === 'c') {
      if (Math.hypot(px - s.cx, py - s.cy) <= s.r) return true
    } else if (s.t === 'r') {
      // 圆角矩形：先当矩形判，四角再按圆角半径收一下。
      if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) {
        const rx = Math.min(s.rx, s.w / 2, s.h / 2)
        const cx = Math.max(s.x + rx, Math.min(px, s.x + s.w - rx))
        const cy = Math.max(s.y + rx, Math.min(py, s.y + s.h - rx))
        if (Math.hypot(px - cx, py - cy) <= rx) return true
      }
    } else if (s.t === 'x') {
      const bits = DIGITS[s.v]
      if (!bits) continue
      // 基线在 s.y，字高约 0.72em、字宽约 0.6em（600 字重）。
      const h = s.size * 0.72
      const w = s.size * 0.6
      const top = s.y - h
      const left = s.x - w / 2
      const col = Math.floor(((px - left) / w) * 5)
      const row = Math.floor(((py - top) / h) * 7)
      if (col >= 0 && col < 5 && row >= 0 && row < 7 && bits[row][col] === '1') return true
    }
  }
  return false
}

function measure(name, shapes) {
  const prepared = shapes.map((s) => (s.t === 'p' ? { ...s, polys: flattenPath(s.d) } : s))
  let count = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const px = (gx + 0.5) / S
      const py = (gy + 0.5) / S
      if (!covered(prepared, px, py)) continue
      count++
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
  }
  return { name, area: count / (S * S), box: [minX, minY, maxX, maxY] }
}

/* ---------------------------------------------------------------- 报告 */

/*
 * 可选的第二个参数：一段 JSON（`{ 名字: Shape[] }`），用来在**落地之前**
 * 试量候选图标。设计新图标时不必先把半成品写进 Toolbar.vue。
 *   例：node scripts/measure-icons.mjs '{"foo":[{"t":"p","d":"M4 4h8v8H4z"}]}'
 */
const extra = process.argv[2] ? JSON.parse(process.argv[2]) : {}
const all = { ...ICONS, ...extra }

const results = Object.entries(all).map(([name, shapes]) => measure(name, shapes))
const mean = results.reduce((a, r) => a + r.area, 0) / results.length

console.log(`图标数：${results.length}    均值：${mean.toFixed(1)} px²    ±15% 带：${(mean * 0.85).toFixed(1)} ~ ${(mean * 1.15).toFixed(1)}\n`)
const pad = (s, n) => String(s).padEnd(n)
for (const r of results) {
  const ratio = r.area / mean
  const flag = ratio < 0.85 || ratio > 1.15 ? '  ← 超带' : ''
  const box = r.box.map((v) => v.toFixed(1)).join(', ')
  console.log(
    `${pad(r.name, 12)} 面积 ${pad(r.area.toFixed(1), 6)} 比值 ${ratio.toFixed(2)}  外框 [${box}]${flag}`,
  )
}
