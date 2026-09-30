/**
 * Minecraft 特有文件类型的文件图标 —— **手绘**内联 SVG。
 *
 * 通用语言（`js` / `yaml` / `java` …）走 `code-icons.ts`（`vscode-icons` 图标集，
 * 构建期从 iconify 拉、自动生成）。但 MC 社区那些文件类型（`server.properties`、
 * `pack.mcmeta`、`.mcfunction` …）没有现成图标，所以在这里手绘。
 *
 * ## 规格 —— 必须和 `vscode-icons` 一致（否则并排显示时大小/粗细会不齐）
 *
 * - `viewBox="0 0 32 32"` —— vscode-icons 全部是这个
 * - `width="1em" height="1em"` —— 跟着 `font-size` 走
 * - 扁平风格：**不用渐变、不用阴影**，纯 `fill` 实心路径
 * - 图形约占 viewBox 的 60~75%，四周留白
 * - 每个图标 **≤3 个彩色**（白/黑当高光，不算品牌色）
 * - 路径尽量短，能用一个 `d` 表达的别拆成五个
 *
 * ## 用法
 *
 * 这个文件**只导出 `MC_CODE_ICONS` 这个 `Record`**（和 `CODE_ICONS` 同形状），
 * 调用方自己把两份合并、自己决定降级策略。这里不导出函数。
 */

