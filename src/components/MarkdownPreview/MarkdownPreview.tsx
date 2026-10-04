import { useSettingsStore } from "../../stores/settingsStore";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  parseMarkdownDocument,
  renderMathMarkdown,
  type ParsedDocument,
} from "../../lib/math";
import { openTerminalLink } from "../../lib/openLink";
import { Lightbox } from "../AssetPanel/AssetPanel";
import { useT } from "../../i18n";
import "katex/dist/katex.min.css";

export default memo(function MarkdownPreview({
  source,
  className = "",
  baseDir,
  model,
  reading = false,
  revision = 0,
}: {
  source: string;
  className?: string;
  baseDir?: string | null;
  model?: ParsedDocument;
  reading?: boolean;
  revision?: number;
}) {
  const t = useT();
  const locale = useSettingsStore((s) => s.locale);
  const ref = useRef<HTMLDivElement>(null);
  const parsed = useMemo(
    () =>
      model ??
      (reading || baseDir !== undefined ? parseMarkdownDocument(source) : null),
    [source, model, reading, baseDir],
  );
  const html = useMemo(
    () => parsed?.html ?? renderMathMarkdown(source),
    [source, parsed],
  );
  const markup = useMemo(() => ({ __html: html }), [html]);
  const [lightbox, setLightbox] = useState<{
    src: string;
    path: string;
  } | null>(null);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    setLightbox(null);
    node.querySelectorAll<HTMLElement>("[data-code-id]").forEach((el) => {
      el.textContent = t("Copy code");
      el.setAttribute("aria-label", t("Copy code"));
    });
    node.querySelectorAll<HTMLElement>("[data-math-id]").forEach((el) => {
      el.textContent = t("Copy TeX");
      el.setAttribute("aria-label", t("Copy TeX"));
    });
    for (const image of parsed?.images ?? []) {
      const slot = node.querySelector<HTMLElement>(
        `[data-image-id="${image.id}"]`,
      );
      if (!slot) continue;
      if (/^https?:/i.test(image.href)) {
        slot.textContent = `${image.alt || image.href} · ${t("External image")}`;
        const button = document.createElement("button");
        button.textContent = t("Open externally");
        button.dataset.href = image.href;
        slot.append(" ", button);
        continue;
      }
      slot.textContent = `${image.alt || image.href} · ${t("Loading image…")}`;
      void invoke<string>("fs_resolve_image", {
        target: image.href,
        baseDir: baseDir ?? null,
      })
        .then((path) => {
          if (cancelled || !slot.isConnected) return;
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.imagePath = path;
          button.title = t("Enlarge image");
          button.setAttribute(
            "aria-label",
            `${t("Enlarge image")} · ${image.alt}`,
          );
          const img = document.createElement("img");
          img.src = convertFileSrc(path);
          img.alt = image.alt;
          img.loading = "lazy";
          img.onerror = () => {
            if (!cancelled)
              slot.textContent = `${image.alt || image.href} · ${t("Image unavailable")}`;
          };
          button.append(img);
          slot.replaceChildren(button);
        })
        .catch((error) => {
          if (!cancelled) {
            slot.textContent = `${image.alt || image.href} · ${t("Image unavailable")}`;
            slot.title = String(error);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [html, parsed, baseDir, revision, t, locale]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let timer: number | undefined;
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-href], [data-code-id], [data-math-id], [data-image-path]",
      );
      if (!target) return;
      const { href, codeId, mathId, imagePath } = target.dataset;
      if (href) {
        event.preventDefault();
        openTerminalLink(href);
      } else if (imagePath)
        setLightbox({ path: imagePath, src: convertFileSrc(imagePath) });
      else {
        const value = codeId
          ? parsed?.codes.find((c) => c.id === codeId)?.value
          : parsed?.math.find((m) => m.id === mathId)?.value;
        if (value !== undefined)
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setFeedback(t("Copied"));
              window.clearTimeout(timer);
              timer = window.setTimeout(() => setFeedback(""), 1400);
            })
            .catch(() => setFeedback(t("Copy failed")));
      }
    };
    node.addEventListener("click", onClick);
    return () => {
      node.removeEventListener("click", onClick);
      window.clearTimeout(timer);
    };
  }, [parsed, t]);
  return (
    <>
      <div
        ref={ref}
        className={`md-body ${className}`}
        dangerouslySetInnerHTML={markup}
      />
      <span className="reader-feedback" role="status">
        {feedback}
      </span>
      {lightbox && (
        <Lightbox
          data={{ ...lightbox, timestamp: Date.now() }}
          canInsert={false}
          onInsert={() => {}}
          onClose={() => {
            setLightbox(null);
            ref.current
              ?.closest<HTMLElement>("[data-reader-id]")
              ?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
});
