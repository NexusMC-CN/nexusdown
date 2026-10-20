<script lang="ts">
/**
 * `<DemoStage>` —— 演示画布外壳。**工具栏悬停卡片**和 **Motion Lab** 都用它。
 *
 * ## 它负责三件事
 *
 * 1. **画布**（`.demo-stage`）：固定 120×44 的取景框 + 1px 边框。所有演示并排时
 *    尺寸必须完全一致，否则鼠标在工具栏上移动时卡片会忽大忽小地跳。
 * 2. **镜头层**（`.demo-cam`）：演示自己的 `transform`（斜体 `skewX`、引用 `scaleY`）
 *    不会波及画布边框。
 * 3. **注入时长**（`--demo-dur`）：`DemoSpec.duration` → CSS 变量，
 *    `demos.css` 里所有动画都读它。这就是"删掉散落的 `2.8s` 字面量"的落点 ——
 *    改时长只改注册表里那个数，不存在"某一段忘了改"。
 *
 * ## 为什么用 render 函数而不是 `<template>`
 *
 * 演示的 VNode 是 `DemoSpec.render()` 现算出来的（它在 `demos.ts` 里，一个纯函数）。
 * 用模板写就是 `<component :is="spec.render()" />` —— 那会在每次渲染时把 VNode
 * 当成"组件类型"再走一遍解析，语义绕。这里直接把 VNode 塞进 children 数组，
 * 一眼看得出"这是同一个 vnode 树，只是外面套了两层壳"。
 *
 * ## 为什么样式不在这里
 *
 * 样式全在 `demos.css`（全局），理由见那个文件的头部：`demos.ts` 用 `h()` 造出来的
 * 元素拿不到任何组件的 `data-v-*` 标记，`<style scoped>` 一条都命中不了。
 * 本组件**故意没有** `<style>` 块 —— 有的话就会有人往里面加演示样式。
 */
import { defineComponent, h, type PropType } from 'vue'
import type { DemoSpec } from './demos'

export default defineComponent({
  name: 'NexusdownDemoStage',

  props: {
    /** 要演哪一段。工具栏传 `getDemo(button.demo)`，Lab 传选中的那一段。 */
    spec: {
      type: Object as PropType<DemoSpec>,
      required: true,
    },
  },

  setup(props) {
    return () =>
      h(
        'div',
        {
          class: 'demo-stage',
          'data-demo': props.spec.id,
          /* 时长从注册表来，不在 CSS 里写死（见文件头第 3 点）。 */
          style: { '--demo-dur': `${props.spec.duration}ms` },
        },
        [h('div', { class: 'demo-cam' }, [props.spec.render()])],
      )
  },
})
</script>
