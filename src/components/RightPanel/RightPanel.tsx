import AssetPanel from "../AssetPanel/AssetPanel";
import ReviewPanel from "../ReviewPanel/ReviewPanel";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";

export default function RightPanel() {
  const tab = useUiStore((s) => s.rightPanelTab);
  const setTab = useUiStore((s) => s.setRightPanelTab);
  const attachmentCount = useReviewStore((s) => s.attachments.length);

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-2 gap-1 border-b border-edge p-2 shrink-0">
        <button
          className={`h-7 rounded-md text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
            tab === "assets"
              ? "bg-accent/15 text-accent"
              : "text-muted hover:bg-ink/5 hover:text-ink"
          }`}
          onClick={() => setTab("assets")}
        >
          Assets
        </button>
        <button
          className={`h-7 rounded-md text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
            tab === "review"
              ? "bg-accent/15 text-accent"
              : "text-muted hover:bg-ink/5 hover:text-ink"
          }`}
          onClick={() => setTab("review")}
        >
          Review {attachmentCount > 0 ? attachmentCount : ""}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "assets" ? <AssetPanel /> : <ReviewPanel />}
      </div>
    </div>
  );
}
