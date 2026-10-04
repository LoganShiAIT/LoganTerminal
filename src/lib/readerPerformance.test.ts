import { describe, expect, it } from "vitest";
import { parseMarkdownDocument } from "./math";
import { assertDocumentSize } from "../stores/documentStore";
describe("near-limit reader fixture", () => {
  it("keeps the entire accepted document including its final section reachable", () => {
    const section =
      "\n## 验收章节\n\n中文长文阅读。The reader keeps a centered column and source-relative context.\n\n- 固定的示例项目\n- 不同视图保留各自滚动位置\n\n";
    const unit = new TextEncoder().encode(section).length;
    const source =
      "# 接近 1 MiB 的阅读测试\n" +
      section.repeat(Math.floor((1024 * 1024 - 256) / unit)) +
      "\n## END_REACHABLE\n";
    assertDocumentSize(source);
    const start = performance.now();
    const model = parseMarkdownDocument(source);
    const milliseconds = performance.now() - start;
    console.log(
      JSON.stringify({
        bytes: new TextEncoder().encode(source).length,
        headings: model.headings.length,
        parseMilliseconds: Math.round(milliseconds),
        htmlBytes: model.html.length,
      }),
    );
    expect(model.headings[model.headings.length - 1]?.text).toBe("END_REACHABLE");
    expect(model.html).toContain("END_REACHABLE");
  });
});
