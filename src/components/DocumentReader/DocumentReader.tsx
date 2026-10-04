import { useEffect, useMemo, useRef, useState } from "react";
import { useDocumentStore } from "../../stores/documentStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { parseMarkdownDocument } from "../../lib/math";
import { closeWorkspace, returnToTerminal } from "../../lib/workspace";
import { useT } from "../../i18n";
import MarkdownPreview from "../MarkdownPreview/MarkdownPreview";

export default function DocumentReader({
  id,
  tabId,
}: {
  id: string;
  tabId?: string;
}) {
  const t = useT();
  const doc = useDocumentStore((s) => s.documents[id]);
  const appearance = useSettingsStore((s) => s.readerAppearance);
  const [outline, setOutline] = useState(false);
  const [width, setWidth] = useState(800);
  const wrap = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const positions = useRef({ preview: 0, source: 0 });
  const model = useMemo(
    () => parseMarkdownDocument(doc?.source ?? ""),
    [doc?.source],
  );
  useEffect(() => {
    const node = wrap.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (scroll.current && doc)
      scroll.current.scrollTop = positions.current[doc.mode];
  }, [doc?.mode]);
  useEffect(() => {
    if (anchor.current && doc?.mode === "preview")
      scroll.current
        ?.querySelector<HTMLElement>(`#${anchor.current}`)
        ?.scrollIntoView({ block: "start" });
  }, [doc?.source]);
  useEffect(() => {
    anchor.current = null;
    positions.current = { preview: 0, source: 0 };
    setOutline(false);
  }, [id]);
  useEffect(() => {
    const onOutline = () => {
      const focus = useWorkspaceStore.getState().focus;
      if (
        focus?.kind === "document" &&
        focus.documentId === id &&
        focus.placement === (tabId ? "companion" : "main")
      )
        setOutline((v) => !v);
    };
    window.addEventListener("logan:reader-outline", onOutline);
    return () => window.removeEventListener("logan:reader-outline", onOutline);
  }, [id, tabId]);
  if (!doc) return null;
  const focus = () => useWorkspaceStore.getState().focusDocument(id, tabId);
  const button = "reader-control";
  const origin =
    doc.kind === "file"
      ? t("Markdown file")
      : t(
          doc.origin === "draft"
            ? "Unsaved draft snapshot"
            : doc.origin === "scratch"
              ? "Scratch snapshot"
              : doc.origin === "selection"
                ? "Terminal selection snapshot"
                : "Last command output snapshot",
        );
  return (
    <section
      ref={wrap}
      tabIndex={-1}
      data-reader-id={id}
      data-placement={tabId ? "companion" : "main"}
      data-appearance={appearance}
      className="document-reader"
      onMouseDownCapture={focus}
      onFocusCapture={focus}
    >
      <header className="reader-toolbar">
        <div className="reader-identity">
          <span className="reader-eyebrow">{origin}</span>
          <strong title={doc.path || doc.title}>{doc.title}</strong>
        </div>
        <div className="reader-controls">
          <button
            className={button}
            aria-label={t("Outline")}
            aria-pressed={outline}
            onClick={() => setOutline((v) => !v)}
          >
            ☷ <span>{t("Outline")}</span>
          </button>
          <button
            className={button}
            onClick={() =>
              useDocumentStore
                .getState()
                .setMode(id, doc.mode === "preview" ? "source" : "preview")
            }
          >
            {doc.mode === "preview" ? t("Source") : t("Preview")}
          </button>
          {doc.kind === "file" && (
            <button
              className={button}
              disabled={doc.loading}
              onClick={() => void useDocumentStore.getState().reload(id)}
            >
              {t("Reload")}
            </button>
          )}
          <select
            aria-label={t("Reader appearance")}
            className={button}
            value={appearance}
            onChange={(e) =>
              useSettingsStore
                .getState()
                .setReaderAppearance(e.target.value as typeof appearance)
            }
          >
            <option value="follow-theme">{t("Follow theme")}</option>
            <option value="paper">{t("Paper")}</option>
            <option value="dark">{t("Dark")}</option>
          </select>
          <button
            className={button}
            aria-label={t("Return to terminal")}
            title={t("Return to terminal")}
            onClick={returnToTerminal}
          >
            ↩
          </button>
          <button
            className={button}
            aria-label={t("Close reader")}
            onClick={() =>
              tabId
                ? useWorkspaceStore.getState().detach(tabId)
                : closeWorkspace(id)
            }
          >
            ×
          </button>
        </div>
      </header>
      <div className="reader-provenance" title={doc.path || doc.baseDir || ""}>
        {doc.path || doc.baseDir || t("Temporary snapshot")}
        {doc.capturedAt
          ? ` · ${new Date(doc.capturedAt).toLocaleTimeString()}`
          : ""}
        {doc.loading ? ` · ${t("Loading…")}` : ""}
      </div>
      {doc.error && (
        <div className="reader-error" role="alert">
          {doc.error}{" "}
          <button
            className={button}
            onClick={() => void useDocumentStore.getState().reload(id)}
          >
            {t("Retry")}
          </button>
        </div>
      )}
      <div className="reader-layout">
        {outline && (
          <>
            {width < 520 && (
              <button
                className="reader-outline-shade"
                aria-label={t("Close outline")}
                onClick={() => {
                  setOutline(false);
                  wrap.current?.focus();
                }}
              />
            )}
            <nav
              className={`reader-outline ${width < 520 ? "is-overlay" : ""}`}
              aria-label={t("Outline")}
            >
              <div className="reader-outline-title">
                {t("On this page")}
                <button
                  aria-label={t("Close outline")}
                  onClick={() => {
                    setOutline(false);
                    wrap.current?.focus();
                  }}
                >
                  ×
                </button>
              </div>
              {model.headings.map((h) => (
                <button
                  key={h.id}
                  title={h.text}
                  style={{ paddingLeft: 12 + (h.depth - 1) * 10 }}
                  onClick={() => {
                    if (doc.mode === "source")
                      useDocumentStore.getState().setMode(id, "preview");
                    requestAnimationFrame(() =>
                      scroll.current
                        ?.querySelector<HTMLElement>(`#${h.id}`)
                        ?.scrollIntoView({ block: "start" }),
                    );
                    if (width < 520) setOutline(false);
                  }}
                >
                  {h.text.replace(/[*`_]/g, "")}
                </button>
              ))}
              {!model.headings.length && <p>{t("No headings")}</p>}
            </nav>
          </>
        )}
        <div
          ref={scroll}
          className="reader-scroll"
          onScroll={(e) => {
            positions.current[doc.mode] = e.currentTarget.scrollTop;
            if (doc.mode === "preview") {
              const top = e.currentTarget.getBoundingClientRect().top;
              const headings = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  "h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]",
                ),
              );
              // Headings are ordered: find the current section without reading
              // every heading's layout on each long-document scroll event.
              let low = 0, high = headings.length - 1, current: HTMLElement | undefined;
              while (low <= high) {
                const middle = Math.floor((low + high) / 2);
                if (headings[middle].getBoundingClientRect().top <= top + 40) {
                  current = headings[middle];
                  low = middle + 1;
                } else high = middle - 1;
              }
              anchor.current = current?.id ?? null;
            }
          }}
        >
          {doc.loaded &&
            (doc.mode === "source" ? (
              <pre className="reader-source">{doc.source}</pre>
            ) : (
              <article className="reader-page">
                <MarkdownPreview
                  source={doc.source}
                  model={model}
                  baseDir={doc.baseDir}
                  reading
                  revision={doc.revision}
                />
              </article>
            ))}
          {!doc.loaded && !doc.loading && !doc.error && (
            <p className="reader-empty">{t("No content")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
