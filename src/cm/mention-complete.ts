/**
 * `mention` 的**自动补全** —— 在正文里直接打 `@`，光标旁边就弹候选。
 *
 * ## 它是「提及」的**第二个入口**（第一个是工具栏按钮）
 *
 * 工具栏的「提及」按钮（`nexusdown/editor` 的 `Toolbar.vue` → `openMention`）
 * 是一个**可发现的**入口：用户不知道有这个功能时能找到它。但写作时手不会离开键盘，
 * 所以还要有**就地**的那条：打 `@` 就弹。两条入口**共用同一个候选来源**
 * （消费方注入的 `mentionCandidates`）—— 所以不会出现"按钮里有的资源、打 `@` 却搜不到"。
 *
 * ## 为什么它不在 `features/` 里
 *
 * `src/cm/features/` 是「**节点名 → 装饰器**」的分发表（见 `plugin.ts`），
 * 而补全**不是装饰** —— 它由 CM6 的 `autocompletion()` 提供（工具提示 + 按键）。
 * 所以它跟 `mount.ts` / `commands.ts` 一样，是 `src/cm/` 下的一个**扩展**，
 * 由装配层（`index.ts` 的 `nexusdown()`）挂上。
 *
 * ## 三条硬要求（都踩过或差点踩）
 *
 * 1. **补全源绝不能抛** ✗ —— 抛了 CM6 会 `logException` 并**关掉补全**，
 *    严重时带垮编辑器。这个项目刚在 mention 卡片上踩过「一个 widget 抛异常 →
 *    整个装饰构建挂掉 → 表格和候选列表一起失效」。所以取候选失败**返回 `null`**
 *    （= 本次不弹），最多 `console.warn` 一条。
 * 2. **候选只拉一次** —— 源在**每次按键**都会跑，每次都发请求会把消费方的接口打爆。
 *    见下面 `candidates()` 的缓存说明。
 * 3. **空态要弹得出来** —— CM6 的 `autocompletion` 没有内置空态：候选为空时它
 *    **就是不弹** ✗，而用户要的是「弹出来并说明没有匹配的」。做法见 `NO_MATCH`。
 */
