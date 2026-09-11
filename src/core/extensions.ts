import Link from '@tiptap/extension-link'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import type { AnyExtension } from '@tiptap/core'

export function createNexusdownExtensions(): AnyExtension[] {
  return [StarterKit.configure({ link: false }), Link, TaskList, TaskItem, Markdown]
}
