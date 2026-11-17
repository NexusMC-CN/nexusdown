# 图片灯箱

图片灯箱使用独立的 @nexusmc-cn/nexusdown/lightbox 入口，不依赖 Vue、CodeMirror 或 GSAP。纯 /render 入口继续同步、无 DOM、无网络；导入灯箱入口也不会访问浏览器全局，只有调用挂载函数后才安装监听。

## 默认查看器

```ts
import { renderMarkdown } from '@nexusmc-cn/nexusdown/render'
import { mountImageLightbox } from '@nexusmc-cn/nexusdown/lightbox'

root.innerHTML = renderMarkdown(markdown, { idPrefix: 'article-42' })
const dispose = mountImageLightbox(root)
// 组件卸载或不再使用正文时清理。清理可以重复调用。
dispose()
```

挂载后，带 data-nd-image 的正文图片可用鼠标、Enter 或空格打开。默认查看器支持上一张/下一张、方向键、Esc、横向触摸翻页、遮罩关闭和焦点返回。单张图片隐藏翻页按钮；图片本身点击不会关闭。默认查看器不创建动画，减少动态效果用户也能直接查看。打开后锁定页面滚动，最后一个查看器关闭才恢复原有 overflow。

同一个 root 再挂载时会替换旧挂载；旧的清理函数不能移除新的挂载。正文替换或图片集合变化后，默认查看器自动关闭，并增强新图片。图片只在本 root 内分组，嵌套的已挂载 root 有自己的图片组。

库只增强渲染器标记的正文图片。普通链接包裹图片保持链接导航，链接/提及卡片缩略图、播放器以及 .cm-editor 或 contenteditable 区域不参与灯箱。请勿把挂载函数用于正在编辑的源码宿主。

## 宿主接管

```ts
import {
  mountImageLightbox,
  type LightboxImage,
} from '@nexusmc-cn/nexusdown/lightbox'

let images: LightboxImage[] = []
let selected: number | null = null
const dispose = mountImageLightbox(root, {
  onOpen(nextImages, index) {
    images = nextImages
    selected = index
    // 把 images、selected 交给宿主自己的图片查看器。
  },
})
```

存在 onOpen 时，库只传出当前正文的图片数组和准确索引，不创建默认查看器、不占滚动锁。宿主负责自己的查看器关闭、焦点和动效生命周期；本站可以直接把数据交给已有 GSAP ImageLightbox。

LightboxImage 的形状为 { url: string; full?: string | null; title?: string | null }。url 来自正文图片源，title 优先使用图片 title，其次 alt；可信宿主可以给图片设置 data-nd-full 提供原图 URL。运行时仅接受 HTTP(S)、blob 和与 Markdown 图片边界一致的 PNG/GIF/JPEG/WebP data URL，不把 data-nd-full 当 HTML 插入。

## 样式与 SSR

默认查看器自身使用局部 DOM 样式，不需要额外 CSS。正文轮播仍使用 @nexusmc-cn/nexusdown/dialect.css。纯 HTML 渲染不需要挂载函数，关闭 JavaScript 时图片和原有 CSS 轮播仍然可读。

服务端渲染 root 内容后，在浏览器挂载正文时调用 mountImageLightbox，并在正文组件卸载时调用返回的 dispose；不要在服务端调用需要 HTMLElement 的挂载函数。
