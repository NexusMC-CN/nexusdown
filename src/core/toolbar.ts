import type { PasteMode } from './session/NexusdownEditorSession.js'

export type { PasteMode }

export type ToolbarGroup = 'history' | 'block' | 'inline' | 'extension' | 'indent' | (string & {})

/**
 * Identifier for a toolbar item.
 *
 * The built-in commands are named for discoverability and autocompletion, but
 * consumers registering their own extensions need to add buttons such as
 * `badge`. The union is therefore widened with `(string & {})`, which keeps the
 * literal suggestions while still accepting any string — narrowing the type to
 * the built-in names made a custom button a compile error.
 */
export type ToolbarCommand =
  | 'undo'
  | 'redo'
  | 'heading'
  | 'blockquote'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'code-block'
  | 'horizontal-rule'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'highlight'
  | 'link'
  | 'table'
  | 'image'
  | 'indent'
  | 'outdent'
  // Accept any other identifier so custom extension buttons type-check while the
  // built-in names above still autocomplete.
  | (string & {})

export interface ToolbarSession {
  commands: {
    undo: () => boolean
    redo: () => boolean
    setHeading: (level?: number) => boolean
    toggleBlockquote: () => boolean
    toggleBulletList: () => boolean
    toggleOrderedList: () => boolean
    toggleTaskList: () => boolean
    toggleCodeBlock: () => boolean
    setHorizontalRule: () => boolean
    toggleBold: () => boolean
    toggleItalic: () => boolean
    toggleStrike: () => boolean
    toggleCode: () => boolean
    toggleHighlight: () => boolean
    setLink: (href?: string, text?: string) => boolean
    insertTable: (rows?: number, cols?: number) => boolean
    insertImage: (src: string, alt?: string, title?: string) => boolean
    indent: () => boolean
    outdent: () => boolean
  }
  can: (command: ToolbarCommand) => boolean
  isActive: (name: string, attributes?: Record<string, unknown>) => boolean
  getSelectedText: () => string
  getLinkHref: () => string
  getPasteMode: () => PasteMode
  setPasteMode: (mode: PasteMode) => void
  onPasteModeChange?: (subscriber: (mode: PasteMode) => void) => () => void
}

export interface ToolbarContext {
  session: ToolbarSession
  headingLevel?: number
  linkHref?: string
  linkText?: string
  imageSrc?: string
  imageAlt?: string
  imageTitle?: string
  /** Insert an image file (upload callback or base64 fallback). */
  insertImageFile?: (file: File) => Promise<boolean>
}

export interface ToolbarItem {
  id: ToolbarCommand
  group: ToolbarGroup
  icon: string
  label: string
  execute: (context: ToolbarContext) => boolean
  isActive?: (context: ToolbarContext) => boolean
  isDisabled?: (context: ToolbarContext) => boolean
}

type ItemOptions = Omit<ToolbarItem, 'isDisabled'> & { disabledCommand?: ToolbarCommand }

function item(options: ItemOptions): ToolbarItem {
  const { disabledCommand, ...toolbarItem } = options
  return {
    ...toolbarItem,
    isDisabled: disabledCommand
      ? (context) => !context.session.can(disabledCommand)
      : undefined,
  }
}

