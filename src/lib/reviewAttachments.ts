import { invoke } from "@tauri-apps/api/core";
import { useReviewStore, type ReviewKind } from "../stores/reviewStore";
import { useUiStore } from "../stores/uiStore";

interface FsPathInfo {
  path: string;
  name: string;
  kind: "file" | "directory" | "other";
  size: number;
}

export async function attachReviewPaths(paths: string[]) {
  const items: Array<{ path: string; kind: ReviewKind; name?: string }> = [];
  for (const path of paths) {
    const info = await invoke<FsPathInfo>("fs_stat_path", { path });
    if (info.kind !== "file" && info.kind !== "directory") continue;
    items.push({ path: info.path, kind: info.kind, name: info.name });
  }

  if (items.length > 0) {
    useReviewStore.getState().addAttachments(items);
    const ui = useUiStore.getState();
    if (!ui.rightSidebarOpen) ui.toggleRightSidebar();
    ui.setRightPanelTab("review");
  }
}
