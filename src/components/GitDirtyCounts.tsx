import { dirtyTotal, type GitDirty } from "../lib/git";

/**
 * The `+2 ~1 −3` cluster of uncommitted-change counts, in the colours used
 * everywhere else for added / modified / deleted. Renders nothing on a clean
 * (or unknown) tree, so callers can drop it in unconditionally.
 */
export default function GitDirtyCounts({
  dirty,
  title,
}: {
  dirty: GitDirty | null | undefined;
  title?: string;
}) {
  if (!dirty || dirtyTotal(dirty) === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1" title={title}>
      {dirty.added > 0 && (
        <span className="text-emerald-300/90">+{dirty.added}</span>
      )}
      {dirty.modified > 0 && (
        <span className="text-amber-300/90">~{dirty.modified}</span>
      )}
      {dirty.deleted > 0 && (
        <span className="text-red-300/90">−{dirty.deleted}</span>
      )}
    </span>
  );
}