import {
  autocompletion,
  closeCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'

import { mentionPrefixAt } from '../shared/mention.js'
import type { MentionCandidate } from './commands.js'

export interface MentionCompletionOptions {
  /**
   * 候选来源 —— **和工具栏选择器是同一个函数**（`Editor.vue` 的 `mentionCandidates`）。
   *
   * 库**不查库**（同 `mathRenderer` / `RenderData`）：「有哪些 slug 可提及」是消费方的事。
   * 不传时**整个补全扩展都不挂**（返回空数组）—— 编辑器行为与加它之前一字不变，
   * 也不会因为装了一个永远返回空的补全源而多出 `Ctrl-Space` 之类的按键。
   */
  candidates?: () => Promise<MentionCandidate[]>
}

/**
 * 「一条都没匹配上」的占位项。
 *
 * ## 为什么需要它（CM6 没有内置空态）
 *
 * `autocompletion` 在候选为空时**不弹工具提示**（`CompletionDialog.build`：
 * `if (!options.length) return null`）。用户要的是"弹出来并说明没有匹配的"，
 * 所以只能给一个**假的候选**把面板撑开。
 *
 * ## ⚠️ 它绝不能被插进正文
 *
 * `applyCompletion` 的逻辑是 `const apply = option.completion.apply || label`：
 * 是**字符串**就把它插进 `from..to`，是**函数**就只调它、**不做任何插入**。
 * 所以这里给一个**函数** —— 回车/点击都只会走这个函数，不会把提示文字写进正文。
 *
 * 函数体只关掉面板、**不碰文档**：
 * - 光标此时停在 `@zzzzz` 后面，用户多半是想按回车换行；
 * - `acceptCompletion` 会把这个回车**消费掉**（返回 `true`，不落到换行），
 *   关掉面板后**再按一次**回车就正常换行了 —— 不制造"按回车毫无反应"的死循环。
 */
const NO_MATCH: Completion = {
  label: '没有匹配的资源',
  apply: (view) => {
    closeCompletion(view)
  },
}

/** 把一条候选变成 CM6 的补全项。`label` 就是**会被插进正文的那串**（默认 apply 插 label）。 */
function toCompletion(c: MentionCandidate): Completion {
  return {
    // `@` 是语法的一部分（契约 §8），所以 label 带上它 —— 插入后正好是 `@slug`。
    // 这也让工具提示里的样子和工具栏选择器一致（那边显示的也是 `@slug`）。
    label: '@' + c.slug,
    // 显示名只作提示，不进正文（同 `MentionCandidate.title` 的约定）。
    detail: c.title,
  }
}

/**
 * 造出提及补全扩展。不传候选来源时返回 `[]`（什么都不挂）。
 *
 * 做成工厂而不是模块级常量：候选来源是**每个编辑器一份的装配期配置**
 * （同 `createMathFeature` / `createMentionFeature`），模块级单例会让同进程里
 * 两个编辑器互相串，测试也没法并行。
 */
export function mentionCompletion(opts: MentionCompletionOptions = {}): Extension {
  const load = opts.candidates
  if (!load) return []

  /**
   * ★ **候选缓存 —— 一个编辑器实例拉一次。**
   *
   * ## 为什么必须缓存
   *
   * 补全源在**每次按键**都会跑（用户打 `@`、`@r`、`@re`… 每一击都是一次调用），
   * 而消费方传进来的函数按契约是「每次打开选择器才拉」的**发请求**函数
   * （见 `Editor.vue` 的 `mentionCandidates` 注释）。不缓存的话，
   * 打三个字母就是三次请求 —— 工具栏那边一次打开只发一次，两边负载差一个量级。
   *
   * ## 粒度与失效时机
   *
   * - **粒度**：跟着这个扩展实例走（= 一个 `mountEditor` = 一个编辑器视图）。
   *   不用模块级变量，是为了不跨编辑器串（同上面「工厂而非单例」那条）。
   * - **失效**：**只有失败时清掉**，让下一次打 `@` 重试。
   *   不设 TTL、不按时间失效 —— 一次写作会话里资源列表基本是静态的，
   *   而按时间失效会在用户打字打到一半时突然重拉、列表跳动。
   *   资源真的变了（比如另一个标签页新建了资源），刷新页面即可拿到新列表；
   *   工具栏那个入口每次打开都是**现拉**的，两条路各自的时间语义因此不同 ——
   *   这是刻意接受的：工具栏是显式动作、可以等一次请求，就地补全是打字路径、必须稳。
   *
   * 缓存的是**Promise 本身**（不是 resolve 后的数组）：连打几个键时多个源调用
   * 会同时 `await` 同一个请求，不会并发拉好几次。
   */
  let cache: Promise<MentionCandidate[]> | null = null
  const candidates = (): Promise<MentionCandidate[]> => {
    if (!cache) {
      cache = load().catch((e: unknown) => {
        // 失败不缓存：一次网络抖动不该让整个会话的补全永久失效。
        cache = null
        throw e
      })
    }
    return cache
  }

  const source: CompletionSource = async (context) => {
    const { state, pos } = context

    /*
     * 判定「光标前是不是一个提及前缀」。
     *
     * ⚠️ **只扫光标所在行**：slug 是 `[a-z0-9-]`，不含换行，所以前缀一定落在
     * 当前行里 —— 不必扫全文档（大文档上那会是一次无谓的拷贝）。
     *
     * 判定本身走 `shared/mention.ts` 的 `mentionPrefixAt`，**和扫描器同一套规则**：
     * `a@b.com` 的 `@b` 在两边都不成立（词边界），不会出现"补全弹了、渲染器却不认"。
     */
    const line = state.doc.lineAt(pos)
    const prefix = mentionPrefixAt(state.sliceDoc(line.from, pos), pos - line.from)
    if (!prefix) return null

    let items: MentionCandidate[]
    try {
      items = await candidates()
    } catch (e) {
      /*
       * ⚠️ **绝不能抛** —— 见文件头第 1 条。返回 `null` = 本次不弹候选，
       * 编辑器照常能用。取候选失败不是"编辑器坏了"，只是这次没有提示。
       */
      console.warn('[nexusdown] 提及候选加载失败，本次不弹候选：', e)
      return null
    }

    /*
     * 过滤放在**这里**（不是交给 CM6）：工具提示的过滤是"按 label 模糊匹配"，
     * 而我们要的是「slug **或** 显示名」命中 —— 用户可能记得显示名
     * （「REI 物品管理器」）也可能记得 slug（`rei`）。和工具栏选择器同一套判据。
     */
    const query = prefix.slug.toLowerCase()
    const matched = query
      ? items.filter(
          (c) => c.slug.toLowerCase().includes(query) || c.title.toLowerCase().includes(query),
        )
      : items

    const result: CompletionResult = {
      // 替换整个 `@查询`（不是只替换查询）—— label 自带 `@`，插进去正好是 `@slug`。
      from: line.from + prefix.from,
      to: pos,
      options: matched.length > 0 ? matched.map(toCompletion) : [NO_MATCH],
      /*
       * ⚠️ **必须 `filter: false`。**
       *
       * 默认 CM6 会拿 `from..to` 那段文本对每个 option 的 label 做模糊过滤 ——
       * 空态的 label 是「没有匹配的资源」，**不含**用户打的 `zzzzz`，
       * 于是它会被过滤掉 → 面板又空了 → "没有匹配"永远弹不出来。
       * 过滤我们自己在上面做完了，这里关掉它。
       */
      filter: false,
    }
    return result
  }

  return [
    autocompletion({
      /*
       * 我们的候选没有 `type`（资源/帖子那种分类图标这个库不定义），
       * 开着图标位会得到一排**空方块** —— 看起来就是"图标加载坏了"。
       * 关掉，只留 label + detail。
       */
      icons: false,
      /*
       * 空态那一行单独挂个类（见 `theme.css` 的 `.nd-mention-empty`）——
       * 它是假候选，样式上要和真候选区分开（灰、不可点），
       * 否则用户会以为那行字能选。
       */
      optionClass: (c) => (c === NO_MATCH ? 'nd-mention-empty' : ''),
    }),
    /*
     * ★ 补全源走**语言数据**，不是 `autocompletion({ override })`。
     *
     * `override` 是**替换**：它会把 `@codemirror/lang-markdown` 自带的
     * HTML 标签补全（`completeHTMLTags` 默认为 `true`）一起顶掉 ——
     * 那是别处的功能，不该被我们顺手关掉。语言数据是**加法**，两边共存。
     *
     * `markdownLanguage.data` 和 `markdown()` 产出的那个语言实例共用同一个
     * facet（`lang-markdown` 的 `mkLang()` 把模块级的 `data` 传给了每个实例），
     * 所以往这里 `of()` 的值，`languageDataAt('autocomplete', pos)` 一定读得到。
     */
    markdownLanguage.data.of({ autocomplete: source }),
  ]
}
