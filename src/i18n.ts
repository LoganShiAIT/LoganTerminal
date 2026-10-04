import { useSettingsStore } from "./stores/settingsStore";

export type Locale = "zh" | "en";

/**
 * Translations keyed by the English source string.
 *
 * Keying on the English text (rather than invented ids) means a missing entry
 * degrades to readable English instead of a raw `settings.theme.label`, and
 * the call sites stay legible: `t("New tab")` reads like the UI it renders.
 * `{name}`-style placeholders are substituted by `t`.
 */
const ZH: Record<string, string> = {
  "Documents": "文档",
  "Document": "文档",
  "Markdown file": "Markdown 文件",
  "Temporary snapshot": "临时快照",
  "Unsaved draft snapshot": "未保存草稿快照",
  "Scratch snapshot": "草稿快照",
  "Terminal selection snapshot": "终端选区快照",
  "Last command output snapshot": "上一条命令输出快照",
  "Terminal selection": "终端选区",
  "Last command output": "上一条命令输出",
  "Read document": "阅读文档",
  "Read beside terminal": "终端旁阅读",
  "Reader appearance": "阅读外观",
  "Follow theme": "跟随主题",
  "Paper": "纸张",
  "Dark": "深色",
  "Outline": "目录",
  "Close outline": "关闭目录",
  "On this page": "本页目录",
  "No headings": "暂无标题",
  "Return to terminal": "返回终端",
  "Close reader": "关闭阅读区",
  "Resize reader": "调整阅读区宽度",
  "Read-only": "只读",
  "Read error": "读取失败",
  "Reload": "重新加载",
  "Retry": "重试",
  "No content": "暂无内容",
  "Copy code": "复制代码",
  "Copy TeX": "复制 TeX",
  "Copy failed": "复制失败",
  "External image": "外部图片",
  "Open externally": "外部打开",
  "Loading image…": "图片加载中…",
  "Enlarge image": "放大图片",
  "Image unavailable": "图片不可用",
  "Math scratch": "数学草稿",
  "Open Markdown document — file finder": "打开 Markdown 文档 — 文件搜索",
  "Read terminal selection / last output": "阅读终端选区 / 上一条命令输出",
  "Read terminal text beside terminal": "在终端旁阅读选区 / 输出",
  "Toggle preview / source": "切换预览 / 原文",
  "Toggle document outline": "显示 / 隐藏文档目录",
  "Reload document": "重新加载文档",
  "Select text and try again": "请先选择终端文字，再重试",
  "Document exceeds 1 MiB": "文档超过 1 MiB 限制",

  // --- header / status cluster ---------------------------------------
  "Toggle sidebar ({key})": "显示/隐藏侧栏（{key}）",
  "Resize sidebar": "拖动调整侧栏宽度",
  "Settings ({key})": "设置（{key}）",
  "Broadcast is ON — keystrokes go to every pane in this tab. Click to turn off.":
    "广播输入已开启——按键会送到本标签页的每个分屏。点击关闭。",
  broadcast: "广播",
  "{n} waiting": "{n} 个待处理",
  "Panes waiting on you (bell / long command done) — click to jump, {key} for the full overview":
    "等你处理的分屏（响铃 / 长命令完成）——点击跳转，{key} 查看总览",
  "Git branch of {where}": "{where} 的 Git 分支",
  " · uncommitted: {added} new, {modified} modified, {deleted} deleted":
    " · 未提交：{added} 新增，{modified} 修改，{deleted} 删除",
  " · clean": " · 干净",
  " — click for the diff panel ({key})": " — 点击打开差异面板（{key}）",
  "Detected agent: {name}": "检测到 agent：{name}",
  "Claude cache window": "Claude 缓存窗口内",
  "Cache window passed": "缓存窗口已过",
  " · since the agent last finished · click to reset":
    " · 从 agent 上次答完算起 · 点击重置",
  "Agent is working — the timer starts when it goes idle":
    "Agent 正在工作——等它空闲下来才开始计时",
  "Start idle timer": "开始空闲计时",
  timer: "计时",
  working: "工作中",
  "Last command's exit status": "上一条命令的退出码",
  "Last command's duration": "上一条命令的耗时",
  "session {id}": "会话 {id}",
  "exited — {key} to close": "已退出——{key} 关闭",
  shell: "shell",
  "starting…": "启动中…",
  "no session": "无会话",
  cwd: "当前目录",

  // --- welcome screen -------------------------------------------------
  "a terminal built for AI coding agents": "为 AI 编程 agent 打造的终端",
  "New Terminal": "新建终端",
  commands: "命令面板",
  "new tab": "新标签页",
  split: "分屏",
  "zoom pane": "分屏最大化",
  find: "查找",
  "find files": "找文件",
  clear: "清屏",
  "jump prompts": "跳转提示符",
  files: "文件",
  assets: "素材",
  jump: "切换",
  settings: "设置",

  // --- tabs -----------------------------------------------------------
  "{path} — exited": "{path} — 已退出",
  "{n} panes": "{n} 个分屏",
  "New output": "有新输出",
  "agent: {name}": "agent：{name}",
  "Close tab (all panes)": "关闭标签页（含所有分屏）",
  "New terminal ({key})": "新建终端（{key}）",
  Zoomed: "已最大化",

  // --- file tree ------------------------------------------------------
  Files: "文件",
  "Hide dotfiles": "隐藏点文件",
  "Show dotfiles": "显示点文件",
  Refresh: "刷新",
  "{path} — click to insert": "{path} — 点击插入",
  "{name} — open": "{name} — 打开",
  "{name} — insert path": "{name} — 插入路径",
  "Attach to review": "加入审阅",
  "New terminal here — {path}": "在这里新建终端 —— {path}",
  "New terminal in {name}": "在 {name} 里新建终端",
  "Split the focused pane, starting in {name}": "分屏并在 {name} 里启动",
  "Find file or folder ({key})": "检索文件/文件夹（{key}）",

  // --- file finder ----------------------------------------------------
  repo: "仓库",
  "Find a file or folder — fuzzy, matches the whole path":
    "检索文件或文件夹 —— 模糊匹配整条路径",
  Searching: "搜索中",
  "Searching…": "搜索中…",
  "Nothing matches": "没有匹配项",
  in: "范围",
  "↑ parent": "↑ 上一级",
  "⌂ home": "⌂ 主目录",
  "Search from the parent folder": "从上一级目录搜索",
  "Search from your home folder": "从主目录搜索",
  All: "全部",
  Folders: "文件夹",
  "Insert path into the terminal": "把路径插入终端",
  "cd into this folder": "cd 进这个文件夹",
  "cd into the containing folder": "cd 进它所在的文件夹",
  "Git repository": "Git 仓库",
  reveal: "定位",
  "insert path": "插入路径",
  attach: "加入审阅",
  cd: "切换目录",
  "partial scan": "扫描未完",

  // --- math -----------------------------------------------------------
  "Formulas printed in the terminal land here on their own; hover the underline in the output for a quick look. Or select any text and press {key} — or just type below.": "终端里打印的公式会自动落到这里；把鼠标停在输出里的下划线上就能快速看一眼。也可以选中任意文字按 {key} —— 或者直接在下面输入。",
  Math: "公式",
  "From terminal": "取终端内容",
  Preview: "预览",
  Source: "源码",
  Copy: "复制",
  Copied: "已复制",
  "Render the terminal selection — falls back to the last command's output ({key})":
    "渲染终端选区——没有选区时取上一条命令的输出（{key}）",
  "Hide the editor": "收起编辑框",
  "Show the editor": "展开编辑框",
  "Copy the LaTeX / markdown source": "复制 LaTeX / markdown 源码",
  "waiting for a formula in the terminal…": "等待终端里出现公式…",
  empty: "空",
  "from terminal selection": "来自终端选区",
  "from last command output": "来自上一条命令的输出",
  "auto — following terminal output": "自动 —— 正在跟随终端输出",
  "edited here — auto-follow paused": "已手动编辑 —— 自动跟随已暂停",
  "scratch — edited here": "草稿 —— 手动编辑",
  "scratch — the next formula replaces it": "上次的草稿 —— 下一个公式会覆盖它",
  resume: "恢复跟随",
  "Drop this scratch and follow the terminal again":
    "丢掉这份草稿，重新跟随终端",
  "Load an example": "载入示例",
  "$$E = mc^2$$ — LaTeX ($…$, $$…$$, \\[…\\]) and markdown both render below.":
    "$$E = mc^2$$ —— LaTeX（$…$、$$…$$、\\[…\\]）和 markdown 都会渲染在下方。",

  // --- right panel ----------------------------------------------------
  Assets: "素材",
  Review: "审阅",
  Diff: "差异",

  // --- asset panel ----------------------------------------------------
  "copy or screenshot to collect": "复制或截图即可收集",
  "{clips} clipboard · {shots} shots": "剪贴板 {clips} · 截图 {shots}",
  Clipboard: "剪贴板",
  "Copy text or an image to see it here.": "复制文字或图片后会出现在这里。",
  Screenshots: "截图",
  "Take a screenshot to have it appear here.": "截个图就会出现在这里。",
  "Insert Path": "插入路径",
  "Copy Path": "复制路径",
  Open: "打开",
  Close: "关闭",
  "Click to insert into terminal": "点击插入到终端",
  Remove: "移除",
  "Preview full size": "查看大图",
  "Insert as file path (writes a temp file, capped history)":
    "作为文件路径插入（写入临时文件，历史有上限）",

  // --- review panel ---------------------------------------------------
  "drop files or folders to attach": "拖入文件或文件夹以附加",
  "{n} attached": "已附加 {n} 个",
  "File Review": "文件审阅",
  "Select a text file inside this folder to review it.":
    "选择这个文件夹里的文本文件来审阅。",
  "This path cannot be reviewed as text.": "这个路径无法作为文本审阅。",
  "This file is larger than 1MB, so it was not loaded.":
    "文件超过 1MB，未加载。",
  "Saved.": "已保存。",
  "No file selected": "未选择文件",
  "Attach or select a path to review": "拖入或选择一个路径来审阅",
  "Loading...": "加载中…",
  "Select a text file to review.": "选择一个文本文件来审阅。",
  "Remove attachment": "移除附件",
  "{n} attached for review": "已附上 {n} 个待审阅",
  unsaved: "未保存",
  Save: "保存",
  "Drop files or folders here to review them.":
    "把文件或文件夹拖到这里来审阅。",
  "Drag to resize · double-click to reset": "拖动调整大小 · 双击复位",
  "Render as markdown": "渲染 markdown",
  "Edit the source text": "编辑源文本",

  // --- diff panel -----------------------------------------------------
  "vs {base}": "对比 {base}",
  "No commits beyond {base}.": "没有超出 {base} 的提交。",
  "the base branch": "基线分支",
  Changes: "改动",
  "No textual changes (empty or binary file).": "没有文本改动（空文件或二进制）。",
  "Refresh (also refreshes on every prompt)": "刷新（每次提示符也会自动刷新）",
  "Working tree clean — nothing uncommitted.": "工作区干净 —— 没有未提交的改动。",
  "No active shell directory yet.": "还没有活动的 shell 目录。",
  "{n} files": "{n} 个文件",
  "Open in review": "在审阅里打开",
  "Collapse all": "全部折叠",
  "Expand all": "全部展开",
  "Loading…": "加载中…",
  new: "新增",
  bin: "二进制",

  // --- diff panel: history --------------------------------------------
  History: "历史",
  "{n} commits": "{n} 条提交",
  "{n} ahead of {base}": "领先 {base} {n} 条",
  "No commits yet.": "还没有提交。",
  "No files here — merge commits list their changes on the parents.":
    "这里没有文件 —— 合并提交的改动记在它的父提交上。",

  // --- agent dashboard ------------------------------------------------
  "waiting on you": "等你处理",
  running: "运行中",
  exited: "已退出",
  idle: "空闲",
  "{panes} panes · {waiting} waiting": "{panes} 个分屏 · {waiting} 个待处理",
  Agents: "Agent",
  "Uncommitted changes: new / modified / deleted": "未提交改动：新增 / 修改 / 删除",
  "Unseen output": "未查看的输出",
  "Waiting on you since this agent went idle": "该 agent 空闲等待你输入的时长",

  // --- worktree modal -------------------------------------------------
  // Split around the command name, which renders in a mono span.
  "run ": "在里面运行 ",
  " in it": "",
  Worktrees: "Worktree",
  "Task name — e.g. fix-login, 重构侧栏": "任务名 —— 例如 fix-login、重构侧栏",
  "Nothing usable in that name yet.": "这个名字还提取不出可用的分支名。",
  "Working…": "处理中…",
  "Create worktree": "创建 worktree",
  "Creates a sibling worktree on a new branch — agents work in parallel without touching your checkout.":
    "在新分支上创建一个同级 worktree —— agent 并行工作，不碰你当前的检出。",
  Merge: "合并",
  "Finish: merge into the main checkout, remove the worktree, delete the branch. Refuses if dirty; a conflicting merge is aborted automatically.":
    "收尾：合并回主检出、移除 worktree、删除分支。工作区有改动会拒绝；合并冲突会自动 abort。",
  "git worktree remove — refuses if the tree is dirty; the branch survives":
    "git worktree remove —— 工作区有改动会拒绝；分支会保留",

  // --- drop overlay ---------------------------------------------------
  "Drop to attach": "松手加入审阅",
  "Hold Shift to insert paths into the terminal instead.":
    "按住 Shift 改为把路径插入终端。",

  // --- terminal -------------------------------------------------------
  "Previous match (⇧↩)": "上一个匹配（⇧↩）",
  "Next match (↩)": "下一个匹配（↩）",
  "Scroll to bottom": "滚到底部",
  "Drag to resize": "拖动调整大小",
  "[process exited]": "[进程已退出]",
  "Command finished": "命令已完成",
  "Command failed (exit {code})": "命令失败（退出码 {code}）",
  "{duration} in {where}": "{where} 里耗时 {duration}",
  "{name} needs attention": "{name} 需要你处理",
  "Terminal bell": "终端响铃",
  "in {where}": "在 {where}",

  // --- command palette ------------------------------------------------
  "Type a command… themes, tabs, effects, anything":
    "输入命令…… 主题、标签页、特效，什么都行",
  navigate: "移动",
  run: "执行",
  close: "关闭",
  "{n} commands": "{n} 条命令",
  "No matching commands": "没有匹配的命令",
  Recent: "最近",
  Tabs: "标签页",
  Panes: "分屏",
  Terminal: "终端",
  View: "视图",
  Prompts: "提示词",
  Appearance: "外观",
  "Currently active": "当前生效",
  "Go to pane needing attention ({n} waiting)": "跳到需要处理的分屏（{n} 个待处理）",
  "{agent} needs attention — tab {n}{where}": "{agent} 需要处理 —— 标签页 {n}{where}",
  "Agent overview — every pane, state, branch": "Agent 总览 —— 每个分屏的状态与分支",
  "Worktrees — new agent worktree / manage": "Worktree —— 新建 agent worktree / 管理",
  "Start/reset idle timer": "开始/重置空闲计时",
  "Launch {name} — new tab · {cmd}": "启动 {name} —— 新标签页 · {cmd}",
  "Launch {name} — split pane · {cmd}": "启动 {name} —— 分屏 · {cmd}",
  "Launch agents with permission prompts bypassed": "启动 agent 时跳过权限确认",
  "New fleet tab — {panes}, {cmd}": "新建 fleet 标签页 —— {panes}，{cmd}",
  "2 panes": "2 分屏",
  "2×2 grid": "2×2 宫格",
  "running `{cmd}`": "运行 `{cmd}`",
  "plain shells": "纯 shell",
  "Go to tab {n} — {where}": "切到标签页 {n} —— {where}",
  "New tab": "新建标签页",
  "Close current tab": "关闭当前标签页",
  "Next tab": "下一个标签页",
  "Previous tab": "上一个标签页",
  "Split pane right": "向右分屏",
  "Split pane down": "向下分屏",
  "Close pane (last pane closes the tab)": "关闭分屏（最后一个分屏会关掉标签页）",
  "Focus next pane": "聚焦下一个分屏",
  "Toggle pane zoom (maximize)": "切换分屏最大化",
  "Toggle broadcast input (type into all panes)": "切换广播输入（一次输入送到所有分屏）",
  "Clear terminal": "清屏",
  "Find in scrollback": "在回滚缓冲里查找",
  "Jump to previous prompt": "跳到上一个提示符",
  "Jump to next prompt": "跳到下一个提示符",
  "Select last command output": "选中上一条命令的输出",
  "Toggle long-command notifications": "切换长命令通知",
  "Toggle bell notifications": "切换响铃通知",
  "Increase font size": "增大字号",
  "Decrease font size": "减小字号",
  "Reset font size": "重置字号",
  "Find file or folder in this project": "在本项目里检索文件/文件夹",
  "Toggle sidebar": "显示/隐藏侧栏",
  "Show file tree": "打开文件树",
  "Show assets panel": "打开素材面板",
  "Show review panel": "打开审阅面板",
  "Show git diff panel": "打开 Git 差异面板",
  "Render selection as math / markdown": "把选区渲染成公式 / markdown",
  "Toggle inline math underline in terminal output": "切换终端输出里的公式下划线",
  "Toggle math panel auto-follow": "切换公式面板自动跟随",
  "Open settings": "打开设置",
  "Insert prompt: {title}": "插入提示词：{title}",
  "Theme: {name}": "主题：{name}",
  "Accent: Auto (theme default)": "强调色：自动（跟随主题）",
  "Accent: {name}": "强调色：{name}",
  "Cursor: {name}": "光标：{name}",
  "Toggle cursor blink": "切换光标闪烁",
  "Toggle ambient motion": "切换背景动效",
  "Toggle CRT mode": "切换 CRT 模式",
  "Animation speed: {speed}×": "动画速度：{speed}×",
  "Language: {name}": "语言：{name}",
  Coral: "珊瑚",
  Blue: "蓝",
  Green: "绿",
  Violet: "紫",
  Pink: "粉",
  Teal: "青",
  Block: "方块",
  Bar: "竖线",
  Underline: "下划线",

  // --- settings -------------------------------------------------------
  Settings: "设置",
  "Close (esc)": "关闭（esc）",
  "Changes apply instantly and are remembered across restarts. Tip: everything here is also in the command palette ({key}).":
    "改动即时生效并会记住。提示：这里的一切在命令面板（{key}）里也有。",
  Language: "语言",
  中文: "中文",
  English: "English",
  Theme: "主题",
  "Window material": "窗口材质",
  Solid: "实色",
  Glass: "玻璃",
  "Background opacity": "背景不透明度",
  "Applying…": "应用中…",
  "Blurs the desktop behind the window (macOS Vibrancy / Windows Acrylic)":
    "模糊窗口后面的桌面（macOS Vibrancy / Windows Acrylic）",
  "Native glass is unavailable in this environment — showing a solid background.":
    "当前环境不支持原生玻璃——已显示实色背景。",
  "Glass couldn't be applied — showing a solid background. Select Glass again to retry.":
    "玻璃材质应用失败——已显示实色背景。再次选择“玻璃”可重试。",
  "Background blur — frost the desktop behind the window":
    "背景模糊 —— 将窗口后面的桌面磨砂",
  "Off shows the desktop crisply through the tint; on uses the native frost (macOS Vibrancy / Windows Acrylic)":
    "关闭时桌面透过着色清晰可见；开启时使用原生磨砂（macOS Vibrancy / Windows Acrylic）",
  "Only applies in glass mode": "仅在玻璃模式下生效",
  Accent: "强调色",
  auto: "自动",
  "Use the theme's own accent": "使用主题自带的强调色",
  "Pick a custom accent color": "自定义强调色",
  "custom…": "自定义…",
  "Font size": "字号",
  "Smaller ({key})": "更小（{key}）",
  "Larger ({key})": "更大（{key}）",
  "Reset ({key})": "重置（{key}）",
  reset: "重置",
  Cursor: "光标",
  "Blinking cursor": "光标闪烁",
  Effects: "特效",
  "Animation speed": "动画速度",
  "Normal speed": "正常速度",
  "Slower, more deliberate": "更慢、更从容",
  Snappier: "更利落",
  "Retimes the app's own motion — panel swaps, ambient drift, the header sweep. Terminal output is never delayed.":
    "调整界面自身的动效节奏 —— 面板切换、背景漂移、顶栏扫光。终端输出不受任何影响。",
  "Ambient motion — drifting grid & floating glow": "背景动效 —— 漂移网格与浮动光晕",
  "Respects the system reduced-motion preference": "遵循系统的“减弱动态效果”设置",
  "CRT mode — retro scanlines over the terminal": "CRT 模式 —— 终端上的复古扫描线",
  Notifications: "通知",
  "Notify when a long command finishes out of view": "长命令在视线外完成时通知",
  "Commands over 10s, when the window is unfocused or the tab is hidden. Needs shell integration (zsh, or bash ≥ 4.4).":
    "超过 10 秒的命令，且窗口失焦或标签页隐藏时。需要 shell 集成（zsh，或 bash ≥ 4.4）。",
  "Notify on terminal bell out of view": "终端响铃在视线外时通知",
  "Agent CLIs ring the bell when they need input. At most one toast per pane per 30s.":
    "agent CLI 需要输入时会响铃。每个分屏 30 秒最多一条。",
  "Underline LaTeX in terminal output, preview on hover":
    "给终端输出里的 LaTeX 加下划线，悬停预览",
  "Formulas printed by an agent get a dotted underline; hover shows them typeset, click sends them to the Math panel.":
    "agent 打印的公式会有虚线下划线；悬停显示排版结果，点击送进公式面板。",
  "Math panel follows the newest formula automatically": "公式面板自动跟随最新的公式",
  "Pauses itself while you have unsaved edits in the panel.":
    "当面板里有未保存的编辑时会自动暂停。",
  "Fleet command": "Fleet 命令",
  'Auto-run in every pane of a new fleet tab ({key} → "New fleet tab"). Leave empty for plain shells.':
    "在新建 fleet 标签页的每个分屏里自动运行（{key} → “新建 fleet 标签页”）。留空则只开普通 shell。",
  "Save prompts you feed your agents often — insert them from the command palette ({key}) into the focused terminal.":
    "把常用的提示词存下来 —— 从命令面板（{key}）插入到当前终端。",
  "Delete prompt": "删除提示词",
  "Prompt title": "提示词标题",
  "Prompt text (multi-line ok — it inserts as one bracketed paste)":
    "提示词内容（可多行 —— 会作为一次括号粘贴插入）",
  "Add prompt": "添加提示词",
  "Show hidden files (dotfiles) in the file tree": "在文件树里显示隐藏文件（点文件）",
  "Also affects the eye button in the file tree": "与文件树里的眼睛按钮同步",

  // --- agent launchers (header ⚡ menu + settings) ----------------------
  "Launch an agent CLI ({key} for the first one)":
    "一键启动 agent CLI（{key} 启动第一个）",
  "Launch agent": "启动 agent",
  "No launchers enabled — turn one on in Settings.":
    "没有启用的启动项 —— 到设置里打开一个。",
  "New tab running {cmd}": "新标签页运行 {cmd}",
  "Split the current pane instead": "改为在当前分屏旁边打开",
  "Adds each CLI's skip-permissions flag. Off launches them with their normal approval prompts.":
    "给每个 CLI 加上跳过权限的参数。关掉则按各自默认的确认流程启动。",
  "bypass permissions": "跳过权限确认",
  "Edit…": "编辑…",
  "launch agent": "启动 agent",
  "Agent launchers": "Agent 启动项",
  "Launch with permission prompts bypassed": "启动时跳过权限确认",
  "Appends each CLI's skip-permissions flag. The agent can then edit and run anything in the directory it starts in.":
    "给每个 CLI 追加跳过权限的参数。这样 agent 可以在启动目录里任意改文件、跑命令。",
  "Hide from menus": "从菜单里隐藏",
  "Show in menus": "在菜单里显示",
  "(no command)": "（没有命令）",
  "Delete launcher": "删除启动项",
  command: "命令",
  "bypass flags": "跳过权限的参数",
  "bypass env (KEY=value)": "跳过权限的环境变量（KEY=value）",
  Name: "名称",
  "Add launcher": "添加启动项",
  "Reset to defaults": "恢复默认",
  "Drops custom launchers and every edit.": "会丢掉自定义启动项和所有改动。",
  "Launch from the ⚡ button in the header, the palette, or {key} for the first one. Each opens a new tab in the focused pane's directory.":
    "从顶栏的 ⚡ 按钮、命令面板启动，或用 {key} 启动第一个。都会在当前分屏的目录里新开标签页。",
};

function interpolate(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in vars ? String(vars[key]) : all,
  );
}

/**
 * Translate. Falls back to the English key, so an untranslated string shows
 * up as readable English rather than breaking the layout.
 */
export function t(en: string, vars?: Record<string, string | number>): string {
  const locale = useSettingsStore.getState().locale;
  const text = locale === "zh" ? (ZH[en] ?? en) : en;
  return interpolate(text, vars);
}

/**
 * `t` for components: identical, but subscribes the caller to the locale so
 * switching language re-renders it.
 */
export function useT(): typeof t {
  useSettingsStore((s) => s.locale);
  return t;
}

/** Exported for the completeness test. */
export const TRANSLATIONS = ZH;
