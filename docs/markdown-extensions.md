# Markdown 扩展语法

这些语法由内置解析器提供，无需消费方另装 Markdown 插件。渲染同步完成，不访问 DOM 或网络；输入中的原始 HTML 仍转义为文字。引入 @nexusmc-cn/nexusdown/dialect.css 可取得容器、目录与脚注的共享样式。

## 脚注

    这里有一条补充说明[^install]，也可以再次引用[^install]。

    [^install]: 脚注内容支持 **加粗**、链接和多段落。
        下一段落缩进四个空格。

脚注按正文首次引用顺序编号。同一脚注的多次引用分别提供回跳入口；未定义的引用保留原文。脚注与返回链接在当前页面跳转。

## 自定义容器

    ::: note 可选标题
    这里可以写 **Markdown**。
    :::

支持 note、tip、info、warning、danger 和 details 六种类型。未提供标题时使用对应的默认名称。details 输出浏览器原生的折叠区块：

    ::: details 查看详细步骤
    1. 准备环境
    2. 安装依赖
    :::

标题按纯文本转义，不作为 HTML 或 Markdown 执行。未知类型、缺少闭合标记时保留源码。嵌套时为外层使用更长的冒号标记：

    :::: note 外层
    ::: tip 内层
    正文
    :::
    ::::

代码围栏中的冒号标记保持为代码，不会关闭容器。

## 定义列表

    Nexusdown
    : Markdown 编辑器与渲染器。
    : 支持多个定义。

输出语义化的 dl、dt、dd，定义正文继续解析 Markdown。

## 目录与标题编号

在独占段落中写 [TOC] 可生成本文目录：

    [TOC]

    # 安装

    ## Windows

    ## Linux {#linux-install}

目录只使用同页链接。自动锚点来自标题可见文字，支持中文；重复标题追加后缀，纯符号标题使用 section。末尾的 {#id} 指定显式标题锚点，标记不会进入可见文字。

标题编号由应用显式开启，默认关闭：

    import { renderMarkdown } from '@nexusmc-cn/nexusdown/render'

    const html = renderMarkdown(markdown, {
      idPrefix: 'article-42',
      headingNumbers: true,
    })

编号显示为 1、1.1、1.1.1 等，只影响显示，不参与锚点身份。没有目录、编号或 idPrefix 时，普通标题保持原来的 HTML 输出。

同一页面展示多个 Markdown 片段时，为每个片段传入不同且稳定的 idPrefix；服务端与客户端使用相同值。标题、脚注与轮播锚点共享该命名空间。diagramIdPrefix 仍可单独配置图表命名空间。不要把自动标题 slug 或显示序号当成业务章节、段落的持久 ID；这类 ID 由应用保存，使用显式锚点绑定。

## 表格对齐、Emoji 与删除线

三种对齐由分隔行中的冒号指定：

    | 左对齐 | 居中 | 右对齐 |
    | :--- | :---: | ---: |
    | 文字 | 文字 | 文字 |

渲染输出保留对应单元格的 text-align。消费方消毒输出时需要允许受控的 left、center、right 对齐。

常用 Emoji shortcode 包括 :smile:、:thumbsup:、:rocket:；直接输入 Unicode Emoji 也可使用。当前内置 226 个常用 shortcode；未知名称原样保留，:+1: 和 :-1: 不在此集合，分别使用 :thumbsup: 和 :thumbsdown:。删除线使用两个波浪号，例如 ~~删除内容~~。代码中的 Emoji 与删除线标记保留原文。

## 编辑器与应用接入

源码始终是编辑内容。块预览使用同一渲染器，进入块的选区或通过预览打开源码后即可编辑。

对于自行编写的编辑器，可从 /render 导入 analyzeMarkdownBlocks(markdown, options?)。返回值中的 kind 是 container、definition-list、toc 或 footnote，from/to 是原始字符串的 UTF-16 范围，to 排他；html 是保留全文目录与脚注上下文的预览 HTML。该接口同样同步、无 DOM、无网络。

图片灯箱使用单独的浏览器入口，并支持由宿主接管，参见 [图片灯箱说明](./image-lightbox.md)。消毒正文时保留受控的 data-nd-image 标记，灯箱才能识别普通正文图片。链接卡片与提及卡片的缩略图不带该标记。
