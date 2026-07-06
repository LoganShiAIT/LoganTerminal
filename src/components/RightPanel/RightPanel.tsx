import AssetPanel from "../AssetPanel/AssetPanel";
import ReviewPanel from "../ReviewPanel/ReviewPanel";
import DiffPanel from "../DiffPanel/DiffPanel";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";

export default function RightPanel() {
  const tab = useUiStore((s) => s.rightPanelTab);
  const setTab = useUiStore((s) => s.setRightPanelTab);
  const attachmentCount = useReviewStore((s) => s.attachments.length);

  const btn = (active: boolean) =>
    `relative z-10 h-full rounded-md text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150 ${
      active ? "text-accent" : "text-muted hover:text-ink"
    }`;

  const pillOffset = tab === "assets" ? 0 : tab === "review" ? 1 : 2;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge p-2 shrink-0">
        <div className="relative grid h-7 grid-cols-3 rounded-lg bg-ink/[0.05] p-0.5">
          {/* Sliding pill behind the active segment. */}
          <span
            aria-hidden
            className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-md bg-accent/15 border border-accent/30 transition-transform duration-200 ease-out"
            style={{ transform: `translateX(${pillOffset * 100}%)` }}
          />
          <button className={btn(tab === "assets")} onClick={() => setTab("assets")}>
            Assets
          </button>
          <button className={btn(tab === "review")} onClick={() => setTab("review")}>
            Review
            {attachmentCount > 0 && (
              <span className="ml-1.5 inline-block min-w-[16px] rounded-full bg-accent/20 px-1 font-mono text-[9px] leading-[14px] text-accent">
                {attachmentCount}
              </span>
            )}
          </button>
          <button className={btn(tab === "diff")} onClick={() => setTab("diff")}>
            Diff
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "assets" ? (
          <AssetPanel />
        ) : tab === "review" ? (
          <ReviewPanel />
        ) : (
          <DiffPanel />
        )}
      </div>
    </div>
  );
}
