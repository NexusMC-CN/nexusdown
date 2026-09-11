export type ToolbarGroup = 'history' | 'block' | 'inline' | 'extension'

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
  | 'underline'
  | 'superscript'
  | 'subscript'
  | 'color'
  | 'highlight'
  | 'link'
  | 'table'
  | 'image'

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
    toggleUnderline: () => boolean
    toggleSuperscript: () => boolean
    toggleSubscript: () => boolean
    setColor: (color?: string) => boolean
    setHighlight: (color?: string) => boolean
    setLink: (href?: string, text?: string) => boolean
    insertTable: (rows?: number, cols?: number) => boolean
    insertImage: (src: string, alt?: string, title?: string) => boolean
  }
  can: (command: ToolbarCommand) => boolean
  isActive: (name: string, attributes?: Record<string, unknown>) => boolean
  getSelectedText: () => string
  getLinkHref: () => string
}

export interface ToolbarContext {
  session: ToolbarSession
  headingLevel?: number
  linkHref?: string
  linkText?: string
  color?: string
  highlightColor?: string
  imageSrc?: string
  imageAlt?: string
  imageTitle?: string
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
    item({ id: 'underline', group: 'inline', icon: 'lucide:underline', label: '下划线', execute: ({ session }) => session.commands.toggleUnderline(), isActive: ({ session }) => session.isActive('underline'), disabledCommand: 'underline' }),
    item({ id: 'superscript', group: 'inline', icon: 'lucide:superscript', label: '上标', execute: ({ session }) => session.commands.toggleSuperscript(), isActive: ({ session }) => session.isActive('superscript'), disabledCommand: 'superscript' }),
    item({ id: 'subscript', group: 'inline', icon: 'lucide:subscript', label: '下标', execute: ({ session }) => session.commands.toggleSubscript(), isActive: ({ session }) => session.isActive('subscript'), disabledCommand: 'subscript' }),
    item({ id: 'color', group: 'extension', icon: 'lucide:palette', label: '文字颜色', execute: ({ session, color }) => session.commands.setColor(color ?? '#2563eb'), isActive: ({ session, color }) => color ? session.isActive('textStyle', { color }) : session.isActive('textStyle') }),
    item({ id: 'highlight', group: 'extension', icon: 'lucide:highlighter', label: '高亮', execute: ({ session, highlightColor }) => session.commands.setHighlight(highlightColor ?? '#fef08a'), isActive: ({ session, highlightColor }) => highlightColor ? session.isActive('highlight', { color: highlightColor }) : session.isActive('highlight') }),
    item({ id: 'link', group: 'extension', icon: 'lucide:link', label: '链接', execute: ({ session, linkHref, linkText }) => session.commands.setLink(linkHref, linkText), isActive: ({ session }) => session.isActive('link'), disabledCommand: 'link' }),
    item({ id: 'table', group: 'extension', icon: 'lucide:table-2', label: '表格', execute: ({ session }) => session.commands.insertTable(), isActive: ({ session }) => session.isActive('table'), disabledCommand: 'table' }),
    item({ id: 'image', group: 'extension', icon: 'lucide:image', label: '图片', execute: ({ session, imageSrc, imageAlt, imageTitle }) => session.commands.insertImage(imageSrc ?? '', imageAlt, imageTitle), disabledCommand: 'image' }),
  ]
}
