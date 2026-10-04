import { describe, expect, it } from "vitest";
import { parseMarkdownDocument, renderMathMarkdown } from "./math";
describe("shared reader parsing", () => {
  it("indexes repeated Chinese headings, excluding fences, and keeps raw copy payloads", () => {
    const model = parseMarkdownDocument(
      "# 结果\n\n## 结果\n\n```sh\n# not a heading\necho $PATH\n  echo x\n```\n\n$$\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}$$\n",
    );
    expect(model.headings.map((h) => h.text)).toEqual(["结果", "结果"]);
    expect(new Set(model.headings.map((h) => h.id)).size).toBe(2);
    expect(model.codes[0].value).toBe(
      "# not a heading\necho $PATH\n  echo x\n",
    );
    expect(model.math[0].value).toContain("pmatrix");
    expect(model.html).toContain("katex");
    expect(model.html).toContain('data-code-id="code-0"');
    expect(
      parseMarkdownDocument("# 结果\n\n## 结果").headings.map((h) => h.id),
    ).toEqual(model.headings.map((h) => h.id));
  });
  it("keeps HTML literal, external links inert and failed formulas readable", () => {
    const model = parseMarkdownDocument(
      "<script>alert(1)</script>\n\n[link](https://example.com)\n\n$$\\invalidcommand$$\n\n![图](../图 空格.png)",
    );
    expect(model.html).not.toContain("<script>");
    expect(model.html).toContain("&lt;script&gt;");
    expect(model.html).toContain('data-href="https://example.com"');
    expect(model.html).toContain("math-error");
    expect(model.html).not.toContain("<img");
  });
  it("protects tilde and longer fences from dollar math and supports nested structures", () => {
    const source =
      "~~~sh\necho $PATH $HOME\n~~~\n\n````sh\necho $PATH $HOME\n````\n\n> quote\n\n- item\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const model = parseMarkdownDocument(source);
    expect(model.math).toHaveLength(0);
    expect(model.codes).toHaveLength(2);
    expect(model.html).toContain("reader-table");
    expect(model.html).toContain("<blockquote>");
    expect(renderMathMarkdown("$$x_i^2$$")).toContain("katex-display");
  });
  it("shares reference definitions across long-document batches and excludes protected headings", () => {
    const source = "# 第一节\n\n[参考](https://example.com) [跨节][last]\n\n" +
      "正文一行。\n\n".repeat(4000) +
      "```sh\n# 代码里的标题\n```\n\n<pre>\n# HTML 里的标题\n</pre>\n\n" +
      "## 最后一节\n\n[last]: https://example.com/final\n";
    const model = parseMarkdownDocument(source);
    expect(model.headings.map(h => h.text)).toEqual(["第一节", "最后一节"]);
    expect(model.html).toContain('data-href="https://example.com/final"');
    expect(model.codes[0].value).toContain("# 代码里的标题");
    expect(model.html).toContain("&lt;pre&gt;");
  });

});
