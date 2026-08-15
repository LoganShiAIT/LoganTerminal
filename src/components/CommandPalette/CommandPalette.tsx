import { useEffect, useMemo, useRef, useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { fuzzyMatch } from "../../lib/fuzzy";
import { recentActionIds, recordAction, recencyBoost } from "../../lib/recency";
import { sendTermCmd } from "../../lib/termBus";
import { useEscapeClose } from "../../lib/useEscapeClose";
import { useListSelection } from "../../lib/useListSelection";
import { t } from "../../i18n";
import {
  Overlay,
  OverlayHeader,
  OverlayList,
  OverlayRow,
  OverlayFooter,
  OverlayHint,
  OverlayEmpty,
} from "../Overlay/Overlay";
import { useActions, type PaletteAction } from "./actions";

/** How many recently-run commands ride at the top of the unfiltered list. */
const RECENT_SHOWN = 5;

interface Result {
  action: PaletteAction;
  /** Matched character positions in the label, for highlighting. */
  indices: number[];
  /** True for the pseudo-group of recently-run commands. */
  recent: boolean;
}

/** ⌘P: fuzzy-run anything the app can do. */
export default function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const actions = useActions();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-read once per open (not per keystroke): running an action closes the
  // palette, so the list can only change between opens.
  const recentIds = useMemo(() => (open ? recentActionIds() : []), [open]);
  const results = useMemo(
    () => rank(actions, query, recentIds),
    [actions, query, recentIds],
  );

  const close = () => {
    setOpen(false);
    sendTermCmd("focus");
  };

  const run = (index: number) => {
    const action = results[index]?.action;
    if (!action) return;
    setOpen(false);
    if (!action.transient) recordAction(action.id);
    action.run();
    if (!action.keepFocus) sendTermCmd("focus");
  };

  const { selected, setSelected, selectedRef, handleKey } = useListSelection(
    results.length,
    run,
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    // Next frame so the input exists after the conditional render.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, setSelected]);

  useEffect(() => {
    setSelected(0);
  }, [query, setSelected]);

  useEscapeClose(open, close);

  if (!open) return null;

  // Group headers only make sense in the unfiltered list; a fuzzy search is
  // ranked across every group at once.
  const grouped = !query.trim();
  const groupOf = (r: Result) => (r.recent ? t("Recent") : r.action.group);

  return (
    <Overlay width={580} onClose={close}>
      <OverlayHeader title="">
        <span className="font-mono text-accent text-[18px] shrink-0">❯</span>
        <input
          ref={inputRef}
          type="text"
          spellCheck={false}
          placeholder={t("Type a command… themes, tabs, effects, anything")}
          className="flex-1 bg-transparent font-mono text-[17px] text-ink placeholder:text-faint focus:outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (handleKey(e)) e.preventDefault();
          }}
        />
        <span className="kbd shrink-0">esc</span>
      </OverlayHeader>

      <OverlayList>
        {results.length === 0 && (
          <OverlayEmpty>{t("No matching commands")}</OverlayEmpty>
        )}
        {results.map((r, i) => (
          // Recent rows form their own pseudo-group; the same action can
          // appear again below in its real group (hence the key prefix).
          <div key={(r.recent ? "recent:" : "") + r.action.id}>
            {grouped && (i === 0 || groupOf(results[i - 1]) !== groupOf(r)) && (
              <div className="px-4 pt-2.5 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-faint">
                {groupOf(r)}
              </div>
            )}
            <OverlayRow
              selected={i === selected}
              rowRef={selectedRef}
              onSelect={() => setSelected(i)}
              onActivate={() => run(i)}
            >
              {r.action.swatch && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/20"
                  style={{ backgroundColor: r.action.swatch }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                <Highlighted text={r.action.label} indices={r.indices} />
              </span>
              {r.action.active && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  title={t("Currently active")}
                />
              )}
              {r.action.hint && (
                <span className="kbd shrink-0">{r.action.hint}</span>
              )}
            </OverlayRow>
          </div>
        ))}
      </OverlayList>

      <OverlayFooter>
        <OverlayHint keys="↑↓" label={t("navigate")} />
        <OverlayHint keys="↩" label={t("run")} />
        <OverlayHint keys="esc" label={t("close")} />
        <span className="ml-auto font-mono">
          {t("{n} commands", { n: results.length })}
        </span>
      </OverlayFooter>
    </Overlay>
  );
}

/**
 * Empty query: recents first, then the full list in group order. Otherwise a
 * flat fuzzy ranking with a nudge for commands run recently.
 */
function rank(
  actions: PaletteAction[],
  query: string,
  recentIds: string[],
): Result[] {
  if (!query.trim()) {
    const byId = new Map(actions.map((a) => [a.id, a]));
    const recent = recentIds
      .map((id) => byId.get(id))
      .filter((a): a is PaletteAction => a !== undefined)
      .slice(0, RECENT_SHOWN)
      .map((action) => ({ action, indices: [], recent: true }));
    return [
      ...recent,
      ...actions.map((action) => ({ action, indices: [], recent: false })),
    ];
  }
  return actions
    .flatMap((action) => {
      const m = fuzzyMatch(query, action.label);
      return m
        ? [
            {
              action,
              indices: m.indices,
              recent: false,
              score: m.score + recencyBoost(action.id, recentIds),
            },
          ]
        : [];
    })
    .sort((a, b) => b.score - a.score);
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {text.split("").map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-accent font-semibold">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}