/** 语言别名 → SVG 源码。key 是小写。 */
export const MC_CODE_ICONS: Record<string, string> = {
  // ---- 服务端配置：靛蓝面板 + 两条滑杆 ----
  properties:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><rect x="3.5" y="5.5" width="25" height="21" rx="3.5" fill="#4c6ef5"/><rect x="7" y="10.75" width="18" height="2.5" rx="1.25" fill="#c7d2fe"/><circle cx="20" cy="12" r="3" fill="#fff"/><rect x="7" y="18.75" width="18" height="2.5" rx="1.25" fill="#c7d2fe"/><circle cx="12" cy="20" r="3" fill="#fff"/></svg>',

  // ---- 资源包元数据：文档 + 草方块角标 ----
  mcmeta:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#8a9bb0" d="M6.5 4h11L24 10.5v17a1.5 1.5 0 0 1-1.5 1.5h-16A1.5 1.5 0 0 1 5 27.5V5.5A1.5 1.5 0 0 1 6.5 4z"/><path fill="#7cbd6b" d="M17.5 4L24 10.5h-4.5A2 2 0 0 1 17.5 8.5z"/><path fill="#7cbd6b" d="M23.5 17.5l4 2.3l-4 2.3l-4-2.3z"/><path fill="#5d8c3f" d="M19.5 19.8l4 2.3l4-2.3v4.6l-4 2.3l-4-2.3z"/></svg>',

  // ---- 数据包函数：命令方块 + 中心箭头 ----
  mcfunction:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#e39a64" d="M5.5 9l5-4h16l-5 4z"/><path fill="#c97b4a" d="M5.5 9h16v16h-16z"/><path fill="#a85f35" d="M21.5 9l5-4v16l-5 4z"/><path fill="#fff" d="M11 13.5l6 3.5l-6 3.5z"/></svg>',

  // ---- NBT 数据：标签树 ----
  // ---- NBT 数据：文档 + 树状分支。
  //
  // ⚠️ 第一版画的是「三个紫色圆点 + 连线」，那是**分子结构**的视觉语言，
  //    在 1em 尺寸下完全看不出是「NBT」。NBT 的本质是**嵌套的键值树**
  //    （TAG_Compound / TAG_List 层层套），所以改成文档 + 树状分支：
  //    一个根节点往下分两个子节点，一眼就是「结构化的数据」。
  //    紫色用 MC 的末地/紫颂果色系，和 `dat`（蓝软盘）、`mcfunction`（橙方块）区分开。
  nbt:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#8b5cf6" d="M7 3.5h12.5L25 9v19.5H7z"/><path fill="#c4b5fd" d="M19.5 3.5 25 9h-5.5z"/><path fill="#fff" d="M12.4 15.2h7.2v1.6h-7.2zM15.2 16.8h1.6v7.2h-1.6z"/><circle cx="12.4" cy="15.2" r="2.6" fill="#fff"/><circle cx="19.6" cy="15.2" r="2.6" fill="#c4b5fd"/><circle cx="16" cy="24" r="2.6" fill="#c4b5fd"/></svg>',

  // ---- 存档数据：软盘 ----
  dat:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#3e5265" d="M4.5 6a2 2 0 0 1 2-2h19a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2h-19a2 2 0 0 1-2-2z"/><path fill="#c9d4e0" d="M10.5 4h11v9.5h-11z"/><path fill="#e8eef5" d="M8.5 17.5h15v9h-15z"/></svg>',

  // ---- 语言文件：对话气泡 + 字母 A ----
  lang:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#2e9e5b" d="M7.5 4h17A4.5 4.5 0 0 1 29 8.5v9a4.5 4.5 0 0 1-4.5 4.5H14l-6 5.5V22h-.5A4.5 4.5 0 0 1 3 17.5v-9A4.5 4.5 0 0 1 7.5 4z"/><path fill="#fff" fill-rule="evenodd" d="M16 8L10.2 20h2.9l1-2.4h3.8l1 2.4h2.9zM16 12.6l1.4 3.5h-2.8z"/></svg>',

  // ---- Blockbench 模型：等距立方体（面之间留缝 → 线框感） ----
  bbmodel:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#cfe0f5" d="M16 4.36L25.03 9.63L16 15.11L6.97 9.63z"/><path fill="#7fa8d8" d="M6.24 10.85L15.27 16.44V27.19L6.24 21.81z"/><path fill="#5b87c0" d="M16.74 16.44L25.77 10.85V21.81L16.74 27.19z"/></svg>',

  // ---- Skript 脚本：卷轴（羊皮纸） ----
  sk:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><rect x="5" y="4.5" width="22" height="5" rx="2.5" fill="#c9b58a"/><rect x="8" y="7" width="16" height="18" fill="#f0e4c4"/><rect x="5" y="22.5" width="22" height="5" rx="2.5" fill="#c9b58a"/><rect x="11" y="11" width="10" height="1.6" rx=".8" fill="#b5a484"/><rect x="11" y="15" width="8" height="1.6" rx=".8" fill="#b5a484"/><rect x="11" y="19" width="10" height="1.6" rx=".8" fill="#b5a484"/></svg>',

  // ---- CraftTweaker 脚本：同一个卷轴，换紫色系 ----
  zs:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><rect x="5" y="4.5" width="22" height="5" rx="2.5" fill="#8e5bb5"/><rect x="8" y="7" width="16" height="18" fill="#e3d3f0"/><rect x="5" y="22.5" width="22" height="5" rx="2.5" fill="#8e5bb5"/><rect x="11" y="11" width="10" height="1.6" rx=".8" fill="#a98bc4"/><rect x="11" y="15" width="8" height="1.6" rx=".8" fill="#a98bc4"/><rect x="11" y="19" width="10" height="1.6" rx=".8" fill="#a98bc4"/></svg>',

  // ---- 插件/模组：Java 咖啡杯 ----
  jar:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#e8833a" d="M6 9h15v11.5a5 5 0 0 1-5 5h-5a5 5 0 0 1-5-5z"/><path fill="#e8833a" d="M21 12.5h3a3.5 3.5 0 0 1 0 7h-3v-2.2h3a1.3 1.3 0 0 0 0-2.6h-3z"/><ellipse cx="13.5" cy="9" rx="7.5" ry="2.5" fill="#5b3a29"/></svg>',

  // ---- 基岩版资源包：包裹盒 + 方块角标 ----
  mcpack:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#c08a4a" d="M4 9.5A1.5 1.5 0 0 1 5.5 8h16A1.5 1.5 0 0 1 23 9.5v14a1.5 1.5 0 0 1-1.5 1.5h-16A1.5 1.5 0 0 1 4 23.5z"/><path fill="#a8763a" d="M4 12.5h19v2H4z"/><rect x="18.5" y="16.5" width="11" height="11" rx="2.5" fill="#7cbd6b"/><path fill="#fff" d="M24 18l4 2.2l-4 2.2l-4-2.2z"/><path fill="#fff" d="M20 20.2l4 2.2l4-2.2v4.6l-4 2.2l-4-2.2z"/></svg>',

  // ---- 基岩版附加包：包裹盒 + 加号角标 ----
  mcaddon:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#c08a4a" d="M4 9.5A1.5 1.5 0 0 1 5.5 8h16A1.5 1.5 0 0 1 23 9.5v14a1.5 1.5 0 0 1-1.5 1.5h-16A1.5 1.5 0 0 1 4 23.5z"/><path fill="#a8763a" d="M4 12.5h19v2H4z"/><rect x="18.5" y="16.5" width="11" height="11" rx="2.5" fill="#7cbd6b"/><path fill="#fff" d="M22.6 18.5h2.8v2.1h2.1v2.8h-2.1v2.1h-2.8v-2.1h-2.1v-2.8h2.1z"/></svg>',

  // ---- 基岩版世界导出（`.mcworld`）。
  //
  // ⚠️ 这里**故意不画地球**。第一版画的是「蓝色圆球 + 几块绿色斑块」，
  //    在 1em 的尺寸下绿色斑块的形状看起来是**随机的脏点**，像发霉。
  //    改成 MC 自己的**等距草方块**：形状规整、一眼认得出是 Minecraft，
  //    而且和 `mcmeta` / `mcpack` 那些「盒子类」图标是同一个视觉家族。
  mcworld:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#7cbd6b" d="M16 3.5 28.5 10 16 16.5 3.5 10z"/><path fill="#8b5a2b" d="M3.5 10 16 16.5v12L3.5 22z"/><path fill="#6b4423" d="M28.5 10 16 16.5v12l12.5-6.5z"/><path fill="#5d8c3f" d="M9 7.6 13.6 10 9 12.4 4.4 10z"/><path fill="#5d8c3f" d="M18.6 12.4 23.2 14.8 18.6 17.2 14 14.8z"/></svg>',

  // ---- 蓝图：蓝图纸 + 网格 + 立方体 ----
  schematic:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#1b4c86" d="M3.5 6.5a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v19a2 2 0 0 1-2 2h-21a2 2 0 0 1-2-2z"/><path fill="#3e76b8" d="M10.5 4.5h.9v23h-.9zM21.5 4.5h.9v23h-.9zM3.5 11.5h25v.9h-25zM3.5 20.5h25v.9h-25z"/><path fill="#4aedd9" d="M16 9.5l6.5 3.5v6L16 22.5l-6.5-3.5v-6z"/><path fill="#1b4c86" d="M15.55 9.5h.9v6.5h-.9z"/><path fill="#1b4c86" d="M15.81 15.59L9.31 18.59l.38.82l6.5-3z"/><path fill="#1b4c86" d="M16.19 15.59l6.5 3l-.38.82l-6.5-3z"/></svg>',

  // ---- 区域文件：地图 + 区块网格 ----
  mca:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="#ede0c0" d="M3.5 7.5a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v17a2 2 0 0 1-2 2h-21a2 2 0 0 1-2-2z"/><path fill="#7cbd6b" d="M5.5 6.5h6.33v6h-6.33zM20.67 20h6.33v6h-6.33z"/><path fill="#c4b183" d="M11.83 5.5h.9v21h-.9zM20.17 5.5h.9v21h-.9zM3.5 12.5h25v.9h-25zM3.5 19.5h25v.9h-25z"/></svg>',
}
