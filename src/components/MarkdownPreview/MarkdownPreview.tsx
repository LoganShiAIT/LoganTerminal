import { useEffect, useMemo, useRef } from "react";
import { renderMathMarkdown } from "../../lib/math";
import { openTerminalLink } from "../../lib/openLink";
// Bundled locally (fonts included) — the app CSP forbids any external host.
import "katex/dist/katex.min.css";

/**
 * Rendered markdown + LaTeX, styled by the `.md-body` rules in index.css.
 *
 * The HTML comes from [`renderMathMarkdown`], which escapes any raw HTML in
 * the source and turns links into inert `data-href` spans — this content is
 * whatever an agent wrote to a file or printed to the terminal, so it is never
 * trusted markup. Clicks on those spans are routed through the opener plugin
 * here; a real `<a href>` would navigate the whole webview away from the app.
 */
export default function MarkdownPreview({
  source,
  className = "",
}: {
  source: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Rendering is pure string work; memo keeps typing in an editor beside the
  // preview from re-parsing a long document on every keystroke.
  const html = useMemo(() => renderMathMarkdown(source), [source]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-href]");
      const href = target?.dataset.href;
      if (href) {
        e.preventDefault();
        openTerminalLink(href);
      }
    };
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, []);

  return (
    <div
      ref={ref}
      className={`md-body ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
