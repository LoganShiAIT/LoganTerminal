## 1. 文档模型与工作区恢复

- [x] 1.1 新建 documentStore：文件与不可变快照记录、来源目录、加载 revision、规范路径去重、加载／重载错误状态及关闭引用处理。
- [x] 1.2 新建 workspaceStore 和协调模块：混合排列、活动条目、焦点目标、终端条目同步、companion 关联和关闭回退，不修改 PTY 状态归属。
- [x] 1.3 提取 tabSnapshot 的纯序列化函数，实现版本化工作区快照、旧布局迁移、数量／深度限制、临时快照过滤与旧终端键镜像；协调启动恢复，避免重复 shell。
- [x] 1.4 增加模型／迁移行为测试：同文件去重、混合排列、关联关闭、坏快照回落、缺失文件、恢复限额、临时活动条目消失及不恢复 Agent 命令。

## 2. 焦点与操作路由

- [x] 2.1 将 TabBar、标签循环／数字跳转、关闭入口及 StatusCluster 接到工作区上下文，显示文档类型／来源，隐藏无目标的终端状态操作。
- [x] 2.2 更新 appBindings、Terminal.active 和 termBus：终端命令只到可见聚焦叶，关闭文档／companion 不关闭 PTY，弹层关闭恢复原焦点。
- [x] 2.3 更新 AssetPanel、文件拖放和 finder 的插入／cd 入口，分离浏览目录与写入目标，文档聚焦时不误写后台终端。
- [x] 2.4 接通 Mod+T、Agent launcher、fleet、worktree、attention 和 AgentDashboard 的工作区激活；新终端使用文档来源目录，跳转已存在终端同样有效。
- [x] 2.5 增加焦点回归测试，覆盖文档期间的 paste／clear／find／split／close／broadcast／asset／Shift-drop／finder 与弹层返回目标。

## 3. 主区域文档与阅读分屏

- [x] 3.1 实现 DocumentReader 并接入 App 的固定 keyed 平级容器，独立文档激活仅隐藏终端，不改变 Terminal／PaneTree 父层。
- [x] 3.2 实现终端右侧 companion、比例拖动、关闭／返回终端与 pane zoom 协作，通过现有 fit／resize 同步终端尺寸。
- [x] 3.3 接入文件加载／重新加载、只读原文／预览模式与读视图滚动状态；使用 revision 防止过期结果覆盖，失败重载保留已读内容。
- [x] 3.4 增加组件级生命周期回归：文档打开、切换、分屏拖动和主题变化保持 sessionId／滚屏，只有明确终端关闭增加 PTY kill 调用。

## 4. 共享 Markdown 结构与阅读交互

- [x] 4.1 从 math.ts 提取共享文档解析结果，提供正文、heading/code/math/image 元数据；保留 renderMathMarkdown 及现有 Math／Review／hover 使用契约。
- [x] 4.2 实现唯一中文／重复标题索引、折叠目录与当前读视图锚点导航，排除代码里的伪标题。
- [x] 4.3 实现代码原文复制、块公式 TeX 复制与轻量反馈；公式、表格和代码各自横向滚动，保持正文列宽。
- [x] 4.4 增加混合 Markdown 回归样例与测试：中文、矩阵、多行公式、代码中的 $PATH、重复标题、原始 HTML、外链和非法公式；验证非文档状态变化不触发全文重解析。

## 5. 本地文件与图片

- [x] 5.1 补齐 Rust 文件规范路径与本地图片解析能力，复用 1 MiB 文本限制并确保实际读取有限；文件 I/O 放入 blocking 任务，注册所需 Tauri commands。
- [x] 5.2 扩展 MarkdownPreview 的 baseDir／阅读上下文，以文档目录解析相对路径、绝对路径与 file URI，使用现有 asset protocol，不自动加载远程图片。
- [x] 5.3 复用本地图片 lightbox，加入缺失／无目录／格式错误占位和 revision 失效处理，不影响其他正文。
- [x] 5.4 增加实际临时文件／图片测试：中文与空格路径、文件别名去重、相对图片、file URI、cwd 变化、超限文本与过期加载结果。

## 6. 文件与文本打开入口

- [x] 6.1 为 FileTree 与 FileSearch 增加明确的 Markdown 阅读动作，保留现有 reveal、insert、cd、attach 操作；支持激活已有文件文档。
- [x] 6.2 为 ReviewPanel、MathPanel 增加主区／终端旁阅读入口，区分磁盘文件和未保存草稿快照，保留原编辑内容与保存流程。
- [x] 6.3 实现手动终端文本捕获：选区优先、最后命令输出回落、无文本提示、捕获时 cwd 和来源标签；拒绝超过 1 MiB UTF-8 的快照。
- [x] 6.4 增加文档命令面板操作及中英文文案，覆盖打开、旁读、返回终端、关闭、目录、模式、重新加载和复制反馈。

## 7. 工作区与阅读视觉

- [x] 7.1 实现统一工作区间距、圆角面板、标签类型图标及轻量导航状态，保持终端文字与 ANSI 颜色清晰。
- [x] 7.2 实现独立阅读排版 token 与 follow-theme／paper／dark 设置，即时应用、持久化，不改变终端外观；将 CRT 与 ambient 影响限定到适当区域。
- [x] 7.3 实现小窗口 companion 回退／恢复、目录列／弹层切换、键盘 focus、文本选择和 reduced-motion 行为。

## 8. 验证与交付

- [x] 8.1 添加固定阅读样例：中文技术报告、标题目录、公式／矩阵、表格、代码、相对本地图片和错误资源；增加接近 1 MiB 的文档样例用于记录实际解析与滚动表现。
- [x] 8.2 运行 npm test、npm run build、src-tauri 下 cargo fmt --check 与 cargo test，修复本轮引入的失败并记录已有阻塞，不把规格校验当成功能验收。
- [x] 8.3 在 macOS 应用中验证全部打开入口、选区／输出捕获、copy/lightbox、混合导航、焦点路由、启动／旧布局恢复及背景运行终端不重启；核对 PTY 生命周期和输出保留。
- [x] 8.4 检查浅色纸张、深色、终端旁读与 800×500 窗口，保存可对照截图和长文档表现记录；明确 Windows 实际验收是否完成，缺失时标记未验证。
- [x] 8.5 更新 README 与本 change 的验证记录，说明只读阅读器、手动输出快照、恢复范围和后续 Agent 会话能力边界；执行 openspec validate add-document-workspace-and-reader --strict。
