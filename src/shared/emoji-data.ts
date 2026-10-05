/**
 * 常用 emoji shortcode 表 —— **编辑器侧与渲染侧唯一共用的那一张**。
 *
 * ## 为什么放在 `shared/` 而不是各写一份
 *
 * 契约（`docs/dialect-extensions.md` 第 3 节）把「两侧共用同一张 shortcode 表」
 * 点名为这个功能**唯一的真风险**。这不是洁癖：如果编辑器用一张表、渲染器用
 * 另一张，就会出现「编辑器把 `:shrug:` 显示成 🤷、发布出去却是字面 `:shrug:`」
 * 或者反过来的情况 —— 正是本库要消灭的那类两侧不一致。所以只此一份。
 *
 * ## 为什么只收「常用集」，不收 `full`
 *
 * `emoji-datasource` / `markdown-it-emoji` 的 `full` 集有 **三千多个** shortcode，
 * 几十 KB，且绝大多数（花札 `🎴`、各色旗帜、冷门动物）在技术社区几乎不出现。
 * 全塞进主包等于让**每个消费方**（包括不用 emoji 的）都替冷门功能付体积税。
 *
 * 取舍：只收**日常与开发语境里高频**的 shortcode。收录依据三类：
 *
 *   1. 面部表情与手势（论坛互动的主战场）；
 *   2. 心形与状态符号（`✅` `❌` `⚠️` `🚀` `🔥`）—— issue / 文档里出现频率极高；
 *   3. 常见自然、食物、物品（点缀用）。
 *
 * 一共 **226** 个（不到 `full` 的十分之一，主包体积代价约几 KB）。
 * 想扩表就往下加行 —— 两侧会自动同时生效，因为它们 import 的就是这里。
 * 加/删条目后请同步这个数字（`tests/cm/emoji.test.ts` 里有一条断言守着它）。
 *
 * ## 字形直接写 Unicode，不依赖图片资源
 *
 * 用 Unicode 字形（`😄`）而不是图片 URL：图片要么联网、要么随包分发几百 KB
 * 资源；Unicode 由系统字体提供，离线可用，屏幕阅读器也能读
 * （无障碍名由 widget 的 `aria-label` 补上）。
 *
 * ⚠️ 少数带变体选择符（VS16，`\uFE0F`）的码点（`❤️` `☀️`）这里**显式带上** ——
 * 去掉它有些平台会渲染成单色的文本字形，和旁边彩色的不一致。
 */
