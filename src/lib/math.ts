import katex from "katex";
import { Marked, type Tokens } from "marked";

/**
 * Markdown + LaTeX rendering for agent output.
 *
 * Math is pulled out *before* the markdown parser sees it — otherwise
 * `$a_i$` loses its underscore to emphasis and `x^2*y` to a bullet — and the
 * rendered KaTeX HTML is spliced back in afterwards. Code spans and fences
 * are lifted the same way so `$PATH` inside a shell snippet stays literal.
 */

interface Span {
  /** Offset of the chunk in the source, delimiters included. */
  start: number;
  end: number;
}

export type Chunk = Span &
  (
    | { kind: "text"; value: string }
    | { kind: "code"; value: string }
    | { kind: "math"; value: string; display: boolean }
  );

/**
 * Placeholder standing in for a formula while markdown is parsed. Plain
 * alphanumerics on purpose — a NUL, underscores or backticks would each be
 * stripped or restyled by the parser before we could splice the math back.
 */
const PLACEHOLDER = "LGNMATHSLOT";
const PLACEHOLDER_RE = /LGNMATHSLOT(\d+)END/g;

/** Inline `$…$` needs guards or every shell `$VAR` becomes a formula. */
function inlineDollarEnd(src: string, start: number): number {
  // Opening `$` must be followed by a non-space, and the closing one
  // preceded by a non-space, with no blank line between them.
  if (/[\s$]/.test(src[start + 1] ?? "")) return -1;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "\n" && src[i + 1] === "\n") return -1;
    if (ch === "$" && !/\s/.test(src[i - 1])) return i;
  }
  return -1;
}

function closingIndex(src: string, from: number, close: string): number {
  let i = from;
  while (i < src.length) {
    // The closer is checked before the escape skip on purpose: the closers
    // `\]` and `\)` start with a backslash themselves, so skipping escapes
    // first would step straight over them.
    if (src.startsWith(close, i)) return i;
    if (src[i] === "\\" && close !== "```") {
      i += 2;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Split source into text / code / math chunks, left to right.
 * Supported math: `$$…$$`, `\[…\]`, ```` ```math ```` fences (display) and
 * `$…$`, `\(…\)` (inline).
 */
export function tokenize(src: string): Chunk[] {
  const chunks: Chunk[] = [];
  let text = "";
  let textStart = 0;
  const flush = (at: number) => {
    if (text) chunks.push({ kind: "text", value: text, start: textStart, end: at });
    text = "";
  };

  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);

    // Fenced block: ```math renders, any other fence stays code.
    const fence = /^```([^\n`]*)\n?/.exec(rest);
    if (fence) {
      const bodyStart = i + fence[0].length;
      const end = closingIndex(src, bodyStart, "```");
      const stop = end === -1 ? src.length : end;
      const body = src.slice(bodyStart, stop);
      const close = end === -1 ? src.length : end + 3;
      flush(i);
      if (fence[1].trim().toLowerCase() === "math") {
        chunks.push({ kind: "math", value: body.trim(), display: true, start: i, end: close });
      } else {
        chunks.push({ kind: "code", value: src.slice(i, close), start: i, end: close });
      }
      i = close;
      continue;
    }

    if (src[i] === "`") {
      const end = closingIndex(src, i + 1, "`");
      if (end !== -1) {
        flush(i);
        chunks.push({ kind: "code", value: src.slice(i, end + 1), start: i, end: end + 1 });
        i = end + 1;
        continue;
      }
    }

    if (src.startsWith("$$", i)) {
      const end = closingIndex(src, i + 2, "$$");
      if (end !== -1) {
        flush(i);
        chunks.push({
          kind: "math",
          value: src.slice(i + 2, end).trim(),
          display: true,
          start: i,
          end: end + 2,
        });
        i = end + 2;
        continue;
      }
    }

    if (src.startsWith("\\[", i)) {
      const end = closingIndex(src, i + 2, "\\]");
      if (end !== -1) {
        flush(i);
        chunks.push({
          kind: "math",
          value: src.slice(i + 2, end).trim(),
          display: true,
          start: i,
          end: end + 2,
        });
        i = end + 2;
        continue;
      }
    }

    if (src.startsWith("\\(", i)) {
      const end = closingIndex(src, i + 2, "\\)");
      if (end !== -1) {
        flush(i);
        chunks.push({
          kind: "math",
          value: src.slice(i + 2, end).trim(),
          display: false,
          start: i,
          end: end + 2,
        });
        i = end + 2;
        continue;
      }
    }

    if (src[i] === "$") {
      const end = inlineDollarEnd(src, i);
      if (end !== -1) {
        flush(i);
        chunks.push({
          kind: "math",
          value: src.slice(i + 1, end).trim(),
          display: false,
          start: i,
          end: end + 1,
        });
        i = end + 1;
        continue;
      }
    }

    if (!text) textStart = i;
    text += src[i];
    i++;
  }
  flush(i);
  return chunks;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rendered KaTeX, or the source in an error style when it doesn't parse. */
export function renderMath(value: string, display: boolean): string {
  try {
    return katex.renderToString(value, {
      displayMode: display,
      throwOnError: true,
      strict: false,
      output: "html",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `<span class="math-error" title="${escapeHtml(message)}">${escapeHtml(
      display ? `$$${value}$$` : `$${value}$`,
    )}</span>`;
  }
}

/**
 * Raw HTML in the source is shown as text, never injected: this content comes
 * from whatever an agent printed into the terminal. Links become inert spans
 * that the panel routes through the opener plugin — a real `<a href>` would
 * navigate the whole webview away from the app.
 */
function makeMarked(): Marked {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.raw ?? token.text ?? "");
      },
      link(token: Tokens.Link) {
        const safe = /^(https?|mailto|tel|file):/i.test(token.href);
        const label = token.text || token.href;
        if (!safe) return escapeHtml(label);
        return `<span class="md-link" data-href="${escapeHtml(token.href)}" title="${escapeHtml(
          token.title || token.href,
        )}">${label}</span>`;
      },
      image(token: Tokens.Image) {
        // Remote images can't load under the app CSP anyway — show the alt.
        return escapeHtml(token.text || token.href);
      },
    },
  });
  return marked;
}

const marked = makeMarked();

/** Markdown + LaTeX source → HTML ready for `innerHTML`. */
export function renderMathMarkdown(src: string): string {
  const chunks = tokenize(src);
  const rendered: string[] = [];
  let staged = "";

  for (const chunk of chunks) {
    if (chunk.kind === "math") {
      staged += `${PLACEHOLDER}${rendered.length}END`;
      rendered.push(renderMath(chunk.value, chunk.display));
    } else {
      staged += chunk.value;
    }
  }

  const html = marked.parse(staged, { async: false }) as string;
  return html.replace(
    PLACEHOLDER_RE,
    (_all, index: string) => rendered[Number(index)] ?? "",
  );
}

/** True when the text carries something worth rendering. */
export function hasMath(src: string): boolean {
  return tokenize(src).some((c) => c.kind === "math");
}
