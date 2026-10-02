/**
 * 图片 widget（参考文档 4.8 节）。
 *
 * 图片是**唯一**值得做成 widget 的块级元素：它没有可编辑的正文，
 * 渲染成 `<img>` 比在文本流里摆一个不可见的占位符好得多。
 *
 * ⚠️ 不要用 `block: true` 的 replace —— 那样方向键**永远进不去**，
 * 也就没法在图片前后插入文字（参考文档第 5 节的硬约束）。
 *
 * ## 动态图（GIF / APNG）与 `prefers-reduced-motion`
 *
 * ⚠️ **CSS 停不下 GIF / APNG 的动画。** `animation-play-state: paused` 只对
 * CSS 动画生效，对 GIF / APNG 的**帧序列无效** —— 想暂停只能换静态图、或把帧
 * 画到 `<canvas>` 上手动逐帧控制，那都需要 JS（本库不带运行时，SSR 也复杂）。
 *
 * 所以对 `prefers-reduced-motion: reduce` 的用户**只能提示、不能暂停**：
 * 真要照顾它，得由消费方在 `theme.css` 里给动图加一个「点击播放」的角标之类。
 * 本次**不做**暂停功能 —— 记在这里，免得后来人以为 CSS 漏写了。
 *
 * 白名单见 `src/cm/url.ts`：`data:image/(gif|png|jpeg|webp);`，和渲染侧
 * markdown-it 的 `GOOD_DATA_RE` 逐字一致（`image/apng` / `image/svg+xml`
 * 两边都**不放行**；APNG 要走 `<img>` 只能用 `http(s)://` 的地址）。
 */
import { WidgetType } from '@codemirror/view'

export class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super()
  }

  /**
   * ★ 必须实现 `eq()`：默认实现恒返回 `false`，于是每次 rebuild 都重建 DOM ——
   * 表现是**图片闪一下并重新发一次请求**。
   */
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  override toDOM(): HTMLElement {
    const img = document.createElement('img')
    img.className = 'nd-image-widget'
    img.src = this.src
    img.alt = this.alt
    // 懒加载 + 异步解码：文档里几十张图时，这两行决定了滚动会不会卡。
    img.loading = 'lazy'
    img.decoding = 'async'
    return img
  }

  /**
   * 返回 `false` = 事件交给 CM —— 点图片落在光标定位上，而不是被 widget 吞掉。
   *
   * （参数只是为了和基类签名一致：`ignoreEvent(event: Event)`。CM 会拿事件来问，
   * 少写参数虽然也合法，但那样就没法在测试里按真实调用方式调它。）
   */
  override ignoreEvent(_event: Event): boolean {
    return false
  }
}
