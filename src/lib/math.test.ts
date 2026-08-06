import { describe, it, expect } from "vitest";
import { tokenize, renderMathMarkdown, hasMath, renderMath } from "./math";

describe("tokenize", () => {
  it("splits display and inline math out of prose", () => {
    const chunks = tokenize("cost is $$c_i x_i$$ where $x_i \\ge 0$ holds");
    expect(chunks.map((c) => c.kind)).toEqual([
      "text",
      "math",
      "text",
      "math",
      "text",
    ]);
    expect(chunks[1]).toMatchObject({ value: "c_i x_i", display: true });
    expect(chunks[3]).toMatchObject({ value: "x_i \\ge 0", display: false });
  });

  it("supports \\[…\\] and \\(…\\) delimiters", () => {
    const chunks = tokenize("\\[a^2+b^2=c^2\\] and \\(\\pi\\)");
    const math = chunks.filter((c) => c.kind === "math");
    expect(math).toHaveLength(2);
    expect(math[0]).toMatchObject({ value: "a^2+b^2=c^2", display: true });
    expect(math[1]).toMatchObject({ value: "\\pi", display: false });
  });

  it("treats a ```math fence as display math but leaves other fences as code", () => {
    const chunks = tokenize("```math\nE = mc^2\n```\n```js\nlet $x = 1\n```");
    expect(chunks[0]).toMatchObject({ kind: "math", value: "E = mc^2", display: true });
    const code = chunks.find((c) => c.kind === "code");
    expect(code?.value).toContain("let $x = 1");
  });

  it("leaves shell-style $VAR and prices alone", () => {
    // The closing `$` must sit tight against its content, which is what
    // keeps "$5 and $7" (space before the second one) out of math mode.
    expect(hasMath("echo $PATH")).toBe(false);
    expect(hasMath("costs $5 and $7 per unit")).toBe(false);
    expect(hasMath("give me $ 5 for $ 7")).toBe(false);
    expect(hasMath("a single $ sign")).toBe(false);
    expect(hasMath("the value $x$ though")).toBe(true);
  });

  it("does not read math inside inline code", () => {
    const chunks = tokenize("run `echo $HOME` first");
    expect(chunks.some((c) => c.kind === "math")).toBe(false);
    expect(chunks[1]).toMatchObject({ kind: "code", value: "`echo $HOME`" });
  });

  it("does not let an inline span run across a blank line", () => {
    expect(hasMath("price $5\n\nother $3")).toBe(false);
  });
});

describe("renderMathMarkdown", () => {
  it("renders markdown structure and KaTeX together", () => {
    const html = renderMathMarkdown("## Model\n\n- min $x_1$\n");
    expect(html).toContain("<h2");
    expect(html).toContain("<li>");
    expect(html).toContain("katex");
  });

  it("keeps subscripts intact instead of letting markdown eat the underscores", () => {
    const html = renderMathMarkdown("$a_i b_j$");
    expect(html).not.toContain("<em>");
    expect(html).toContain("katex");
  });

  it("marks display math as a KaTeX display block", () => {
    expect(renderMathMarkdown("$$\\sum_{i=1}^n c_i$$")).toContain("katex-display");
  });

  it("shows raw HTML as text rather than injecting it", () => {
    const html = renderMathMarkdown('<img src=x onerror="boom()"> hi');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders links as inert spans carrying the href", () => {
    const html = renderMathMarkdown("[docs](https://example.com)");
    expect(html).not.toContain("<a ");
    expect(html).toContain('data-href="https://example.com"');
  });

  it("drops non-web link schemes down to plain text", () => {
    const html = renderMathMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("leaves the placeholder nowhere in the output", () => {
    const html = renderMathMarkdown("a $x$ b $$y$$ c");
    expect(html).not.toContain("LGNMATHSLOT");
  });
});

describe("renderMath", () => {
  it("falls back to readable source when the formula is broken", () => {
    const html = renderMath("\\frac{1}{", false);
    expect(html).toContain("math-error");
    expect(html).toContain("$\\frac{1}{$");
  });
});
