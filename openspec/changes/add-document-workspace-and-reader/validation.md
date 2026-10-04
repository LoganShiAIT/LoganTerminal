# 文档工作区与阅读器验收

日期：2026-10-04。实施 change：`add-document-workspace-and-reader`。

## 实现与范围

混合终端／文档标签、主区阅读与右侧旁读、目录、只读原文、重新加载、代码／TeX 复制、本地图片 lightbox、手动终端捕获、Review／Math 草稿快照及版本化恢复均已实现。阅读排版支持跟随主题、纸张和深色，独立于终端 ANSI 配色。终端容器保持稳定的 keyed 父层，文档操作不卸载 PTY。纯协议应答继续服务后台程序，键盘、paste 和界面写入动作按聚焦目标路由。

Markdown 仍使用本地 marked + KaTeX。它与 Pebrel 的原生 GPUI／OpenType MATH 引擎不同；本次采用其阅读空间与交互思路，没有复制上游代码。自动抽取 Agent 答案、对话记录、会话重新附着及原生 TeX 引擎不在本次范围。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 31 个文件，258 项测试通过 |
| `npm run build` | TypeScript 与 Vite 构建通过 |
| `cargo fmt --check` | 通过 |
| `cargo test` | 88 项通过 |
| 独立 macOS debug `.app` | 构建成功，标识为 `com.logan.readerqa` |
| `git diff --check` | 通过 |
| OpenSpec strict | `openspec validate add-document-workspace-and-reader --strict` 通过 |

测试覆盖同文件并发去重、失效加载与关闭后回调、重载失败保留正文、UTF-8 限额、重复中文标题、围栏中的伪标题、原始代码／TeX、非法公式、HTML 文字化、长文批次间的引用链接、本地图片与过期资源、混合导航、旁读关联关闭、坏 JSON 回落旧布局、恢复数量与深度限额、纯文档启动零 PTY、临时快照过滤以及禁止恢复 Agent 命令。

组件测试核对 Terminal DOM／实例保持，只有明确关闭终端触发清理；打开文档、主题、比例变化和 PTY 状态更新不会重新解析未变的正文。焦点测试覆盖 paste／clear／find／split／close／broadcast、AssetPanel、Shift-drop、finder 插入／cd、弹层关闭目标和来源目录。旧布局迁移及坏快照采用自动化恢复测试，未声称全部在原生 UI 手动注入验证。

Vite 仍报告主 bundle 超过 500 kB 的提示，本次没有改变打包拆分策略；构建成功。

## macOS 实际应用验收

在隔离的 QA 应用中完成：

- Files 的 Markdown 阅读按钮、finder 明确阅读动作，以及同文件激活复用。
- Review 已保存文件复用，未保存草稿生成快照，编辑框与磁盘原件保持；Math 草稿主区阅读保留原输入。
- 手动上一条命令输出回落，以及先选区再捕获；后者显示“终端选区快照”和 `QA selected text / selection body` 正文。
- 中文、矩阵和多行公式、重复标题目录跳转、TeX 复制反馈、本地 SVG 放大和关闭返回。
- 文件与终端混合跳转，文档目录中新建终端后 `pwd` 与来源目录一致。
- 启动恢复保留文件标签／顺序、旁读关联和阅读外观；临时输出／编辑快照在重启后消失，终端启动新 shell。
- 持续输出循环期间切换文档后返回，20 条输出完整保留：前后的 shell PID 都是 **76499**，没有重新 spawn。
- 800×500 窗口旁读切全宽、返回终端、目录浮层，扩大后恢复原有 45% 比例。
- 纸张公式对比度和独立深色设置；修复纸张模式继承浅色 KaTeX 字色的问题。

## 长文档实际表现

生成器：`node docs/reader-fixtures/generate-large.mjs /tmp/logan-reader-large.md`。样例为 **1,048,369 字节**、**6,242 个标题**，末尾包含 `END_REACHABLE`。生成文件未提交。

原始整篇 marked block lexer 在本机 JavaScriptCore 中约 **50,323–50,346 ms**。实现改为在受保护的代码／HTML 块外按顶层标题分批 lex，共享引用定义与 inline 队列；同时避免逐字截取剩余全文，滚动锚点采用二分查找。最终 JavaScriptCore 基准数字保存在 [performance.json](../../../docs/reader-fixtures/validation/performance.json)，最终三次为 **1,669／1,542／1,478 ms**；这是解析时间，不是首屏渲染或滚动帧率。

原生应用已显示该全文并用键盘滚动到底，截图中末尾标记可见；重新加载仍保留末尾阅读位置并可切回普通文档。工具测得现有文件标签激活加 AX 获取约 1,081 ms、已读文件 reload 动作加 AX 获取约 610 ms；这些包含自动化开销且前者不是冷启动加载时间，不作为性能承诺。未采集 FPS／内存曲线；大量标题的目录仍为普通 DOM，不是 Pebrel 的虚拟块布局。

## 截图

| 场景 | 证据 |
| --- | --- |
| 纸张与目录 | [paper-outline.png](../../../docs/reader-fixtures/validation/paper-outline.png) |
| 独立深色阅读 | [dark.png](../../../docs/reader-fixtures/validation/dark.png) |
| 终端旁读 | [companion.png](../../../docs/reader-fixtures/validation/companion.png) |
| PTY 输出／PID 保留 | [pty-continuity.png](../../../docs/reader-fixtures/validation/pty-continuity.png) |
| 800×500 全宽与目录浮层 | [narrow-800x500.png](../../../docs/reader-fixtures/validation/narrow-800x500.png) |
| 接近 1 MiB 的末尾 | [large-document.png](../../../docs/reader-fixtures/validation/large-document.png) |

## 平台与恢复边界

**Windows 实际运行未验证**。前端恢复测试及 Rust 通用路径处理测试通过，不据此声称 ConPTY、WebView2 或 Windows 图片实际验收完成。

恢复仅包含文件路径、文档模式、标签顺序、伴随关联／比例和终端布局／cwd，上限为 9 个终端、12 个文件文档、每终端 8 pane、深度 3。临时快照、未保存内容、Agent 命令、旧进程和滚屏不恢复。远程图片不自动请求；外部打开是明确动作。
