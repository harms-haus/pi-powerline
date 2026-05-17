import type { Theme } from "@earendil-works/pi-coding-agent";

export const mockTheme = {
  fg: (color: string, text: string) => `[${color}]${text}`,
} as unknown as Theme;

export function stripTags(str: string): string {
  return str.replace(/\[(dim|accent|error|warning|success|muted)\]/g, "");
}
