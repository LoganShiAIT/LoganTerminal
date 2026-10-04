import type { PaneSnapshot } from "./tabSnapshot";
export const WORKSPACE_KEY = "logan.workspaceSnapshot";
export type SavedEntry =
  | {
      id: string;
      kind: "terminal";
      layout: PaneSnapshot;
      companion?: string;
      ratio?: number;
    }
  | { id: string; kind: "document"; path: string; mode: "preview" | "source" };
export interface WorkspaceSnapshot {
  version: 1;
  entries: SavedEntry[];
  activeId: string | null;
}
function validLayout(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === "string") return true;
  if (!value || typeof value !== "object" || depth >= 3) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.dir === "row" || v.dir === "col") &&
    typeof v.ratio === "number" &&
    Number.isFinite(v.ratio) &&
    validLayout(v.a, depth + 1) &&
    validLayout(v.b, depth + 1)
  );
}
export function validWorkspaceSnapshot(
  value: unknown,
): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as WorkspaceSnapshot;
  if (
    v.version !== 1 ||
    !Array.isArray(v.entries) ||
    v.entries.length > 256 ||
    (v.activeId !== null && typeof v.activeId !== "string")
  )
    return false;
  const ids = new Set<string>();
  const validEntries = v.entries.every((e) => {
    if (!e || typeof e.id !== "string" || ids.has(e.id)) return false;
    ids.add(e.id);
    if (e.kind === "document")
      return (
        typeof e.path === "string" &&
        !!e.path &&
        (e.mode === "preview" || e.mode === "source")
      );
    return (
      e.kind === "terminal" &&
      validLayout(e.layout) &&
      (e.companion === undefined || typeof e.companion === "string") &&
      (e.ratio === undefined ||
        (typeof e.ratio === "number" && Number.isFinite(e.ratio)))
    );
  });
  if (!validEntries) return false;
  const docs = new Set(
    v.entries.filter((e) => e.kind === "document").map((e) => e.id),
  );
  return v.entries.every(
    (e) =>
      e.kind !== "terminal" ||
      e.companion === undefined ||
      docs.has(e.companion),
  );
}
export function readWorkspaceSnapshot(): WorkspaceSnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "null");
    return validWorkspaceSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}