const DATA: Record<string, string> = {
  // -------------------------------------------------------------------------
  // 面部表情（互动主战场，收得最全）
  // -------------------------------------------------------------------------
  smile: '😄',
  smiley: '😃',
  grin: '😁',
  laughing: '😆',
  sweat_smile: '😅',
  rofl: '🤣',
  joy: '😂',
  slightly_smiling_face: '🙂',
  upside_down_face: '🙃',
  wink: '😉',
  blush: '😊',
  innocent: '😇',
  heart_eyes: '😍',
  star_struck: '🤩',
  kissing_heart: '😘',
  yum: '😋',
  stuck_out_tongue: '😛',
  zany_face: '🤪',
  money_mouth_face: '🤑',
  hugs: '🤗',
  hand_over_mouth: '🤭',
  thinking: '🤔',
  raised_eyebrow: '🤨',
  neutral_face: '😐',
  smirk: '😏',
  roll_eyes: '🙄',
  grimacing: '😬',
  relieved: '😌',
  pensive: '😔',
  sleeping: '😴',
  mask: '😷',
  hot_face: '🥵',
  cold_face: '🥶',
  dizzy_face: '😵',
  exploding_head: '🤯',
  partying_face: '🥳',
  sunglasses: '😎',
  nerd_face: '🤓',
  confused: '😕',
  worried: '😟',
  frowning_face: '☹️',
  open_mouth: '😮',
  astonished: '😲',
  flushed: '😳',
  pleading_face: '🥺',
  cry: '😢',
  sob: '😭',
  scream: '😱',
  rage: '😡',
  angry: '😠',
  skull: '💀',
  poop: '💩',
  clown_face: '🤡',
  ghost: '👻',
  alien: '👽',
  robot: '🤖',
  see_no_evil: '🙈',
  hear_no_evil: '🙉',
  speak_no_evil: '🙊',

  // -------------------------------------------------------------------------
  // 手势与身体
  // -------------------------------------------------------------------------
  wave: '👋',
  raised_back_of_hand: '🤚',
  raised_hand_with_fingers_splayed: '🖐️',
  hand: '✋',
  raised_hand: '✋',
  vulcan_salute: '🖖',
  ok_hand: '👌',
  v: '✌️',
  crossed_fingers: '🤞',
  metal: '🤘',
  call_me_hand: '🤙',
  point_left: '👈',
  point_right: '👉',
  point_up_2: '👆',
  point_down: '👇',
  point_up: '☝️',
  // ⚠️ 这里**故意不收** GitHub 的 `:+1:` / `:-1:`：lezer 的 `Emoji` 扩展字符集是
  // `[a-zA-Z_0-9]`，不含 `+` / `-`，收进来会变成「渲染侧认、编辑器侧不认」的两侧
  // 不一致（正是本库要消灭的东西）。想用就用同义的 `:thumbsup:` / `:thumbsdown:`。
  thumbsup: '👍',
  thumbsdown: '👎',
  fist: '✊',
  facepunch: '👊',
  clap: '👏',
  raised_hands: '🙌',
  open_hands: '👐',
  handshake: '🤝',
  pray: '🙏',
  writing_hand: '✍️',
  muscle: '💪',
  eyes: '👀',
  shrug: '🤷',
  facepalm: '🤦',

  // -------------------------------------------------------------------------
  // 心形
  // -------------------------------------------------------------------------
  heart: '❤️',
  orange_heart: '🧡',
  yellow_heart: '💛',
  green_heart: '💚',
  blue_heart: '💙',
  purple_heart: '💜',
  black_heart: '🖤',
  broken_heart: '💔',
  two_hearts: '💕',
  revolving_hearts: '💞',
  heartbeat: '💓',
  heartpulse: '💗',
  sparkling_heart: '💖',
  cupid: '💘',

  // -------------------------------------------------------------------------
  // 状态 / 符号（issue 与文档里的高频符号）
  // -------------------------------------------------------------------------
  fire: '🔥',
  sparkles: '✨',
  star: '⭐',
  star2: '🌟',
  dizzy: '💫',
  boom: '💥',
  sweat_drops: '💦',
  bomb: '💣',
  speech_balloon: '💬',
  thought_balloon: '💭',
  zzz: '💤',
  white_check_mark: '✅',
  heavy_check_mark: '✔️',
  x: '❌',
  warning: '⚠️',
  no_entry: '⛔',
  question: '❓',
  exclamation: '❗',
  100: '💯',
  infinity: '♾️',
  recycle: '♻️',
  sparkle: '❇️',

  // -------------------------------------------------------------------------
  // 箭头
  // -------------------------------------------------------------------------
  arrow_up: '⬆️',
  arrow_down: '⬇️',
  arrow_left: '⬅️',
  arrow_right: '➡️',
  arrows_clockwise: '🔃',
  arrows_counterclockwise: '🔄',
  repeat: '🔁',
  back: '🔙',
  soon: '🔜',
  top: '🔝',

  // -------------------------------------------------------------------------
  // 时间 / 自然
  // -------------------------------------------------------------------------
  watch: '⌚',
  alarm_clock: '⏰',
  hourglass: '⌛',
  stopwatch: '⏱️',
  calendar: '📅',
  sun: '☀️',
  cloud: '☁️',
  zap: '⚡',
  snowflake: '❄️',
  droplet: '💧',
  ocean: '🌊',
  umbrella: '☂️',
  rainbow: '🌈',
  crescent_moon: '🌙',
  earth_africa: '🌍',
  globe_with_meridians: '🌐',
  mountain: '⛰️',

  // -------------------------------------------------------------------------
  // 植物 / 动物
  // -------------------------------------------------------------------------
  seedling: '🌱',
  evergreen_tree: '🌲',
  deciduous_tree: '🌳',
  four_leaf_clover: '🍀',
  maple_leaf: '🍁',
  rose: '🌹',
  cherry_blossom: '🌸',
  dog: '🐶',
  cat: '🐱',
  fox_face: '🦊',
  bear: '🐻',
  panda_face: '🐼',
  tiger: '🐯',
  lion: '🦁',
  unicorn: '🦄',
  bee: '🐝',
  butterfly: '🦋',
  fish: '🐟',
  whale: '🐳',

  // -------------------------------------------------------------------------
  // 食物
  // -------------------------------------------------------------------------
  apple: '🍎',
  watermelon: '🍉',
  strawberry: '🍓',
  banana: '🍌',
  avocado: '🥑',
  bread: '🍞',
  hamburger: '🍔',
  pizza: '🍕',
  ramen: '🍜',
  cake: '🍰',
  birthday: '🎂',
  coffee: '☕',
  beer: '🍺',
  wine_glass: '🍷',

  // -------------------------------------------------------------------------
  // 物品 / 开发相关
  // -------------------------------------------------------------------------
  rocket: '🚀',
  airplane: '✈️',
  car: '🚗',
  trophy: '🏆',
  first_place_medal: '🥇',
  dart: '🎯',
  video_game: '🎮',
  musical_note: '🎵',
  headphones: '🎧',
  art: '🎨',
  camera: '📷',
  tv: '📺',
  iphone: '📱',
  computer: '💻',
  bulb: '💡',
  key: '🔑',
  lock: '🔒',
  hammer: '🔨',
  wrench: '🔧',
  gear: '⚙️',
  memo: '📝',
  pencil2: '✏️',
  paperclip: '📎',
  scissors: '✂️',
  folder: '📁',
  page_facing_up: '📄',
  books: '📚',
  email: '✉️',
  package: '📦',
  chart_with_upwards_trend: '📈',
  link: '🔗',
  bell: '🔔',
  trash: '🗑️',
  moneybag: '💰',
  gem: '💎',
  gift: '🎁',
  tada: '🎉',
  ticket: '🎫',
  crown: '👑',
  ring: '💍',
  checkered_flag: '🏁',
}

