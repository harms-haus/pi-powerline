import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { footerDataProvider } from "./state";
import { alignLeftRight, stripAnsi, MAX_ACTIVE_ITEMS } from "./helpers";

export function renderAboveWidget(width: number, theme: Theme): string[] {
  try {
    const statuses = footerDataProvider?.getExtensionStatuses?.();
    if (!statuses) return [];

    const tillDoneStatus = statuses.get("til-done");
    const tillDoneActiveRaw = statuses.get("til-done-active");
    const workflowStatus = statuses.get("workflow");
    const rpirStatus = statuses.get("rpir-workflow");

    const hasTodoStatus = tillDoneStatus !== undefined;
    const hasActiveItems = tillDoneActiveRaw !== undefined && tillDoneActiveRaw.length > 0;
    const hasWorkflow = workflowStatus !== undefined;
    const hasRpir = rpirStatus !== undefined;

    if (!hasTodoStatus && !hasActiveItems && !hasWorkflow && !hasRpir) return [];

    const lines: string[] = [];

    // Section 1: Active todo items (top)
    if (hasActiveItems) {
      const MAX = MAX_ACTIVE_ITEMS;
      const activeItems = (tillDoneActiveRaw ?? "")
        .split("\n")
        .filter((item) => item.trim().length > 0);
      const displayItems = activeItems.slice(0, MAX);
      const overflow = activeItems.length - MAX;
      for (const item of displayItems) {
        const themed = theme.fg("warning", "\u25cf ") + theme.fg("accent", item);
        lines.push(truncateToWidth(themed, width, ""));
      }
      if (overflow > 0) {
        lines.push(theme.fg("dim", `... +${overflow} more`));
      }
    }

    // Section 2: Progress line (bottom, closest to composer)
    const leftRaw = hasTodoStatus ? stripAnsi(tillDoneStatus) : "";
    const leftStyled = hasTodoStatus ? tillDoneStatus : "";

    const rightRaw = hasWorkflow ? stripAnsi(workflowStatus) : hasRpir ? stripAnsi(rpirStatus) : "";
    const rightStyled = hasWorkflow ? workflowStatus : hasRpir ? rpirStatus : "";

    if (leftRaw || rightRaw) {
      if (leftRaw && rightRaw) {
        lines.push(alignLeftRight(leftStyled, rightStyled, width));
      } else if (leftRaw) {
        lines.push(leftStyled);
      } else if (rightRaw) {
        lines.push(" ".repeat(Math.max(0, width - visibleWidth(rightRaw))) + rightStyled);
      }
    }

    return lines;
  } catch {
    return [];
  }
}
