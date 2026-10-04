import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useDocumentStore } from "../../stores/documentStore";
import { activateWorkspace, closeWorkspace, workspaceCwd } from "../../lib/workspace";
import { useLayoutEffect, useRef, useState } from "react";
import { usePtyStore, collectLeaves, activeLeafOf } from "../../stores/ptyStore";
import { dirLabel } from "../../lib/paths";
import { kbd } from "../../lib/keys";
import { t, useT } from "../../i18n";

function tabLabel(cwd: string | null): string {
  if (!cwd) return t("shell");
  return dirLabel(cwd);
}

const DRAG_THRESHOLD_PX = 5;

interface DragState {
  id: string;
  dx: number;
  /** Insertion index among the remaining (non-dragged) tabs, or null. */
  slot: number | null;
  /** Indicator x in container content coordinates. */
  indicatorLeft: number | null;
}

export default function TabBar() {
  const t = useT();
  const terminals = usePtyStore((s) => s.tabs);
  const tabs = useWorkspaceStore(s => s.entries);
  const documents = useDocumentStore(s => s.documents);
  const activeTabId = useWorkspaceStore(s => s.activeId);
  const setActiveTab = activateWorkspace;
  const closeTab = closeWorkspace;
  const addTab = usePtyStore((s) => s.addTab);
  const moveTab = useWorkspaceStore(s => s.move);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const elsRef = useRef(new Map<string, HTMLDivElement>());
  const prevLeftsRef = useRef(new Map<string, number>());
  const dragInfoRef = useRef<{
    id: string;
    startX: number;
    fromIndex: number;
    moved: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  // FLIP: whenever tab order changes, slide each surviving tab from its old
  // x-position to the new one instead of teleporting.
  useLayoutEffect(() => {
    const prev = prevLeftsRef.current;
    const next = new Map<string, number>();
    for (const tab of tabs) {
      const el = elsRef.current.get(tab.id);
      if (!el) continue;
      const left = el.getBoundingClientRect().left;
      next.set(tab.id, left);
      const old = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? undefined : prev.get(tab.id);
      if (old !== undefined && Math.abs(old - left) > 0.5) {
        el.animate(
          [{ transform: `translateX(${old - left}px)` }, { transform: "none" }],
          { duration: 190, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      }
    }
    prevLeftsRef.current = next;
  }, [tabs]);

  const computeSlot = (pointerX: number, draggedId: string) => {
    const others = tabs
      .filter((t) => t.id !== draggedId)
      .map((t) => elsRef.current.get(t.id))
      .filter((el): el is HTMLDivElement => Boolean(el));
    if (others.length === 0)
      return { slot: null as number | null, indicatorLeft: null as number | null };
    let slot = others.length;
    for (let k = 0; k < others.length; k++) {
      const r = others[k].getBoundingClientRect();
      if (pointerX < r.left + r.width / 2) {
        slot = k;
        break;
      }
    }
    const container = containerRef.current;
    if (!container) return { slot, indicatorLeft: null };
    const cRect = container.getBoundingClientRect();
    const edgeX =
      slot < others.length
        ? others[slot].getBoundingClientRect().left - 2
        : others[others.length - 1].getBoundingClientRect().right;
    return {
      slot,
      indicatorLeft: edgeX - cRect.left + container.scrollLeft,
    };
  };

  const onTabPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    tabId: string,
    index: number,
  ) => {
    if (e.button !== 0) return;
    // The close button handles its own clicks; never start a drag from it.
    if ((e.target as HTMLElement).closest("button")) return;
    justDraggedRef.current = false;
    dragInfoRef.current = {
      id: tabId,
      startX: e.clientX,
      fromIndex: index,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onTabPointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    tabId: string,
  ) => {
    const info = dragInfoRef.current;
    if (!info || info.id !== tabId) return;
    const dx = e.clientX - info.startX;
    if (!info.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    info.moved = true;
    e.preventDefault();
    const { slot, indicatorLeft } = computeSlot(e.clientX, tabId);
    setDrag({ id: tabId, dx, slot, indicatorLeft });
  };

  const onTabPointerUp = (
    e: React.PointerEvent<HTMLDivElement>,
    tabId: string,
  ) => {
    const info = dragInfoRef.current;
    if (!info || info.id !== tabId) return;
    dragInfoRef.current = null;
    if (info.moved) {
      justDraggedRef.current = true;
      // Let the click that follows this pointerup see the flag, then clear
      // it so a future click on an unmoved tab isn't swallowed.
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 0);
      const state = drag?.id === tabId ? drag : null;
      const slot = state ? state.slot : computeSlot(e.clientX, tabId).slot;
      const el = elsRef.current.get(tabId);
      if (slot !== null && slot !== info.fromIndex) {
        // Seed FLIP with the position the tab was released at (transform
        // included) so it settles from under the pointer, not its old slot.
        if (el) prevLeftsRef.current.set(tabId, el.getBoundingClientRect().left);
        setDrag(null);
        moveTab(info.fromIndex, slot);
      } else {
        // No reorder — tab order is unchanged, so the FLIP effect won't run;
        // slide back to the original slot by hand.
        if (el && state) {
          el.animate(
            [
              { transform: `translateX(${state.dx}px) scale(1.04)` },
              { transform: "none" },
            ],
            { duration: 170, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
          );
        }
        setDrag(null);
      }
    } else {
      setDrag(null);
    }
  };

  const handleNewTab = () => {
    addTab(workspaceCwd());
  };

  return (
    <div
      ref={containerRef}
      data-tauri-drag-region
      className="relative flex-1 min-w-0 h-full flex items-center gap-1 overflow-x-auto no-scrollbar"
    >
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        const isDragging = drag?.id === tab.id;
        const terminal = terminals.find(t => t.id === tab.id);
        const document = documents[tab.id];
        const leaves = terminal ? collectLeaves(terminal.root) : [];
        const activeLeaf = terminal ? activeLeafOf(terminal) : null;
        const labelCwd = activeLeaf?.cwd ?? activeLeaf?.initialCwd ?? document?.path ?? document?.baseDir;
        // Shell/app-set title (OSC 0/2) wins over the cwd-derived label.
        const label = document?.title || activeLeaf?.title || tabLabel(labelCwd ?? null);
        const hasAgent = leaves.some((l) => l.agentName && !l.exited);
        const allExited = leaves.length > 0 && leaves.every((l) => l.exited);
        return (
          <div
            key={tab.id}
            // Pills drag to reorder via pointer capture — never window-drag.
            data-tauri-drag-region="false"
            ref={(el) => {
              if (el) elsRef.current.set(tab.id, el);
              else elsRef.current.delete(tab.id);
            }}
            onPointerDown={(e) => onTabPointerDown(e, tab.id, i)}
            onPointerMove={(e) => onTabPointerMove(e, tab.id)}
            onPointerUp={(e) => onTabPointerUp(e, tab.id)}
            onPointerCancel={() => {
              dragInfoRef.current = null;
              setDrag(null);
            }}
            role="tab" aria-selected={isActive} tabIndex={0}
            onKeyDown={e => {if (e.key === "Enter" || e.key === " ") {e.preventDefault();setActiveTab(tab.id);}}}
            onClick={() => {
              if (justDraggedRef.current) return;
              setActiveTab(tab.id);
            }}
            title={
              allExited
                ? t("{path} — exited", { path: labelCwd ?? t("shell") })
                : (labelCwd ?? undefined)
            }
            style={
              isDragging
                ? {
                    transform: `translateX(${drag.dx}px) scale(1.04)`,
                    zIndex: 20,
                  }
                : undefined
            }
            className={`group relative flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[14px] max-w-[230px] shrink-0 animate-[tab-in_0.16s_ease-out] ${
              isDragging
                ? "cursor-grabbing bg-raise text-ink shadow-[0_6px_20px_rgba(0,0,0,0.45)] ring-1 ring-accent/40"
                : "cursor-pointer transition-colors duration-100"
            } ${
              !isDragging && isActive
                ? "bg-raise text-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-ink)_8%,transparent)]"
                : !isDragging
                  ? "text-muted hover:bg-accent/[0.08] hover:text-ink/80"
                  : ""
            }`}
          >
            <span className="tab-type" aria-label={t(tab.kind === "terminal" ? "Terminal" : document?.kind === "file" ? "Markdown file" : "Temporary snapshot")}>{tab.kind === "terminal" ? "›_" : document?.kind === "file" ? "M↓" : "▤"}</span>
            {hasAgent && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 animate-[dot-glow_1.8s_ease-in-out_infinite]"
                title={t("agent: {name}", {
                  name: leaves.find((l) => l.agentName)?.agentName ?? "",
                })}
              />
            )}
            {terminal?.unread && !isActive && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-ink/75 shrink-0"
                title={t("New output")}
              />
            )}
            <span
              className={`truncate ${allExited ? "line-through opacity-50" : ""}`}
            >
              {label}
            </span>
            {leaves.length > 1 && (
              <span
                className="text-[11px] font-mono text-faint shrink-0"
                title={t("{n} panes", { n: leaves.length })}
              >
                ◫{leaves.length}
              </span>
            )}
            {i < 9 && (
              <span className="text-[11px] font-mono text-faint shrink-0">
                {i + 1}
              </span>
            )}
            {(tabs.length > 1 || allExited) && (
              <button
                className="w-5 h-5 -mr-1 grid place-items-center rounded text-[13px] leading-none opacity-0 group-hover:opacity-100 text-muted hover:text-ink hover:bg-ink/10 transition-opacity shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={t("Close current tab")} title={t("Close tab (all panes)")}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {drag?.indicatorLeft != null && (
        <span
          className="pointer-events-none absolute top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]"
          style={{ left: drag.indicatorLeft }}
        />
      )}
      <button
        className="w-7 h-7 grid place-items-center rounded-lg text-[18px] leading-none text-muted hover:text-accent hover:bg-accent/[0.08] transition-[color,background-color] duration-150 shrink-0"
        onClick={handleNewTab}
        title={t("New terminal ({key})", { key: kbd("⌘T") })}
      >
        +
      </button>
    </div>
  );
}
