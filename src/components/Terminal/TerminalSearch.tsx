import { useEffect, useRef, useState } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { SearchAddon } from "@xterm/addon-search";
import { useSettingsStore } from "../../stores/settingsStore";
import { buildSearchDecorations } from "../../themes";
import { t } from "../../i18n";
import { ChevronIcon } from "../icons";

/** Decorations follow the live theme, so they are read per search call. */
function decorations() {
  const s = useSettingsStore.getState();
  return buildSearchDecorations(s.themeId, s.accentOverride);
}

/**
 * ⌘F scrollback search: a floating bar over the terminal's top-right corner.
 * Opens prefilled from the current selection, which is almost always what you
 * meant to search for.
 */
export default function TerminalSearch({
  term,
  search,
  onClose,
}: {
  term: XTerm | null;
  search: SearchAddon | null;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [match, setMatch] = useState<{ index: number; count: number } | null>(
    null,
  );

  useEffect(() => {
    if (!search) return;
    const sub = search.onDidChangeResults(({ resultIndex, resultCount }) =>
      setMatch({ index: resultIndex, count: resultCount }),
    );
    return () => sub.dispose();
  }, [search]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const selection = term?.getSelection().trim() ?? "";
    if (selection && !selection.includes("\n")) {
      input.value = selection;
      search?.findNext(selection, {
        incremental: true,
        decorations: decorations(),
      });
    }
    input.focus();
    input.select();
  }, [term, search]);

  const find = (back: boolean) => {
    const q = inputRef.current?.value ?? "";
    if (!q) return;
    const opts = { decorations: decorations() };
    if (back) search?.findPrevious(q, opts);
    else search?.findNext(q, opts);
  };

  const close = () => {
    search?.clearDecorations();
    term?.clearSelection();
    term?.focus();
    onClose();
  };

  const iconButton =
    "w-6 h-6 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-ink/10 transition-colors";

  return (
    <div className="absolute top-1.5 right-3 z-10 flex items-center gap-0.5 h-8 pl-2.5 pr-1 rounded-lg border border-edge bg-raise/95 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.45)] animate-[pop-in_0.12s_ease-out]">
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
        placeholder={t("find")}
        className="w-40 bg-transparent font-mono text-xs text-ink placeholder:text-faint focus:outline-none"
        onChange={(e) => {
          const q = e.target.value;
          if (q) {
            search?.findNext(q, {
              incremental: true,
              decorations: decorations(),
            });
          } else {
            search?.clearDecorations();
            term?.clearSelection();
            setMatch(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            find(e.shiftKey);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <span className="font-mono text-[10px] text-faint min-w-[3.2em] text-center shrink-0">
        {match ? (match.count > 0 ? `${match.index + 1}/${match.count}` : "0/0") : ""}
      </span>
      <button
        className={iconButton}
        onClick={() => find(true)}
        title={t("Previous match (⇧↩)")}
      >
        <ChevronIcon dir="up" />
      </button>
      <button
        className={iconButton}
        onClick={() => find(false)}
        title={t("Next match (↩)")}
      >
        <ChevronIcon dir="down" />
      </button>
      <button
        className={`${iconButton} text-[13px] leading-none`}
        onClick={close}
        title={t("Close (esc)")}
      >
        ×
      </button>
    </div>
  );
}
