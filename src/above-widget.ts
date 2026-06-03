import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { footerDataProvider } from "./state";
import { alignLeftRight, stripAnsi, MAX_ACTIVE_ITEMS } from "./helpers";

// ── Kanban ──────────────────────────────────────────────────────────────

interface KanbanClaimedTask {
  id: string;
  title: string;
  phase: string;
}

interface KanbanData {
  total: number;
  claimed: number;
  ready: number;
  blocked: number;
  done: number;
  claimedTasks: KanbanClaimedTask[];
}

const PHASE_ICONS: Record<string, string> = {
  test: "🧪",
  implement: "⚙️",
  review: "👁",
  done: "✓",
};

function phaseIcon(phase: string): string {
  return PHASE_ICONS[phase] ?? "?";
}

function parseKanbanStatus(raw: string): KanbanData | undefined {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const total = Number.isFinite(Number(obj.total)) ? Number(obj.total) : 0;
    const claimed = Number.isFinite(Number(obj.claimed)) ? Number(obj.claimed) : 0;
    const ready = Number.isFinite(Number(obj.ready)) ? Number(obj.ready) : 0;
    const blocked = Number.isFinite(Number(obj.blocked)) ? Number(obj.blocked) : 0;
    const done = Number.isFinite(Number(obj.done)) ? Number(obj.done) : 0;
    const claimedTasks = Array.isArray(obj.claimedTasks)
      ? (obj.claimedTasks as Record<string, unknown>[]).map((t) => ({
          id: typeof t.id === "string" ? t.id : "",
          title: typeof t.title === "string" ? t.title : "",
          phase: typeof t.phase === "string" ? t.phase : "",
        }))
      : [];
    return { total, claimed, ready, blocked, done, claimedTasks };
  } catch {
    return undefined;
  }
}

function renderKanbanClaimedTasks(
  claimedTasks: KanbanClaimedTask[],
  width: number,
  theme: Theme,
): string[] {
  const lines: string[] = [];
  for (const task of claimedTasks) {
    const icon = phaseIcon(task.phase);
    const styled =
      theme.fg("warning", icon) +
      " " +
      theme.fg("accent", "[" + task.id + "]") +
      " " +
      theme.fg("text", task.title);
    lines.push(truncateToWidth(styled, width, "…"));
  }
  return lines;
}

function renderKanbanSummary(kanban: KanbanData, width: number, theme: Theme): string {
  const parts: string[] = [theme.fg("accent", `[${kanban.done}/${kanban.total}]`)];
  if (kanban.claimed > 0) parts.push(theme.fg("warning", `${kanban.claimed} claimed`));
  if (kanban.ready > 0) parts.push(theme.fg("success", `${kanban.ready} ready`));
  if (kanban.blocked > 0) parts.push(theme.fg("error", `${kanban.blocked} blocked`));
  return truncateToWidth(parts.join(" "), width, "…");
}

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
  kanban: KanbanData | undefined;
  hasAny: boolean;
}

function collectStatusSections(statuses: ReadonlyMap<string, string>): StatusSections {
  const activeRaw = statuses.get("til-done-active");
  const tillDoneStatus = statuses.get("til-done");
  const workflowStatus = statuses.get("workflow");
  const rpirStatus = statuses.get("rpir-workflow");
  const kanbanRaw = statuses.get("kanban");

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

  // Parse kanban status — skip silently on failure
  let kanban: KanbanData | undefined;
  if (kanbanRaw !== undefined) {
    kanban = parseKanbanStatus(kanbanRaw);
    // Skip kanban rendering if all tasks are done
    if (kanban && kanban.done === kanban.total) {
      kanban = undefined;
    }
  }

  const hasKanban = kanban !== undefined;
  const hasAny = hasTodo || hasActiveItems || hasWorkflow || hasRpir || hasKanban;

  return {
    activeRaw: hasActiveItems ? activeRaw : undefined,
    leftStyled,
    leftRaw,
    rightStyled,
    rightRaw,
    kanban,
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

    // Section 2: Kanban claimed task lines
    if (sections.kanban && sections.kanban.claimedTasks.length > 0) {
      lines.push(...renderKanbanClaimedTasks(sections.kanban.claimedTasks, width, theme));
    }

    // Section 3: Progress line (existing, using alignLeftRight)
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

    // Section 4: Kanban summary line (closest to composer)
    if (sections.kanban) {
      lines.push(renderKanbanSummary(sections.kanban, width, theme));
    }

    return lines;
  } catch (error: unknown) {
    console.error("[pi-powerline] renderAboveWidget error:", error);
    return [];
  }
}
