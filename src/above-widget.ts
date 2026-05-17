import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { footerDataProvider } from "./state";
import { alignLeftRight, stripAnsi, MAX_ACTIVE_ITEMS } from "./helpers";

function renderActiveItems(activeRaw: string, width: number, theme: Theme): string[] {
  const activeItems = activeRaw.split("\n").filter((item) => item.trim().length > 0);
  const displayItems = activeItems.slice(0, MAX_ACTIVE_ITEMS);
  const overflow = activeItems.length - MAX_ACTIVE_ITEMS;
  const lines: string[] = [];
  for (const item of displayItems) {
    const themed = theme.fg("warning", "\u25cf ") + theme.fg("accent", item);
    lines.push(truncateToWidth(themed, width, "…"));
  }
  if (overflow > 0) {
    lines.push(theme.fg("dim", `... +${overflow} more`));
  }
  return lines;
}

interface StatusSections {
  activeRaw: string | undefined;
  leftStyled: string;
  leftRaw: string;
  rightStyled: string;
  rightRaw: string;
  hasAny: boolean;
}

function collectStatusSections(statuses: ReadonlyMap<string, string>): StatusSections {
  const activeRaw = statuses.get("til-done-active");
  const tillDoneStatus = statuses.get("til-done");
  const workflowStatus = statuses.get("workflow");
  const rpirStatus = statuses.get("rpir-workflow");

  const hasActiveItems = activeRaw !== undefined && activeRaw.length > 0;
  const hasTodo = tillDoneStatus !== undefined;
  const hasWorkflow = workflowStatus !== undefined;
  const hasRpir = rpirStatus !== undefined;

  const leftStyled = hasTodo ? tillDoneStatus : "";
  const leftRaw = hasTodo ? stripAnsi(tillDoneStatus) : "";

  let rightStyled: string;
  let rightRaw: string;
  if (hasWorkflow) {
    rightStyled = workflowStatus;
    rightRaw = stripAnsi(workflowStatus);
  } else if (hasRpir) {
    rightStyled = rpirStatus;
    rightRaw = stripAnsi(rpirStatus);
  } else {
    rightStyled = "";
    rightRaw = "";
  }

  const hasAny = hasTodo || hasActiveItems || hasWorkflow || hasRpir;

  return {
    activeRaw: hasActiveItems ? activeRaw : undefined,
    leftStyled,
    leftRaw,
    rightStyled,
    rightRaw,
    hasAny,
  };
}

function renderProgressLine(
  leftStyled: string,
  leftRaw: string,
  rightStyled: string,
  rightRaw: string,
  width: number,
): string | null {
  if (!leftRaw && !rightRaw) return null;
  if (leftRaw && rightRaw) {
    return alignLeftRight(leftStyled, rightStyled, width);
  }
  if (leftRaw) {
    return leftStyled + " ".repeat(Math.max(0, width - visibleWidth(leftStyled)));
  }
  return " ".repeat(Math.max(0, width - visibleWidth(rightRaw))) + rightStyled;
}

export function renderAboveWidget(width: number, theme: Theme): string[] {
  try {
    const statuses = footerDataProvider?.getExtensionStatuses();
    if (!statuses) return [];

    const sections = collectStatusSections(statuses);
    if (!sections.hasAny) return [];

    const lines: string[] = [];

    // Section 1: Active todo items (top)
    if (sections.activeRaw) {
      lines.push(...renderActiveItems(sections.activeRaw, width, theme));
    }

    // Section 2: Progress line (bottom, closest to composer)
    const progressLine = renderProgressLine(
      sections.leftStyled,
      sections.leftRaw,
      sections.rightStyled,
      sections.rightRaw,
      width,
    );
    if (progressLine) {
      lines.push(progressLine);
    }

    return lines;
  } catch (error: unknown) {
    console.error("[pi-powerline] renderAboveWidget error:", error);
    return [];
  }
}
