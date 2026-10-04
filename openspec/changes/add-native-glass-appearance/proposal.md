## Why

LoganTerminal 的标题栏和侧栏已有网页内半透明效果，但不透明的窗口、页面底色及 xterm 背景阻断了桌面透视。参考 Pebrel 的系统毛玻璃与统一背景策略，补齐原生材质和背景合成，让终端拥有清晰、安静的玻璃外观。

## What Changes

- 增加可选的原生玻璃外观：macOS 使用 Vibrancy，Windows 使用 Acrylic；不支持或应用失败时显示实色背景和简短状态说明。玻璃模式提供“背景模糊”开关，关闭后窗口纯透明（无原生磨砂），桌面清晰透过着色显示。
- 在外观设置中提供“实色 / 玻璃”和背景不透明度控制，玻璃默认不透明度为 75%，可调范围为 10–100%；首次及旧版本升级默认保留实色，选择后持久化并实时应用。
- 统一窗口外框、标题栏、侧栏与终端的背景透明度来源，清理重复底色，文字、图标、ANSI 显式背景色与选区保持清晰。
- 启用 xterm 默认背景透明能力；切换材质、主题或不透明度时保留终端实例、PTY、输出历史及工作区布局。
- 玻璃模式降低网格和漂浮光球的视觉强度，使用一致的细边框、圆角和轻阴影；文档正文、设置和其他弹窗保持稳定的阅读底色。
- 保留现有主题、暖橙强调色、阅读主题及 ambient/CRT 用户偏好；切回实色恢复原有外观行为。

## Capabilities

### New Capabilities

- `native-window-material`: 原生材质的应用、清理、状态反馈与实色回退。
- `glass-surface-composition`: 前端和终端统一的背景合成、清晰内容与生命周期保护。
- `window-appearance-settings`: 材质和不透明度的设置、持久化、实时更新及中英文反馈。

### Modified Capabilities

无。现有正式规格只有 `project-infrastructure`；本变更与已完成但尚未归档的 `add-document-workspace-and-reader` 保持兼容，不修改其规格或任务。

## Impact

- Rust/Tauri：`src-tauri/tauri.conf.json`、平台配置（如需要）、`src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`，以及独立的窗口材质适配模块。优先复用当前 Tauri/window-vibrancy 能力，不迁移 GPUI。
- 前端：`src/themes.ts`、`src/index.css`、`src/App.tsx`、`settingsStore`、Terminal、AppHeader、Sidebar、TabBar、Ambient 和 Settings；必要时统一 Overlay/阅读器外框的 surface token。
- 文档和验证：README、透明设置与合成策略的针对性测试、真实桌面背景下的截图和终端生命周期验证；Windows 原生效果需在 Windows 上验证，不能以 macOS 或浏览器截图代替。
- 本轮不包含 Agent Hook、自动回答捕获、命令补全、SSH/SFTP、会话保活、自定义壁纸、噪点着色器或 GPUI 迁移。借鉴视觉与合成原则，使用本项目架构独立实现。