export function createDefaultToolbarItems(): ToolbarItem[] {
  return [
    item({ id: 'undo', group: 'history', icon: 'lucide:undo-2', label: '撤销', execute: ({ session }) => session.commands.undo(), disabledCommand: 'undo' }),
    item({ id: 'redo', group: 'history', icon: 'lucide:redo-2', label: '重做', execute: ({ session }) => session.commands.redo(), disabledCommand: 'redo' }),
    item({ id: 'heading', group: 'block', icon: 'lucide:heading', label: '标题', execute: ({ session, headingLevel = 2 }) => session.commands.setHeading(headingLevel), isActive: ({ session, headingLevel = 2 }) => session.isActive('heading', { level: headingLevel }), disabledCommand: 'heading' }),
    item({ id: 'blockquote', group: 'block', icon: 'lucide:quote', label: '引用', execute: ({ session }) => session.commands.toggleBlockquote(), isActive: ({ session }) => session.isActive('blockquote'), disabledCommand: 'blockquote' }),
    item({ id: 'bullet-list', group: 'block', icon: 'lucide:list', label: '无序列表', execute: ({ session }) => session.commands.toggleBulletList(), isActive: ({ session }) => session.isActive('bulletList'), disabledCommand: 'bullet-list' }),
    item({ id: 'ordered-list', group: 'block', icon: 'lucide:list-ordered', label: '有序列表', execute: ({ session }) => session.commands.toggleOrderedList(), isActive: ({ session }) => session.isActive('orderedList'), disabledCommand: 'ordered-list' }),
    item({ id: 'task-list', group: 'extension', icon: 'lucide:list-checks', label: '任务列表', execute: ({ session }) => session.commands.toggleTaskList(), isActive: ({ session }) => session.isActive('taskList'), disabledCommand: 'task-list' }),
    item({ id: 'code-block', group: 'block', icon: 'lucide:code-xml', label: '代码块', execute: ({ session }) => session.commands.toggleCodeBlock(), isActive: ({ session }) => session.isActive('codeBlock'), disabledCommand: 'code-block' }),
    item({ id: 'horizontal-rule', group: 'block', icon: 'lucide:minus', label: '分隔线', execute: ({ session }) => session.commands.setHorizontalRule(), disabledCommand: 'horizontal-rule' }),
    item({ id: 'bold', group: 'inline', icon: 'lucide:bold', label: '粗体', execute: ({ session }) => session.commands.toggleBold(), isActive: ({ session }) => session.isActive('bold'), disabledCommand: 'bold' }),
    item({ id: 'italic', group: 'inline', icon: 'lucide:italic', label: '斜体', execute: ({ session }) => session.commands.toggleItalic(), isActive: ({ session }) => session.isActive('italic'), disabledCommand: 'italic' }),
    item({ id: 'strike', group: 'inline', icon: 'lucide:strikethrough', label: '删除线', execute: ({ session }) => session.commands.toggleStrike(), isActive: ({ session }) => session.isActive('strike'), disabledCommand: 'strike' }),
    item({ id: 'code', group: 'inline', icon: 'lucide:code', label: '行内代码', execute: ({ session }) => session.commands.toggleCode(), isActive: ({ session }) => session.isActive('code'), disabledCommand: 'code' }),
    item({ id: 'highlight', group: 'inline', icon: 'lucide:highlighter', label: '高亮', execute: ({ session }) => session.commands.toggleHighlight(), isActive: ({ session }) => session.isActive('highlight'), disabledCommand: 'highlight' }),
    item({ id: 'link', group: 'extension', icon: 'lucide:link', label: '链接', execute: ({ session, linkHref, linkText }) => session.commands.setLink(linkHref, linkText), isActive: ({ session }) => session.isActive('link'), disabledCommand: 'link' }),
    item({ id: 'table', group: 'extension', icon: 'lucide:table-2', label: '表格', execute: ({ session }) => session.commands.insertTable(), isActive: ({ session }) => session.isActive('table'), disabledCommand: 'table' }),
    item({ id: 'image', group: 'extension', icon: 'lucide:image', label: '图片', execute: ({ session, imageSrc, imageAlt, imageTitle }) => session.commands.insertImage(imageSrc ?? '', imageAlt, imageTitle), disabledCommand: 'image' }),
    item({ id: 'outdent', group: 'indent', icon: 'lucide:outdent', label: '减少缩进', execute: ({ session }) => session.commands.outdent(), disabledCommand: 'outdent' }),
    item({ id: 'indent', group: 'indent', icon: 'lucide:indent', label: '增加缩进', execute: ({ session }) => session.commands.indent(), disabledCommand: 'indent' }),
  ]
}
