## Why

LoganTerminal 已有 Markdown、KaTeX、素材预览和多窗格终端，但长报告只能挤在侧栏中，缺少独立文档标签、目录和终端旁阅读的完整体验。参考 Pebrel 的工作区与阅读器设计，将文档提升为主工作区内容，并统一界面层次，让代码分析、建模报告和 AI 输出更便于阅读。

## What Changes

- 引入同时容纳终端与文档的工作区标签；文档可独立阅读，也可作为当前终端标签的右侧阅读区，分隔线可拖动。
- 从文件树、文件搜索、文件审阅和终端选区／上一条命令输出打开阅读器；重复打开同一文件复用文档，文本快照明确标注来源。
- 采用独立的阅读排版：居中正文、明确标题层级、充足留白、浅色纸张与深色阅读模式、安静的导航和圆角内容区；兼顾中文与小窗口。
- 提供标题目录、预览／只读原文切换、本地及相对路径图片、代码复制、公式原文复制和文件重新加载。
- 扩展现有 marked + KaTeX 渲染链，输出共享文档结构与标题索引；图片依据文档来源目录解析，终端公式识别与快捷预览继续复用现有逻辑。
- 持久化工作区排列、文件文档及阅读布局；兼容旧终端快照，临时输出快照仅保留在本次运行。
- 本轮不接入 Agent Hook、不自动捕获完整回答、不做 AI 对话恢复、PTY 后台保活、SSH/SFTP、原生数学引擎或所见即所得编辑；这些能力可在阅读器基础上后续扩展。

## Capabilities

### New Capabilities

- **document-workspace**：混合标签、终端旁阅读、显式操作路由、打开入口及工作区恢复。
- **markdown-document-reader**：共享解析结构、标题目录、源码视图、图片、代码／公式交互与文件加载。
- **workspace-reading-presentation**：工作区视觉层次、独立阅读排版、主题与小窗口可用性。

### Modified Capabilities

无。当前正式规格仅包含 project-infrastructure，本轮不改变其要求。

## Impact

- 前端：App、AppHeader、TabBar、PaneTree、FileTree、FileSearch、ReviewPanel、MarkdownPreview、MathPanel、命令面板、快捷键、主题、国际化及相关 Zustand store。
- 生命周期：继续由 ptyStore 和 attachPtySession 管理终端；文档导航不得导致存活终端重挂载、丢失滚屏或被杀死。
- 渲染：复用 marked、KaTeX、已有图片预览与 Tauri asset protocol；无需 GPUI、WebView 替换、网络图片服务或新的后台进程。
- 文件能力：复用并按需补齐 Rust fs 的路径规范化、有限文本读取和图片路径解析接口；不扩大全文读取限制。
- 配置：增加版本化工作区快照及阅读外观设置，兼容现有终端／侧栏存储。
- 参考来源：Pebrel 源码快照 9dd3d6491bfaaf902a4a3a248c02f36a47abae2d，重点为 file_editor/preview.rs、reader_presentation.rs 与 gpui_shell/math_view.rs。借鉴产品设计，在本项目现有栈中独立实现，不复制其原生渲染代码。
