import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
const ANSI_REGEX = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex

export const MAX_ACTIVE_ITEMS = 10;

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return (count / 1000).toFixed(1) + "k";
  if (count < 1000000) return Math.round(count / 1000) + "k";
  if (count < 10000000) return (count / 1000000).toFixed(1) + "M";
  return Math.round(count / 1000000) + "M";
}

export function shortenPath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path;
}

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, "");
}

export function alignLeftRight(left: string, right: string, width: number): string {
  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);

  // Both fit with 2-char gap
  if (leftW + 2 + rightW <= width) {
    return left + " ".repeat(width - leftW - rightW) + right;
  }

  // Right doesn't fit: truncate right, then try again
  if (leftW + 2 <= width) {
    const availableForRight = width - leftW - 2;
    const truncatedRight = truncateToWidth(right, availableForRight, "");
    const actualRightW = visibleWidth(truncatedRight);
    return left + " ".repeat(width - leftW - actualRightW) + truncatedRight;
  }

  // Left alone is too wide: truncate left only
  return truncateToWidth(left, width, "");
}
