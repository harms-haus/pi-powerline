import type { Theme } from "@earendil-works/pi-coding-agent";
import { currentCwd, api, requestRefresh } from "./state";

const GIT_DIFF_TIMEOUT_MS = 5000;
const GIT_DIFF_DEBOUNCE_MS = 500;

export interface GitDiffStat {
  insertions: number;
  deletions: number;
}

export let gitChanges: GitDiffStat | null = null;
let gitDiffTimer: ReturnType<typeof setTimeout> | undefined;
let gitDiffInFlight = false;

function parseGitShortstat(output: string): GitDiffStat | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  const insertionMatch = trimmed.match(/(\d+) insertion/);
  const deletionMatch = trimmed.match(/(\d+) deletion/);

  const insertions = insertionMatch?.[1] ? parseInt(insertionMatch[1], 10) : 0;
  const deletions = deletionMatch?.[1] ? parseInt(deletionMatch[1], 10) : 0;

  return { insertions, deletions };
}

/**
 * Apply green/red coloring to git diff stat data.
 * Each numeric portion is colored individually.
 */
export function colorCodeGitChanges(stat: GitDiffStat | null, theme: Theme): string {
  if (!stat) return theme.fg("dim", "");
  const { insertions, deletions } = stat;
  if (insertions > 0 && deletions > 0) {
    return `${theme.fg("success", `+${insertions}`)} ${theme.fg("error", `-${deletions}`)}`;
  } else if (insertions > 0) {
    return theme.fg("success", `+${insertions}`);
  } else if (deletions > 0) {
    return theme.fg("error", `-${deletions}`);
  }
  return theme.fg("dim", "");
}

// ─── Git Diff ──────────────────────────────────────────────────────
export async function refreshGitDiff(): Promise<void> {
  const cwd = currentCwd;
  if (!cwd || !api || gitDiffInFlight) return;
  gitDiffInFlight = true;

  try {
    const result = await api.exec("git", ["diff", "--shortstat", "HEAD"], {
      cwd,
      timeout: GIT_DIFF_TIMEOUT_MS,
    });

    if (result.code === 0) {
      gitChanges = parseGitShortstat(result.stdout || "");
    } else {
      gitChanges = null;
    }
  } catch (error: unknown) {
    console.error("[pi-powerline] refreshGitDiff error:", error);
    gitChanges = null;
  } finally {
    gitDiffInFlight = false;
  }

  requestRefresh();
}

export function debouncedRefreshGitDiff(): void {
  if (gitDiffTimer) clearTimeout(gitDiffTimer);
  gitDiffTimer = setTimeout(() => {
    gitDiffTimer = undefined;
    void refreshGitDiff();
  }, GIT_DIFF_DEBOUNCE_MS);
}

export function clearGitTimer(): void {
  if (gitDiffTimer) {
    clearTimeout(gitDiffTimer);
    gitDiffTimer = undefined;
  }
  gitChanges = null;
}
