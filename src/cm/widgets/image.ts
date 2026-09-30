/**
 * 图片 widget（参考文档 4.8 节）。
 *
 * 图片是**唯一**值得做成 widget 的块级元素：它没有可编辑的正文，
 * 渲染成 `<img>` 比在文本流里摆一个不可见的占位符好得多。
 *
 * ⚠️ 不要用 `block: true` 的 replace —— 那样方向键**永远进不去**，
 * 也就没法在图片前后插入文字（参考文档第 5 节的硬约束）。
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