/**
 * `shortcode（不含冒号） → 字形`。
 *
 * 用 `Map` 而不是普通对象：查表在热路径上（每个 `Emoji` 节点一次），
 * `Map.get` 不吃原型链 —— `Record` 用 `in` 判断时，`constructor` / `toString`
 * 这类键名会被原型上的属性意外命中。
 */
export const EMOJI_SHORTCODES: ReadonlyMap<string, string> = new Map(Object.entries(DATA))

/**
 * 行内 shortcode 的正则：`:` + 字母/数字/下划线 + `:`。
 *
 * ⚠️ **字符集必须与编辑器侧 lezer 的 `Emoji` 扩展逐字一致。**
 * `@lezer/markdown` 1.7.2 的 `Emoji` 内联解析器用的是 `/^[a-zA-Z_0-9]+:/`，
 * 本正则的 `[a-zA-Z0-9_]` 与它是同一个字符集（顺序不同不影响语义）。
 *
 * 为什么非要一致：如果这边多放行一个字符（比如 GitHub 的 `:+1:`），
 * 就会出现「渲染器认、编辑器不认」—— 作者在编辑器里看到字面 `:+1:`，
 * 发布出去却变成 👍。契约把这类两侧不一致点名为本库存在理由的反面，
 * 所以宁可不支持 `+1` 也不制造它。
 */
export const EMOJI_SHORTCODE_RE = /:([a-zA-Z0-9_]+):/g
