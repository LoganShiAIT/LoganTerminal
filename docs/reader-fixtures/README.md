# 阅读器验收样例

`report.md` 与相邻的 `reading-flow.svg` 检查中文、重复目录、公式、矩阵、表格、代码、本地图片和错误资源。使用 Files／finder 的“阅读文档”打开，或通过 Review 选择主区／旁读。

生成近 1 MiB 长文：

```sh
node docs/reader-fixtures/generate-large.mjs /tmp/logan-reader-large.md
```

生成器包含末尾 `END_REACHABLE`，用于确认全文可达；不提交生成的大文件。

`validation/` 保存 macOS 原生应用截图和 JavaScriptCore 解析指标。完整方法、功能验收、恢复边界与 Windows 未验证说明见 [验证记录](../../openspec/changes/add-document-workspace-and-reader/validation.md)。
